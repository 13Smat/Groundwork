import { createId, isUuidV7 } from "@groundwork/shared";
import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  setWorkerUrl,
  type RasterTileSource,
  type StyleSpecification,
} from "maplibre-gl";
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
  type GeoJSONStoreGeometries,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

import type { GeoJsonGeometry } from "@groundwork/geo";

import {
  applyAssistMode,
  bindAssistPointers,
  clearDraftLayer,
  syncDraftLayer,
  type AssistBox,
  type AssistDraft,
  type AssistPromptMode,
} from "./assist-layer";
import { tileTemplate } from "./imagery";
import { kindForMode, liveTotal } from "./quantities";
import type {
  ActiveItem,
  CommitFeature,
  DrawTool,
  LoadFeature,
  MeasureKind,
  MeasureSource,
  ReferenceParcel,
} from "./types";

import "maplibre-gl/dist/maplibre-gl.css";

export type DrawApi = {
  setMode: (mode: DrawTool) => void;
  load: (features: readonly LoadFeature[]) => void;
  highlight: (itemId: string | null) => void;
  setHidden: (itemId: string, hidden: boolean) => void;
  setLabel: (id: string, label: string | null) => void;
  remove: (id: string) => void;
  selectFeature: (id: string) => void;
  finish: () => void;
  replaceGeometry: (id: string, geometry: GeoJsonGeometry) => void;
};

type LatLng = { lat: number; lng: number };

function coordinate(value: number[]): [number, number] | null {
  const lng = value[0];
  const lat = value[1];
  if (lng === undefined || lat === undefined || !Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }
  return [lng, lat];
}

function asGeometry(geometry: GeoJSONStoreGeometries): GeoJsonGeometry | null {
  if (geometry.type === "Point") {
    const point = coordinate(geometry.coordinates);
    return point ? { type: "Point", coordinates: point } : null;
  }
  if (geometry.type === "LineString") {
    const line = geometry.coordinates.map((position) => coordinate(position));
    if (line.some((position) => position === null)) {
      return null;
    }
    return { type: "LineString", coordinates: line as [number, number][] };
  }
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates.map((ring) => ring.map((position) => coordinate(position)));
    if (rings.some((ring) => ring.some((position) => position === null))) {
      return null;
    }
    return { type: "Polygon", coordinates: rings as [number, number][][] };
  }
  return null;
}

function fields(feature: GeoJSONStoreFeatures): Record<string, unknown> {
  return feature.properties as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function sourceOf(value: unknown): MeasureSource {
  if (value === "ai_assist" || value === "ai_auto" || value === "manual") {
    return value;
  }
  return "manual";
}

function kindOf(value: unknown): MeasureKind | null {
  if (value === "area" || value === "length" || value === "count") {
    return value;
  }
  return null;
}

function styleColor(feature: GeoJSONStoreFeatures, fallback: `#${string}`): `#${string}` {
  const raw = fields(feature).itemColor;
  if (typeof raw === "string" && /^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw as `#${string}`;
  }
  return fallback;
}

function shown(feature: GeoJSONStoreFeatures, value: number): number {
  return fields(feature).hidden === true ? 0 : value;
}

function width(feature: GeoJSONStoreFeatures, value: number): number {
  return fields(feature).highlighted === true ? value + 3 : value;
}

/** No glyphs, no sprite, and no tile URL. `load` must not wait on the network. */
function paperStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "paper", type: "background", paint: { "background-color": "#d9d1c3" } }],
  };
}

function addImagery(map: MapLibreMap, captureId: string) {
  if (map.getSource("imagery")) {
    return;
  }
  map.addSource("imagery", {
    type: "raster",
    tiles: [tileTemplate(captureId)],
    tileSize: 256,
  });
  map.addLayer({ id: "imagery", type: "raster", source: "imagery" });
}

function tileFailure(message: string): boolean {
  return message.includes("/imagery/tiles/");
}

/**
 * Parcel and site pin are ordinary GeoJSON layers. They are not Terra Draw
 * features, so they cannot be edited and they never clip a measurement.
 */
function addReference(map: MapLibreMap, point: LatLng | null, parcel: ReferenceParcel | null) {
  if (parcel) {
    map.addSource("parcel", {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: parcel },
    });
    map.addLayer({
      id: "parcel-fill",
      type: "fill",
      source: "parcel",
      paint: { "fill-color": "#7a3410", "fill-opacity": 0.12 },
    });
    map.addLayer({
      id: "parcel-line",
      type: "line",
      source: "parcel",
      paint: { "line-color": "#7a3410", "line-width": 2, "line-dasharray": [2, 1] },
    });
  }
  if (point) {
    map.addSource("site", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [point.lng, point.lat] },
      },
    });
    map.addLayer({
      id: "site-point",
      type: "circle",
      source: "site",
      paint: {
        "circle-radius": 6,
        "circle-color": "#1c1915",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#f4f0e6",
      },
    });
  }
}

export function TakeoffMap({
  workspaceId,
  captureId,
  point,
  parcel,
  activeItem,
  hiddenItemIds,
  onReady,
  onCommit,
  onSelect,
  onLive,
  onRuler,
  onReject,
  assistMode,
  assistDrafts,
  onAssistPoint,
  onAssistBox,
}: {
  workspaceId: string;
  captureId: string;
  point: LatLng | null;
  parcel: ReferenceParcel | null;
  activeItem: ActiveItem | null;
  hiddenItemIds: ReadonlySet<string>;
  onReady: (api: DrawApi) => void;
  onCommit: (features: CommitFeature[]) => void;
  onSelect: (id: string | null) => void;
  onLive: (text: string | null) => void;
  onRuler: (text: string | null) => void;
  onReject: (message: string) => void;
  assistMode?: AssistPromptMode;
  assistDrafts?: readonly AssistDraft[];
  onAssistPoint?: (lng: number, lat: number) => void;
  onAssistBox?: (box: AssistBox) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [status, setStatus] = useState("Starting the map.");
  const [generation, setGeneration] = useState(0);
  const workspaceRef = useRef(workspaceId);
  const captureRef = useRef(captureId);
  const itemRef = useRef(activeItem);
  const hiddenRef = useRef(hiddenItemIds);
  const colorRef = useRef<`#${string}`>(activeItem?.color ?? "#2c2c2c");
  const onReadyRef = useRef(onReady);
  const onCommitRef = useRef(onCommit);
  const onSelectRef = useRef(onSelect);
  const onLiveRef = useRef(onLive);
  const onRulerRef = useRef(onRuler);
  const onRejectRef = useRef(onReject);
  const assistModeRef = useRef<AssistPromptMode>(assistMode ?? "off");
  const onAssistPointRef = useRef(onAssistPoint);
  const onAssistBoxRef = useRef(onAssistBox);

  useEffect(() => {
    workspaceRef.current = workspaceId;
    captureRef.current = captureId;
    itemRef.current = activeItem;
    hiddenRef.current = hiddenItemIds;
    colorRef.current = activeItem?.color ?? "#2c2c2c";
    onReadyRef.current = onReady;
    onCommitRef.current = onCommit;
    onSelectRef.current = onSelect;
    onLiveRef.current = onLive;
    onRulerRef.current = onRuler;
    onRejectRef.current = onReject;
    assistModeRef.current = assistMode ?? "off";
    onAssistPointRef.current = onAssistPoint;
    onAssistBoxRef.current = onAssistBox;
  }, [
    activeItem,
    captureId,
    hiddenItemIds,
    onCommit,
    onLive,
    onReady,
    onReject,
    onRuler,
    onSelect,
    assistMode,
    onAssistBox,
    onAssistPoint,
    workspaceId,
  ]);

  const pointKey = point ? `${point.lat},${point.lng}` : "";
  const parcelKey = parcel ? JSON.stringify(parcel) : "";

  useEffect(() => {
    const node = container.current;
    if (!node) {
      return;
    }
    let cancelled = false;
    let map: MapLibreMap | undefined;
    let draw: TerraDraw | undefined;
    let unbindAssist: (() => void) | undefined;
    const gate = { silent: false, key: "" };
    const currentPoint = pointKey === "" ? null : parsePoint(pointKey);
    const currentParcel = parcelKey === "" ? null : (JSON.parse(parcelKey) as ReferenceParcel);

    let settled = false;
    let failed = false;
    const timer = window.setTimeout(() => {
      if (!cancelled && !settled && !failed) {
        setStatus("The map could not start.");
      }
    }, 8_000);

    void (async () => {
      try {
        const worker = await import("maplibre-gl/dist/maplibre-gl-worker.mjs?url");
        if (cancelled || !container.current) {
          return;
        }
        setWorkerUrl(worker.default);
        map = new MapLibreMap({
          container: container.current,
          center: currentPoint
            ? [currentPoint.lng, currentPoint.lat]
            : [-81.702575683594, 35.7487413496845],
          zoom: 17,
          maxPitch: 0,
          pitch: 0,
          dragRotate: false,
          pitchWithRotate: false,
          attributionControl: false,
          maplibreLogo: false,
          localIdeographFontFamily: "sans-serif",
          style: paperStyle(),
          transformRequest: (url) => {
            const currentWorkspace = workspaceRef.current;
            if (!currentWorkspace || !url.includes("/imagery/tiles/")) {
              return { url };
            }
            return {
              url,
              headers: { "x-workspace-id": currentWorkspace },
              credentials: "include" as const,
            };
          },
        });
        mapRef.current = map;
        map.on("error", (event) => {
          const detail = event.error instanceof Error ? event.error.message : "unknown map error";
          console.error("takeoff map error", detail);
          if (tileFailure(detail) || cancelled || settled) {
            return;
          }
          failed = true;
          window.clearTimeout(timer);
          setStatus(`The map could not start. ${detail}`);
        });
        map.on("load", () => {
          if (cancelled || !map) {
            return;
          }
          settled = true;
          window.clearTimeout(timer);
          addImagery(map, captureRef.current);
          addReference(map, currentPoint, currentParcel);
          const color = () => colorRef.current;
          draw = new TerraDraw({
            adapter: new TerraDrawMapLibreGLAdapter({ map }),
            idStrategy: {
              isValidId: (id) => typeof id === "string" && isUuidV7(id),
              getId: () => createId(),
            },
            modes: [
              new TerraDrawSelectMode({
                flags: {
                  polygon: {
                    feature: {
                      draggable: true,
                      coordinates: { midpoints: true, draggable: true, deletable: true },
                    },
                  },
                  linestring: {
                    feature: {
                      draggable: true,
                      coordinates: { midpoints: true, draggable: true, deletable: true },
                    },
                  },
                  point: { feature: { draggable: true } },
                },
              }),
              new TerraDrawPolygonMode({
                styles: {
                  fillColor: (feature) => styleColor(feature, color()),
                  fillOpacity: (feature) => shown(feature, 0.35),
                  outlineColor: (feature) => styleColor(feature, color()),
                  outlineWidth: (feature) => width(feature, 2),
                  outlineOpacity: (feature) => shown(feature, 1),
                },
              }),
              new TerraDrawLineStringMode({
                styles: {
                  lineStringColor: (feature) => styleColor(feature, color()),
                  lineStringWidth: (feature) => width(feature, 2),
                  lineStringOpacity: (feature) => shown(feature, 1),
                },
              }),
              new TerraDrawPointMode({
                styles: {
                  pointColor: (feature) => styleColor(feature, color()),
                  pointWidth: (feature) =>
                    fields(feature).hidden === true ? 0 : width(feature, 8),
                  pointOpacity: (feature) => shown(feature, 1),
                  pointOutlineColor: (feature) => styleColor(feature, color()),
                  pointOutlineWidth: 2,
                },
              }),
              new TerraDrawLineStringMode({
                modeName: "ruler",
                styles: {
                  lineStringColor: "#7a3410",
                  lineStringWidth: 2,
                  lineStringOpacity: 1,
                },
              }),
            ],
          });
          const instance = draw;
          const committed = () => collect(instance);
          const publish = () => {
            if (gate.silent) {
              return;
            }
            const features = committed().filter((feature) => feature.mode !== "ruler");
            const key = JSON.stringify(
              features.map((feature) => [
                feature.id,
                feature.geometry,
                feature.label,
                feature.hidden,
                feature.itemId,
              ]),
            );
            if (key !== gate.key) {
              gate.key = key;
              onCommitRef.current(features);
            }
            onLiveRef.current(drawingText(instance));
          };
          instance.on("finish", (id, context) => {
            if (typeof id !== "string") {
              return;
            }
            if (context.mode === "ruler") {
              const feature = instance.getSnapshotFeature(id);
              const geometry = feature ? asGeometry(feature.geometry) : null;
              onRulerRef.current(
                geometry && geometry.type === "LineString" ? liveTotal("length", [geometry]) : null,
              );
              return;
            }
            const item = itemRef.current;
            const mode = context.mode;
            if (mode !== "polygon" && mode !== "linestring" && mode !== "point") {
              return;
            }
            const kind = kindForMode(mode);
            if (!item || item.kind !== kind) {
              instance.removeFeatures([id]);
              onRejectRef.current(`Select a ${kind} takeoff item before using that tool.`);
              publish();
              return;
            }
            instance.updateFeatureProperties(id, {
              takeoffItemId: item.id,
              itemColor: item.color,
              measureKind: kind,
              label: "",
              source: "manual",
              hidden: hiddenRef.current.has(item.id),
              highlighted: false,
            });
            publish();
          });
          instance.on("change", (_ids, _type, context) => {
            if (context && "origin" in context && context.origin === "api") {
              return;
            }
            publish();
          });
          instance.on("select", (id) => {
            if (typeof id === "string") {
              onSelectRef.current(id);
            }
          });
          instance.on("deselect", () => {
            onSelectRef.current(null);
          });
          instance.start();
          instance.setMode("select");
          map.resize();
          if (map.getLayer("parcel-line")) {
            map.moveLayer("parcel-line");
          }
          if (map.getLayer("site-point")) {
            map.moveLayer("site-point");
          }
          const canvas = map.getCanvas();
          canvas.tabIndex = 0;
          canvas.setAttribute("aria-label", "Takeoff drawing surface");
          const api: DrawApi = {
            setMode(mode) {
              if (instance.getMode() === "ruler" && mode !== "ruler") {
                const rulers = committed()
                  .filter((feature) => feature.mode === "ruler")
                  .map((feature) => feature.id);
                if (rulers.length > 0) {
                  instance.removeFeatures(rulers);
                }
              }
              instance.setMode(mode);
            },
            load(features) {
              gate.silent = true;
              try {
                const existing = instance
                  .getSnapshot()
                  .map((feature) => feature.id)
                  .filter((id): id is string => typeof id === "string");
                if (existing.length > 0) {
                  instance.removeFeatures(existing);
                }
                if (features.length > 0) {
                  const result = instance.addFeatures(
                    features.map((feature) => ({
                      type: "Feature" as const,
                      id: feature.id,
                      geometry: feature.geometry as GeoJSONStoreGeometries,
                      properties: {
                        mode: feature.mode,
                        takeoffItemId: feature.itemId,
                        itemColor: feature.itemColor,
                        measureKind: feature.kind,
                        label: feature.label ?? "",
                        source: feature.source,
                        hidden: false,
                        highlighted: false,
                      },
                    })),
                  );
                  if (result.some((item) => item.valid === false)) {
                    onRejectRef.current("Some saved measurements could not be drawn.");
                  }
                }
              } finally {
                gate.silent = false;
                gate.key = JSON.stringify(
                  committed()
                    .filter((feature) => feature.mode !== "ruler")
                    .map((feature) => [
                      feature.id,
                      feature.geometry,
                      feature.label,
                      feature.hidden,
                      feature.itemId,
                    ]),
                );
              }
            },
            highlight(itemId) {
              for (const feature of committed()) {
                if (feature.mode === "ruler") {
                  continue;
                }
                instance.updateFeatureProperties(feature.id, {
                  highlighted: feature.itemId === itemId,
                });
              }
            },
            setHidden(itemId, hidden) {
              for (const feature of committed()) {
                if (feature.itemId === itemId) {
                  instance.updateFeatureProperties(feature.id, { hidden });
                }
              }
              publish();
            },
            setLabel(id, label) {
              instance.updateFeatureProperties(id, { label: label ?? "" });
              publish();
            },
            remove(id) {
              instance.removeFeatures([id]);
              publish();
            },
            selectFeature(id) {
              instance.selectFeature(id);
            },
            finish() {
              const canvas = map?.getCanvas();
              if (!canvas) {
                return;
              }
              canvas.focus();
              canvas.dispatchEvent(
                new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true }),
              );
            },
            replaceGeometry(id, geometry) {
              gate.silent = true;
              try {
                instance.updateFeatureGeometry(id, geometry as GeoJSONStoreGeometries);
              } catch {
                onRejectRef.current("The corrected shape could not be drawn.");
              } finally {
                gate.silent = false;
                gate.key = JSON.stringify(
                  committed()
                    .filter((feature) => feature.mode !== "ruler")
                    .map((feature) => [
                      feature.id,
                      feature.geometry,
                      feature.label,
                      feature.hidden,
                      feature.itemId,
                    ]),
                );
              }
            },
          };
          if (!cancelled) {
            unbindAssist = bindAssistPointers(map, {
              mode: () => assistModeRef.current,
              onPoint: (lng, lat) => onAssistPointRef.current?.(lng, lat),
              onBox: (box) => onAssistBoxRef.current?.(box),
            });
            onReadyRef.current(api);
            setStatus("Map ready");
            setGeneration((value) => value + 1);
          }
        });
      } catch {
        if (!cancelled) {
          setStatus("The map could not start.");
        }
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unbindAssist?.();
      try {
        draw?.stop();
      } catch {
        // The map may already be gone.
      }
      map?.remove();
      mapRef.current = null;
    };
  }, [parcelKey, pointKey]);

  useEffect(() => {
    if (generation === 0) {
      return;
    }
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const source = map.getSource("imagery");
    if (source?.type === "raster") {
      (source as RasterTileSource).setTiles([tileTemplate(captureId)]);
    }
  }, [captureId, generation]);

  useEffect(() => {
    if (generation === 0) {
      return;
    }
    const map = mapRef.current;
    if (!map) {
      return;
    }
    applyAssistMode(map, assistMode ?? "off");
  }, [assistMode, generation]);

  useEffect(() => {
    if (generation === 0) {
      return;
    }
    const map = mapRef.current;
    if (!map) {
      return;
    }
    if (assistDrafts === undefined) {
      clearDraftLayer(map);
      return;
    }
    syncDraftLayer(map, assistDrafts);
  }, [assistDrafts, generation]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={container}
        className="h-[28rem] w-full overflow-hidden rounded-md border border-line"
        role="region"
        aria-label="Takeoff map"
      />
      <p role="status">{status}</p>
    </div>
  );
}

function parsePoint(value: string): LatLng | null {
  const [lat, lng] = value.split(",").map(Number);
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

function collect(draw: TerraDraw): CommitFeature[] {
  const committed: CommitFeature[] = [];
  for (const feature of draw.getSnapshot()) {
    if (typeof feature.id !== "string") {
      continue;
    }
    const props = fields(feature);
    if (props.currentlyDrawing === true) {
      continue;
    }
    const mode = props.mode;
    if (mode !== "polygon" && mode !== "linestring" && mode !== "point" && mode !== "ruler") {
      continue;
    }
    const geometry = asGeometry(feature.geometry);
    if (!geometry) {
      continue;
    }
    if (mode === "polygon" && geometry.type !== "Polygon") {
      continue;
    }
    if ((mode === "linestring" || mode === "ruler") && geometry.type !== "LineString") {
      continue;
    }
    if (mode === "point" && geometry.type !== "Point") {
      continue;
    }
    committed.push({
      id: feature.id,
      mode,
      itemId: text(props.takeoffItemId),
      kind: mode === "ruler" ? null : kindOf(props.measureKind),
      label: text(props.label),
      source: sourceOf(props.source),
      geometry,
      hidden: props.hidden === true,
    });
  }
  return committed;
}

function drawingText(draw: TerraDraw): string | null {
  for (const feature of draw.getSnapshot()) {
    const props = fields(feature);
    if (props.currentlyDrawing !== true) {
      continue;
    }
    const geometry = asGeometry(feature.geometry);
    if (!geometry) {
      continue;
    }
    if (props.mode === "polygon" && geometry.type === "Polygon") {
      return liveTotal("area", [geometry]);
    }
    if (
      (props.mode === "linestring" || props.mode === "ruler") &&
      geometry.type === "LineString" &&
      geometry.coordinates.length >= 2
    ) {
      return liveTotal("length", [geometry]);
    }
  }
  return null;
}
