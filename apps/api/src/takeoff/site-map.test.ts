import { geodesicRectangle, INTERNATIONAL_FOOT_M } from "@groundwork/geo";
import { describe, expect, it } from "vitest";

import { countInk, paintSiteMap, renderSiteMap } from "./site-map.js";

const STAMP = {
  provider: "nc_helene_2025",
  name: "nc_helene_2025",
  captureDate: "2025-04-15",
  gsdCm: "15.24",
  attribution: "NC Collaboratory at UNC Chapel Hill",
};

describe("site map png", () => {
  it("draws measurement ink and stamps the capture in the file", () => {
    const square = geodesicRectangle({
      origin: [-81.703, 35.748],
      widthM: 30 * INTERNATIONAL_FOOT_M,
      heightM: 20 * INTERNATIONAL_FOOT_M,
    });
    const image = paintSiteMap([{ kind: "area", geometry: square }], STAMP);
    expect(countInk(image)).toBeGreaterThan(100);
    const png = renderSiteMap([{ kind: "area", geometry: square }], STAMP);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const text = png.toString("latin1");
    expect(text).toContain("NC Collaboratory at UNC Chapel Hill");
    expect(text).toContain("2025-04-15");
    expect(text).toContain("15.24");
    expect(text).toContain("nc_helene_2025");
    expect(png.length).toBeGreaterThan(500);
  });
});
