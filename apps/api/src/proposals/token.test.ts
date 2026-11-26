import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { isPublicTokenHash, newPublicTokenHash } from "./token.js";

describe("proposal public token", () => {
  it("stores a sha256 hex digest and not a recoverable token", () => {
    const hash = newPublicTokenHash();
    expect(isPublicTokenHash(hash)).toBe(true);
    expect(hash).toHaveLength(64);
    expect(createHash("sha256").update(hash).digest("hex")).not.toBe(hash);
    expect(newPublicTokenHash()).not.toBe(hash);
  });
});
