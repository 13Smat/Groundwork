import { createId } from "@groundwork/shared";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Mailer } from "../src/auth/mail.js";
import { buildApp } from "../src/app.js";
import { readAppDatabaseUrl, readAuthDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { readOpenApi } from "../src/openapi/document.js";
import { buildUrl, fillTokens, planTenantSweep } from "../src/openapi/sweep.js";
import { TENANT_FIXTURES } from "../src/openapi/tenant-fixtures.js";

const PASSWORD = "correct-horse-battery";
const BROWSER = { origin: "http://127.0.0.1:5173", host: "127.0.0.1:5173" };
const BBOX =
  "MULTIPOLYGON(((-81.95 35.52, -81.40 35.52, -81.40 35.99, -81.95 35.99, -81.95 35.52)))";

describe("cross-tenant contract", () => {
  let app: FastifyInstance;
  let admin!: pg.Pool;
  const pools: pg.Pool[] = [];
  const mailer: Mailer = { async send() {} };

  beforeAll(async () => {
    await migrate("up");
    const database = {
      app: createPool(readAppDatabaseUrl()),
      auth: createPool(readAuthDatabaseUrl()),
    };
    admin = createPool(readDatabaseUrl());
    pools.push(database.app, database.auth, admin);
    app = await buildApp({ logger: false, database, mailer });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await Promise.all(pools.map((pool) => pool.end()));
  });

  it("returns 404 for every tenant operation that names another workspace's resource", async () => {
    const plan = planTenantSweep(readOpenApi(), TENANT_FIXTURES);
    expect(plan.problems).toEqual([]);
    expect(plan.calls.length).toBeGreaterThan(0);

    const owner = await signUp("owner");
    const other = await signUp("other");
    const home = await createWorkspace(owner.cookie, "Home");
    const away = await createWorkspace(other.cookie, "Away");
    const ids = await seedAway(other.cookie, away.id);

    const failures: string[] = [];
    for (const call of plan.calls) {
      const response = await app.inject({
        method: call.method.toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        url: buildUrl(call.path, call.fixture, ids),
        headers: {
          cookie: owner.cookie,
          "x-workspace-id": home.id,
          ...BROWSER,
          ...(call.fixture.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        payload: fillTokens(call.fixture.body, ids) as object | undefined,
      });
      if (response.statusCode !== 404) {
        failures.push(`${call.method} ${call.path} -> ${response.statusCode} ${response.body}`);
      } else if (!response.headers["content-type"]?.includes("application/problem+json")) {
        failures.push(`${call.method} ${call.path} -> ${response.headers["content-type"]}`);
      }
    }
    expect(failures).toEqual([]);

    const listed = await send("GET", "/admin/imagery-sources", owner.cookie, home.id);
    const listedIds = JSON.stringify(listed.body);
    expect(listedIds).not.toContain(ids.imagerySource);
    expect(listedIds).not.toContain(ids.capture);
    const sources = (
      listed.body as {
        sources: Array<{ id: string; workspaceId: string | null; notes: string | null }>;
      }
    ).sources;
    const globalSource = sources.find((source) => source.workspaceId === null);
    expect(globalSource).toBeTruthy();
    const before = await admin.query<{ notes: string | null }>(
      "select notes from imagery_source where id = $1",
      [globalSource?.id],
    );
    const patched = await app.inject({
      method: "PATCH",
      url: `/admin/imagery-sources/${globalSource?.id}`,
      headers: {
        cookie: owner.cookie,
        "x-workspace-id": home.id,
        "content-type": "application/json",
        ...BROWSER,
      },
      payload: { notes: "tenant-owned-global" },
    });
    expect(patched.statusCode).toBe(404);
    const after = await admin.query<{ notes: string | null }>(
      "select notes from imagery_source where id = $1",
      [globalSource?.id],
    );
    expect(after.rows[0]?.notes).toBe(before.rows[0]?.notes);

    const created = await send("POST", "/admin/imagery-sources", owner.cookie, home.id, {
      provider: "other",
      name: `Tenant source ${createId()}`,
      bands: "RGB",
      allowsTracing: false,
      allowsMlTraining: false,
    });
    const createdSource = created.body as { id: string; workspaceId: string | null; name: string };
    expect(createdSource.workspaceId).toBe(home.id);
    const globals = await admin.query<{ n: number }>(
      "select count(*)::int as n from imagery_source where name = $1 and workspace_id is null",
      [createdSource.name],
    );
    expect(globals.rows[0]?.n).toBe(0);
  }, 120_000);

  async function seedAway(cookie: string, workspaceId: string): Promise<Record<string, string>> {
    const me = await send("GET", "/me", cookie, workspaceId);
    const memberId = (
      me.body as { memberships: Array<{ workspace_id: string; id: string }> }
    ).memberships.find((row) => row.workspace_id === workspaceId)?.id;
    const roles = await send("GET", "/roles", cookie, workspaceId);
    const roleId = (roles.body as { roles: Array<{ id: string; name: string }> }).roles.find(
      (role) => role.name === "owner",
    )?.id;
    const client = await send("POST", "/clients", cookie, workspaceId, {
      type: "residential",
      name: "Away",
    });
    const clientId = idOf(client.body);
    const contact = await send("POST", `/clients/${clientId}/contacts`, cookie, workspaceId, {
      name: "Away",
    });
    const location = await send("POST", "/locations", cookie, workspaceId, {
      client_id: clientId,
      address: { line1: "1 Away St" },
    });
    const locationId = idOf(location.body);
    const job = await send("POST", "/jobs", cookie, workspaceId, {
      client_id: clientId,
      location_id: locationId,
      name: "Away job",
    });
    const jobId = idOf(job.body);
    const catalog = await send("POST", "/catalog-items", cookie, workspaceId, {
      kind: "material",
      name: "Away stone",
      unit: "ton",
      unit_cost_cents: 1,
      unit_price_cents: 2,
    });
    const takeoffItem = await send("POST", "/takeoff-items", cookie, workspaceId, {
      name: "Away area",
      measure_kind: "area",
      default_unit: "ft2",
    });
    const recipe = await send("POST", "/cost-recipes", cookie, workspaceId, {
      name: "Away recipe",
      input_unit: "ft2",
    });
    const template = await send("POST", "/proposal-templates", cookie, workspaceId, {
      name: "Away template",
    });
    const takeoff = await send("POST", `/jobs/${jobId}/takeoffs`, cookie, workspaceId, {
      kind: "planset",
    });
    const takeoffId = idOf(takeoff.body);
    const estimate = await send("POST", `/jobs/${jobId}/estimates`, cookie, workspaceId, {});
    const estimateId = idOf(estimate.body);
    const lined = await send("POST", `/estimates/${estimateId}/lines`, cookie, workspaceId, {
      description: "Away line",
      qty: "1",
      unit: "ea",
      unit_price_cents: 100,
    });
    const lineId = (lined.body as { lines: Array<{ id: string }> }).lines[0]?.id;
    await send("POST", `/estimates/${estimateId}/transition`, cookie, workspaceId, { to: "ready" });
    const proposal = await send(
      "POST",
      `/estimates/${estimateId}/proposals`,
      cookie,
      workspaceId,
      {},
    );
    const imagery = await insertImagery(workspaceId, takeoffId);
    if (!memberId || !roleId || !lineId) {
      throw new Error("Away workspace is missing a member, role, or line.");
    }
    return {
      workspace: workspaceId,
      member: memberId,
      role: roleId,
      client: clientId,
      contact: idOf(contact.body),
      location: locationId,
      job: jobId,
      catalogItem: idOf(catalog.body),
      takeoffItem: idOf(takeoffItem.body),
      recipe: idOf(recipe.body),
      proposalTemplate: idOf(template.body),
      takeoff: takeoffId,
      measurement: imagery.measurementId,
      estimate: estimateId,
      lineItem: lineId,
      proposal: idOf(proposal.body),
      detection: imagery.detectionId,
      imagerySource: imagery.sourceId,
      ingestJob: imagery.ingestId,
      capture: imagery.captureId,
    };
  }

  async function insertImagery(workspaceId: string, takeoffId: string) {
    const query = admin.query.bind(admin);
    const sourceId = createId();
    const captureId = createId();
    const ingestId = createId();
    const detectionId = createId();
    const measurementId = createId();
    const item = await query(
      `select id::text as id from takeoff_item where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    const itemId = item.rows[0]?.id;
    if (!itemId) {
      throw new Error("Away takeoff item is missing.");
    }
    await query(
      `insert into imagery_source (id, workspace_id, provider, name, bands)
       values ($1, $2, 'other', 'Away source', 'RGB')`,
      [sourceId, workspaceId],
    );
    await query(
      `insert into imagery_capture (
         id, workspace_id, source_id, coverage, capture_date, gsd_cm, bands, leaf, status
       ) values (
         $1, $2, $3, ST_SetSRID(ST_GeomFromText($4), 4326), '2024-01-01', 10, 'RGB', 'unknown', 'failed'
       )`,
      [captureId, workspaceId, sourceId, BBOX],
    );
    await query(
      `insert into imagery_ingest_job (
         id, workspace_id, source_id, capture_id, county_fips, year, idempotency_key, request_hash, status
       ) values ($1, $2, $3, $4, '37023', 2024, $5, $6, 'failed')`,
      [ingestId, workspaceId, sourceId, captureId, ingestId, "a".repeat(64)],
    );
    await query(
      `insert into detection_run (id, workspace_id, takeoff_id, mode, status, idempotency_key, request_hash)
       values ($1, $2, $3, 'assist', 'queued', $4, $5)`,
      [detectionId, workspaceId, takeoffId, detectionId, "b".repeat(64)],
    );
    await query(
      `insert into measurement (
         id, workspace_id, takeoff_id, takeoff_item_id, kind, geom, value_m2, source
       ) values (
         $1, $2, $3, $4, 'area',
         ST_SetSRID(ST_GeomFromText('POLYGON((-81.7 35.7, -81.6 35.7, -81.6 35.8, -81.7 35.8, -81.7 35.7))'), 4326),
         1, 'manual'
       )`,
      [measurementId, workspaceId, takeoffId, itemId],
    );
    return { sourceId, captureId, ingestId, detectionId, measurementId };
  }

  async function send(
    method: string,
    url: string,
    cookie: string,
    workspaceId: string,
    payload?: unknown,
  ) {
    const response = await app.inject({
      method: method as "GET",
      url,
      headers: {
        cookie,
        "x-workspace-id": workspaceId,
        ...BROWSER,
        ...(payload !== undefined ? { "content-type": "application/json" } : {}),
      },
      payload: payload as object | undefined,
    });
    if (response.statusCode >= 400) {
      throw new Error(`${method} ${url} -> ${response.statusCode} ${response.body}`);
    }
    return { status: response.statusCode, body: response.json() as unknown };
  }

  async function signUp(label: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/sign-up/email",
      headers: { "content-type": "application/json", ...BROWSER },
      payload: {
        name: label,
        email: `${label}-${createId()}@example.com`,
        password: PASSWORD,
      },
    });
    if (response.statusCode !== 200) {
      throw new Error(response.body);
    }
    const cookie = response.headers["set-cookie"];
    if (!cookie) {
      throw new Error("Sign-up did not set a cookie.");
    }
    return { cookie: Array.isArray(cookie) ? cookie.join("; ") : cookie };
  }

  async function createWorkspace(cookie: string, name: string) {
    const response = await app.inject({
      method: "POST",
      url: "/workspaces",
      headers: { cookie, "content-type": "application/json", ...BROWSER },
      payload: { name },
    });
    if (response.statusCode !== 201) {
      throw new Error(response.body);
    }
    return response.json() as { id: string };
  }
});

function idOf(body: unknown): string {
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string") {
    throw new Error("Response did not include an id.");
  }
  return body.id;
}
