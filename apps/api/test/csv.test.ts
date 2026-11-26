import { describe, expect, it } from "vitest";

import { planCatalogImport, serializeCatalogCsv, type CatalogCsvRow } from "../src/catalog/csv.js";

const rows: CatalogCsvRow[] = [
  {
    sku: "ASP-2",
    kind: "material",
    name: 'Asphalt, 2"',
    unit: "ton",
    unit_cost_cents: "9200",
    unit_price_cents: "18500",
    waste_pct: "5",
    vendor: "Acme",
    tax_code: null,
  },
  {
    sku: "CREW",
    kind: "labor",
    name: "Paver crew",
    unit: "hr",
    unit_cost_cents: "12500",
    unit_price_cents: "18000",
    waste_pct: "0",
    vendor: null,
    tax_code: "LABOR",
  },
];

describe("catalog CSV", () => {
  it("round-trips export to import with no changes", () => {
    const plan = planCatalogImport(serializeCatalogCsv(rows), rows);
    expect(plan.errors).toEqual([]);
    expect(plan.created).toEqual([]);
    expect(plan.updated).toEqual([]);
    expect(plan.unchanged.sort()).toEqual(["ASP-2", "CREW"]);
  });

  it("previews an upsert when the cost changes and rejects a duplicate SKU", () => {
    const csv = serializeCatalogCsv(rows).replace("9200", "9300");
    const plan = planCatalogImport(csv, rows);
    expect(plan.created).toEqual([]);
    expect(plan.updated).toEqual([
      {
        sku: "ASP-2",
        changes: { unit_cost_cents: { from: "9200", to: "9300" } },
      },
    ]);
    const duplicated = planCatalogImport(`${csv.trimEnd()}\n${csv.split("\n")[1]}\n`, rows);
    expect(duplicated.errors.some((error) => error.message.includes("Duplicate SKU"))).toBe(true);
  });
});
