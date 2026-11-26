import type { GeoJsonGeometry, GeoJsonLineString, GeoJsonPolygon, LngLat } from "@groundwork/geo";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { featureCollection, point, polygon } from "@turf/helpers";
import { lineIntersect } from "@turf/line-intersect";
import { union } from "@turf/union";

type Hit = {
  point: LngLat;
  edge: number;
  frac: number;
  cutIndex: number;
  cutFrac: number;
};

function signedArea(ring: readonly LngLat[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];
    if (!start || !end) {
      continue;
    }
    sum += start[0] * end[1] - end[0] * start[1];
  }
  return sum / 2;
}

function sameSign(left: number, right: number): boolean {
  return left === 0 || right === 0 ? false : Math.sign(left) === Math.sign(right);
}

function segmentHit(
  start: LngLat,
  end: LngLat,
  cutStart: LngLat,
  cutEnd: LngLat,
): { point: LngLat; frac: number; cutFrac: number } | null {
  const rx = end[0] - start[0];
  const ry = end[1] - start[1];
  const sx = cutEnd[0] - cutStart[0];
  const sy = cutEnd[1] - cutStart[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-14) {
    return null;
  }
  const qx = cutStart[0] - start[0];
  const qy = cutStart[1] - start[1];
  const frac = (qx * sy - qy * sx) / denom;
  const cutFrac = (qx * ry - qy * rx) / denom;
  const eps = 1e-9;
  if (frac < -eps || frac > 1 + eps || cutFrac < -eps || cutFrac > 1 + eps) {
    return null;
  }
  return {
    point: [start[0] + frac * rx, start[1] + frac * ry],
    frac: Math.min(1, Math.max(0, frac)),
    cutFrac: Math.min(1, Math.max(0, cutFrac)),
  };
}

function openRing(ring: readonly LngLat[]): LngLat[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    return ring.slice(0, -1);
  }
  return [...ring];
}

function closeRing(points: LngLat[]): LngLat[] | null {
  if (points.length < 3) {
    return null;
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return null;
  }
  const closing: LngLat = [first[0], first[1]];
  const closed = first[0] === last[0] && first[1] === last[1] ? points : [...points, closing];
  return closed.length >= 4 ? closed : null;
}

function dedupe(hits: Hit[]): Hit[] {
  const kept: Hit[] = [];
  for (const hit of hits) {
    const seen = kept.some(
      (item) => Math.hypot(item.point[0] - hit.point[0], item.point[1] - hit.point[1]) < 1e-8,
    );
    if (!seen) {
      kept.push(hit);
    }
  }
  return kept;
}

function forward(vertices: readonly LngLat[], from: Hit, to: Hit): LngLat[] {
  const count = vertices.length;
  const chain: LngLat[] = [from.point];
  if (from.edge === to.edge && from.frac <= to.frac) {
    chain.push(to.point);
    return chain;
  }
  let index = (from.edge + 1) % count;
  for (let step = 0; step <= count; step += 1) {
    const vertex = vertices[index];
    if (!vertex) {
      break;
    }
    chain.push(vertex);
    if (index === to.edge) {
      break;
    }
    index = (index + 1) % count;
  }
  chain.push(to.point);
  return chain;
}

function along(cutter: readonly LngLat[], from: Hit, to: Hit): LngLat[] {
  const chain: LngLat[] = [from.point];
  for (let index = from.cutIndex + 1; index <= to.cutIndex; index += 1) {
    const vertex = cutter[index];
    if (vertex) {
      chain.push(vertex);
    }
  }
  chain.push(to.point);
  return chain;
}

function cutKey(hit: Hit): number {
  return hit.cutIndex + hit.cutFrac;
}

function between(cutter: readonly LngLat[], left: Hit, right: Hit): LngLat[] {
  const [from, to] = cutKey(left) <= cutKey(right) ? [left, right] : [right, left];
  return along(cutter, from, to);
}

function appendBridge(chain: LngLat[], bridge: LngLat[]): LngLat[] {
  const end = chain[chain.length - 1];
  const start = bridge[0];
  if (!end || !start) {
    return chain;
  }
  const matches = Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-8;
  const ordered = matches ? bridge : [...bridge].reverse();
  return [...chain, ...ordered.slice(1)];
}

function asPolygon(coordinates: LngLat[][]): GeoJsonPolygon | null {
  const ring = coordinates[0];
  if (!ring) {
    return null;
  }
  return { type: "Polygon", coordinates };
}

/**
 * Cut an interior ring out of an area. The hole has to sit inside the shell
 * and must not cross the outline. Live area uses the rings Turf already subtracts.
 */
export function cutHole(shell: GeoJsonPolygon, hole: GeoJsonPolygon): GeoJsonPolygon | null {
  const shellRing = shell.coordinates[0];
  const holeRing = hole.coordinates[0];
  if (!shellRing || !holeRing || holeRing.length < 4 || shellRing.length < 4) {
    return null;
  }
  const shellFeature = polygon(shell.coordinates);
  const holeFeature = polygon([holeRing]);
  if (lineIntersect(shellFeature, holeFeature).features.length > 0) {
    return null;
  }
  const inside = holeRing
    .slice(0, -1)
    .every((coord: LngLat) => booleanPointInPolygon(point(coord), shellFeature));
  if (!inside) {
    return null;
  }
  const coversShell = shellRing
    .slice(0, -1)
    .some((coord: LngLat) =>
      booleanPointInPolygon(point(coord), holeFeature, { ignoreBoundary: true }),
    );
  if (coversShell) {
    return null;
  }
  for (const existing of shell.coordinates.slice(1)) {
    const existingFeature = polygon([existing]);
    const overlaps = holeRing
      .slice(0, -1)
      .some((coord: LngLat) => booleanPointInPolygon(point(coord), existingFeature));
    if (overlaps) {
      return null;
    }
  }
  const ring = sameSign(signedArea(shellRing), signedArea(holeRing))
    ? [...holeRing].reverse()
    : holeRing;
  return { type: "Polygon", coordinates: [...shell.coordinates, ring] };
}

export function holeTarget<T extends { id: string; kind: string; geometry: GeoJsonGeometry }>(
  features: readonly T[],
  selectedId: string | null,
  hole: GeoJsonPolygon,
): T | null {
  const areas = features.filter(
    (feature) => feature.kind === "area" && feature.geometry.type === "Polygon",
  );
  const selected = areas.find((feature) => feature.id === selectedId);
  if (selected && selected.geometry.type === "Polygon" && cutHole(selected.geometry, hole)) {
    return selected;
  }
  return (
    areas.find(
      (feature) => feature.geometry.type === "Polygon" && cutHole(feature.geometry, hole),
    ) ?? null
  );
}

export function splitPolygon(
  area: GeoJsonPolygon,
  cutter: GeoJsonLineString,
): [GeoJsonPolygon, GeoJsonPolygon] | null {
  if (area.coordinates.length !== 1) {
    return null;
  }
  const ring = area.coordinates[0];
  if (!ring) {
    return null;
  }
  const vertices = openRing(ring);
  const hits: Hit[] = [];
  for (let edge = 0; edge < vertices.length; edge += 1) {
    const start = vertices[edge];
    const end = vertices[(edge + 1) % vertices.length];
    if (!start || !end) {
      continue;
    }
    for (let cutIndex = 0; cutIndex < cutter.coordinates.length - 1; cutIndex += 1) {
      const cutStart = cutter.coordinates[cutIndex];
      const cutEnd = cutter.coordinates[cutIndex + 1];
      if (!cutStart || !cutEnd) {
        continue;
      }
      const hit = segmentHit(start, end, cutStart, cutEnd);
      if (!hit) {
        continue;
      }
      hits.push({
        point: hit.point,
        edge,
        frac: hit.frac,
        cutIndex,
        cutFrac: hit.cutFrac,
      });
    }
  }
  const unique = dedupe(hits).sort(
    (left, right) => left.edge + left.frac - (right.edge + right.frac),
  );
  if (unique.length !== 2) {
    return null;
  }
  const first = unique[0];
  const second = unique[1];
  if (!first || !second) {
    return null;
  }
  const left = closeRing(
    appendBridge(forward(vertices, first, second), between(cutter.coordinates, second, first)),
  );
  const right = closeRing(
    appendBridge(forward(vertices, second, first), between(cutter.coordinates, first, second)),
  );
  if (!left || !right) {
    return null;
  }
  const leftPolygon = asPolygon([left]);
  const rightPolygon = asPolygon([right]);
  if (!leftPolygon || !rightPolygon) {
    return null;
  }
  return [leftPolygon, rightPolygon];
}

export function splitLine(
  line: GeoJsonLineString,
  cutter: GeoJsonLineString,
): [GeoJsonLineString, GeoJsonLineString] | null {
  for (let index = 0; index < line.coordinates.length - 1; index += 1) {
    const start = line.coordinates[index];
    const end = line.coordinates[index + 1];
    if (!start || !end) {
      continue;
    }
    for (let cutIndex = 0; cutIndex < cutter.coordinates.length - 1; cutIndex += 1) {
      const cutStart = cutter.coordinates[cutIndex];
      const cutEnd = cutter.coordinates[cutIndex + 1];
      if (!cutStart || !cutEnd) {
        continue;
      }
      const hit = segmentHit(start, end, cutStart, cutEnd);
      if (!hit || hit.frac <= 1e-8 || hit.frac >= 1 - 1e-8) {
        continue;
      }
      const left = [...line.coordinates.slice(0, index + 1), hit.point];
      const right = [hit.point, ...line.coordinates.slice(index + 1)];
      if (left.length < 2 || right.length < 2) {
        return null;
      }
      return [
        { type: "LineString", coordinates: left },
        { type: "LineString", coordinates: right },
      ];
    }
  }
  return null;
}

export function splitMeasurement(
  geometry: GeoJsonGeometry,
  cutter: GeoJsonGeometry,
): [GeoJsonGeometry, GeoJsonGeometry] | null {
  if (cutter.type !== "LineString") {
    return null;
  }
  if (geometry.type === "Polygon") {
    return splitPolygon(geometry, cutter);
  }
  if (geometry.type === "LineString") {
    return splitLine(geometry, cutter);
  }
  return null;
}

/** One polygon when the areas touch. Separate areas stay separate. */
export function mergeAreas(left: GeoJsonPolygon, right: GeoJsonPolygon): GeoJsonPolygon | null {
  const result = union(featureCollection([polygon(left.coordinates), polygon(right.coordinates)]));
  if (!result) {
    return null;
  }
  if (result.geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: result.geometry.coordinates as LngLat[][] };
  }
  if (result.geometry.type === "MultiPolygon" && result.geometry.coordinates.length === 1) {
    const only = result.geometry.coordinates[0];
    return only ? { type: "Polygon", coordinates: only as LngLat[][] } : null;
  }
  return null;
}
