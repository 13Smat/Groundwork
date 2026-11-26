import type { GeoJsonGeometry, LngLat } from "@groundwork/geo";

/**
 * Interior overlap of two polygons. A shared edge is not an overlap, matching
 * the 0.01 m² cut the API uses when it flags measurements. This is the live
 * warning only. Accepting a draft does not cut the manual shape.
 */
export function polygonOverlaps(left: GeoJsonGeometry, right: GeoJsonGeometry): boolean {
  const leftRings = exteriors(left);
  const rightRings = exteriors(right);
  for (const leftRing of leftRings) {
    for (const rightRing of rightRings) {
      if (ringsOverlap(leftRing, rightRing)) {
        return true;
      }
    }
  }
  return false;
}

function exteriors(geometry: GeoJsonGeometry): LngLat[][] {
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates[0];
    return ring ? [ring] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((polygon) => {
      const ring = polygon[0];
      return ring ? [ring] : [];
    });
  }
  return [];
}

function ringsOverlap(left: readonly LngLat[], right: readonly LngLat[]): boolean {
  for (const point of left) {
    if (strictlyInside(point, right)) {
      return true;
    }
  }
  for (const point of right) {
    if (strictlyInside(point, left)) {
      return true;
    }
  }
  const leftEdges = edges(left);
  const rightEdges = edges(right);
  for (const leftEdge of leftEdges) {
    for (const rightEdge of rightEdges) {
      if (properlyIntersect(leftEdge[0], leftEdge[1], rightEdge[0], rightEdge[1])) {
        return true;
      }
    }
  }
  return false;
}

function edges(ring: readonly LngLat[]): [LngLat, LngLat][] {
  const pairs: [LngLat, LngLat][] = [];
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];
    if (start && end) {
      pairs.push([start, end]);
    }
  }
  return pairs;
}

function cross(origin: LngLat, left: LngLat, right: LngLat): number {
  return (
    (left[0] - origin[0]) * (right[1] - origin[1]) - (left[1] - origin[1]) * (right[0] - origin[0])
  );
}

function properlyIntersect(p1: LngLat, p2: LngLat, q1: LngLat, q2: LngLat): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function strictlyInside(point: LngLat, ring: readonly LngLat[]): boolean {
  if (onBoundary(point, ring)) {
    return false;
  }
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const current = ring[index];
    const prior = ring[previous];
    if (!current || !prior) {
      continue;
    }
    const crosses = current[1] > point[1] !== prior[1] > point[1];
    if (!crosses) {
      continue;
    }
    const x =
      ((prior[0] - current[0]) * (point[1] - current[1])) / (prior[1] - current[1]) + current[0];
    if (point[0] < x) {
      inside = !inside;
    }
  }
  return inside;
}

function onBoundary(point: LngLat, ring: readonly LngLat[]): boolean {
  for (const [start, end] of edges(ring)) {
    const area = cross(start, end, point);
    const span = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]), 1e-12);
    if (Math.abs(area) > span * 1e-10) {
      continue;
    }
    const withinLng =
      point[0] >= Math.min(start[0], end[0]) - 1e-12 &&
      point[0] <= Math.max(start[0], end[0]) + 1e-12;
    const withinLat =
      point[1] >= Math.min(start[1], end[1]) - 1e-12 &&
      point[1] <= Math.max(start[1], end[1]) + 1e-12;
    if (withinLng && withinLat) {
      return true;
    }
  }
  return false;
}
