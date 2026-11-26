import { describe, expect, it } from "vitest";

import {
  convertQuantity,
  linesFromGroups,
  marginPct,
  priceFromCost,
  priceRecipeComponent,
  summarizeLines,
  takeoffQuantityForRecipe,
  type TakeoffGroupSource,
} from "./estimate.js";

const ASPHALT = "area_ft2 * (depth_in/12) * density / 2000 * (1+waste)";
const TACK = "area_yd2 * tack_rate";
const VARIABLES = { depth_in: "2", density: "145", waste: "0.05", tack_rate: "0.1" };
const RATES = { overheadPct: "10", markupPct: "20", taxRate: "0.07" };

/**
 * 180 yd² is 150.5029248 m² (180 * 0.9144²).
 * Asphalt qty = 1620 * (2/12) * 145 / 2000 * 1.05 = 20.55375 tons.
 * 20.55375 * 9200 = 189094.5 -> half-even 189094.
 * Tack qty = 180 * 0.1 = 18 gal. 18 * 450 = 8100.
 * Price factor = 1.10 * 1.20 = 1.32.
 * 189094 * 1.32 = 249604.08 -> 249604. 8100 * 1.32 = 10692.
 * Tax 7% on materials: 249604 * 0.07 = 17472.28 -> 17472.
 * 10692 * 0.07 = 748.44 -> 748.
 */
const GROUP: TakeoffGroupSource = {
  takeoffItemId: "item",
  name: "Asphalt surface",
  defaultUnit: "yd2",
  measureKind: "area",
  canonicalQty: "150.5029248",
  measurementIds: ["m1"],
  recipes: [
    {
      id: "recipe",
      version: 1,
      inputUnit: "yd2",
      variables: VARIABLES,
      components: [
        {
          id: "tons",
          catalogItemId: "asphalt",
          name: "Asphalt",
          unit: "ton",
          unitCostCents: 9200,
          formula: ASPHALT,
          taxCode: null,
          kind: "material",
        },
        {
          id: "tack",
          catalogItemId: "tack",
          name: "Tack",
          unit: "gal",
          unitCostCents: 450,
          formula: TACK,
          taxCode: "materials",
          kind: "material",
        },
      ],
    },
  ],
};

describe("estimate pricing", () => {
  it("converts 150.5029248 m² to 180 yd²", () => {
    expect(takeoffQuantityForRecipe("area", "150.5029248", "yd2")).toBe("180");
  });

  it("matches the hand-computed asphalt fixture to the cent", () => {
    const lines = linesFromGroups([GROUP], RATES);
    expect(lines.map((line) => line.qty)).toEqual(["20.55375", "18"]);
    expect(lines.map((line) => line.costCents)).toEqual([189094n, 8100n]);
    expect(lines.map((line) => line.priceCents)).toEqual([249604n, 10692n]);
    expect(lines.map((line) => line.taxCents)).toEqual([17472n, 748n]);
    expect(lines.every((line) => line.flagged === false)).toBe(true);
    expect(lines[0]?.taxCode).toBe("materials");
    const totals = summarizeLines(lines);
    expect(totals.subtotalCents).toBe(260296n);
    expect(totals.taxCents).toBe(18220n);
    expect(totals.totalCents).toBe(278516n);
    expect(totals.costCents).toBe(197194n);
    expect(totals.marginCents).toBe(63102n);
    expect(totals.marginPct).toBe("24.24");
    expect(
      priceFromCost({
        costCents: 189094n,
        overheadPct: "10",
        markupPct: "20",
        taxRate: "0.07",
        taxable: true,
      }),
    ).toEqual({ priceCents: 249604n, taxCents: 17472n });
  });

  it("keeps an optional line out of the estimate total", () => {
    const lines = linesFromGroups([GROUP], RATES).map((line, index) =>
      index === 1 ? { ...line, optional: true } : line,
    );
    const totals = summarizeLines(lines);
    expect(totals.subtotalCents).toBe(249604n);
    expect(totals.taxCents).toBe(17472n);
    expect(totals.totalCents).toBe(267076n);
    expect(totals.optionalSubtotalCents).toBe(10692n);
    expect(totals.optionalTaxCents).toBe(748n);
    expect(totals.optionalTotalCents).toBe(11440n);
    expect(totals.costCents).toBe(189094n);
  });

  it("recalculates only the component whose variable changed", () => {
    const depth2 = priceRecipeComponent({
      formula: ASPHALT,
      componentId: "tons",
      catalogItemId: "asphalt",
      unitCostCents: 9200,
      inputQty: "180",
      inputUnit: "yd2",
      variables: VARIABLES,
      overheadPct: "10",
      markupPct: "20",
      taxRate: "0.07",
      taxable: true,
      priceOverrideCents: null,
    });
    const depth3 = priceRecipeComponent({
      formula: ASPHALT,
      componentId: "tons",
      catalogItemId: "asphalt",
      unitCostCents: 9200,
      inputQty: "180",
      inputUnit: "yd2",
      variables: { ...VARIABLES, depth_in: "3" },
      overheadPct: "10",
      markupPct: "20",
      taxRate: "0.07",
      taxable: true,
      priceOverrideCents: null,
    });
    const tackAt2 = priceRecipeComponent({
      formula: TACK,
      componentId: "tack",
      catalogItemId: "tack",
      unitCostCents: 450,
      inputQty: "180",
      inputUnit: "yd2",
      variables: VARIABLES,
      overheadPct: "10",
      markupPct: "20",
      taxRate: "0.07",
      taxable: true,
      priceOverrideCents: null,
    });
    const tackAt3 = priceRecipeComponent({
      formula: TACK,
      componentId: "tack",
      catalogItemId: "tack",
      unitCostCents: 450,
      inputQty: "180",
      inputUnit: "yd2",
      variables: { ...VARIABLES, depth_in: "3" },
      overheadPct: "10",
      markupPct: "20",
      taxRate: "0.07",
      taxable: true,
      priceOverrideCents: null,
    });
    // 1620 * (3/12) * 145 / 2000 * 1.05 = 30.830625 tons.
    // 30.830625 * 9200 = 283641.75 -> 283642. 283642 * 1.32 = 374407.44 -> 374407.
    expect(depth2.costCents).toBe(189094n);
    expect(depth3.qty).toBe("30.830625");
    expect(depth3.costCents).toBe(283642n);
    expect(depth3.priceCents).toBe(374407n);
    expect(tackAt3).toEqual(tackAt2);
    expect(tackAt3.priceCents).toBe(10692n);
    expect(marginPct(374407n, 283642n)).toBe("24.24");
  });

  it("keeps an explicit price when the cost changes", () => {
    const priced = priceRecipeComponent({
      formula: ASPHALT,
      componentId: "tons",
      catalogItemId: "asphalt",
      unitCostCents: 9200,
      inputQty: "180",
      inputUnit: "yd2",
      variables: { ...VARIABLES, depth_in: "3" },
      overheadPct: "10",
      markupPct: "20",
      taxRate: "0",
      taxable: false,
      priceOverrideCents: 1000n,
    });
    expect(priced.costCents).toBe(283642n);
    expect(priced.priceCents).toBe(1000n);
    expect(priced.taxCents).toBe(0n);
  });

  it("converts a square-yard quantity back to the canonical metre quantity", () => {
    expect(convertQuantity("9", "ft2", "yd2")).toBe("1");
    expect(convertQuantity("1", "yd²", "yd2")).toBe("1");
    const yards = takeoffQuantityForRecipe("area", "10", "yd2");
    expect(convertQuantity(yards, "yd2", "m2")).toBe("10");
  });

  it("prices a takeoff item with no recipe at zero and flags it", () => {
    const lines = linesFromGroups(
      [
        {
          ...GROUP,
          recipes: [],
        },
      ],
      RATES,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      priceCents: 0n,
      costCents: 0n,
      flagged: true,
      recipeId: null,
      source: "recipe",
    });
    const totals = summarizeLines(lines);
    expect(totals.totalCents).toBe(0n);
    expect(totals.marginPct).toBeNull();
  });
});
