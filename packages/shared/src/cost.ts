import { hasPermission } from "./permissions.js";

/**
 * Contract fixture for spec 02's cost-visibility acceptance test.
 * Persisted catalog items are spec 06. This row is not stored.
 */
export const CATALOG_VISIBILITY_SAMPLE = {
  id: "018f3c2e-7b10-7000-8000-0000000000c1",
  name: "Sample asphalt",
  unit: "ton",
  unit_price_cents: 18500,
  unit_cost_cents: 9200,
} as const;

export function applyCostVisibility<T extends { unit_cost_cents?: number }>(
  item: T,
  permissions: readonly string[],
): T {
  if (hasPermission(permissions, "catalog.manage")) {
    return { ...item };
  }
  const hidden: T = { ...item };
  delete hidden.unit_cost_cents;
  return hidden;
}
