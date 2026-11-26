import { createHmac } from "node:crypto";

import { isUuidV7 } from "@groundwork/shared";

import { readDropboxSignConfig, readEsignWebhookSecret } from "../config.js";
import { ProblemError } from "../errors.js";
import { timingSafeEqualHex } from "./token.js";

export const FAKE_PROVIDER = "fake";
export const DROPBOX_PROVIDER = "dropbox_sign";
export const ESIGN_SIGNATURE_HEADER = "x-esign-signature";

const DROPBOX_API = "https://api.hellosign.com/v3";

export type EsignSigner = { name: string; email: string };

export type EsignEventType =
  | "sent"
  | "viewed"
  | "signed"
  | "all_signed"
  | "declined"
  | "voided"
  | "bounced"
  | "expired"
  | "ignored";

export type EsignEvent = {
  eventId: string;
  type: EsignEventType;
  envelopeId: string;
  workspaceId: string;
  proposalId: string;
  signer: EsignSigner | null;
  signers: { name: string; email: string; signed: boolean }[];
};

export type EsignSendInput = {
  proposalId: string;
  workspaceId: string;
  title: string;
  message: string;
  pdf: Buffer;
  signers: EsignSigner[];
  expiresAt: string | null;
};

export type EsignFetch = (url: string, init: RequestInit) => Promise<Response>;

export type WebhookCheck = {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  parsed: unknown;
};

export interface EsignProvider {
  readonly name: typeof FAKE_PROVIDER | typeof DROPBOX_PROVIDER;
  send(input: EsignSendInput): Promise<{ envelopeId: string }>;
  voidEnvelope(envelopeId: string): Promise<void>;
  signedPdf(envelopeId: string): Promise<Buffer>;
  verifyWebhook(input: WebhookCheck): WebhookVerdict;
}

export type WebhookVerdict = { valid: false } | { valid: true; event: EsignEvent | undefined };

export function fakeEnvelopeId(proposalId: string): string {
  return `fake:${proposalId}`;
}

export function signFakeBody(secret: string, body: Buffer): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function fakeWebhookBody(event: EsignEvent): Buffer {
  return Buffer.from(
    JSON.stringify({
      event_id: event.eventId,
      type: event.type,
      envelope_id: event.envelopeId,
      workspace_id: event.workspaceId,
      proposal_id: event.proposalId,
      signer: event.signer,
      signers: event.signers,
    }),
  );
}

/** Dropbox Sign hashes event_time + event_type with the API key. The body is not covered. */
export function dropboxEventHash(apiKey: string, eventTime: string, eventType: string): string {
  return createHmac("sha256", apiKey).update(`${eventTime}${eventType}`).digest("hex");
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

export class FakeEsignProvider implements EsignProvider {
  readonly name = FAKE_PROVIDER;
  private readonly pdfs = new Map<string, Buffer>();

  constructor(private readonly webhookSecret: string) {}

  send(input: EsignSendInput): Promise<{ envelopeId: string }> {
    const envelopeId = fakeEnvelopeId(input.proposalId);
    this.pdfs.set(envelopeId, Buffer.from(input.pdf));
    return Promise.resolve({ envelopeId });
  }

  voidEnvelope(envelopeId: string): Promise<void> {
    this.pdfs.delete(envelopeId);
    return Promise.resolve();
  }

  signedPdf(envelopeId: string): Promise<Buffer> {
    const pdf = this.pdfs.get(envelopeId);
    if (!pdf) {
      return Promise.reject(
        new ProblemError({
          status: 409,
          title: "Conflict",
          detail: "That test envelope has no PDF.",
        }),
      );
    }
    return Promise.resolve(Buffer.from(pdf));
  }

  verifyWebhook(input: WebhookCheck): WebhookVerdict {
    const expected = signFakeBody(this.webhookSecret, input.rawBody);
    const presented = headerValue(input.headers, ESIGN_SIGNATURE_HEADER);
    if (!timingSafeEqualHex(expected, presented)) {
      return { valid: false };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody.toString("utf8")) as unknown;
    } catch {
      return { valid: true, event: undefined };
    }
    return { valid: true, event: parseFakeEvent(parsed) };
  }
}

export function parseFakeEvent(value: unknown): EsignEvent | undefined {
  const body = asRecord(value);
  if (!body) {
    return undefined;
  }
  const type = text(body.type);
  const eventId = text(body.event_id);
  const envelopeId = text(body.envelope_id);
  const workspaceId = text(body.workspace_id);
  const proposalId = text(body.proposal_id);
  if (
    !eventId ||
    !envelopeId ||
    !isUuidV7(workspaceId) ||
    !isUuidV7(proposalId) ||
    !isEventType(type)
  ) {
    return undefined;
  }
  const signer = signerOf(body.signer);
  const signers = signerList(body.signers);
  return { eventId, type, envelopeId, workspaceId, proposalId, signer, signers };
}

function isEventType(value: string): value is EsignEventType {
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

function signerOf(value: unknown): EsignSigner | null {
  const body = asRecord(value);
  if (!body) {
    return null;
  }
  const name = text(body.name).trim();
  const email = text(body.email).trim().toLowerCase();
  if (!name || !email) {
    return null;
  }
  return { name, email };
}

function signerList(value: unknown): { name: string; email: string; signed: boolean }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const signers: { name: string; email: string; signed: boolean }[] = [];
  for (const item of value) {
    const body = asRecord(item);
    const signer = signerOf(body);
    if (!body || !signer) {
      continue;
    }
    signers.push({ ...signer, signed: body.signed === true });
  }
  return signers;
}

const DROPBOX_TYPES: Record<string, EsignEventType> = {
  signature_request_sent: "sent",
  signature_request_viewed: "viewed",
  signature_request_signed: "signed",
  signature_request_all_signed: "all_signed",
  signature_request_declined: "declined",
  signature_request_canceled: "voided",
  signature_request_email_bounce: "bounced",
  signature_request_expired: "expired",
};

export class DropboxSignProvider implements EsignProvider {
  readonly name = DROPBOX_PROVIDER;

  constructor(
    private readonly options: {
      apiKey: string;
      live: boolean;
      fetch?: EsignFetch | undefined;
    },
  ) {}

  async send(input: EsignSendInput): Promise<{ envelopeId: string }> {
    const form = new FormData();
    form.set("title", input.title);
    form.set("subject", input.title);
    form.set("message", input.message);
    form.set("test_mode", this.options.live ? "0" : "1");
    input.signers.forEach((signer, index) => {
      form.set(`signers[${index}][name]`, signer.name);
      form.set(`signers[${index}][email_address]`, signer.email);
    });
    form.set("metadata[workspace_id]", input.workspaceId);
    form.set("metadata[proposal_id]", input.proposalId);
    form.set(
      "file[0]",
      new Blob([new Uint8Array(input.pdf)], { type: "application/pdf" }),
      "proposal.pdf",
    );
    const payload = await this.call(`${DROPBOX_API}/signature_request/send`, {
      method: "POST",
      body: form,
    });
    const request = asRecord(asRecord(payload)?.signature_request);
    const envelopeId = text(request?.signature_request_id);
    if (!envelopeId) {
      throw providerError();
    }
    return { envelopeId };
  }

  async voidEnvelope(envelopeId: string): Promise<void> {
    const response = await this.request(
      `${DROPBOX_API}/signature_request/cancel/${encodeURIComponent(envelopeId)}`,
      { method: "POST" },
    );
    if (response.ok || response.status === 404 || response.status === 410) {
      return;
    }
    throw providerError();
  }

  async signedPdf(envelopeId: string): Promise<Buffer> {
    const response = await this.request(
      `${DROPBOX_API}/signature_request/files/${encodeURIComponent(envelopeId)}?file_type=pdf`,
      { method: "GET" },
    );
    if (!response.ok) {
      throw providerError();
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 5 || bytes.subarray(0, 5).toString("utf8") !== "%PDF-") {
      throw providerError();
    }
    return bytes;
  }

  verifyWebhook(input: WebhookCheck): WebhookVerdict {
    const body = asRecord(input.parsed);
    const event = asRecord(body?.event);
    const eventTime = text(event?.event_time);
    const eventType = text(event?.event_type);
    const presented = text(event?.event_hash);
    if (!eventTime || !eventType || !presented) {
      return { valid: false };
    }
    const expected = dropboxEventHash(this.options.apiKey, eventTime, eventType);
    if (!timingSafeEqualHex(expected, presented)) {
      return { valid: false };
    }
    return { valid: true, event: parseDropboxEvent(body) };
  }

  private call(url: string, init: RequestInit): Promise<unknown> {
    return this.request(url, init).then(async (response) => {
      if (!response.ok) {
        throw providerError();
      }
      return (await response.json()) as unknown;
    });
  }

  private request(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(`${this.options.apiKey}:`).toString("base64")}`,
    );
    const fetchImpl = this.options.fetch ?? fetch;
    return fetchImpl(url, { ...init, headers, redirect: "error" });
  }
}

export function parseDropboxEvent(
  body: Record<string, unknown> | undefined,
): EsignEvent | undefined {
  if (!body) {
    return undefined;
  }
  const event = asRecord(body.event);
  const request = asRecord(body.signature_request);
  const eventType = text(event?.event_type);
  const mapped = DROPBOX_TYPES[eventType] ?? "ignored";
  const eventId =
    text(event?.event_hash) || text(event?.event_id) || `${eventType}:${text(event?.event_time)}`;
  const envelopeId = text(request?.signature_request_id);
  const metadata = asRecord(request?.metadata);
  const workspaceId = text(metadata?.workspace_id);
  const proposalId = text(metadata?.proposal_id);
  if (!eventId || !envelopeId || !isUuidV7(workspaceId) || !isUuidV7(proposalId)) {
    return undefined;
  }
  const signatures = Array.isArray(request?.signatures) ? request.signatures : [];
  const signers = signatures.flatMap((item) => {
    const row = asRecord(item);
    if (!row) {
      return [];
    }
    const name = text(row.signer_name).trim();
    const email = text(row.signer_email_address).trim().toLowerCase();
    if (!name || !email) {
      return [];
    }
    const status = text(row.status_code);
    return [{ name, email, signed: status === "signed" }];
  });
  const related = text(asRecord(event?.event_metadata)?.related_signature_id);
  const relatedRow = signatures
    .map((item) => asRecord(item))
    .find((row) => row && text(row.signature_id) === related);
  const signer = relatedRow
    ? signerOf({
        name: relatedRow.signer_name,
        email: relatedRow.signer_email_address,
      })
    : (signers[0] ?? null);
  return {
    eventId,
    type: mapped,
    envelopeId,
    workspaceId,
    proposalId,
    signer,
    signers,
  };
}

function providerError(): ProblemError {
  return new ProblemError({
    status: 502,
    title: "Bad Gateway",
    detail: "The signature provider rejected the request.",
  });
}

export function createEsignProvider(): EsignProvider {
  const dropbox = readDropboxSignConfig();
  if (dropbox) {
    return new DropboxSignProvider({ apiKey: dropbox.apiKey, live: dropbox.live });
  }
  return new FakeEsignProvider(readEsignWebhookSecret());
}

/** Pull the Dropbox `json` field out of a multipart body. The field value is not logged. */
export function jsonFieldFromMultipart(body: Buffer, contentType: string): unknown {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "The webhook body is not a form.",
    });
  }
  const parts = body.toString("utf8").split(`--${boundary}`);
  for (const part of parts) {
    const splitAt = part.search(/\r?\n\r?\n/);
    if (splitAt < 0) {
      continue;
    }
    if (!/name="json"/i.test(part.slice(0, splitAt))) {
      continue;
    }
    const raw = part
      .slice(splitAt)
      .replace(/^\r?\n\r?\n/, "")
      .replace(/\r?\n$/, "");
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new ProblemError({
        status: 400,
        title: "Bad Request",
        detail: "The webhook form is not JSON.",
      });
    }
  }
  throw new ProblemError({
    status: 400,
    title: "Bad Request",
    detail: "The webhook form has no json field.",
  });
}
