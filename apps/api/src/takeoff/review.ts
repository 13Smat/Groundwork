import type { GeoJsonGeometry } from "@groundwork/geo";
import {
  createId,
  IllegalDetectionRunTransitionError,
  isDetectionRunStatus,
  transitionDetectionRun,
  type DetectionRunStatus,
} from "@groundwork/shared";
import { sql, type Kysely, type Transaction } from "kysely";

import { aiAssistEnabled } from "../config.js";
import type { Database } from "../db/types.js";
import { withWorkspaceContext } from "../db/workspace.js";
import { ProblemError } from "../errors.js";
import { getTakeoff, listFeatures, type StoredFeature } from "./data.js";

/**
 * Spec 05 has no rejected status. A review that does not keep every draft
 * closes as accepted_partial, including a discard that keeps nothing, so the
 * run cannot be accepted twice. ADR 0018.
 */
const OVERLAP_M2 = 0.01;

type Db = Kysely<Database>;
type Trx = Transaction<Database>;

export type ReviewSelection = {
  all?: boolean | undefined;
  feature_ids?: string[] | undefined;
};

export type DraftFeature = {
  id: string;
  geometry: GeoJsonGeometry;
  properties: {
    class: string | null;
    score: number | null;
    area_m2: string;
    takeoff_item_id: string | null;
    accepted_measurement_id: string | null;
  };
};

export type DraftOverlap = {
  feature_id: string;
  measurement_id: string;
};

export type DetectionRunView = {
  id: string;
  takeoff_id: string;
  status: DetectionRunStatus;
  features: DraftFeature[];
  overlaps: DraftOverlap[];
};

export type ReviewResult = {
  run_id: string;
  status: "accepted_partial" | "accepted_all";
  accepted_feature_ids: string[];
  rejected_feature_ids: string[];
  measurements: StoredFeature[];
};

type RunRow = {
  id: string;
  takeoff_id: string;
  status: string;
};

type DraftRow = {
  id: string;
  class: string | null;
  score: number | null;
  takeoff_item_id: string | null;
  accepted_measurement_id: string | null;
  geojson: string;
  area_m2: string;
};

function badRequest(detail: string): ProblemError {
  return new ProblemError({ status: 400, title: "Bad Request", detail });
}

function forbidden(detail: string): ProblemError {
  return new ProblemError({ status: 403, title: "Forbidden", detail });
}

function notFound(detail: string): ProblemError {
  return new ProblemError({ status: 404, title: "Not Found", detail });
}

function conflict(detail: string): ProblemError {
  return new ProblemError({ status: 409, title: "Conflict", detail });
}

function featuresEnabled(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (value as Record<string, unknown>).ai_assist === true;
}

function parseGeometry(value: string): GeoJsonGeometry {
  const parsed: unknown = JSON.parse(value);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("type" in parsed) ||
    typeof parsed.type !== "string"
  ) {
    throw new Error("Stored geometry was not GeoJSON.");
  }
  return parsed as GeoJsonGeometry;
}

function presentDraft(row: DraftRow): DraftFeature {
  return {
    id: row.id,
    geometry: parseGeometry(row.geojson),
    properties: {
      class: row.class,
      score: row.score,
      area_m2: row.area_m2,
      takeoff_item_id: row.takeoff_item_id,
      accepted_measurement_id: row.accepted_measurement_id,
    },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function assertAssistEnv(): void {
  if (!aiAssistEnabled()) {
    throw forbidden("AI assist is turned off.");
  }
}

async function assertWorkspaceFlag(trx: Trx, workspaceId: string): Promise<void> {
  const workspace = await sql<{ features: unknown }>`
    select features from workspace where id = ${workspaceId}
  `.execute(trx);
  if (!featuresEnabled(workspace.rows[0]?.features)) {
    throw forbidden("AI assist is not enabled for this workspace.");
  }
}

async function loadRun(trx: Trx, runId: string): Promise<RunRow> {
  const result = await sql<RunRow>`
    select id::text as id, takeoff_id::text as takeoff_id, status
    from detection_run
    where id = ${runId}::uuid
  `.execute(trx);
  const run = result.rows[0];
  if (!run || !isDetectionRunStatus(run.status)) {
    throw notFound("That detection run was not found.");
  }
  return run;
}

async function loadDrafts(trx: Trx, runId: string): Promise<DraftRow[]> {
  const result = await sql<DraftRow>`
    select
      id::text as id,
      class,
      score,
      takeoff_item_id::text as takeoff_item_id,
      accepted_measurement_id::text as accepted_measurement_id,
      ST_AsGeoJSON(geom) as geojson,
      ST_Area(geom::geography)::numeric(14, 4)::text as area_m2
    from detection_feature
    where run_id = ${runId}::uuid
    order by id
  `.execute(trx);
  return result.rows;
}

async function loadOverlaps(trx: Trx, runId: string, takeoffId: string): Promise<DraftOverlap[]> {
  const result = await sql<DraftOverlap>`
    select f.id::text as feature_id, m.id::text as measurement_id
    from detection_feature f
    join measurement m
      on m.takeoff_id = ${takeoffId}::uuid
     and ST_Area(ST_MakeValid(ST_Intersection(f.geom, m.geom))::geography) > ${OVERLAP_M2}
    where f.run_id = ${runId}::uuid
      and f.accepted_measurement_id is null
    order by f.id, m.id
  `.execute(trx);
  return result.rows;
}

function requireSucceeded(status: DetectionRunStatus): void {
  if (status !== "succeeded") {
    throw conflict(`Cannot review a detection run that is ${status}.`);
  }
}

function selectionIds(selection: ReviewSelection, drafts: readonly DraftRow[]): string[] {
  if (selection.all === true && selection.feature_ids !== undefined) {
    throw badRequest("Pass all or feature_ids, not both.");
  }
  if (selection.all === true) {
    return drafts.map((draft) => draft.id);
  }
  const ids = selection.feature_ids ?? [];
  if (ids.length === 0) {
    throw badRequest("Name the drafts to accept, or pass all: true.");
  }
  if (new Set(ids).size !== ids.length) {
    throw badRequest("Each draft id in the request must be unique.");
  }
  const known = new Set(drafts.map((draft) => draft.id));
  if (ids.some((id) => !known.has(id))) {
    throw badRequest("A draft in the request is not on this run.");
  }
  return ids;
}

async function assertAreaItems(trx: Trx, drafts: readonly DraftRow[]): Promise<void> {
  const ids = [...new Set(drafts.map((draft) => draft.takeoff_item_id))];
  if (ids.some((id) => id === null)) {
    throw conflict("A draft has no takeoff item.");
  }
  const found = await sql<{ id: string; measure_kind: string }>`
    select id::text as id, measure_kind
    from takeoff_item
    where id in (
      select value::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)
    )
  `.execute(trx);
  if (found.rows.length !== ids.length) {
    throw conflict("A draft takeoff item was not found.");
  }
  if (found.rows.some((row) => row.measure_kind !== "area")) {
    throw conflict("Assist drafts are area measurements.");
  }
}

async function writeAudit(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    runId: string;
    action: "accept" | "reject";
    diff: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    insert into audit_log (workspace_id, actor_member_id, entity_type, entity_id, action, diff)
    values (
      ${input.workspaceId}::uuid,
      ${input.memberId}::uuid,
      'detection_run',
      ${input.runId}::uuid,
      ${input.action},
      ${JSON.stringify(input.diff)}::jsonb
    )
  `.execute(trx);
}

function rethrowReview(error: unknown): never {
  if (error instanceof ProblemError || error instanceof IllegalDetectionRunTransitionError) {
    if (error instanceof IllegalDetectionRunTransitionError) {
      throw conflict(error.message);
    }
    throw error;
  }
  const text = errorText(error);
  if (
    text.includes("measurements on a final takeoff") ||
    text.includes("a final takeoff is read-only")
  ) {
    throw conflict("A final takeoff is read-only. Reopen it to draft a new version.");
  }
  if (text.includes("illegal detection run transition")) {
    throw conflict("That detection run can no longer be reviewed.");
  }
  throw error;
}

async function closeRun(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    run: RunRow;
    acceptIds: readonly string[];
    action: "accept" | "reject";
  },
): Promise<ReviewResult> {
  const drafts = await loadDrafts(trx, input.run.id);
  const acceptSet = new Set(input.acceptIds);
  const accepted = drafts.filter((draft) => acceptSet.has(draft.id));
  const rejected = drafts.filter((draft) => !acceptSet.has(draft.id));
  if (input.action === "accept" && accepted.length === 0) {
    throw conflict("This run has no drafts to accept.");
  }
  if (input.action === "accept") {
    await assertAreaItems(trx, accepted);
  }
  const takeoff = await getTakeoff(trx, input.run.takeoff_id);
  if (takeoff.status === "final") {
    throw conflict("A final takeoff is read-only. Reopen it to draft a new version.");
  }
  const next: "accepted_partial" | "accepted_all" =
    input.action === "accept" && rejected.length === 0 ? "accepted_all" : "accepted_partial";
  transitionDetectionRun("succeeded", next);

  const pairs = accepted.map((draft) => ({
    feature_id: draft.id,
    measurement_id: createId(),
  }));
  if (pairs.length > 0) {
    try {
      const written = await sql<{ id: string }>`
        with mapped as (
          select
            m.feature_id,
            m.measurement_id,
            f.takeoff_item_id,
            f.score,
            f.geom
          from jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb) as m(
            feature_id uuid,
            measurement_id uuid
          )
          join detection_feature f on f.id = m.feature_id
          where f.run_id = ${input.run.id}::uuid
            and f.accepted_measurement_id is null
        ),
        ready as (
          select
            mapped.feature_id,
            mapped.measurement_id,
            mapped.takeoff_item_id,
            mapped.score,
            ST_ForcePolygonCCW((
              select dumped.geom
              from ST_Dump(ST_CollectionExtract(ST_MakeValid(mapped.geom), 3)) as dumped
              order by ST_Area(dumped.geom::geography) desc
              limit 1
            )) as polygon
          from mapped
        )
        insert into measurement (
          id, workspace_id, takeoff_id, takeoff_item_id, kind, geom,
          value_m2, value_m, count, source, confidence, label, deductions, created_by
        )
        select
          r.measurement_id,
          ${input.workspaceId}::uuid,
          ${takeoff.id}::uuid,
          r.takeoff_item_id,
          'area',
          r.polygon,
          ST_Area(r.polygon::geography)::numeric(14, 4),
          ST_Length(r.polygon::geography)::numeric(14, 4),
          null,
          'ai_assist',
          r.score,
          null,
          '[]'::jsonb,
          ${input.memberId}
        from ready r
        where r.polygon is not null
          and ST_GeometryType(r.polygon) = 'ST_Polygon'
          and ST_Area(r.polygon::geography) > 0
        returning id::text as id
      `.execute(trx);
      if (written.rows.length !== pairs.length) {
        throw conflict("A draft could not be stored as a measurement.");
      }
      await sql`
        update detection_feature as feature
        set accepted_measurement_id = pair.measurement_id
        from jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb) as pair(
          feature_id uuid,
          measurement_id uuid
        )
        where feature.id = pair.feature_id
          and feature.run_id = ${input.run.id}::uuid
      `.execute(trx);
    } catch (error) {
      rethrowReview(error);
    }
  }

  try {
    await sql`
      update detection_run
      set status = ${next}
      where id = ${input.run.id}::uuid
    `.execute(trx);
  } catch (error) {
    rethrowReview(error);
  }

  const measurementIds = pairs.map((pair) => pair.measurement_id);
  await writeAudit(trx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    runId: input.run.id,
    action: input.action,
    diff: {
      status: next,
      accepted_feature_ids: accepted.map((draft) => draft.id),
      rejected_feature_ids: rejected.map((draft) => draft.id),
      measurement_ids: measurementIds,
    },
  });
  const stored = await listFeatures(trx, takeoff.id);
  const kept = new Set(measurementIds);
  return {
    run_id: input.run.id,
    status: next,
    accepted_feature_ids: accepted.map((draft) => draft.id),
    rejected_feature_ids: rejected.map((draft) => draft.id),
    measurements: stored.filter((feature) => kept.has(feature.id)),
  };
}

export async function getDetectionRun(
  db: Db,
  input: { workspaceId: string; runId: string },
): Promise<DetectionRunView> {
  assertAssistEnv();
  return withWorkspaceContext(db, input.workspaceId, async (trx) => {
    await assertWorkspaceFlag(trx, input.workspaceId);
    const run = await loadRun(trx, input.runId);
    const drafts = await loadDrafts(trx, input.runId);
    const overlaps = await loadOverlaps(trx, input.runId, run.takeoff_id);
    return {
      id: run.id,
      takeoff_id: run.takeoff_id,
      status: run.status as DetectionRunStatus,
      features: drafts.map(presentDraft),
      overlaps,
    };
  });
}

export async function acceptDetectionRun(
  db: Db,
  input: { workspaceId: string; memberId: string; runId: string; selection: ReviewSelection },
): Promise<ReviewResult> {
  assertAssistEnv();
  return withWorkspaceContext(db, input.workspaceId, async (trx) => {
    await assertWorkspaceFlag(trx, input.workspaceId);
    const run = await loadRun(trx, input.runId);
    const status = run.status as DetectionRunStatus;
    requireSucceeded(status);
    const drafts = await loadDrafts(trx, input.runId);
    const acceptIds = selectionIds(input.selection, drafts);
    try {
      return await closeRun(trx, {
        workspaceId: input.workspaceId,
        memberId: input.memberId,
        run,
        acceptIds,
        action: "accept",
      });
    } catch (error) {
      rethrowReview(error);
    }
  });
}

export async function rejectDetectionRun(
  db: Db,
  input: { workspaceId: string; memberId: string; runId: string; selection: ReviewSelection },
): Promise<ReviewResult> {
  assertAssistEnv();
  if (input.selection.all !== true || input.selection.feature_ids !== undefined) {
    throw badRequest("Reject the whole run with all: true.");
  }
  return withWorkspaceContext(db, input.workspaceId, async (trx) => {
    await assertWorkspaceFlag(trx, input.workspaceId);
    const run = await loadRun(trx, input.runId);
    const status = run.status as DetectionRunStatus;
    requireSucceeded(status);
    try {
      return await closeRun(trx, {
        workspaceId: input.workspaceId,
        memberId: input.memberId,
        run,
        acceptIds: [],
        action: "reject",
      });
    } catch (error) {
      rethrowReview(error);
    }
  });
}
