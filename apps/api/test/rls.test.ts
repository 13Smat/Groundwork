import { createId } from "@groundwork/shared";
import type { Kysely } from "kysely";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readAppDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createDb, createPool } from "../src/db/client.js";
import { listUpMigrations, migrate } from "../src/db/migrate.js";
import type { Database } from "../src/db/types.js";
import { TenantRoleError, withWorkspaceContext } from "../src/db/workspace.js";
import { startQueue } from "../src/queue.js";

const TENANT_TABLES = ["counters", "file", "audit_log", "usage_event"] as const;
type TenantTable = (typeof TENANT_TABLES)[number];

let admin: pg.Pool | undefined;
let appPool: pg.Pool | undefined;
let db: Kysely<Database> | undefined;

async function connect(): Promise<void> {
  admin = createPool(readDatabaseUrl());
  appPool = createPool(readAppDatabaseUrl());
  db = createDb(appPool);
}

async function disconnect(): Promise<void> {
  await appPool?.end();
  appPool = undefined;
  db = undefined;
  await admin?.end();
  admin = undefined;
}

function requireAdmin(): pg.Pool {
  if (!admin) {
    throw new Error("Admin pool is not connected.");
  }
  return admin;
}

function requireApp(): pg.Pool {
  if (!appPool) {
    throw new Error("App pool is not connected.");
  }
  return appPool;
}

function requireDb(): Kysely<Database> {
  if (!db) {
    throw new Error("Tenant database is not connected.");
  }
  return db;
}

beforeAll(async () => {
  await migrate("up");
  await connect();
});

afterAll(async () => {
  await disconnect();
});

describe("row level security", () => {
  it("enables postgis, pgcrypto, and citext", async () => {
    const result = await requireAdmin().query<{ extname: string }>(
      "select extname from pg_extension where extname = any($1::text[])",
      [["postgis", "pgcrypto", "citext"]],
    );
    expect(result.rows.map((row) => row.extname).sort()).toEqual(["citext", "pgcrypto", "postgis"]);
  });

  it("connects the app as a role that cannot bypass row security", async () => {
    const result = await requireApp().query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>("select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user");
    const role = result.rows[0];
    expect(role?.current_user).toBe("groundwork_app");
    expect(role?.rolsuper).toBe(false);
    expect(role?.rolbypassrls).toBe(false);
  });

  it("forces row security on the tenant tables", async () => {
    const result = await requireAdmin().query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `
        select c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1::text[])
      `,
      [TENANT_TABLES],
    );
    expect(result.rows).toHaveLength(TENANT_TABLES.length);
    for (const row of result.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it("returns no tenant rows when app.workspace_id is unset or blank", async () => {
    const workspaceA = createId();
    const workspaceB = createId();
    await insertFixtures(workspaceA, workspaceB);

    const client = await requireApp().connect();
    try {
      for (const table of TENANT_TABLES) {
        const unset = await client.query<{ n: number }>(`select count(*)::int as n from ${table}`);
        expect(unset.rows[0]?.n).toBe(0);
      }
      await client.query("begin");
      await client.query("select set_config('app.workspace_id', '', true)");
      const blank = await client.query<{ n: number }>("select count(*)::int as n from file");
      await client.query("rollback");
      expect(blank.rows[0]?.n).toBe(0);
    } finally {
      client.release();
    }
  });

  it("hides workspace B from a raw query in workspace A", async () => {
    const workspaceA = createId();
    const workspaceB = createId();
    const ids = await insertFixtures(workspaceA, workspaceB);

    for (const table of TENANT_TABLES) {
      const seen = await visibleIds(table, workspaceA, [ids[table].a, ids[table].b]);
      expect(seen).toEqual([ids[table].a]);
      const other = await visibleIds(table, workspaceB, [ids[table].a, ids[table].b]);
      expect(other).toEqual([ids[table].b]);
    }
  });

  it("keeps the workspace setting inside withWorkspaceContext and drops it after", async () => {
    const workspaceA = createId();
    const workspaceB = createId();
    const fileA = createId();
    const fileB = createId();
    const database = requireDb();

    await withWorkspaceContext(database, workspaceA, async (trx) => {
      await trx
        .insertInto("file")
        .values({
          id: fileA,
          workspace_id: workspaceA,
          storage_key: `workspaces/${workspaceA}/${fileA}`,
          status: "ready",
        })
        .execute();
      const rows = await trx.selectFrom("file").select(["id"]).execute();
      expect(rows.map((row) => row.id)).toContain(fileA);
      expect(rows.map((row) => row.id)).not.toContain(fileB);
    });

    await withWorkspaceContext(database, workspaceB, async (trx) => {
      await trx
        .insertInto("file")
        .values({
          id: fileB,
          workspace_id: workspaceB,
          storage_key: `workspaces/${workspaceB}/${fileB}`,
          status: "ready",
        })
        .execute();
      const rows = await trx.selectFrom("file").select(["id", "workspace_id"]).execute();
      expect(rows.every((row) => row.workspace_id === workspaceB)).toBe(true);
      expect(rows.map((row) => row.id)).not.toContain(fileA);
    });

    await expect(
      withWorkspaceContext(database, workspaceA, async (trx) => {
        await trx
          .insertInto("file")
          .values({
            id: createId(),
            workspace_id: workspaceB,
            storage_key: `workspaces/${workspaceB}/${createId()}`,
            status: "ready",
          })
          .execute();
      }),
    ).rejects.toThrow();

    const leaked = await database.selectFrom("file").select("id").execute();
    expect(leaked).toEqual([]);
  });

  it("rejects tenant queries on the database owner connection", async () => {
    const owner = createDb(requireAdmin());
    await expect(
      withWorkspaceContext(owner, createId(), async () => "nope"),
    ).rejects.toBeInstanceOf(TenantRoleError);
  });

  it("applies nothing the second time", async () => {
    const result = await migrate("up");
    expect(result.applied).toEqual([]);
  });

  it("starts the pg-boss worker against the owner database", async () => {
    const boss = await startQueue(readDatabaseUrl(), () => undefined);
    await boss.stop({ graceful: true, close: true, timeout: 10_000 });
  });

  it("reverts every applied migration and applies them again", async () => {
    await disconnect();
    const versions = listUpMigrations().map((name) => name.replace(/\.sql$/, ""));
    const reverted: string[] = [];
    for (let index = 0; index < versions.length; index += 1) {
      const result = await migrate("down");
      reverted.push(...result.reverted);
    }
    expect(reverted).toEqual([...versions].reverse());

    const check = createPool(readDatabaseUrl());
    const missing = await check.query<{ name: string | null }>(
      "select to_regclass('public.file')::text as name",
    );
    expect(missing.rows[0]?.name).toBeNull();
    const imagery = await check.query<{ name: string | null }>(
      "select to_regclass('public.imagery_capture')::text as name",
    );
    expect(imagery.rows[0]?.name).toBeNull();
    await check.end();

    const applied = await migrate("up");
    expect(applied.applied).toEqual(versions);
    await connect();

    const workspaceA = createId();
    await insertFixtures(workspaceA, createId());
    const client = await requireApp().connect();
    try {
      const result = await client.query<{ n: number }>("select count(*)::int as n from file");
      expect(result.rows[0]?.n).toBe(0);
    } finally {
      client.release();
    }
  });
});

describe("imagery row level security", () => {
  it("forces row security on the imagery tables", async () => {
    const result = await requireAdmin().query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `
        select c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1::text[])
      `,
      [["imagery_source", "imagery_capture"]],
    );
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it("lets every workspace read a global row and hides another workspace's row", async () => {
    const workspaceA = createId();
    const workspaceB = createId();
    const sourceA = createId();
    const sourceB = createId();
    await requireAdmin().query(
      `insert into imagery_source (id, workspace_id, provider, name, bands, allows_tracing, allows_ml_training)
       values ($1, $2, 'drone_upload', $3, 'RGB', false, false),
              ($4, $5, 'drone_upload', $6, 'RGB', false, false)`,
      [sourceA, workspaceA, `tenant-${sourceA}`, sourceB, workspaceB, `tenant-${sourceB}`],
    );

    const client = await requireApp().connect();
    try {
      const unset = await client.query<{ name: string }>(
        "select name from imagery_source where name = 'naip'",
      );
      expect(unset.rows.map((row) => row.name)).toEqual(["naip"]);

      await client.query("begin");
      await client.query("select set_config('app.workspace_id', $1, true)", [workspaceA]);
      const visible = await client.query<{ id: string }>(
        "select id::text as id from imagery_source where id::text = any($1::text[]) order by id",
        [[sourceA, sourceB]],
      );
      const globalRow = await client.query<{ name: string }>(
        "select name from imagery_source where name = 'google_satellite'",
      );
      await client.query("rollback");
      expect(visible.rows.map((row) => row.id)).toEqual([sourceA]);
      expect(globalRow.rows).toHaveLength(1);
    } finally {
      client.release();
    }
  });

  it("refuses a global write from the app role and allows a tenant write", async () => {
    const workspaceA = createId();
    const workspaceB = createId();
    const client = await requireApp().connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.workspace_id', $1, true)", [workspaceA]);
      await expect(
        client.query(
          `insert into imagery_source (id, workspace_id, provider, name, bands, allows_tracing, allows_ml_training)
           values ($1, null, 'other', $2, 'RGB', false, false)`,
          [createId(), `global-${createId()}`],
        ),
      ).rejects.toThrow(/row-level security/i);
      await client.query("rollback");

      await client.query("begin");
      await client.query("select set_config('app.workspace_id', $1, true)", [workspaceA]);
      const tenantId = createId();
      await client.query(
        `insert into imagery_source (id, workspace_id, provider, name, bands, allows_tracing, allows_ml_training)
         values ($1, $2, 'drone_upload', $3, 'RGB', false, false)`,
        [tenantId, workspaceA, `tenant-${tenantId}`],
      );
      await expect(
        client.query(
          `insert into imagery_source (id, workspace_id, provider, name, bands, allows_tracing, allows_ml_training)
           values ($1, $2, 'drone_upload', $3, 'RGB', false, false)`,
          [createId(), workspaceB, `tenant-${createId()}`],
        ),
      ).rejects.toThrow(/row-level security/i);
      await client.query("rollback");

      await client.query("begin");
      await client.query("select set_config('app.workspace_id', $1, true)", [workspaceA]);
      const updated = await client.query(
        "update imagery_source set allows_tracing = true where name = 'google_satellite'",
      );
      expect(updated.rowCount).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
    }

    const stillBlocked = await requireAdmin().query<{ allows_tracing: boolean }>(
      "select allows_tracing from imagery_source where name = 'google_satellite'",
    );
    expect(stillBlocked.rows[0]?.allows_tracing).toBe(false);
  });
});

type FixtureIds = Record<TenantTable, { a: string; b: string }>;

async function insertFixtures(workspaceA: string, workspaceB: string): Promise<FixtureIds> {
  const ids: FixtureIds = {
    counters: { a: createId(), b: createId() },
    file: { a: createId(), b: createId() },
    audit_log: { a: "", b: "" },
    usage_event: { a: "", b: "" },
  };
  const pool = requireAdmin();
  await pool.query(
    `insert into counters (id, workspace_id, prefix, last_value)
     values ($1, $2, 'J', 1), ($3, $4, 'J', 1)`,
    [ids.counters.a, workspaceA, ids.counters.b, workspaceB],
  );
  await pool.query(
    `insert into file (id, workspace_id, storage_key, status)
     values ($1, $2, $3, 'ready'), ($4, $5, $6, 'ready')`,
    [
      ids.file.a,
      workspaceA,
      `workspaces/${workspaceA}/${ids.file.a}`,
      ids.file.b,
      workspaceB,
      `workspaces/${workspaceB}/${ids.file.b}`,
    ],
  );
  ids.audit_log = {
    a: await insertReturningId(pool, "audit_log", workspaceA),
    b: await insertReturningId(pool, "audit_log", workspaceB),
  };
  ids.usage_event = {
    a: await insertReturningId(pool, "usage_event", workspaceA),
    b: await insertReturningId(pool, "usage_event", workspaceB),
  };
  return ids;
}

async function insertReturningId(
  pool: pg.Pool,
  table: "audit_log" | "usage_event",
  workspaceId: string,
): Promise<string> {
  const column = table === "audit_log" ? "action" : "kind";
  const result = await pool.query<{ id: string }>(
    `insert into ${table} (workspace_id, ${column}) values ($1, 'test') returning id::text as id`,
    [workspaceId],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`Insert into ${table} did not return an id.`);
  }
  return id;
}

async function visibleIds(
  table: TenantTable,
  workspaceId: string,
  ids: string[],
): Promise<string[]> {
  const client = await requireApp().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.workspace_id', $1, true)", [workspaceId]);
    const result = await client.query<{ id: string }>(
      `select id::text as id from ${table} where id::text = any($1::text[]) order by id`,
      [ids],
    );
    await client.query("rollback");
    return result.rows.map((row) => row.id);
  } finally {
    client.release();
  }
}
