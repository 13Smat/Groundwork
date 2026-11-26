import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

import { massCollection, throttleDue } from "./render-budget";
import type { LoadFeature } from "./types";

const WAIT_MS = 100;

/** Simplified GeoJSON overlay. Terra Draw is not given every vertex. */
export function paintMass(
  map: MapLibreMap,
  features: readonly LoadFeature[],
  now = Date.now(),
): void {
  const data = massCollection(features);
  const existing = map.getSource("mass");
  if (existing?.type === "geojson") {
    const source = existing as GeoJSONSource;
    const last = Number(map.getCanvas().dataset.massAt ?? "0");
    if (!throttleDue(now, last, WAIT_MS)) {
      return;
    }
    map.getCanvas().dataset.massAt = String(now);
    source.setData(data);
    return;
  }
  map.getCanvas().dataset.massAt = String(now);
  map.addSource("mass", { type: "geojson", data });
  map.addLayer({
    id: "mass-fill",
    type: "fill",
    source: "mass",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.35 },
  });
  map.addLayer({
    id: "mass-line",
    type: "line",
    source: "mass",
    paint: { "line-color": ["get", "color"], "line-width": 1.5 },
  });
}

export function clearMass(map: MapLibreMap): void {
  if (map.getLayer("mass-line")) {
    map.removeLayer("mass-line");
  }
  if (map.getLayer("mass-fill")) {
    map.removeLayer("mass-fill");
  }
  if (map.getSource("mass")) {
    map.removeSource("mass");
  }
}
