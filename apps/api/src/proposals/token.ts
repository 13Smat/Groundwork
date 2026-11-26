import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** SHA-256 hex of a random token. The raw bytes are not returned or stored. */
export function newPublicTokenHash(): string {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

/** Raw token returned once, plus the hash that is stored. */
export function issuePublicToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashPublicToken(token) };
}

export function hashPublicToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issued tokens are 43 characters. A longer value is hashed from a prefix so
 * one huge URL cannot skip the lookup or dominate the digest. The stored
 * hash is still the SHA-256 of the token that was issued.
 */
export const PUBLIC_TOKEN_HASH_INPUT_MAX = 200;

export function hashPublicTokenForLookup(token: string): string {
  const material =
    token.length > PUBLIC_TOKEN_HASH_INPUT_MAX
      ? token.slice(0, PUBLIC_TOKEN_HASH_INPUT_MAX)
      : token;
  return hashPublicToken(material);
}

export function isPublicTokenHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * Compare two hex digests in constant time. A length mismatch still runs a
 * compare so the caller does not return before the hash work.
 */
export function timingSafeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return timingSafeEqual(a, b);
}
