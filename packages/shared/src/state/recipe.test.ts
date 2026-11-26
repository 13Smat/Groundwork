import { describe, expect, it } from "vitest";

import {
  RECIPE_STATUSES,
  RecipeVersionError,
  IllegalRecipeTransitionError,
  assertCanVersion,
  recipeEditTarget,
  transitionRecipe,
} from "./recipe.js";

describe("cost recipe state machine", () => {
  it("allows draft to active and active to archived", () => {
    expect(transitionRecipe("draft", "active")).toBe("active");
    expect(transitionRecipe("active", "archived")).toBe("archived");
  });

  it("leaves a recipe on the same status", () => {
    for (const status of RECIPE_STATUSES) {
      expect(transitionRecipe(status, status)).toBe(status);
    }
  });

  it("rejects every other pair", () => {
    const legal = new Set(["draft->active", "active->archived"]);
    for (const from of RECIPE_STATUSES) {
      for (const to of RECIPE_STATUSES) {
        if (from === to || legal.has(`${from}->${to}`)) {
          continue;
        }
        expect(() => transitionRecipe(from, to)).toThrow(IllegalRecipeTransitionError);
      }
    }
  });

  it("edits a draft in place and forks an active recipe", () => {
    expect(recipeEditTarget("draft")).toBe("in_place");
    expect(recipeEditTarget("active")).toBe("new_version");
    expect(() => recipeEditTarget("archived")).toThrow(IllegalRecipeTransitionError);
  });

  it("versions only an active recipe", () => {
    expect(() => assertCanVersion("active")).not.toThrow();
    expect(() => assertCanVersion("draft")).toThrow(RecipeVersionError);
    expect(() => assertCanVersion("archived")).toThrow(RecipeVersionError);
  });
});
