import { createHash } from "node:crypto";

import { createId, transitionDetectionRun } from "@groundwork/shared";
import type { Kysely } from "kysely";
import { sql } from "kysely";

import { aiAssistEnabled } from "../config.js";
import type { Database } from "../db/types.js";
import { withWorkspaceContext } from "../db/workspace.js";
import { ProblemError } from "../errors.js";
import { cropStoredCog, type Chip } from "./chip.js";
import { segmentPrompt, type CvPoint } from "./cv-client.js";
import { getTakeoff, requireMeasurableCapture, type CaptureRecord } from "./data.js";
import { mapToPixel, pixelToMap, polygonWkt, simplifyRing, type Affine } from "./pixels.js";
import { ASSIST_READ_TABLES, assertCvInputsExcludeParcelCache } from "./training-guard.js";

/** Spec 05. Polygons smaller than this are dropped after the clip. */
export const SLIVER_MIN_M2 = 2;
/** Spec 05. The chip is the site boundary expanded by this many meters. */
export const SITE_BUFFER_M = 10;
export const ASSIST_TIMEOUT_MS = 10_000;

type Db = Kysely<Database>;

export type AssistPoint = { lng: number; lat: number; label: 0 | 1 };
export type AssistBox = { west: number; south: number; east: number; north: number };

export type AssistRequest = {
  imagery_capture_id: string;
  takeoff_item_id: string;
  points: AssistPoint[];
  box?: AssistBox | undefined;
};

export type AssistFeature = {
  id: string;
  geometry: { type: string; coordinates: unknown };
  properties: {
    class: string | null;
    score: number | null;
    area_m2: string;
    takeoff_item_id: string | null;
  };
};

export type AssistResult = {
  run_id: string;
  status: "succeeded";
  features: AssistFeature[];
};

type Prepared = {
  capture: CaptureRecord;
  cogKey: string;
  west: number;
  south: number;
  east: number;
  north: number;
  siteGeojson: string;
  gsdCm: number;
};

type RunRow = {
  id: string;
  status: string;
  request_hash: string;
  error: string | null;
};

function badRequest(detail: string): ProblemError {
  return new ProblemError({ status: 400, title: "Bad Request", detail });
}

function conflict(detail: string): ProblemError {
  return new ProblemError({ status: 409, title: "Conflict", detail });
}

function notFound(detail: string): ProblemError {
  return new ProblemError({ status: 404, title: "Not Found", detail });
}

export function assistRequestHash(takeoffId: string, body: AssistRequest): string {
  const canonical = JSON.stringify({
    takeoff_id: takeoffId,
    imagery_capture_id: body.imagery_capture_id,
    takeoff_item_id: body.takeoff_item_id,
    points: body.points,
    box: body.box ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function assertPrompt(body: AssistRequest): void {
  const box = body.box;
  if (box && (box.west >= box.east || box.south >= box.north)) {
    throw badRequest("The box needs a positive width and height.");
  }
  const positive = body.points.some((point) => point.label === 1);
  if (!box && !positive) {
    throw badRequest("Assist needs a box or a positive point.");
  }
}

function featuresEnabled(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (value as Record<string, unknown>).ai_assist === true;
}

function parseGeometry(value: string): { type: string; coordinates: unknown } {
  const parsed: unknown = JSON.parse(value);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("type" in parsed) ||
    !("coordinates" in parsed) ||
    typeof parsed.type !== "string"
  ) {
    throw new Error("Stored geometry was not GeoJSON.");
  }
  return { type: parsed.type, coordinates: parsed.coordinates };
}

function presentFeature(row: {
  id: string;
  class: string | null;
  score: number | null;
  takeoff_item_id: string | null;
  geojson: string;
  area_m2: string;
}): AssistFeature {
  return {
    id: row.id,
    geometry: parseGeometry(row.geojson),
    properties: {
      class: row.class,
      score: row.score,
      area_m2: row.area_m2,
      takeoff_item_id: row.takeoff_item_id,
    },
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "";
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
  }
  if (error instanceof Error && error.cause) {
    return errorCode(error.cause);
  }
  return undefined;
}

async function loadFeatures(db: Db, workspaceId: string, runId: string): Promise<AssistFeature[]> {
  return withWorkspaceContext(db, workspaceId, async (trx) => {
    const result = await sql<{
      id: string;
      class: string | null;
      score: number | null;
      takeoff_item_id: string | null;
      geojson: string;
      area_m2: string;
    }>`
      select
        id::text as id,
        class,
        score,
        takeoff_item_id::text as takeoff_item_id,
        ST_AsGeoJSON(geom) as geojson,
        ST_Area(geom::geography)::numeric(14, 4)::text as area_m2
      from detection_feature
      where run_id = ${runId}::uuid
      order by id
    `.execute(trx);
    return result.rows.map(presentFeature);
  });
}

async function findRun(db: Db, workspaceId: string, key: string): Promise<RunRow | undefined> {
  return withWorkspaceContext(db, workspaceId, async (trx) => {
    const result = await sql<RunRow>`
      select id::text as id, status, request_hash, error
      from detection_run
      where idempotency_key = ${key}
    `.execute(trx);
    return result.rows[0];
  });
}

function replayOrConflict(existing: RunRow, requestHash: string): "replay" | "busy" {
  if (existing.request_hash !== requestHash) {
    throw conflict("That idempotency key was already used for a different assist.");
  }
  if (existing.status === "succeeded") {
    return "replay";
  }
  if (existing.status === "failed") {
    throw conflict("That assist already failed. Start it again with a new idempotency key.");
  }
  return "busy";
}

async function prepare(
  db: Db,
  input: { workspaceId: string; takeoffId: string; body: AssistRequest },
): Promise<Prepared> {
  return withWorkspaceContext(db, input.workspaceId, async (trx) => {
    const workspace = await sql<{ features: unknown }>`
      select features from workspace where id = ${input.workspaceId}
    `.execute(trx);
    if (!featuresEnabled(workspace.rows[0]?.features)) {
      throw new ProblemError({
        status: 403,
        title: "Forbidden",
        detail: "AI assist is not enabled for this workspace.",
      });
    }

    const takeoff = await getTakeoff(trx, input.takeoffId);
    if (takeoff.kind !== "aerial") {
      throw conflict("Assist runs on an aerial takeoff.");
    }
    if (takeoff.status === "final") {
      throw conflict("A final takeoff is read-only. Reopen it to draft a new version.");
    }
    if (!takeoff.location_id) {
      throw conflict("Assist needs a location.");
    }

    const capture = await requireMeasurableCapture(trx, input.body.imagery_capture_id);
    const cog = await sql<{ cog_key: string | null }>`
      select cog_key from imagery_capture where id = ${capture.id}::uuid
    `.execute(trx);
    const cogKey = cog.rows[0]?.cog_key;
    if (!cogKey) {
      throw conflict("That imagery capture has no COG.");
    }

    const site = await sql<{
      has_site: boolean;
      west: number | null;
      south: number | null;
      east: number | null;
      north: number | null;
      site_geojson: string | null;
      covered: boolean | null;
    }>`
      select
        site_geom is not null as has_site,
        ST_XMin(env)::float8 as west,
        ST_YMin(env)::float8 as south,
        ST_XMax(env)::float8 as east,
        ST_YMax(env)::float8 as north,
        ST_AsGeoJSON(ST_MakeValid(site_geom)) as site_geojson,
        case
          when env is null then null
          else ST_Covers(capture.coverage, env)
        end as covered
      from location
      join imagery_capture capture on capture.id = ${capture.id}::uuid
      left join lateral (
        select ST_SetSRID(
          ST_Envelope(
            ST_Buffer(ST_MakeValid(site_geom)::geography, ${SITE_BUFFER_M})::geometry
          ),
          4326
        ) as env
      ) expanded on true
      where location.id = ${takeoff.location_id}::uuid
    `.execute(trx);
    const bounds = site.rows[0];
    if (!bounds) {
      throw notFound("That location was not found.");
    }
    if (!bounds.has_site || bounds.site_geojson === null) {
      throw conflict("Assist needs a site boundary on the location.");
    }
    if (
      bounds.west === null ||
      bounds.south === null ||
      bounds.east === null ||
      bounds.north === null ||
      bounds.covered !== true
    ) {
      throw conflict("That site crosses more than one capture date. Assist uses a single capture.");
    }

    const item = await sql<{ measure_kind: string; archived_at: Date | null }>`
      select measure_kind, archived_at
      from takeoff_item
      where id = ${input.body.takeoff_item_id}::uuid
    `.execute(trx);
    const takeoffItem = item.rows[0];
    if (!takeoffItem) {
      throw notFound("That takeoff item was not found.");
    }
    if (takeoffItem.archived_at) {
      throw conflict("That takeoff item is archived.");
    }
    if (takeoffItem.measure_kind !== "area") {
      throw conflict("Assist draws an area. That takeoff item is not an area.");
    }

    assertCvInputsExcludeParcelCache(ASSIST_READ_TABLES);
    return {
      capture,
      cogKey,
      west: bounds.west,
      south: bounds.south,
      east: bounds.east,
      north: bounds.north,
      siteGeojson: bounds.site_geojson,
      gsdCm: Number(capture.gsd_cm),
    };
  });
}

async function claimRun(
  db: Db,
  input: {
    workspaceId: string;
    memberId: string;
    takeoffId: string;
    captureId: string;
    idempotencyKey: string;
    requestHash: string;
  },
): Promise<{ id: string; replay: boolean }> {
  const existing = await findRun(db, input.workspaceId, input.idempotencyKey);
  if (existing) {
    const action = replayOrConflict(existing, input.requestHash);
    if (action === "replay") {
      return { id: existing.id, replay: true };
    }
    throw conflict("That assist is already running.");
  }

  const id = createId();
  try {
    await withWorkspaceContext(db, input.workspaceId, async (trx) => {
      await sql`
        insert into detection_run (
          id, workspace_id, takeoff_id, imagery_capture_id, mode, status,
          idempotency_key, request_hash, created_by
        ) values (
          ${id}::uuid,
          ${input.workspaceId}::uuid,
          ${input.takeoffId}::uuid,
          ${input.captureId}::uuid,
          'assist',
          'queued',
          ${input.idempotencyKey},
          ${input.requestHash},
          ${input.memberId}
        )
      `.execute(trx);
      transitionDetectionRun("queued", "running");
      await sql`
        update detection_run set status = 'running' where id = ${id}::uuid
      `.execute(trx);
    });
  } catch (error) {
    if (
      errorCode(error) === "23505" ||
      errorText(error).includes("detection_run_workspace_id_idempotency_key")
    ) {
      const raced = await findRun(db, input.workspaceId, input.idempotencyKey);
      if (raced && replayOrConflict(raced, input.requestHash) === "replay") {
        return { id: raced.id, replay: true };
      }
      throw conflict("That assist is already running.");
    }
    throw error;
  }
  return { id, replay: false };
}

async function failRun(db: Db, workspaceId: string, runId: string, code: string): Promise<void> {
  await withWorkspaceContext(db, workspaceId, async (trx) => {
    transitionDetectionRun("running", "failed");
    await sql`
      update detection_run
      set status = 'failed', error = ${code}
      where id = ${runId}::uuid and status = 'running'
    `.execute(trx);
  });
}

async function project(
  db: Db,
  workspaceId: string,
  epsg: number,
  lng: number,
  lat: number,
): Promise<[number, number]> {
  return withWorkspaceContext(db, workspaceId, async (trx) => {
    const result = await sql<{ x: number; y: number }>`
      select ST_X(g)::float8 as x, ST_Y(g)::float8 as y
      from ST_Transform(
        ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326),
        ${epsg}::int
      ) as g
    `.execute(trx);
    const row = result.rows[0];
    if (!row) {
      throw new Error("The point could not be projected.");
    }
    return [row.x, row.y];
  });
}

async function toPixels(
  db: Db,
  workspaceId: string,
  chip: Chip,
  body: AssistRequest,
): Promise<{ points: CvPoint[]; box: [number, number, number, number] | null }> {
  const transform = chip.transform;
  const points: CvPoint[] = [];
  for (const point of body.points) {
    const [x, y] = await project(db, workspaceId, chip.crsEpsg, point.lng, point.lat);
    const [col, row] = mapToPixel(x, y, transform);
    points.push({ x: col, y: row, label: point.label });
  }
  if (!body.box) {
    return { points, box: null };
  }
  const corners = [
    [body.box.west, body.box.south],
    [body.box.east, body.box.south],
    [body.box.east, body.box.north],
    [body.box.west, body.box.north],
  ] as const;
  const pixels: [number, number][] = [];
  for (const [lng, lat] of corners) {
    const [x, y] = await project(db, workspaceId, chip.crsEpsg, lng, lat);
    pixels.push(mapToPixel(x, y, transform));
  }
  const cols = pixels.map((pixel) => pixel[0]);
  const rows = pixels.map((pixel) => pixel[1]);
  return {
    points,
    box: [Math.min(...cols), Math.min(...rows), Math.max(...cols), Math.max(...rows)],
  };
}

function wktsFor(polygons: [number, number][][], transform: Affine, tolerancePx: number): string[] {
  const wkts: string[] = [];
  for (const ring of polygons) {
    const simplified = simplifyRing(ring, tolerancePx);
    if (simplified.length < 4) {
      continue;
    }
    const mapped = simplified.map(
      (point) => pixelToMap(point[0]!, point[1]!, transform) as [number, number],
    );
    wkts.push(polygonWkt(mapped));
  }
  return wkts;
}

async function storePolygons(
  db: Db,
  input: {
    workspaceId: string;
    memberId: string;
    runId: string;
    takeoffItemId: string;
    siteGeojson: string;
    epsg: number;
    wkts: string[];
    gpuSeconds: number;
  },
): Promise<AssistFeature[]> {
  return withWorkspaceContext(db, input.workspaceId, async (trx) => {
    const features: AssistFeature[] = [];
    for (const wkt of input.wkts) {
      const kept = await sql<{ geojson: string; area_m2: string }>`
        with warped as (
          select ST_ForcePolygonCCW(
            ST_MakeValid(ST_Transform(ST_GeomFromText(${wkt}, ${input.epsg}), 4326))
          ) as geom
        ),
        clipped as (
          select ST_CollectionExtract(
            ST_MakeValid(
              ST_Intersection(
                warped.geom,
                ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${input.siteGeojson}), 4326))
              )
            ),
            3
          ) as geom
          from warped
        ),
        parts as (
          select (ST_Dump(geom)).geom as geom
          from clipped
          where geom is not null and not ST_IsEmpty(geom)
        )
        select
          ST_AsGeoJSON(ST_ForcePolygonCCW(geom)) as geojson,
          ST_Area(geom::geography)::numeric(14, 4)::text as area_m2
        from parts
        where ST_Area(geom::geography) >= ${SLIVER_MIN_M2}
          and ST_GeometryType(geom) in ('ST_Polygon', 'ST_MultiPolygon')
      `.execute(trx);
      for (const part of kept.rows) {
        const id = createId();
        await sql`
          insert into detection_feature (
            id, workspace_id, run_id, geom, takeoff_item_id, created_by
          ) values (
            ${id}::uuid,
            ${input.workspaceId}::uuid,
            ${input.runId}::uuid,
            ST_SetSRID(ST_GeomFromGeoJSON(${part.geojson}), 4326),
            ${input.takeoffItemId}::uuid,
            ${input.memberId}
          )
        `.execute(trx);
        features.push(
          presentFeature({
            id,
            class: null,
            score: null,
            takeoff_item_id: input.takeoffItemId,
            geojson: part.geojson,
            area_m2: part.area_m2,
          }),
        );
      }
    }
    transitionDetectionRun("running", "succeeded");
    await sql`
      update detection_run
      set status = 'succeeded', gpu_seconds = ${input.gpuSeconds}
      where id = ${input.runId}::uuid
    `.execute(trx);
    await sql`
      insert into usage_event (workspace_id, kind, units, cost_estimate_cents)
      values (${input.workspaceId}::uuid, 'cv_infer', ${input.gpuSeconds}, 0)
    `.execute(trx);
    await sql`
      insert into audit_log (workspace_id, actor_member_id, entity_type, entity_id, action, diff)
      values (
        ${input.workspaceId}::uuid,
        ${input.memberId}::uuid,
        'detection_run',
        ${input.runId}::uuid,
        'assist',
        ${JSON.stringify({ features: features.length, gpu_seconds: input.gpuSeconds })}::jsonb
      )
    `.execute(trx);
    return features;
  });
}

function failureCode(error: unknown): string {
  if (error instanceof ProblemError) {
    if (error.statusCode === 504) {
      return "timeout";
    }
    if (error.problemBody.detail === "The segmentation service rejected the chip.") {
      return "model";
    }
    if (error.problemBody.detail === "The imagery chip could not be read.") {
      return "chip";
    }
  }
  return "infra";
}

export async function runAssist(
  db: Db,
  input: {
    workspaceId: string;
    memberId: string;
    takeoffId: string;
    body: AssistRequest;
    idempotencyKey: string;
  },
): Promise<AssistResult> {
  await withWorkspaceContext(db, input.workspaceId, async (trx) => {
    await getTakeoff(trx, input.takeoffId);
  });
  if (!aiAssistEnabled()) {
    throw new ProblemError({
      status: 403,
      title: "Forbidden",
      detail: "AI assist is turned off.",
    });
  }
  assertPrompt(input.body);
  const requestHash = assistRequestHash(input.takeoffId, input.body);
  const prepared = await prepare(db, input);
  const claimed = await claimRun(db, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    takeoffId: input.takeoffId,
    captureId: prepared.capture.id,
    idempotencyKey: input.idempotencyKey,
    requestHash,
  });
  if (claimed.replay) {
    return {
      run_id: claimed.id,
      status: "succeeded",
      features: await loadFeatures(db, input.workspaceId, claimed.id),
    };
  }

  const deadline = Date.now() + ASSIST_TIMEOUT_MS;
  try {
    const chip = await cropStoredCog({
      cogKey: prepared.cogKey,
      west: prepared.west,
      south: prepared.south,
      east: prepared.east,
      north: prepared.north,
      deadlineMs: deadline,
    });
    const prompt = await toPixels(db, input.workspaceId, chip, input.body);
    const segmented = await segmentPrompt(
      {
        chip: chip.chipBase64,
        transform: [...chip.transform],
        points: prompt.points,
        box: prompt.box,
      },
      deadline,
    );
    const gsdM = prepared.gsdCm / 100;
    const tolerancePx = chip.groundPixelM > 0 ? (0.5 * gsdM) / chip.groundPixelM : 0;
    const wkts = wktsFor(segmented.polygons_px, chip.transform, tolerancePx);
    const features = await storePolygons(db, {
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      runId: claimed.id,
      takeoffItemId: input.body.takeoff_item_id,
      siteGeojson: prepared.siteGeojson,
      epsg: chip.crsEpsg,
      wkts,
      gpuSeconds: segmented.gpu_seconds,
    });
    return { run_id: claimed.id, status: "succeeded", features };
  } catch (error) {
    try {
      await failRun(db, input.workspaceId, claimed.id, failureCode(error));
    } catch {
      // The original failure is the one the caller should see.
    }
    throw error;
  }
}
