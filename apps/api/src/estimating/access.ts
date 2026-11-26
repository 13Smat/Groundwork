import { hasPermission } from "@groundwork/shared";

import { ProblemError } from "../errors.js";

const HIDDEN = ["unit_cost_cents", "cost_cents", "margin_cents", "margin_pct"] as const;

function hide<T extends object>(row: T): T {
  const copy = { ...row } as T;
  for (const key of HIDDEN) {
    delete (copy as Record<string, unknown>)[key];
  }
  return copy;
}

/**
 * Office staff see prices and not costs. `catalog.manage` is the existing
 * cost token (owner, admin, estimator). ADR 0015.
 */
export function stripEstimateCosts<T extends object, L extends object>(
  estimate: T & { lines: L[] },
  permissions: readonly string[],
): T & { lines: L[] } {
  if (hasPermission(permissions, "catalog.manage")) {
    return estimate;
  }
  const copy = hide(estimate);
  copy.lines = estimate.lines.map((line) => hide(line));
  return copy;
}

export function lineIsNegative(input: {
  qty: string;
  unitCostCents: bigint;
  unitPriceCents: bigint;
  priceCents: bigint;
}): boolean {
  return (
    input.qty.trim().startsWith("-") ||
    input.unitCostCents < 0n ||
    input.unitPriceCents < 0n ||
    input.priceCents < 0n
  );
}

/** A discount is a negative manual amount. It needs catalog.manage. */
export function assertDiscountAllowed(
  permissions: readonly string[],
  input: {
    qty: string;
    unitCostCents: bigint;
    unitPriceCents: bigint;
    priceCents: bigint;
  },
): void {
  if (!lineIsNegative(input)) {
    return;
  }
  if (!hasPermission(permissions, "catalog.manage")) {
    throw new ProblemError({
      status: 403,
      title: "Forbidden",
      detail: "A negative line needs catalog.manage.",
    });
  }
}
