import { createHash } from "node:crypto";

import {
  createId,
  isEstimateStatus,
  isJobStage,
  isProposalStatus,
  transitionJob,
  transitionProposal,
  type JobStage,
  type ProposalStatus,
} from "@groundwork/shared";
import { sql, type Kysely, type Transaction } from "kysely";

import type { Mailer } from "../auth/mail.js";
import { recordUsage, setJobStage } from "../crm/data.js";
import type { Database } from "../db/types.js";
import {
  setProposalTokenHash,
  setWorkspaceId,
  withTenantTransaction,
  withWorkspaceContext,
} from "../db/workspace.js";
import { transitionEstimateStatus } from "../estimating/data.js";
import { ProblemError } from "../errors.js";
import { workspaceStorageKey } from "../storage/s3.js";
import { getProposal, loadProposalForRender, type ProposalView } from "./data.js";
import type { EsignEvent, EsignProvider, EsignSigner } from "./esign.js";
import { missingPdf, type ProposalFiles } from "./files.js";
import { rerenderRenderedProposal } from "./render.js";
import { hashPublicToken, issuePublicToken, timingSafeEqualHex } from "./token.js";

type Trx = Transaction<Database>;
type Db = Kysely<Database>;

type Recipient = { name: string; email: string };

let wonFault: (() => void) | undefined;

/** Test hook. A throw inside the won transaction rolls the whole change back. */
export function setWonFlowFault(fn: (() => void) | undefined): void {
  wonFault = fn;
}

function conflict(detail: string): ProblemError {
  return new ProblemError({ status: 409, title: "Conflict", detail });
}

function notFound(detail: string): ProblemError {
  return new ProblemError({ status: 404, title: "Not Found", detail });
}

function gone(detail: string): ProblemError {
  return new ProblemError({ status: 410, title: "Gone", detail });
}

function badRequest(detail: string): ProblemError {
  return new ProblemError({ status: 400, title: "Bad Request", detail });
}

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

export function parseRecipients(value: unknown): Recipient[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const recipients: Recipient[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
    if (name && email) {
      recipients.push({ name, email });
    }
  }
  return recipients;
}

function assertRecipients(signers: readonly EsignSigner[]): Recipient[] {
  if (signers.length < 1 || signers.length > 10) {
    throw badRequest("Send the proposal to between 1 and 10 people.");
  }
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const signer of signers) {
    const name = signer.name.trim();
    const email = signer.email.trim().toLowerCase();
    if (name.length < 1 || name.length > 200) {
      throw badRequest("Each recipient needs a name.");
    }
    if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 320) {
      throw badRequest("Each recipient needs an email address.");
    }
    if (seen.has(email)) {
      throw badRequest("Each recipient email must be different.");
    }
    seen.add(email);
    recipients.push({ name, email });
  }
  return recipients;
}

async function audit(
  trx: Trx,
  input: {
    workspaceId: string;
    actorId: string | null;
    entityType: string;
    entityId: string;
    action: string;
    diff: Record<string, unknown>;
  },
): Promise<void> {
  await trx
    .insertInto("audit_log")
    .values({
      workspace_id: input.workspaceId,
      actor_member_id: input.actorId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      diff: input.diff,
    })
    .execute();
}

type LinkResult<T> = { closed: "gone" } | { closed: "missing" } | { closed: null; value: T };

/**
 * Resolve a public token by its hash, then set the workspace. The raw token
 * is compared only as a SHA-256 digest, in constant time.
 */
export async function withPublicProposal<T>(
  db: Db,
  token: string,
  fn: (trx: Trx, row: SelectableProposal) => Promise<T>,
): Promise<T> {
  if (token.length < 20 || token.length > 200) {
    throw notFound("That proposal link was not found.");
  }
  const computed = hashPublicToken(token);
  const result = await withTenantTransaction(db, async (trx): Promise<LinkResult<T>> => {
    await setProposalTokenHash(trx, computed);
    const link = await trx
      .selectFrom("proposal_token")
      .select(["token_hash", "workspace_id", "proposal_id"])
      .where("token_hash", "=", computed)
      .executeTakeFirst();
    const stored = link?.token_hash ?? "0".repeat(64);
    if (!link || !timingSafeEqualHex(stored, computed)) {
      timingSafeEqualHex(computed, "0".repeat(64));
      return { closed: "missing" };
    }
    await setWorkspaceId(trx, link.workspace_id);
    const row = await trx
      .selectFrom("proposal")
      .selectAll()
      .where("id", "=", link.proposal_id)
      .executeTakeFirst();
    if (!row || !timingSafeEqualHex(row.public_token_hash, computed)) {
      return { closed: "missing" };
    }
    const estimate = await trx
      .selectFrom("estimate")
      .select("status")
      .where("id", "=", row.estimate_id)
      .executeTakeFirst();
    if (row.status === "void" || row.status === "expired" || estimate?.status === "superseded") {
      return { closed: "gone" };
    }
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      if (row.status === "sent" || row.status === "viewed") {
        await trx
          .updateTable("proposal")
          .set({ status: "expired" })
          .where("id", "=", row.id)
          .execute();
      }
      return { closed: "gone" };
    }
    if (row.status === "draft") {
      return { closed: "missing" };
    }
    return { closed: null, value: await fn(trx, row) };
  });
  if (result.closed === "missing") {
    throw notFound("That proposal link was not found.");
  }
  if (result.closed === "gone") {
    throw gone("That proposal link is no longer available.");
  }
  return result.value;
}

type SelectableProposal = {
  id: string;
  workspace_id: string;
  estimate_id: string;
  status: string;
  public_token_hash: string;
  expires_at: Date | null;
  provider: string | null;
  provider_envelope_id: string | null;
  recipients: unknown;
  created_by: string | null;
  number: string;
  pdf_file_id: string | null;
  message: string;
};

export async function issueProposalLink(
  db: Db,
  input: { workspaceId: string; memberId: string; proposalId: string },
): Promise<string> {
  const issued = issuePublicToken();
  await withWorkspaceContext(db, input.workspaceId, async (trx) => {
    const row = await trx
      .selectFrom("proposal")
      .select(["id", "status"])
      .where("id", "=", input.proposalId)
      .executeTakeFirst();
    if (!row) {
      throw notFound("That proposal was not found.");
    }
    if (row.status !== "rendered") {
      throw conflict("Render the proposal before sharing a link.");
    }
    await trx
      .updateTable("proposal")
      .set({ public_token_hash: issued.hash })
      .where("id", "=", row.id)
      .where("status", "=", "rendered")
      .execute();
    await trx.deleteFrom("proposal_token").where("proposal_id", "=", row.id).execute();
    await trx
      .insertInto("proposal_token")
      .values({
        token_hash: issued.hash,
        workspace_id: input.workspaceId,
        proposal_id: row.id,
      })
      .execute();
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "proposal",
      entityId: row.id,
      action: "link",
      diff: { issued: true },
    });
  });
  return issued.token;
}

export async function savePublicOptions(
  db: Db,
  input: {
    token: string;
    lineIds: readonly string[];
    files: ProposalFiles;
    renderPdf: (html: string) => Promise<Buffer>;
  },
): Promise<ProposalView> {
  const saved = await withPublicProposal(db, input.token, async (trx, row) => {
    if (row.status !== "rendered") {
      throw conflict("Optional items are closed once the proposal is sent.");
    }
    await setSelectedLines(trx, row.id, input.lineIds);
    return {
      workspaceId: row.workspace_id,
      proposalId: row.id,
      actorMemberId: row.created_by,
    };
  });
  await rerenderRenderedProposal(
    db,
    {
      workspaceId: saved.workspaceId,
      proposalId: saved.proposalId,
      actorMemberId: saved.actorMemberId,
    },
    { files: input.files, renderPdf: input.renderPdf },
  );
  return withWorkspaceContext(db, saved.workspaceId, (trx) => getProposal(trx, saved.proposalId));
}

async function setSelectedLines(
  trx: Trx,
  proposalId: string,
  lineIds: readonly string[],
): Promise<void> {
  const loaded = await loadProposalForRender(trx, proposalId);
  if (!loaded || loaded.row.status !== "rendered") {
    throw conflict("Optional items are closed once the proposal is sent.");
  }
  const optional = new Set(
    loaded.snapshot.lines.filter((line) => line.optional).map((line) => line.id),
  );
  const selected: string[] = [];
  for (const id of lineIds) {
    if (!optional.has(id)) {
      throw badRequest("That optional item is not on this proposal.");
    }
    if (!selected.includes(id)) {
      selected.push(id);
    }
  }
  const ids =
    selected.length === 0
      ? sql`'{}'::uuid[]`
      : sql`array[${sql.join(selected.map((id) => sql`${id}::uuid`))}]::uuid[]`;
  await trx
    .updateTable("proposal")
    .set({ selected_optional_line_ids: ids })
    .where("id", "=", proposalId)
    .where("status", "=", "rendered")
    .execute();
}

export async function sendProposal(
  db: Db,
  input: {
    workspaceId: string;
    memberId: string;
    proposalId: string;
    signers: readonly EsignSigner[];
    message: string;
    expiresAt: Date | null;
    provider: EsignProvider;
    files: ProposalFiles;
  },
): Promise<ProposalView> {
  const recipients = assertRecipients(input.signers);
  const message = input.message.trim();
  if (message.length > 4000) {
    throw badRequest("The message must be 4000 characters or fewer.");
  }
  const prep = await withWorkspaceContext(db, input.workspaceId, async (trx) => {
    const loaded = await loadProposalForRender(trx, input.proposalId);
    if (!loaded) {
      throw notFound("That proposal was not found.");
    }
    if (loaded.row.status !== "rendered" || !loaded.row.pdf_file_id) {
      throw conflict("Render the proposal before sending it.");
    }
    const file = await trx
      .selectFrom("file")
      .select("storage_key")
      .where("id", "=", loaded.row.pdf_file_id)
      .executeTakeFirst();
    if (!file) {
      throw missingPdf();
    }
    const estimate = await trx
      .selectFrom("estimate")
      .select(["status", "job_id"])
      .where("id", "=", loaded.row.estimate_id)
      .executeTakeFirst();
    const job = estimate
      ? await trx
          .selectFrom("job")
          .select(["id", "stage"])
          .where("id", "=", estimate.job_id)
          .executeTakeFirst()
      : undefined;
    if (!estimate || !isEstimateStatus(estimate.status) || !job || !isJobStage(job.stage)) {
      throw conflict("That proposal is not attached to a job.");
    }
    return {
      storageKey: file.storage_key,
      number: loaded.view.number,
      estimateId: loaded.row.estimate_id,
      estimateStatus: estimate.status,
      jobId: job.id,
      stage: job.stage,
    };
  });
  const pdf = await input.files.get(prep.storageKey);
  const envelope = await input.provider.send({
    proposalId: input.proposalId,
    workspaceId: input.workspaceId,
    title: `Proposal ${prep.number}`,
    message,
    pdf,
    signers: recipients,
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
  });
  try {
    await withWorkspaceContext(db, input.workspaceId, async (trx) => {
      const updated = await trx
        .updateTable("proposal")
        .set({
          status: "sent",
          provider: input.provider.name,
          provider_envelope_id: envelope.envelopeId,
          recipients: jsonb(recipients),
          message,
          expires_at: input.expiresAt,
        })
        .where("id", "=", input.proposalId)
        .where("status", "=", "rendered")
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) {
        throw conflict("That proposal cannot be sent.");
      }
      if (prep.estimateStatus === "ready") {
        await transitionEstimateStatus(trx, {
          workspaceId: input.workspaceId,
          memberId: input.memberId,
          estimateId: prep.estimateId,
          to: "sent",
        });
      }
      await moveJob(trx, {
        workspaceId: input.workspaceId,
        memberId: input.memberId,
        jobId: prep.jobId,
        from: prep.stage,
        to: "proposed",
        hasSignedProposal: false,
      });
      await audit(trx, {
        workspaceId: input.workspaceId,
        actorId: input.memberId,
        entityType: "proposal",
        entityId: input.proposalId,
        action: "send",
        diff: { provider: input.provider.name, recipients: recipients.length },
      });
      await recordUsage(trx, input.workspaceId, "esign_send");
    });
  } catch (error) {
    await input.provider.voidEnvelope(envelope.envelopeId).catch(() => undefined);
    throw error;
  }
  await applyPending(db, input.provider, input.files, envelope.envelopeId);
  return withWorkspaceContext(db, input.workspaceId, (trx) => getProposal(trx, input.proposalId));
}

export async function voidProposal(
  db: Db,
  input: {
    workspaceId: string;
    memberId: string;
    proposalId: string;
    provider: EsignProvider;
  },
): Promise<ProposalView> {
  const row = await withWorkspaceContext(db, input.workspaceId, async (trx) => {
    const loaded = await trx
      .selectFrom("proposal")
      .select(["id", "status", "provider", "provider_envelope_id"])
      .where("id", "=", input.proposalId)
      .executeTakeFirst();
    if (!loaded) {
      throw notFound("That proposal was not found.");
    }
    return loaded;
  });
  if (row.status === "void") {
    return withWorkspaceContext(db, input.workspaceId, (trx) => getProposal(trx, row.id));
  }
  if (!isProposalStatus(row.status)) {
    throw conflict("That proposal cannot be voided.");
  }
  try {
    transitionProposal(row.status, "void");
  } catch {
    throw conflict("A signed proposal cannot be voided.");
  }
  if (row.provider_envelope_id && row.provider === input.provider.name) {
    await input.provider.voidEnvelope(row.provider_envelope_id);
  }
  await withWorkspaceContext(db, input.workspaceId, async (trx) => {
    await trx
      .updateTable("proposal")
      .set({ status: "void" })
      .where("id", "=", row.id)
      .where("status", "=", row.status)
      .execute();
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "proposal",
      entityId: row.id,
      action: "void",
      diff: { from: row.status, to: "void" },
    });
  });
  return withWorkspaceContext(db, input.workspaceId, (trx) => getProposal(trx, row.id));
}

export async function ingestEsignEvent(
  db: Db,
  provider: EsignProvider,
  files: ProposalFiles,
  event: EsignEvent,
  mailer?: Mailer,
): Promise<"applied" | "pending" | "duplicate"> {
  const state = await rememberEvent(db, provider.name, event);
  if (state === "processed") {
    return "duplicate";
  }
  const applied = await applyEvent(db, provider, files, event, mailer);
  return applied ? "applied" : "pending";
}

export async function applyPending(
  db: Db,
  provider: EsignProvider,
  files: ProposalFiles,
  envelopeId: string,
  mailer?: Mailer,
): Promise<void> {
  const rows = await withTenantTransaction(db, async (trx) => {
    const result = await sql<{ payload: unknown }>`
      select payload from event_log
      where provider = ${provider.name}
        and processed_at is null
        and payload->>'envelope_id' = ${envelopeId}
    `.execute(trx);
    return result.rows;
  });
  for (const row of rows) {
    const event = eventFromPayload(row.payload);
    if (event) {
      await applyEvent(db, provider, files, event, mailer);
    }
  }
}

async function rememberEvent(
  db: Db,
  provider: string,
  event: EsignEvent,
): Promise<"new" | "processed"> {
  return withTenantTransaction(db, async (trx) => {
    await trx
      .insertInto("event_log")
      .values({
        id: createId(),
        provider,
        event_id: event.eventId,
        payload: jsonb({
          event_id: event.eventId,
          type: event.type,
          envelope_id: event.envelopeId,
          workspace_id: event.workspaceId,
          proposal_id: event.proposalId,
          signer: event.signer,
          signers: event.signers,
        }),
        processed_at: null,
      })
      .onConflict((conflict) => conflict.columns(["provider", "event_id"]).doNothing())
      .execute();
    const row = await trx
      .selectFrom("event_log")
      .select("processed_at")
      .where("provider", "=", provider)
      .where("event_id", "=", event.eventId)
      .executeTakeFirst();
    return row?.processed_at ? "processed" : "new";
  });
}

function eventFromPayload(value: unknown): EsignEvent | undefined {
  const body = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  if (!body) {
    return undefined;
  }
  const type = typeof body.type === "string" ? body.type : "";
  const eventId = typeof body.event_id === "string" ? body.event_id : "";
  const envelopeId = typeof body.envelope_id === "string" ? body.envelope_id : "";
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const proposalId = typeof body.proposal_id === "string" ? body.proposal_id : "";
  if (!eventId || !envelopeId || !workspaceId || !proposalId || !isProposalEvent(type)) {
    return undefined;
  }
  const signer = recipientOf(body.signer);
  const signers = Array.isArray(body.signers)
    ? body.signers.flatMap((item) => {
        const row =
          item && typeof item === "object" ? (item as Record<string, unknown>) : undefined;
        const person = recipientOf(row);
        if (!row || !person) {
          return [];
        }
        return [{ ...person, signed: row.signed === true }];
      })
    : [];
  return { eventId, type, envelopeId, workspaceId, proposalId, signer, signers };
}

function isProposalEvent(value: string): value is EsignEvent["type"] {
  return (
    value === "sent" ||
    value === "viewed" ||
    value === "signed" ||
    value === "all_signed" ||
    value === "declined" ||
    value === "voided" ||
    value === "bounced" ||
    value === "expired" ||
    value === "ignored"
  );
}

function recipientOf(value: unknown): Recipient | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
  if (!name || !email) {
    return null;
  }
  return { name, email };
}

async function applyEvent(
  db: Db,
  provider: EsignProvider,
  files: ProposalFiles,
  event: EsignEvent,
  mailer?: Mailer,
): Promise<boolean> {
  const found = await withWorkspaceContext(db, event.workspaceId, async (trx) =>
    trx
      .selectFrom("proposal")
      .select(["id", "pdf_file_id"])
      .where("provider", "=", provider.name)
      .where("provider_envelope_id", "=", event.envelopeId)
      .where("id", "=", event.proposalId)
      .executeTakeFirst(),
  );
  if (!found) {
    return false;
  }
  let signedBytes: Buffer | undefined;
  if (event.type === "signed" || event.type === "all_signed") {
    signedBytes = await signedDocument(
      db,
      event.workspaceId,
      found.pdf_file_id,
      provider,
      files,
      event,
    );
  }
  const notices = await withWorkspaceContext(db, event.workspaceId, async (trx) => {
    const row = await trx
      .selectFrom("proposal")
      .selectAll()
      .where("id", "=", event.proposalId)
      .executeTakeFirst();
    if (!row || row.provider_envelope_id !== event.envelopeId) {
      return [];
    }
    const emails = await applyToProposal(trx, provider.name, row, event, signedBytes, files);
    await trx
      .updateTable("event_log")
      .set({ processed_at: new Date() })
      .where("provider", "=", provider.name)
      .where("event_id", "=", event.eventId)
      .execute();
    return emails;
  });
  await notifyOwners(mailer, notices);
  return true;
}

async function signedDocument(
  db: Db,
  workspaceId: string,
  pdfFileId: string | null,
  provider: EsignProvider,
  files: ProposalFiles,
  event: EsignEvent,
): Promise<Buffer> {
  if (!pdfFileId) {
    throw missingPdf();
  }
  const stored = await withWorkspaceContext(db, workspaceId, async (trx) => {
    const file = await trx
      .selectFrom("file")
      .select("storage_key")
      .where("id", "=", pdfFileId)
      .executeTakeFirst();
    return file?.storage_key;
  });
  if (!stored) {
    throw missingPdf();
  }
  const original = await files.get(stored);
  if (provider.name === "dropbox_sign") {
    return provider.signedPdf(event.envelopeId);
  }
  return original;
}

async function applyToProposal(
  trx: Trx,
  providerName: string,
  row: ProposalRowSelectable,
  event: EsignEvent,
  signedBytes: Buffer | undefined,
  files: ProposalFiles,
): Promise<string[]> {
  if (!isProposalStatus(row.status)) {
    return [];
  }
  if (row.status === "signed") {
    return [];
  }
  if (event.type === "ignored" || event.type === "sent") {
    return [];
  }
  if (event.type === "viewed") {
    await moveProposal(trx, row, "viewed");
    return [];
  }
  if (event.type === "declined") {
    await moveProposal(trx, row, "declined");
    await recordSigner(trx, row, event, false);
    return [];
  }
  if (event.type === "voided") {
    await moveProposal(trx, row, "void");
    return [];
  }
  if (event.type === "expired") {
    await moveProposal(trx, row, "expired");
    return [];
  }
  if (event.type === "bounced") {
    return markBounced(trx, row);
  }
  if (event.type === "signed" || event.type === "all_signed") {
    await recordSigners(trx, row, event);
    const recipients = parseRecipients(row.recipients);
    const signatures = await trx
      .selectFrom("signature")
      .select(["signer_email", "signed_at"])
      .where("proposal_id", "=", row.id)
      .execute();
    if (!allSigned(recipients, signatures)) {
      await moveProposal(trx, row, "viewed");
      return [];
    }
    if (!signedBytes) {
      throw missingPdf();
    }
    await completeWon(trx, providerName, row, event, signedBytes, files);
  }
  return [];
}

function allSigned(
  recipients: readonly Recipient[],
  signatures: readonly { signer_email: string | null; signed_at: Date | null }[],
): boolean {
  if (recipients.length === 0) {
    return false;
  }
  const signed = new Set(
    signatures
      .filter((row) => row.signed_at && row.signer_email)
      .map((row) => row.signer_email?.toLowerCase()),
  );
  return recipients.every((recipient) => signed.has(recipient.email));
}

async function recordSigners(
  trx: Trx,
  row: ProposalRowSelectable,
  event: EsignEvent,
): Promise<void> {
  if (event.type === "all_signed") {
    const people =
      event.signers.filter((signer) => signer.signed).length > 0
        ? event.signers.filter((signer) => signer.signed)
        : parseRecipients(row.recipients);
    for (const signer of people) {
      await recordSigner(trx, row, { ...event, signer }, true);
    }
    return;
  }
  await recordSigner(trx, row, event, true);
}

async function recordSigner(
  trx: Trx,
  row: ProposalRowSelectable,
  event: EsignEvent,
  signed: boolean,
): Promise<void> {
  if (!event.signer) {
    return;
  }
  const existing = await trx
    .selectFrom("signature")
    .select(["id", "signed_at"])
    .where("proposal_id", "=", row.id)
    .where("signer_email", "=", event.signer.email)
    .executeTakeFirst();
  if (!existing) {
    await trx
      .insertInto("signature")
      .values({
        id: createId(),
        workspace_id: row.workspace_id,
        proposal_id: row.id,
        signer_name: event.signer.name,
        signer_email: event.signer.email,
        signed_at: signed ? new Date() : null,
        ip: null,
        provider_event_id: event.eventId,
      })
      .execute();
    return;
  }
  if (signed && !existing.signed_at) {
    await trx
      .updateTable("signature")
      .set({
        signed_at: new Date(),
        signer_name: event.signer.name,
        provider_event_id: event.eventId,
      })
      .where("id", "=", existing.id)
      .execute();
  }
}

async function moveProposal(
  trx: Trx,
  row: ProposalRowSelectable,
  to: ProposalStatus,
): Promise<void> {
  if (row.status === to || !isProposalStatus(row.status)) {
    return;
  }
  try {
    transitionProposal(row.status, to);
  } catch {
    return;
  }
  const updated = await trx
    .updateTable("proposal")
    .set({ status: to })
    .where("id", "=", row.id)
    .where("status", "=", row.status)
    .executeTakeFirst();
  if (updated.numUpdatedRows === 1n) {
    row.status = to;
    await audit(trx, {
      workspaceId: row.workspace_id,
      actorId: row.created_by,
      entityType: "proposal",
      entityId: row.id,
      action: to,
      diff: { to },
    });
  }
}

async function markBounced(trx: Trx, row: ProposalRowSelectable): Promise<string[]> {
  if (row.status !== "sent" && row.status !== "viewed") {
    return [];
  }
  await trx.updateTable("proposal").set({ bounced: true }).where("id", "=", row.id).execute();
  await audit(trx, {
    workspaceId: row.workspace_id,
    actorId: row.created_by,
    entityType: "proposal",
    entityId: row.id,
    action: "bounce",
    diff: { bounced: true },
  });
  const owners = await trx
    .selectFrom("member")
    .innerJoin("app_user", "app_user.id", "member.user_id")
    .innerJoin("role", "role.id", "member.role_id")
    .select("app_user.email")
    .where("member.status", "=", "active")
    .where("role.name", "=", "owner")
    .execute();
  return owners.map((owner) => owner.email).filter((email): email is string => Boolean(email));
}

async function notifyOwners(mailer: Mailer | undefined, emails: string[]): Promise<void> {
  if (!mailer || emails.length === 0) {
    return;
  }
  for (const email of emails) {
    await mailer
      .send({
        to: email,
        subject: "A proposal email bounced",
        text: "A signer email bounced. The proposal is still waiting for signature.",
      })
      .catch(() => undefined);
  }
}

async function completeWon(
  trx: Trx,
  providerName: string,
  row: ProposalRowSelectable,
  event: EsignEvent,
  pdf: Buffer,
  files: ProposalFiles,
): Promise<void> {
  if (row.status !== "viewed") {
    await moveProposal(trx, row, "viewed");
  }
  if (row.status !== "viewed") {
    throw conflict("That proposal cannot be signed.");
  }
  const loaded = await loadProposalForRender(trx, row.id);
  if (!loaded) {
    throw notFound("That proposal was not found.");
  }
  const actor = row.created_by;
  if (!actor) {
    throw conflict("That proposal has no owner.");
  }
  const fileId = createId();
  const storageKey = workspaceStorageKey(row.workspace_id, fileId);
  await trx
    .insertInto("file")
    .values({
      id: fileId,
      workspace_id: row.workspace_id,
      storage_key: storageKey,
      mime: "application/pdf",
      bytes: String(pdf.length),
      sha256: createHash("sha256").update(pdf).digest("hex"),
      status: "ready",
      created_by: actor,
    })
    .execute();
  const signed = await trx
    .updateTable("proposal")
    .set({ status: "signed", signed_pdf_file_id: fileId })
    .where("id", "=", row.id)
    .where("status", "=", "viewed")
    .executeTakeFirst();
  if (signed.numUpdatedRows !== 1n) {
    throw conflict("That proposal cannot be signed.");
  }
  row.status = "signed";
  const estimate = await trx
    .selectFrom("estimate")
    .select(["id", "status", "job_id"])
    .where("id", "=", row.estimate_id)
    .executeTakeFirst();
  if (!estimate || !isEstimateStatus(estimate.status)) {
    throw conflict("That estimate cannot be accepted.");
  }
  if (estimate.status === "ready") {
    await transitionEstimateStatus(trx, {
      workspaceId: row.workspace_id,
      memberId: actor,
      estimateId: estimate.id,
      to: "sent",
    });
    await transitionEstimateStatus(trx, {
      workspaceId: row.workspace_id,
      memberId: actor,
      estimateId: estimate.id,
      to: "accepted",
    });
  } else if (estimate.status === "sent") {
    await transitionEstimateStatus(trx, {
      workspaceId: row.workspace_id,
      memberId: actor,
      estimateId: estimate.id,
      to: "accepted",
    });
  } else if (estimate.status !== "accepted") {
    throw conflict("That estimate cannot be accepted.");
  }
  const job = await trx
    .selectFrom("job")
    .select(["id", "stage", "name"])
    .where("id", "=", estimate.job_id)
    .executeTakeFirst();
  if (!job || !isJobStage(job.stage)) {
    throw conflict("That job cannot be won.");
  }
  await moveJob(trx, {
    workspaceId: row.workspace_id,
    memberId: actor,
    jobId: job.id,
    from: job.stage,
    to: "won",
    hasSignedProposal: true,
  });
  const lines = loaded.view.lines
    .filter((line) => !line.optional || line.selected)
    .map((line) => ({
      id: line.id,
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      price_cents: line.price_cents,
      optional: line.optional,
    }));
  const workOrderId = createId();
  await trx
    .insertInto("work_order")
    .values({
      id: workOrderId,
      workspace_id: row.workspace_id,
      job_id: job.id,
      estimate_id: estimate.id,
      proposal_id: row.id,
      title: `Proposal ${row.number}`.slice(0, 200),
      scope: jsonb({ proposal_id: row.id, lines }),
      status: "ready",
      created_by: actor,
    })
    .execute();
  await recordUsage(trx, row.workspace_id, "esign_send");
  await audit(trx, {
    workspaceId: row.workspace_id,
    actorId: actor,
    entityType: "proposal",
    entityId: row.id,
    action: "signed",
    diff: { provider: providerName, event_id: event.eventId, signed_pdf_file_id: fileId },
  });
  await audit(trx, {
    workspaceId: row.workspace_id,
    actorId: actor,
    entityType: "work_order",
    entityId: workOrderId,
    action: "create",
    diff: { status: "ready", proposal_id: row.id },
  });
  await files.put({ storageKey, body: pdf, mime: "application/pdf" });
  wonFault?.();
}

async function moveJob(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    jobId: string;
    from: JobStage;
    to: "proposed" | "won";
    hasSignedProposal: boolean;
  },
): Promise<void> {
  let stage = input.from;
  const steps: JobStage[] = input.to === "won" ? stepsToWon(stage) : stepsToProposed(stage);
  for (const to of steps) {
    const next = transitionJob({
      from: stage,
      to,
      hasSignedProposal: input.hasSignedProposal,
      canForceWon: false,
    });
    await setJobStage(trx, {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      memberId: input.memberId,
      from: stage,
      to: next,
      reason: null,
      forced: false,
    });
    stage = next;
  }
  if (input.to === "won" && stage !== "won") {
    throw conflict("That job cannot be won.");
  }
}

function stepsToProposed(stage: JobStage): JobStage[] {
  if (stage === "lead") {
    return ["estimating", "proposed"];
  }
  if (stage === "estimating") {
    return ["proposed"];
  }
  if (stage === "proposed" || stage === "won") {
    return [];
  }
  throw conflict("The job cannot be proposed from its current stage.");
}

function stepsToWon(stage: JobStage): JobStage[] {
  if (stage === "won") {
    return [];
  }
  return [...stepsToProposed(stage), "won"];
}

type ProposalRowSelectable = {
  id: string;
  workspace_id: string;
  estimate_id: string;
  number: string;
  status: string;
  recipients: unknown;
  created_by: string | null;
  provider_envelope_id: string | null;
  pdf_file_id: string | null;
};
