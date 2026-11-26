import { describe, expect, it } from "vitest";

import { assertStarterPack, loadStarterPack, planStarter, starterPackPath } from "./starter.js";

describe("starter pack", () => {
  it("loads a pack whose formulas, units, and names are consistent", () => {
    const pack = loadStarterPack();
    expect(starterPackPath().endsWith("db/seed/starter-pack.json")).toBe(true);
    expect(() => assertStarterPack(pack)).not.toThrow();
    expect(pack.catalog.map((item) => item.sku)).toContain("GW-MAT-HMA");
    expect(pack.recipes.map((recipe) => recipe.name)).toContain("Asphalt surface");
  });

  it("skips rows that are already in the workspace and creates the rest", () => {
    const pack = loadStarterPack();
    const first = planStarter(pack, { catalogSkus: [], takeoffNames: [], recipeNames: [] });
    expect(first.catalogToCreate.map((item) => item.sku)).toContain("GW-MAT-HMA");
    expect(first.recipesToCreate.map((recipe) => recipe.name)).toContain("Asphalt surface");
    expect(first.catalogSkipped).toEqual([]);

    const again = planStarter(pack, {
      catalogSkus: pack.catalog.map((item) => item.sku),
      takeoffNames: pack.takeoff.map((item) => item.name),
      recipeNames: pack.recipes.map((recipe) => recipe.name),
    });
    expect(again.catalogToCreate).toEqual([]);
    expect(again.takeoffToCreate).toEqual([]);
    expect(again.recipesToCreate).toEqual([]);
    expect(again.catalogSkipped).toContain("GW-MAT-HMA");
    expect(again.recipesSkipped).toContain("Asphalt surface");
  });

  it("does not create a recipe whose catalog item is missing", () => {
    const pack = loadStarterPack();
    const recipe = pack.recipes[0];
    if (!recipe) {
      throw new Error("The starter pack has no recipes.");
    }
    const plan = planStarter(
      { ...pack, catalog: [], recipes: [recipe] },
      {
        catalogSkus: [],
        takeoffNames: pack.takeoff.map((item) => item.name),
        recipeNames: [],
      },
    );
    expect(plan.recipesToCreate).toEqual([]);
    expect(plan.recipesSkipped).toEqual([recipe.name]);
  });

  it("rejects a duplicate sku", () => {
    const pack = loadStarterPack();
    const first = pack.catalog[0];
    if (!first) {
      throw new Error("The starter pack has no catalog items.");
    }
    expect(() => assertStarterPack({ ...pack, catalog: [...pack.catalog, { ...first }] })).toThrow(
      /duplicate sku/i,
    );
  });
});
