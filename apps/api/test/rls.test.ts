import { createId } from "@groundwork/shared";
import type { Kysely } from "kysely";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readAppDatabaseUrl, readAuthDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createDb, createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import type { Database } from "../src/db/types.js";
import { TenantRoleError, withWorkspaceContext } from "../src/db/workspace.js";
import { startQueue } from "../src/queue.js";

const TENANT_TABLES = ["counters", "file", "audit_log", "usage_event"] as const;
const AUTH_TABLES = [
  "app_user",
  "session",
  "account",
  "verification",
  "workspace",
  "member",
  "invitation",
  "role",
] as const;
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

  it("forces row security on the auth tables", async () => {
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
      [AUTH_TABLES],
    );
    expect(result.rows).toHaveLength(AUTH_TABLES.length);
    for (const row of result.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it("hides workspaces, members, and custom roles until the tenant setting is present", async () => {
    const workspaceA = createId();
    const workspaceB = createId();
    const userA = createId();
    const userB = createId();
    const memberA = createId();
    const memberB = createId();
    const customRole = createId();
    const admin = requireAdmin();
    await admin.query(
      `insert into app_user (id, name, email) values ($1, 'A', $2), ($3, 'B', $4)`,
      [userA, `${userA}@example.com`, userB, `${userB}@example.com`],
    );
    await admin.query(
      `insert into workspace (id, name, slug) values ($1, 'A', $2), ($3, 'B', $4)`,
      [workspaceA, `a-${workspaceA.slice(0, 8)}`, workspaceB, `b-${workspaceB.slice(0, 8)}`],
    );
    await admin.query(
      `insert into member (id, workspace_id, user_id, role, role_id, status)
       values ($1, $2, $3, 'owner', '018f3c2e-7b10-7000-8000-000000000001', 'active'),
              ($4, $5, $6, 'owner', '018f3c2e-7b10-7000-8000-000000000001', 'active')`,
      [memberA, workspaceA, userA, memberB, workspaceB, userB],
    );
    await admin.query(
      `insert into "role" (id, workspace_id, name, permissions, is_system)
       values ($1, $2, 'custom', array[]::text[], false)`,
      [customRole, workspaceA],
    );

    const app = await requireApp().connect();
    const auth = createPool(readAuthDatabaseUrl());
    try {
      const hiddenWorkspaces = await app.query<{ n: number }>(
        "select count(*)::int as n from workspace",
      );
      const hiddenMembers = await app.query<{ n: number }>("select count(*)::int as n from member");
      const hiddenInvites = await app.query<{ n: number }>(
        "select count(*)::int as n from invitation",
      );
      const systemRoles = await app.query<{ n: number }>(
        `select count(*)::int as n from "role" where is_system`,
      );
      const customHidden = await app.query<{ n: number }>(
        `select count(*)::int as n from "role" where id = $1`,
        [customRole],
      );
      expect(hiddenWorkspaces.rows[0]?.n).toBe(0);
      expect(hiddenMembers.rows[0]?.n).toBe(0);
      expect(hiddenInvites.rows[0]?.n).toBe(0);
      expect(systemRoles.rows[0]?.n).toBe(6);
      expect(customHidden.rows[0]?.n).toBe(0);

      await app.query("begin");
      await app.query("select set_config('app.workspace_id', $1, true)", [workspaceA]);
      const seenWorkspaces = await app.query<{ id: string }>("select id from workspace");
      const seenMembers = await app.query<{ id: string }>("select id from member");
      const seenCustom = await app.query<{ id: string }>(
        `select id from "role" where not is_system`,
      );
      await app.query("rollback");
      expect(seenWorkspaces.rows.map((row) => row.id)).toEqual([workspaceA]);
      expect(seenMembers.rows.map((row) => row.id)).toEqual([memberA]);
      expect(seenCustom.rows.map((row) => row.id)).toEqual([customRole]);

      const asAuth = await auth.query<{ n: number }>(
        "select count(*)::int as n from app_user where id = $1",
        [userA],
      );
      const asApp = await app.query<{ n: number }>(
        "select count(*)::int as n from app_user where id = $1",
        [userB],
      );
      expect(asAuth.rows[0]?.n).toBe(1);
      expect(asApp.rows[0]?.n).toBe(0);
    } finally {
      app.release();
      await auth.end();
      await admin.query(`delete from "role" where id = $1`, [customRole]);
      await admin.query("delete from member where id = any($1::text[])", [[memberA, memberB]]);
      await admin.query("delete from workspace where id = any($1::text[])", [
        [workspaceA, workspaceB],
      ]);
      await admin.query("delete from app_user where id = any($1::text[])", [[userA, userB]]);
    }
  });

  it("reverts the migration and applies it again", async () => {
    await disconnect();
    const reverted = await migrate("down");
    expect(reverted.reverted).toEqual(["0002_auth_workspaces"]);

    const check = createPool(readDatabaseUrl());
    const missing = await check.query<{ name: string | null }>(
      "select to_regclass('public.app_user')::text as name",
    );
    const file = await check.query<{ name: string | null }>(
      "select to_regclass('public.file')::text as name",
    );
    expect(missing.rows[0]?.name).toBeNull();
    expect(file.rows[0]?.name).toBe("file");
    await check.end();

    const applied = await migrate("up");
    expect(applied.applied).toEqual(["0002_auth_workspaces"]);
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
