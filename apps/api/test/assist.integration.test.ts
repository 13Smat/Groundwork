import { createId } from "@groundwork/shared";
import type { FastifyInstance } from "fastify";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Mailer } from "../src/auth/mail.js";
import { buildApp } from "../src/app.js";
import { readAppDatabaseUrl, readAuthDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { ensureBucket, putObject } from "../src/storage/s3.js";
import { assertTrainingSource, type TrainingSource } from "../src/takeoff/training-guard.js";
import { ProblemError } from "../src/errors.js";

const PASSWORD = "correct-horse-battery";
const BROWSER = {
  origin: "http://127.0.0.1:5173",
  host: "127.0.0.1:5173",
};
const FIXTURE = "018f5a00-0000-7000-8000-000000000108";
const VIEWING = "018f5a00-0000-7000-8000-000000000105";
const GOOGLE = "018f5a00-0000-7000-8000-000000000106";
const MAPBOX = "018f5a00-0000-7000-8000-000000000107";
const CV_PORT = 8097;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureMeta = JSON.parse(
  readFileSync(path.join(ROOT, "db/seed/fixtures/rgbir-cog.json"), "utf8"),
) as {
  key: string;
  bounds: { west: number; south: number; east: number; north: number };
};

type Session = { cookie: string; email: string };
type AssistBody = {
  imagery_capture_id: string;
  takeoff_item_id: string;
  points: { lng: number; lat: number; label: 0 | 1 }[];
};

let app: FastifyInstance | undefined;
let admin: pg.Pool | undefined;
let pools: pg.Pool[] = [];
let owner: Session;
let workspaceId: string;
let cv: ChildProcess | undefined;

const mailer: Mailer = {
  async send() {
    return undefined;
  },
};

const centerLng = (fixtureMeta.bounds.west + fixtureMeta.bounds.east) / 2;
const centerLat = (fixtureMeta.bounds.south + fixtureMeta.bounds.north) / 2;

beforeAll(async () => {
  const cvPython = path.join(ROOT, ".venv-cv/bin/python");
  const imageryPython = path.join(ROOT, ".venv-imagery/bin/python");
  if (!existsSync(cvPython) || !existsSync(imageryPython)) {
    throw new Error("Run pnpm test:cv and pnpm test:imagery-ingest before pnpm test:assist.");
  }
  await startCv(cvPython);
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
  await ensureBucket();
  await putObject({
    storageKey: fixtureMeta.key,
    body: readFileSync(path.join(ROOT, "db/seed/fixtures/rgbir-cog.tif")),
    mime: "image/tiff",
  });
  owner = await signUp("Assist Owner");
  workspaceId = (await createWorkspace(owner.cookie, "Assist Co")).id;
});

afterAll(async () => {
  cv?.kill();
  delete process.env.GROUNDWORK_AI_ASSIST;
  delete process.env.CV_SERVICE_URL;
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

async function startCv(python: string): Promise<void> {
  process.env.CV_SERVICE_URL = `http://127.0.0.1:${CV_PORT}`;
  cv = spawn(
    python,
    [
      "-m",
      "uvicorn",
      "groundwork_cv.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(CV_PORT),
      "--log-level",
      "warning",
    ],
    {
      cwd: ROOT,
      env: { ...process.env, PYTHONPATH: path.join(ROOT, "services/cv"), CV_BACKEND: "mock" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CV_PORT}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // The process is still binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The mock CV service did not become ready.");
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

function headers(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...BROWSER,
    cookie,
    "x-workspace-id": workspaceId,
    "content-type": "application/json",
    ...extra,
  };
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

async function createItem(): Promise<string> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/takeoff-items",
    headers: headers(owner.cookie),
    payload: { name: "Drive", measure_kind: "area", default_unit: "ft2" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

async function createTakeoff(jobId: string, locationId: string): Promise<string> {
  const response = await requireApp().inject({
    method: "POST",
    url: `/jobs/${jobId}/takeoffs`,
    headers: headers(owner.cookie),
    payload: { kind: "aerial", location_id: locationId, imagery_capture_id: FIXTURE },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
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

function siteWkt(lng: number, lat: number, dLng: number, dLat: number): string {
  const ring = [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ];
  return `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(", ")}))`;
}

async function setSite(locationId: string, wkt: string): Promise<void> {
  await requireAdmin().query(
    `update location
     set site_geom = ST_Multi(ST_SetSRID(ST_GeomFromText($2), 4326))
     where id = $1`,
    [locationId, wkt],
  );
}

function prompt(itemId: string, captureId = FIXTURE, lng = centerLng, lat = centerLat): AssistBody {
  return {
    imagery_capture_id: captureId,
    takeoff_item_id: itemId,
    points: [{ lng, lat, label: 1 }],
  };
}

async function assist(
  takeoffId: string,
  body: AssistBody,
  cookie = owner.cookie,
  idempotencyKey?: string,
) {
  return requireApp().inject({
    method: "POST",
    url: `/takeoffs/${takeoffId}/assist`,
    headers: headers(cookie, idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    payload: body,
  });
}

describe("AI takeoff assist", () => {
  it("stays off until the env flag and the workspace feature are both on", async () => {
    const job = await createJob();
    const takeoffId = await createTakeoff(job.id, job.location_id);
    const itemId = await createItem();
    await setFlags(false, true);
    const envOff = await assist(takeoffId, prompt(itemId));
    expect(envOff.statusCode, envOff.body).toBe(403);
    expect(envOff.json().detail).toBe("AI assist is turned off.");

    await setFlags(true, false);
    const featureOff = await assist(takeoffId, prompt(itemId));
    expect(featureOff.statusCode, featureOff.body).toBe(403);
    expect(featureOff.json().detail).toBe("AI assist is not enabled for this workspace.");
  });

  it("refuses Google, Mapbox, viewing, and unverified captures", async () => {
    await setFlags(true, true);
    const job = await createJob();
    const takeoffId = await createTakeoff(job.id, job.location_id);
    const itemId = await createItem();
    for (const captureId of [GOOGLE, MAPBOX, VIEWING]) {
      const response = await assist(takeoffId, prompt(itemId, captureId));
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().detail).toMatch(/cannot be measured/);
    }

    const sourceId = createId();
    const captureId = createId();
    const coverage = "SRID=4326;MULTIPOLYGON(((-81 35, -80 35, -80 36, -81 36, -81 35)))";
    try {
      await requireAdmin().query(
        `insert into imagery_source (
           id, provider, name, bands, allows_tracing, allows_ml_training, verified_at
         ) values ($1, 'other', 'unverified-assist', 'RGB', true, false, null)`,
        [sourceId],
      );
      await requireAdmin().query(
        `insert into imagery_capture (
           id, source_id, coverage, capture_date, gsd_cm, bands, status
         ) values ($1, $2, $3::geometry, '2024-01-01', 15, 'RGB', 'ready')`,
        [captureId, sourceId, coverage],
      );
      const response = await assist(takeoffId, prompt(itemId, captureId));
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().detail).toMatch(/cannot be measured/);
    } finally {
      await requireAdmin().query("delete from imagery_capture where id = $1", [captureId]);
      await requireAdmin().query("delete from imagery_source where id = $1", [sourceId]);
    }

    const runs = await requireAdmin().query<{ n: number }>(
      "select count(*)::int as n from detection_run where takeoff_id = $1",
      [takeoffId],
    );
    expect(runs.rows[0]?.n).toBe(0);
  });

  it("refuses training on blocked sources and never reads parcel_cache for assist", async () => {
    const rows = await requireAdmin().query<TrainingSource & { name: string }>(
      `select name, allows_tracing, allows_ml_training, verified_at is not null as verified
       from imagery_source
       where name in ('nc_helene_2025', 'fixture_rgbir', 'google_satellite', 'mapbox_satellite')`,
    );
    const byName = new Map(rows.rows.map((row) => [row.name, row]));
    const helene = byName.get("nc_helene_2025");
    expect(helene).toBeDefined();
    expect(() => assertTrainingSource(helene as TrainingSource)).not.toThrow();
    for (const name of ["fixture_rgbir", "google_satellite", "mapbox_satellite"]) {
      const source = byName.get(name);
      expect(source).toBeDefined();
      expect(() => assertTrainingSource(source as TrainingSource)).toThrow(ProblemError);
    }
  });

  it("refuses a site with no boundary, a site outside the capture, and a final takeoff", async () => {
    await setFlags(true, true);
    const missing = await createJob();
    await requireAdmin().query("update location set site_geom = null where id = $1", [
      missing.location_id,
    ]);
    const missingTakeoff = await createTakeoff(missing.id, missing.location_id);
    const itemId = await createItem();
    const noSite = await assist(missingTakeoff, prompt(itemId));
    expect(noSite.statusCode, noSite.body).toBe(409);
    expect(noSite.json().detail).toMatch(/site boundary/);

    const seam = await createJob();
    await setSite(
      seam.location_id,
      siteWkt(fixtureMeta.bounds.west - 0.01, centerLat, 0.002, 0.0004),
    );
    const seamTakeoff = await createTakeoff(seam.id, seam.location_id);
    const crossed = await assist(seamTakeoff, prompt(itemId));
    expect(crossed.statusCode, crossed.body).toBe(409);
    expect(crossed.json().detail).toMatch(/capture date/);

    const closed = await createJob();
    const closedTakeoff = await createTakeoff(closed.id, closed.location_id);
    for (const status of ["in_review", "final"]) {
      const patched = await requireApp().inject({
        method: "PATCH",
        url: `/takeoffs/${closedTakeoff}`,
        headers: headers(owner.cookie),
        payload: { status },
      });
      expect(patched.statusCode, patched.body).toBe(200);
    }
    const locked = await assist(closedTakeoff, prompt(itemId));
    expect(locked.statusCode, locked.body).toBe(409);
    expect(locked.json().detail).toMatch(/read-only/);
  });

  it("stores one georeferenced polygon, drops the sliver, and replays the same key", async () => {
    await setFlags(true, true);
    const job = await createJob();
    await setSite(job.location_id, siteWkt(centerLng, centerLat, 0.0008, 0.0008));
    const takeoffId = await createTakeoff(job.id, job.location_id);
    const itemId = await createItem();
    const key = "assist-replay-01";
    const first = await assist(takeoffId, prompt(itemId), owner.cookie, key);
    expect(first.statusCode, first.body).toBe(200);
    const body = first.json() as {
      run_id: string;
      status: string;
      features: {
        geometry: { coordinates: number[][][] };
        properties: { area_m2: string; takeoff_item_id: string };
      }[];
    };
    expect(body.status).toBe("succeeded");
    expect(body.features).toHaveLength(1);
    expect(Number(body.features[0]?.properties.area_m2)).toBeGreaterThan(100);
    expect(body.features[0]?.properties.takeoff_item_id).toBe(itemId);
    const ring = body.features[0]?.geometry.coordinates[0] ?? [];
    expect(ring.length).toBeGreaterThan(3);
    for (const pair of ring) {
      expect(pair[0]).toBeGreaterThan(fixtureMeta.bounds.west);
      expect(pair[0]).toBeLessThan(fixtureMeta.bounds.east);
      expect(pair[1]).toBeGreaterThan(fixtureMeta.bounds.south);
      expect(pair[1]).toBeLessThan(fixtureMeta.bounds.north);
    }

    const stored = await requireAdmin().query<{ n: number; status: string; gpu: string }>(
      `select
         (select count(*)::int from detection_feature where run_id = $1) as n,
         status,
         gpu_seconds::text as gpu
       from detection_run
       where id = $1`,
      [body.run_id],
    );
    expect(stored.rows[0]?.n).toBe(1);
    expect(stored.rows[0]?.status).toBe("succeeded");
    expect(Number(stored.rows[0]?.gpu)).toBe(0);

    const usage = await requireAdmin().query<{ units: string; cost: number }>(
      `select units::text as units, cost_estimate_cents::int as cost
       from usage_event
       where workspace_id = $1 and kind = 'cv_infer'`,
      [workspaceId],
    );
    expect(usage.rows.length).toBeGreaterThan(0);
    expect(Number(usage.rows.at(-1)?.units)).toBe(0);
    expect(usage.rows.at(-1)?.cost).toBe(0);

    const replay = await assist(takeoffId, prompt(itemId), owner.cookie, key);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().run_id).toBe(body.run_id);
    const runs = await requireAdmin().query<{ n: number }>(
      "select count(*)::int as n from detection_run where takeoff_id = $1",
      [takeoffId],
    );
    expect(runs.rows[0]?.n).toBe(1);

    const changed = await assist(
      takeoffId,
      prompt(itemId, FIXTURE, centerLng, centerLat + 0.0001),
      owner.cookie,
      key,
    );
    expect(changed.statusCode, changed.body).toBe(409);
  });

  it("does not let an office member run assist", async () => {
    await setFlags(true, true);
    const person = await signUp("Office Assist");
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
    const accepted = await requireApp().inject({
      method: "POST",
      url: `/invites/${invited.json().id}/accept`,
      headers: { ...BROWSER, cookie: person.cookie },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const job = await createJob();
    const takeoffId = await createTakeoff(job.id, job.location_id);
    const itemId = await createItem();
    const response = await assist(takeoffId, prompt(itemId), person.cookie);
    expect(response.statusCode, response.body).toBe(403);
  });
});
