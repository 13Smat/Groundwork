import { geodesicRectangle, type GeoJsonGeometry } from "@groundwork/geo";
import { createId } from "@groundwork/shared";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Mailer } from "../src/auth/mail.js";
import { buildApp } from "../src/app.js";
import { readAppDatabaseUrl, readAuthDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";

const PASSWORD = "correct-horse-battery";
const BROWSER = {
  origin: "http://127.0.0.1:5173",
  host: "127.0.0.1:5173",
};
const HELENE = "018f5a00-0000-7000-8000-000000000101";

type Session = { cookie: string; email: string };
type MeasurementFeature = {
  id: string;
  geometry: GeoJsonGeometry;
  properties: {
    source: string;
    value_m2: string | null;
    confidence: number | null;
    takeoff_item_id: string;
  };
};

let app: FastifyInstance | undefined;
let admin: pg.Pool | undefined;
let pools: pg.Pool[] = [];
let owner: Session;
let workspaceId: string;

const mailer: Mailer = {
  async send() {
    return undefined;
  },
};

beforeAll(async () => {
  await migrate("up");
  admin = createPool(readDatabaseUrl());
  const appPool = createPool(readAppDatabaseUrl());
  const authPool = createPool(readAuthDatabaseUrl());
  pools = [appPool, authPool];
  app = await buildApp({
    logger: false,
    database: { app: appPool, auth: authPool },
    mailer,
  });
  owner = await signUp("Review Owner");
  workspaceId = (await createWorkspace(owner.cookie, "Review Co")).id;
});

afterAll(async () => {
  delete process.env.GROUNDWORK_AI_ASSIST;
  await app?.close();
  await Promise.all(pools.map((pool) => pool.end()));
  await admin?.end();
});

function requireApp(): FastifyInstance {
  if (!app) {
    throw new Error("The API is not running.");
  }
  return app;
}

function requireAdmin(): pg.Pool {
  if (!admin) {
    throw new Error("Admin pool is not connected.");
  }
  return admin;
}

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const parts = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const cookie = parts.map((part) => String(part).split(";")[0]).join("; ");
  if (!cookie) {
    throw new Error("The response did not set a session cookie.");
  }
  return cookie;
}

async function signUp(name: string): Promise<Session> {
  const email = `${createId()}@example.com`;
  const response = await requireApp().inject({
    method: "POST",
    url: "/auth/sign-up/email",
    headers: { ...BROWSER, "content-type": "application/json" },
    payload: { name, email, password: PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: cookieFrom(response), email };
}

async function createWorkspace(cookie: string, name: string): Promise<{ id: string }> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/workspaces",
    headers: { ...BROWSER, cookie, "content-type": "application/json" },
    payload: { name },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}

function headers(cookie: string, workspace = workspaceId): Record<string, string> {
  return {
    ...BROWSER,
    cookie,
    "x-workspace-id": workspace,
    "content-type": "application/json",
  };
}

async function setFlags(envOn: boolean, workspaceOn: boolean): Promise<void> {
  if (envOn) {
    process.env.GROUNDWORK_AI_ASSIST = "1";
  } else {
    delete process.env.GROUNDWORK_AI_ASSIST;
  }
  const response = await requireApp().inject({
    method: "PATCH",
    url: `/workspaces/${workspaceId}`,
    headers: headers(owner.cookie),
    payload: { features: workspaceOn ? { ai_assist: true } : {} },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function createJob(): Promise<{ id: string; location_id: string }> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/jobs",
    headers: headers(owner.cookie),
    payload: {
      name: "Lot",
      client: { name: "Ada", type: "residential" },
      address: "100 Main St, Morganton, NC 28655",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}

async function createItem(kind: "area" | "length" = "area"): Promise<string> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/takeoff-items",
    headers: headers(owner.cookie),
    payload: {
      name: `Pad ${createId().slice(0, 8)}`,
      measure_kind: kind,
      default_unit: kind === "area" ? "ft2" : "ft",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

async function createTakeoff(jobId: string, locationId: string): Promise<string> {
  const response = await requireApp().inject({
    method: "POST",
    url: `/jobs/${jobId}/takeoffs`,
    headers: headers(owner.cookie),
    payload: { kind: "aerial", location_id: locationId, imagery_capture_id: HELENE },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

function square(originLng: number, originLat: number, sizeM: number): GeoJsonGeometry {
  return geodesicRectangle({
    origin: [originLng, originLat],
    widthM: sizeM,
    heightM: sizeM,
  });
}

async function putManual(
  takeoffId: string,
  itemId: string,
  geom: GeoJsonGeometry,
): Promise<MeasurementFeature> {
  const id = createId();
  const response = await requireApp().inject({
    method: "PUT",
    url: `/takeoffs/${takeoffId}/measurements`,
    headers: headers(owner.cookie),
    payload: {
      features: [
        {
          id,
          takeoff_item_id: itemId,
          kind: "area",
          geom,
          source: "manual",
        },
      ],
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  const feature = response.json().features.find((item: MeasurementFeature) => item.id === id);
  expect(feature).toBeDefined();
  return feature as MeasurementFeature;
}

async function insertRun(
  takeoffId: string,
  itemId: string,
  geoms: GeoJsonGeometry[],
  score: number | null = 0.5,
): Promise<{ runId: string; featureIds: string[] }> {
  const runId = createId();
  const featureIds = geoms.map(() => createId());
  await requireAdmin().query(
    `insert into detection_run (
       id, workspace_id, takeoff_id, imagery_capture_id, mode, status,
       idempotency_key, request_hash
     ) values ($1, $2, $3, $4, 'assist', 'succeeded', $5, $6)`,
    [runId, workspaceId, takeoffId, HELENE, `review-${runId}`, "a".repeat(64)],
  );
  for (const [index, geom] of geoms.entries()) {
    await requireAdmin().query(
      `insert into detection_feature (
         id, workspace_id, run_id, geom, score, takeoff_item_id
       ) values (
         $1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), $5, $6
       )`,
      [featureIds[index], workspaceId, runId, JSON.stringify(geom), score, itemId],
    );
  }
  return { runId, featureIds };
}

async function measurements(takeoffId: string): Promise<MeasurementFeature[]> {
  const response = await requireApp().inject({
    method: "GET",
    url: `/takeoffs/${takeoffId}/measurements`,
    headers: headers(owner.cookie),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().features as MeasurementFeature[];
}

describe("assist draft review", () => {
  it("stays off until the env flag and the workspace feature are both on", async () => {
    const job = await createJob();
    const takeoffId = await createTakeoff(job.id, job.location_id);
    const itemId = await createItem();
    const { runId } = await insertRun(takeoffId, itemId, [square(-81.7, 35.74, 12)]);
    await setFlags(false, true);
    const envOff = await requireApp().inject({
      method: "POST",
      url: `/detections/${runId}/accept`,
      headers: headers(owner.cookie),
      payload: { all: true },
    });
    expect(envOff.statusCode, envOff.body).toBe(403);
    expect(envOff.json().detail).toBe("AI assist is turned off.");

    await setFlags(true, false);
    const featureOff = await requireApp().inject({
      method: "POST",
      url: `/detections/${runId}/accept`,
      headers: headers(owner.cookie),
      payload: { all: true },
    });
    expect(featureOff.statusCode, featureOff.body).toBe(403);
    expect(featureOff.json().detail).toBe("AI assist is not enabled for this workspace.");
    const rows = await measurements(takeoffId);
    expect(rows).toHaveLength(0);
  });

  it("accepts every draft, keeps manual measurements, and flags the overlap", async () => {
    await setFlags(true, true);
    const job = await createJob();
    const takeoffId = await createTakeoff(job.id, job.location_id);
    const itemId = await createItem();
    const geom = square(-81.702, 35.748, 18);
    const manual = await putManual(takeoffId, itemId, geom);
    const { runId, featureIds } = await insertRun(takeoffId, itemId, [geom], 0.42);
    const accepted = await requireApp().inject({
      method: "POST",
      url: `/detections/${runId}/accept`,
      headers: headers(owner.cookie),
      payload: { all: true },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const body = accepted.json();
    expect(body.status).toBe("accepted_all");
    expect(body.accepted_feature_ids).toEqual(featureIds);
    expect(body.rejected_feature_ids).toEqual([]);
    expect(body.measurements).toHaveLength(1);
    expect(body.measurements[0].properties.source).toBe("ai_assist");
    expect(body.measurements[0].properties.confidence).toBeCloseTo(0.42);
    expect(body.measurements[0].id).not.toBe(manual.id);

    const rows = await measurements(takeoffId);
    expect(rows).toHaveLength(2);
    const kept = rows.find((feature) => feature.id === manual.id);
    const assist = rows.find((feature) => feature.properties.source === "ai_assist");
    expect(kept?.properties.source).toBe("manual");
    expect(kept?.properties.value_m2).toBe(manual.properties.value_m2);
    expect(JSON.stringify(kept?.geometry)).toBe(JSON.stringify(manual.geometry));
    expect(assist?.properties.takeoff_item_id).toBe(itemId);

    const summary = await requireApp().inject({
      method: "GET",
      url: `/takeoffs/${takeoffId}/summary`,
      headers: headers(owner.cookie),
    });
    expect(summary.statusCode, summary.body).toBe(200);
    const item = summary
      .json()
      .items.find((entry: { takeoff_item_id: string }) => entry.takeoff_item_id === itemId);
    expect(item.overlap_count).toBeGreaterThan(0);

    const linked = await requireAdmin().query<{ status: string; measurement_id: string }>(
      `select r.status, f.accepted_measurement_id::text as measurement_id
       from detection_run r
       join detection_feature f on f.run_id = r.id
       where r.id = $1`,
      [runId],
    );
    expect(linked.rows[0]?.status).toBe("accepted_all");
    expect(linked.rows[0]?.measurement_id).toBe(assist?.id);

    const audit = await requireAdmin().query<{
      action: string;
      diff: { measurement_ids: string[] };
    }>(
      `select action, diff
       from audit_log
       where entity_type = 'detection_run' and entity_id = $1`,
      [runId],
    );
    expect(audit.rows.map((row) => row.action)).toContain("accept");
    expect(audit.rows[0]?.diff.measurement_ids).toEqual([assist?.id]);

    const again = await requireApp().inject({
      method: "POST",
      url: `/detections/${runId}/accept`,
      headers: headers(owner.cookie),
      payload: { all: true },
    });
    expect(again.statusCode, again.body).toBe(409);
    expect(await measurements(takeoffId)).toHaveLength(2);
  });

  it("accepts a subset as accepted_partial and rejects the rest without deleting them", async () => {
    await setFlags(true, true);
    const job = await createJob();
    const takeoffId = await createTakeoff(job.id, job.location_id);
    const itemId = await createItem();
    const { runId, featureIds } = await insertRun(takeoffId, itemId, [
      square(-81.7, 35.74, 10),
      square(-81.699, 35.749, 10),
    ]);
    const first = featureIds[0];
    const second = featureIds[1];
    const accepted = await requireApp().inject({
      method: "POST",
      url: `/detections/${runId}/accept`,
      headers: headers(owner.cookie),
      payload: { feature_ids: [first] },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().status).toBe("accepted_partial");
    expect(accepted.json().accepted_feature_ids).toEqual([first]);
    expect(accepted.json().rejected_feature_ids).toEqual([second]);
    const rows = await measurements(takeoffId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.properties.source).toBe("ai_assist");
    const leftover = await requireAdmin().query<{ measurement_id: string | null }>(
      "select accepted_measurement_id::text as measurement_id from detection_feature where id = $1",
      [second],
    );
    expect(leftover.rows[0]?.measurement_id).toBeNull();
  });

  it("discards every draft and does not insert a measurement", async () => {
    await setFlags(true, true);
    const job = await createJob();
    const takeoffId = await createTakeoff(job.id, job.location_id);
    const itemId = await createItem();
    const manual = await putManual(takeoffId, itemId, square(-81.703, 35.747, 8));
    const { runId } = await insertRun(takeoffId, itemId, [square(-81.701, 35.749, 8)]);
    const rejected = await requireApp().inject({
      method: "POST",
      url: `/detections/${runId}/reject`,
      headers: headers(owner.cookie),
      payload: { all: true },
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json().status).toBe("accepted_partial");
    expect(rejected.json().measurements).toEqual([]);
    const rows = await measurements(takeoffId);
    expect(rows.map((feature) => feature.id)).toEqual([manual.id]);
    const audit = await requireAdmin().query<{ action: string }>(
      `select action from audit_log
       where entity_type = 'detection_run' and entity_id = $1`,
      [runId],
    );
    expect(audit.rows.map((row) => row.action)).toContain("reject");
    const view = await requireApp().inject({
      method: "GET",
      url: `/detections/${runId}`,
      headers: headers(owner.cookie),
    });
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json().status).toBe("accepted_partial");
    expect(view.json().features).toHaveLength(1);
  });

  it("does not let another workspace read or accept the run", async () => {
    await setFlags(true, true);
    const job = await createJob();
    const takeoffId = await createTakeoff(job.id, job.location_id);
    const itemId = await createItem();
    const { runId } = await insertRun(takeoffId, itemId, [square(-81.7, 35.74, 9)]);
    const other = await signUp("Other Review");
    const otherWorkspace = await createWorkspace(other.cookie, "Other Review Co");
    const flagged = await requireApp().inject({
      method: "PATCH",
      url: `/workspaces/${otherWorkspace.id}`,
      headers: headers(other.cookie, otherWorkspace.id),
      payload: { features: { ai_assist: true } },
    });
    expect(flagged.statusCode, flagged.body).toBe(200);
    const read = await requireApp().inject({
      method: "GET",
      url: `/detections/${runId}`,
      headers: headers(other.cookie, otherWorkspace.id),
    });
    expect(read.statusCode, read.body).toBe(404);
    const write = await requireApp().inject({
      method: "POST",
      url: `/detections/${runId}/accept`,
      headers: headers(other.cookie, otherWorkspace.id),
      payload: { all: true },
    });
    expect(write.statusCode, write.body).toBe(404);
    const still = await requireAdmin().query<{ status: string }>(
      "select status from detection_run where id = $1",
      [runId],
    );
    expect(still.rows[0]?.status).toBe("succeeded");
  });

  it("refuses an office member and a final takeoff", async () => {
    await setFlags(true, true);
    const person = await signUp("Office Review");
    const roles = await requireApp().inject({
      method: "GET",
      url: "/roles",
      headers: { ...BROWSER, cookie: owner.cookie },
    });
    const roleId = roles.json().roles.find((item: { name: string }) => item.name === "office")
      ?.id as string;
    const invited = await requireApp().inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/invites`,
      headers: headers(owner.cookie),
      payload: { email: person.email, roleId },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    const joined = await requireApp().inject({
      method: "POST",
      url: `/invites/${invited.json().id}/accept`,
      headers: { ...BROWSER, cookie: person.cookie },
    });
    expect(joined.statusCode, joined.body).toBe(200);

    const job = await createJob();
    const takeoffId = await createTakeoff(job.id, job.location_id);
    const itemId = await createItem();
    const { runId } = await insertRun(takeoffId, itemId, [square(-81.7, 35.74, 9)]);
    const office = await requireApp().inject({
      method: "POST",
      url: `/detections/${runId}/accept`,
      headers: headers(person.cookie),
      payload: { all: true },
    });
    expect(office.statusCode, office.body).toBe(403);

    for (const status of ["in_review", "final"]) {
      const patched = await requireApp().inject({
        method: "PATCH",
        url: `/takeoffs/${takeoffId}`,
        headers: headers(owner.cookie),
        payload: { status },
      });
      expect(patched.statusCode, patched.body).toBe(200);
    }
    const locked = await requireApp().inject({
      method: "POST",
      url: `/detections/${runId}/accept`,
      headers: headers(owner.cookie),
      payload: { all: true },
    });
    expect(locked.statusCode, locked.body).toBe(409);
    expect(locked.json().detail).toMatch(/read-only/);
  });
});
