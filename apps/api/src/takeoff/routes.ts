import { displayFromMetric } from "@groundwork/geo";
import {
  createId,
  hasPermission,
  IllegalTakeoffTransitionError,
  isTakeoffStatus,
  transitionTakeoff,
  type TakeoffStatus,
} from "@groundwork/shared";
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest, RawServerDefault } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Kysely, Transaction } from "kysely";
import type { IncomingMessage, ServerResponse } from "node:http";
import type pg from "pg";
import { z } from "zod/v4";

import type { Auth } from "../auth/auth.js";
import { requireActiveMember, requireSession, type MemberRow } from "../auth/guard.js";
import { workspaceIdFromHeader } from "../auth/hook.js";
import type { Database } from "../db/types.js";
import { withWorkspaceContext } from "../db/workspace.js";
import { ProblemError } from "../errors.js";
import { runAssist, type AssistRequest } from "./assist.js";
import {
  advanceTakeoff,
  CAPTURE_CONFIRM_DETAIL,
  captureChangeWarning,
  cloneTakeoff,
  deleteFeature,
  getTakeoff,
  insertTakeoff,
  listFeatures,
  listOverlaps,
  loadJob,
  locationExists,
  requireMeasurableCapture,
  summarize,
  updateCapture,
  upsertFeatures,
  type StoredFeature,
  type TakeoffRecord,
} from "./data.js";
import {
  geometryMatchesKind,
  parseDeductions,
  parseGeometry,
  type MeasurementInput,
} from "./geometry.js";

const TENANT = ["tenant-header"] as const;

type ApiApp = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;
type Trx = Transaction<Database>;

export type TakeoffContext = {
  db: Kysely<Database>;
  authPool: pg.Pool;
  auth: Auth;
};

const geometrySchema = z.object({
  type: z.string(),
  coordinates: z.unknown(),
});

const featureProperties = z.object({
  takeoff_item_id: z.string(),
  kind: z.enum(["area", "length", "count"]),
  value_m2: z.string().nullable(),
  value_m: z.string().nullable(),
  count: z.number().int().nullable(),
  source: z.enum(["manual", "ai_assist", "ai_auto"]),
  confidence: z.number().nullable(),
  label: z.string().nullable(),
  deductions: z.array(geometrySchema),
  display: z.object({
    ft2: z.string().nullable(),
    yd2: z.string().nullable(),
    acres: z.string().nullable(),
    ft: z.string().nullable(),
  }),
});

const featureSchema = z.object({
  type: z.literal("Feature"),
  id: z.string(),
  geometry: geometrySchema,
  properties: featureProperties,
});

const collectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(featureSchema),
  corrections: z.array(
    z.object({
      id: z.string(),
      reason: z.literal("self_intersection"),
      geometry: geometrySchema,
    }),
  ),
  overlaps: z.array(
    z.object({
      takeoff_item_id: z.string(),
      measurement_ids: z.tuple([z.string(), z.string()]),
    }),
  ),
});

const takeoffSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  location_id: z.string().nullable(),
  lineage_id: z.string(),
  supersedes_id: z.string().nullable(),
  kind: z.enum(["aerial", "planset"]),
  imagery_capture_id: z.string().nullable(),
  status: z.enum(["draft", "in_review", "final"]),
  version: z.number().int(),
  measurement_count: z.number().int(),
  warnings: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});

const summarySchema = z.object({
  items: z.array(
    z.object({
      takeoff_item_id: z.string(),
      name: z.string(),
      measure_kind: z.enum(["area", "length", "count"]),
      sum_m2: z.string().nullable(),
      sum_m: z.string().nullable(),
      union_m2: z.string().nullable(),
      union_m: z.string().nullable(),
      count: z.number().int().nullable(),
      overlap_count: z.number().int(),
      display: z.object({
        sum_ft2: z.string().nullable(),
        sum_yd2: z.string().nullable(),
        sum_acres: z.string().nullable(),
        union_ft2: z.string().nullable(),
        union_yd2: z.string().nullable(),
        union_acres: z.string().nullable(),
        sum_ft: z.string().nullable(),
        union_ft: z.string().nullable(),
      }),
    }),
  ),
});

const idParams = z.object({ id: z.uuidv7() });

const assistBody = z.object({
  imagery_capture_id: z.uuidv7(),
  takeoff_item_id: z.uuidv7(),
  points: z
    .array(
      z.object({
        lng: z.number().gte(-180).lte(180),
        lat: z.number().gte(-90).lte(90),
        label: z.union([z.literal(0), z.literal(1)]),
      }),
    )
    .max(32),
  box: z
    .object({
      west: z.number().gte(-180).lte(180),
      south: z.number().gte(-90).lte(90),
      east: z.number().gte(-180).lte(180),
      north: z.number().gte(-90).lte(90),
    })
    .optional(),
});

const assistResponse = z.object({
  run_id: z.string(),
  status: z.literal("succeeded"),
  features: z.array(
    z.object({
      id: z.string(),
      geometry: geometrySchema,
      properties: z.object({
        class: z.string().nullable(),
        score: z.number().nullable(),
        area_m2: z.string(),
        takeoff_item_id: z.string().nullable(),
      }),
    }),
  ),
});

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;

function idempotencyKeyFrom(header: string | string[] | undefined): string {
  if (header === undefined) {
    return createId();
  }
  if (Array.isArray(header) || !IDEMPOTENCY_KEY.test(header)) {
    throw badRequest(
      "Idempotency-Key must be 8 to 200 letters, numbers, dots, colons, underscores, or hyphens.",
    );
  }
  return header;
}

const featureBody = z.object({
  id: z.uuidv7(),
  takeoff_item_id: z.uuidv7(),
  kind: z.enum(["area", "length", "count"]),
  geom: z.object({ type: z.string(), coordinates: z.unknown() }),
  deductions: z.array(z.unknown()).max(50).optional(),
  source: z.enum(["manual", "ai_assist", "ai_auto"]).optional(),
  label: z.string().max(200).nullable().optional(),
  count: z.number().int().positive().max(1_000_000).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

function forbidden(): ProblemError {
  return new ProblemError({
    status: 403,
    title: "Forbidden",
    detail: "You do not have permission to do that.",
  });
}

function notFound(detail: string): ProblemError {
  return new ProblemError({ status: 404, title: "Not Found", detail });
}

function badRequest(detail: string): ProblemError {
  return new ProblemError({ status: 400, title: "Bad Request", detail });
}

function conflict(detail: string): ProblemError {
  return new ProblemError({ status: 409, title: "Conflict", detail });
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function canRead(permissions: readonly string[]): boolean {
  return hasPermission(permissions, "takeoff.*") || hasPermission(permissions, "takeoff.read");
}

function canWrite(permissions: readonly string[]): boolean {
  return hasPermission(permissions, "takeoff.*");
}

function presentTakeoff(row: TakeoffRecord, warnings: string[]) {
  return {
    id: row.id,
    job_id: row.job_id,
    location_id: row.location_id,
    lineage_id: row.lineage_id,
    supersedes_id: row.supersedes_id,
    kind: row.kind,
    imagery_capture_id: row.imagery_capture_id,
    status: row.status,
    version: row.version,
    measurement_count: row.measurement_count,
    warnings,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function presentFeature(feature: StoredFeature) {
  const area = feature.kind === "area" ? feature.value_m2 : null;
  const length = feature.kind === "length" ? feature.value_m : null;
  const deductions = Array.isArray(feature.deductions) ? feature.deductions : [];
  return {
    type: "Feature" as const,
    id: feature.id,
    geometry: feature.geometry,
    properties: {
      takeoff_item_id: feature.takeoff_item_id,
      kind: feature.kind,
      value_m2: feature.value_m2,
      value_m: feature.value_m,
      count: feature.count,
      source: feature.source,
      confidence: feature.confidence,
      label: feature.label,
      deductions,
      display: {
        ft2: area ? displayFromMetric(area, "ft2") : null,
        yd2: area ? displayFromMetric(area, "yd2") : null,
        acres: area ? displayFromMetric(area, "acre") : null,
        ft: length ? displayFromMetric(length, "ft") : null,
      },
    },
  };
}

function emptyLabel(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toInput(body: z.infer<typeof featureBody>): MeasurementInput {
  const geom = parseGeometry(body.geom);
  if (!geometryMatchesKind(body.kind, geom)) {
    throw badRequest("The geometry does not match the measurement kind.");
  }
  if (body.kind !== "count" && body.count !== undefined && body.count !== null) {
    throw badRequest("Only a count measurement has a count.");
  }
  if (body.kind !== "area" && body.deductions !== undefined && body.deductions.length > 0) {
    throw badRequest("Only an area measurement has deductions.");
  }
  return {
    id: body.id,
    takeoffItemId: body.takeoff_item_id,
    kind: body.kind,
    geom,
    deductions: body.kind === "area" ? parseDeductions(body.deductions ?? []) : [],
    source: body.source ?? "manual",
    label: emptyLabel(body.label),
    count: body.kind === "count" ? (body.count ?? null) : null,
    confidence: body.confidence ?? null,
  };
}

export async function registerTakeoffRoutes(app: ApiApp, ctx: TakeoffContext): Promise<void> {
  async function permissionsOf(trx: Trx, roleId: string): Promise<string[]> {
    const role = await trx
      .selectFrom("role")
      .select("permissions")
      .where("id", "=", roleId)
      .executeTakeFirst();
    return role?.permissions ?? [];
  }

  async function inWorkspace<T>(
    request: FastifyRequest,
    mode: "read" | "write",
    fn: (scope: { trx: Trx; workspaceId: string; member: MemberRow }) => Promise<T>,
  ): Promise<T> {
    const session = await requireSession(ctx.auth, request.headers);
    const workspaceId = workspaceIdFromHeader(request);
    const member = await requireActiveMember(ctx, session.id, workspaceId);
    return withWorkspaceContext(ctx.db, workspaceId, async (trx) => {
      const permissions = await permissionsOf(trx, member.role_id);
      if (mode === "write" ? !canWrite(permissions) : !canRead(permissions)) {
        throw forbidden();
      }
      return fn({ trx, workspaceId, member });
    });
  }

  app.post(
    "/jobs/:id/takeoffs",
    {
      schema: {
        tags: [...TENANT],
        params: idParams,
        body: z.object({
          kind: z.enum(["aerial", "planset"]),
          location_id: z.uuidv7().optional(),
          imagery_capture_id: z.uuidv7().optional(),
        }),
        response: { 201: takeoffSchema },
      },
    },
    async (request, reply) => {
      const created = await inWorkspace(request, "write", async ({ trx, workspaceId, member }) => {
        const job = await loadJob(trx, request.params.id);
        if (!job) {
          throw notFound("That job was not found.");
        }
        const body = request.body;
        let locationId = body.location_id ?? job.location_id;
        if (body.location_id && job.location_id && body.location_id !== job.location_id) {
          throw conflict("The takeoff location has to be the job location.");
        }
        if (locationId && !(await locationExists(trx, locationId))) {
          throw notFound("That location was not found.");
        }
        if (body.kind === "aerial" && !locationId) {
          throw badRequest("An aerial takeoff needs a location.");
        }
        if (body.kind === "aerial" && !body.imagery_capture_id) {
          throw badRequest("An aerial takeoff needs an imagery capture.");
        }
        let captureId: string | null = null;
        if (body.imagery_capture_id) {
          const capture = await requireMeasurableCapture(trx, body.imagery_capture_id);
          captureId = capture.id;
        }
        if (body.kind === "planset") {
          locationId = locationId ?? null;
        }
        return insertTakeoff(trx, {
          workspaceId,
          memberId: member.id,
          jobId: job.id,
          locationId,
          kind: body.kind,
          imageryCaptureId: captureId,
        });
      });
      return reply.status(201).send(presentTakeoff(created, []));
    },
  );

  app.get(
    "/takeoffs/:id",
    {
      schema: {
        tags: [...TENANT],
        params: idParams,
        response: { 200: takeoffSchema },
      },
    },
    async (request) => {
      const takeoff = await inWorkspace(request, "read", ({ trx }) =>
        getTakeoff(trx, request.params.id),
      );
      return presentTakeoff(takeoff, []);
    },
  );

  app.patch(
    "/takeoffs/:id",
    {
      schema: {
        tags: [...TENANT],
        params: idParams,
        body: z.object({
          status: z.enum(["draft", "in_review", "final"]).optional(),
          imagery_capture_id: z.uuidv7().optional(),
          confirm: z.boolean().optional(),
        }),
        response: { 200: takeoffSchema },
      },
    },
    async (request) => {
      return inWorkspace(request, "write", async ({ trx, workspaceId, member }) => {
        let takeoff = await getTakeoff(trx, request.params.id);
        const warnings: string[] = [];
        const nextCapture = request.body.imagery_capture_id;
        if (nextCapture && nextCapture !== takeoff.imagery_capture_id) {
          if (takeoff.status === "final") {
            throw conflict("A final takeoff is read-only. Reopen it to draft a new version.");
          }
          const capture = await requireMeasurableCapture(trx, nextCapture);
          if (takeoff.measurement_count > 0 && request.body.confirm !== true) {
            throw new ProblemError({
              status: 409,
              title: "Conflict",
              detail: CAPTURE_CONFIRM_DETAIL,
              errors: [
                {
                  path: "imagery_capture_id",
                  message: captureChangeWarning(capture),
                },
              ],
            });
          }
          if (takeoff.measurement_count > 0) {
            warnings.push(captureChangeWarning(capture));
          }
          await updateCapture(trx, { workspaceId, memberId: member.id, takeoff, capture });
          takeoff = await getTakeoff(trx, takeoff.id);
        }
        if (request.body.status) {
          const status = request.body.status;
          if (!isTakeoffStatus(status)) {
            throw badRequest("That takeoff status is not recognized.");
          }
          let transition: ReturnType<typeof transitionTakeoff>;
          try {
            transition = transitionTakeoff(takeoff.status, status);
          } catch (error) {
            if (error instanceof IllegalTakeoffTransitionError) {
              throw conflict(error.message);
            }
            throw error;
          }
          if (transition === "advance") {
            takeoff = await advanceTakeoff(trx, {
              workspaceId,
              memberId: member.id,
              takeoff,
              status: status as TakeoffStatus,
            });
          }
          if (transition === "clone") {
            takeoff = await cloneTakeoff(trx, { workspaceId, memberId: member.id, takeoff });
          }
        }
        return presentTakeoff(takeoff, warnings);
      });
    },
  );

  app.get(
    "/takeoffs/:id/measurements",
    {
      schema: {
        tags: [...TENANT],
        params: idParams,
        response: { 200: collectionSchema },
      },
    },
    async (request) => {
      return inWorkspace(request, "read", async ({ trx }) => {
        await getTakeoff(trx, request.params.id);
        return collection(trx, request.params.id, []);
      });
    },
  );

  app.put(
    "/takeoffs/:id/measurements",
    {
      schema: {
        tags: [...TENANT],
        params: idParams,
        body: z.object({
          features: z.array(featureBody).max(2_000),
        }),
        response: { 200: collectionSchema },
      },
    },
    async (request) => {
      return inWorkspace(request, "write", async ({ trx, workspaceId, member }) => {
        const takeoff = await getTakeoff(trx, request.params.id);
        const features = request.body.features.map((feature) => toInput(feature));
        const corrections = await upsertFeatures(trx, {
          workspaceId,
          memberId: member.id,
          takeoff,
          features,
        });
        return collection(trx, takeoff.id, corrections);
      });
    },
  );

  app.delete(
    "/measurements/:id",
    {
      schema: {
        tags: [...TENANT],
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await inWorkspace(request, "write", ({ trx }) => deleteFeature(trx, request.params.id));
      return reply.status(204).send(null);
    },
  );

  app.post(
    "/takeoffs/:id/assist",
    {
      schema: {
        tags: [...TENANT],
        params: idParams,
        body: assistBody,
        response: { 200: assistResponse },
      },
    },
    async (request) => {
      const scope = await inWorkspace(request, "write", async ({ workspaceId, member }) => ({
        workspaceId,
        memberId: member.id,
      }));
      const body: AssistRequest = request.body;
      return runAssist(ctx.db, {
        workspaceId: scope.workspaceId,
        memberId: scope.memberId,
        takeoffId: request.params.id,
        body,
        idempotencyKey: idempotencyKeyFrom(request.headers["idempotency-key"]),
      });
    },
  );

  app.get(
    "/takeoffs/:id/summary",
    {
      schema: {
        tags: [...TENANT],
        params: idParams,
        response: { 200: summarySchema },
      },
    },
    async (request) => {
      return inWorkspace(request, "read", async ({ trx }) => {
        await getTakeoff(trx, request.params.id);
        return { items: await summarize(trx, request.params.id) };
      });
    },
  );
}

async function collection(
  trx: Trx,
  takeoffId: string,
  corrections: { id: string; reason: "self_intersection"; geometry: StoredFeature["geometry"] }[],
) {
  const features = await listFeatures(trx, takeoffId);
  const overlaps = await listOverlaps(trx, takeoffId);
  return {
    type: "FeatureCollection" as const,
    features: features.map(presentFeature),
    corrections,
    overlaps,
  };
}
