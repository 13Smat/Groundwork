import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createId } from "@groundwork/shared";
import type { Kysely } from "kysely";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { WORKSPACE_HEADER } from "../src/auth/hook.js";
import {
  LOCAL_TILE_SIGNING_SECRET,
  readAppDatabaseUrl,
  readAuthDatabaseUrl,
  readDatabaseUrl,
  readObjectStorageConfig,
  readTitilerUrl,
} from "../src/config.js";
import { createDb, createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import type { Database } from "../src/db/types.js";
import { withImageryAdminContext } from "../src/db/workspace.js";
import { ProblemError } from "../src/errors.js";
import {
  ensureImageryIngestQueue,
  imageryIngestDispatch,
  registerImageryIngestWorker,
} from "../src/imagery/queue.js";
import { applyImageryCaptureTransition } from "../src/imagery/transition.js";
import { startQueue } from "../src/queue.js";
import { ensureBucket, objectExists, putObject } from "../src/storage/s3.js";
import { readPngPixel } from "./png.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BROWSER = { origin: "http://127.0.0.1:5173", host: "127.0.0.1:5173" };
const PASSWORD = "correct-horse-battery";

type JobBody = {
  jobId: string;
  captureId: string;
  sourceId: string;
  status: string;
  error: string | null;
  captureDate: string | null;
  gsdCm: number | null;
  bands: string | null;
  leaf: string | null;
  cogKey: string | null;
};

let admin: pg.Pool;
let appPool: pg.Pool;
let authPool: pg.Pool;
let db: Kysely<Database>;
let app: Awaited<ReturnType<typeof buildApp>>;
let boss: Awaited<ReturnType<typeof startQueue>>;
let workspaceId: string;
let ownerCookie: string;
const createdCaptures: string[] = [];

beforeAll(async () => {
  await migrate("up");
  // The seeded fixture capture points at this object. TiTiler keeps a missing
  // object as missing for the life of the process, so the file has to be in
  // the bucket before any tile request, including the later imagery suite.
  await loadFixtureCog();
  admin = createPool(readDatabaseUrl());
  appPool = createPool(readAppDatabaseUrl());
  authPool = createPool(readAuthDatabaseUrl());
  db = createDb(appPool);
  boss = await startQueue(readDatabaseUrl(), () => undefined);
  await ensureImageryIngestQueue(boss);
  await registerImageryIngestWorker(boss, db);
  app = await buildApp({
    database: { app: appPool, auth: authPool },
    imagery: {
      db,
      titiler: readTitilerUrl(),
      signingSecret: LOCAL_TILE_SIGNING_SECRET,
      ingestDispatch: imageryIngestDispatch(boss),
    },
  });
  const owner = await signUp("Ingest Owner");
  ownerCookie = owner.cookie;
  workspaceId = await createWorkspace(owner.cookie, "Ingest Co");
}, 180_000);

afterAll(async () => {
  await boss?.stop({ graceful: true, close: true, timeout: 10_000 });
  if (admin && createdCaptures.length > 0) {
    await admin.query("delete from imagery_ingest_job where capture_id = any($1::uuid[])", [
      createdCaptures,
    ]);
    await admin.query(
      `delete from event_log
       where provider = 'imagery_ingest'
         and event_id in (
           select id::text from imagery_ingest_job where capture_id = any($1::uuid[])
         )`,
      [createdCaptures],
    );
    await admin.query("delete from imagery_capture where id = any($1::uuid[])", [createdCaptures]);
  }
  await app?.close();
  await authPool?.end();
  await appPool?.end();
  await admin?.end();
});

describe("imagery ingest", () => {
  it("turns the fixture GeoTIFF into a ready 4-band capture that TiTiler can draw", async () => {
    const fixture = JSON.parse(
      readFileSync(path.join(root, "db/seed/fixtures/rgbir-source.json"), "utf8"),
    ) as {
      captureDate: string;
      leaf: string;
      gsdCm: number;
      color: { r: number; g: number; b: number };
      tile: { z: number; x: number; y: number };
      bounds: { west: number; south: number; east: number; north: number };
    };
    const sourceId = await sourceIdByName("fixture_rgbir");
    const started = await app.inject({
      method: "POST",
      url: "/imagery/ingest",
      headers: {
        ...adminHeaders(),
        "content-type": "application/json",
        "idempotency-key": `fixture-${createId()}`,
      },
      payload: {
        sourceId,
        year: 2026,
        aoi: ring(fixture.bounds),
      },
    });
    expect(started.statusCode).toBe(202);
    const queued = started.json() as JobBody;
    createdCaptures.push(queued.captureId);
    const job = await waitFor(queued.jobId);
    expect(job.status).toBe("ready");
    expect(job.error).toBeNull();
    expect(job.captureDate).toBe(fixture.captureDate);
    expect(job.leaf).toBe(fixture.leaf);
    expect(job.bands).toBe("RGBIR");
    expect(job.gsdCm).toBeCloseTo(fixture.gsdCm, 2);
    expect(job.cogKey).toBe(`imagery/captures/${job.captureId}.tif`);
    expect(await objectExists(job.cogKey ?? "")).toBe(true);

    const cover = await admin.query<{ hits: boolean }>(
      `select ST_Intersects(coverage, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)) as hits
       from imagery_capture where id = $1`,
      [job.captureId, JSON.stringify(ring(fixture.bounds))],
    );
    expect(cover.rows[0]?.hits).toBe(true);

    const tile = await app.inject({
      method: "GET",
      url: `/imagery/tiles/${job.captureId}/${fixture.tile.z}/${fixture.tile.x}/${fixture.tile.y}`,
      headers: memberHeaders(ownerCookie),
    });
    expect(tile.statusCode, tile.body).toBe(200);
    expect(tile.headers["content-type"]).toContain("image/png");
    expect(readPngPixel(tile.rawPayload, 128, 128)).toEqual({
      r: fixture.color.r,
      g: fixture.color.g,
      b: fixture.color.b,
    });
    expect(new URL(readTitilerUrl()).hostname).toBe("127.0.0.1");
  });

  it("marks a live fetch as failed and leaves the ready fixture capture alone", async () => {
    const fixtureId = await captureIdByName("fixture_rgbir");
    const before = await admin.query<{ status: string; cog_key: string }>(
      "select status, cog_key from imagery_capture where id = $1",
      [fixtureId],
    );
    const sourceId = await sourceIdByName("nc_ortho");
    const started = await app.inject({
      method: "POST",
      url: "/imagery/ingest",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      payload: { sourceId, year: 2024, countyFips: "37023" },
    });
    expect(started.statusCode).toBe(202);
    const queued = started.json() as JobBody;
    createdCaptures.push(queued.captureId);
    const job = await waitFor(queued.jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toBe("Live imagery download is disabled.");
    expect(job.cogKey).toBeNull();
    const after = await admin.query<{ status: string; cog_key: string }>(
      "select status, cog_key from imagery_capture where id = $1",
      [fixtureId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    const tile = await app.inject({
      method: "GET",
      url: `/imagery/tiles/${fixtureId}/16/17894/25791`,
      headers: memberHeaders(ownerCookie),
    });
    expect(tile.statusCode, tile.body).toBe(200);
  });

  it("returns 409 for an illegal capture transition and for a reused idempotency key", async () => {
    const fixtureId = await captureIdByName("fixture_rgbir");
    await expect(
      withImageryAdminContext(db, workspaceId, (trx) =>
        applyImageryCaptureTransition(trx, {
          captureId: fixtureId,
          from: "ready",
          to: "failed",
        }),
      ),
    ).rejects.toBeInstanceOf(ProblemError);

    const sourceId = await sourceIdByName("fixture_rgbir");
    const key = `same-${createId()}`;
    const body = { sourceId, year: 2026, countyFips: "37023" };
    const first = await app.inject({
      method: "POST",
      url: "/imagery/ingest",
      headers: { ...adminHeaders(), "content-type": "application/json", "idempotency-key": key },
      payload: body,
    });
    expect(first.statusCode).toBe(202);
    const firstJob = first.json() as JobBody;
    createdCaptures.push(firstJob.captureId);
    const replay = await app.inject({
      method: "POST",
      url: "/imagery/ingest",
      headers: { ...adminHeaders(), "content-type": "application/json", "idempotency-key": key },
      payload: body,
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as JobBody).jobId).toBe(firstJob.jobId);
    const changed = await app.inject({
      method: "POST",
      url: "/imagery/ingest",
      headers: { ...adminHeaders(), "content-type": "application/json", "idempotency-key": key },
      payload: { sourceId, year: 2025, countyFips: "37023" },
    });
    expect(changed.statusCode).toBe(409);
  });

  it("refuses a statewide AOI, a missing session, a bad workspace, a non-member, and a non-admin", async () => {
    const listed = await app.inject({
      method: "GET",
      url: "/admin/imagery-sources",
      headers: adminHeaders(),
    });
    expect(listed.statusCode).toBe(200);
    const names = (listed.json() as { sources: { name: string }[] }).sources.map(
      (source) => source.name,
    );
    expect(names).toContain("fixture_rgbir");
    expect(names).toContain("google_satellite");

    const sourceId = await sourceIdByName("fixture_rgbir");
    const huge = await app.inject({
      method: "POST",
      url: "/imagery/ingest",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      payload: {
        sourceId,
        year: 2026,
        aoi: ring({ west: -84.32, south: 33.84, east: -75.46, north: 36.59 }),
      },
    });
    expect(huge.statusCode).toBe(400);

    const state = await app.inject({
      method: "POST",
      url: "/imagery/ingest",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      payload: { sourceId, year: 2026, countyFips: "37000" },
    });
    expect(state.statusCode).toBe(400);

    const anonymous = await app.inject({
      method: "POST",
      url: "/imagery/ingest",
      headers: { ...BROWSER, [WORKSPACE_HEADER]: workspaceId, "content-type": "application/json" },
      payload: { sourceId, year: 2026, countyFips: "37023" },
    });
    expect(anonymous.statusCode).toBe(401);

    const badWorkspace = await app.inject({
      method: "GET",
      url: "/admin/imagery-sources",
      headers: { ...BROWSER, cookie: ownerCookie, [WORKSPACE_HEADER]: "not-a-uuid" },
    });
    expect(badWorkspace.statusCode).toBe(400);

    const stranger = await signUp("Ingest Stranger");
    const missing = await app.inject({
      method: "GET",
      url: "/admin/imagery-sources",
      headers: memberHeaders(stranger.cookie),
    });
    expect(missing.statusCode).toBe(404);

    const estimator = await signUp("Ingest Estimator");
    const roles = await app.inject({
      method: "GET",
      url: "/roles",
      headers: { ...BROWSER, cookie: ownerCookie },
    });
    const estimatorRole = (roles.json() as { roles: { id: string; name: string }[] }).roles.find(
      (role) => role.name === "estimator",
    );
    const invite = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/invites`,
      headers: { ...BROWSER, cookie: ownerCookie, "content-type": "application/json" },
      payload: { email: estimator.email, roleId: estimatorRole?.id },
    });
    expect(invite.statusCode).toBe(201);
    const accepted = await app.inject({
      method: "POST",
      url: `/invites/${(invite.json() as { id: string }).id}/accept`,
      headers: { ...BROWSER, cookie: estimator.cookie },
    });
    expect(accepted.statusCode).toBe(200);
    const forbidden = await app.inject({
      method: "POST",
      url: "/imagery/ingest",
      headers: {
        ...BROWSER,
        cookie: estimator.cookie,
        [WORKSPACE_HEADER]: workspaceId,
        "content-type": "application/json",
      },
      payload: { sourceId, year: 2026, countyFips: "37023" },
    });
    expect(forbidden.statusCode).toBe(403);

    const google = await sourceIdByName("google_satellite");
    const blocked = await app.inject({
      method: "POST",
      url: "/imagery/ingest",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      payload: { sourceId: google, year: 2026, countyFips: "37023" },
    });
    expect(blocked.statusCode).toBe(403);
  });

  it("publishes the ingest routes", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    const paths = Object.keys((response.json() as { paths?: Record<string, unknown> }).paths ?? {});
    expect(paths).toContain("/imagery/ingest");
    expect(paths.some((path) => path.includes("jobId"))).toBe(true);
    expect(paths).toContain("/admin/imagery-sources");
  });
});

function adminHeaders(): Record<string, string> {
  return memberHeaders(ownerCookie);
}

function memberHeaders(cookie: string): Record<string, string> {
  return { ...BROWSER, cookie, [WORKSPACE_HEADER]: workspaceId };
}

function ring(bounds: { west: number; south: number; east: number; north: number }) {
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [bounds.west, bounds.south],
        [bounds.west, bounds.north],
        [bounds.east, bounds.north],
        [bounds.east, bounds.south],
        [bounds.west, bounds.south],
      ],
    ],
  };
}

async function waitFor(jobId: string): Promise<JobBody> {
  const deadline = Date.now() + 90_000;
  let last: JobBody | undefined;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/imagery/ingest/${jobId}`,
      headers: adminHeaders(),
    });
    expect(response.statusCode).toBe(200);
    last = response.json() as JobBody;
    if (last.status !== "ingesting") {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Ingest stayed ingesting: ${JSON.stringify(last)}`);
}

async function loadFixtureCog(): Promise<void> {
  const storage = readObjectStorageConfig();
  await ensureBucket(storage);
  const fixture = JSON.parse(
    readFileSync(path.join(root, "db/seed/fixtures/rgbir-cog.json"), "utf8"),
  ) as { key: string };
  await putObject(
    {
      storageKey: fixture.key,
      body: readFileSync(path.join(root, "db/seed/fixtures/rgbir-cog.tif")),
      mime: "image/tiff",
    },
    storage,
  );
}

async function sourceIdByName(name: string): Promise<string> {
  const result = await admin.query<{ id: string }>(
    "select id::text as id from imagery_source where name = $1",
    [name],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`No source named ${name}.`);
  }
  return id;
}

async function captureIdByName(name: string): Promise<string> {
  const result = await admin.query<{ id: string }>(
    `select c.id::text as id
     from imagery_capture c
     join imagery_source s on s.id = c.source_id
     where s.name = $1 and c.status = 'ready'
     order by c.created_at
     limit 1`,
    [name],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`No ready capture for ${name}.`);
  }
  return id;
}

async function signUp(name: string): Promise<{ cookie: string; email: string }> {
  const email = `${createId()}@example.com`;
  const signup = await app.inject({
    method: "POST",
    url: "/auth/sign-up/email",
    headers: { ...BROWSER, "content-type": "application/json" },
    payload: { name, email, password: PASSWORD },
  });
  if (signup.statusCode !== 200) {
    throw new Error(signup.body);
  }
  const raw = signup.headers["set-cookie"];
  const parts = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return { cookie: parts.map((part) => String(part).split(";")[0]).join("; "), email };
}

async function createWorkspace(cookie: string, name: string): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/workspaces",
    headers: { ...BROWSER, cookie, "content-type": "application/json" },
    payload: { name },
  });
  if (created.statusCode !== 201) {
    throw new Error(created.body);
  }
  return (created.json() as { id: string }).id;
}
