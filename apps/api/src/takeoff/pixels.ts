/** Affine coefficients: x = a*col + b*row + c, y = d*col + e*row + f. */
export type Affine = [number, number, number, number, number, number];

export function pixelToMap(col: number, row: number, transform: Affine): [number, number] {
  const [a, b, c, d, e, f] = transform;
  return [a * col + b * row + c, d * col + e * row + f];
}

export function mapToPixel(x: number, y: number, transform: Affine): [number, number] {
  const [a, b, c, d, e, f] = transform;
  const det = a * e - b * d;
  if (!Number.isFinite(det) || det === 0) {
    throw new Error("Chip transform is not invertible.");
  }
  const dx = x - c;
  const dy = y - f;
  return [(e * dx - b * dy) / det, (-d * dx + a * dy) / det];
}

function perpendicularDistance(point: number[], start: number[], end: number[]): number {
  const dx = end[0]! - start[0]!;
  const dy = end[1]! - start[1]!;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return Math.hypot(point[0]! - start[0]!, point[1]! - start[1]!);
  }
  return (
    Math.abs(dy * point[0]! - dx * point[1]! + end[0]! * start[1]! - end[1]! * start[0]!) / length
  );
}

/**
 * Douglas-Peucker. Tolerance is in the same units as the ring (pixels here).
 * A closed ring stays closed. Fewer than three corners collapses to nothing.
 */
export function simplifyRing(ring: number[][], tolerance: number): number[][] {
  if (ring.length < 4) {
    return [];
  }
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  const closed = first[0] === last[0] && first[1] === last[1];
  const open = closed ? ring.slice(0, -1) : ring.slice();
  if (open.length < 3) {
    return [];
  }
  const simplified = tolerance > 0 ? douglasPeucker(open, tolerance) : open;
  if (simplified.length < 3) {
    return [];
  }
  const start = simplified[0]!;
  return [...simplified, [start[0]!, start[1]!]];
}

function douglasPeucker(points: number[][], tolerance: number): number[][] {
  if (points.length < 3) {
    return points.map((point) => [point[0]!, point[1]!]);
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i]!, first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance > tolerance && index > 0) {
    const left = douglasPeucker(points.slice(0, index + 1), tolerance);
    const right = douglasPeucker(points.slice(index), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [
    [first[0]!, first[1]!],
    [last[0]!, last[1]!],
  ];
}

export function polygonWkt(ring: [number, number][]): string {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) {
    throw new Error("A polygon ring needs points.");
  }
  const closed =
    first[0] === last[0] && first[1] === last[1]
      ? ring
      : [...ring, [first[0], first[1]] as [number, number]];
  const body = closed.map(([x, y]) => `${x.toFixed(4)} ${y.toFixed(4)}`).join(", ");
  return `POLYGON((${body}))`;
}
