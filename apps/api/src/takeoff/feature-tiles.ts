/** A measurement window above this count uses the simplified overlay. */
export const DIRECT_FEATURE_LIMIT = 2_000;

/** Features returned for one Web Mercator tile. */
export const TILE_FEATURE_LIMIT = 500;

/** Tile reads allowed per workspace in {@link TILE_WINDOW_MS}. */
export const TILE_CALL_LIMIT = 30;
export const TILE_WINDOW_MS = 10_000;

export type TileBBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

const buckets = new Map<string, number[]>();

export function renderStrategy(count: number): "direct" | "throttled" {
  return count > DIRECT_FEATURE_LIMIT ? "throttled" : "direct";
}

export function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {
    x: Math.min(n - 1, Math.max(0, x)),
    y: Math.min(n - 1, Math.max(0, y)),
  };
}

function mercatorLat(y: number): number {
  return (Math.atan(Math.sinh(y)) * 180) / Math.PI;
}

/** Web Mercator tile bounds in EPSG:4326. Null when the indices are outside the world. */
export function tileToBBox(z: number, x: number, y: number): TileBBox | null {
  if (!Number.isInteger(z) || z < 0 || z > 22) {
    return null;
  }
  const n = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) {
    return null;
  }
  return {
    west: (x / n) * 360 - 180,
    east: ((x + 1) / n) * 360 - 180,
    north: mercatorLat(Math.PI * (1 - (2 * y) / n)),
    south: mercatorLat(Math.PI * (1 - (2 * (y + 1)) / n)),
  };
}

/**
 * Per-process token bucket. A second API process has its own bucket.
 * Returns false when the workspace is over the limit.
 */
export function takeFeatureTile(workspaceId: string, now = Date.now()): boolean {
  const recent = (buckets.get(workspaceId) ?? []).filter((stamp) => now - stamp < TILE_WINDOW_MS);
  if (recent.length >= TILE_CALL_LIMIT) {
    buckets.set(workspaceId, recent);
    return false;
  }
  recent.push(now);
  buckets.set(workspaceId, recent);
  return true;
}

export function resetFeatureTileThrottle(): void {
  buckets.clear();
}
