import { describe, expect, it } from "vitest";

import { geoPackageName } from "./index.js";

describe("geo package", () => {
  it("identifies itself until geodesic helpers land", () => {
    expect(geoPackageName()).toBe("@groundwork/geo");
  });
});
