import { describe, expect, it } from "vitest";

import {
  DIRECT_FEATURE_LIMIT,
  TILE_CALL_LIMIT,
  lngLatToTile,
  renderStrategy,
  resetFeatureTileThrottle,
  takeFeatureTile,
  tileToBBox,
} from "./feature-tiles.js";

describe("measurement tile window", () => {
  it("keeps a normal takeoff on the direct editor path", () => {
    expect(renderStrategy(0)).toBe("direct");
    expect(renderStrategy(DIRECT_FEATURE_LIMIT)).toBe("direct");
    expect(renderStrategy(DIRECT_FEATURE_LIMIT + 1)).toBe("throttled");
  });

  it("bounds the tile that contains a site", () => {
    const lng = -81.702576;
    const lat = 35.748741;
    const tile = lngLatToTile(lng, lat, 16);
    const bbox = tileToBBox(16, tile.x, tile.y);
    expect(bbox).not.toBeNull();
    expect(lng).toBeGreaterThan(bbox!.west);
    expect(lng).toBeLessThan(bbox!.east);
    expect(lat).toBeGreaterThan(bbox!.south);
    expect(lat).toBeLessThan(bbox!.north);
    expect(tileToBBox(16, -1, 0)).toBeNull();
    expect(tileToBBox(3, 8, 0)).toBeNull();
  });

  it("refuses a burst of tile reads for one workspace", () => {
    resetFeatureTileThrottle();
    const now = 1_000_000;
    for (let index = 0; index < TILE_CALL_LIMIT; index += 1) {
      expect(takeFeatureTile("workspace-a", now + index)).toBe(true);
    }
    expect(takeFeatureTile("workspace-a", now + TILE_CALL_LIMIT)).toBe(false);
    expect(takeFeatureTile("workspace-b", now)).toBe(true);
    resetFeatureTileThrottle();
  });
});
