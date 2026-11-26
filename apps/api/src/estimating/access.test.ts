import { SYSTEM_ROLE_PERMISSIONS } from "@groundwork/shared";
import { describe, expect, it } from "vitest";

import { ProblemError } from "../errors.js";
import { assertDiscountAllowed, lineIsNegative, stripEstimateCosts } from "./access.js";

const estimate = {
  id: "e",
  total_cents: 100,
  cost_cents: 40,
  margin_cents: 60,
  margin_pct: "60.00",
  lines: [
    {
      description: "Asphalt",
      price_cents: 100,
      unit_cost_cents: 40,
      cost_cents: 40,
      margin_cents: 60,
      margin_pct: "60.00",
    },
  ],
};

describe("estimate cost visibility", () => {
  it("drops cost and margin fields without catalog.manage", () => {
    const hidden = stripEstimateCosts(estimate, SYSTEM_ROLE_PERMISSIONS.office);
    expect(hidden.total_cents).toBe(100);
    expect(hidden).not.toHaveProperty("cost_cents");
    expect(hidden).not.toHaveProperty("margin_cents");
    expect(hidden).not.toHaveProperty("margin_pct");
    expect(hidden.lines[0]).not.toHaveProperty("unit_cost_cents");
    expect(hidden.lines[0]).not.toHaveProperty("cost_cents");
    expect(JSON.stringify(hidden)).not.toContain("margin");
    expect(JSON.stringify(hidden)).not.toContain("cost");
  });

  it("keeps cost and margin for catalog.manage", () => {
    const shown = stripEstimateCosts(estimate, SYSTEM_ROLE_PERMISSIONS.estimator);
    expect(shown.cost_cents).toBe(40);
    expect(shown.lines[0]?.unit_cost_cents).toBe(40);
  });

  it("requires catalog.manage for a negative line", () => {
    const negative = {
      qty: "1.0000",
      unitCostCents: 0n,
      unitPriceCents: -500n,
      priceCents: -500n,
    };
    expect(lineIsNegative(negative)).toBe(true);
    expect(() => assertDiscountAllowed(SYSTEM_ROLE_PERMISSIONS.office, negative)).toThrow(
      ProblemError,
    );
    expect(() => assertDiscountAllowed(SYSTEM_ROLE_PERMISSIONS.estimator, negative)).not.toThrow();
    expect(() =>
      assertDiscountAllowed(SYSTEM_ROLE_PERMISSIONS.office, {
        qty: "1.0000",
        unitCostCents: 10n,
        unitPriceCents: 20n,
        priceCents: 20n,
      }),
    ).not.toThrow();
  });
});
