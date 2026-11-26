import { describe, expect, it } from "vitest";

import { previewRecipe } from "./preview.js";

describe("recipe preview", () => {
  it("prices an asphalt-style recipe in half-even cents", () => {
    const preview = previewRecipe({
      inputQty: "180",
      inputUnit: "yd2",
      variables: { depth_in: "2", density: "145", waste: "0.05", tack_rate: "0.1" },
      components: [
        {
          id: "tons",
          catalogItemId: "asphalt",
          formula: "area_ft2 * (depth_in/12) * density / 2000 * (1+waste)",
          unitCostCents: 9200,
        },
        {
          id: "tack",
          catalogItemId: "tack",
          formula: "area_yd2 * tack_rate",
          unitCostCents: 450,
        },
      ],
    });
    expect(preview.flagged).toBe(false);
    expect(preview.components[0]).toMatchObject({ qty: "20.55375", costCents: "189094" });
    expect(preview.components[1]).toMatchObject({ qty: "18", costCents: "8100" });
    expect(preview.totalCostCents).toBe("197194");
    const again = previewRecipe({
      inputQty: "180",
      inputUnit: "yd2",
      variables: { depth_in: "2", density: "145", waste: "0.05", tack_rate: "0.1" },
      components: [
        {
          id: "tons",
          catalogItemId: "asphalt",
          formula: "area_ft2 * (depth_in/12) * density / 2000 * (1+waste)",
          unitCostCents: 9200,
        },
        {
          id: "tack",
          catalogItemId: "tack",
          formula: "area_yd2 * tack_rate",
          unitCostCents: 450,
        },
      ],
    });
    expect(again).toEqual(preview);
  });

  it("flags division by zero and contributes zero cost", () => {
    const preview = previewRecipe({
      inputQty: "10",
      inputUnit: "ft2",
      components: [
        {
          id: "bad",
          catalogItemId: "asphalt",
          formula: "1/0",
          unitCostCents: 9200,
        },
      ],
    });
    expect(preview.flagged).toBe(true);
    expect(preview.components[0]).toMatchObject({
      qty: "0",
      costCents: "0",
      flags: ["division_by_zero"],
    });
    expect(preview.totalCostCents).toBe("0");
  });

  it("rounds a half-cent to the even cent", () => {
    const preview = previewRecipe({
      inputQty: "1",
      inputUnit: "ea",
      components: [
        { id: "a", catalogItemId: "a", formula: "1.5", unitCostCents: 1 },
        { id: "b", catalogItemId: "b", formula: "2.5", unitCostCents: 1 },
      ],
    });
    expect(preview.components.map((component) => component.costCents)).toEqual(["2", "2"]);
    expect(preview.totalCostCents).toBe("4");
  });
});
