import { describe, expect, it } from "vitest";

import { applyCostVisibility, CATALOG_VISIBILITY_SAMPLE } from "./cost.js";
import { SYSTEM_ROLE_PERMISSIONS } from "./permissions.js";

describe("cost visibility", () => {
  it("keeps unit cost for catalog.manage and omits the key otherwise", () => {
    const visible = applyCostVisibility(
      { ...CATALOG_VISIBILITY_SAMPLE },
      SYSTEM_ROLE_PERMISSIONS.estimator,
    );
    const hidden = applyCostVisibility(
      { ...CATALOG_VISIBILITY_SAMPLE },
      SYSTEM_ROLE_PERMISSIONS.office,
    );

    expect(visible.unit_cost_cents).toBe(9200);
    expect(visible.unit_price_cents).toBe(18500);
    expect(hidden).not.toHaveProperty("unit_cost_cents");
    expect(hidden.unit_price_cents).toBe(18500);
    expect(hidden.name).toBe("Sample asphalt");
  });
});
