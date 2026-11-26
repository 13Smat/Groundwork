import { hasPermission } from "@groundwork/shared";
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
import {
  createProposal,
  createTemplate,
  getProposal,
  listEstimateProposals,
  listJobProposals,
  listTemplates,
  patchProposal,
  patchTemplate,
} from "./data.js";
import type { Mailer } from "../auth/mail.js";
import { registerEsignRoutes } from "./esign-routes.js";
import type { EsignProvider } from "./esign.js";
import type { ProposalFiles } from "./files.js";
import type { ProposalRenderMessage } from "./render.js";
import { readProposalPdf, waitForRenderedPdf } from "./render.js";

const TENANT = ["tenant-header"] as const;
const STATUSES = [
  "draft",
  "rendered",
  "sent",
  "viewed",
  "signed",
  "declined",
  "expired",
  "void",
] as const;

type ApiApp = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;
type Trx = Transaction<Database>;

export type ProposalContext = {
  db: Kysely<Database>;
  authPool: pg.Pool;
  auth: Auth;
  dispatch?: ((message: ProposalRenderMessage) => Promise<void>) | undefined;
  esign?: EsignProvider | undefined;
  files?: ProposalFiles | undefined;
  renderPdf?: ((html: string) => Promise<Buffer>) | undefined;
  mailer?: Mailer | undefined;
};

const lineSchema = z.object({
  id: z.string(),
  group: z.string().nullable(),
  description: z.string(),
  qty: z.string(),
  unit: z.string(),
  unit_price_cents: z.number().int(),
  price_cents: z.number().int(),
  tax_cents: z.number().int(),
  optional: z.boolean(),
  selected: z.boolean(),
});

const proposalSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  estimate_id: z.string(),
  template_id: z.string().nullable(),
  number: z.string(),
  status: z.enum(STATUSES),
  intro: z.string(),
  scope_note: z.string(),
  terms: z.string(),
  include_site_map: z.boolean(),
  include_optional: z.boolean(),
  selected_optional_line_ids: z.array(z.string()),
  estimate_number: z.string(),
  estimate_version: z.number().int(),
  expires_at: z.string().nullable(),
  pdf_file_id: z.string().nullable(),
  subtotal_cents: z.number().int(),
  tax_cents: z.number().int(),
  total_cents: z.number().int(),
  lines: z.array(lineSchema),
  bounced: z.boolean(),
  recipients: z.array(z.object({ name: z.string(), email: z.string() })),
  signatures: z.array(
    z.object({
      signer_name: z.string().nullable(),
      signer_email: z.string().nullable(),
      signed_at: z.string().nullable(),
    }),
  ),
  work_order_id: z.string().nullable(),
  estimate_status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const summarySchema = z.object({
  id: z.string(),
  job_id: z.string(),
  estimate_id: z.string(),
  number: z.string(),
  status: z.enum(STATUSES),
  total_cents: z.number().int(),
  updated_at: z.string(),
});

const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  intro: z.string(),
  scope_note: z.string(),
  terms: z.string(),
  include_site_map: z.boolean(),
  include_optional: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

const templateBody = z.object({
  name: z.string().trim().min(1).max(200),
  intro: z.string().max(8000).optional(),
  scope_note: z.string().max(8000).optional(),
  terms: z.string().max(8000).optional(),
  include_site_map: z.boolean().optional(),
  include_optional: z.boolean().optional(),
});

function forbidden(): ProblemError {
  return new ProblemError({
    status: 403,
    title: "Forbidden",
    detail: "You do not have permission to do that.",
  });
}

function canRead(permissions: readonly string[]): boolean {
  return (
    hasPermission(permissions, "proposal.read") ||
    hasPermission(permissions, "proposal.send") ||
    hasPermission(permissions, "estimate.read") ||
    hasPermission(permissions, "estimate.*")
  );
}

function canWrite(permissions: readonly string[]): boolean {
  return hasPermission(permissions, "proposal.send") || hasPermission(permissions, "estimate.*");
}

export async function registerProposalRoutes(app: ApiApp, ctx: ProposalContext): Promise<void> {
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
    "/estimates/:id/proposals",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({ template_id: z.uuidv7().optional() }),
        response: { 201: proposalSchema },
      },
    },
    async (request, reply) => {
      const view = await inWorkspace(request, "write", ({ trx, workspaceId, member }) =>
        createProposal(trx, {
          workspaceId,
          memberId: member.id,
          estimateId: request.params.id,
          templateId: request.body.template_id,
        }),
      );
      return reply.status(201).send(view);
    },
  );

  app.get(
    "/estimates/:id/proposals",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        response: { 200: z.object({ proposals: z.array(summarySchema) }) },
      },
    },
    async (request) => {
      const proposals = await inWorkspace(request, "read", ({ trx }) =>
        listEstimateProposals(trx, request.params.id),
      );
      return { proposals };
    },
  );

  app.get(
    "/jobs/:id/proposals",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        response: { 200: z.object({ proposals: z.array(summarySchema) }) },
      },
    },
    async (request) => {
      const proposals = await inWorkspace(request, "read", ({ trx }) =>
        listJobProposals(trx, request.params.id),
      );
      return { proposals };
    },
  );

  app.get(
    "/proposals/:id",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        response: { 200: proposalSchema },
      },
    },
    async (request) =>
      inWorkspace(request, "read", ({ trx }) => getProposal(trx, request.params.id)),
  );

  app.patch(
    "/proposals/:id",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({
          intro: z.string().max(8000).optional(),
          scope_note: z.string().max(8000).optional(),
          terms: z.string().max(8000).optional(),
          include_site_map: z.boolean().optional(),
          include_optional: z.boolean().optional(),
          selected_optional_line_ids: z.array(z.uuidv7()).optional(),
          expires_at: z.string().nullable().optional(),
        }),
        response: { 200: proposalSchema },
      },
    },
    async (request) =>
      inWorkspace(request, "write", ({ trx, workspaceId, member }) =>
        patchProposal(trx, {
          workspaceId,
          memberId: member.id,
          proposalId: request.params.id,
          patch: {
            intro: request.body.intro,
            scopeNote: request.body.scope_note,
            terms: request.body.terms,
            includeSiteMap: request.body.include_site_map,
            includeOptional: request.body.include_optional,
            selectedOptionalLineIds: request.body.selected_optional_line_ids,
            expiresAt: request.body.expires_at,
          },
        }),
      ),
  );

  app.post(
    "/proposals/:id/render",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({}),
        response: { 200: z.object({ pdf_file_id: z.string() }) },
      },
    },
    async (request) => {
      const ready = await inWorkspace(request, "write", async ({ trx, workspaceId, member }) => {
        const view = await getProposal(trx, request.params.id);
        return {
          workspaceId,
          memberId: member.id,
          status: view.status,
          pdfFileId: view.pdf_file_id,
        };
      });
      if (ready.status === "rendered" && ready.pdfFileId) {
        return { pdf_file_id: ready.pdfFileId };
      }
      if (ready.status !== "draft") {
        throw new ProblemError({
          status: 409,
          title: "Conflict",
          detail: "That proposal cannot be rendered.",
        });
      }
      if (!ctx.dispatch) {
        throw new ProblemError({
          status: 500,
          title: "Internal Server Error",
          detail: "The proposal worker is not running.",
        });
      }
      await ctx.dispatch({
        proposalId: request.params.id,
        workspaceId: ready.workspaceId,
        actorMemberId: ready.memberId,
      });
      const pdfFileId = await waitForRenderedPdf(ctx.db, ready.workspaceId, request.params.id);
      return { pdf_file_id: pdfFileId };
    },
  );

  app.get(
    "/proposals/:id/pdf",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
      },
    },
    async (request, reply) => {
      const session = await requireSession(ctx.auth, request.headers);
      const workspaceId = workspaceIdFromHeader(request);
      const member = await requireActiveMember(ctx, session.id, workspaceId);
      const permissions = await withWorkspaceContext(ctx.db, workspaceId, (trx) =>
        permissionsOf(trx, member.role_id),
      );
      if (!canRead(permissions)) {
        throw forbidden();
      }
      const pdf = await readProposalPdf(ctx.db, workspaceId, request.params.id);
      return reply
        .type("application/pdf")
        .header("content-disposition", `inline; filename="${pdf.filename}"`)
        .send(pdf.bytes);
    },
  );

  app.get(
    "/proposal-templates",
    {
      schema: {
        tags: [...TENANT],
        response: { 200: z.object({ templates: z.array(templateSchema) }) },
      },
    },
    async (request) => {
      const templates = await inWorkspace(request, "read", ({ trx }) => listTemplates(trx));
      return { templates };
    },
  );

  app.post(
    "/proposal-templates",
    {
      schema: {
        tags: [...TENANT],
        body: templateBody,
        response: { 201: templateSchema },
      },
    },
    async (request, reply) => {
      const view = await inWorkspace(request, "write", ({ trx, workspaceId, member }) =>
        createTemplate(trx, {
          workspaceId,
          memberId: member.id,
          name: request.body.name,
          intro: request.body.intro,
          scopeNote: request.body.scope_note,
          terms: request.body.terms,
          includeSiteMap: request.body.include_site_map,
          includeOptional: request.body.include_optional,
        }),
      );
      return reply.status(201).send(view);
    },
  );

  app.patch(
    "/proposal-templates/:id",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: templateBody.partial(),
        response: { 200: templateSchema },
      },
    },
    async (request) =>
      inWorkspace(request, "write", ({ trx, workspaceId, member }) =>
        patchTemplate(trx, {
          workspaceId,
          memberId: member.id,
          templateId: request.params.id,
          name: request.body.name,
          intro: request.body.intro,
          scopeNote: request.body.scope_note,
          terms: request.body.terms,
          includeSiteMap: request.body.include_site_map,
          includeOptional: request.body.include_optional,
        }),
      ),
  );

  await registerEsignRoutes(app, ctx, proposalSchema);
}
