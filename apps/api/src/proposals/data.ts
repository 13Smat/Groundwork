import {
  createId,
  formatHumanNumber,
  isProposalStatus,
  transitionProposal,
  type ProposalStatus,
} from "@groundwork/shared";
import { sql, type Selectable, type Transaction } from "kysely";

import type { Database } from "../db/types.js";
import { ProblemError } from "../errors.js";
import { getEstimate, type EstimateView, type LineView } from "../estimating/data.js";
import { newPublicTokenHash } from "./token.js";

type Trx = Transaction<Database>;

type ProposalRow = Selectable<Database["proposal"]>;
type TemplateRow = Selectable<Database["proposal_template"]>;

export type ProposalLineView = {
  id: string;
  group: string | null;
  description: string;
  qty: string;
  unit: string;
  unit_price_cents: number;
  price_cents: number;
  tax_cents: number;
  optional: boolean;
  selected: boolean;
};

export type ProposalView = {
  id: string;
  job_id: string;
  estimate_id: string;
  template_id: string | null;
  number: string;
  status: ProposalStatus;
  intro: string;
  scope_note: string;
  terms: string;
  include_site_map: boolean;
  include_optional: boolean;
  selected_optional_line_ids: string[];
  estimate_number: string;
  estimate_version: number;
  expires_at: string | null;
  pdf_file_id: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  lines: ProposalLineView[];
  bounced: boolean;
  recipients: { name: string; email: string }[];
  signatures: {
    signer_name: string | null;
    signer_email: string | null;
    signed_at: string | null;
  }[];
  work_order_id: string | null;
  estimate_status: string;
  created_at: string;
  updated_at: string;
};

export type ProposalSummary = {
  id: string;
  job_id: string;
  estimate_id: string;
  number: string;
  status: ProposalStatus;
  total_cents: number;
  updated_at: string;
};

export type TemplateView = {
  id: string;
  name: string;
  intro: string;
  scope_note: string;
  terms: string;
  include_site_map: boolean;
  include_optional: boolean;
  created_at: string;
  updated_at: string;
};

function conflict(detail: string): ProblemError {
  return new ProblemError({ status: 409, title: "Conflict", detail });
}

function notFound(detail: string): ProblemError {
  return new ProblemError({ status: 404, title: "Not Found", detail });
}

function badRequest(detail: string): ProblemError {
  return new ProblemError({ status: 400, title: "Bad Request", detail });
}

function iso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requiredIso(value: Date | string): string {
  return iso(value) ?? new Date(0).toISOString();
}

function asUuidArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value !== "string") {
    return [];
  }
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "{}") {
    return [];
  }
  const body = trimmed.startsWith("{") ? trimmed.slice(1, -1) : trimmed;
  if (body === "") {
    return [];
  }
  return body.split(",").map((part) => part.trim().replaceAll('"', ""));
}

function uuidArray(ids: readonly string[]) {
  if (ids.length === 0) {
    return sql`'{}'::uuid[]`;
  }
  return sql`array[${sql.join(ids.map((id) => sql`${id}::uuid`))}]::uuid[]`;
}

function parseSnapshot(value: unknown): EstimateView {
  const body = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!body || typeof body !== "object" || !("lines" in body) || !Array.isArray(body.lines)) {
    throw new ProblemError({
      status: 500,
      title: "Internal Server Error",
      detail: "The proposal snapshot is unreadable.",
    });
  }
  return body as EstimateView;
}

function textField(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 8000) {
    throw badRequest(`${label} must be 8000 characters or fewer.`);
  }
  return trimmed;
}

type ErrorNode = { message?: unknown; cause?: unknown };

function errorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const node = current as ErrorNode;
    if (typeof node.message === "string") {
      parts.push(node.message);
    }
    current = node.cause;
  }
  return parts.join("\n");
}

function rethrowProposal(error: unknown): never {
  if (error instanceof ProblemError) {
    throw error;
  }
  const text = errorText(error);
  if (text.includes("illegal proposal transition")) {
    throw conflict("That proposal status change is not allowed.");
  }
  if (text.includes("only a draft proposal can be edited")) {
    throw conflict("Only a draft proposal can be edited.");
  }
  if (text.includes("proposal_one_open_per_estimate")) {
    throw conflict("A proposal already pins this estimate. Clone a new version to write another.");
  }
  if (text.includes("proposal_workspace_id_number_key")) {
    throw conflict("That proposal number already exists.");
  }
  if (text.includes("proposal_template_workspace_id_name_key")) {
    throw conflict("A template with that name already exists.");
  }
  throw error;
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    rethrowProposal(error);
  }
}

function presentLine(line: LineView, selected: ReadonlySet<string>): ProposalLineView {
  return {
    id: line.id,
    group: line.group,
    description: line.description,
    qty: line.qty,
    unit: line.unit,
    unit_price_cents: line.unit_price_cents,
    price_cents: line.price_cents,
    tax_cents: line.tax_cents,
    optional: line.optional,
    selected: line.optional && selected.has(line.id),
  };
}

function present(row: ProposalRow, snapshot: EstimateView): ProposalView {
  if (!isProposalStatus(row.status)) {
    throw new ProblemError({
      status: 500,
      title: "Internal Server Error",
      detail: "A proposal has an unknown status.",
    });
  }
  const selectedIds = asUuidArray(row.selected_optional_line_ids);
  const selected = new Set(selectedIds);
  const lines = snapshot.lines.map((line) => presentLine(line, selected));
  const selectedPrice = lines
    .filter((line) => line.selected)
    .reduce((sum, line) => sum + line.price_cents, 0);
  const selectedTax = lines
    .filter((line) => line.selected)
    .reduce((sum, line) => sum + line.tax_cents, 0);
  return {
    id: row.id,
    job_id: snapshot.job_id,
    estimate_id: row.estimate_id,
    template_id: row.template_id,
    number: row.number,
    status: row.status,
    intro: row.intro,
    scope_note: row.scope_note,
    terms: row.terms,
    include_site_map: row.include_site_map,
    include_optional: row.include_optional,
    selected_optional_line_ids: selectedIds,
    estimate_number: snapshot.number,
    estimate_version: snapshot.version,
    expires_at: iso(row.expires_at),
    pdf_file_id: row.pdf_file_id,
    subtotal_cents: snapshot.subtotal_cents + selectedPrice,
    tax_cents: snapshot.tax_cents + selectedTax,
    total_cents: snapshot.total_cents + selectedPrice + selectedTax,
    lines,
    bounced: row.bounced,
    recipients: [],
    signatures: [],
    work_order_id: null,
    estimate_status: "ready",
    created_at: requiredIso(row.created_at),
    updated_at: requiredIso(row.updated_at),
  };
}

function summaryOf(view: ProposalView): ProposalSummary {
  return {
    id: view.id,
    job_id: view.job_id,
    estimate_id: view.estimate_id,
    number: view.number,
    status: view.status,
    total_cents: view.total_cents,
    updated_at: view.updated_at,
  };
}

function presentTemplate(row: TemplateRow): TemplateView {
  return {
    id: row.id,
    name: row.name,
    intro: row.intro,
    scope_note: row.scope_note,
    terms: row.terms,
    include_site_map: row.include_site_map,
    include_optional: row.include_optional,
    created_at: requiredIso(row.created_at),
    updated_at: requiredIso(row.updated_at),
  };
}

async function audit(
  trx: Trx,
  input: {
    workspaceId: string;
    actorId: string;
    entityType: "proposal" | "proposal_template";
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

async function allocateProposalNumber(
  trx: Trx,
  workspaceId: string,
  memberId: string,
): Promise<string> {
  const result = await sql<{ last_value: string }>`
    insert into counters (id, workspace_id, prefix, last_value, created_by)
    values (${createId()}::uuid, ${workspaceId}::uuid, 'P', 1001, ${memberId}::uuid)
    on conflict (workspace_id, prefix)
    do update set last_value = counters.last_value + 1, updated_at = now()
    returning last_value::text as last_value
  `.execute(trx);
  const sequence = Number(result.rows[0]?.last_value);
  if (!Number.isSafeInteger(sequence)) {
    throw new Error("Proposal counter did not return a sequence.");
  }
  return formatHumanNumber("P", sequence);
}

async function loadProposal(trx: Trx, id: string): Promise<ProposalRow | undefined> {
  return trx.selectFrom("proposal").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function getProposal(trx: Trx, id: string): Promise<ProposalView> {
  const row = await loadProposal(trx, id);
  if (!row) {
    throw notFound("That proposal was not found.");
  }
  const view = present(row, parseSnapshot(row.snapshot));
  const estimate = await trx
    .selectFrom("estimate")
    .select("status")
    .where("id", "=", row.estimate_id)
    .executeTakeFirst();
  const signatures = await trx
    .selectFrom("signature")
    .select(["signer_name", "signer_email", "signed_at"])
    .where("proposal_id", "=", row.id)
    .orderBy("created_at")
    .execute();
  const workOrder = await trx
    .selectFrom("work_order")
    .select("id")
    .where("proposal_id", "=", row.id)
    .executeTakeFirst();
  view.bounced = row.bounced;
  view.recipients = recipientList(row.recipients);
  view.signatures = signatures.map((signature) => ({
    signer_name: signature.signer_name,
    signer_email: signature.signer_email,
    signed_at: iso(signature.signed_at),
  }));
  view.work_order_id = workOrder?.id ?? null;
  view.estimate_status = estimate?.status ?? view.estimate_status;
  return view;
}

function recipientList(value: unknown): { name: string; email: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const recipients: { name: string; email: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name : "";
    const email = typeof row.email === "string" ? row.email : "";
    if (name && email) {
      recipients.push({ name, email });
    }
  }
  return recipients;
}

export async function listEstimateProposals(
  trx: Trx,
  estimateId: string,
): Promise<ProposalSummary[]> {
  const estimate = await trx
    .selectFrom("estimate")
    .select("id")
    .where("id", "=", estimateId)
    .executeTakeFirst();
  if (!estimate) {
    throw notFound("That estimate was not found.");
  }
  const rows = await trx
    .selectFrom("proposal")
    .selectAll()
    .where("estimate_id", "=", estimateId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => summaryOf(present(row, parseSnapshot(row.snapshot))));
}

export async function listJobProposals(trx: Trx, jobId: string): Promise<ProposalSummary[]> {
  const job = await trx.selectFrom("job").select("id").where("id", "=", jobId).executeTakeFirst();
  if (!job) {
    throw notFound("That job was not found.");
  }
  const rows = await trx
    .selectFrom("proposal")
    .innerJoin("estimate", "estimate.id", "proposal.estimate_id")
    .selectAll("proposal")
    .where("estimate.job_id", "=", jobId)
    .orderBy("proposal.created_at")
    .orderBy("proposal.id")
    .execute();
  return rows.map((row) => summaryOf(present(row, parseSnapshot(row.snapshot))));
}

export async function createProposal(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    estimateId: string;
    templateId?: string | undefined;
  },
): Promise<ProposalView> {
  return run(async () => {
    const estimate = await getEstimate(trx, input.estimateId);
    if (estimate.status !== "ready" && estimate.status !== "sent") {
      throw conflict("A proposal can only pin a ready or sent estimate.");
    }
    const open = await trx
      .selectFrom("proposal")
      .select(["id", "number"])
      .where("estimate_id", "=", estimate.id)
      .where("status", "<>", "void")
      .executeTakeFirst();
    if (open) {
      throw conflict(
        `A proposal already pins this estimate (${open.number}). Clone a new version to write another.`,
      );
    }
    const template = input.templateId
      ? await trx
          .selectFrom("proposal_template")
          .selectAll()
          .where("id", "=", input.templateId)
          .executeTakeFirst()
      : undefined;
    if (input.templateId && !template) {
      throw notFound("That proposal template was not found.");
    }
    const id = createId();
    const number = await allocateProposalNumber(trx, input.workspaceId, input.memberId);
    const hash = newPublicTokenHash();
    await trx
      .insertInto("proposal")
      .values({
        id,
        workspace_id: input.workspaceId,
        estimate_id: estimate.id,
        template_id: template?.id ?? null,
        number,
        status: "draft",
        intro: template?.intro ?? "",
        scope_note: template?.scope_note ?? "",
        terms: template?.terms ?? "",
        include_site_map: template?.include_site_map ?? true,
        include_optional: template?.include_optional ?? true,
        selected_optional_line_ids: uuidArray([]),
        public_token_hash: hash,
        estimate_version: estimate.version,
        snapshot: sql`${JSON.stringify(estimate)}::jsonb`,
        pdf_file_id: null,
        signed_pdf_file_id: null,
        provider: null,
        provider_envelope_id: null,
        recipients: sql`'[]'::jsonb`,
        message: "",
        bounced: false,
        expires_at: null,
        created_by: input.memberId,
      })
      .execute();
    await trx
      .insertInto("proposal_token")
      .values({
        token_hash: hash,
        workspace_id: input.workspaceId,
        proposal_id: id,
      })
      .execute();
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "proposal",
      entityId: id,
      action: "create",
      diff: {
        number,
        estimate_id: estimate.id,
        estimate_version: estimate.version,
        template_id: template?.id ?? null,
      },
    });
    return getProposal(trx, id);
  });
}

export type ProposalPatch = {
  intro?: string | undefined;
  scopeNote?: string | undefined;
  terms?: string | undefined;
  includeSiteMap?: boolean | undefined;
  includeOptional?: boolean | undefined;
  selectedOptionalLineIds?: string[] | undefined;
  expiresAt?: string | null | undefined;
};

export async function patchProposal(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    proposalId: string;
    patch: ProposalPatch;
  },
): Promise<ProposalView> {
  return run(async () => {
    const row = await loadProposal(trx, input.proposalId);
    if (!row) {
      throw notFound("That proposal was not found.");
    }
    if (row.status !== "draft") {
      throw conflict("Only a draft proposal can be edited.");
    }
    const snapshot = parseSnapshot(row.snapshot);
    const optionalIds = new Set(
      snapshot.lines.filter((line) => line.optional).map((line) => line.id),
    );
    const selected =
      input.patch.selectedOptionalLineIds === undefined
        ? asUuidArray(row.selected_optional_line_ids)
        : input.patch.selectedOptionalLineIds;
    for (const id of selected) {
      if (!optionalIds.has(id)) {
        throw badRequest("Selected options must be optional lines on this proposal.");
      }
    }
    let expiresAt = row.expires_at;
    if (input.patch.expiresAt !== undefined) {
      if (input.patch.expiresAt === null) {
        expiresAt = null;
      } else {
        const parsed = new Date(input.patch.expiresAt);
        if (Number.isNaN(parsed.getTime())) {
          throw badRequest("expires_at must be a time.");
        }
        expiresAt = parsed;
      }
    }
    await trx
      .updateTable("proposal")
      .set({
        intro:
          input.patch.intro === undefined
            ? row.intro
            : textField(input.patch.intro, "Introduction"),
        scope_note:
          input.patch.scopeNote === undefined
            ? row.scope_note
            : textField(input.patch.scopeNote, "Scope"),
        terms: input.patch.terms === undefined ? row.terms : textField(input.patch.terms, "Terms"),
        include_site_map: input.patch.includeSiteMap ?? row.include_site_map,
        include_optional: input.patch.includeOptional ?? row.include_optional,
        selected_optional_line_ids: uuidArray(selected),
        expires_at: expiresAt,
      })
      .where("id", "=", row.id)
      .execute();
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "proposal",
      entityId: row.id,
      action: "update",
      diff: {
        intro: input.patch.intro !== undefined,
        scope_note: input.patch.scopeNote !== undefined,
        terms: input.patch.terms !== undefined,
        selected_optional_count: selected.length,
      },
    });
    return getProposal(trx, row.id);
  });
}

export async function listTemplates(trx: Trx): Promise<TemplateView[]> {
  const rows = await trx
    .selectFrom("proposal_template")
    .selectAll()
    .orderBy("name")
    .orderBy("id")
    .execute();
  return rows.map(presentTemplate);
}

export async function createTemplate(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    name: string;
    intro?: string | undefined;
    scopeNote?: string | undefined;
    terms?: string | undefined;
    includeSiteMap?: boolean | undefined;
    includeOptional?: boolean | undefined;
  },
): Promise<TemplateView> {
  return run(async () => {
    const name = input.name.trim();
    if (name.length < 1 || name.length > 200) {
      throw badRequest("Template name must be 1 to 200 characters.");
    }
    const id = createId();
    await trx
      .insertInto("proposal_template")
      .values({
        id,
        workspace_id: input.workspaceId,
        name,
        intro: textField(input.intro ?? "", "Introduction"),
        scope_note: textField(input.scopeNote ?? "", "Scope"),
        terms: textField(input.terms ?? "", "Terms"),
        include_site_map: input.includeSiteMap ?? true,
        include_optional: input.includeOptional ?? true,
        created_by: input.memberId,
      })
      .execute();
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "proposal_template",
      entityId: id,
      action: "create",
      diff: { name },
    });
    const row = await trx
      .selectFrom("proposal_template")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) {
      throw notFound("That proposal template was not found.");
    }
    return presentTemplate(row);
  });
}

export async function patchTemplate(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    templateId: string;
    name?: string | undefined;
    intro?: string | undefined;
    scopeNote?: string | undefined;
    terms?: string | undefined;
    includeSiteMap?: boolean | undefined;
    includeOptional?: boolean | undefined;
  },
): Promise<TemplateView> {
  return run(async () => {
    const row = await trx
      .selectFrom("proposal_template")
      .selectAll()
      .where("id", "=", input.templateId)
      .executeTakeFirst();
    if (!row) {
      throw notFound("That proposal template was not found.");
    }
    const name = input.name === undefined ? row.name : input.name.trim();
    if (name.length < 1 || name.length > 200) {
      throw badRequest("Template name must be 1 to 200 characters.");
    }
    await trx
      .updateTable("proposal_template")
      .set({
        name,
        intro: input.intro === undefined ? row.intro : textField(input.intro, "Introduction"),
        scope_note:
          input.scopeNote === undefined ? row.scope_note : textField(input.scopeNote, "Scope"),
        terms: input.terms === undefined ? row.terms : textField(input.terms, "Terms"),
        include_site_map: input.includeSiteMap ?? row.include_site_map,
        include_optional: input.includeOptional ?? row.include_optional,
      })
      .where("id", "=", row.id)
      .execute();
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "proposal_template",
      entityId: row.id,
      action: "update",
      diff: { name },
    });
    const next = await trx
      .selectFrom("proposal_template")
      .selectAll()
      .where("id", "=", row.id)
      .executeTakeFirst();
    if (!next) {
      throw notFound("That proposal template was not found.");
    }
    return presentTemplate(next);
  });
}

export async function markProposalRendered(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    proposalId: string;
    fileId: string;
  },
): Promise<void> {
  await run(async () => {
    const row = await loadProposal(trx, input.proposalId);
    if (!row) {
      throw notFound("That proposal was not found.");
    }
    if (row.status === "rendered" && row.pdf_file_id) {
      return;
    }
    if (!isProposalStatus(row.status)) {
      throw conflict("That proposal cannot be rendered.");
    }
    try {
      transitionProposal(row.status, "rendered");
    } catch {
      throw conflict("That proposal cannot be rendered.");
    }
    const updated = await trx
      .updateTable("proposal")
      .set({ status: "rendered", pdf_file_id: input.fileId })
      .where("id", "=", row.id)
      .where("status", "=", "draft")
      .executeTakeFirst();
    if (updated.numUpdatedRows === 0n) {
      return;
    }
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "proposal",
      entityId: row.id,
      action: "render",
      diff: { pdf_file_id: input.fileId },
    });
  });
}

/** Read path for the worker. Cost fields stay on the snapshot and are not returned. */
export async function loadProposalForRender(
  trx: Trx,
  proposalId: string,
): Promise<
  | {
      row: ProposalRow;
      view: ProposalView;
      snapshot: EstimateView;
    }
  | undefined
> {
  const row = await loadProposal(trx, proposalId);
  if (!row) {
    return undefined;
  }
  const snapshot = parseSnapshot(row.snapshot);
  return { row, view: present(row, snapshot), snapshot };
}
