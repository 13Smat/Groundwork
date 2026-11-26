import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { LOCAL_ESIGN_WEBHOOK_SECRET, readEsignWebhookSecret } from "../config.js";
import { FakeEsignProvider, createEsignProvider, signFakeBody } from "./esign.js";
import { resetPublicRateLimit, setPublicRateLimit, takePublicCall } from "./rate-limit.js";
import { hashPublicToken, hashPublicTokenForLookup, timingSafeEqualHex } from "./token.js";

const env = { ...process.env };

afterEach(() => {
  process.env = { ...env };
  resetPublicRateLimit();
});

describe("esign fakes", () => {
  it("hashes a public token before lookup, including a short or oversized value", () => {
    const issued = "a".repeat(43);
    expect(hashPublicTokenForLookup(issued)).toBe(hashPublicToken(issued));
    expect(hashPublicTokenForLookup("short")).toBe(hashPublicToken("short"));
    expect(hashPublicTokenForLookup("z".repeat(500))).toBe(hashPublicToken("z".repeat(200)));
    expect(hashPublicTokenForLookup("short")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("compares hex digests and still hashes when the lengths differ", () => {
    expect(timingSafeEqualHex("aa", "aa")).toBe(true);
    expect(timingSafeEqualHex("aa", "ab")).toBe(false);
    expect(timingSafeEqualHex("aa", "aaaa")).toBe(false);
  });

  it("rejects a fake webhook whose signature does not match the body", () => {
    const provider = new FakeEsignProvider("test-secret");
    const rawBody = Buffer.from('{"event_id":"one"}');
    expect(
      provider.verifyWebhook({
        rawBody,
        headers: { "x-esign-signature": signFakeBody("test-secret", rawBody) },
        parsed: {},
      }).valid,
    ).toBe(true);
    const wrong = provider.verifyWebhook({
      rawBody,
      headers: { "x-esign-signature": signFakeBody("other", rawBody) },
      parsed: {},
    });
    expect(wrong).toEqual({ valid: false });
  });

  it("uses the fake provider unless a Dropbox Sign key is set, and does not call the network", () => {
    delete process.env.DROPBOX_SIGN_API_KEY;
    expect(createEsignProvider().name).toBe("fake");
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.reject(new Error("network"));
    }) as typeof fetch;
    try {
      process.env.DROPBOX_SIGN_API_KEY = "test-dropbox-sign-key";
      expect(createEsignProvider().name).toBe("dropbox_sign");
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("refuses the local webhook secret in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.ESIGN_WEBHOOK_SECRET;
    expect(() => readEsignWebhookSecret()).toThrow(/ESIGN_WEBHOOK_SECRET is required/);
    process.env.ESIGN_WEBHOOK_SECRET = LOCAL_ESIGN_WEBHOOK_SECRET;
    expect(() => readEsignWebhookSecret()).toThrow(/must not be the local default/);
  });

  it("limits a public key to the configured number of calls", () => {
    setPublicRateLimit(2);
    expect(takePublicCall("public:test", 1_000)).toBe(true);
    expect(takePublicCall("public:test", 1_001)).toBe(true);
    expect(takePublicCall("public:test", 1_002)).toBe(false);
    expect(takePublicCall("public:other", 1_002)).toBe(true);
  });

  it("signs the fake body with hex hmac", () => {
    const body = Buffer.from("payload");
    expect(signFakeBody("secret", body)).toBe(
      createHmac("sha256", "secret").update(body).digest("hex"),
    );
  });
});
