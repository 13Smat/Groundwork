export type EstimateStatus = "draft" | "ready" | "sent" | "accepted" | "superseded";

export type EstimateLine = {
  id: string;
  group: string | null;
  description: string;
  qty: string;
  unit: string;
  unit_price_cents: number;
  price_cents: number;
  tax_cents: number;
  unit_cost_cents?: number;
  cost_cents?: number;
  margin_cents?: number;
  margin_pct?: string | null;
  source: "recipe" | "manual";
  recipe_id: string | null;
  takeoff_item_id: string | null;
  input_qty: string | null;
  input_unit: string | null;
  variables: Record<string, string>;
  recipe_variables: Record<string, string>;
  flagged: boolean;
  optional: boolean;
  sort: number;
};

export type Estimate = {
  id: string;
  job_id: string;
  takeoff_id: string | null;
  number: string;
  version: number;
  status: EstimateStatus;
  markup_pct: string;
  overhead_pct: string;
  tax_rate: string;
  notes: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  optional_subtotal_cents: number;
  optional_tax_cents: number;
  optional_total_cents: number;
  cost_cents?: number;
  margin_cents?: number;
  margin_pct?: string | null;
  lines: EstimateLine[];
};

export type EstimateSummary = {
  id: string;
  job_id: string;
  takeoff_id: string | null;
  number: string;
  version: number;
  status: EstimateStatus;
  total_cents: number;
  updated_at: string;
};

export type QuantityItem = {
  change: "added" | "removed" | "changed";
  takeoff_item_id: string;
  name: string;
  unit: string;
  old_qty: string | null;
  new_qty: string | null;
};

export type QuantityDiff = {
  compared_takeoff_id: string | null;
  compared_takeoff_version: number | null;
  items: QuantityItem[];
};

export type TakeoffChoice = {
  id: string;
  version: number;
  status: string;
};
