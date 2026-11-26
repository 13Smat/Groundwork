import {
  conversionRatio,
  measureKindOfUnit,
  normalizeUnit,
  type MeasureKind,
} from "@groundwork/geo";
import { Decimal } from "decimal.js";

import { formatDecimal, roundHalfEvenCents } from "./formula.js";
import { previewRecipe, type PreviewComponentInput } from "./preview.js";

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

const CANONICAL_UNIT: Record<MeasureKind, string> = {
  area: "m2",
  length: "m",
  count: "ea",
};

export class QuantityRangeError extends Error {
  constructor() {
    super("Quantity must fit numeric(14,4).");
    this.name = "QuantityRangeError";
  }
}

export type EstimateRates = {
  overheadPct: string;
  markupPct: string;
  taxRate: string;
};

export type RecipeComponentSource = {
  id: string;
  catalogItemId: string;
  name: string;
  unit: string;
  unitCostCents: bigint | number | string;
  formula: string;
  taxCode: string | null;
  kind: string;
};

export type RecipeSource = {
  id: string;
  version: number;
  inputUnit: string;
  variables: Record<string, string>;
  components: readonly RecipeComponentSource[];
};

export type TakeoffGroupSource = {
  takeoffItemId: string;
  name: string;
  defaultUnit: string;
  measureKind: MeasureKind;
  /** Sum of value_m2, value_m, or count. Area and length stay in metres. */
  canonicalQty: string;
  measurementIds: readonly string[];
  recipes: readonly RecipeSource[];
};

export type PricedLine = {
  group: string | null;
  description: string;
  /** Formula quantity before numeric(14,4) storage. */
  qty: string;
  storedQty: string;
  unit: string;
  unitCostCents: bigint;
  unitPriceCents: bigint;
  costCents: bigint;
  priceCents: bigint;
  taxCents: bigint;
  source: "recipe" | "manual";
  recipeId: string | null;
  recipeVersion: number | null;
  recipeComponentId: string | null;
  catalogItemId: string | null;
  takeoffItemId: string | null;
  inputQty: string | null;
  inputUnit: string | null;
  /** Per-line overrides. Recipe defaults stay on the recipe. */
  variables: Record<string, string>;
  markupPct: string | null;
  overheadPct: string | null;
  taxCode: string | null;
  flagged: boolean;
  optional: boolean;
  priceOverridden: boolean;
  measurementIds: string[];
};

export type EstimateTotals = {
  subtotalCents: bigint;
  taxCents: bigint;
  totalCents: bigint;
  optionalSubtotalCents: bigint;
  optionalTaxCents: bigint;
  optionalTotalCents: bigint;
  costCents: bigint;
  marginCents: bigint;
  marginPct: string | null;
};

export function isMaterialsTaxCode(taxCode: string | null | undefined): boolean {
  if (!taxCode) {
    return false;
  }
  return /^materials?$/i.test(taxCode.trim());
}

/** Catalog rows with a blank tax code use materials for material items. */
export function defaultTaxCode(kind: string, taxCode: string | null | undefined): string {
  const trimmed = taxCode?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (kind === "material") {
    return "materials";
  }
  return kind;
}

export function canonicalUnit(kind: MeasureKind): string {
  return CANONICAL_UNIT[kind];
}

/**
 * Convert a quantity between two units of the same measure kind.
 * Identical units (including aliases such as yd² and yd2) keep the value.
 */
export function convertQuantity(qty: string, from: string, to: string): string {
  const source = normalizeUnit(from);
  const target = normalizeUnit(to);
  if (source !== null && source === target) {
    return formatDecimal(new D(qty));
  }
  const ratio = conversionRatio(from, to);
  return formatDecimal(new D(qty).mul(ratio.numerator).div(ratio.denominator));
}

export function sumQuantities(values: readonly string[]): string {
  let total = new D(0);
  for (const value of values) {
    total = total.plus(value);
  }
  return formatDecimal(total);
}

/**
 * Convert a canonical takeoff quantity into the recipe's input unit.
 * The result keeps full decimal precision so previewRecipe and a later
 * recalculation see the same input.
 */
export function takeoffQuantityForRecipe(
  kind: MeasureKind,
  canonicalQty: string,
  recipeUnit: string,
): string {
  const canonicalUnit = CANONICAL_UNIT[kind];
  if (measureKindOfUnit(recipeUnit) !== kind) {
    throw new Error(`Cannot convert ${canonicalUnit} to ${recipeUnit}.`);
  }
  const ratio = conversionRatio(canonicalUnit, recipeUnit);
  return formatDecimal(new D(canonicalQty).mul(ratio.numerator).div(ratio.denominator));
}

/** Sketch quantity column. Money is computed from the unrounded formula qty. */
export function roundQty(value: string): string {
  const rounded = new D(value).toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN);
  if (rounded.abs().gte("10000000000")) {
    throw new QuantityRangeError();
  }
  return rounded.toFixed(4);
}

export function extendCents(qty: string, unitCents: bigint): bigint {
  return roundHalfEvenCents(new D(qty).mul(new D(unitCents.toString())));
}

export function unitCentsFromExtended(qty: string, extended: bigint): bigint {
  const quantity = new D(qty);
  if (quantity.isZero()) {
    return 0n;
  }
  return roundHalfEvenCents(new D(extended.toString()).div(quantity));
}

export function marginPct(priceCents: bigint, costCents: bigint): string | null {
  if (priceCents === 0n) {
    return null;
  }
  return new D((priceCents - costCents).toString())
    .div(new D(priceCents.toString()))
    .mul(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN)
    .toFixed(2);
}

/**
 * price = cost * (1 + overhead%) * (1 + markup%), half-even to cents,
 * unless the line has an explicit price. Tax is half-even on that price.
 */
export function priceFromCost(input: {
  costCents: bigint;
  overheadPct: string;
  markupPct: string;
  taxRate: string;
  taxable: boolean;
  priceOverrideCents?: bigint | null;
}): { priceCents: bigint; taxCents: bigint } {
  const price =
    input.priceOverrideCents === undefined || input.priceOverrideCents === null
      ? roundHalfEvenCents(
          new D(input.costCents.toString())
            .mul(new D(1).plus(new D(input.overheadPct).div(100)))
            .mul(new D(1).plus(new D(input.markupPct).div(100))),
        )
      : input.priceOverrideCents;
  const tax = input.taxable
    ? roundHalfEvenCents(new D(price.toString()).mul(new D(input.taxRate)))
    : 0n;
  return { priceCents: price, taxCents: tax };
}

export function priceRecipeComponent(input: {
  formula: string;
  componentId: string;
  catalogItemId: string;
  unitCostCents: bigint | number | string;
  inputQty: string;
  inputUnit: string;
  variables: Record<string, string>;
  overheadPct: string;
  markupPct: string;
  taxRate: string;
  taxable: boolean;
  priceOverrideCents: bigint | null;
}): {
  qty: string;
  storedQty: string;
  unitCostCents: bigint;
  unitPriceCents: bigint;
  costCents: bigint;
  priceCents: bigint;
  taxCents: bigint;
  flagged: boolean;
} {
  const unitCostCents = BigInt(input.unitCostCents.toString());
  const preview = previewRecipe({
    inputQty: input.inputQty,
    inputUnit: input.inputUnit,
    variables: input.variables,
    components: [
      {
        id: input.componentId,
        catalogItemId: input.catalogItemId,
        formula: input.formula,
        unitCostCents,
      } satisfies PreviewComponentInput,
    ],
  });
  const component = preview.components[0];
  const flagged = preview.flagged || component === undefined;
  const qty = component?.qty ?? "0";
  const storedQty = roundQty(qty);
  if (flagged || component === undefined) {
    return {
      qty,
      storedQty,
      unitCostCents,
      unitPriceCents: 0n,
      costCents: 0n,
      priceCents: 0n,
      taxCents: 0n,
      flagged: true,
    };
  }
  const costCents = BigInt(component.costCents);
  const priced = priceFromCost({
    costCents,
    overheadPct: input.overheadPct,
    markupPct: input.markupPct,
    taxRate: input.taxRate,
    taxable: input.taxable,
    priceOverrideCents: input.priceOverrideCents,
  });
  return {
    qty,
    storedQty,
    unitCostCents,
    unitPriceCents: unitCentsFromExtended(storedQty, priced.priceCents),
    costCents,
    priceCents: priced.priceCents,
    taxCents: priced.taxCents,
    flagged: false,
  };
}

export function priceManualLine(input: {
  qty: string;
  unitCostCents: bigint;
  unitPriceCents: bigint | null;
  explicitPriceCents: bigint | null;
  overheadPct: string;
  markupPct: string;
  taxRate: string;
  taxable: boolean;
}): {
  storedQty: string;
  unitCostCents: bigint;
  unitPriceCents: bigint;
  costCents: bigint;
  priceCents: bigint;
  taxCents: bigint;
  priceOverridden: boolean;
} {
  const storedQty = roundQty(input.qty);
  const costCents = extendCents(storedQty, input.unitCostCents);
  if (input.explicitPriceCents !== null) {
    const tax = priceFromCost({
      costCents,
      overheadPct: input.overheadPct,
      markupPct: input.markupPct,
      taxRate: input.taxRate,
      taxable: input.taxable,
      priceOverrideCents: input.explicitPriceCents,
    });
    return {
      storedQty,
      unitCostCents: input.unitCostCents,
      unitPriceCents: unitCentsFromExtended(storedQty, input.explicitPriceCents),
      costCents,
      priceCents: tax.priceCents,
      taxCents: tax.taxCents,
      priceOverridden: true,
    };
  }
  if (input.unitPriceCents !== null) {
    const priceCents = extendCents(storedQty, input.unitPriceCents);
    const tax = priceFromCost({
      costCents,
      overheadPct: input.overheadPct,
      markupPct: input.markupPct,
      taxRate: input.taxRate,
      taxable: input.taxable,
      priceOverrideCents: priceCents,
    });
    return {
      storedQty,
      unitCostCents: input.unitCostCents,
      unitPriceCents: input.unitPriceCents,
      costCents,
      priceCents: tax.priceCents,
      taxCents: tax.taxCents,
      priceOverridden: true,
    };
  }
  const priced = priceFromCost({
    costCents,
    overheadPct: input.overheadPct,
    markupPct: input.markupPct,
    taxRate: input.taxRate,
    taxable: input.taxable,
  });
  return {
    storedQty,
    unitCostCents: input.unitCostCents,
    unitPriceCents: unitCentsFromExtended(storedQty, priced.priceCents),
    costCents,
    priceCents: priced.priceCents,
    taxCents: priced.taxCents,
    priceOverridden: false,
  };
}

function flaggedLine(input: {
  group: string;
  description: string;
  qty: string;
  unit: string;
  takeoffItemId: string;
  measurementIds: readonly string[];
  inputQty: string | null;
  inputUnit: string | null;
  recipeId: string | null;
  recipeVersion: number | null;
}): PricedLine {
  const storedQty = (() => {
    try {
      return roundQty(input.qty);
    } catch {
      return "0.0000";
    }
  })();
  return {
    group: input.group,
    description: input.description,
    qty: input.qty,
    storedQty,
    unit: input.unit,
    unitCostCents: 0n,
    unitPriceCents: 0n,
    costCents: 0n,
    priceCents: 0n,
    taxCents: 0n,
    source: "recipe",
    recipeId: input.recipeId,
    recipeVersion: input.recipeVersion,
    recipeComponentId: null,
    catalogItemId: null,
    takeoffItemId: input.takeoffItemId,
    inputQty: input.inputQty,
    inputUnit: input.inputUnit,
    variables: {},
    markupPct: null,
    overheadPct: null,
    taxCode: null,
    flagged: true,
    optional: false,
    priceOverridden: false,
    measurementIds: [...input.measurementIds],
  };
}

/**
 * One line per recipe component. A takeoff item with no active recipe, or a
 * recipe whose unit cannot be converted, becomes one flagged zero-price line.
 * Money calls previewRecipe, then overhead, markup, and tax.
 */
export function linesFromGroups(
  groups: readonly TakeoffGroupSource[],
  rates: EstimateRates,
): PricedLine[] {
  const lines: PricedLine[] = [];
  for (const group of groups) {
    const usable = group.recipes.filter((recipe) => recipe.components.length > 0);
    if (usable.length === 0) {
      let qty = group.canonicalQty;
      let unit = group.defaultUnit;
      try {
        qty = takeoffQuantityForRecipe(group.measureKind, group.canonicalQty, group.defaultUnit);
      } catch {
        unit = CANONICAL_UNIT[group.measureKind];
      }
      lines.push(
        flaggedLine({
          group: group.name,
          description: group.name,
          qty,
          unit,
          takeoffItemId: group.takeoffItemId,
          measurementIds: group.measurementIds,
          inputQty: qty,
          inputUnit: unit,
          recipeId: null,
          recipeVersion: null,
        }),
      );
      continue;
    }
    for (const recipe of usable) {
      let inputQty: string;
      try {
        inputQty = takeoffQuantityForRecipe(
          group.measureKind,
          group.canonicalQty,
          recipe.inputUnit,
        );
      } catch {
        lines.push(
          flaggedLine({
            group: group.name,
            description: recipe.components[0]?.name ?? group.name,
            qty: group.canonicalQty,
            unit: recipe.inputUnit,
            takeoffItemId: group.takeoffItemId,
            measurementIds: group.measurementIds,
            inputQty: group.canonicalQty,
            inputUnit: null,
            recipeId: recipe.id,
            recipeVersion: recipe.version,
          }),
        );
        continue;
      }
      for (const component of recipe.components) {
        const taxCode = defaultTaxCode(component.kind, component.taxCode);
        const priced = priceRecipeComponent({
          formula: component.formula,
          componentId: component.id,
          catalogItemId: component.catalogItemId,
          unitCostCents: component.unitCostCents,
          inputQty,
          inputUnit: recipe.inputUnit,
          variables: recipe.variables,
          overheadPct: rates.overheadPct,
          markupPct: rates.markupPct,
          taxRate: rates.taxRate,
          taxable: isMaterialsTaxCode(taxCode),
          priceOverrideCents: null,
        });
        lines.push({
          group: group.name,
          description: component.name,
          qty: priced.qty,
          storedQty: priced.storedQty,
          unit: component.unit,
          unitCostCents: priced.unitCostCents,
          unitPriceCents: priced.unitPriceCents,
          costCents: priced.costCents,
          priceCents: priced.priceCents,
          taxCents: priced.taxCents,
          source: "recipe",
          recipeId: recipe.id,
          recipeVersion: recipe.version,
          recipeComponentId: component.id,
          catalogItemId: component.catalogItemId,
          takeoffItemId: group.takeoffItemId,
          inputQty,
          inputUnit: recipe.inputUnit,
          variables: {},
          markupPct: null,
          overheadPct: null,
          taxCode,
          flagged: priced.flagged,
          optional: false,
          priceOverridden: false,
          measurementIds: [...group.measurementIds],
        });
      }
    }
  }
  return lines;
}

/** Non-optional lines sum into the estimate. Optional lines stay beside that. */
export function summarizeLines(
  lines: readonly {
    priceCents: bigint;
    taxCents: bigint;
    costCents: bigint;
    optional: boolean;
  }[],
): EstimateTotals {
  let subtotal = 0n;
  let tax = 0n;
  let cost = 0n;
  let optionalSubtotal = 0n;
  let optionalTax = 0n;
  for (const line of lines) {
    if (line.optional) {
      optionalSubtotal += line.priceCents;
      optionalTax += line.taxCents;
    } else {
      subtotal += line.priceCents;
      tax += line.taxCents;
      cost += line.costCents;
    }
  }
  return {
    subtotalCents: subtotal,
    taxCents: tax,
    totalCents: subtotal + tax,
    optionalSubtotalCents: optionalSubtotal,
    optionalTaxCents: optionalTax,
    optionalTotalCents: optionalSubtotal + optionalTax,
    costCents: cost,
    marginCents: subtotal - cost,
    marginPct: marginPct(subtotal, cost),
  };
}
