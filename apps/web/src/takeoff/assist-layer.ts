import type { GeoJsonGeometry } from "@groundwork/geo";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

/**
 * Draft polygons are a MapLibre layer, not Terra Draw features. They are not
 * part of the measurement save until Accept copies them in. ADR 0018.
 */
export type AssistPromptMode = "off" | "positive" | "negative" | "box";

export type AssistBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type AssistDraft = {
  id: string;
  geometry: GeoJsonGeometry;
};

const EMPTY = { type: "FeatureCollection" as const, features: [] };

type PointerHandlers = {
  mode: () => AssistPromptMode;
  onPoint: (lng: number, lat: number) => void;
  onBox: (box: AssistBox) => void;
};

export function syncDraftLayer(map: MapLibreMap, drafts: readonly AssistDraft[]): void {
  const data = {
    type: "FeatureCollection" as const,
    features: drafts
      .filter(
        (draft) => draft.geometry.type === "Polygon" || draft.geometry.type === "MultiPolygon",
      )
      .map((draft) => ({
        type: "Feature" as const,
        id: draft.id,
        properties: {},
        geometry: draft.geometry,
      })),
  };
  const existing = map.getSource("assist-drafts");
  if (existing?.type === "geojson") {
    (existing as GeoJSONSource).setData(data);
    return;
  }
  map.addSource("assist-drafts", { type: "geojson", data });
  map.addLayer({
    id: "assist-draft-fill",
    type: "fill",
    source: "assist-drafts",
    paint: { "fill-color": "#1c4e80", "fill-opacity": 0.18 },
  });
  map.addLayer({
    id: "assist-draft-line",
    type: "line",
    source: "assist-drafts",
    paint: {
      "line-color": "#1c4e80",
      "line-width": 2,
      "line-dasharray": [2, 2],
    },
  });
}

export function clearDraftLayer(map: MapLibreMap): void {
  const existing = map.getSource("assist-drafts");
  if (existing?.type === "geojson") {
    (existing as GeoJSONSource).setData(EMPTY);
  }
}

export function applyAssistMode(map: MapLibreMap, mode: AssistPromptMode): void {
  if (mode === "box") {
    map.dragPan.disable();
    return;
  }
  if (!map.dragPan.isEnabled()) {
    map.dragPan.enable();
  }
}

export function bindAssistPointers(map: MapLibreMap, handlers: PointerHandlers): () => void {
  let start: { lng: number; lat: number } | null = null;

  const onClick = (event: { lngLat: { lng: number; lat: number } }) => {
    const mode = handlers.mode();
    if (mode !== "positive" && mode !== "negative") {
      return;
    }
    handlers.onPoint(event.lngLat.lng, event.lngLat.lat);
  };

  const onMouseDown = (event: {
    lngLat: { lng: number; lat: number };
    preventDefault: () => void;
  }) => {
    if (handlers.mode() !== "box") {
      return;
    }
    map.dragPan.disable();
    event.preventDefault();
    start = { lng: event.lngLat.lng, lat: event.lngLat.lat };
  };

  const onMouseUp = (event: { lngLat: { lng: number; lat: number } }) => {
    if (!start || handlers.mode() !== "box") {
      start = null;
      return;
    }
    const box = normalizeBox(start, event.lngLat);
    start = null;
    if (box.east - box.west < 1e-7 || box.north - box.south < 1e-7) {
      return;
    }
    handlers.onBox(box);
  };

  map.on("click", onClick);
  map.on("mousedown", onMouseDown);
  map.on("mouseup", onMouseUp);
  return () => {
    map.off("click", onClick);
    map.off("mousedown", onMouseDown);
    map.off("mouseup", onMouseUp);
    start = null;
  };
}

function normalizeBox(
  start: { lng: number; lat: number },
  end: { lng: number; lat: number },
): AssistBox {
  return {
    west: Math.min(start.lng, end.lng),
    south: Math.min(start.lat, end.lat),
    east: Math.max(start.lng, end.lng),
    north: Math.max(start.lat, end.lat),
  };
}
