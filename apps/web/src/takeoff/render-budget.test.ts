import type { GeoJsonGeometry } from "@groundwork/geo";
import { describe, expect, it } from "vitest";

import {
  DIRECT_FEATURE_LIMIT,
  massCollection,
  renderStrategy,
  simplifyPositions,
  throttleDue,
} from "./render-budget";
import type { LoadFeature } from "./types";

describe("throttled measurement rendering", () => {
  it("switches past 2,000 features and keeps a ring short", () => {
    expect(renderStrategy(DIRECT_FEATURE_LIMIT)).toBe("direct");
    expect(renderStrategy(DIRECT_FEATURE_LIMIT + 1)).toBe("throttled");
    const ring = Array.from(
      { length: 80 },
      (_, index) => [index / 100, index / 200] as [number, number],
    );
    expect(simplifyPositions(ring, 24)).toHaveLength(24);
    expect(throttleDue(1_000, 0, 100)).toBe(true);
    expect(throttleDue(50, 0, 100)).toBe(false);
  });

  it("builds a simplified overlay collection", () => {
    const geometry: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        Array.from({ length: 40 }, (_, index) => [index, index] as [number, number]).concat([
          [0, 0],
        ]),
      ],
    };
    const feature: LoadFeature = {
      id: "018f5a00-0000-7000-8000-000000000901",
      mode: "polygon",
      geometry,
      itemId: "item",
      itemColor: "#2c2c2c",
      kind: "area",
      label: null,
      source: "manual",
    };
    const collection = massCollection([feature]);
    const ring = collection.features[0]?.geometry;
    expect(ring?.type).toBe("Polygon");
    if (ring?.type === "Polygon") {
      expect(ring.coordinates[0]!.length).toBeLessThan(geometry.coordinates[0]!.length);
    }
  });
});
