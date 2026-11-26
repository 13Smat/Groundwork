export const PRICING_PACKAGE = "@groundwork/pricing" as const;

/** Money stays integer cents. Formulas round only at that boundary. */
export function pricingPackageName(): string {
  return PRICING_PACKAGE;
}

export {
  BUILTIN_VARIABLES,
  builtinValues,
  evaluateFormula,
  formatDecimal,
  isDecimalString,
  roundHalfEvenCents,
  validateFormula,
  type BuiltinVariable,
  type FormulaDiagnostic,
  type FormulaEvaluation,
  type FormulaFlag,
  type FormulaValidation,
} from "./formula.js";
export {
  previewRecipe,
  type PreviewComponentInput,
  type PreviewComponentResult,
  type RecipePreview,
} from "./preview.js";
