import { Readable } from "node:stream";

import type { FastifyBaseLogger, FastifyInstance, FastifyRequest, RawServerDefault } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Kysely } from "kysely";
import type { IncomingMessage, ServerResponse } from "node:http";
import type pg from "pg";
import { z } from "zod/v4";

import type { Auth } from "../auth/auth.js";
import { requireActiveMember, requireSession } from "../auth/guard.js";
import type { Mailer } from "../auth/mail.js";
import { workspaceIdFromHeader } from "../auth/hook.js";
import type { Database } from "../db/types.js";
import { withWorkspaceContext } from "../db/workspace.js";
import { ProblemError } from "../errors.js";
import { hasPermission } from "@groundwork/shared";
import { getProposal, type ProposalView } from "./data.js";
import {
  issueProposalLink,
  ingestEsignEvent,
  parseRecipients,
  savePublicOptions,
  sendProposal,
  unavailablePublicLink,
  voidProposal,
  withPublicProposal,
} from "./esign-flow.js";
import {
  DROPBOX_PROVIDER,
  FAKE_PROVIDER,
  createEsignProvider,
  jsonFieldFromMultipart,
  type EsignProvider,
} from "./esign.js";
import { s3ProposalFiles, type ProposalFiles } from "./files.js";
import { takePublicCall } from "./rate-limit.js";
import { renderProposalPdf } from "./pdf.js";

const TENANT = ["tenant-header"] as const;
const PUBLIC = ["public"] as const;
const WEBHOOK = ["webhook"] as const;

type ApiApp = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;

const rawBodies = new WeakMap<FastifyRequest, Buffer>();

export type EsignRouteContext = {
  db: Kysely<Database>;
  auth: Auth;
  authPool: pg.Pool;
  esign?: EsignProvider | undefined;
  files?: ProposalFiles | undefined;
  renderPdf?: ((html: string) => Promise<Buffer>) | undefined;
  mailer?: Mailer | undefined;
};

const publicLine = z.object({
  id: z.string(),
  description: z.string(),
  qty: z.string(),
  unit: z.string(),
  price_cents: z.number().int(),
  optional: z.boolean(),
  selected: z.boolean(),
});

const publicToken = z.object({ token: z.string() });

const publicSchema = z.object({
  number: z.string(),
  status: z.string(),
  workspace_name: z.string(),
  intro: z.string(),
  terms: z.string(),
  include_optional: z.boolean(),
  expires_at: z.string().nullable(),
  total_cents: z.number().int(),
  lines: z.array(publicLine),
  recipients: z.array(z.object({ name: z.string(), email: z.string(), signed: z.boolean() })),
  mock_sign: z.boolean(),
  bounced: z.boolean(),
});

function tooMany(): ProblemError {
  return new ProblemError({
    status: 429,
    title: "Too Many Requests",
    detail: "Too many requests. Try again shortly.",
  });
}

function forbidden(): ProblemError {
  return new ProblemError({
    status: 403,
    title: "Forbidden",
    detail: "You do not have permission to do that.",
  });
}

function limit(request: FastifyRequest, kind: string): void {
  if (!takePublicCall(`${kind}:${request.ip || "unknown"}`)) {
    throw tooMany();
  }
}

function publicBody(
  view: ProposalView,
  workspaceName: string,
  mockSign: boolean,
): z.infer<typeof publicSchema> {
  const signed = new Set(
    view.signatures
      .filter((signature) => signature.signed_at)
      .map((signature) => signature.signer_email?.toLowerCase()),
  );
  return {
    number: view.number,
    status: view.status,
    workspace_name: workspaceName,
    intro: view.intro,
    terms: view.terms,
    include_optional: view.include_optional,
    expires_at: view.expires_at,
    total_cents: view.total_cents,
    lines: view.lines.map((line) => ({
      id: line.id,
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      price_cents: line.price_cents,
      optional: line.optional,
      selected: line.selected,
    })),
    recipients: view.recipients.map((recipient) => ({
      ...recipient,
      signed: signed.has(recipient.email.toLowerCase()),
    })),
    mock_sign: mockSign,
    bounced: view.bounced,
  };
}

export async function registerEsignRoutes(
  app: ApiApp,
  ctx: EsignRouteContext,
  proposalSchema: z.ZodType,
): Promise<void> {
  const esign = ctx.esign ?? createEsignProvider();
  const files = ctx.files ?? s3ProposalFiles();
  const renderPdf = ctx.renderPdf ?? renderProposalPdf;

  app.addHook("preParsing", async (request, _reply, payload) => {
    if (!request.url.split("?")[0]?.startsWith("/webhooks/esign/")) {
      return payload;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks);
    rawBodies.set(request, raw);
    return Readable.from(raw);
  });

  app.addContentTypeParser(
    /^multipart\/form-data(?:;.*)?$/i,
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body);
    },
  );

  async function writer(request: FastifyRequest): Promise<{
    workspaceId: string;
    memberId: string;
  }> {
    const session = await requireSession(ctx.auth, request.headers);
    const workspaceId = workspaceIdFromHeader(request);
    const member = await requireActiveMember(ctx, session.id, workspaceId);
    return withWorkspaceContext(ctx.db, workspaceId, async (trx) => {
      const role = await trx
        .selectFrom("role")
        .select("permissions")
        .where("id", "=", member.role_id)
        .executeTakeFirst();
      const permissions = role?.permissions ?? [];
      if (
        !hasPermission(permissions, "proposal.send") &&
        !hasPermission(permissions, "estimate.*")
      ) {
        throw forbidden();
      }
      return { workspaceId, memberId: member.id };
    });
  }

  app.post(
    "/proposals/:id/link",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({}),
        response: { 200: z.object({ token: z.string() }) },
      },
    },
    async (request) => {
      const actor = await writer(request);
      const token = await issueProposalLink(ctx.db, {
        workspaceId: actor.workspaceId,
        memberId: actor.memberId,
        proposalId: request.params.id,
      });
      return { token };
    },
  );

  app.post(
    "/proposals/:id/send",
    {
      schema: {
        tags: [...TENANT, "state-machine"],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({
          recipients: z
            .array(
              z.object({
                name: z.string().trim().min(1).max(200),
                email: z.email().max(320),
              }),
            )
            .min(1)
            .max(10),
          message: z.string().max(4000).optional(),
          expires_at: z.iso.datetime().nullable().optional(),
        }),
        response: { 200: proposalSchema },
      },
    },
    async (request) => {
      const actor = await writer(request);
      return sendProposal(ctx.db, {
        workspaceId: actor.workspaceId,
        memberId: actor.memberId,
        proposalId: request.params.id,
        signers: request.body.recipients,
        message: request.body.message ?? "",
        expiresAt: request.body.expires_at ? new Date(request.body.expires_at) : null,
        provider: esign,
        files,
      });
    },
  );

  app.post(
    "/proposals/:id/void",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.uuidv7() }),
        body: z.object({}),
        response: { 200: proposalSchema },
      },
    },
    async (request) => {
      const actor = await writer(request);
      return voidProposal(ctx.db, {
        workspaceId: actor.workspaceId,
        memberId: actor.memberId,
        proposalId: request.params.id,
        provider: esign,
      });
    },
  );

  app.get(
    "/public/proposals/:token",
    {
      schema: {
        tags: [...PUBLIC],
        params: publicToken,
        response: { 200: publicSchema },
      },
    },
    async (request) => {
      limit(request, "public");
      return withPublicProposal(
        ctx.db,
        request.params.token,
        async (trx, row) => {
          const view = await getProposal(trx, row.id);
          const workspace = await trx
            .selectFrom("workspace")
            .select("name")
            .where("id", "=", row.workspace_id)
            .executeTakeFirst();
          return publicBody(
            view,
            workspace?.name ?? "Workspace",
            esign.name === FAKE_PROVIDER && (view.status === "sent" || view.status === "viewed"),
          );
        },
        request.log,
      );
    },
  );

  app.post(
    "/public/proposals/:token",
    {
      schema: {
        tags: [...PUBLIC],
        params: publicToken,
        body: z.object({ selected_optional_line_ids: z.array(z.uuidv7()).max(200) }),
        response: { 200: publicSchema },
      },
    },
    async (request) => {
      limit(request, "public");
      await savePublicOptions(ctx.db, {
        token: request.params.token,
        lineIds: request.body.selected_optional_line_ids,
        files,
        renderPdf,
        log: request.log,
      });
      return withPublicProposal(
        ctx.db,
        request.params.token,
        async (trx, row) => {
          const current = await getProposal(trx, row.id);
          const workspace = await trx
            .selectFrom("workspace")
            .select("name")
            .where("id", "=", row.workspace_id)
            .executeTakeFirst();
          return publicBody(current, workspace?.name ?? "Workspace", false);
        },
        request.log,
      );
    },
  );

  app.post(
    "/public/proposals/:token/sign",
    {
      schema: {
        tags: [...PUBLIC],
        params: publicToken,
        body: z.object({ email: z.email().max(320).optional() }),
        response: { 200: publicSchema },
      },
    },
    async (request) => {
      limit(request, "public");
      if (esign.name !== FAKE_PROVIDER) {
        await withPublicProposal(ctx.db, request.params.token, async () => undefined, request.log);
        throw unavailablePublicLink();
      }
      const event = await withPublicProposal(
        ctx.db,
        request.params.token,
        async (_trx, row) => {
          if (row.status !== "sent" && row.status !== "viewed") {
            throw new ProblemError({
              status: 409,
              title: "Conflict",
              detail: "Send the proposal before recording a test signature.",
            });
          }
          const recipients = parseRecipients(row.recipients);
          const email = request.body.email?.trim().toLowerCase();
          const signer = email
            ? recipients.find((recipient) => recipient.email === email)
            : recipients[0];
          if (!signer || !row.provider_envelope_id) {
            throw new ProblemError({
              status: 409,
              title: "Conflict",
              detail: "That recipient is not on this proposal.",
            });
          }
          return {
            eventId: `fake-sign:${row.provider_envelope_id}:${signer.email}`,
            type: "signed" as const,
            envelopeId: row.provider_envelope_id,
            workspaceId: row.workspace_id,
            proposalId: row.id,
            signer,
            signers: recipients.map((recipient) => ({
              ...recipient,
              signed: recipient.email === signer.email,
            })),
          };
        },
        request.log,
      );
      await ingestEsignEvent(ctx.db, esign, files, event, ctx.mailer);
      return withPublicProposal(
        ctx.db,
        request.params.token,
        async (trx, row) => {
          const current = await getProposal(trx, row.id);
          const workspace = await trx
            .selectFrom("workspace")
            .select("name")
            .where("id", "=", row.workspace_id)
            .executeTakeFirst();
          return publicBody(
            current,
            workspace?.name ?? "Workspace",
            esign.name === FAKE_PROVIDER &&
              (current.status === "sent" || current.status === "viewed"),
          );
        },
        request.log,
      );
    },
  );

  app.post(
    "/webhooks/esign/:provider",
    {
      schema: {
        tags: [...WEBHOOK],
        params: z.object({ provider: z.enum([FAKE_PROVIDER, DROPBOX_PROVIDER]) }),
      },
    },
    async (request, reply) => {
      limit(request, "webhook");
      if (request.params.provider !== esign.name) {
        throw new ProblemError({
          status: 404,
          title: "Not Found",
          detail: "That signature provider is not active.",
        });
      }
      const raw = rawBodies.get(request) ?? Buffer.alloc(0);
      const contentType = request.headers["content-type"] ?? "";
      let parsed: unknown = request.body;
      if (Buffer.isBuffer(request.body)) {
        parsed = jsonFieldFromMultipart(request.body, String(contentType));
      }
      const verdict = esign.verifyWebhook({
        rawBody: raw,
        headers: request.headers,
        parsed,
      });
      if (!verdict.valid) {
        request.log.warn({ provider: request.params.provider }, "rejected esign webhook");
        throw new ProblemError({
          status: 401,
          title: "Unauthorized",
          detail: "The webhook signature is invalid.",
        });
      }
      if (!verdict.event) {
        throw new ProblemError({
          status: 400,
          title: "Bad Request",
          detail: "The webhook payload is not usable.",
        });
      }
      await ingestEsignEvent(ctx.db, esign, files, verdict.event, ctx.mailer);
      if (request.params.provider === DROPBOX_PROVIDER) {
        return reply.type("text/plain").send("Hello API Event Received");
      }
      return reply.send({ received: true });
    },
  );
}
