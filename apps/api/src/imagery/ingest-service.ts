import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createId, type ImageryCaptureStatus } from "@groundwork/shared";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod/v4";

import { readObjectStorageConfig } from "../config.js";
import type { Database } from "../db/types.js";
import { withImageryAdminContext } from "../db/workspace.js";
import { ProblemError } from "../errors.js";
import { objectExists } from "../storage/s3.js";
import {
  aoiSchema,
  ingestErrorDetail,
  ingestProvider,
  MAX_INGEST_AOI_SQ_M,
} from "./ingest-schema.js";
import type {
  CreateSourceBody,
  IngestBody,
  IngestJobResponse,
  PatchSourceBody,
} from "./ingest-schema.js";
import { assertLicenseFlags } from "./ingest-schema.js";
import { applyImageryCaptureTransition } from "./transition.js";

const reportSchema = z.object({
  ok: z.literal(true),
  gsd_cm: z.number().positive().max(9999.99),
  bands: z.literal("RGBIR"),
  capture_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  leaf: z.enum(["on", "off", "mixed", "unknown"]),
  cog_key: z.string(),
  footprint: aoiSchema,
  band_count: z.literal(4),
});

type Report = z.infer<typeof reportSchema>;

export type IngestDispatch = (message: {
  ingestJobId: string;
  workspaceId: string;
}) => Promise<void>;

type JobRow = {
  id: string;
  capture_id: string;
  source_id: string;
  status: ImageryCaptureStatus;
  year: number;
  county_fips: string | null;
  error: string | null;
  request_hash: string;
  cog_key: string | null;
  capture_date: string | null;
  gsd_cm: number | null;
  bands: string | null;
  leaf: "on" | "off" | "mixed" | "unknown" | null;
  provider: string;
  source_name: string;
  aoi_geojson: string | null;
};

export function requestHash(body: IngestBody): string {
  const canonical = JSON.stringify({
    sourceId: body.sourceId,
    year: body.year,
    countyFips: body.countyFips ?? null,
    aoi: body.aoi ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

export function fixtureGeotiffPath(): string {
  return path.join(repoRoot(), "db/seed/fixtures/rgbir-source.tif");
}

export async function createIngest(
  db: Kysely<Database>,
  workspaceId: string,
  body: IngestBody,
  idempotencyKey: string | undefined,
  dispatch: IngestDispatch | undefined,
): Promise<{ job: IngestJobResponse; created: boolean }> {
  if (!dispatch) {
    throw new ProblemError({
      status: 503,
      title: "Service Unavailable",
      detail: "The ingest queue is not running.",
    });
  }
  const hash = requestHash(body);
  const key = idempotencyKey ?? `auto:${hash}`;
  const queued = await insertOrReplay(db, workspaceId, body, key, hash);
  if (queued.created) {
    try {
      await dispatch({ ingestJobId: queued.jobId, workspaceId });
    } catch (error) {
      await failJob(db, workspaceId, queued.jobId, "The ingest queue did not accept the job.");
      throw error instanceof ProblemError
        ? error
        : new ProblemError({
            status: 503,
            title: "Service Unavailable",
            detail: "The ingest queue did not accept the job.",
          });
    }
  }
  const job = await readJob(db, workspaceId, queued.jobId);
  return { job, created: queued.created };
}

export async function readIngestJob(
  db: Kysely<Database>,
  workspaceId: string,
  jobId: string,
): Promise<IngestJobResponse> {
  return readJob(db, workspaceId, jobId);
}

export async function runImageryIngestJob(
  db: Kysely<Database>,
  message: { ingestJobId: string; workspaceId: string },
): Promise<void> {
  const job = await findJob(db, message.workspaceId, message.ingestJobId);
  if (!job || job.status !== "ingesting") {
    return;
  }
  try {
    const report = await convertAndUpload(job);
    if (report.cog_key !== cogKeyFor(job.capture_id)) {
      throw new ProblemError({
        status: 500,
        title: "Internal Server Error",
        detail: "Ingest failed.",
      });
    }
    const stored = await objectExists(report.cog_key);
    if (!stored) {
      throw new ProblemError({
        status: 500,
        title: "Internal Server Error",
        detail: "The COG could not be stored.",
      });
    }
    await withImageryAdminContext(db, message.workspaceId, async (trx) => {
      await assertFootprint(trx, job.id, JSON.stringify(report.footprint));
      await applyImageryCaptureTransition(trx, {
        captureId: job.capture_id,
        from: "ingesting",
        to: "ready",
        coverageGeoJson: JSON.stringify(report.footprint),
        captureDate: report.capture_date,
        gsdCm: report.gsd_cm,
        bands: report.bands,
        leaf: report.leaf,
        cogKey: report.cog_key,
        notes: null,
      });
      await finishJob(trx, job, "ready", null);
    });
  } catch (error) {
    const detail =
      error instanceof ProblemError
        ? (error.problemBody.detail ?? "Ingest failed.")
        : "Ingest failed.";
    if (error instanceof ProblemError && error.statusCode === 409) {
      return;
    }
    await failJob(db, message.workspaceId, job.id, detail);
  }
}

async function insertOrReplay(
  db: Kysely<Database>,
  workspaceId: string,
  body: IngestBody,
  key: string,
  hash: string,
): Promise<{ jobId: string; created: boolean }> {
  try {
    return await withImageryAdminContext(db, workspaceId, async (trx) => {
      const existing = await jobByKey(trx, workspaceId, key);
      if (existing) {
        return replay(existing, hash);
      }
      await assertSourceCanIngest(trx, body);
      if (body.aoi) {
        await assertAoiArea(trx, JSON.stringify(body.aoi));
      }
      const jobId = createId();
      const captureId = createId();
      await insertCapture(trx, body, captureId);
      await insertJob(trx, body, workspaceId, jobId, captureId, key, hash);
      return { jobId, created: true };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    return withImageryAdminContext(db, workspaceId, async (trx) => {
      const existing = await jobByKey(trx, workspaceId, key);
      if (!existing) {
        throw error;
      }
      return replay(existing, hash);
    });
  }
}

function replay(
  existing: { id: string; request_hash: string },
  hash: string,
): { jobId: string; created: boolean } {
  if (existing.request_hash !== hash) {
    throw new ProblemError({
      status: 409,
      title: "Conflict",
      detail: "Idempotency-Key was already used for a different ingest request.",
    });
  }
  return { jobId: existing.id, created: false };
}

async function assertSourceCanIngest(trx: Transaction<Database>, body: IngestBody): Promise<void> {
  const result = await sql<{
    id: string;
    provider: string;
    name: string;
    allows_tracing: boolean;
    verified: boolean;
  }>`
    select id::text as id, provider, name, allows_tracing, (verified_at is not null) as verified
    from imagery_source
    where id = ${body.sourceId}::uuid
  `.execute(trx);
  const source = result.rows[0];
  if (!source) {
    throw new ProblemError({
      status: 404,
      title: "Not Found",
      detail: "No imagery source matches that id.",
    });
  }
  if (!source.allows_tracing || !source.verified) {
    throw new ProblemError({
      status: 403,
      title: "Forbidden",
      detail: "This imagery source cannot be ingested until it allows tracing and is verified.",
    });
  }
  if (ingestProvider(source) === "") {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "That imagery source has no ingest fetcher.",
    });
  }
}

async function assertAoiArea(trx: Transaction<Database>, geojson: string): Promise<void> {
  let row: { gtype: string; valid: boolean; area: number } | undefined;
  try {
    const result = await sql<{ gtype: string; valid: boolean; area: number }>`
      select
        ST_GeometryType(g) as gtype,
        ST_IsValid(g) as valid,
        ST_Area(g::geography) as area
      from (select ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326) as g) geom
    `.execute(trx);
    row = result.rows[0];
  } catch {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "AOI must be a valid polygon.",
    });
  }
  const area = Number(row?.area);
  if (
    !row ||
    (row.gtype !== "ST_Polygon" && row.gtype !== "ST_MultiPolygon") ||
    !row.valid ||
    !Number.isFinite(area) ||
    area <= 0
  ) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "AOI must be a valid polygon.",
    });
  }
  if (area > MAX_INGEST_AOI_SQ_M) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "That AOI is larger than one county. Ingest is county or AOI only.",
    });
  }
}

async function insertCapture(
  trx: Transaction<Database>,
  body: IngestBody,
  captureId: string,
): Promise<void> {
  const coverage = body.aoi
    ? sql`ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(body.aoi)}), 4326)), 3))`
    : sql`ST_GeomFromText('MULTIPOLYGON EMPTY', 4326)`;
  await sql`
    insert into imagery_capture (
      id, workspace_id, source_id, coverage, capture_date, gsd_cm, bands, leaf, cog_key, status, notes
    )
    select
      ${captureId}::uuid,
      s.workspace_id,
      s.id,
      ${coverage},
      coalesce(
        case when extract(year from s.capture_date)::int = ${body.year} then s.capture_date else null end,
        make_date(${body.year}, 1, 1)
      ),
      coalesce(s.gsd_cm, 0.01),
      s.bands,
      'unknown',
      null,
      'ingesting',
      'Provisional values until ingest finishes.'
    from imagery_source s
    where s.id = ${body.sourceId}::uuid
  `.execute(trx);
}

async function insertJob(
  trx: Transaction<Database>,
  body: IngestBody,
  workspaceId: string,
  jobId: string,
  captureId: string,
  key: string,
  hash: string,
): Promise<void> {
  const aoi = body.aoi
    ? sql`ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(body.aoi)}), 4326)), 3))`
    : sql`null`;
  await sql`
    insert into imagery_ingest_job (
      id, workspace_id, source_id, capture_id, county_fips, aoi, year, idempotency_key, request_hash, status
    ) values (
      ${jobId}::uuid,
      ${workspaceId}::uuid,
      ${body.sourceId}::uuid,
      ${captureId}::uuid,
      ${body.countyFips ?? null},
      ${aoi},
      ${body.year},
      ${key},
      ${hash},
      'ingesting'
    )
  `.execute(trx);
}

async function assertFootprint(
  trx: Transaction<Database>,
  jobId: string,
  footprint: string,
): Promise<void> {
  const result = await sql<{ hits: boolean; area: number }>`
    select
      case
        when aoi is null then true
        else ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON(${footprint}), 4326), aoi)
      end as hits,
      ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(${footprint}), 4326)::geography) as area
    from imagery_ingest_job
    where id = ${jobId}::uuid
  `.execute(trx);
  const row = result.rows[0];
  const area = Number(row?.area);
  if (!row || !row.hits || !Number.isFinite(area) || area <= 0 || area > MAX_INGEST_AOI_SQ_M) {
    throw new ProblemError({
      status: 500,
      title: "Internal Server Error",
      detail: "The raster footprint does not cover the requested county or AOI.",
    });
  }
}

async function finishJob(
  trx: Transaction<Database>,
  job: JobRow,
  status: ImageryCaptureStatus,
  error: string | null,
): Promise<void> {
  await sql`
    update imagery_ingest_job
    set status = ${status},
        error = ${error},
        updated_at = now()
    where id = ${job.id}::uuid
      and status = 'ingesting'
  `.execute(trx);
  await sql`
    insert into event_log (id, provider, event_id, payload, processed_at)
    values (
      ${createId()}::uuid,
      'imagery_ingest',
      ${job.id},
      ${JSON.stringify({ captureId: job.capture_id, status, error })}::jsonb,
      now()
    )
    on conflict (provider, event_id) do nothing
  `.execute(trx);
}

async function failJob(
  db: Kysely<Database>,
  workspaceId: string,
  jobId: string,
  detail: string,
): Promise<void> {
  try {
    await markFailed(db, workspaceId, jobId, detail);
  } catch (error) {
    if (error instanceof ProblemError && error.statusCode === 409) {
      return;
    }
    throw error;
  }
}

async function markFailed(
  db: Kysely<Database>,
  workspaceId: string,
  jobId: string,
  detail: string,
): Promise<void> {
  await withImageryAdminContext(db, workspaceId, async (trx) => {
    const job = await selectJob(trx, workspaceId, jobId);
    if (!job || job.status !== "ingesting") {
      return;
    }
    await applyImageryCaptureTransition(trx, {
      captureId: job.capture_id,
      from: "ingesting",
      to: "failed",
      notes: detail,
    });
    await finishJob(trx, job, "failed", detail);
  });
}

async function readJob(
  db: Kysely<Database>,
  workspaceId: string,
  jobId: string,
): Promise<IngestJobResponse> {
  const job = await findJob(db, workspaceId, jobId);
  if (!job) {
    throw new ProblemError({
      status: 404,
      title: "Not Found",
      detail: "No ingest job matches that id.",
    });
  }
  return toResponse(job);
}

async function findJob(
  db: Kysely<Database>,
  workspaceId: string,
  jobId: string,
): Promise<JobRow | undefined> {
  return withImageryAdminContext(db, workspaceId, (trx) => selectJob(trx, workspaceId, jobId));
}

async function selectJob(
  trx: Transaction<Database>,
  workspaceId: string,
  jobId: string,
): Promise<JobRow | undefined> {
  const result = await sql<JobRow>`
    select
      j.id::text as id,
      j.capture_id::text as capture_id,
      j.source_id::text as source_id,
      j.status,
      j.year,
      j.county_fips,
      j.error,
      j.request_hash,
      c.cog_key,
      case when j.status = 'ready' then c.capture_date::text else null end as capture_date,
      case when j.status = 'ready' then c.gsd_cm::float8 else null end as gsd_cm,
      case when j.status = 'ready' then c.bands else null end as bands,
      case when j.status = 'ready' then c.leaf else null end as leaf,
      s.provider,
      s.name as source_name,
      case when j.aoi is null then null else ST_AsGeoJSON(j.aoi) end as aoi_geojson
    from imagery_ingest_job j
    join imagery_capture c on c.id = j.capture_id
    join imagery_source s on s.id = j.source_id
    where j.id = ${jobId}::uuid
      and j.workspace_id = ${workspaceId}::uuid
  `.execute(trx);
  return result.rows[0];
}

async function jobByKey(
  trx: Transaction<Database>,
  workspaceId: string,
  key: string,
): Promise<{ id: string; request_hash: string } | undefined> {
  const result = await sql<{ id: string; request_hash: string }>`
    select id::text as id, request_hash
    from imagery_ingest_job
    where workspace_id = ${workspaceId}::uuid
      and idempotency_key = ${key}
  `.execute(trx);
  return result.rows[0];
}

function toResponse(job: JobRow): IngestJobResponse {
  return {
    jobId: job.id,
    captureId: job.capture_id,
    sourceId: job.source_id,
    status: job.status,
    year: Number(job.year),
    countyFips: job.county_fips,
    error: job.error,
    cogKey: job.status === "ready" ? job.cog_key : null,
    captureDate: job.capture_date,
    gsdCm: job.gsd_cm === null ? null : Number(job.gsd_cm),
    bands: job.bands,
    leaf: job.leaf,
  };
}

function cogKeyFor(captureId: string): string {
  return `imagery/captures/${captureId}.tif`;
}

async function convertAndUpload(job: JobRow): Promise<Report> {
  const provider = ingestProvider({ provider: job.provider, name: job.source_name });
  if (provider === "") {
    throw new ProblemError({
      status: 500,
      title: "Internal Server Error",
      detail: "That imagery source has no ingest fetcher.",
    });
  }
  const args = [
    "-m",
    "groundwork_imagery_ingest",
    "--provider",
    provider,
    "--year",
    String(job.year),
    "--cog-key",
    cogKeyFor(job.capture_id),
  ];
  if (job.county_fips) {
    args.push("--county-fips", job.county_fips);
  }
  if (job.aoi_geojson) {
    args.push("--aoi-geojson", job.aoi_geojson);
  }
  if (provider === "fixture") {
    args.push("--fixture", fixtureGeotiffPath());
  }
  const stdout = await spawnIngest(args, provider);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ProblemError({
      status: 500,
      title: "Internal Server Error",
      detail: "Ingest failed.",
    });
  }
  if (typeof parsed === "object" && parsed !== null && "ok" in parsed && parsed.ok === false) {
    const code = "error" in parsed && typeof parsed.error === "string" ? parsed.error : undefined;
    throw new ProblemError({
      status: 500,
      title: "Internal Server Error",
      detail: ingestErrorDetail(code),
    });
  }
  const report = reportSchema.safeParse(parsed);
  if (!report.success) {
    throw new ProblemError({
      status: 500,
      title: "Internal Server Error",
      detail: "Ingest failed.",
    });
  }
  return report.data;
}

function spawnIngest(args: string[], provider: string): Promise<string> {
  const python = imageryPython();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: path.join(repoRoot(), "services/imagery-ingest"),
  };
  const storage = readObjectStorageConfig();
  env.S3_ENDPOINT = storage.endpoint;
  env.S3_REGION = storage.region;
  env.S3_BUCKET = storage.bucket;
  env.S3_ACCESS_KEY_ID = storage.accessKeyId;
  env.S3_SECRET_ACCESS_KEY = storage.secretAccessKey;
  if (provider === "fixture") {
    delete env.GROUNDWORK_IMAGERY_LIVE_FETCH;
    delete env.GROUNDWORK_IMAGERY_TILE_URL;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { cwd: repoRoot(), env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    const timer = setTimeout(() => {
      child.kill();
    }, 120_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const text = Buffer.concat(stdout).toString("utf8").trim();
      if (text === "") {
        const tail = Buffer.concat(stderr).toString("utf8").slice(-500);
        reject(
          new ProblemError({
            status: 500,
            title: "Internal Server Error",
            detail: tail.includes("No module named") ? "Ingest failed." : "Ingest failed.",
          }),
        );
        return;
      }
      resolve(text);
    });
  });
}

export function imageryPython(): string {
  const override = process.env.IMAGERY_INGEST_PYTHON?.trim();
  if (override) {
    return override;
  }
  const venv = path.join(repoRoot(), ".venv-imagery/bin/python");
  if (existsSync(venv)) {
    return venv;
  }
  return "python3";
}

function isUniqueViolation(error: unknown): boolean {
  return postgresCode(error) === "23505";
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") {
      return code;
    }
  }
  if (error instanceof Error && error.cause) {
    return postgresCode(error.cause);
  }
  return undefined;
}

export async function listImagerySources(
  db: Kysely<Database>,
  workspaceId: string,
): Promise<ImagerySourceRow[]> {
  return withImageryAdminContext(db, workspaceId, async (trx) => {
    const result = await sql<SourceSql>`
      select
        id::text as id,
        workspace_id::text as workspace_id,
        provider,
        name,
        bands,
        gsd_cm::float8 as gsd_cm,
        capture_date::text as capture_date,
        license_text,
        license_url,
        allows_tracing,
        allows_ml_training,
        attribution,
        verified_at,
        notes,
        case when coverage is null then null else st_xmin(coverage) end as west,
        case when coverage is null then null else st_ymin(coverage) end as south,
        case when coverage is null then null else st_xmax(coverage) end as east,
        case when coverage is null then null else st_ymax(coverage) end as north
      from imagery_source
      order by provider, name
    `.execute(trx);
    return result.rows.map(toSource);
  });
}

export async function createImagerySource(
  db: Kysely<Database>,
  workspaceId: string,
  body: CreateSourceBody,
): Promise<ImagerySourceRow> {
  const verifiedAt = body.verifiedAt ?? null;
  assertLicenseFlags({
    allowsTracing: body.allowsTracing,
    allowsMlTraining: body.allowsMlTraining,
    verifiedAt,
  });
  const id = createId();
  try {
    await withImageryAdminContext(db, workspaceId, async (trx) => {
      await sql`
        insert into imagery_source (
          id, workspace_id, provider, name, bands, license_text, license_url,
          allows_tracing, allows_ml_training, attribution, verified_at, notes, gsd_cm, capture_date
        ) values (
          ${id}::uuid,
          null,
          ${body.provider},
          ${body.name},
          ${body.bands},
          ${body.licenseText ?? null},
          ${body.licenseUrl ?? null},
          ${body.allowsTracing},
          ${body.allowsMlTraining},
          ${body.attribution ?? null},
          ${verifiedAt}::timestamptz,
          ${body.notes ?? null},
          ${body.gsdCm ?? null},
          ${body.captureDate ?? null}::date
        )
      `.execute(trx);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ProblemError({
        status: 409,
        title: "Conflict",
        detail: "A global imagery source with that name already exists.",
      });
    }
    throw error;
  }
  const sources = await listImagerySources(db, workspaceId);
  const created = sources.find((source) => source.id === id);
  if (!created) {
    throw new ProblemError({
      status: 500,
      title: "Internal Server Error",
      detail: "The imagery source was not readable after insert.",
    });
  }
  return created;
}

export async function patchImagerySource(
  db: Kysely<Database>,
  workspaceId: string,
  sourceId: string,
  body: PatchSourceBody,
): Promise<ImagerySourceRow> {
  return withImageryAdminContext(db, workspaceId, async (trx) => {
    const current = await sql<SourceSql>`
      select
        id::text as id,
        workspace_id::text as workspace_id,
        provider,
        name,
        bands,
        gsd_cm::float8 as gsd_cm,
        capture_date::text as capture_date,
        license_text,
        license_url,
        allows_tracing,
        allows_ml_training,
        attribution,
        verified_at,
        notes,
        null::float8 as west,
        null::float8 as south,
        null::float8 as east,
        null::float8 as north
      from imagery_source
      where id = ${sourceId}::uuid
    `.execute(trx);
    const row = current.rows[0];
    if (!row) {
      throw new ProblemError({
        status: 404,
        title: "Not Found",
        detail: "No imagery source matches that id.",
      });
    }
    const verifiedAt =
      body.verifiedAt === undefined ? isoTimestamp(row.verified_at) : body.verifiedAt;
    const allowsTracing = body.allowsTracing ?? row.allows_tracing;
    const allowsMlTraining = body.allowsMlTraining ?? row.allows_ml_training;
    assertLicenseFlags({ allowsTracing, allowsMlTraining, verifiedAt });
    await sql`
      update imagery_source
      set license_text = ${body.licenseText === undefined ? row.license_text : body.licenseText},
          license_url = ${body.licenseUrl === undefined ? row.license_url : body.licenseUrl},
          allows_tracing = ${allowsTracing},
          allows_ml_training = ${allowsMlTraining},
          attribution = ${body.attribution === undefined ? row.attribution : body.attribution},
          verified_at = ${verifiedAt}::timestamptz,
          notes = ${body.notes === undefined ? row.notes : body.notes},
          updated_at = now()
      where id = ${sourceId}::uuid
    `.execute(trx);
    const updated = await sql<SourceSql>`
      select
        id::text as id,
        workspace_id::text as workspace_id,
        provider,
        name,
        bands,
        gsd_cm::float8 as gsd_cm,
        capture_date::text as capture_date,
        license_text,
        license_url,
        allows_tracing,
        allows_ml_training,
        attribution,
        verified_at,
        notes,
        case when coverage is null then null else st_xmin(coverage) end as west,
        case when coverage is null then null else st_ymin(coverage) end as south,
        case when coverage is null then null else st_xmax(coverage) end as east,
        case when coverage is null then null else st_ymax(coverage) end as north
      from imagery_source
      where id = ${sourceId}::uuid
    `.execute(trx);
    const next = updated.rows[0];
    if (!next) {
      throw new ProblemError({
        status: 404,
        title: "Not Found",
        detail: "No imagery source matches that id.",
      });
    }
    return toSource(next);
  });
}

type SourceSql = {
  id: string;
  workspace_id: string | null;
  provider: string;
  name: string;
  bands: string;
  gsd_cm: number | null;
  capture_date: string | null;
  license_text: string | null;
  license_url: string | null;
  allows_tracing: boolean;
  allows_ml_training: boolean;
  attribution: string | null;
  verified_at: Date | null;
  notes: string | null;
  west: number | null;
  south: number | null;
  east: number | null;
  north: number | null;
};

export type ImagerySourceRow = {
  id: string;
  workspaceId: string | null;
  provider: string;
  name: string;
  bands: string;
  gsdCm: number | null;
  captureDate: string | null;
  licenseText: string | null;
  licenseUrl: string | null;
  allowsTracing: boolean;
  allowsMlTraining: boolean;
  attribution: string | null;
  verifiedAt: string | null;
  notes: string | null;
  coverage: { west: number; south: number; east: number; north: number } | null;
};

function isoTimestamp(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toSource(row: SourceSql): ImagerySourceRow {
  const coverage =
    row.west === null || row.south === null || row.east === null || row.north === null
      ? null
      : {
          west: Number(row.west),
          south: Number(row.south),
          east: Number(row.east),
          north: Number(row.north),
        };
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    name: row.name,
    bands: row.bands,
    gsdCm: row.gsd_cm === null ? null : Number(row.gsd_cm),
    captureDate: row.capture_date,
    licenseText: row.license_text,
    licenseUrl: row.license_url,
    allowsTracing: row.allows_tracing,
    allowsMlTraining: row.allows_ml_training,
    attribution: row.attribution,
    verifiedAt: isoTimestamp(row.verified_at),
    notes: row.notes,
    coverage,
  };
}
