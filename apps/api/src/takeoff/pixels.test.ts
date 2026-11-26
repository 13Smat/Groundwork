import { describe, expect, it } from "vitest";

import { mapToPixel, pixelToMap, simplifyRing, type Affine } from "./pixels.js";

const NORTH_UP: Affine = [2, 0, 100, 0, -2, 50];

describe("chip pixel transform", () => {
  it("round-trips a pixel through the affine", () => {
    const [x, y] = pixelToMap(4, 7, NORTH_UP);
    expect(x).toBe(108);
    expect(y).toBe(36);
    const [col, row] = mapToPixel(x, y, NORTH_UP);
    expect(col).toBeCloseTo(4);
    expect(row).toBeCloseTo(7);
  });
});

describe("simplifyRing", () => {
  it("keeps a rectangle when the tolerance is half a pixel", () => {
    const ring = [
      [0, 0],
      [32, 0],
      [32, 32],
      [0, 32],
      [0, 0],
    ];
    expect(simplifyRing(ring, 0.5)).toEqual(ring);
  });

  it("keeps a 0.8 px sliver that the area filter still has to drop", () => {
    const ring = [
      [10, 20],
      [10.8, 20],
      [10, 20.8],
      [10, 20],
    ];
    expect(simplifyRing(ring, 0.5)).toEqual(ring);
  });

  it("drops a colinear extra point", () => {
    const ring = [
      [0, 0],
      [16, 0],
      [32, 0],
      [32, 32],
      [0, 32],
      [0, 0],
    ];
    expect(simplifyRing(ring, 0.5)).toEqual([
      [0, 0],
      [32, 0],
      [32, 32],
      [0, 32],
      [0, 0],
    ]);
  });
});
