import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import { evaluateFormula, formatDecimal, roundHalfEvenCents, validateFormula } from "./formula.js";

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

type Case = {
  name: string;
  formula: string;
  qty?: string;
  unit?: string;
  variables?: Record<string, string>;
  known?: string[];
  expect?: string;
  /** Compare with Decimal equality against this fraction n/d. */
  ratio?: { numerator: string; denominator: string };
  flags?: string[];
  errorAt?: number;
  referenced?: string[];
};

const cases: Case[] = [
  { name: "add", formula: "1+1", expect: "2" },
  { name: "subtract", formula: "2-5", expect: "-3" },
  { name: "multiply", formula: "2*3", expect: "6" },
  { name: "divide", formula: "8/4", expect: "2" },
  { name: "precedence multiply", formula: "2+3*4", expect: "14" },
  { name: "parentheses", formula: "(2+3)*4", expect: "20" },
  { name: "left add after multiply", formula: "2*3+4", expect: "10" },
  { name: "left associative division", formula: "8/2/2", expect: "2" },
  { name: "power", formula: "2^3", expect: "8" },
  { name: "right associative power", formula: "2^3^2", expect: "512" },
  { name: "parenthesized power", formula: "(2^3)^2", expect: "64" },
  { name: "power before multiply", formula: "2*3^2", expect: "18" },
  { name: "unary minus outside power", formula: "-2^2", expect: "-4" },
  { name: "parenthesized negative base", formula: "(-2)^2", expect: "4" },
  { name: "negative power", formula: "2^-3", expect: "0.125" },
  { name: "unary then add", formula: "-3+1", expect: "-2" },
  { name: "spaces", formula: "2 + 3", expect: "5" },
  { name: "nested parens", formula: "((2+3)*4)/5", expect: "4" },
  { name: "multiply by negative", formula: "2*-3", expect: "-6" },
  { name: "decimal addition", formula: "0.1+0.2", expect: "0.3" },
  { name: "ceil", formula: "ceil(1.1)", expect: "2" },
  { name: "ceil negative", formula: "ceil(-1.1)", expect: "-1" },
  { name: "floor", formula: "floor(1.9)", expect: "1" },
  { name: "floor negative", formula: "floor(-1.1)", expect: "-2" },
  { name: "round half even 1.5", formula: "round(1.5)", expect: "2" },
  { name: "round half even 2.5", formula: "round(2.5)", expect: "2" },
  { name: "round half even 3.5", formula: "round(3.5)", expect: "4" },
  { name: "round places to even tenth", formula: "round(1.25, 1)", expect: "1.2" },
  { name: "round places away from odd", formula: "round(1.35, 1)", expect: "1.4" },
  { name: "min", formula: "min(3,1,2)", expect: "1" },
  { name: "max", formula: "max(1,4,2)", expect: "4" },
  { name: "if true", formula: "if(1, 5, 9)", expect: "5" },
  { name: "if false", formula: "if(0, 5, 9)", expect: "9" },
  { name: "if negative is true", formula: "if(-1, 5, 9)", expect: "5" },
  { name: "if skips division by zero", formula: "if(1, 2, 1/0)", expect: "2" },
  { name: "if false skips division by zero", formula: "if(0, 1/0, 3)", expect: "3" },
  { name: "less than", formula: "1 < 2", expect: "1" },
  { name: "less than false", formula: "2 < 2", expect: "0" },
  { name: "less or equal", formula: "2 <= 2", expect: "1" },
  { name: "greater than false", formula: "2 > 3", expect: "0" },
  { name: "greater or equal", formula: "3 >= 3", expect: "1" },
  { name: "equal sign", formula: "2 = 2", expect: "1" },
  { name: "double equal false", formula: "2 == 3", expect: "0" },
  { name: "not equal false", formula: "2 != 2", expect: "0" },
  { name: "diamond not equal", formula: "2 <> 3", expect: "1" },
  { name: "qty", formula: "qty", qty: "5", unit: "ft2", expect: "5" },
  { name: "comparison on qty", formula: "if(qty > 10, 2, 3)", qty: "12", unit: "ft2", expect: "2" },
  {
    name: "comparison on qty boundary",
    formula: "if(qty > 10, 2, 3)",
    qty: "10",
    unit: "ft2",
    expect: "3",
  },
  { name: "min with qty", formula: "min(qty, 2)", qty: "5", unit: "ea", expect: "2" },
  { name: "square yard to square feet", formula: "area_ft2", qty: "1", unit: "yd2", expect: "9" },
  { name: "square feet to square yards", formula: "area_yd2", qty: "9", unit: "ft2", expect: "1" },
  { name: "square metres identity", formula: "area_m2", qty: "1", unit: "m2", expect: "1" },
  { name: "acre to square feet", formula: "area_ft2", qty: "1", unit: "acre", expect: "43560" },
  { name: "foot to metres", formula: "length_m", qty: "1", unit: "ft", expect: "0.3048" },
  {
    name: "metre to feet",
    formula: "length_ft",
    qty: "1",
    unit: "m",
    ratio: { numerator: "10000", denominator: "3048" },
  },
  { name: "count", formula: "count", qty: "4", unit: "ea", expect: "4" },
  {
    name: "area threshold after conversion",
    formula: "if(area_ft2 >= 9, 1, 0)",
    qty: "1",
    unit: "yd2",
    expect: "1",
  },
  {
    name: "user variable",
    formula: "depth_in",
    qty: "1",
    unit: "ft2",
    variables: { depth_in: "2" },
    expect: "2",
  },
  {
    name: "asphalt-style product",
    formula: "area_ft2 * (depth_in/12) * density / 2000 * (1+waste)",
    qty: "9",
    unit: "ft2",
    variables: { depth_in: "2", density: "145", waste: "0.05" },
    expect: "0.1141875",
  },
  { name: "division by zero", formula: "1/0", flags: ["division_by_zero"], expect: "0" },
  {
    name: "hidden division by zero",
    formula: "qty/(area_ft2-area_ft2)",
    qty: "10",
    unit: "ft2",
    flags: ["division_by_zero"],
    expect: "0",
  },
  { name: "zero to a negative power", formula: "0^-1", flags: ["division_by_zero"], expect: "0" },
  { name: "unknown variable position", formula: "qty + nope", qty: "1", unit: "ft2", errorAt: 6 },
  {
    name: "length variable is unknown on an area input",
    formula: "length_ft",
    qty: "1",
    unit: "ft2",
    errorAt: 0,
  },
  { name: "huge exponent is refused", formula: "2^40", flags: ["complexity"] },
  { name: "tower that overflows the exponent cap", formula: "2^2^2^2^2", flags: ["complexity"] },
];

describe("formula engine", () => {
  it("covers at least 50 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(50);
  });

  it.each(cases)("$name", (item) => {
    const result = evaluateFormula({
      formula: item.formula,
      inputQty: item.qty ?? "0",
      inputUnit: item.unit ?? "ea",
      variables: item.variables,
    });
    if (item.errorAt !== undefined) {
      expect(result.ok).toBe(false);
      expect(result.errors[0]?.position).toBe(item.errorAt);
      return;
    }
    if (item.flags) {
      expect(result.flags).toEqual(item.flags);
    } else {
      expect(result.flags).toEqual([]);
      expect(result.ok, result.errors.map((error) => error.message).join(" ")).toBe(true);
    }
    if (item.ratio) {
      const expected = formatDecimal(new D(item.ratio.numerator).div(item.ratio.denominator));
      expect(result.value).toBe(expected);
    } else if (item.expect !== undefined) {
      expect(result.value).toBe(item.expect);
    }
  });

  it("reports every referenced variable and the unknown one's position", () => {
    const result = validateFormula("area_ft2 * depth_in + nope", ["depth_in"]);
    expect(result.referencedVars).toEqual(["area_ft2", "depth_in", "nope"]);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ message: "Unknown variable nope.", position: 22, length: 4 }]);
  });

  it("rejects an empty formula, a bad function, and a chained comparison", () => {
    expect(validateFormula("   ", []).ok).toBe(false);
    expect(validateFormula("eval(1)", []).errors[0]?.message).toContain("Unknown function");
    expect(validateFormula("1 < 2 < 3", []).errors[0]?.message).toContain("Chained");
    expect(validateFormula("min", []).ok).toBe(false);
  });

  it("rounds money half-even and leaves the quantity unrounded", () => {
    expect(roundHalfEvenCents(new D("0.5"))).toBe(0n);
    expect(roundHalfEvenCents(new D("1.5"))).toBe(2n);
    expect(roundHalfEvenCents(new D("2.5"))).toBe(2n);
    expect(roundHalfEvenCents(new D("3.5"))).toBe(4n);
    expect(roundHalfEvenCents(new D("-1.5"))).toBe(-2n);
    const qty = evaluateFormula({
      formula: "1/3",
      inputQty: "0",
      inputUnit: "ea",
    });
    expect(qty.value?.startsWith("0.333333")).toBe(true);
    expect(roundHalfEvenCents(new D(qty.value!).mul(100))).toBe(33n);
  });
});
