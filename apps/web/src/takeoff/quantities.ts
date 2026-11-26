import {
  displayFromMetric,
  geodesicAreaM2,
  geodesicLengthM,
  type GeoJsonGeometry,
  type LngLat,
} from "@groundwork/geo";

import type {
  CommitFeature,
  DrawMode,
  EditorFeature,
  LoadFeature,
  MeasureKind,
  MeasurementCollection,
  SummaryItem,
  TakeoffItemRow,
} from "./types";

const HEX = /^#[0-9a-fA-F]{6}$/;
const FALLBACK = ["#2c2c2c", "#7a3410", "#3f6b3a", "#1c4e80", "#6a4332", "#f2c200"] as const;

export function itemColor(color: string | null, index: number): `#${string}` {
  if (color && HEX.test(color)) {
    return color.toLowerCase() as `#${string}`;
  }
  return FALLBACK[index % FALLBACK.length] ?? "#2c2c2c";
}

export function geometryKey(geometry: GeoJsonGeometry): string {
  return JSON.stringify(geometry);
}

export function showsServer(feature: EditorFeature): boolean {
  return feature.server !== null && feature.measuredKey === geometryKey(feature.geometry);
}

export function kindForMode(mode: DrawMode): MeasureKind {
  if (mode === "polygon") {
    return "area";
  }
  if (mode === "linestring") {
    return "length";
  }
  return "count";
}

export function modeForKind(kind: MeasureKind): DrawMode {
  if (kind === "area") {
    return "polygon";
  }
  if (kind === "length") {
    return "linestring";
  }
  return "point";
}

function metric(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "0.0000";
  }
  return value.toFixed(4);
}

export function liveTotal(kind: MeasureKind, geometries: readonly GeoJsonGeometry[]): string {
  if (geometries.length === 0) {
    return kind === "count" ? "0" : "—";
  }
  if (kind === "count") {
    return String(geometries.length);
  }
  if (kind === "area") {
    const sum = geometries.reduce((total, geometry) => total + geodesicAreaM2(geometry), 0);
    const feet = displayFromMetric(metric(sum), "ft2");
    const yards = displayFromMetric(metric(sum), "yd2");
    return `${feet} ft² · ${yards} yd²`;
  }
  const sum = geometries.reduce((total, geometry) => total + geodesicLengthM(geometry), 0);
  return `${displayFromMetric(metric(sum), "ft")} ft`;
}

export function summaryTotal(item: SummaryItem): string {
  if (item.measure_kind === "area") {
    return `${item.display.sum_ft2 ?? "—"} ft² · ${item.display.sum_yd2 ?? "—"} yd²`;
  }
  if (item.measure_kind === "length") {
    return `${item.display.sum_ft ?? "—"} ft`;
  }
  return String(item.count ?? 0);
}

export type SummaryMode = "sum" | "union";

export function summaryQuantity(item: SummaryItem, mode: SummaryMode): string {
  return mode === "union" ? summaryUnion(item) : summaryTotal(item);
}

export function correctionNotice(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  const noun = count === 1 ? "shape" : "shapes";
  return `The server corrected ${count} self-intersecting ${noun}. The corrected outline is shown.`;
}

export function overlapNotice(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  if (count === 1) {
    return "One pair of measurements for the same item overlaps. The summary can use the union.";
  }
  return `${count} pairs of measurements for the same item overlap. The summary can use the union.`;
}

export function summaryUnion(item: SummaryItem): string {
  if (item.measure_kind === "area") {
    return item.display.union_ft2 ? `${item.display.union_ft2} ft²` : "—";
  }
  if (item.measure_kind === "length") {
    return item.display.union_ft ? `${item.display.union_ft} ft` : "—";
  }
  return "—";
}

export function sourceBadge(source: EditorFeature["source"]): string {
  if (source === "ai_assist") {
    return "AI assist";
  }
  if (source === "ai_auto") {
    return "AI auto";
  }
  return "Manual";
}

function closeRing(ring: LngLat[]): LngLat[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) {
    return ring;
  }
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring;
  }
  return [...ring, first];
}

/** The API rejects an open polygon ring. Terra Draw usually closes it; this does too. */
export function measurementGeometry(geometry: GeoJsonGeometry): GeoJsonGeometry {
  if (geometry.type !== "Polygon") {
    return geometry;
  }
  return { type: "Polygon", coordinates: geometry.coordinates.map(closeRing) };
}

export function geometryMatchesMode(mode: DrawMode, geometry: GeoJsonGeometry): boolean {
  if (mode === "polygon") {
    return geometry.type === "Polygon";
  }
  if (mode === "linestring") {
    return geometry.type === "LineString";
  }
  return geometry.type === "Point";
}

export function mergeCommit(
  previous: readonly EditorFeature[],
  commit: readonly CommitFeature[],
): EditorFeature[] {
  const prior = new Map(previous.map((feature) => [feature.id, feature]));
  const next: EditorFeature[] = [];
  for (const feature of commit) {
    if (feature.mode === "ruler" || feature.itemId === null || feature.kind === null) {
      continue;
    }
    if (!geometryMatchesMode(feature.mode, feature.geometry)) {
      continue;
    }
    const existing = prior.get(feature.id);
    next.push({
      id: feature.id,
      mode: feature.mode,
      itemId: feature.itemId,
      kind: feature.kind,
      label: feature.label,
      source: feature.source,
      geometry: feature.geometry,
      hidden: feature.hidden,
      server: existing?.server ?? null,
      measuredKey: existing?.measuredKey ?? null,
    });
  }
  return next;
}

export function applyServer(
  features: readonly EditorFeature[],
  collection: MeasurementCollection,
): { features: EditorFeature[]; replaced: EditorFeature[] } {
  const saved = new Map(collection.features.map((feature) => [feature.id, feature]));
  const replaced: EditorFeature[] = [];
  const next = features.map((feature) => {
    const row = saved.get(feature.id);
    if (!row) {
      return feature;
    }
    const serverGeometry = geometryMatchesMode(feature.mode, row.geometry)
      ? row.geometry
      : feature.geometry;
    const updated: EditorFeature = {
      ...feature,
      geometry: serverGeometry,
      label: row.properties.label,
      source: row.properties.source,
      server: {
        value_m2: row.properties.value_m2,
        value_m: row.properties.value_m,
        count: row.properties.count,
        display: row.properties.display,
      },
      measuredKey: geometryKey(serverGeometry),
    };
    if (geometryKey(feature.geometry) !== geometryKey(serverGeometry)) {
      replaced.push(updated);
    }
    return updated;
  });
  return { features: next, replaced };
}

export function editorFeaturesFrom(
  collection: MeasurementCollection,
  items: readonly TakeoffItemRow[],
): { features: EditorFeature[]; load: LoadFeature[] } {
  const colors = new Map(items.map((item, index) => [item.id, itemColor(item.color, index)]));
  const features: EditorFeature[] = [];
  const load: LoadFeature[] = [];
  for (const feature of collection.features) {
    const mode = modeForKind(feature.properties.kind);
    if (!geometryMatchesMode(mode, feature.geometry)) {
      continue;
    }
    const color = colors.get(feature.properties.takeoff_item_id) ?? itemColor(null, 0);
    const editor: EditorFeature = {
      id: feature.id,
      mode,
      itemId: feature.properties.takeoff_item_id,
      kind: feature.properties.kind,
      label: feature.properties.label,
      source: feature.properties.source,
      geometry: feature.geometry,
      hidden: false,
      server: {
        value_m2: feature.properties.value_m2,
        value_m: feature.properties.value_m,
        count: feature.properties.count,
        display: feature.properties.display,
      },
      measuredKey: geometryKey(feature.geometry),
    };
    features.push(editor);
    load.push({
      id: editor.id,
      mode,
      geometry: editor.geometry,
      itemId: editor.itemId,
      itemColor: color,
      kind: editor.kind,
      label: editor.label,
      source: editor.source,
    });
  }
  return { features, load };
}

export function toLoadFeatures(
  features: readonly EditorFeature[],
  items: readonly TakeoffItemRow[],
): LoadFeature[] {
  const colors = new Map(items.map((item, index) => [item.id, itemColor(item.color, index)]));
  return features.map((feature) => ({
    id: feature.id,
    mode: feature.mode,
    geometry: feature.geometry,
    itemId: feature.itemId,
    itemColor: colors.get(feature.itemId) ?? itemColor(null, 0),
    kind: feature.kind,
    label: feature.label,
    source: feature.source,
  }));
}
