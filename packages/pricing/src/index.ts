export const PRICING_PACKAGE = "@groundwork/pricing" as const;

/** Money stays integer cents. The cost-recipe engine is not in this slice. */
export function pricingPackageName(): string {
  return PRICING_PACKAGE;
}
