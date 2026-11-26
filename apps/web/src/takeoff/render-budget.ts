import type { GeoJsonGeometry, LngLat } from "@groundwork/geo";

import type { LoadFeature } from "./types";

/** Terra Draw stays on the direct path through this many features. */
export const DIRECT_FEATURE_LIMIT = 2_000;

export function renderStrategy(count: number): "direct" | "throttled" {
  return count > DIRECT_FEATURE_LIMIT ? "throttled" : "direct";
}

export function simplifyPositions(positions: readonly LngLat[], max: number): LngLat[] {
  if (positions.length <= max || max < 2) {
    return positions.map((position) => [position[0], position[1]]);
  }
  const last = positions.length - 1;
  const kept: LngLat[] = [];
  for (let index = 0; index < max - 1; index += 1) {
    const source = Math.round((index * last) / (max - 1));
    const position = positions[source];
    if (position) {
      kept.push([position[0], position[1]]);
    }
  }
  const end = positions[last];
  if (end) {
    kept.push([end[0], end[1]]);
  }
  return kept;
}

function simplifyRing(ring: readonly LngLat[]): LngLat[] {
  const simplified = simplifyPositions(ring, 24);
  const first = simplified[0];
  const last = simplified[simplified.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    simplified.push([first[0], first[1]]);
  }
  return simplified;
}

export function simplifyGeometry(geometry: GeoJsonGeometry): GeoJsonGeometry {
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates.map(simplifyRing) };
  }
  if (geometry.type === "LineString") {
    return { type: "LineString", coordinates: simplifyPositions(geometry.coordinates, 24) };
  }
  return geometry;
}

export type MassCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id: string;
    properties: { color: string };
    geometry: GeoJsonGeometry;
  }[];
};

/** Simplified overlay used when a takeoff is past the direct editor limit. */
export function massCollection(features: readonly LoadFeature[]): MassCollection {
  return {
    type: "FeatureCollection",
    features: features.map((feature) => ({
      type: "Feature",
      id: feature.id,
      properties: { color: feature.itemColor },
      geometry: simplifyGeometry(feature.geometry),
    })),
  };
}

export function throttleDue(now: number, last: number, waitMs: number): boolean {
  return now - last >= waitMs;
}
