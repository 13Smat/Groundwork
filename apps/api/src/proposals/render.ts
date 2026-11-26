import { createHash } from "node:crypto";

import { renderProposalHtml, type ProposalImageryCredit } from "@groundwork/pdf-templates";
import { createId } from "@groundwork/shared";
import type { Kysely } from "kysely";

import type { Database } from "../db/types.js";
import { withWorkspaceContext } from "../db/workspace.js";
import { ProblemError } from "../errors.js";
import { geometriesOf } from "../takeoff/export-document.js";
import { listFeatures, loadImageryStamp } from "../takeoff/data.js";
import { renderSiteMap, type SiteMapFeature, type SiteMapStamp } from "../takeoff/site-map.js";
import { getObject, putObject, workspaceStorageKey } from "../storage/s3.js";
import { loadProposalForRender, markProposalRendered, type ProposalView } from "./data.js";
import { renderProposalPdf } from "./pdf.js";

const MISSING_PDF = "That proposal PDF is not in storage.";

export type ProposalRenderMessage = {
  proposalId: string;
  workspaceId: string;
  actorMemberId: string;
};

function conflict(detail: string): ProblemError {
  return new ProblemError({ status: 409, title: "Conflict", detail });
}

function addressLine(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "Site";
  }
  const address = value as Record<string, unknown>;
  const parts = ["line1", "city", "region", "postal_code"]
    .map((key) => address[key])
    .filter((part): part is string => typeof part === "string" && part.trim() !== "");
  return parts.length === 0 ? "Site" : parts.join(", ");
}

function modelFromProposal(input: {
  view: ProposalView;
  workspaceName: string;
  clientName: string;
  siteAddress: string;
  jobName: string;
  siteMapPngBase64: string | null;
  imagery: ProposalImageryCredit[];
}) {
  return {
    number: input.view.number,
    estimateNumber: input.view.estimate_number,
    estimateVersion: input.view.estimate_version,
    workspaceName: input.workspaceName,
    clientName: input.clientName,
    siteAddress: input.siteAddress,
    jobName: input.jobName,
    preparedOn: input.view.created_at.slice(0, 10),
    intro: input.view.intro,
    scopeNote: input.view.scope_note,
    terms: input.view.terms,
    lines: input.view.lines.map((line) => ({
      id: line.id,
      group: line.group,
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      unitPriceCents: line.unit_price_cents,
      priceCents: line.price_cents,
      taxCents: line.tax_cents,
      optional: line.optional,
    })),
    selectedOptionalIds: input.view.selected_optional_line_ids,
    includeSiteMap: input.view.include_site_map,
    includeOptional: input.view.include_optional,
    siteMapPngBase64: input.siteMapPngBase64,
    imagery: input.imagery,
  };
}

type Cover = {
  workspaceName: string;
  clientName: string;
  siteAddress: string;
  jobName: string;
  features: SiteMapFeature[];
  stamp: SiteMapStamp | null;
  imagery: ProposalImageryCredit[];
};

async function loadCover(
  db: Kysely<Database>,
  workspaceId: string,
  view: ProposalView,
): Promise<Cover> {
  return withWorkspaceContext(db, workspaceId, async (trx) => {
    const workspace = await trx
      .selectFrom("workspace")
      .select("name")
      .where("id", "=", workspaceId)
      .executeTakeFirst();
    const estimate = await trx
      .selectFrom("estimate")
      .select(["job_id", "takeoff_id"])
      .where("id", "=", view.estimate_id)
      .executeTakeFirst();
    const job = estimate
      ? await trx
          .selectFrom("job")
          .select(["name", "client_id", "location_id"])
          .where("id", "=", estimate.job_id)
          .executeTakeFirst()
      : undefined;
    const client = job?.client_id
      ? await trx
          .selectFrom("client")
          .select("name")
          .where("id", "=", job.client_id)
          .executeTakeFirst()
      : undefined;
    const location = job?.location_id
      ? await trx
          .selectFrom("location")
          .select("address")
          .where("id", "=", job.location_id)
          .executeTakeFirst()
      : undefined;
    const takeoff = estimate?.takeoff_id
      ? await trx
          .selectFrom("takeoff")
          .select(["id", "imagery_capture_id"])
          .where("id", "=", estimate.takeoff_id)
          .executeTakeFirst()
      : undefined;
    const features = takeoff ? geometriesOf(await listFeatures(trx, takeoff.id)) : [];
    const loaded = takeoff?.imagery_capture_id
      ? await loadImageryStamp(trx, takeoff.imagery_capture_id)
      : undefined;
    const stamp: SiteMapStamp | null = loaded
      ? {
          provider: loaded.provider,
          name: loaded.name,
          captureDate: loaded.capture_date,
          gsdCm: loaded.gsd_cm,
          attribution: loaded.attribution,
        }
      : null;
    const imagery: ProposalImageryCredit[] = stamp
      ? [
          {
            provider: stamp.provider,
            name: stamp.name,
            captureDate: stamp.captureDate,
            gsdCm: stamp.gsdCm,
            attribution: stamp.attribution ?? "Attribution not recorded",
          },
        ]
      : [];
    return {
      workspaceName: workspace?.name ?? "Workspace",
      clientName: client?.name ?? "Client",
      siteAddress: addressLine(location?.address),
      jobName: job?.name ?? "Job",
      features,
      stamp,
      imagery,
    };
  });
}

/**
 * Reads the pinned snapshot, paints the site map, prints the PDF, and stores it.
 * The worker calls this. The request waits until the row is rendered.
 */
export async function performProposalRender(
  db: Kysely<Database>,
  message: ProposalRenderMessage,
): Promise<void> {
  const loaded = await withWorkspaceContext(db, message.workspaceId, (trx) =>
    loadProposalForRender(trx, message.proposalId),
  );
  if (!loaded) {
    throw new ProblemError({
      status: 404,
      title: "Not Found",
      detail: "That proposal was not found.",
    });
  }
  if (loaded.row.status === "rendered" && loaded.row.pdf_file_id) {
    return;
  }
  if (loaded.row.status !== "draft") {
    throw conflict("That proposal cannot be rendered.");
  }
  const cover = await loadCover(db, message.workspaceId, loaded.view);
  const png = loaded.view.include_site_map ? renderSiteMap(cover.features, cover.stamp) : null;
  const html = renderProposalHtml(
    modelFromProposal({
      view: loaded.view,
      workspaceName: cover.workspaceName,
      clientName: cover.clientName,
      siteAddress: cover.siteAddress,
      jobName: cover.jobName,
      siteMapPngBase64: png ? png.toString("base64") : null,
      imagery: cover.imagery,
    }),
  );
  const pdf = await renderProposalPdf(html);
  const fileId = createId();
  const storageKey = workspaceStorageKey(message.workspaceId, fileId);
  await putObject({ storageKey, body: pdf, mime: "application/pdf" });
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  await withWorkspaceContext(db, message.workspaceId, async (trx) => {
    const current = await loadProposalForRender(trx, message.proposalId);
    if (!current) {
      throw new ProblemError({
        status: 404,
        title: "Not Found",
        detail: "That proposal was not found.",
      });
    }
    if (current.row.status === "rendered" && current.row.pdf_file_id) {
      return;
    }
    await trx
      .insertInto("file")
      .values({
        id: fileId,
        workspace_id: message.workspaceId,
        storage_key: storageKey,
        mime: "application/pdf",
        bytes: String(pdf.length),
        sha256,
        status: "ready",
        created_by: message.actorMemberId,
      })
      .execute();
    await markProposalRendered(trx, {
      workspaceId: message.workspaceId,
      memberId: message.actorMemberId,
      proposalId: message.proposalId,
      fileId,
    });
  });
}

export async function readProposalPdf(
  db: Kysely<Database>,
  workspaceId: string,
  proposalId: string,
): Promise<{ filename: string; bytes: Buffer }> {
  const loaded = await withWorkspaceContext(db, workspaceId, (trx) =>
    loadProposalForRender(trx, proposalId),
  );
  if (!loaded) {
    throw new ProblemError({
      status: 404,
      title: "Not Found",
      detail: "That proposal was not found.",
    });
  }
  const fileId = loaded.row.pdf_file_id;
  if (!fileId) {
    throw conflict("Render the proposal before previewing it.");
  }
  const file = await withWorkspaceContext(db, workspaceId, (trx) =>
    trx.selectFrom("file").select(["storage_key"]).where("id", "=", fileId).executeTakeFirst(),
  );
  if (!file) {
    throw conflict(MISSING_PDF);
  }
  const bytes = await getObject(file.storage_key, undefined, MISSING_PDF);
  return { filename: `proposal-${loaded.view.number}.pdf`, bytes };
}

export async function waitForRenderedPdf(
  db: Kysely<Database>,
  workspaceId: string,
  proposalId: string,
  timeoutMs = 45_000,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = await withWorkspaceContext(db, workspaceId, (trx) =>
      trx
        .selectFrom("proposal")
        .select(["status", "pdf_file_id"])
        .where("id", "=", proposalId)
        .executeTakeFirst(),
    );
    if (row?.status === "rendered" && row.pdf_file_id) {
      return row.pdf_file_id;
    }
    if (row && row.status !== "draft" && row.status !== "rendered") {
      throw conflict("That proposal cannot be rendered.");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new ProblemError({
    status: 500,
    title: "Internal Server Error",
    detail: "The proposal PDF did not finish rendering.",
  });
}
