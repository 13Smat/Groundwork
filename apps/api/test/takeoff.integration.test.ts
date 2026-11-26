import {
  convertMetric,
  displayFromMetric,
  geodesicRectangle,
  geodesicRectangleWithHole,
  geodesicSegment,
  INTERNATIONAL_FOOT_M,
  type LngLat,
} from "@groundwork/geo";
import { createId } from "@groundwork/shared";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Mailer } from "../src/auth/mail.js";
import { buildApp } from "../src/app.js";
import { fixtureNeighborParcelId, fixtureParcelId } from "../src/crm/providers.js";
import {
  lngLatToTile,
  resetFeatureTileThrottle,
  TILE_CALL_LIMIT,
} from "../src/takeoff/feature-tiles.js";
import { readAppDatabaseUrl, readAuthDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";

const PASSWORD = "correct-horse-battery";
const BROWSER = {
  origin: "http://127.0.0.1:5173",
  host: "127.0.0.1:5173",
};
const HELENE = "018f5a00-0000-7000-8000-000000000101";
const NC_ORTHO = "018f5a00-0000-7000-8000-000000000102";
const VIEWING = "018f5a00-0000-7000-8000-000000000105";
const GOOGLE = "018f5a00-0000-7000-8000-000000000106";
const SIDE_M = 100 * INTERNATIONAL_FOOT_M;
const HOLE_M = 20 * INTERNATIONAL_FOOT_M;
const LATITUDES = [25, 32, 35, 40, 45, 48];

type Session = { cookie: string; email: string };

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
  owner = await signUp("Takeoff Owner");
  workspaceId = (await createWorkspace(owner.cookie, "Takeoff Co")).id;
});

afterAll(async () => {
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

function headers(cookie: string, workspace = workspaceId, json = true): Record<string, string> {
  return {
    ...BROWSER,
    cookie,
    "x-workspace-id": workspace,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

async function invite(role: string, name: string): Promise<Session> {
  const person = await signUp(name);
  const roles = await requireApp().inject({
    method: "GET",
    url: "/roles",
    headers: { ...BROWSER, cookie: owner.cookie },
  });
  const roleId = roles.json().roles.find((item: { name: string; id: string }) => item.name === role)
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
  return person;
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
  const body = response.json();
  expect(body.location_id).toEqual(expect.any(String));
  return body;
}

async function createItem(
  name: string,
  measureKind: "area" | "length" | "count",
  unit: string,
): Promise<string> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/takeoff-items",
    headers: headers(owner.cookie),
    payload: { name, measure_kind: measureKind, default_unit: unit },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

async function createTakeoff(
  jobId: string,
  locationId: string,
  captureId = HELENE,
): Promise<{ id: string; status: string; version: number }> {
  const response = await requireApp().inject({
    method: "POST",
    url: `/jobs/${jobId}/takeoffs`,
    headers: headers(owner.cookie),
    payload: { kind: "aerial", location_id: locationId, imagery_capture_id: captureId },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}

function shift(origin: LngLat, distanceM: number, bearing: number): LngLat {
  if (distanceM === 0) {
    return origin;
  }
  const next = geodesicSegment({ origin, distanceM, bearing }).coordinates[1];
  if (!next) {
    throw new Error("Geodesic shift did not return a point.");
  }
  return next;
}

function squareAt(latitude: number, longitude = -80): ReturnType<typeof geodesicRectangle> {
  return geodesicRectangle({
    origin: [longitude, latitude],
    widthM: SIDE_M,
    heightM: SIDE_M,
  });
}

function feetFrom(m2: string): number {
  return Number(convertMetric(m2, "ft2"));
}

type Collection = {
  features: {
    id: string;
    geometry: { type: string };
    properties: {
      value_m2: string | null;
      value_m: string | null;
      count: number | null;
      kind: string;
      takeoff_item_id: string;
      deductions: unknown[];
      display: { ft2: string | null; yd2: string | null; ft: string | null };
    };
  }[];
  corrections: { id: string; reason: string }[];
  overlaps: { takeoff_item_id: string; measurement_ids: [string, string] }[];
};

async function putFeatures(
  takeoffId: string,
  features: Record<string, unknown>[],
): Promise<{ status: number; body: Collection; raw: string; ms: number }> {
  const started = performance.now();
  const response = await requireApp().inject({
    method: "PUT",
    url: `/takeoffs/${takeoffId}/measurements`,
    headers: headers(owner.cookie),
    payload: { features },
  });
  return {
    status: response.statusCode,
    body: response.json(),
    raw: response.body,
    ms: performance.now() - started,
  };
}

describe("takeoff measurements", () => {
  it("measures a 100 ft square within 0.5% from 25N to 48N", async () => {
    const job = await createJob();
    const item = await createItem("Asphalt", "area", "ft2");
    const takeoff = await createTakeoff(job.id, job.location_id);
    for (const latitude of LATITUDES) {
      const saved = await putFeatures(takeoff.id, [
        {
          id: createId(),
          takeoff_item_id: item,
          kind: "area",
          geom: squareAt(latitude),
          source: "manual",
        },
      ]);
      expect(saved.status, saved.raw).toBe(200);
      const feature = saved.body.features.at(-1);
      expect(feature?.properties.value_m2, `latitude ${latitude}`).toEqual(expect.any(String));
      const ft2 = feetFrom(feature?.properties.value_m2 ?? "0");
      expect(
        Math.abs(ft2 - 10_000) / 10_000,
        `latitude ${latitude} was ${ft2}`,
      ).toBeLessThanOrEqual(0.005);
      expect(feature?.properties.display.ft2).toBe(
        displayFromMetric(feature?.properties.value_m2 ?? "0", "ft2"),
      );
    }
    const stored = await requireAdmin().query<{ stored: string; area: string }>(
      `select value_m2::text as stored,
              ST_Area(geom::geography)::numeric(14, 4)::text as area
       from measurement
       where takeoff_id = $1
       order by created_at desc
       limit 1`,
      [takeoff.id],
    );
    expect(stored.rows[0]?.stored).toBe(stored.rows[0]?.area);
  });

  it("keeps a deleted measurement gone after the remaining features are saved", async () => {
    const job = await createJob();
    const item = await createItem("Pad", "area", "ft2");
    const takeoff = await createTakeoff(job.id, job.location_id);
    const kept = createId();
    const removed = createId();
    const saved = await putFeatures(takeoff.id, [
      { id: kept, takeoff_item_id: item, kind: "area", geom: squareAt(35) },
      { id: removed, takeoff_item_id: item, kind: "area", geom: squareAt(36) },
    ]);
    expect(saved.status, saved.raw).toBe(200);
    expect(saved.body.features.map((feature) => feature.id).sort()).toEqual([kept, removed].sort());
    const deleted = await requireApp().inject({
      method: "DELETE",
      url: `/measurements/${removed}`,
      headers: headers(owner.cookie, workspaceId, false),
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    const again = await putFeatures(takeoff.id, [
      { id: kept, takeoff_item_id: item, kind: "area", geom: squareAt(35) },
    ]);
    expect(again.status, again.raw).toBe(200);
    expect(again.body.features.map((feature) => feature.id)).toEqual([kept]);
    const listed = await requireApp().inject({
      method: "GET",
      url: `/takeoffs/${takeoff.id}/measurements`,
      headers: headers(owner.cookie),
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().features.map((feature: { id: string }) => feature.id)).toEqual([kept]);
  });

  it("subtracts a 20 ft hole", async () => {
    const job = await createJob();
    const item = await createItem("Lawn", "area", "ft2");
    const takeoff = await createTakeoff(job.id, job.location_id);
    for (const latitude of [25, 48]) {
      const origin: LngLat = [-80, latitude];
      const holeOrigin = shift(
        shift(origin, 40 * INTERNATIONAL_FOOT_M, 90),
        40 * INTERNATIONAL_FOOT_M,
        0,
      );
      const saved = await putFeatures(takeoff.id, [
        {
          id: createId(),
          takeoff_item_id: item,
          kind: "area",
          geom: geodesicRectangleWithHole({
            origin,
            widthM: SIDE_M,
            heightM: SIDE_M,
            holeOrigin,
            holeWidthM: HOLE_M,
            holeHeightM: HOLE_M,
          }),
        },
      ]);
      expect(saved.status, saved.raw).toBe(200);
      const feature = saved.body.features.at(-1);
      const ft2 = feetFrom(feature?.properties.value_m2 ?? "0");
      expect(Math.abs(ft2 - 9_600) / 9_600, `latitude ${latitude} was ${ft2}`).toBeLessThanOrEqual(
        0.005,
      );
      expect(feature?.properties.deductions.length).toBeGreaterThan(0);
    }
  });

  it("measures a geodesic polyline within 0.5%", async () => {
    const job = await createJob();
    const item = await createItem("Curb", "length", "ft");
    const takeoff = await createTakeoff(job.id, job.location_id);
    for (const latitude of LATITUDES) {
      const saved = await putFeatures(takeoff.id, [
        {
          id: createId(),
          takeoff_item_id: item,
          kind: "length",
          geom: geodesicSegment({
            origin: [-80, latitude],
            distanceM: 1_000 * INTERNATIONAL_FOOT_M,
            bearing: 90,
          }),
        },
      ]);
      expect(saved.status, saved.raw).toBe(200);
      const feature = saved.body.features.at(-1);
      const feet = Number(convertMetric(feature?.properties.value_m ?? "0", "ft"));
      expect(
        Math.abs(feet - 1_000) / 1_000,
        `latitude ${latitude} was ${feet}`,
      ).toBeLessThanOrEqual(0.005);
      expect(feature?.properties.display.ft).toBe(
        displayFromMetric(feature?.properties.value_m ?? "0", "ft"),
      );
    }
  });

  it("saves 500 features in one PUT in under 2 seconds", async () => {
    const job = await createJob();
    const item = await createItem("Grid", "area", "ft2");
    const takeoff = await createTakeoff(job.id, job.location_id);
    const features = Array.from({ length: 500 }, (_, index) => {
      const origin = shift(shift([-80, 35], (index % 25) * 60, 90), Math.floor(index / 25) * 60, 0);
      return {
        id: createId(),
        takeoff_item_id: item,
        kind: "area" as const,
        geom: geodesicRectangle({ origin, widthM: SIDE_M, heightM: SIDE_M }),
      };
    });
    const saved = await putFeatures(takeoff.id, features);
    expect(saved.status, saved.raw.slice(0, 500)).toBe(200);
    expect(saved.ms).toBeLessThan(2_000);
    expect(saved.body.features).toHaveLength(500);
    for (const feature of saved.body.features) {
      const ft2 = feetFrom(feature.properties.value_m2 ?? "0");
      expect(Math.abs(ft2 - 10_000) / 10_000).toBeLessThanOrEqual(0.005);
    }
  });

  it("summarizes the sum and the union per takeoff item", async () => {
    const job = await createJob();
    const area = await createItem("Pads", "area", "ft2");
    const overlapItem = await createItem("Overlap", "area", "ft2");
    const length = await createItem("Edge", "length", "ft");
    const count = await createItem("Trees", "count", "ea");
    const takeoff = await createTakeoff(job.id, job.location_id);
    const pads = [0, 1, 2, 3].map((index) => ({
      id: createId(),
      takeoff_item_id: area,
      kind: "area" as const,
      geom: geodesicRectangle({
        origin: shift([-81, 36], index * 80, 90),
        widthM: SIDE_M,
        heightM: SIDE_M,
      }),
    }));
    const left = geodesicRectangle({ origin: [-81, 37], widthM: SIDE_M, heightM: SIDE_M });
    const right = geodesicRectangle({
      origin: shift([-81, 37], 10, 90),
      widthM: SIDE_M,
      heightM: SIDE_M,
    });
    const other = geodesicRectangle({ origin: [-81, 38], widthM: SIDE_M, heightM: SIDE_M });
    const saved = await putFeatures(takeoff.id, [
      ...pads,
      { id: createId(), takeoff_item_id: overlapItem, kind: "area", geom: left },
      { id: createId(), takeoff_item_id: overlapItem, kind: "area", geom: right },
      { id: createId(), takeoff_item_id: area, kind: "area", geom: other },
      {
        id: createId(),
        takeoff_item_id: length,
        kind: "length",
        geom: geodesicSegment({ origin: [-81, 36], distanceM: 50, bearing: 0 }),
      },
      {
        id: createId(),
        takeoff_item_id: count,
        kind: "count",
        geom: { type: "Point", coordinates: [-81, 36] },
        count: 2,
      },
      {
        id: createId(),
        takeoff_item_id: count,
        kind: "count",
        geom: { type: "Point", coordinates: [-81.001, 36] },
        count: 3,
      },
    ]);
    expect(saved.status, saved.raw.slice(0, 800)).toBe(200);
    const overlapPairs = saved.body.overlaps.filter((pair) => pair.takeoff_item_id === overlapItem);
    expect(overlapPairs).toHaveLength(1);
    expect(saved.body.overlaps.some((pair) => pair.takeoff_item_id === area)).toBe(false);

    const summary = await requireApp().inject({
      method: "GET",
      url: `/takeoffs/${takeoff.id}/summary`,
      headers: headers(owner.cookie),
    });
    expect(summary.statusCode, summary.body).toBe(200);
    const items = summary.json().items as {
      takeoff_item_id: string;
      sum_m2: string | null;
      union_m2: string | null;
      sum_m: string | null;
      count: number | null;
      overlap_count: number;
      display: { sum_ft2: string | null };
    }[];
    const byId = new Map(items.map((item) => [item.takeoff_item_id, item]));
    const pad = byId.get(area);
    const padValues = saved.body.features
      .filter((feature) => feature.properties.takeoff_item_id === area)
      .map((feature) => Number(feature.properties.value_m2));
    expect(padValues).toHaveLength(5);
    expect(
      Math.abs(Number(pad?.sum_m2) - padValues.reduce((sum, value) => sum + value, 0)),
    ).toBeLessThanOrEqual(0.001);
    expect(Math.abs(Number(pad?.union_m2) - Number(pad?.sum_m2))).toBeLessThanOrEqual(0.05);
    expect(pad?.overlap_count).toBe(0);
    expect(pad?.display.sum_ft2).toBe(displayFromMetric(pad?.sum_m2 ?? "0", "ft2"));

    const overlapped = byId.get(overlapItem);
    expect(Number(overlapped?.union_m2)).toBeLessThan(Number(overlapped?.sum_m2) - 50);
    expect(overlapped?.overlap_count).toBe(1);

    const edge = byId.get(length);
    const edgeValue = saved.body.features.find((feature) => feature.properties.kind === "length");
    expect(edge?.sum_m).toBe(edgeValue?.properties.value_m);
    expect(byId.get(count)?.count).toBe(5);
  });

  it("reports a corrected self-intersection and keeps the stored shape valid", async () => {
    const job = await createJob();
    const item = await createItem("Bowtie", "area", "ft2");
    const takeoff = await createTakeoff(job.id, job.location_id);
    const id = createId();
    const saved = await putFeatures(takeoff.id, [
      {
        id,
        takeoff_item_id: item,
        kind: "area",
        geom: {
          type: "Polygon",
          coordinates: [
            [
              [-80, 35],
              [-79.999, 35.001],
              [-80, 35.001],
              [-79.999, 35],
              [-80, 35],
            ],
          ],
        },
      },
    ]);
    expect(saved.status, saved.raw).toBe(200);
    expect(saved.body.corrections).toEqual([
      expect.objectContaining({ id, reason: "self_intersection" }),
    ]);
    const valid = await requireAdmin().query<{ ok: boolean }>(
      "select ST_IsValid(geom) as ok from measurement where id = $1",
      [id],
    );
    expect(valid.rows[0]?.ok).toBe(true);
    expect(saved.body.features[0]?.properties.value_m2).toEqual(expect.any(String));
  });

  it("refuses disallowed, unverified, and unready imagery", async () => {
    const job = await createJob();
    const blocked = await requireApp().inject({
      method: "POST",
      url: `/jobs/${job.id}/takeoffs`,
      headers: headers(owner.cookie),
      payload: { kind: "aerial", location_id: job.location_id, imagery_capture_id: GOOGLE },
    });
    expect(blocked.statusCode, blocked.body).toBe(403);
    const viewing = await requireApp().inject({
      method: "POST",
      url: `/jobs/${job.id}/takeoffs`,
      headers: headers(owner.cookie),
      payload: { kind: "aerial", location_id: job.location_id, imagery_capture_id: VIEWING },
    });
    expect(viewing.statusCode, viewing.body).toBe(403);

    const unverifiedSource = createId();
    const unverifiedCapture = createId();
    const tracingOffSource = createId();
    const tracingOffCapture = createId();
    const ingestingSource = createId();
    const ingestingCapture = createId();
    const coverage = "SRID=4326;MULTIPOLYGON(((-81 35, -80 35, -80 36, -81 36, -81 35)))";
    try {
      await requireAdmin().query(
        `insert into imagery_source (id, provider, name, bands, allows_tracing, allows_ml_training, verified_at)
         values ($1, 'other', 'unverified', 'RGB', true, false, null),
                ($2, 'other', 'no-trace', 'RGB', false, false, now()),
                ($3, 'other', 'ingesting-source', 'RGB', true, false, now())`,
        [unverifiedSource, tracingOffSource, ingestingSource],
      );
      await requireAdmin().query(
        `insert into imagery_capture (
           id, source_id, coverage, capture_date, gsd_cm, bands, status
         ) values
           ($1, $2, $7::geometry, '2024-01-01', 15, 'RGB', 'ready'),
           ($3, $4, $7::geometry, '2024-01-01', 15, 'RGB', 'ready'),
           ($5, $6, $7::geometry, '2024-01-01', 15, 'RGB', 'ingesting')`,
        [
          unverifiedCapture,
          unverifiedSource,
          tracingOffCapture,
          tracingOffSource,
          ingestingCapture,
          ingestingSource,
          coverage,
        ],
      );
      for (const captureId of [unverifiedCapture, tracingOffCapture]) {
        const response = await requireApp().inject({
          method: "POST",
          url: `/jobs/${job.id}/takeoffs`,
          headers: headers(owner.cookie),
          payload: {
            kind: "aerial",
            location_id: job.location_id,
            imagery_capture_id: captureId,
          },
        });
        expect(response.statusCode, response.body).toBe(403);
      }
      const ingesting = await requireApp().inject({
        method: "POST",
        url: `/jobs/${job.id}/takeoffs`,
        headers: headers(owner.cookie),
        payload: {
          kind: "aerial",
          location_id: job.location_id,
          imagery_capture_id: ingestingCapture,
        },
      });
      expect(ingesting.statusCode, ingesting.body).toBe(409);
    } finally {
      await requireAdmin().query("delete from imagery_capture where id = any($1::uuid[])", [
        [unverifiedCapture, tracingOffCapture, ingestingCapture],
      ]);
      await requireAdmin().query("delete from imagery_source where id = any($1::uuid[])", [
        [unverifiedSource, tracingOffSource, ingestingSource],
      ]);
    }
  });

  it("asks for confirmation before changing a capture that already has measurements", async () => {
    const job = await createJob();
    const item = await createItem("Drive", "area", "ft2");
    const takeoff = await createTakeoff(job.id, job.location_id);
    const empty = await requireApp().inject({
      method: "PATCH",
      url: `/takeoffs/${takeoff.id}`,
      headers: headers(owner.cookie),
      payload: { imagery_capture_id: NC_ORTHO },
    });
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json().warnings).toEqual([]);
    const saved = await putFeatures(takeoff.id, [
      {
        id: createId(),
        takeoff_item_id: item,
        kind: "area",
        geom: squareAt(35, -81.7),
      },
    ]);
    expect(saved.status, saved.raw).toBe(200);
    const denied = await requireApp().inject({
      method: "PATCH",
      url: `/takeoffs/${takeoff.id}`,
      headers: headers(owner.cookie),
      payload: { imagery_capture_id: HELENE },
    });
    expect(denied.statusCode, denied.body).toBe(409);
    const confirmed = await requireApp().inject({
      method: "PATCH",
      url: `/takeoffs/${takeoff.id}`,
      headers: headers(owner.cookie),
      payload: { imagery_capture_id: HELENE, confirm: true },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().warnings[0]).toContain("different capture");
    expect(confirmed.json().measurement_count).toBe(1);
  });

  it("clones a final takeoff and leaves the old version read-only", async () => {
    const job = await createJob();
    const item = await createItem("Final pad", "area", "ft2");
    const takeoff = await createTakeoff(job.id, job.location_id);
    const measurementId = createId();
    const saved = await putFeatures(takeoff.id, [
      { id: measurementId, takeoff_item_id: item, kind: "area", geom: squareAt(35) },
    ]);
    expect(saved.status, saved.raw).toBe(200);
    const jump = await requireApp().inject({
      method: "PATCH",
      url: `/takeoffs/${takeoff.id}`,
      headers: headers(owner.cookie),
      payload: { status: "final" },
    });
    expect(jump.statusCode, jump.body).toBe(409);
    const review = await requireApp().inject({
      method: "PATCH",
      url: `/takeoffs/${takeoff.id}`,
      headers: headers(owner.cookie),
      payload: { status: "in_review" },
    });
    expect(review.statusCode, review.body).toBe(200);
    const back = await requireApp().inject({
      method: "PATCH",
      url: `/takeoffs/${takeoff.id}`,
      headers: headers(owner.cookie),
      payload: { status: "draft" },
    });
    expect(back.statusCode, back.body).toBe(409);
    const final = await requireApp().inject({
      method: "PATCH",
      url: `/takeoffs/${takeoff.id}`,
      headers: headers(owner.cookie),
      payload: { status: "final" },
    });
    expect(final.statusCode, final.body).toBe(200);
    expect(final.json().status).toBe("final");
    const locked = await putFeatures(takeoff.id, [
      { id: measurementId, takeoff_item_id: item, kind: "area", geom: squareAt(36) },
    ]);
    expect(locked.status, locked.raw).toBe(409);
    const removed = await requireApp().inject({
      method: "DELETE",
      url: `/measurements/${measurementId}`,
      headers: headers(owner.cookie, workspaceId, false),
    });
    expect(removed.statusCode, removed.body).toBe(409);
    const cloned = await requireApp().inject({
      method: "PATCH",
      url: `/takeoffs/${takeoff.id}`,
      headers: headers(owner.cookie),
      payload: { status: "draft" },
    });
    expect(cloned.statusCode, cloned.body).toBe(200);
    expect(cloned.json().id).not.toBe(takeoff.id);
    expect(cloned.json().version).toBe(2);
    expect(cloned.json().status).toBe("draft");
    expect(cloned.json().supersedes_id).toBe(takeoff.id);
    const original = await requireApp().inject({
      method: "GET",
      url: `/takeoffs/${takeoff.id}`,
      headers: headers(owner.cookie),
    });
    expect(original.json().status).toBe("final");
    expect(original.json().version).toBe(1);
    const copy = await requireApp().inject({
      method: "GET",
      url: `/takeoffs/${cloned.json().id}/measurements`,
      headers: headers(owner.cookie),
    });
    expect(copy.statusCode, copy.body).toBe(200);
    expect(copy.json().features).toHaveLength(1);
    expect(copy.json().features[0].id).not.toBe(measurementId);
    expect(copy.json().features[0].properties.value_m2).toBe(
      saved.body.features[0]?.properties.value_m2,
    );
    await expect(
      requireAdmin().query("update takeoff set kind = 'planset' where id = $1", [takeoff.id]),
    ).rejects.toThrow(/read-only/);
  });

  it("returns 404 across workspaces and 403 without takeoff access", async () => {
    const job = await createJob();
    const takeoff = await createTakeoff(job.id, job.location_id);
    const other = await signUp("Other Takeoff");
    const otherWorkspace = await createWorkspace(other.cookie, "Other Takeoff Co");
    const hidden = await requireApp().inject({
      method: "GET",
      url: `/takeoffs/${takeoff.id}`,
      headers: headers(other.cookie, otherWorkspace.id),
    });
    expect(hidden.statusCode, hidden.body).toBe(404);
    const office = await invite("office", "Office Reader");
    const readable = await requireApp().inject({
      method: "GET",
      url: `/takeoffs/${takeoff.id}`,
      headers: headers(office.cookie),
    });
    expect(readable.statusCode, readable.body).toBe(200);
    const denied = await requireApp().inject({
      method: "POST",
      url: `/jobs/${job.id}/takeoffs`,
      headers: headers(office.cookie),
      payload: { kind: "aerial", location_id: job.location_id, imagery_capture_id: HELENE },
    });
    expect(denied.statusCode, denied.body).toBe(403);
    const crew = await invite("crew", "Crew Member");
    const crewRead = await requireApp().inject({
      method: "GET",
      url: `/takeoffs/${takeoff.id}`,
      headers: headers(crew.cookie),
    });
    expect(crewRead.statusCode, crewRead.body).toBe(403);
  });

  it("lists the latest version of each lineage, newest first, and hides other tenants", async () => {
    const job = await createJob();
    const first = await createTakeoff(job.id, job.location_id);
    const review = await requireApp().inject({
      method: "PATCH",
      url: `/takeoffs/${first.id}`,
      headers: headers(owner.cookie),
      payload: { status: "in_review" },
    });
    expect(review.statusCode, review.body).toBe(200);
    const final = await requireApp().inject({
      method: "PATCH",
      url: `/takeoffs/${first.id}`,
      headers: headers(owner.cookie),
      payload: { status: "final" },
    });
    expect(final.statusCode, final.body).toBe(200);
    const cloned = await requireApp().inject({
      method: "PATCH",
      url: `/takeoffs/${first.id}`,
      headers: headers(owner.cookie),
      payload: { status: "draft" },
    });
    expect(cloned.statusCode, cloned.body).toBe(200);
    const second = await createTakeoff(job.id, job.location_id, NC_ORTHO);

    const listed = await requireApp().inject({
      method: "GET",
      url: `/jobs/${job.id}/takeoffs`,
      headers: headers(owner.cookie),
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const rows = listed.json().takeoffs as {
      id: string;
      status: string;
      version: number;
      imagery_capture_id: string;
      updated_at: string;
    }[];
    expect(rows.map((row) => row.id)).toEqual([second.id, cloned.json().id]);
    expect(rows[0]).toMatchObject({
      status: "draft",
      version: 1,
      imagery_capture_id: NC_ORTHO,
    });
    expect(rows[1]).toMatchObject({
      status: "draft",
      version: 2,
      imagery_capture_id: HELENE,
    });
    expect(rows[0]?.updated_at).toEqual(expect.any(String));
    expect(rows[1]?.updated_at).toEqual(expect.any(String));
    expect(Date.parse(rows[0]?.updated_at ?? "")).toBeGreaterThanOrEqual(
      Date.parse(rows[1]?.updated_at ?? ""),
    );

    const other = await signUp("List Other");
    const otherWorkspace = await createWorkspace(other.cookie, "List Other Co");
    const hidden = await requireApp().inject({
      method: "GET",
      url: `/jobs/${job.id}/takeoffs`,
      headers: headers(other.cookie, otherWorkspace.id),
    });
    expect(hidden.statusCode, hidden.body).toBe(404);
    const otherJob = await requireApp().inject({
      method: "POST",
      url: "/jobs",
      headers: headers(other.cookie, otherWorkspace.id),
      payload: {
        name: "Other lot",
        client: { name: "Bea", type: "residential" },
        address: "100 Main St, Morganton, NC 28655",
      },
    });
    expect(otherJob.statusCode, otherJob.body).toBe(201);
    const isolated = await requireApp().inject({
      method: "GET",
      url: `/jobs/${otherJob.json().id}/takeoffs`,
      headers: headers(other.cookie, otherWorkspace.id),
    });
    expect(isolated.statusCode, isolated.body).toBe(200);
    expect(isolated.json().takeoffs).toEqual([]);

    const crew = await invite("crew", "List Crew");
    const crewList = await requireApp().inject({
      method: "GET",
      url: `/jobs/${job.id}/takeoffs`,
      headers: headers(crew.cookie),
    });
    expect(crewList.statusCode, crewList.body).toBe(403);
  });

  it("returns parcels that intersect a bbox near the site", async () => {
    const job = await createJob();
    const location = await requireApp().inject({
      method: "GET",
      url: `/locations/${job.location_id}`,
      headers: headers(owner.cookie),
    });
    expect(location.statusCode, location.body).toBe(200);
    const point = location.json().point as { lat: number; lng: number };
    const pad = 0.002;
    const bbox = [point.lng - pad, point.lat - pad, point.lng + pad, point.lat + pad].join(",");
    const listed = await requireApp().inject({
      method: "GET",
      url: `/locations/${job.location_id}/parcels?bbox=${encodeURIComponent(bbox)}`,
      headers: headers(owner.cookie),
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const ids = (
      listed.json().parcels as { provider_parcel_id: string; geom: { type: string } }[]
    ).map((parcel) => parcel.provider_parcel_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        fixtureParcelId(point),
        fixtureNeighborParcelId(point, "e"),
        fixtureNeighborParcelId(point, "w"),
      ]),
    );
    expect(listed.json().parcels[0].geom.type).toBe("MultiPolygon");
    const far = await requireApp().inject({
      method: "GET",
      url: `/locations/${job.location_id}/parcels?bbox=-100,35,-99,36`,
      headers: headers(owner.cookie),
    });
    expect(far.statusCode, far.body).toBe(200);
    expect(far.json().parcels).toEqual([]);
    const missing = await requireApp().inject({
      method: "GET",
      url: `/locations/${job.location_id}/parcels`,
      headers: headers(owner.cookie),
    });
    expect(missing.statusCode, missing.body).toBe(400);
    const other = await signUp("Parcel Other");
    const otherWorkspace = await createWorkspace(other.cookie, "Parcel Other Co");
    const hidden = await requireApp().inject({
      method: "GET",
      url: `/locations/${job.location_id}/parcels?bbox=${encodeURIComponent(bbox)}`,
      headers: headers(other.cookie, otherWorkspace.id),
    });
    expect(hidden.statusCode, hidden.body).toBe(404);
  });

  it("exports GeoJSON and a stamped PNG, and hides them across workspaces", async () => {
    const job = await createJob();
    const item = await createItem("Export asphalt", "area", "ft2");
    const takeoff = await createTakeoff(job.id, job.location_id);
    const saved = await putFeatures(takeoff.id, [
      {
        id: createId(),
        takeoff_item_id: item,
        kind: "area",
        geom: squareAt(35.748741, -81.702576),
        source: "manual",
      },
    ]);
    expect(saved.status, saved.raw).toBe(200);
    const geo = await requireApp().inject({
      method: "GET",
      url: `/takeoffs/${takeoff.id}/export?format=geojson`,
      headers: headers(owner.cookie, workspaceId, false),
    });
    expect(geo.statusCode, geo.body).toBe(200);
    expect(geo.headers["content-type"]).toContain("application/geo+json");
    const collection = geo.json() as {
      type: string;
      features: { geometry: { type: string } }[];
      imagery: {
        provider: string;
        name: string;
        capture_date: string;
        gsd_cm: string;
        attribution: string;
      };
    };
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.geometry.type).toBe("Polygon");
    expect(collection.imagery.provider).toBe("nc_helene_2025");
    expect(collection.imagery.name).toBe("nc_helene_2025");
    expect(collection.imagery.capture_date).toBe("2025-04-15");
    expect(Number(collection.imagery.gsd_cm)).toBeCloseTo(15.24, 2);
    expect(collection.imagery.attribution).toContain("NC Collaboratory");
    const png = await requireApp().inject({
      method: "GET",
      url: `/takeoffs/${takeoff.id}/export?format=png`,
      headers: headers(owner.cookie, workspaceId, false),
    });
    expect(png.statusCode, png.body.slice(0, 80)).toBe(200);
    expect(png.headers["content-type"]).toContain("image/png");
    const bytes = png.rawPayload;
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.length).toBeGreaterThan(500);
    const text = bytes.toString("latin1");
    expect(text).toContain("NC Collaboratory");
    expect(text).toContain("2025-04-15");
    expect(text).toContain("15.24");
    expect(text).toContain("nc_helene_2025");
    const other = await signUp("Export Other");
    const otherWorkspace = await createWorkspace(other.cookie, "Export Other Co");
    const hidden = await requireApp().inject({
      method: "GET",
      url: `/takeoffs/${takeoff.id}/export?format=geojson`,
      headers: headers(other.cookie, otherWorkspace.id, false),
    });
    expect(hidden.statusCode, hidden.body).toBe(404);
  });

  it("returns measurements in a tile and throttles the workspace", async () => {
    resetFeatureTileThrottle();
    const job = await createJob();
    const item = await createItem("Tile asphalt", "area", "ft2");
    const takeoff = await createTakeoff(job.id, job.location_id);
    const origin = { lng: -81.702576, lat: 35.748741 };
    const saved = await putFeatures(takeoff.id, [
      {
        id: createId(),
        takeoff_item_id: item,
        kind: "area",
        geom: squareAt(origin.lat, origin.lng),
        source: "manual",
      },
    ]);
    expect(saved.status, saved.raw).toBe(200);
    const tile = lngLatToTile(origin.lng, origin.lat, 16);
    const first = await requireApp().inject({
      method: "GET",
      url: `/takeoffs/${takeoff.id}/measurements/tiles/16/${tile.x}/${tile.y}`,
      headers: headers(owner.cookie),
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().type).toBe("FeatureCollection");
    expect(first.json().features).toHaveLength(1);
    const outside = await requireApp().inject({
      method: "GET",
      url: `/takeoffs/${takeoff.id}/measurements/tiles/16/0/0`,
      headers: headers(owner.cookie),
    });
    expect(outside.statusCode, outside.body).toBe(200);
    expect(outside.json().features).toEqual([]);
    let limited = first;
    for (let call = 2; call <= TILE_CALL_LIMIT + 1; call += 1) {
      limited = await requireApp().inject({
        method: "GET",
        url: `/takeoffs/${takeoff.id}/measurements/tiles/16/${tile.x}/${tile.y}`,
        headers: headers(owner.cookie),
      });
    }
    expect(limited.statusCode, limited.body).toBe(429);
  });

  it("rejects an illegal status update in the database", async () => {
    const job = await createJob();
    const takeoff = await createTakeoff(job.id, job.location_id);
    await expect(
      requireAdmin().query("update takeoff set status = 'final' where id = $1", [takeoff.id]),
    ).rejects.toThrow(/illegal takeoff transition/);
  });
});
