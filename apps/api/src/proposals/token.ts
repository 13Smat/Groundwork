import { createHash, randomBytes } from "node:crypto";

/** SHA-256 hex of a random token. The raw bytes are not returned or stored. */
export function newPublicTokenHash(): string {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

export function isPublicTokenHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
