import { createId } from "@groundwork/shared";
import { describe, expect, it } from "vitest";

import { DropboxSignProvider, dropboxEventHash } from "./esign.js";

const KEY = "test-dropbox-sign-key";
const EVENT_TIME = "1700000000";
const EVENT_TYPE = "signature_request_all_signed";

describe("Dropbox Sign adapter", () => {
  it("hashes event_time and event_type with the API key", () => {
    expect(dropboxEventHash(KEY, EVENT_TIME, EVENT_TYPE)).toBe(
      "378083ffd9397afc04a428db2371e69b541e76bf5934788497e4712705f80b59",
    );
  });

  it("sends a test-mode envelope through the injected fetch and never uses the network", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = new DropboxSignProvider({
      apiKey: KEY,
      live: false,
      fetch: (url, init) => {
        calls.push({ url, init });
        return Promise.resolve(
          new Response(
            JSON.stringify({ signature_request: { signature_request_id: "req_recorded" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    });
    const sent = await provider.send({
      proposalId: createId(),
      workspaceId: createId(),
      title: "Proposal P-1001",
      message: "Please sign",
      signers: [{ name: "Ada", email: "ada@example.com" }],
      pdf: Buffer.from("%PDF-1.4\n"),
      expiresAt: null,
    });
    expect(sent.envelopeId).toBe("req_recorded");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.hellosign.com/v3/signature_request/send");
    expect(calls[0]?.init.redirect).toBe("error");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from(`${KEY}:`).toString("base64")}`);
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
  });

  it("accepts the recorded event hash and rejects a different one", () => {
    const workspaceId = createId();
    const proposalId = createId();
    const hash = dropboxEventHash(KEY, EVENT_TIME, EVENT_TYPE);
    const parsed = {
      event: {
        event_time: EVENT_TIME,
        event_type: EVENT_TYPE,
        event_hash: hash,
      },
      signature_request: {
        signature_request_id: "req_recorded",
        metadata: { workspace_id: workspaceId, proposal_id: proposalId },
        signatures: [
          {
            signature_id: "sig_1",
            signer_name: "Ada",
            signer_email_address: "ada@example.com",
            status_code: "signed",
          },
        ],
      },
    };
    const provider = new DropboxSignProvider({ apiKey: KEY, live: false });
    const accepted = provider.verifyWebhook({
      rawBody: Buffer.from("not-part-of-the-hash"),
      headers: {},
      parsed,
    });
    expect(accepted.valid).toBe(true);
    if (accepted.valid) {
      expect(accepted.event?.type).toBe("all_signed");
      expect(accepted.event?.proposalId).toBe(proposalId);
    }
    const rejected = provider.verifyWebhook({
      rawBody: Buffer.from("not-part-of-the-hash"),
      headers: {},
      parsed: { ...parsed, event: { ...parsed.event, event_hash: "00" } },
    });
    expect(rejected).toEqual({ valid: false });
  });
});
