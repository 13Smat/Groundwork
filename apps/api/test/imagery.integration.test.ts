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
import {
  WARNING_AGE,
  WARNING_AGE_STRONG,
  WARNING_HELENE,
  WARNING_NAIP,
  ageDays,
  buildTileUpstreamUrl,
} from "../src/imagery/policy.js";
import { ensureBucket, putObject } from "../src/storage/s3.js";
import { readPngPixel } from "./png.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const AS_OF = new Date("2026-11-26T15:00:00.000Z");
const BURKE = "-81.95,35.52,-81.40,35.99";
const ATLANTA = "-84.50,33.70,-84.30,33.82";

type CaptureBody = {
  captures: {
    id: string;
    provider: string;
    name: string;
    captureDate: string;
    ageDays: number;
    warnings: string[];
    attribution: string | null;
    gsdCm: number;
  }[];
};

let admin: pg.Pool;
let appPool: pg.Pool;
let authPool: pg.Pool;
let db: Kysely<Database>;
let app: Awaited<ReturnType<typeof buildApp>>;
let workspaceId: string;
let cookie: string;
const upstreamCalls: string[] = [];

const BROWSER = {
  origin: "http://127.0.0.1:5173",
  host: "127.0.0.1:5173",
};

function tenantHeaders(): Record<string, string> {
  return { ...BROWSER, cookie, [WORKSPACE_HEADER]: workspaceId };
}

beforeAll(async () => {
  await migrate("up");
  admin = createPool(readDatabaseUrl());
  appPool = createPool(readAppDatabaseUrl());
  authPool = createPool(readAuthDatabaseUrl());
  db = createDb(appPool);
  workspaceId = createId();
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
  app = await buildApp({
    database: { app: appPool, auth: authPool },
    imagery: {
      db,
      asOf: () => AS_OF,
      titiler: readTitilerUrl(),
      signingSecret: LOCAL_TILE_SIGNING_SECRET,
      fetchImpl: async (input, init) => {
        upstreamCalls.push(input);
        return fetch(input, init);
      },
    },
  });
  const email = `${createId()}@example.com`;
  const signup = await app.inject({
    method: "POST",
    url: "/auth/sign-up/email",
    headers: { ...BROWSER, "content-type": "application/json" },
    payload: { name: "Imagery Owner", email, password: "correct-horse-battery" },
  });
  if (signup.statusCode !== 200) {
    throw new Error(signup.body);
  }
  const raw = signup.headers["set-cookie"];
  const parts = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  cookie = parts.map((part) => String(part).split(";")[0]).join("; ");
  const created = await app.inject({
    method: "POST",
    url: "/workspaces",
    headers: { ...BROWSER, cookie, "content-type": "application/json" },
    payload: { name: "Imagery Co" },
  });
  if (created.statusCode !== 201) {
    throw new Error(created.body);
  }
  workspaceId = created.json().id;
});

afterAll(async () => {
  await app?.close();
  await authPool?.end();
  await appPool?.end();
  await admin?.end();
});

describe("imagery captures and tiles", () => {
  it("lists Helene, then the newest NC ortho, then NAIP for a Burke County bbox", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/imagery/captures?bbox=${BURKE}`,
      headers: tenantHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as CaptureBody;
    expect(body.captures.map((capture) => capture.name)).toEqual([
      "nc_helene_2025",
      "nc_ortho",
      "nc_ortho",
      "naip",
      "fixture_rgbir",
    ]);
    expect(body.captures.map((capture) => capture.provider)).toEqual([
      "nc_helene_2025",
      "nc_ortho",
      "nc_ortho",
      "naip",
      "other",
    ]);
    expect(body.captures[1]?.captureDate).toBe("2024-03-15");
    expect(body.captures[2]?.captureDate).toBe("2022-03-15");
    const names = body.captures.map((capture) => capture.name);
    expect(names).not.toContain("google_satellite");
    expect(names).not.toContain("mapbox_satellite");
    expect(names).not.toContain("nc_ortho_latest_viewing");

    const helene = body.captures[0];
    expect(helene?.ageDays).toBe(ageDays("2025-04-15", AS_OF));
    expect(helene?.warnings).toContain(WARNING_AGE);
    expect(helene?.warnings).toContain(WARNING_HELENE);
    expect(helene?.warnings).not.toContain(WARNING_AGE_STRONG);
    expect(helene?.attribution).toBe("NC Collaboratory at UNC Chapel Hill");
    expect(helene?.gsdCm).toBe(15.24);
    expect(body.captures[2]?.warnings).toContain(WARNING_AGE_STRONG);
    expect(body.captures[3]?.warnings).not.toContain(WARNING_NAIP);
  });

  it("lists only NAIP outside North Carolina and warns about resolution", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/imagery/captures?bbox=${ATLANTA}`,
      headers: tenantHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as CaptureBody;
    expect(body.captures.map((capture) => capture.name)).toEqual(["naip"]);
    expect(body.captures[0]?.warnings).toContain(WARNING_NAIP);
    expect(body.captures[0]?.gsdCm).toBe(60);
  });

  it("requires a session, a workspace membership, and exactly one of bbox or locationId", async () => {
    const missing = await app.inject({ method: "GET", url: `/imagery/captures?bbox=${BURKE}` });
    expect(missing.statusCode).toBe(401);

    const noWorkspace = await app.inject({
      method: "GET",
      url: `/imagery/captures?bbox=${BURKE}`,
      headers: { ...BROWSER, cookie },
    });
    expect(noWorkspace.statusCode).toBe(400);

    const strangerEmail = `${createId()}@example.com`;
    const strangerSignup = await app.inject({
      method: "POST",
      url: "/auth/sign-up/email",
      headers: { ...BROWSER, "content-type": "application/json" },
      payload: { name: "Stranger", email: strangerEmail, password: "correct-horse-battery" },
    });
    expect(strangerSignup.statusCode).toBe(200);
    const raw = strangerSignup.headers["set-cookie"];
    const parts = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
    const strangerCookie = parts.map((part) => String(part).split(";")[0]).join("; ");
    const foreign = await app.inject({
      method: "GET",
      url: `/imagery/captures?bbox=${BURKE}`,
      headers: { ...BROWSER, cookie: strangerCookie, [WORKSPACE_HEADER]: workspaceId },
    });
    expect(foreign.statusCode).toBe(404);

    const locationId = createId();
    const unimplemented = await app.inject({
      method: "GET",
      url: `/imagery/captures?locationId=${locationId}`,
      headers: tenantHeaders(),
    });
    expect(unimplemented.statusCode).toBe(404);
    expect(unimplemented.headers["content-type"]).toContain("application/problem+json");
    expect(unimplemented.json().detail).toContain("No location");

    const both = await app.inject({
      method: "GET",
      url: `/imagery/captures?bbox=${BURKE}&locationId=${locationId}`,
      headers: tenantHeaders(),
    });
    expect(both.statusCode).toBe(400);
  });

  it("returns 403 for allows_tracing false and for a null verified_at without calling TiTiler", async () => {
    const unverified = await insertCapture({
      allowsTracing: true,
      verified: false,
    });
    const denied = await insertCapture({
      allowsTracing: false,
      verified: true,
    });
    const google = await captureIdBySource("google_satellite");
    const before = upstreamCalls.length;

    for (const captureId of [unverified, denied, google]) {
      const response = await app.inject({
        method: "GET",
        url: `/imagery/tiles/${captureId}/16/17894/25791`,
        headers: tenantHeaders(),
      });
      expect(response.statusCode).toBe(403);
      expect(response.headers["content-type"]).toContain("application/problem+json");
    }
    expect(upstreamCalls).toHaveLength(before);
  });

  it("renders the fixture COG through TiTiler and logs a usage event", async () => {
    const fixture = JSON.parse(
      readFileSync(path.join(root, "db/seed/fixtures/rgbir-cog.json"), "utf8"),
    ) as {
      tile: { z: number; x: number; y: number };
      color: { r: number; g: number; b: number };
    };
    const captureId = await captureIdBySource("fixture_rgbir");
    const response = await app.inject({
      method: "GET",
      url: `/imagery/tiles/${captureId}/${fixture.tile.z}/${fixture.tile.x}/${fixture.tile.y}`,
      headers: tenantHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    const pixel = readPngPixel(response.rawPayload, 128, 128);
    expect(pixel).toEqual({ r: fixture.color.r, g: fixture.color.g, b: fixture.color.b });

    const calls = upstreamCalls.filter((url) => url.includes(captureId));
    expect(calls.length).toBeGreaterThan(0);
    for (const url of upstreamCalls) {
      const host = new URL(url).hostname;
      expect(host).toBe("127.0.0.1");
      expect(host).not.toMatch(/google|mapbox|nconemap|arcgis/i);
    }

    const usage = await admin.query<{ n: number }>(
      "select count(*)::int as n from usage_event where workspace_id = $1 and kind = 'imagery_tile'",
      [workspaceId],
    );
    expect(usage.rows[0]?.n).toBe(1);
  });

  it("makes TiTiler itself return 403 for a blocked source and ignore a caller-supplied URL", async () => {
    const titiler = readTitilerUrl();
    const google = await captureIdBySource("google_satellite");
    const fixtureId = await captureIdBySource("fixture_rgbir");
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    const blocked = buildTileUpstreamUrl({
      titiler,
      captureId: google,
      z: 16,
      x: 17894,
      y: 25791,
      workspaceId,
      expiresAt,
      secret: LOCAL_TILE_SIGNING_SECRET,
    });
    const blockedResponse = await fetch(blocked);
    expect(blockedResponse.status).toBe(403);

    const forged = new URL(blocked);
    forged.searchParams.set("sig", "not-a-valid-signature-value");
    const unauthorized = await fetch(forged);
    expect(unauthorized.status).toBe(401);

    const fixtureUrl = buildTileUpstreamUrl({
      titiler,
      captureId: fixtureId,
      z: 16,
      x: 17894,
      y: 25791,
      workspaceId,
      expiresAt,
      secret: LOCAL_TILE_SIGNING_SECRET,
    });
    fixtureUrl.searchParams.set(
      "url",
      "https://services.nconemap.gov/secure/rest/services/Imagery/tile.tif",
    );
    const rejected = await fetch(fixtureUrl);
    expect(rejected.status).toBe(400);

    const info = new URL(`/captures/${fixtureId}/info`, titiler);
    const hidden = await fetch(info);
    expect(hidden.status).toBe(404);

    expect(blocked.hostname).toBe("127.0.0.1");
  });

  it("publishes the captures route on the OpenAPI document", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    const body = response.json() as { paths?: Record<string, unknown> };
    expect(body.paths?.["/imagery/captures"]).toBeTruthy();
  });
});

async function captureIdBySource(name: string): Promise<string> {
  const result = await admin.query<{ id: string }>(
    `select c.id::text as id
     from imagery_capture c
     join imagery_source s on s.id = c.source_id
     where s.name = $1
     order by c.capture_date desc
     limit 1`,
    [name],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`No capture for ${name}.`);
  }
  return id;
}

async function insertCapture(input: {
  allowsTracing: boolean;
  verified: boolean;
}): Promise<string> {
  const sourceId = createId();
  const captureId = createId();
  await admin.query(
    `insert into imagery_source (
       id, workspace_id, provider, name, bands, allows_tracing, allows_ml_training, verified_at
     ) values ($1, null, 'other', $2, 'RGB', $3, false, case when $4 then now() else null end)`,
    [sourceId, `blocked-${sourceId}`, input.allowsTracing, input.verified],
  );
  await admin.query(
    `insert into imagery_capture (
       id, workspace_id, source_id, coverage, capture_date, gsd_cm, bands, leaf, cog_key, status
     ) values (
       $1, null, $2,
       st_multi(st_makeenvelope(-81.8, 35.7, -81.6, 35.8, 4326)),
       date '2024-01-01', 15.24, 'RGB', 'unknown',
       'imagery/fixtures/rgbir-cog.tif', 'ready'
     )`,
    [captureId, sourceId],
  );
  return captureId;
}
