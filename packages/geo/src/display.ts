import { Decimal } from "decimal.js";

import { conversionRatio } from "./units.js";

/**
 * Display steps from spec 04. Stored values stay metric and unrounded
 * (`numeric(14,4)`). Acre display is 0.001 and is provisional: the spec names
 * acres and does not give a step. ADR 0013.
 */
export const DISPLAY_STEPS = {
  ft2: "1",
  yd2: "0.1",
  ft: "1",
  acre: "0.001",
} as const;

export type DisplayUnit = keyof typeof DISPLAY_STEPS;

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

function canonicalUnit(unit: DisplayUnit): "m" | "m2" {
  return unit === "ft" ? "m" : "m2";
}

function decimalPlaces(step: string): number {
  const dot = step.indexOf(".");
  return dot === -1 ? 0 : step.length - dot - 1;
}

function quantity(metric: string, unit: DisplayUnit): InstanceType<typeof D> {
  if (!/^-?\d+(\.\d+)?$/.test(metric)) {
    throw new RangeError(`Metric quantity must be a decimal string. Received ${metric}.`);
  }
  const value = new D(metric);
  if (value.isNeg()) {
    throw new RangeError(`Metric quantity cannot be negative. Received ${metric}.`);
  }
  const ratio = conversionRatio(canonicalUnit(unit), unit);
  return value.times(ratio.numerator).div(ratio.denominator);
}

/** Convert a canonical meter or square-meter quantity. Not display-rounded. */
export function convertMetric(metric: string, unit: DisplayUnit): string {
  return quantity(metric, unit).toFixed(8);
}

/** Display rounding: half up, ft² to 1, yd² to 0.1, ft to 1, acres to 0.001. */
export function displayFromMetric(metric: string, unit: DisplayUnit): string {
  const step = DISPLAY_STEPS[unit];
  const rounded = quantity(metric, unit).div(step).toDecimalPlaces(0, D.ROUND_HALF_UP).times(step);
  return rounded.toFixed(decimalPlaces(step));
}
