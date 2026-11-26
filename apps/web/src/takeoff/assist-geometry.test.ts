import { geodesicRectangle } from "@groundwork/geo";
import { describe, expect, it } from "vitest";

import { polygonOverlaps } from "./assist-geometry";

describe("draft overlap warning", () => {
  it("flags polygons that cover each other and ignores a shared edge", () => {
    const manual = geodesicRectangle({
      origin: [-81.7, 35.75],
      widthM: 20,
      heightM: 20,
    });
    const overlapping = geodesicRectangle({
      origin: [-81.7, 35.75],
      widthM: 10,
      heightM: 10,
    });
    const east = manual.coordinates[0]?.[1];
    if (!east) {
      throw new Error("The rectangle has no eastern corner.");
    }
    const adjacent = geodesicRectangle({
      origin: east,
      widthM: 20,
      heightM: 20,
    });
    expect(polygonOverlaps(overlapping, manual)).toBe(true);
    expect(polygonOverlaps(manual, overlapping)).toBe(true);
    expect(polygonOverlaps(adjacent, manual)).toBe(false);
  });
});
