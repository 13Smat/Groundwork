export const CATALOG_KINDS = ["material", "labor", "equipment", "sub", "fee"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export const KIND_LABEL: Record<CatalogKind, string> = {
  material: "Materials",
  labor: "Labor",
  equipment: "Equipment",
  sub: "Subs",
  fee: "Fees",
};

export const DEFAULT_CATALOG_UNIT: Record<CatalogKind, string> = {
  material: "ton",
  labor: "hr",
  equipment: "hr",
  sub: "ea",
  fee: "ea",
};

export type CatalogItem = {
  id: string;
  kind: CatalogKind;
  name: string;
  unit: string;
  unit_price_cents: number;
  unit_cost_cents?: number;
  waste_pct: string;
  vendor: string | null;
  sku: string | null;
  tax_code: string | null;
  archived_at: string | null;
};

export type CatalogPatch = {
  kind?: CatalogKind;
  name?: string;
  unit?: string;
  unit_cost_cents?: number;
  unit_price_cents?: number;
  waste_pct?: string;
  vendor?: string | null;
  sku?: string | null;
  tax_code?: string | null;
};

export type CatalogCreate = {
  kind: CatalogKind;
  name: string;
  unit: string;
  unit_cost_cents: number;
  unit_price_cents: number;
  waste_pct?: string;
  vendor?: string | null;
  sku?: string | null;
  tax_code?: string | null;
};

export type ImportChange = { field: string; from: string | null; to: string | null };

export type ImportPlan = {
  apply: boolean;
  created: { sku: string; name: string }[];
  updated: { sku: string; changes: ImportChange[] }[];
  unchanged: string[];
  errors: { row: number; message: string }[];
};

export const MEASURE_KINDS = ["area", "length", "count"] as const;
export type MeasureKind = (typeof MEASURE_KINDS)[number];

export const TAKEOFF_CATEGORIES = [
  "paving",
  "landscape",
  "hardscape",
  "concrete",
  "striping",
  "other",
] as const;
export type TakeoffCategory = (typeof TAKEOFF_CATEGORIES)[number];

export type TakeoffItem = {
  id: string;
  name: string;
  measure_kind: MeasureKind;
  default_unit: string;
  category: TakeoffCategory | null;
  color: string | null;
  archived_at: string | null;
};

export type TakeoffPatch = {
  name?: string;
  measure_kind?: MeasureKind;
  default_unit?: string;
  category?: TakeoffCategory | null;
  color?: string | null;
  archived?: boolean;
};

export type TakeoffCreate = {
  name: string;
  measure_kind: MeasureKind;
  default_unit: string;
  category?: TakeoffCategory | null;
  color?: string | null;
};

export type RecipeStatus = "draft" | "active" | "archived";

export type RecipeComponent = {
  id: string;
  catalog_item_id: string;
  qty_formula: string;
  sort: number;
};

export type Recipe = {
  id: string;
  family_id: string;
  name: string;
  takeoff_item_id: string | null;
  input_unit: string;
  variables: Record<string, string>;
  version: number;
  status: RecipeStatus;
  components: RecipeComponent[];
  created_at: string;
  updated_at: string;
};

export type RecipeSummary = {
  id: string;
  family_id: string;
  name: string;
  takeoff_item_id: string | null;
  input_unit: string;
  version: number;
  status: RecipeStatus;
  created_at: string;
  updated_at: string;
};

export type RecipeWrite = {
  name: string;
  input_unit: string;
  takeoff_item_id: string | null;
  variables: Record<string, string>;
  components: { catalog_item_id: string; qty_formula: string; sort: number }[];
};

export type FormulaError = { message: string; position: number; length: number };

export type FormulaCheck = {
  ok: boolean;
  errors: FormulaError[];
  referenced_vars: string[];
};

export type PreviewBody = {
  input_qty: string;
  input_unit: string;
  variables?: Record<string, string>;
};

export type PreviewResult = {
  flagged: boolean;
  total_cost_cents?: number;
  components: {
    id: string;
    catalog_item_id: string;
    name: string;
    qty: string;
    flags: string[];
    errors: FormulaError[];
    unit_cost_cents?: number;
    cost_cents?: number;
  }[];
};

export type StarterResult = {
  catalog_created: string[];
  catalog_skipped: string[];
  takeoff_created: string[];
  takeoff_skipped: string[];
  recipes_created: string[];
  recipes_skipped: string[];
};

export function isCatalogKind(value: string): value is CatalogKind {
  return (CATALOG_KINDS as readonly string[]).includes(value);
}

export function isMeasureKind(value: string): value is MeasureKind {
  return (MEASURE_KINDS as readonly string[]).includes(value);
}

export function isTakeoffCategory(value: string): value is TakeoffCategory {
  return (TAKEOFF_CATEGORIES as readonly string[]).includes(value);
}
