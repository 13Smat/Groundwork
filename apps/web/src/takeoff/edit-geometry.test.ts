import { geodesicAreaM2, type GeoJsonPolygon } from "@groundwork/geo";
import { describe, expect, it } from "vitest";

import { cutHole, mergeAreas, splitLine, splitPolygon } from "./edit-geometry";

function rect(west: number, south: number, east: number, north: number): GeoJsonPolygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

describe("takeoff geometry tools", () => {
  it("deducts a hole from the live area", () => {
    const shell = rect(0, 0, 0.002, 0.002);
    const hole = rect(0.0005, 0.0005, 0.001, 0.001);
    const cut = cutHole(shell, hole);
    expect(cut?.coordinates).toHaveLength(2);
    const before = geodesicAreaM2(shell);
    const after = geodesicAreaM2(cut!);
    expect(after).toBeLessThan(before);
    expect(before - after).toBeGreaterThan(geodesicAreaM2(hole) * 0.9);
    expect(cutHole(shell, rect(-0.001, -0.001, 0.0002, 0.0002))).toBeNull();
  });

  it("splits a polygon and a line where the cutter crosses", () => {
    const area = rect(0, 0, 4, 2);
    const parts = splitPolygon(area, {
      type: "LineString",
      coordinates: [
        [2, -1],
        [2, 3],
      ],
    });
    expect(parts).not.toBeNull();
    const [left, right] = parts!;
    expect(geodesicAreaM2(left) + geodesicAreaM2(right)).toBeCloseTo(geodesicAreaM2(area), 0);
    const line = splitLine(
      {
        type: "LineString",
        coordinates: [
          [0, 0],
          [4, 0],
        ],
      },
      {
        type: "LineString",
        coordinates: [
          [2, -1],
          [2, 1],
        ],
      },
    );
    expect(line?.[0].coordinates[1]).toEqual([2, 0]);
    expect(line?.[1].coordinates[0]).toEqual([2, 0]);
  });

  it("merges areas that touch and leaves a gap alone", () => {
    const west = rect(0, 0, 2, 2);
    const east = rect(2, 0, 4, 2);
    const merged = mergeAreas(west, east);
    expect(merged?.type).toBe("Polygon");
    expect(geodesicAreaM2(merged!)).toBeCloseTo(geodesicAreaM2(west) + geodesicAreaM2(east), 0);
    expect(mergeAreas(west, rect(3, 0, 5, 2))).toBeNull();
  });
});
