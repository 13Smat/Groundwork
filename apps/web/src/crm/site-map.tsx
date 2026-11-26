import { useEffect, useRef, useState } from "react";
import type { Map, StyleSpecification } from "maplibre-gl";

import { api } from "../session";
import type { LatLng, SiteGeom } from "./types";

/**
 * Center of the seeded fixture chip (db/seed/fixtures/rgbir-cog.json).
 * The context map requests only the fixture_rgbir capture.
 */
const FIXTURE_CENTER: [number, number] = [-81.702575683594, 35.7487413496845];
const FIXTURE_BBOX = "-81.705322265625,35.746512259919,-81.699829101563,35.75097043945";

type Capture = { id: string; name: string; attribution: string | null };

export function SiteMap({
  enabled = true,
  workspaceId,
  point,
  parcel,
  interactive,
  onPick,
}: {
  enabled?: boolean;
  workspaceId: string | undefined;
  point: LatLng | null;
  parcel: SiteGeom | null;
  interactive: boolean;
  onPick?: (point: LatLng) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const onPickRef = useRef(onPick);
  const [mapError, setMapError] = useState("");
  const pointKey = point ? `${point.lat},${point.lng}` : "";
  const parcelKey = parcel ? JSON.stringify(parcel) : "";

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const node = container.current;
    if (!node) {
      return;
    }
    const currentPoint = parsePointKey(pointKey);
    const currentParcel = parcelKey === "" ? null : (JSON.parse(parcelKey) as SiteGeom);
    let cancelled = false;
    let map: Map | undefined;

    void (async () => {
      try {
        const capture = await loadFixtureCapture(workspaceId, currentPoint);
        if (cancelled) {
          return;
        }
        const maplibre = await import("maplibre-gl");
        const worker = await import("maplibre-gl/dist/maplibre-gl-worker.mjs?url");
        maplibre.setWorkerUrl(worker.default);
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (cancelled || !container.current) {
          return;
        }
        map = new maplibre.Map({
          container: container.current,
          center: currentPoint ? [currentPoint.lng, currentPoint.lat] : FIXTURE_CENTER,
          zoom: 16,
          style: styleFor(capture),
          attributionControl: {},
          transformRequest: (url) => {
            if (!workspaceId || !url.includes("/imagery/tiles/")) {
              return { url };
            }
            return {
              url,
              headers: { "x-workspace-id": workspaceId },
              credentials: "include" as const,
            };
          },
        });
        map.on("load", () => {
          if (!map) {
            return;
          }
          addOverlays(map, currentPoint, currentParcel);
          if (interactive) {
            map.getCanvas().style.cursor = "crosshair";
            map.on("click", (event) => {
              onPickRef.current?.({ lat: event.lngLat.lat, lng: event.lngLat.lng });
            });
          }
        });
      } catch {
        if (!cancelled) {
          setMapError("The map could not start.");
        }
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [enabled, workspaceId, pointKey, parcelKey, interactive]);

  if (!enabled) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={container}
        className="h-80 w-full overflow-hidden rounded-md border border-line"
        aria-label="Site map"
      />
      <p className="text-sm text-muted">Context only. This map is not a measurement.</p>
      {mapError ? (
        <p role="alert" className="text-base text-accent">
          {mapError}
        </p>
      ) : null}
    </div>
  );
}

function parsePointKey(value: string): LatLng | null {
  if (value === "") {
    return null;
  }
  const [lat, lng] = value.split(",").map(Number);
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

async function loadFixtureCapture(
  workspaceId: string | undefined,
  point: LatLng | null,
): Promise<Capture | null> {
  if (!workspaceId) {
    return null;
  }
  const bbox = point
    ? `${point.lng - 0.001},${point.lat - 0.001},${point.lng + 0.001},${point.lat + 0.001}`
    : FIXTURE_BBOX;
  try {
    const data = await api<{ captures: Capture[] }>(
      `/imagery/captures?bbox=${encodeURIComponent(bbox)}`,
    );
    return data.captures.find((capture) => capture.name === "fixture_rgbir") ?? null;
  } catch {
    return null;
  }
}

function styleFor(capture: Capture | null): StyleSpecification {
  if (!capture) {
    return {
      version: 8,
      sources: {},
      layers: [{ id: "paper", type: "background", paint: { "background-color": "#d9d1c3" } }],
    };
  }
  return {
    version: 8,
    sources: {
      fixture: {
        type: "raster",
        tiles: [`/imagery/tiles/${capture.id}/{z}/{x}/{y}`],
        tileSize: 256,
        attribution: capture.attribution ?? "Synthetic fixture",
      },
    },
    layers: [{ id: "fixture", type: "raster", source: "fixture" }],
  };
}

function addOverlays(map: Map, point: LatLng | null, parcel: SiteGeom | null) {
  if (parcel) {
    map.addSource("parcel", {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: parcel },
    });
    map.addLayer({
      id: "parcel-fill",
      type: "fill",
      source: "parcel",
      paint: { "fill-color": "#7a3410", "fill-opacity": 0.3 },
    });
    map.addLayer({
      id: "parcel-line",
      type: "line",
      source: "parcel",
      paint: { "line-color": "#7a3410", "line-width": 2 },
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
      id: "site",
      type: "circle",
      source: "site",
      paint: {
        "circle-radius": 8,
        "circle-color": "#1c1915",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#f4f0e6",
      },
    });
  }
}
