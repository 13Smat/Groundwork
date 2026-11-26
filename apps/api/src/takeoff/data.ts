import { displayFromMetric, type DisplayUnit, type GeoJsonGeometry } from "@groundwork/geo";
import { createId } from "@groundwork/shared";
import { sql, type Transaction } from "kysely";

import type { Database } from "../db/types.js";
import { ProblemError } from "../errors.js";
import type { MeasurementInput } from "./geometry.js";

type Trx = Transaction<Database>;

export const CAPTURE_CONFIRM_DETAIL =
  "Changing the imagery capture on a takeoff that already has measurements needs confirm: true.";

/** Intersection thinner than this is a shared edge, not an overlap. ADR 0013. */
const OVERLAP_M2 = 0.01;

export type TakeoffKind = "aerial" | "planset";
export type TakeoffStatus = "draft" | "in_review" | "final";

export type TakeoffRecord = {
  id: string;
  job_id: string;
  location_id: string | null;
  lineage_id: string;
  supersedes_id: string | null;
  kind: TakeoffKind;
  imagery_capture_id: string | null;
  status: TakeoffStatus;
  version: number;
  measurement_count: number;
  created_at: Date;
  updated_at: Date;
};

export type CaptureRecord = {
  id: string;
  status: string;
  allows_tracing: boolean;
  verified: boolean;
  capture_date: string;
  gsd_cm: string;
};

export type StoredFeature = {
  id: string;
  takeoff_item_id: string;
  kind: MeasurementInput["kind"];
  value_m2: string | null;
  value_m: string | null;
  count: number | null;
  source: MeasurementInput["source"];
  confidence: number | null;
  label: string | null;
  deductions: unknown;
  geometry: GeoJsonGeometry;
};

export type MeasurementCorrection = {
  id: string;
  reason: "self_intersection";
  geometry: GeoJsonGeometry;
};

export type MeasurementOverlap = {
  takeoff_item_id: string;
  measurement_ids: [string, string];
};

export type SummaryItem = {
  takeoff_item_id: string;
  name: string;
  measure_kind: MeasurementInput["kind"];
  sum_m2: string | null;
  sum_m: string | null;
  union_m2: string | null;
  union_m: string | null;
  count: number | null;
  overlap_count: number;
  display: {
    sum_ft2: string | null;
    sum_yd2: string | null;
    sum_acres: string | null;
    union_ft2: string | null;
    union_yd2: string | null;
    union_acres: string | null;
    sum_ft: string | null;
    union_ft: string | null;
  };
};

function notFound(detail: string): ProblemError {
  return new ProblemError({ status: 404, title: "Not Found", detail });
}

function conflict(detail: string): ProblemError {
  return new ProblemError({ status: 409, title: "Conflict", detail });
}

function badRequest(detail: string): ProblemError {
  return new ProblemError({ status: 400, title: "Bad Request", detail });
}

type ErrorNode = { message?: unknown; code?: unknown; cause?: unknown };

function errorNodes(error: unknown): ErrorNode[] {
  const nodes: ErrorNode[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    nodes.push(current as ErrorNode);
    current = (current as ErrorNode).cause;
  }
  return nodes;
}

function errorText(error: unknown): string {
  return errorNodes(error)
    .map((node) => (typeof node.message === "string" ? node.message : ""))
    .filter((message) => message !== "")
    .join("\n");
}

function errorCode(error: unknown): string | undefined {
  for (const node of errorNodes(error)) {
    if (typeof node.code === "string") {
      return node.code;
    }
  }
  return undefined;
}

function rethrowTakeoff(error: unknown): never {
  const text = errorText(error);
  const code = errorCode(error);
  if (
    text.includes("a final takeoff is read-only") ||
    text.includes("measurements on a final takeoff")
  ) {
    throw conflict("A final takeoff is read-only. Reopen it to draft a new version.");
  }
  if (text.includes("illegal takeoff transition")) {
    throw conflict("That takeoff status change is not allowed.");
  }
  if (text.includes("takeoff not visible") || text.includes("cannot move to another takeoff")) {
    throw conflict("That measurement does not belong to this takeoff.");
  }
  if (code === "23505") {
    throw conflict("This takeoff lineage already has an open version.");
  }
  if (code === "23514") {
    throw badRequest("A measurement could not be stored.");
  }
  if (code === "42501" || text.toLowerCase().includes("row-level security")) {
    throw conflict("That measurement id belongs to another workspace.");
  }
  if (
    text.includes("GeoJSON") ||
    text.includes("parse error") ||
    text.includes("geometry") ||
    code === "22023" ||
    code === "XX000"
  ) {
    throw badRequest("One of the geometries could not be measured.");
  }
  throw error;
}

function parseGeometryJson(value: string): GeoJsonGeometry {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
    throw new Error("Stored geometry was not GeoJSON.");
  }
  return parsed as GeoJsonGeometry;
}

function displayOrNull(metric: string | null, unit: DisplayUnit): string | null {
  if (metric === null) {
    return null;
  }
  return displayFromMetric(metric, unit);
}

export function captureChangeWarning(capture: CaptureRecord): string {
  return `Measurements stay in geographic coordinates. They were drawn on a different capture (${capture.capture_date}, ${capture.gsd_cm} cm GSD).`;
}

export async function loadJob(
  trx: Trx,
  jobId: string,
): Promise<{ id: string; location_id: string | null } | undefined> {
  const result = await sql<{ id: string; location_id: string | null }>`
    select id::text as id, location_id::text as location_id
    from job
    where id = ${jobId}::uuid
  `.execute(trx);
  return result.rows[0];
}

export async function locationExists(trx: Trx, locationId: string): Promise<boolean> {
  const result = await sql<{ id: string }>`
    select id::text as id from location where id = ${locationId}::uuid
  `.execute(trx);
  return result.rows.length > 0;
}

export async function loadCapture(trx: Trx, captureId: string): Promise<CaptureRecord | undefined> {
  const result = await sql<CaptureRecord>`
    select
      c.id::text as id,
      c.status,
      s.allows_tracing,
      (s.verified_at is not null) as verified,
      c.capture_date::text as capture_date,
      c.gsd_cm::text as gsd_cm
    from imagery_capture c
    join imagery_source s on s.id = c.source_id
    where c.id = ${captureId}::uuid
  `.execute(trx);
  return result.rows[0];
}

/**
 * 404 when the capture is missing, 403 when tracing is off or the source is
 * unverified, 409 when the capture is not ready. Policy wins over status.
 */
export async function requireMeasurableCapture(
  trx: Trx,
  captureId: string,
): Promise<CaptureRecord> {
  const capture = await loadCapture(trx, captureId);
  if (!capture) {
    throw notFound("That imagery capture was not found.");
  }
  if (!capture.allows_tracing || !capture.verified) {
    throw new ProblemError({
      status: 403,
      title: "Forbidden",
      detail:
        "That imagery capture cannot be measured. Tracing is not allowed or the source is not verified.",
    });
  }
  if (capture.status !== "ready") {
    throw conflict("That imagery capture is not ready.");
  }
  return capture;
}

async function readTakeoff(trx: Trx, takeoffId: string): Promise<TakeoffRecord | undefined> {
  const result = await sql<TakeoffRecord>`
    select
      t.id::text as id,
      t.job_id::text as job_id,
      t.location_id::text as location_id,
      t.lineage_id::text as lineage_id,
      t.supersedes_id::text as supersedes_id,
      t.kind,
      t.imagery_capture_id::text as imagery_capture_id,
      t.status,
      t.version,
      (select count(*)::int from measurement m where m.takeoff_id = t.id) as measurement_count,
      t.created_at,
      t.updated_at
    from takeoff t
    where t.id = ${takeoffId}::uuid
  `.execute(trx);
  return result.rows[0];
}

/** Latest row of each lineage, newest activity first. Row security hides other tenants. */
export async function listTakeoffsForJob(trx: Trx, jobId: string): Promise<TakeoffRecord[]> {
  const result = await sql<TakeoffRecord>`
    select
      id::text as id,
      job_id::text as job_id,
      location_id::text as location_id,
      lineage_id::text as lineage_id,
      supersedes_id::text as supersedes_id,
      kind,
      imagery_capture_id::text as imagery_capture_id,
      status,
      version::int as version,
      measurement_count::int as measurement_count,
      created_at,
      updated_at
    from (
      select distinct on (t.lineage_id)
        t.id,
        t.job_id,
        t.location_id,
        t.lineage_id,
        t.supersedes_id,
        t.kind,
        t.imagery_capture_id,
        t.status,
        t.version,
        (select count(*)::int from measurement m where m.takeoff_id = t.id) as measurement_count,
        t.created_at,
        t.updated_at
      from takeoff t
      where t.job_id = ${jobId}::uuid
      order by t.lineage_id, t.version desc
    ) latest
    order by updated_at desc, id desc
  `.execute(trx);
  return result.rows;
}

export async function getTakeoff(trx: Trx, takeoffId: string): Promise<TakeoffRecord> {
  const takeoff = await readTakeoff(trx, takeoffId);
  if (!takeoff) {
    throw notFound("That takeoff was not found.");
  }
  return takeoff;
}

export async function insertTakeoff(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    jobId: string;
    locationId: string | null;
    kind: TakeoffKind;
    imageryCaptureId: string | null;
  },
): Promise<TakeoffRecord> {
  const id = createId();
  await sql`
    insert into takeoff (
      id, workspace_id, job_id, location_id, lineage_id, kind,
      imagery_capture_id, status, version, created_by
    ) values (
      ${id}::uuid,
      ${input.workspaceId}::uuid,
      ${input.jobId}::uuid,
      ${input.locationId}::uuid,
      ${id}::uuid,
      ${input.kind},
      ${input.imageryCaptureId}::uuid,
      'draft',
      1,
      ${input.memberId}
    )
  `.execute(trx);
  await writeAudit(trx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    takeoffId: id,
    action: "create",
    diff: { kind: input.kind, version: 1, status: "draft" },
  });
  return getTakeoff(trx, id);
}

export async function advanceTakeoff(
  trx: Trx,
  input: { workspaceId: string; memberId: string; takeoff: TakeoffRecord; status: TakeoffStatus },
): Promise<TakeoffRecord> {
  try {
    await sql`
      update takeoff set status = ${input.status}
      where id = ${input.takeoff.id}::uuid
    `.execute(trx);
  } catch (error) {
    rethrowTakeoff(error);
  }
  await writeAudit(trx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    takeoffId: input.takeoff.id,
    action: "status",
    diff: { from: input.takeoff.status, to: input.status, version: input.takeoff.version },
  });
  return getTakeoff(trx, input.takeoff.id);
}

export async function cloneTakeoff(
  trx: Trx,
  input: { workspaceId: string; memberId: string; takeoff: TakeoffRecord },
): Promise<TakeoffRecord> {
  const id = createId();
  const version = input.takeoff.version + 1;
  try {
    await sql`
      insert into takeoff (
        id, workspace_id, job_id, location_id, lineage_id, supersedes_id, kind,
        imagery_capture_id, status, version, created_by
      ) values (
        ${id}::uuid,
        ${input.workspaceId}::uuid,
        ${input.takeoff.job_id}::uuid,
        ${input.takeoff.location_id}::uuid,
        ${input.takeoff.lineage_id}::uuid,
        ${input.takeoff.id}::uuid,
        ${input.takeoff.kind},
        ${input.takeoff.imagery_capture_id}::uuid,
        'draft',
        ${version},
        ${input.memberId}
      )
    `.execute(trx);
    const existing = await sql<{ id: string }>`
      select id::text as id from measurement where takeoff_id = ${input.takeoff.id}::uuid
    `.execute(trx);
    if (existing.rows.length > 0) {
      const mapping = existing.rows.map((row) => ({ old_id: row.id, new_id: createId() }));
      await sql`
        insert into measurement (
          id, workspace_id, takeoff_id, takeoff_item_id, kind, geom,
          value_m2, value_m, count, source, confidence, label, deductions, created_by
        )
        select
          u.new_id, m.workspace_id, ${id}::uuid, m.takeoff_item_id, m.kind, m.geom,
          m.value_m2, m.value_m, m.count, m.source, m.confidence, m.label, m.deductions,
          ${input.memberId}
        from measurement m
        join jsonb_to_recordset(${JSON.stringify(mapping)}::jsonb) as u(old_id uuid, new_id uuid)
          on u.old_id = m.id
      `.execute(trx);
    }
  } catch (error) {
    rethrowTakeoff(error);
  }
  await writeAudit(trx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    takeoffId: id,
    action: "clone",
    diff: { from: input.takeoff.id, version, status: "draft" },
  });
  return getTakeoff(trx, id);
}

export async function updateCapture(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    takeoff: TakeoffRecord;
    capture: CaptureRecord;
  },
): Promise<void> {
  if (input.takeoff.status === "final") {
    throw conflict("A final takeoff is read-only. Reopen it to draft a new version.");
  }
  try {
    await sql`
      update takeoff set imagery_capture_id = ${input.capture.id}::uuid
      where id = ${input.takeoff.id}::uuid
    `.execute(trx);
  } catch (error) {
    rethrowTakeoff(error);
  }
  await writeAudit(trx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    takeoffId: input.takeoff.id,
    action: "capture",
    diff: { from: input.takeoff.imagery_capture_id, to: input.capture.id },
  });
}

async function writeAudit(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    takeoffId: string;
    action: string;
    diff: Record<string, unknown>;
  },
): Promise<void> {
  await trx
    .insertInto("audit_log")
    .values({
      workspace_id: input.workspaceId,
      actor_member_id: input.memberId,
      entity_type: "takeoff",
      entity_id: input.takeoffId,
      action: input.action,
      diff: input.diff,
    })
    .execute();
}

type FeatureRow = {
  id: string;
  takeoff_item_id: string;
  kind: MeasurementInput["kind"];
  value_m2: string | null;
  value_m: string | null;
  count: number | null;
  source: MeasurementInput["source"];
  confidence: number | null;
  label: string | null;
  deductions: unknown;
  geojson: string;
};

function presentFeature(row: FeatureRow): StoredFeature {
  return {
    id: row.id,
    takeoff_item_id: row.takeoff_item_id,
    kind: row.kind,
    value_m2: row.value_m2,
    value_m: row.value_m,
    count: row.count,
    source: row.source,
    confidence: row.confidence,
    label: row.label,
    deductions: row.deductions,
    geometry: parseGeometryJson(row.geojson),
  };
}

export async function listFeatures(trx: Trx, takeoffId: string): Promise<StoredFeature[]> {
  const result = await sql<FeatureRow>`
    select
      id::text as id,
      takeoff_item_id::text as takeoff_item_id,
      kind,
      value_m2::text as value_m2,
      value_m::text as value_m,
      count,
      source,
      confidence,
      label,
      deductions,
      ST_AsGeoJSON(geom) as geojson
    from measurement
    where takeoff_id = ${takeoffId}::uuid
    order by created_at, id
  `.execute(trx);
  return result.rows.map(presentFeature);
}

export async function listOverlaps(trx: Trx, takeoffId: string): Promise<MeasurementOverlap[]> {
  const result = await sql<{ a: string; b: string; takeoff_item_id: string }>`
    select a.id::text as a, b.id::text as b, a.takeoff_item_id::text as takeoff_item_id
    from measurement a
    join measurement b
      on b.takeoff_id = a.takeoff_id
     and b.takeoff_item_id = a.takeoff_item_id
     and a.id < b.id
     and a.kind = 'area'
     and b.kind = 'area'
     and a.geom && b.geom
     and ST_Area(ST_Intersection(a.geom, b.geom)::geography) > ${OVERLAP_M2}
    where a.takeoff_id = ${takeoffId}::uuid
    order by a.takeoff_item_id, a.id, b.id
  `.execute(trx);
  return result.rows.map((row) => ({
    takeoff_item_id: row.takeoff_item_id,
    measurement_ids: [row.a, row.b],
  }));
}

async function assertItems(trx: Trx, features: MeasurementInput[]): Promise<void> {
  const ids = [...new Set(features.map((feature) => feature.takeoffItemId))];
  const result = await sql<{ id: string; measure_kind: string; archived_at: Date | null }>`
    select id::text as id, measure_kind, archived_at
    from takeoff_item
    where id in (
      select value::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)
    )
  `.execute(trx);
  const byId = new Map(result.rows.map((row) => [row.id, row]));
  for (const feature of features) {
    const item = byId.get(feature.takeoffItemId);
    if (!item) {
      throw notFound("A takeoff item was not found.");
    }
    if (item.archived_at) {
      throw conflict("That takeoff item is archived.");
    }
    if (item.measure_kind !== feature.kind) {
      throw conflict("The measurement kind does not match the takeoff item.");
    }
  }
}

async function assertOwnedIds(trx: Trx, takeoffId: string, ids: string[]): Promise<void> {
  const result = await sql<{ id: string; takeoff_id: string }>`
    select id::text as id, takeoff_id::text as takeoff_id
    from measurement
    where id in (
      select value::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)
    )
  `.execute(trx);
  if (result.rows.some((row) => row.takeoff_id !== takeoffId)) {
    throw conflict("That measurement does not belong to this takeoff.");
  }
}

export async function upsertFeatures(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    takeoff: TakeoffRecord;
    features: MeasurementInput[];
  },
): Promise<MeasurementCorrection[]> {
  if (input.takeoff.status === "final") {
    throw conflict("A final takeoff is read-only. Reopen it to draft a new version.");
  }
  if (input.features.length === 0) {
    return [];
  }
  const ids = input.features.map((feature) => feature.id);
  if (new Set(ids).size !== ids.length) {
    throw badRequest("Each measurement id in the request must be unique.");
  }
  await assertItems(trx, input.features);
  await assertOwnedIds(trx, input.takeoff.id, ids);
  const payload = input.features.map((feature) => ({
    id: feature.id,
    takeoff_item_id: feature.takeoffItemId,
    kind: feature.kind,
    geom: feature.geom,
    deductions: feature.deductions,
    source: feature.source,
    label: feature.label,
    count: feature.count,
    confidence: feature.confidence,
  }));
  try {
    // ST_Dump's row estimate pushes this statement over jit_above_cost.
    // Compiling it costs more than running it for a few hundred features.
    await sql`select set_config('jit', 'off', true)`.execute(trx);
    const written = await sql<{
      section: string;
      id: string;
      detail: string | null;
      corrected: boolean | null;
    }>`
      with incoming as (
        select *
        from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as f(
          id uuid,
          takeoff_item_id uuid,
          kind text,
          geom jsonb,
          deductions jsonb,
          source text,
          label text,
          count integer,
          confidence real
        )
      ),
      built as (
        select
          i.*,
          ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(i.geom::text), 4326)) as raw_geom,
          case
            when i.kind <> 'area'
              or i.deductions is null
              or jsonb_typeof(i.deductions) <> 'array'
              or jsonb_array_length(i.deductions) = 0 then null
            else (
              select ST_UnaryUnion(ST_Collect(
                ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(hole.value::text), 4326))
              ))
              from jsonb_array_elements(i.deductions) as hole
            )
          end as hole_geom
        from incoming i
      ),
      cut as (
        select
          b.*,
          case
            when b.hole_geom is null then b.raw_geom
            else ST_Difference(b.raw_geom, b.hole_geom)
          end as cut_geom
        from built b
      ),
      fixed as (
        select
          c.id,
          c.takeoff_item_id,
          c.kind,
          c.source,
          c.label,
          c.confidence,
          case
            when c.kind = 'count' then coalesce(c.count, ST_NPoints(c.raw_geom)::int)
            else null
          end as count,
          not ST_IsValid(c.cut_geom) as corrected,
          case c.kind
            when 'area' then ST_CollectionExtract(ST_MakeValid(c.cut_geom), 3)
            when 'length' then ST_CollectionExtract(ST_MakeValid(c.cut_geom), 2)
            else ST_CollectionExtract(ST_MakeValid(c.cut_geom), 1)
          end as geom
        from cut c
      ),
      ready as (
        select
          f.*,
          case
            when f.geom is null or ST_IsEmpty(f.geom) then 'empty'
            when f.kind = 'area' and ST_GeometryType(f.geom) not in ('ST_Polygon', 'ST_MultiPolygon') then 'kind'
            when f.kind = 'length' and ST_GeometryType(f.geom) not in ('ST_LineString', 'ST_MultiLineString') then 'kind'
            when f.kind = 'count' and ST_GeometryType(f.geom) not in ('ST_Point', 'ST_MultiPoint') then 'kind'
            when f.kind = 'area' and ST_Area(f.geom::geography) <= 0 then 'empty'
            when f.kind = 'length' and ST_Length(f.geom::geography) <= 0 then 'empty'
            else 'ok'
          end as problem,
          case when f.kind = 'area' then ST_Area(f.geom::geography)::numeric(14, 4) else null end as value_m2,
          case
            when f.kind in ('area', 'length') then ST_Length(f.geom::geography)::numeric(14, 4)
            else null
          end as value_m,
          case
            when f.kind <> 'area' then '[]'::jsonb
            else coalesce((
              select jsonb_agg(
                ST_AsGeoJSON(
                  case ST_GeometryType(ring.geom)
                    when 'ST_LineString' then ST_MakePolygon(ring.geom)
                    else ring.geom
                  end
                )::jsonb
              )
              from ST_Dump(ST_CollectionExtract(f.geom, 3)) as poly
              cross join lateral ST_DumpRings(poly.geom) as ring
              where ring.path[1] > 0
                and ST_GeometryType(ring.geom) in ('ST_LineString', 'ST_Polygon')
            ), '[]'::jsonb)
          end as deductions
        from fixed f
      ),
      bad as (
        select id::text as id, problem from ready where problem <> 'ok'
      ),
      written as (
        insert into measurement (
          id, workspace_id, takeoff_id, takeoff_item_id, kind, geom,
          value_m2, value_m, count, source, confidence, label, deductions, created_by
        )
        select
          r.id,
          ${input.workspaceId}::uuid,
          ${input.takeoff.id}::uuid,
          r.takeoff_item_id,
          r.kind,
          r.geom,
          r.value_m2,
          r.value_m,
          r.count,
          r.source,
          r.confidence,
          r.label,
          r.deductions,
          ${input.memberId}
        from ready r
        where (select count(*) from bad) = 0
        on conflict (id) do update set
          takeoff_item_id = excluded.takeoff_item_id,
          kind = excluded.kind,
          geom = excluded.geom,
          value_m2 = excluded.value_m2,
          value_m = excluded.value_m,
          count = excluded.count,
          source = excluded.source,
          confidence = excluded.confidence,
          label = excluded.label,
          deductions = excluded.deductions
        returning id
      )
      select 'bad'::text as section, id, problem as detail, null::boolean as corrected
      from bad
      union all
      select 'written'::text, w.id::text, null::text, r.corrected
      from written w
      join ready r on r.id = w.id
    `.execute(trx);
    const bad = written.rows.filter((row) => row.section === "bad");
    if (bad.length > 0) {
      const empty = bad.some((row) => row.detail === "empty");
      throw badRequest(
        empty
          ? "A measurement is empty after correction."
          : "A measurement geometry does not match its kind.",
      );
    }
    const correctedIds = new Set(
      written.rows.filter((row) => row.section === "written" && row.corrected).map((row) => row.id),
    );
    if (correctedIds.size === 0) {
      return [];
    }
    const features = await listFeatures(trx, input.takeoff.id);
    return features
      .filter((feature) => correctedIds.has(feature.id))
      .map((feature) => ({
        id: feature.id,
        reason: "self_intersection" as const,
        geometry: feature.geometry,
      }));
  } catch (error) {
    if (error instanceof ProblemError) {
      throw error;
    }
    rethrowTakeoff(error);
  }
}

export async function deleteFeature(trx: Trx, measurementId: string): Promise<void> {
  const found = await sql<{ id: string; status: string }>`
    select m.id::text as id, t.status
    from measurement m
    join takeoff t on t.id = m.takeoff_id
    where m.id = ${measurementId}::uuid
  `.execute(trx);
  const row = found.rows[0];
  if (!row) {
    throw notFound("That measurement was not found.");
  }
  if (row.status === "final") {
    throw conflict("A final takeoff is read-only. Reopen it to draft a new version.");
  }
  try {
    await sql`delete from measurement where id = ${measurementId}::uuid`.execute(trx);
  } catch (error) {
    rethrowTakeoff(error);
  }
}

type SummaryRow = {
  takeoff_item_id: string;
  name: string;
  measure_kind: MeasurementInput["kind"];
  sum_m2: string | null;
  sum_m: string | null;
  union_m2: string | null;
  union_m: string | null;
  count: number | null;
};

export async function summarize(trx: Trx, takeoffId: string): Promise<SummaryItem[]> {
  const result = await sql<SummaryRow>`
    select
      ti.id::text as takeoff_item_id,
      ti.name,
      ti.measure_kind,
      case when ti.measure_kind = 'area' then sum(m.value_m2)::text else null end as sum_m2,
      case when ti.measure_kind = 'length' then sum(m.value_m)::text else null end as sum_m,
      case
        when ti.measure_kind = 'area'
          then ST_Area(ST_UnaryUnion(ST_Collect(m.geom))::geography)::numeric(14, 4)::text
        else null
      end as union_m2,
      case
        when ti.measure_kind = 'length'
          then ST_Length(ST_UnaryUnion(ST_Collect(m.geom))::geography)::numeric(14, 4)::text
        else null
      end as union_m,
      case when ti.measure_kind = 'count' then sum(m.count)::int else null end as count
    from measurement m
    join takeoff_item ti on ti.id = m.takeoff_item_id
    where m.takeoff_id = ${takeoffId}::uuid
    group by ti.id, ti.name, ti.measure_kind
    order by ti.name, ti.id
  `.execute(trx);
  const overlaps = await listOverlaps(trx, takeoffId);
  const overlapCount = new Map<string, number>();
  for (const overlap of overlaps) {
    overlapCount.set(overlap.takeoff_item_id, (overlapCount.get(overlap.takeoff_item_id) ?? 0) + 1);
  }
  return result.rows.map((row) => ({
    takeoff_item_id: row.takeoff_item_id,
    name: row.name,
    measure_kind: row.measure_kind,
    sum_m2: row.sum_m2,
    sum_m: row.sum_m,
    union_m2: row.union_m2,
    union_m: row.union_m,
    count: row.count,
    overlap_count: overlapCount.get(row.takeoff_item_id) ?? 0,
    display: {
      sum_ft2: displayOrNull(row.sum_m2, "ft2"),
      sum_yd2: displayOrNull(row.sum_m2, "yd2"),
      sum_acres: displayOrNull(row.sum_m2, "acre"),
      union_ft2: displayOrNull(row.union_m2, "ft2"),
      union_yd2: displayOrNull(row.union_m2, "yd2"),
      union_acres: displayOrNull(row.union_m2, "acre"),
      sum_ft: displayOrNull(row.sum_m, "ft"),
      union_ft: displayOrNull(row.union_m, "ft"),
    },
  }));
}
