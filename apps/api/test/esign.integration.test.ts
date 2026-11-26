import { Writable } from "node:stream";

import { createId } from "@groundwork/shared";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { Mailer } from "../src/auth/mail.js";
import { readAppDatabaseUrl, readAuthDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { createLogger } from "../src/logging.js";
import { setWonFlowFault } from "../src/proposals/esign-flow.js";
import {
  FakeEsignProvider,
  fakeEnvelopeId,
  signFakeBody,
  type EsignEvent,
} from "../src/proposals/esign.js";
import type { ProposalFiles } from "../src/proposals/files.js";
import { resetPublicRateLimit, setPublicRateLimit } from "../src/proposals/rate-limit.js";
import { hashPublicToken } from "../src/proposals/token.js";
import { workspaceStorageKey } from "../src/storage/s3.js";

const PASSWORD = "correct-horse-battery";
const SECRET = "esign-test-secret";
const BROWSER = {
  origin: "http://127.0.0.1:5173",
  host: "127.0.0.1:5173",
};

type Session = { cookie: string; email: string };

const logs: string[] = [];
const logger = createLogger(
  "api",
  new Writable({
    write(chunk, _encoding, callback) {
      logs.push(String(chunk));
      callback();
    },
  }),
);

const stored = new Map<string, Buffer>();
const renderedHtml: string[] = [];
const files: ProposalFiles = {
  async put(input) {
    stored.set(input.storageKey, Buffer.from(input.body));
  },
  async get(storageKey) {
    const body = stored.get(storageKey);
    if (!body) {
      throw new Error(`Missing ${storageKey}`);
    }
    return Buffer.from(body);
  },
};
const esign = new FakeEsignProvider(SECRET);

let app: FastifyInstance | undefined;
let admin: pg.Pool | undefined;
let pools: pg.Pool[] = [];

const mailer: Mailer = {
  async send() {
    return undefined;
  },
};

beforeAll(async () => {
  await migrate("up");
  admin = createPool(readDatabaseUrl());
  const appPool = createPool(readAppDatabaseUrl());
  const authPool = createPool(readAuthDatabaseUrl());
  pools = [appPool, authPool];
  app = await buildApp({
    logger,
    database: { app: appPool, auth: authPool },
    mailer,
    proposals: {
      esign,
      files,
      renderPdf: async (html) => {
        renderedHtml.push(html);
        return Buffer.from("%PDF-1.4\nstub\n");
      },
    },
  });
});

afterAll(async () => {
  setWonFlowFault(undefined);
  await app?.close();
  await Promise.all(pools.map((pool) => pool.end()));
  await admin?.end();
});

beforeEach(() => {
  logs.length = 0;
  renderedHtml.length = 0;
  resetPublicRateLimit();
  setWonFlowFault(undefined);
});

afterEach(() => {
  setWonFlowFault(undefined);
});

function requireApp(): FastifyInstance {
  if (!app) {
    throw new Error("The API is not running.");
  }
  return app;
}

function requireAdmin(): pg.Pool {
  if (!admin) {
    throw new Error("Admin pool is not connected.");
  }
  return admin;
}

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const parts = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const cookie = parts.map((part) => String(part).split(";")[0]).join("; ");
  if (!cookie) {
    throw new Error("The response did not set a session cookie.");
  }
  return cookie;
}

function comparablePublicResponse(response: {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
}): { statusCode: number; body: string; headers: Record<string, unknown> } {
  const headers = { ...response.headers };
  delete headers.date;
  return { statusCode: response.statusCode, body: response.body, headers };
}

function headers(cookie: string, workspaceId: string, json = true): Record<string, string> {
  return {
    ...BROWSER,
    cookie,
    "x-workspace-id": workspaceId,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

async function signUp(name: string): Promise<Session> {
  const email = `${createId()}@example.com`;
  const response = await requireApp().inject({
    method: "POST",
    url: "/auth/sign-up/email",
    headers: { ...BROWSER, "content-type": "application/json" },
    payload: { name, email, password: PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: cookieFrom(response), email };
}

async function createWorkspace(cookie: string, name: string): Promise<string> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/workspaces",
    headers: { ...BROWSER, cookie, "content-type": "application/json" },
    payload: { name },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

async function readyEstimate(
  cookie: string,
  workspaceId: string,
): Promise<{ id: string; jobId: string; lineId: string; description: string }> {
  const job = await requireApp().inject({
    method: "POST",
    url: "/jobs",
    headers: headers(cookie, workspaceId),
    payload: {
      name: "Driveway",
      client: { name: "Ada", type: "residential" },
      address: "100 Main St, Morganton, NC 28655",
    },
  });
  expect(job.statusCode, job.body).toBe(201);
  const created = await requireApp().inject({
    method: "POST",
    url: `/jobs/${job.json().id}/estimates`,
    headers: headers(cookie, workspaceId),
    payload: {},
  });
  expect(created.statusCode, created.body).toBe(201);
  const description = "Surface course";
  const added = await requireApp().inject({
    method: "POST",
    url: `/estimates/${created.json().id}/lines`,
    headers: headers(cookie, workspaceId),
    payload: {
      description,
      qty: "2",
      unit: "sy",
      unit_price_cents: 5000,
      optional: true,
    },
  });
  expect(added.statusCode, added.body).toBe(201);
  const required = await requireApp().inject({
    method: "POST",
    url: `/estimates/${created.json().id}/lines`,
    headers: headers(cookie, workspaceId),
    payload: { description: "Base", qty: "1", unit: "sy", unit_price_cents: 5000 },
  });
  expect(required.statusCode, required.body).toBe(201);
  const ready = await requireApp().inject({
    method: "POST",
    url: `/estimates/${created.json().id}/transition`,
    headers: headers(cookie, workspaceId),
    payload: { to: "ready" },
  });
  expect(ready.statusCode, ready.body).toBe(200);
  const optional = (ready.json().lines as { id: string; optional: boolean }[]).find(
    (line) => line.optional,
  );
  if (!optional) {
    throw new Error("The ready estimate has no optional line.");
  }
  return {
    id: created.json().id as string,
    jobId: job.json().id as string,
    lineId: optional.id,
    description,
  };
}

async function draftProposal(
  cookie: string,
  workspaceId: string,
): Promise<{
  proposalId: string;
  workspaceId: string;
  estimateId: string;
  jobId: string;
  lineId: string;
  description: string;
  cookie: string;
}> {
  const estimate = await readyEstimate(cookie, workspaceId);
  const created = await requireApp().inject({
    method: "POST",
    url: `/estimates/${estimate.id}/proposals`,
    headers: headers(cookie, workspaceId),
    payload: {},
  });
  expect(created.statusCode, created.body).toBe(201);
  return {
    proposalId: created.json().id as string,
    workspaceId,
    estimateId: estimate.id,
    jobId: estimate.jobId,
    lineId: estimate.lineId,
    description: estimate.description,
    cookie,
  };
}

async function markRendered(proposalId: string, workspaceId: string): Promise<void> {
  const fileId = createId();
  const storageKey = workspaceStorageKey(workspaceId, fileId);
  const pdf = Buffer.from("%PDF-1.4\nstub\n");
  await files.put({ storageKey, body: pdf, mime: "application/pdf" });
  await requireAdmin().query(
    `insert into file (id, workspace_id, storage_key, mime, bytes, status)
     values ($1, $2, $3, 'application/pdf', $4, 'ready')`,
    [fileId, workspaceId, storageKey, String(pdf.length)],
  );
  await requireAdmin().query(
    "update proposal set status = 'rendered', pdf_file_id = $2 where id = $1",
    [proposalId, fileId],
  );
}

async function issueLink(cookie: string, workspaceId: string, proposalId: string): Promise<string> {
  const response = await requireApp().inject({
    method: "POST",
    url: `/proposals/${proposalId}/link`,
    headers: headers(cookie, workspaceId),
    payload: {},
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().token as string;
}

async function send(
  cookie: string,
  workspaceId: string,
  proposalId: string,
  recipients: { name: string; email: string }[],
) {
  return requireApp().inject({
    method: "POST",
    url: `/proposals/${proposalId}/send`,
    headers: headers(cookie, workspaceId),
    payload: { recipients, message: "Please sign" },
  });
}

function signedEvent(
  proposalId: string,
  workspaceId: string,
  eventId: string,
  signer: { name: string; email: string },
  signers: { name: string; email: string; signed: boolean }[],
): EsignEvent {
  return {
    eventId,
    type: "signed",
    envelopeId: fakeEnvelopeId(proposalId),
    workspaceId,
    proposalId,
    signer,
    signers,
  };
}

async function postWebhook(event: EsignEvent, signature?: string) {
  const raw = JSON.stringify({
    event_id: event.eventId,
    type: event.type,
    envelope_id: event.envelopeId,
    workspace_id: event.workspaceId,
    proposal_id: event.proposalId,
    signer: event.signer,
    signers: event.signers,
  });
  const body = Buffer.from(raw);
  return requireApp().inject({
    method: "POST",
    url: "/webhooks/esign/fake",
    headers: {
      "content-type": "application/json",
      "x-esign-signature": signature ?? signFakeBody(SECRET, body),
    },
    payload: raw,
  });
}

async function counts(proposalId: string): Promise<{
  signatures: number;
  workOrders: number;
  proposal: string;
  estimate: string;
  job: string;
  usage: number;
}> {
  const signature = await requireAdmin().query<{ count: string }>(
    "select count(*)::text as count from signature where proposal_id = $1",
    [proposalId],
  );
  const work = await requireAdmin().query<{ count: string }>(
    "select count(*)::text as count from work_order where proposal_id = $1",
    [proposalId],
  );
  const row = await requireAdmin().query<{
    proposal: string;
    estimate: string;
    job: string;
    workspace_id: string;
  }>(
    `select proposal.status as proposal, estimate.status as estimate, job.stage as job,
            proposal.workspace_id
     from proposal
     join estimate on estimate.id = proposal.estimate_id
     join job on job.id = estimate.job_id
     where proposal.id = $1`,
    [proposalId],
  );
  const usage = await requireAdmin().query<{ count: string }>(
    "select count(*)::text as count from usage_event where workspace_id = $1 and kind = 'esign_send'",
    [row.rows[0]?.workspace_id],
  );
  return {
    signatures: Number(signature.rows[0]?.count ?? 0),
    workOrders: Number(work.rows[0]?.count ?? 0),
    proposal: row.rows[0]?.proposal ?? "",
    estimate: row.rows[0]?.estimate ?? "",
    job: row.rows[0]?.job ?? "",
    usage: Number(usage.rows[0]?.count ?? 0),
  };
}

describe("proposal e-sign", () => {
  it("applies one signed webhook five times as one signature and one work order", async () => {
    const owner = await signUp("Signer");
    const workspaceId = await createWorkspace(owner.cookie, "Sign Co");
    const proposal = await draftProposal(owner.cookie, workspaceId);
    await markRendered(proposal.proposalId, workspaceId);
    const sent = await send(owner.cookie, workspaceId, proposal.proposalId, [
      { name: "Ada", email: "ada@example.com" },
    ]);
    expect(sent.statusCode, sent.body).toBe(200);
    const event = signedEvent(
      proposal.proposalId,
      workspaceId,
      `evt-replay-${createId()}`,
      { name: "Ada", email: "ada@example.com" },
      [{ name: "Ada", email: "ada@example.com", signed: true }],
    );
    for (let i = 0; i < 5; i += 1) {
      const response = await postWebhook(event);
      expect(response.statusCode, response.body).toBe(200);
    }
    const after = await counts(proposal.proposalId);
    expect(after).toMatchObject({
      signatures: 1,
      workOrders: 1,
      proposal: "signed",
      estimate: "accepted",
      job: "won",
      usage: 2,
    });
  });

  it("keeps an early webhook until send stores the envelope", async () => {
    const owner = await signUp("Early");
    const workspaceId = await createWorkspace(owner.cookie, "Early Co");
    const proposal = await draftProposal(owner.cookie, workspaceId);
    await markRendered(proposal.proposalId, workspaceId);
    const event = signedEvent(
      proposal.proposalId,
      workspaceId,
      `evt-early-${createId()}`,
      { name: "Ada", email: "ada@example.com" },
      [{ name: "Ada", email: "ada@example.com", signed: true }],
    );
    const early = await postWebhook(event);
    expect(early.statusCode, early.body).toBe(200);
    const pending = await requireAdmin().query<{ processed_at: Date | null }>(
      "select processed_at from event_log where event_id = $1",
      [event.eventId],
    );
    expect(pending.rows[0]?.processed_at).toBeNull();
    const sent = await send(owner.cookie, workspaceId, proposal.proposalId, [
      { name: "Ada", email: "ada@example.com" },
    ]);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().status).toBe("signed");
    const after = await counts(proposal.proposalId);
    expect(after.workOrders).toBe(1);
    expect(after.job).toBe("won");
  });

  it("rejects a bad webhook signature with 401 and does not log the body", async () => {
    const marker = "secret-marker-not-logged";
    const response = await requireApp().inject({
      method: "POST",
      url: "/webhooks/esign/fake",
      headers: {
        "content-type": "application/json",
        "x-esign-signature": "00",
      },
      payload: JSON.stringify({ event_id: marker, type: "signed" }),
    });
    expect(response.statusCode).toBe(401);
    const text = logs.join("\n");
    expect(text).not.toContain(marker);
    expect(text).not.toContain("x-esign-signature");
  });

  it("returns one 404 for an unknown, voided, expired, superseded, or used link", async () => {
    const owner = await signUp("Gone");
    const workspaceId = await createWorkspace(owner.cookie, "Gone Co");
    const proposal = await draftProposal(owner.cookie, workspaceId);
    await markRendered(proposal.proposalId, workspaceId);
    const token = await issueLink(owner.cookie, workspaceId, proposal.proposalId);
    const open = await requireApp().inject({
      method: "GET",
      url: `/public/proposals/${token}`,
    });
    expect(open.statusCode, open.body).toBe(200);
    expect(logs.join("\n")).not.toContain(token);
    expect(logs.join("\n")).toContain("[redacted]");

    const unknownToken = "not-a-real-token-value-here";
    logs.length = 0;
    const unknown = await requireApp().inject({
      method: "GET",
      url: `/public/proposals/${unknownToken}`,
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "This link isn't available.",
      instance: "/public/proposals/{token}",
    });
    expect(String(unknown.headers["content-type"])).toContain("application/problem+json");
    expect(unknown.body).not.toContain(unknownToken);
    const unknownLog = logs.join("\n");
    expect(unknownLog).toContain('"reason":"unknown"');
    expect(unknownLog).not.toContain(unknownToken);
    expect(unknownLog).not.toContain(hashPublicToken(unknownToken));

    const short = await requireApp().inject({
      method: "GET",
      url: "/public/proposals/short-token",
    });
    expect(comparablePublicResponse(short)).toEqual(comparablePublicResponse(unknown));

    const voided = await requireApp().inject({
      method: "POST",
      url: `/proposals/${proposal.proposalId}/void`,
      headers: headers(owner.cookie, workspaceId),
      payload: {},
    });
    expect(voided.statusCode, voided.body).toBe(200);
    const hash = await requireAdmin().query<{ token_hash: string }>(
      "select token_hash from proposal_token where proposal_id = $1",
      [proposal.proposalId],
    );
    const tokenHash = hash.rows[0]?.token_hash;
    if (!tokenHash) {
      throw new Error("The voided proposal has no token hash.");
    }
    logs.length = 0;
    const closed = await requireApp().inject({
      method: "GET",
      url: `/public/proposals/${token}`,
    });
    expect(closed.body).toBe(unknown.body);
    expect(Buffer.compare(closed.rawPayload, unknown.rawPayload)).toBe(0);
    expect(comparablePublicResponse(closed)).toEqual(comparablePublicResponse(unknown));
    const voidLog = logs.join("\n");
    expect(voidLog).toContain('"reason":"void"');
    expect(voidLog).not.toContain(token);
    expect(voidLog).not.toContain(tokenHash);

    const closedPost = await requireApp().inject({
      method: "POST",
      url: `/public/proposals/${token}`,
      headers: { "content-type": "application/json" },
      payload: { selected_optional_line_ids: [] },
    });
    expect(closedPost.body).toBe(unknown.body);
    expect(comparablePublicResponse(closedPost)).toEqual(comparablePublicResponse(unknown));

    const closedSign = await requireApp().inject({
      method: "POST",
      url: `/public/proposals/${token}/sign`,
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(closedSign.body).toBe(unknown.body);
    expect(comparablePublicResponse(closedSign)).toEqual(comparablePublicResponse(unknown));

    const expired = await draftProposal(owner.cookie, workspaceId);
    await markRendered(expired.proposalId, workspaceId);
    const expiredToken = await issueLink(owner.cookie, workspaceId, expired.proposalId);
    const sent = await send(owner.cookie, workspaceId, expired.proposalId, [
      { name: "Ada", email: "ada@example.com" },
    ]);
    expect(sent.statusCode, sent.body).toBe(200);
    await requireAdmin().query("update proposal set expires_at = '2000-01-01' where id = $1", [
      expired.proposalId,
    ]);
    logs.length = 0;
    const past = await requireApp().inject({
      method: "GET",
      url: `/public/proposals/${expiredToken}`,
    });
    expect(past.body).toBe(unknown.body);
    expect(logs.join("\n")).toContain('"reason":"expired"');
    expect(logs.join("\n")).not.toContain(expiredToken);

    const superseded = await draftProposal(owner.cookie, workspaceId);
    await markRendered(superseded.proposalId, workspaceId);
    const supersededToken = await issueLink(owner.cookie, workspaceId, superseded.proposalId);
    const sentAgain = await send(owner.cookie, workspaceId, superseded.proposalId, [
      { name: "Ada", email: "ada@example.com" },
    ]);
    expect(sentAgain.statusCode, sentAgain.body).toBe(200);
    const version = await requireApp().inject({
      method: "POST",
      url: `/estimates/${superseded.estimateId}/versions`,
      headers: headers(owner.cookie, workspaceId),
      payload: {},
    });
    expect(version.statusCode, version.body).toBe(201);
    logs.length = 0;
    const replacedEstimate = await requireApp().inject({
      method: "GET",
      url: `/public/proposals/${supersededToken}`,
    });
    expect(replacedEstimate.body).toBe(unknown.body);
    expect(logs.join("\n")).toContain('"reason":"superseded"');
    expect(logs.join("\n")).not.toContain(supersededToken);

    const rotated = await draftProposal(owner.cookie, workspaceId);
    await markRendered(rotated.proposalId, workspaceId);
    const firstToken = await issueLink(owner.cookie, workspaceId, rotated.proposalId);
    const secondToken = await issueLink(owner.cookie, workspaceId, rotated.proposalId);
    expect(secondToken).not.toBe(firstToken);
    logs.length = 0;
    const used = await requireApp().inject({
      method: "GET",
      url: `/public/proposals/${firstToken}`,
    });
    expect(used.body).toBe(unknown.body);
    expect(logs.join("\n")).toContain('"reason":"unknown"');
    expect(logs.join("\n")).not.toContain(firstToken);
    expect(logs.join("\n")).not.toContain(hashPublicToken(firstToken));

    await requireAdmin().query(
      "update proposal set public_token_hash = $2 where id = $1 and status = 'rendered'",
      [rotated.proposalId, "ab".repeat(32)],
    );
    logs.length = 0;
    const stale = await requireApp().inject({
      method: "GET",
      url: `/public/proposals/${secondToken}`,
    });
    expect(stale.body).toBe(unknown.body);
    const staleLog = logs.join("\n");
    expect(staleLog).toContain('"reason":"used"');
    expect(staleLog).not.toContain(secondToken);
    expect(staleLog).not.toContain(hashPublicToken(secondToken));
    expect(staleLog).not.toContain("ab".repeat(32));
  });

  it("re-renders the chosen optional item before the envelope exists", async () => {
    const owner = await signUp("Options");
    const workspaceId = await createWorkspace(owner.cookie, "Options Co");
    const proposal = await draftProposal(owner.cookie, workspaceId);
    await markRendered(proposal.proposalId, workspaceId);
    const token = await issueLink(owner.cookie, workspaceId, proposal.proposalId);
    const saved = await requireApp().inject({
      method: "POST",
      url: `/public/proposals/${token}`,
      headers: { "content-type": "application/json" },
      payload: { selected_optional_line_ids: [proposal.lineId] },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().total_cents).toBeGreaterThan(0);
    expect(
      saved.json().lines.find((line: { id: string }) => line.id === proposal.lineId).selected,
    ).toBe(true);
    expect(renderedHtml.at(-1)).toContain(proposal.description);
    expect(renderedHtml.at(-1)).toContain("Included");
    const audit = await requireAdmin().query<{ diff: unknown }>(
      "select diff from audit_log where entity_id = $1 and action = 'link'",
      [proposal.proposalId],
    );
    expect(JSON.stringify(audit.rows[0]?.diff)).not.toContain(token);
  });

  it("rolls the won transaction back when the fault fires, then accepts a retry", async () => {
    const owner = await signUp("Fault");
    const workspaceId = await createWorkspace(owner.cookie, "Fault Co");
    const proposal = await draftProposal(owner.cookie, workspaceId);
    await markRendered(proposal.proposalId, workspaceId);
    const sent = await send(owner.cookie, workspaceId, proposal.proposalId, [
      { name: "Ada", email: "ada@example.com" },
    ]);
    expect(sent.statusCode, sent.body).toBe(200);
    const event = signedEvent(
      proposal.proposalId,
      workspaceId,
      `evt-fault-${createId()}`,
      { name: "Ada", email: "ada@example.com" },
      [{ name: "Ada", email: "ada@example.com", signed: true }],
    );
    setWonFlowFault(() => {
      throw new Error("won fault");
    });
    const failed = await postWebhook(event);
    expect(failed.statusCode).toBe(500);
    const rolled = await counts(proposal.proposalId);
    expect(rolled).toMatchObject({
      signatures: 0,
      workOrders: 0,
      proposal: "sent",
      estimate: "sent",
      job: "proposed",
      usage: 1,
    });
    const pending = await requireAdmin().query<{ processed_at: Date | null }>(
      "select processed_at from event_log where event_id = $1",
      [event.eventId],
    );
    expect(pending.rows[0]?.processed_at).toBeNull();
    setWonFlowFault(undefined);
    const retried = await postWebhook(event);
    expect(retried.statusCode, retried.body).toBe(200);
    const after = await counts(proposal.proposalId);
    expect(after).toMatchObject({
      signatures: 1,
      workOrders: 1,
      proposal: "signed",
      estimate: "accepted",
      job: "won",
      usage: 2,
    });
  });

  it("waits for every signer and does not win a declined proposal", async () => {
    const owner = await signUp("Multi");
    const workspaceId = await createWorkspace(owner.cookie, "Multi Co");
    const proposal = await draftProposal(owner.cookie, workspaceId);
    await markRendered(proposal.proposalId, workspaceId);
    const people = [
      { name: "Ada", email: "ada@example.com" },
      { name: "Bea", email: "bea@example.com" },
    ];
    const sent = await send(owner.cookie, workspaceId, proposal.proposalId, people);
    expect(sent.statusCode, sent.body).toBe(200);
    const first = await postWebhook(
      signedEvent(proposal.proposalId, workspaceId, `evt-ada-${createId()}`, people[0]!, [
        { ...people[0]!, signed: true },
        { ...people[1]!, signed: false },
      ]),
    );
    expect(first.statusCode, first.body).toBe(200);
    const waiting = await counts(proposal.proposalId);
    expect(waiting.workOrders).toBe(0);
    expect(waiting.signatures).toBe(1);
    expect(waiting.proposal).toBe("viewed");
    const second = await postWebhook(
      signedEvent(proposal.proposalId, workspaceId, `evt-bea-${createId()}`, people[1]!, [
        { ...people[0]!, signed: true },
        { ...people[1]!, signed: true },
      ]),
    );
    expect(second.statusCode, second.body).toBe(200);
    const done = await counts(proposal.proposalId);
    expect(done.workOrders).toBe(1);
    expect(done.signatures).toBe(2);
    expect(done.proposal).toBe("signed");

    const declined = await draftProposal(owner.cookie, workspaceId);
    await markRendered(declined.proposalId, workspaceId);
    const declinedSend = await send(owner.cookie, workspaceId, declined.proposalId, [people[0]!]);
    expect(declinedSend.statusCode, declinedSend.body).toBe(200);
    const no = await postWebhook({
      ...signedEvent(declined.proposalId, workspaceId, `evt-no-${createId()}`, people[0]!, [
        { ...people[0]!, signed: false },
      ]),
      type: "declined",
    });
    expect(no.statusCode, no.body).toBe(200);
    const stopped = await counts(declined.proposalId);
    expect(stopped.workOrders).toBe(0);
    expect(stopped.proposal).toBe("declined");
  });

  it("hides another workspace's proposal and tags public routes outside the tenant sweep", async () => {
    const owner = await signUp("Tenant");
    const workspaceId = await createWorkspace(owner.cookie, "Tenant Co");
    const proposal = await draftProposal(owner.cookie, workspaceId);
    const other = await signUp("Outsider");
    const otherWorkspace = await createWorkspace(other.cookie, "Outsider Co");
    const hidden = await requireApp().inject({
      method: "GET",
      url: `/proposals/${proposal.proposalId}`,
      headers: headers(other.cookie, otherWorkspace, false),
    });
    expect(hidden.statusCode).toBe(404);
    const spec = await requireApp().inject({ method: "GET", url: "/openapi.json" });
    const paths = spec.json().paths as Record<string, Record<string, { tags?: string[] }>>;
    expect(paths["/proposals/{id}/send"]?.post?.tags).toContain("tenant-header");
    expect(paths["/proposals/{id}/void"]?.post?.tags).toContain("tenant-header");
    expect(paths["/proposals/{id}/link"]?.post?.tags).toContain("tenant-header");
    expect(paths["/public/proposals/{token}"]?.get?.tags).toEqual(["public"]);
    expect(paths["/webhooks/esign/{provider}"]?.post?.tags).toEqual(["webhook"]);
  });

  it("returns 429 when the public limit is exhausted", async () => {
    setPublicRateLimit(1);
    const first = await requireApp().inject({
      method: "GET",
      url: "/public/proposals/not-a-real-token-value-here",
    });
    expect(first.statusCode).toBe(404);
    const second = await requireApp().inject({
      method: "GET",
      url: "/public/proposals/not-a-real-token-value-here",
    });
    expect(second.statusCode).toBe(429);
  });
});
