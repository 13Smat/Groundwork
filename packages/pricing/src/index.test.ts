import { describe, expect, it } from "vitest";

import { pricingPackageName } from "./index.js";

describe("pricing package", () => {
  it("identifies itself until cost recipes land", () => {
    expect(pricingPackageName()).toBe("@groundwork/pricing");
  });
});
