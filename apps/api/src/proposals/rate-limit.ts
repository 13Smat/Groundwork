/** Public and webhook calls allowed per key in {@link PUBLIC_WINDOW_MS}. */
export const PUBLIC_WINDOW_MS = 10_000;
const DEFAULT_LIMIT = 30;

const buckets = new Map<string, number[]>();
let limit = DEFAULT_LIMIT;

/**
 * Per-process window. A second API process has its own buckets.
 * Returns false when the key is over the limit.
 */
export function takePublicCall(key: string, now = Date.now()): boolean {
  const recent = (buckets.get(key) ?? []).filter((stamp) => now - stamp < PUBLIC_WINDOW_MS);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

/** Tests tighten the window. Production uses the default. */
export function setPublicRateLimit(next: number): void {
  limit = next;
}

export function resetPublicRateLimit(): void {
  buckets.clear();
  limit = DEFAULT_LIMIT;
}
