import { createHash } from "node:crypto";

import { createId } from "@groundwork/shared";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readAppDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";

/**
 * Tables that do not have workspace_id NOT NULL, with why they are global.
 * A new table fails this test until it is classified here or given a tenant policy.
 */
const UNCLASSIFIED_REASONS: Record<string, string> = {
  spatial_ref_sys: "PostGIS spatial reference catalog. It is not tenant data.",
  schema_migrations: "Migration ledger. It is not tenant data.",
  event_log: "Webhook and provider event log. Spec 01 gives it no workspace_id.",
  parcel_cache:
    "Parcel vendor cache is global. Vendor rows are not tenant data and are not used for training.",
  app_user: "A person can belong to more than one workspace. Membership is the tenant row.",
  session: "Better Auth sessions are identity rows. groundwork_app cannot read them.",
  account: "Better Auth credentials. groundwork_app cannot read them.",
  verification: "Better Auth verification tokens. groundwork_app cannot read them.",
  workspace: "The workspace row is the tenant. Its primary key is the workspace id.",
  role: "System roles have a null workspace_id. A custom role sets it. ADR 0007.",
  imagery_source:
    "Public-program sources have a null workspace_id. A workspace upload sets it. ADR 0006.",
  imagery_capture:
    "Public-program captures have a null workspace_id. A workspace capture sets it. ADR 0006.",
};

/**
 * Better Auth writes these tenant tables. Product tables are groundwork_app only.
 * Their WITH CHECK may be only the groundwork_auth branch. ADR 0007 and ADR 0023.
 */
const AUTH_GRANT_TABLES = new Set(["member", "invitation"]);

type TableFact = {
  name: string;
  workspaceNotNull: boolean;
  rls: boolean;
  forced: boolean;
  owner: string;
};

let admin: pg.Pool | undefined;
let appPool: pg.Pool | undefined;

beforeAll(async () => {
  await migrate("up");
  admin = createPool(readDatabaseUrl());
  appPool = createPool(readAppDatabaseUrl());
});

afterAll(async () => {
  await appPool?.end();
  await admin?.end();
});

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

describe("schema audit", () => {
  it("forces tenant policies, limits grants, and hides rows when the workspace is unset", async () => {
    const facts = await tableFacts();
    const tenant = facts.filter((fact) => fact.workspaceNotNull).map((fact) => fact.name);
    const other = facts.filter((fact) => !fact.workspaceNotNull).map((fact) => fact.name);

    expect(other.sort()).toEqual(Object.keys(UNCLASSIFIED_REASONS).sort());
    for (const name of other) {
      expect(UNCLASSIFIED_REASONS[name]?.length).toBeGreaterThan(0);
    }

    const workspaceId = createId();
    const probed = await insertProbe(workspaceId);
    expect(probed.sort()).toEqual([...tenant].sort());

    for (const name of tenant) {
      const fact = facts.find((row) => row.name === name);
      expect(fact?.rls, name).toBe(true);
      expect(fact?.forced, name).toBe(true);
      await expectTenantPolicy(name);
      await expectGrants(name, fact?.owner ?? "");
    }

    const client = await requireApp().connect();
    try {
      for (const name of tenant) {
        const hidden = await client.query<{ n: number }>(
          `select count(*)::int as n from ${quote(name)}`,
        );
        expect(hidden.rows[0]?.n, name).toBe(0);
      }
      await client.query("begin");
      await client.query("select set_config('app.proposal_token_hash', '', true)");
      const token = await client.query<{ n: number }>(
        "select count(*)::int as n from proposal_token",
      );
      await client.query("rollback");
      expect(token.rows[0]?.n).toBe(0);
    } finally {
      client.release();
    }
  });

  it("keeps the proposal token lookup select-only", async () => {
    const policies = await requireAdmin().query<{ polname: string; polcmd: string; qual: string }>(
      `select pol.polname,
              pol.polcmd::text as polcmd,
              pg_get_expr(pol.polqual, pol.polrelid) as qual
       from pg_policy pol
       where pol.polrelid = 'proposal_token'::regclass`,
    );
    const lookup = policies.rows.filter((row) => row.qual.includes("app.proposal_token_hash"));
    expect(lookup).toHaveLength(1);
    expect(lookup[0]?.polcmd).toBe("r");
    expect(lookup[0]?.qual).toContain("app.proposal_token_hash");
  });

  it("rejects a write policy that matches a null workspace id", async () => {
    const policies = await requireAdmin().query<{
      table: string;
      name: string;
      cmd: string;
      qual: string | null;
      check: string | null;
    }>(`
      select tablename as table,
             policyname as name,
             cmd,
             qual,
             with_check as check
      from pg_policies
      where schemaname = 'public'
        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    `);
    const offenders = policies.rows.flatMap((policy) => {
      const predicates = writePredicates(policy.cmd, policy.qual, policy.check);
      return predicates
        .filter((predicate) => allowsNullWorkspace(predicate) && !isOperatorWrite(predicate))
        .map((predicate) => `${policy.cmd} ${policy.table}.${policy.name}: ${predicate}`);
    });
    expect(offenders).toEqual([]);
  });

  it("requires WITH CHECK naming app.workspace_id on tenant insert, update, and all policies", async () => {
    expect(
      tenantWriteCheckOk("client", "workspace_id = current_setting('app.workspace_id', true)"),
    ).toBe(true);
    expect(tenantWriteCheckOk("client", "current_user = 'groundwork_auth'")).toBe(false);
    expect(tenantWriteCheckOk("client", null)).toBe(false);
    expect(tenantWriteCheckOk("member", "(CURRENT_USER = 'groundwork_auth'::name)")).toBe(true);
    expect(tenantWriteCheckOk("invitation", "current_user = 'groundwork_auth'")).toBe(true);
    expect(
      tenantWriteCheckOk("member", "current_user = 'groundwork_auth' or workspace_id is null"),
    ).toBe(false);
    expect(
      tenantWriteCheckOk(
        "member",
        "((CURRENT_USER = 'groundwork_auth'::name) OR ((workspace_id)::uuid = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid))",
      ),
    ).toBe(true);

    const policies = await requireAdmin().query<{
      table: string;
      name: string;
      cmd: string;
      check: string | null;
    }>(`
      select c.relname as table,
             pol.polname as name,
             case pol.polcmd
               when 'a' then 'INSERT'
               when 'w' then 'UPDATE'
               when '*' then 'ALL'
             end as cmd,
             pg_get_expr(pol.polwithcheck, pol.polrelid) as check
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and pol.polcmd in ('a', 'w', '*')
        and exists (
          select 1
          from pg_attribute a
          where a.attrelid = c.oid
            and a.attname = 'workspace_id'
            and a.attnotnull
            and not a.attisdropped
        )
    `);
    const offenders = policies.rows
      .filter((policy) => !tenantWriteCheckOk(policy.table, policy.check))
      .map(
        (policy) =>
          `${policy.cmd} ${policy.table}.${policy.name}: ${policy.check ?? "(no WITH CHECK)"}`,
      );
    expect(offenders).toEqual([]);
  });

  it("stores proposal public tokens only as SHA-256 hex columns", async () => {
    const columns = await requireAdmin().query<{ table: string; column: string }>(`
      select c.relname as table, a.attname as column
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('proposal', 'proposal_token')
        and a.attnum > 0
        and not a.attisdropped
        and a.attname ilike '%token%'
      order by 1, 2
    `);
    expect(columns.rows).toEqual([
      { table: "proposal", column: "public_token_hash" },
      { table: "proposal_token", column: "token_hash" },
    ]);

    const checks = await requireAdmin().query<{ definition: string }>(`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where contype = 'c'
        and conrelid in ('proposal'::regclass, 'proposal_token'::regclass)
        and pg_get_constraintdef(oid) ilike '%token_hash%'
    `);
    const definitions = checks.rows.map((row) => row.definition);
    expect(definitions.some((definition) => definition.includes("public_token_hash"))).toBe(true);
    expect(definitions.some((definition) => definition.includes("token_hash"))).toBe(true);
    for (const definition of definitions) {
      expect(definition).toContain("^[0-9a-f]{64}$");
    }
  });

  it("has no security definer function and no bypass on the app roles", async () => {
    const functions = await requireAdmin().query<{ name: string }>(`
      select p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
        and not exists (
          select 1
          from pg_depend d
          where d.objid = p.oid
            and d.classid = 'pg_proc'::regclass
            and d.deptype = 'e'
        )
    `);
    expect(functions.rows).toEqual([]);

    const roles = await requireAdmin().query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `select rolname, rolsuper, rolbypassrls
       from pg_roles
       where rolname in ('groundwork_app', 'groundwork_auth')`,
    );
    expect(roles.rows).toHaveLength(2);
    for (const role of roles.rows) {
      expect(role.rolsuper, role.rolname).toBe(false);
      expect(role.rolbypassrls, role.rolname).toBe(false);
    }
  });
});

async function tableFacts(): Promise<TableFact[]> {
  const result = await requireAdmin().query<{
    name: string;
    workspace_not_null: boolean;
    rls: boolean;
    forced: boolean;
    owner: string;
  }>(`
    select c.relname as name,
           exists (
             select 1
             from pg_attribute a
             where a.attrelid = c.oid
               and a.attname = 'workspace_id'
               and a.attnotnull
               and not a.attisdropped
           ) as workspace_not_null,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as forced,
           pg_get_userbyid(c.relowner) as owner
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  `);
  return result.rows.map((row) => ({
    name: row.name,
    workspaceNotNull: row.workspace_not_null,
    rls: row.rls,
    forced: row.forced,
    owner: row.owner,
  }));
}

async function expectTenantPolicy(table: string): Promise<void> {
  const policies = await requireAdmin().query<{ qual: string | null; check: string | null }>(
    `select pg_get_expr(pol.polqual, pol.polrelid) as qual,
            pg_get_expr(pol.polwithcheck, pol.polrelid) as check
     from pg_policy pol
     where pol.polrelid = $1::regclass`,
    [`public.${table}`],
  );
  const matches = policies.rows.some(
    (row) =>
      (row.qual ?? "").includes("app.workspace_id") ||
      (row.check ?? "").includes("app.workspace_id"),
  );
  expect(matches, table).toBe(true);
}

async function expectGrants(table: string, owner: string): Promise<void> {
  const grants = await requireAdmin().query<{ grantee: string }>(
    `select grantee
     from information_schema.role_table_grants
     where table_schema = 'public' and table_name = $1`,
    [table],
  );
  const grantees = new Set(grants.rows.map((row) => row.grantee));
  expect(grantees.has("PUBLIC"), table).toBe(false);
  expect(grantees.has("groundwork_app"), table).toBe(true);
  const allowed = new Set([owner, "groundwork_app"]);
  if (AUTH_GRANT_TABLES.has(table)) {
    allowed.add("groundwork_auth");
    expect(grantees.has("groundwork_auth"), table).toBe(true);
  }
  for (const grantee of grantees) {
    expect(allowed.has(grantee), `${table} grants ${grantee}`).toBe(true);
  }
}

function writePredicates(cmd: string, qual: string | null, check: string | null): string[] {
  if (cmd === "INSERT") {
    return check ? [check] : [];
  }
  if (cmd === "DELETE") {
    return qual ? [qual] : [];
  }
  return [qual, check].filter((predicate): predicate is string => predicate !== null);
}

function allowsNullWorkspace(predicate: string): boolean {
  const withoutNegation = predicate.replace(/workspace_id\s+is\s+not\s+null/gi, "");
  return /workspace_id\s+is\s+null/i.test(withoutNegation);
}

function isOperatorWrite(predicate: string): boolean {
  return predicate.includes("app.platform_operator");
}

function tenantWriteCheckOk(table: string, check: string | null): boolean {
  if (check?.includes("app.workspace_id")) {
    return true;
  }
  return AUTH_GRANT_TABLES.has(table) && isGroundworkAuthBranch(check);
}

function isGroundworkAuthBranch(check: string | null): boolean {
  if (!check) {
    return false;
  }
  const normalized = check.toLowerCase().replaceAll("::name", "");
  if (!normalized.includes("current_user = 'groundwork_auth'")) {
    return false;
  }
  const rest = normalized
    .replaceAll("current_user = 'groundwork_auth'", "")
    .replace(/\bor\b/g, "")
    .replace(/[()\s]/g, "");
  return rest.length === 0;
}

function quote(name: string): string {
  if (!/^[a-z_]+$/.test(name)) {
    throw new Error(`Refusing to query ${name}.`);
  }
  return name;
}

async function insertProbe(workspaceId: string): Promise<string[]> {
  const pool = requireAdmin();
  const userId = createId();
  const memberId = createId();
  const invitationId = createId();
  const fileId = createId();
  const clientId = createId();
  const contactId = createId();
  const locationId = createId();
  const jobId = createId();
  const takeoffItemId = createId();
  const catalogId = createId();
  const recipeId = createId();
  const takeoffId = createId();
  const estimateId = createId();
  const proposalId = createId();
  const templateId = createId();
  const sourceId = createId();
  const captureId = createId();
  const token = createHash("sha256").update(proposalId).digest("hex");
  const ring = "MULTIPOLYGON(((0 0, 0.001 0, 0.001 0.001, 0 0.001, 0 0)))";
  const role = await pool.query<{ id: string }>(
    `select id from "role" where name = 'owner' and is_system and workspace_id is null`,
  );
  const roleId = role.rows[0]?.id;
  if (!roleId) {
    throw new Error("The owner system role is missing.");
  }

  await pool.query(`insert into app_user (id, name, email) values ($1, 'Probe', $2)`, [
    userId,
    `${userId}@example.com`,
  ]);
  await pool.query(`insert into workspace (id, name, slug) values ($1, 'Probe', $2)`, [
    workspaceId,
    `probe-${workspaceId}`,
  ]);
  await pool.query(
    `insert into member (id, workspace_id, user_id, role, role_id, status)
     values ($1, $2, $3, 'owner', $4, 'active')`,
    [memberId, workspaceId, userId, roleId],
  );
  await pool.query(
    `insert into invitation (id, workspace_id, email, role, status, expires_at, inviter_id)
     values ($1, $2, $3, 'crew', 'pending', now() + interval '1 day', $4)`,
    [invitationId, workspaceId, `${invitationId}@example.com`, userId],
  );
  await pool.query(
    `insert into counters (id, workspace_id, prefix, last_value) values ($1, $2, 'J', 1)`,
    [createId(), workspaceId],
  );
  await pool.query(
    `insert into file (id, workspace_id, storage_key, status) values ($1, $2, $3, 'ready')`,
    [fileId, workspaceId, `workspaces/${workspaceId}/${fileId}`],
  );
  await pool.query(`insert into audit_log (workspace_id, action) values ($1, 'probe')`, [
    workspaceId,
  ]);
  await pool.query(`insert into usage_event (workspace_id, kind) values ($1, 'probe')`, [
    workspaceId,
  ]);
  await pool.query(
    `insert into client (id, workspace_id, type, name) values ($1, $2, 'residential', 'Probe')`,
    [clientId, workspaceId],
  );
  await pool.query(
    `insert into contact (id, workspace_id, client_id, name) values ($1, $2, $3, 'Probe')`,
    [contactId, workspaceId, clientId],
  );
  await pool.query(
    `insert into location (id, workspace_id, client_id, address) values ($1, $2, $3, '{"line1":"1 Probe"}'::jsonb)`,
    [locationId, workspaceId, clientId],
  );
  await pool.query(
    `insert into job (id, workspace_id, number, client_id, location_id, name, stage)
     values ($1, $2, 'J-9', $3, $4, 'Probe', 'lead')`,
    [jobId, workspaceId, clientId, locationId],
  );
  await pool.query(
    `insert into job_note (id, workspace_id, job_id, body) values ($1, $2, $3, 'Probe')`,
    [createId(), workspaceId, jobId],
  );
  await pool.query(
    `insert into job_task (id, workspace_id, job_id, title) values ($1, $2, $3, 'Probe')`,
    [createId(), workspaceId, jobId],
  );
  await pool.query(
    `insert into job_file (id, workspace_id, job_id, file_id) values ($1, $2, $3, $4)`,
    [createId(), workspaceId, jobId, fileId],
  );
  await pool.query(
    `insert into takeoff_item (id, workspace_id, name, measure_kind, default_unit)
     values ($1, $2, 'Probe', 'area', 'ft2')`,
    [takeoffItemId, workspaceId],
  );
  await pool.query(
    `insert into catalog_item (id, workspace_id, kind, name, unit, unit_cost_cents, unit_price_cents)
     values ($1, $2, 'material', 'Probe', 'ton', 1, 2)`,
    [catalogId, workspaceId],
  );
  await pool.query(
    `insert into cost_recipe (id, workspace_id, family_id, name, input_unit, version, status)
     values ($1, $2, $1, 'Probe', 'ft2', 1, 'draft')`,
    [recipeId, workspaceId],
  );
  await pool.query(
    `insert into recipe_component (id, workspace_id, recipe_id, catalog_item_id, qty_formula)
     values ($1, $2, $3, $4, '1')`,
    [createId(), workspaceId, recipeId, catalogId],
  );
  await pool.query(
    `insert into takeoff (id, workspace_id, job_id, location_id, lineage_id, kind, status, version)
     values ($1, $2, $3, $4, $1, 'planset', 'draft', 1)`,
    [takeoffId, workspaceId, jobId, locationId],
  );
  await pool.query(
    `insert into measurement (
       id, workspace_id, takeoff_id, takeoff_item_id, kind, geom, value_m2, source
     ) values (
       $1, $2, $3, $4, 'area',
       ST_SetSRID(ST_GeomFromText('POLYGON((0 0, 0.001 0, 0.001 0.001, 0 0.001, 0 0))'), 4326),
       1, 'manual'
     )`,
    [createId(), workspaceId, takeoffId, takeoffItemId],
  );
  await pool.query(
    `insert into estimate (id, workspace_id, job_id, takeoff_id, number, version, status)
     values ($1, $2, $3, $4, 'E-9', 1, 'draft')`,
    [estimateId, workspaceId, jobId, takeoffId],
  );
  await pool.query(
    `insert into line_item (
       id, workspace_id, estimate_id, description, qty, unit,
       unit_cost_cents, unit_price_cents, cost_cents, price_cents, source
     ) values ($1, $2, $3, 'Probe', 1, 'ea', 0, 0, 0, 0, 'manual')`,
    [createId(), workspaceId, estimateId],
  );
  await pool.query(
    `insert into detection_run (id, workspace_id, takeoff_id, mode, status, idempotency_key, request_hash)
     values ($1, $2, $3, 'assist', 'queued', $5, $4)`,
    [createId(), workspaceId, takeoffId, "c".repeat(64), createId()],
  );
  const run = await pool.query<{ id: string }>(
    `select id::text as id from detection_run where workspace_id = $1 limit 1`,
    [workspaceId],
  );
  await pool.query(
    `insert into detection_feature (id, workspace_id, run_id, geom)
     values ($1, $2, $3, ST_SetSRID(ST_GeomFromText('POLYGON((0 0, 0.001 0, 0.001 0.001, 0 0.001, 0 0))'), 4326))`,
    [createId(), workspaceId, run.rows[0]?.id],
  );
  await pool.query(
    `insert into proposal_template (id, workspace_id, name) values ($1, $2, 'Probe')`,
    [templateId, workspaceId],
  );
  await pool.query(
    `insert into proposal (
       id, workspace_id, estimate_id, template_id, number, public_token_hash, estimate_version, snapshot
     ) values ($1, $2, $3, $4, 'P-9', $5, 1, '{"lines":[]}'::jsonb)`,
    [proposalId, workspaceId, estimateId, templateId, token],
  );
  await pool.query(
    `insert into signature (id, workspace_id, proposal_id, signer_name) values ($1, $2, $3, 'Probe')`,
    [createId(), workspaceId, proposalId],
  );
  await pool.query(
    `insert into proposal_token (token_hash, workspace_id, proposal_id) values ($1, $2, $3)`,
    [token, workspaceId, proposalId],
  );
  await pool.query(
    `insert into work_order (id, workspace_id, job_id, estimate_id, proposal_id, title)
     values ($1, $2, $3, $4, $5, 'Probe')`,
    [createId(), workspaceId, jobId, estimateId, proposalId],
  );
  await pool.query(
    `insert into imagery_source (id, workspace_id, provider, name, bands)
     values ($1, $2, 'other', 'Probe', 'RGB')`,
    [sourceId, workspaceId],
  );
  await pool.query(
    `insert into imagery_capture (
       id, workspace_id, source_id, coverage, capture_date, gsd_cm, bands, leaf, status
     ) values (
       $1, $2, $3, ST_SetSRID(ST_GeomFromText($4), 4326), '2024-01-01', 10, 'RGB', 'unknown', 'failed'
     )`,
    [captureId, workspaceId, sourceId, ring],
  );
  await pool.query(
    `insert into imagery_ingest_job (
       id, workspace_id, source_id, capture_id, county_fips, year, idempotency_key, request_hash, status
     ) values ($1, $2, $3, $4, '37023', 2024, $6, $5, 'failed')`,
    [createId(), workspaceId, sourceId, captureId, "d".repeat(64), createId()],
  );

  return [
    "counters",
    "file",
    "audit_log",
    "usage_event",
    "member",
    "invitation",
    "client",
    "contact",
    "location",
    "job",
    "job_note",
    "job_task",
    "job_file",
    "takeoff_item",
    "catalog_item",
    "cost_recipe",
    "recipe_component",
    "takeoff",
    "measurement",
    "estimate",
    "line_item",
    "detection_run",
    "detection_feature",
    "proposal_template",
    "proposal",
    "signature",
    "proposal_token",
    "work_order",
    "imagery_ingest_job",
  ];
}
