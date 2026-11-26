import { displayFromMetric, type GeoJsonGeometry } from "@groundwork/geo";

import type { ImageryStamp, StoredFeature } from "./data.js";

export type ExportImagery = {
  provider: string;
  name: string;
  capture_date: string;
  gsd_cm: string;
  attribution: string | null;
};

function present(feature: StoredFeature) {
  const area = feature.kind === "area" ? feature.value_m2 : null;
  const length = feature.kind === "length" ? feature.value_m : null;
  const deductions = Array.isArray(feature.deductions) ? feature.deductions : [];
  return {
    type: "Feature" as const,
    id: feature.id,
    geometry: feature.geometry,
    properties: {
      takeoff_item_id: feature.takeoff_item_id,
      kind: feature.kind,
      value_m2: feature.value_m2,
      value_m: feature.value_m,
      count: feature.count,
      source: feature.source,
      confidence: feature.confidence,
      label: feature.label,
      deductions,
      display: {
        ft2: area ? displayFromMetric(area, "ft2") : null,
        yd2: area ? displayFromMetric(area, "yd2") : null,
        acres: area ? displayFromMetric(area, "acre") : null,
        ft: length ? displayFromMetric(length, "ft") : null,
      },
    },
  };
}

export function imageryOf(stamp: ImageryStamp | null): ExportImagery | null {
  if (!stamp) {
    return null;
  }
  return {
    provider: stamp.provider,
    name: stamp.name,
    capture_date: stamp.capture_date,
    gsd_cm: stamp.gsd_cm,
    attribution: stamp.attribution,
  };
}

/** GeoJSON FeatureCollection plus the capture stamp proposals can read. */
export function exportCollection(features: readonly StoredFeature[], stamp: ImageryStamp | null) {
  return {
    type: "FeatureCollection" as const,
    features: features.map(present),
    imagery: imageryOf(stamp),
  };
}

export function geometriesOf(features: readonly StoredFeature[]): {
  kind: StoredFeature["kind"];
  geometry: GeoJsonGeometry;
}[] {
  return features.map((feature) => ({ kind: feature.kind, geometry: feature.geometry }));
}
