import { createId } from "@groundwork/shared";
import type { Kysely } from "kysely";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readAppDatabaseUrl, readAuthDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createDb, createPool } from "../src/db/client.js";
import { listUpMigrations, migrate } from "../src/db/migrate.js";
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

  it("connects Better Auth as groundwork_auth without superuser or row-security bypass", async () => {
    const catalog = await requireAdmin().query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
      app_can_assume: boolean;
    }>(`
      select rolsuper, rolbypassrls, rolcanlogin,
        pg_has_role('groundwork_app', 'groundwork_auth', 'member') as app_can_assume
      from pg_roles
      where rolname = 'groundwork_auth'
    `);
    const role = catalog.rows[0];
    expect(role?.rolsuper).toBe(false);
    expect(role?.rolbypassrls).toBe(false);
    expect(role?.rolcanlogin).toBe(true);
    expect(role?.app_can_assume).toBe(false);

    const auth = createPool(readAuthDatabaseUrl());
    try {
      const connected = await auth.query<{
        current_user: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>("select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user");
      expect(connected.rows[0]?.current_user).toBe("groundwork_auth");
      expect(connected.rows[0]?.rolsuper).toBe(false);
      expect(connected.rows[0]?.rolbypassrls).toBe(false);
    } finally {
      await auth.end();
    }
  });

  it("refuses session, account, and verification reads from the app role", async () => {
    const userId = createId();
    const sessionId = createId();
    const accountId = createId();
    const verificationId = createId();
    const admin = requireAdmin();
    await admin.query(`insert into app_user (id, name, email) values ($1, 'Hidden', $2)`, [
      userId,
      `${userId}@example.com`,
    ]);
    await admin.query(
      `insert into session (id, user_id, token, expires_at)
       values ($1, $2, $3, now() + interval '1 day')`,
      [sessionId, userId, `token-${sessionId}`],
    );
    await admin.query(
      `insert into account (id, account_id, provider_id, user_id)
       values ($1, $2, 'credential', $3)`,
      [accountId, userId, userId],
    );
    await admin.query(
      `insert into verification (id, identifier, value, expires_at)
       values ($1, $2, 'secret', now() + interval '1 day')`,
      [verificationId, `${userId}@example.com`],
    );

    const app = await requireApp().connect();
    const auth = createPool(readAuthDatabaseUrl());
    try {
      for (const table of ["session", "account", "verification"] as const) {
        await expect(app.query(`select count(*)::int as n from ${table}`)).rejects.toThrow(
          /permission denied/i,
        );
      }
      await app.query("begin");
      try {
        await app.query("select set_config('app.workspace_id', $1, true)", [createId()]);
        await app.query("select set_config('app.user_id', $1, true)", [userId]);
        await expect(
          app.query("select id from session where id = $1", [sessionId]),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await app.query("rollback");
      }

      const sessions = await auth.query<{ id: string }>("select id from session where id = $1", [
        sessionId,
      ]);
      const accounts = await auth.query<{ id: string }>("select id from account where id = $1", [
        accountId,
      ]);
      const verifications = await auth.query<{ id: string }>(
        "select id from verification where id = $1",
        [verificationId],
      );
      expect(sessions.rows.map((row) => row.id)).toEqual([sessionId]);
      expect(accounts.rows.map((row) => row.id)).toEqual([accountId]);
      expect(verifications.rows.map((row) => row.id)).toEqual([verificationId]);
    } finally {
      app.release();
      await auth.end();
      await admin.query("delete from verification where id = $1", [verificationId]);
      await admin.query("delete from account where id = $1", [accountId]);
      await admin.query("delete from session where id = $1", [sessionId]);
      await admin.query("delete from app_user where id = $1", [userId]);
    }
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
      "select to_regclass('public.app_user')::text as name",
    );
    const file = await check.query<{ name: string | null }>(
      "select to_regclass('public.file')::text as name",
    );
    expect(missing.rows[0]?.name).toBeNull();
    expect(file.rows[0]?.name).toBeNull();
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

describe("catalog row level security", () => {
  it("isolates catalog and recipe rows and does not grant them to groundwork_auth", async () => {
    const workspaceA = createId();
    const workspaceB = createId();
    const takeoffA = createId();
    const takeoffB = createId();
    const catalogA = createId();
    const catalogB = createId();
    const recipeA = createId();
    const recipeB = createId();
    const componentA = createId();
    const admin = requireAdmin();
    await admin.query(
      `insert into takeoff_item (id, workspace_id, name, measure_kind, default_unit)
       values ($1, $2, 'A', 'area', 'ft2'), ($3, $4, 'B', 'area', 'ft2')`,
      [takeoffA, workspaceA, takeoffB, workspaceB],
    );
    await admin.query(
      `insert into catalog_item (id, workspace_id, kind, name, unit, unit_cost_cents, sku)
       values ($1, $2, 'material', 'A', 'ton', 100, 'A'),
              ($3, $4, 'material', 'B', 'ton', 100, 'B')`,
      [catalogA, workspaceA, catalogB, workspaceB],
    );
    await admin.query(
      `insert into cost_recipe (id, workspace_id, family_id, name, takeoff_item_id, input_unit)
       values ($1, $2, $1, 'A', $3, 'ft2'), ($4, $5, $4, 'B', $6, 'ft2')`,
      [recipeA, workspaceA, takeoffA, recipeB, workspaceB, takeoffB],
    );
    await admin.query(
      `insert into recipe_component (id, workspace_id, recipe_id, catalog_item_id, qty_formula)
       values ($1, $2, $3, $4, 'qty')`,
      [componentA, workspaceA, recipeA, catalogA],
    );

    const app = await requireApp().connect();
    const auth = createPool(readAuthDatabaseUrl());
    try {
      const unset = await app.query<{ n: number }>("select count(*)::int as n from catalog_item");
      expect(unset.rows[0]?.n).toBe(0);

      await app.query("begin");
      await app.query("select set_config('app.workspace_id', '', true)");
      const blank = await app.query<{ n: number }>("select count(*)::int as n from cost_recipe");
      await app.query("rollback");
      expect(blank.rows[0]?.n).toBe(0);

      await app.query("begin");
      await app.query("select set_config('app.workspace_id', $1, true)", [workspaceA]);
      const seen = await app.query<{ id: string }>(
        "select id::text as id from catalog_item order by id",
      );
      const recipes = await app.query<{ id: string }>(
        "select id::text as id from cost_recipe order by id",
      );
      const components = await app.query<{ id: string }>(
        "select id::text as id from recipe_component",
      );
      await expect(
        app.query(
          `insert into catalog_item (id, workspace_id, kind, name, unit, unit_cost_cents)
           values ($1, $2, 'fee', 'Leak', 'ea', 1)`,
          [createId(), workspaceB],
        ),
      ).rejects.toThrow(/row-level security|new row violates/i);
      await app.query("rollback");

      expect(seen.rows.map((row) => row.id)).toEqual([catalogA]);
      expect(recipes.rows.map((row) => row.id)).toEqual([recipeA]);
      expect(components.rows.map((row) => row.id)).toEqual([componentA]);

      await expect(auth.query("select id from catalog_item")).rejects.toThrow(/permission denied/i);
      await expect(auth.query("select id from takeoff_item")).rejects.toThrow(/permission denied/i);
      await expect(auth.query("select id from cost_recipe")).rejects.toThrow(/permission denied/i);
      await expect(auth.query("select id from recipe_component")).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      app.release();
      await auth.end();
      await admin.query("delete from recipe_component where id = $1", [componentA]);
      await admin.query("delete from cost_recipe where id = any($1::uuid[])", [[recipeA, recipeB]]);
      await admin.query("delete from catalog_item where id = any($1::uuid[])", [
        [catalogA, catalogB],
      ]);
      await admin.query("delete from takeoff_item where id = any($1::uuid[])", [
        [takeoffA, takeoffB],
      ]);
    }
  });
});
