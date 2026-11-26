import { hasPermission, isUuidV7, type EstimateStatus } from "@groundwork/shared";
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
import { stripEstimateCosts } from "./access.js";
import {
  addManualLine,
  applyQuantities,
  cloneEstimateVersion,
  createEstimate,
  deleteLine,
  getEstimate,
  listJobEstimates,
  patchEstimate,
  patchLine,
  quantityDiff,
  recalculateEstimate,
  transitionEstimateStatus,
  type EstimateView,
} from "./data.js";

const TENANT = ["tenant-header"] as const;

type ApiApp = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;
type Trx = Transaction<Database>;

export type EstimateContext = {
  db: Kysely<Database>;
  authPool: pg.Pool;
  auth: Auth;
};

const STATUSES = ["draft", "ready", "sent", "accepted", "superseded"] as const;

const lineSchema = z.object({
  id: z.string(),
  group: z.string().nullable(),
  description: z.string(),
  qty: z.string(),
  unit: z.string(),
  unit_price_cents: z.number().int(),
  price_cents: z.number().int(),
  tax_cents: z.number().int(),
  unit_cost_cents: z.number().int().optional(),
  cost_cents: z.number().int().optional(),
  margin_cents: z.number().int().optional(),
  margin_pct: z.string().nullable().optional(),
  source: z.enum(["recipe", "manual"]),
  recipe_id: z.string().nullable(),
  recipe_version: z.number().int().nullable(),
  recipe_component_id: z.string().nullable(),
  catalog_item_id: z.string().nullable(),
  takeoff_item_id: z.string().nullable(),
  input_qty: z.string().nullable(),
  input_unit: z.string().nullable(),
  variables: z.record(z.string(), z.string()),
  markup_pct: z.string().nullable(),
  overhead_pct: z.string().nullable(),
  tax_code: z.string().nullable(),
  flagged: z.boolean(),
  optional: z.boolean(),
  price_overridden: z.boolean(),
  measurement_ids: z.array(z.string()),
  sort: z.number().int(),
  recipe_variables: z.record(z.string(), z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});

const estimateSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  takeoff_id: z.string().nullable(),
  number: z.string(),
  version: z.number().int(),
  status: z.enum(STATUSES),
  markup_pct: z.string(),
  overhead_pct: z.string(),
  tax_rate: z.string(),
  notes: z.string().nullable(),
  subtotal_cents: z.number().int(),
  tax_cents: z.number().int(),
  total_cents: z.number().int(),
  optional_subtotal_cents: z.number().int(),
  optional_tax_cents: z.number().int(),
  optional_total_cents: z.number().int(),
  cost_cents: z.number().int().optional(),
  margin_cents: z.number().int().optional(),
  margin_pct: z.string().nullable().optional(),
  lines: z.array(lineSchema),
  created_at: z.string(),
  updated_at: z.string(),
});

const summarySchema = z.object({
  id: z.string(),
  job_id: z.string(),
  takeoff_id: z.string().nullable(),
  number: z.string(),
  version: z.number().int(),
  status: z.enum(STATUSES),
  total_cents: z.number().int(),
  updated_at: z.string(),
});

const quantityItemSchema = z.object({
  change: z.enum(["added", "removed", "changed"]),
  takeoff_item_id: z.string(),
  name: z.string(),
  unit: z.string(),
  old_qty: z.string().nullable(),
  new_qty: z.string().nullable(),
});

const quantityDiffSchema = z.object({
  estimate_id: z.string(),
  takeoff_id: z.string().nullable(),
  compared_takeoff_id: z.string().nullable(),
  compared_takeoff_version: z.number().int().nullable(),
  items: z.array(quantityItemSchema),
});

const percent = z.union([z.string(), z.number()]);
const money = z.number().int();

function forbidden(): ProblemError {
  return new ProblemError({
    status: 403,
    title: "Forbidden",
    detail: "You do not have permission to do that.",
  });
}

function badRequest(detail: string): ProblemError {
  return new ProblemError({ status: 400, title: "Bad Request", detail });
}

function canRead(permissions: readonly string[]): boolean {
  return hasPermission(permissions, "estimate.*") || hasPermission(permissions, "estimate.read");
}

function canWrite(permissions: readonly string[]): boolean {
  return hasPermission(permissions, "estimate.*");
}

function present(view: EstimateView, permissions: readonly string[]): EstimateView {
  return stripEstimateCosts(view, permissions);
}

function decimalQty(value: string | number): string {
  const text = String(value).trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) {
    throw badRequest("Quantity must be a decimal.");
  }
  return text;
}

function blank(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function registerEstimateRoutes(app: ApiApp, ctx: EstimateContext): Promise<void> {
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
    fn: (scope: {
      trx: Trx;
      workspaceId: string;
      member: MemberRow;
      permissions: string[];
    }) => Promise<T>,
  ): Promise<T> {
    const session = await requireSession(ctx.auth, request.headers);
    const workspaceId = workspaceIdFromHeader(request);
    const member = await requireActiveMember(ctx, session.id, workspaceId);
    return withWorkspaceContext(ctx.db, workspaceId, async (trx) => {
      const permissions = await permissionsOf(trx, member.role_id);
      if (mode === "write" ? !canWrite(permissions) : !canRead(permissions)) {
        throw forbidden();
      }
      return fn({ trx, workspaceId, member, permissions });
    });
  }

  app.post(
    "/jobs/:id/estimates",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({
          from_takeoff_id: z.uuidv7().optional(),
          template_id: z.uuidv7().optional(),
        }),
        response: { 201: estimateSchema },
      },
    },
    async (request, reply) => {
      if (request.body.template_id) {
        throw badRequest("Estimate templates are not in this slice.");
      }
      const view = await inWorkspace(
        request,
        "write",
        ({ trx, workspaceId, member, permissions }) =>
          createEstimate(trx, {
            workspaceId,
            memberId: member.id,
            jobId: request.params.id,
            fromTakeoffId: request.body.from_takeoff_id,
          }).then((created) => present(created, permissions)),
      );
      return reply.status(201).send(view);
    },
  );

  app.get(
    "/jobs/:id/estimates",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        response: { 200: z.object({ estimates: z.array(summarySchema) }) },
      },
    },
    async (request) => {
      return inWorkspace(request, "read", ({ trx }) => listJobEstimates(trx, request.params.id));
    },
  );

  app.get(
    "/estimates/:id",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        response: { 200: estimateSchema },
      },
    },
    async (request) => {
      return inWorkspace(request, "read", async ({ trx, permissions }) => {
        return present(await getEstimate(trx, request.params.id), permissions);
      });
    },
  );

  app.patch(
    "/estimates/:id",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({
          markup_pct: percent.optional(),
          overhead_pct: percent.optional(),
          tax_rate: percent.optional(),
          notes: z.string().max(8000).nullable().optional(),
        }),
        response: { 200: estimateSchema },
      },
    },
    async (request) => {
      return inWorkspace(request, "write", async ({ trx, workspaceId, member, permissions }) => {
        const view = await patchEstimate(trx, {
          workspaceId,
          memberId: member.id,
          estimateId: request.params.id,
          markupPct: request.body.markup_pct,
          overheadPct: request.body.overhead_pct,
          taxRate: request.body.tax_rate,
          notes: request.body.notes,
        });
        return present(view, permissions);
      });
    },
  );

  app.post(
    "/estimates/:id/lines",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({
          group: z.string().trim().max(200).nullable().optional(),
          description: z.string().trim().min(1).max(500),
          qty: z.union([z.string(), z.number()]),
          unit: z.string().trim().min(1).max(40),
          unit_cost_cents: money.optional(),
          unit_price_cents: money.optional(),
          price_cents: money.optional(),
          markup_pct: percent.nullable().optional(),
          overhead_pct: percent.nullable().optional(),
          tax_code: z.string().trim().max(40).nullable().optional(),
          optional: z.boolean().optional(),
        }),
        response: { 201: estimateSchema },
      },
    },
    async (request, reply) => {
      if (request.body.price_cents !== undefined && request.body.unit_price_cents !== undefined) {
        throw badRequest("Send unit_price_cents or price_cents, not both.");
      }
      const view = await inWorkspace(
        request,
        "write",
        ({ trx, workspaceId, member, permissions }) =>
          addManualLine(trx, {
            workspaceId,
            memberId: member.id,
            permissions,
            estimateId: request.params.id,
            group: blank(request.body.group),
            description: request.body.description,
            qty: decimalQty(request.body.qty),
            unit: request.body.unit,
            unitCostCents: BigInt(request.body.unit_cost_cents ?? 0),
            unitPriceCents:
              request.body.unit_price_cents === undefined
                ? null
                : BigInt(request.body.unit_price_cents),
            explicitPriceCents:
              request.body.price_cents === undefined ? null : BigInt(request.body.price_cents),
            markupPct:
              request.body.markup_pct === undefined || request.body.markup_pct === null
                ? null
                : String(request.body.markup_pct),
            overheadPct:
              request.body.overhead_pct === undefined || request.body.overhead_pct === null
                ? null
                : String(request.body.overhead_pct),
            taxCode: blank(request.body.tax_code),
            optional: request.body.optional ?? false,
          }).then((created) => present(created, permissions)),
      );
      return reply.status(201).send(view);
    },
  );

  app.patch(
    "/line-items/:id",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({
          group: z.string().trim().max(200).nullable().optional(),
          description: z.string().trim().min(1).max(500).optional(),
          qty: z.union([z.string(), z.number()]).optional(),
          unit: z.string().trim().min(1).max(40).optional(),
          unit_cost_cents: money.optional(),
          unit_price_cents: money.optional(),
          price_cents: money.optional(),
          clear_price_override: z.boolean().optional(),
          variables: z.record(z.string(), z.string()).optional(),
          markup_pct: percent.nullable().optional(),
          overhead_pct: percent.nullable().optional(),
          tax_code: z.string().trim().max(40).nullable().optional(),
          optional: z.boolean().optional(),
        }),
        response: { 200: estimateSchema },
      },
    },
    async (request) => {
      if (!isUuidV7(request.params.id)) {
        throw badRequest("Line id must be a UUIDv7.");
      }
      if (request.body.price_cents !== undefined && request.body.unit_price_cents !== undefined) {
        throw badRequest("Send unit_price_cents or price_cents, not both.");
      }
      return inWorkspace(request, "write", async ({ trx, workspaceId, member, permissions }) => {
        const view = await patchLine(trx, {
          workspaceId,
          memberId: member.id,
          permissions,
          lineId: request.params.id,
          patch: {
            group: request.body.group === undefined ? undefined : blank(request.body.group),
            description: request.body.description,
            qty: request.body.qty === undefined ? undefined : decimalQty(request.body.qty),
            unit: request.body.unit,
            unitCostCents:
              request.body.unit_cost_cents === undefined
                ? undefined
                : BigInt(request.body.unit_cost_cents),
            unitPriceCents:
              request.body.unit_price_cents === undefined
                ? undefined
                : BigInt(request.body.unit_price_cents),
            explicitPriceCents:
              request.body.price_cents === undefined ? undefined : BigInt(request.body.price_cents),
            clearPriceOverride: request.body.clear_price_override,
            variables: request.body.variables,
            markupPct:
              request.body.markup_pct === undefined
                ? undefined
                : request.body.markup_pct === null
                  ? null
                  : String(request.body.markup_pct),
            overheadPct:
              request.body.overhead_pct === undefined
                ? undefined
                : request.body.overhead_pct === null
                  ? null
                  : String(request.body.overhead_pct),
            taxCode: request.body.tax_code === undefined ? undefined : blank(request.body.tax_code),
            optional: request.body.optional,
          },
        });
        return present(view, permissions);
      });
    },
  );

  app.delete(
    "/line-items/:id",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
      },
    },
    async (request, reply) => {
      await inWorkspace(request, "write", ({ trx, workspaceId, member }) =>
        deleteLine(trx, { workspaceId, memberId: member.id, lineId: request.params.id }),
      );
      reply.code(204);
      return null;
    },
  );

  app.post(
    "/estimates/:id/recalculate",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({}),
        response: { 200: estimateSchema },
      },
    },
    async (request) => {
      return inWorkspace(request, "write", async ({ trx, workspaceId, member, permissions }) => {
        const view = await recalculateEstimate(trx, {
          workspaceId,
          memberId: member.id,
          estimateId: request.params.id,
        });
        return present(view, permissions);
      });
    },
  );

  app.post(
    "/estimates/:id/transition",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({ to: z.enum(STATUSES) }),
        response: { 200: estimateSchema },
      },
    },
    async (request) => {
      return inWorkspace(request, "write", async ({ trx, workspaceId, member, permissions }) => {
        const view = await transitionEstimateStatus(trx, {
          workspaceId,
          memberId: member.id,
          estimateId: request.params.id,
          to: request.body.to as EstimateStatus,
        });
        return present(view, permissions);
      });
    },
  );

  app.get(
    "/estimates/:id/quantity-diff",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        response: { 200: quantityDiffSchema },
      },
    },
    async (request) => {
      return inWorkspace(request, "read", ({ trx }) => quantityDiff(trx, request.params.id));
    },
  );

  app.post(
    "/estimates/:id/apply-quantities",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({
          takeoff_item_ids: z.array(z.uuidv7()).optional(),
        }),
        response: { 200: estimateSchema },
      },
    },
    async (request) => {
      return inWorkspace(request, "write", async ({ trx, workspaceId, member, permissions }) => {
        const view = await applyQuantities(trx, {
          workspaceId,
          memberId: member.id,
          estimateId: request.params.id,
          takeoffItemIds: request.body.takeoff_item_ids,
        });
        return present(view, permissions);
      });
    },
  );

  app.post(
    "/estimates/:id/versions",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({}),
        response: { 201: estimateSchema },
      },
    },
    async (request, reply) => {
      const view = await inWorkspace(
        request,
        "write",
        ({ trx, workspaceId, member, permissions }) =>
          cloneEstimateVersion(trx, {
            workspaceId,
            memberId: member.id,
            estimateId: request.params.id,
          }).then((created) => present(created, permissions)),
      );
      return reply.status(201).send(view);
    },
  );
}
