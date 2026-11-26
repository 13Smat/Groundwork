import { Decimal } from "decimal.js";

import {
  evaluateFormula,
  roundHalfEvenCents,
  type FormulaDiagnostic,
  type FormulaFlag,
} from "./formula.js";

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export type PreviewComponentInput = {
  id: string;
  catalogItemId: string;
  formula: string;
  unitCostCents: bigint | number | string;
};

export type PreviewComponentResult = {
  id: string;
  catalogItemId: string;
  qty: string;
  costCents: string;
  flags: FormulaFlag[];
  errors: FormulaDiagnostic[];
};

export type RecipePreview = {
  components: PreviewComponentResult[];
  totalCostCents: string;
  flagged: boolean;
};

/**
 * Shared by the recipe preview route and, later, the estimate engine.
 * A flagged line (division by zero, complexity, or a bad formula) contributes
 * quantity 0 and cost 0. Money is rounded half-even to integer cents here
 * and nowhere earlier.
 */
export function previewRecipe(input: {
  inputQty: string;
  inputUnit: string;
  variables?: Record<string, string>;
  components: readonly PreviewComponentInput[];
}): RecipePreview {
  const variables = input.variables ?? {};
  let total = new D(0);
  let flagged = false;
  const components = input.components.map((component) => {
    const evaluated = evaluateFormula({
      formula: component.formula,
      inputQty: input.inputQty,
      inputUnit: input.inputUnit,
      variables,
    });
    if (!evaluated.ok || evaluated.value === null) {
      flagged = true;
      return {
        id: component.id,
        catalogItemId: component.catalogItemId,
        qty: "0",
        costCents: "0",
        flags: evaluated.flags,
        errors: evaluated.errors,
      };
    }
    const qty = new D(evaluated.value);
    const cost = roundHalfEvenCents(qty.mul(new D(component.unitCostCents.toString())));
    total = total.add(cost.toString());
    return {
      id: component.id,
      catalogItemId: component.catalogItemId,
      qty: evaluated.value,
      costCents: cost.toString(),
      flags: evaluated.flags,
      errors: evaluated.errors,
    };
  });
  return {
    components,
    totalCostCents: total.toFixed(0),
    flagged,
  };
}
