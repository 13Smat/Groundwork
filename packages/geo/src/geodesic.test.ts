import { describe, expect, it } from "vitest";

import { displayFromMetric, convertMetric } from "./display.js";
import {
  geodesicAreaM2,
  geodesicLengthM,
  geodesicRectangle,
  geodesicRectangleWithHole,
  geodesicSegment,
  INTERNATIONAL_FOOT_M,
} from "./geodesic.js";

const SIDE_M = 100 * INTERNATIONAL_FOOT_M;
const HOLE_M = 20 * INTERNATIONAL_FOOT_M;
const LATITUDES = [25, 32, 35, 40, 45, 48];

function feet(m2: number): number {
  return Number(convertMetric(m2.toFixed(6), "ft2"));
}

describe("geodesic helpers", () => {
  it("measures a 100 ft square within 0.5% from 25N to 48N", () => {
    for (const latitude of LATITUDES) {
      const square = geodesicRectangle({
        origin: [-80, latitude],
        widthM: SIDE_M,
        heightM: SIDE_M,
      });
      const ft2 = feet(geodesicAreaM2(square));
      expect(Math.abs(ft2 - 10_000) / 10_000, `latitude ${latitude}`).toBeLessThanOrEqual(0.005);
    }
  });

  it("subtracts a 20 ft hole from a 100 ft square", () => {
    for (const latitude of LATITUDES) {
      const origin: [number, number] = [-80, latitude];
      const holeOrigin = geodesicSegment({
        origin:
          geodesicSegment({ origin, distanceM: 40 * INTERNATIONAL_FOOT_M, bearing: 90 })
            .coordinates[1] ?? origin,
        distanceM: 40 * INTERNATIONAL_FOOT_M,
        bearing: 0,
      }).coordinates[1];
      if (!holeOrigin) {
        throw new Error("Hole origin was missing.");
      }
      const holed = geodesicRectangleWithHole({
        origin,
        widthM: SIDE_M,
        heightM: SIDE_M,
        holeOrigin,
        holeWidthM: HOLE_M,
        holeHeightM: HOLE_M,
      });
      const ft2 = feet(geodesicAreaM2(holed));
      expect(Math.abs(ft2 - 9_600) / 9_600, `latitude ${latitude}`).toBeLessThanOrEqual(0.005);
    }
  });

  it("measures a geodesic polyline within 0.5%", () => {
    for (const latitude of LATITUDES) {
      const segment = geodesicSegment({
        origin: [-80, latitude],
        distanceM: 1_000 * INTERNATIONAL_FOOT_M,
        bearing: 90,
      });
      const meters = geodesicLengthM(segment);
      const feetLong = Number(convertMetric(meters.toFixed(6), "ft"));
      expect(Math.abs(feetLong - 1_000) / 1_000, `latitude ${latitude}`).toBeLessThanOrEqual(0.005);
    }
  });
});

describe("display rounding", () => {
  it("turns 10,000 square feet of metric area into the display steps", () => {
    const m2 = "929.0304";
    expect(displayFromMetric(m2, "ft2")).toBe("10000");
    expect(displayFromMetric(m2, "yd2")).toBe("1111.1");
    expect(displayFromMetric(m2, "acre")).toBe("0.230");
  });

  it("rounds a length to the nearest foot", () => {
    expect(displayFromMetric("30.48", "ft")).toBe("100");
    expect(displayFromMetric("30.6324", "ft")).toBe("101");
  });

  it("rounds half up at the display step", () => {
    expect(displayFromMetric("0.04645152", "ft2")).toBe("1");
  });

  it("keeps the conversion finer than the display step", () => {
    expect(convertMetric("929.0304", "ft2")).toBe("10000.00000000");
  });

  it("refuses a negative quantity", () => {
    expect(() => displayFromMetric("-1", "ft")).toThrow(RangeError);
  });
});
