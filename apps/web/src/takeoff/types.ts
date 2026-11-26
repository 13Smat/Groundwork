import type { GeoJsonGeometry } from "@groundwork/geo";

import type { SiteGeom } from "../crm/types";

export type MeasureKind = "area" | "length" | "count";
export type MeasureSource = "manual" | "ai_assist" | "ai_auto";
export type DrawTool = "select" | "polygon" | "linestring" | "point" | "ruler" | "hole" | "split";
export type DrawMode = "polygon" | "linestring" | "point";

export type ImageryCapture = {
  id: string;
  sourceId: string;
  provider: string;
  name: string;
  captureDate: string;
  gsdCm: number;
  bands: string;
  leaf: "on" | "off" | "mixed" | "unknown" | null;
  attribution: string | null;
  ageDays: number;
  warnings: string[];
};

export type TakeoffRecord = {
  id: string;
  job_id: string;
  location_id: string | null;
  lineage_id: string;
  supersedes_id: string | null;
  kind: "aerial" | "planset";
  imagery_capture_id: string | null;
  status: "draft" | "in_review" | "final";
  version: number;
  measurement_count: number;
  warnings: string[];
  created_at: string;
  updated_at: string;
};

export type ServerMeasure = {
  value_m2: string | null;
  value_m: string | null;
  count: number | null;
  display: {
    ft2: string | null;
    yd2: string | null;
    acres: string | null;
    ft: string | null;
  };
};

export type MeasurementFeature = {
  type: "Feature";
  id: string;
  geometry: GeoJsonGeometry;
  properties: {
    takeoff_item_id: string;
    kind: MeasureKind;
    value_m2: string | null;
    value_m: string | null;
    count: number | null;
    source: MeasureSource;
    confidence: number | null;
    label: string | null;
    deductions: unknown[];
    display: ServerMeasure["display"];
  };
};

export type MeasurementCollection = {
  type: "FeatureCollection";
  features: MeasurementFeature[];
  corrections: { id: string; reason: "self_intersection"; geometry: GeoJsonGeometry }[];
  overlaps: { takeoff_item_id: string; measurement_ids: [string, string] }[];
};

export type SummaryItem = {
  takeoff_item_id: string;
  name: string;
  measure_kind: MeasureKind;
  sum_m2: string | null;
  sum_m: string | null;
  union_m2: string | null;
  union_m: string | null;
  count: number | null;
  overlap_count: number;
  display: {
    sum_ft2: string | null;
    sum_yd2: string | null;
    sum_acres: string | null;
    union_ft2: string | null;
    union_yd2: string | null;
    union_acres: string | null;
    sum_ft: string | null;
    union_ft: string | null;
  };
};

export type TakeoffItemRow = {
  id: string;
  name: string;
  measure_kind: MeasureKind;
  default_unit: string;
  category: string | null;
  color: string | null;
  archived_at: string | null;
};

export type EditorFeature = {
  id: string;
  mode: DrawMode;
  itemId: string;
  kind: MeasureKind;
  label: string | null;
  source: MeasureSource;
  geometry: GeoJsonGeometry;
  hidden: boolean;
  server: ServerMeasure | null;
  measuredKey: string | null;
};

export type CommitFeature = {
  id: string;
  mode: DrawMode | "ruler";
  itemId: string | null;
  kind: MeasureKind | null;
  label: string | null;
  source: MeasureSource;
  geometry: GeoJsonGeometry;
  hidden: boolean;
};

export type LoadFeature = {
  id: string;
  mode: DrawMode;
  geometry: GeoJsonGeometry;
  itemId: string;
  itemColor: string;
  kind: MeasureKind;
  label: string | null;
  source: MeasureSource;
};

export type ActiveItem = {
  id: string;
  kind: MeasureKind;
  color: `#${string}`;
};

export type ReferenceParcel = SiteGeom;
