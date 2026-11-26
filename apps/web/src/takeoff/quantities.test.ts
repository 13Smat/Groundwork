import { geodesicRectangle, INTERNATIONAL_FOOT_M, type GeoJsonGeometry } from "@groundwork/geo";
import { describe, expect, it } from "vitest";

import {
  applyServer,
  geometryKey,
  liveTotal,
  measurementGeometry,
  mergeCommit,
  showsServer,
  summaryTotal,
} from "./quantities";
import type { EditorFeature, MeasurementCollection, SummaryItem } from "./types";

const SQUARE = geodesicRectangle({
  origin: [-81.7, 35.75],
  widthM: 100 * INTERNATIONAL_FOOT_M,
  heightM: 100 * INTERNATIONAL_FOOT_M,
});

function feature(overrides: Partial<EditorFeature> = {}): EditorFeature {
  return {
    id: "018f5a00-0000-7000-8000-000000000201",
    mode: "polygon",
    itemId: "018f5a00-0000-7000-8000-000000000301",
    kind: "area",
    label: null,
    source: "manual",
    geometry: SQUARE,
    hidden: false,
    server: null,
    measuredKey: null,
    ...overrides,
  };
}

describe("live quantities", () => {
  it("shows a 100 ft square in square feet and square yards", () => {
    const text = liveTotal("area", [SQUARE]);
    const feet = Number(text.split(" ")[0]);
    expect(Math.abs(feet - 10_000) / 10_000).toBeLessThanOrEqual(0.005);
    expect(text).toContain("yd²");
  });

  it("closes an open polygon ring before save", () => {
    const open = {
      type: "Polygon",
      coordinates: [
        [
          [-81.7, 35.75],
          [-81.69, 35.75],
          [-81.69, 35.76],
          [-81.7, 35.76],
        ],
      ],
    } as GeoJsonGeometry;
    const closed = measurementGeometry(open);
    expect(closed.type).toBe("Polygon");
    if (closed.type !== "Polygon") {
      return;
    }
    const ring = closed.coordinates[0];
    expect(ring?.[0]).toEqual(ring?.[ring.length - 1]);
  });

  it("keeps the server quantity until the geometry changes", () => {
    const saved = feature({
      server: {
        value_m2: "929.0304",
        value_m: "121.92",
        count: null,
        display: { ft2: "10000", yd2: "1111.1", acres: "0.230", ft: null },
      },
      measuredKey: geometryKey(SQUARE),
    });
    expect(showsServer(saved)).toBe(true);
    const moved = mergeCommit(
      [saved],
      [
        {
          id: saved.id,
          mode: "polygon",
          itemId: saved.itemId,
          kind: "area",
          label: "Pad",
          source: "manual",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-81.7, 35.75],
                [-81.69, 35.75],
                [-81.69, 35.751],
                [-81.7, 35.751],
                [-81.7, 35.75],
              ],
            ],
          } as GeoJsonGeometry,
          hidden: false,
        },
      ],
    );
    expect(moved[0]?.label).toBe("Pad");
    expect(moved[0] ? showsServer(moved[0]) : true).toBe(false);
    expect(moved[0]?.server?.display.ft2).toBe("10000");
  });

  it("keeps ai_assist when a vertex edit is committed", () => {
    const saved = feature({ source: "ai_assist" });
    const moved = mergeCommit(
      [saved],
      [
        {
          id: saved.id,
          mode: "polygon",
          itemId: saved.itemId,
          kind: "area",
          label: null,
          source: "ai_assist",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-81.7, 35.75],
                [-81.69, 35.75],
                [-81.69, 35.752],
                [-81.7, 35.751],
                [-81.7, 35.75],
              ],
            ],
          } as GeoJsonGeometry,
          hidden: false,
        },
      ],
    );
    expect(moved[0]?.source).toBe("ai_assist");
    expect(moved[0]?.geometry).not.toEqual(SQUARE);
  });

  it("drops the measure-only ruler and applies the server shape", () => {
    const merged = mergeCommit(
      [],
      [
        {
          id: "018f5a00-0000-7000-8000-000000000202",
          mode: "ruler",
          itemId: null,
          kind: null,
          label: null,
          source: "manual",
          geometry: {
            type: "LineString",
            coordinates: [
              [-81.7, 35.75],
              [-81.69, 35.75],
            ],
          },
          hidden: false,
        },
      ],
    );
    expect(merged).toEqual([]);
    const collection: MeasurementCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "018f5a00-0000-7000-8000-000000000201",
          geometry: SQUARE,
          properties: {
            takeoff_item_id: "018f5a00-0000-7000-8000-000000000301",
            kind: "area",
            value_m2: "929.0304",
            value_m: "121.92",
            count: null,
            source: "manual",
            confidence: null,
            label: "Pad",
            deductions: [],
            display: { ft2: "10000", yd2: "1111.1", acres: "0.230", ft: null },
          },
        },
      ],
      corrections: [],
      overlaps: [],
    };
    const applied = applyServer([feature()], collection);
    expect(applied.features[0]?.server?.display.ft2).toBe("10000");
    expect(applied.features[0] ? showsServer(applied.features[0]) : false).toBe(true);
    const summary: SummaryItem = {
      takeoff_item_id: "018f5a00-0000-7000-8000-000000000301",
      name: "Asphalt",
      measure_kind: "area",
      sum_m2: "929.0304",
      sum_m: null,
      union_m2: "929.0304",
      union_m: null,
      count: null,
      overlap_count: 0,
      display: {
        sum_ft2: "10000",
        sum_yd2: "1111.1",
        sum_acres: "0.230",
        union_ft2: "10000",
        union_yd2: "1111.1",
        union_acres: "0.230",
        sum_ft: null,
        union_ft: null,
      },
    };
    expect(summaryTotal(summary)).toBe("10000 ft² · 1111.1 yd²");
  });
});
