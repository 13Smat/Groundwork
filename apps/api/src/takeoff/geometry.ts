import type { GeoJsonGeometry, GeoJsonPolygon, LngLat } from "@groundwork/geo";

import { ProblemError } from "../errors.js";

const MAX_POSITIONS = 1_000;
const MAX_RINGS = 51;
const MAX_PARTS = 50;
const MAX_DEDUCTIONS = 50;

export type MeasureKind = "area" | "length" | "count";
export type MeasureSource = "manual" | "ai_assist" | "ai_auto";

export type MeasurementInput = {
  id: string;
  takeoffItemId: string;
  kind: MeasureKind;
  geom: GeoJsonGeometry;
  deductions: GeoJsonPolygon[];
  source: MeasureSource;
  label: string | null;
  count: number | null;
  confidence: number | null;
};

function bad(detail: string): ProblemError {
  return new ProblemError({ status: 400, title: "Bad Request", detail });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function position(value: unknown, path: string): LngLat {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) {
    throw bad(`${path} must be a longitude and latitude.`);
  }
  const lng = value[0];
  const lat = value[1];
  if (
    typeof lng !== "number" ||
    typeof lat !== "number" ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat)
  ) {
    throw bad(`${path} must be finite numbers.`);
  }
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw bad(`${path} must stay inside WGS84.`);
  }
  return [lng, lat];
}

function samePosition(left: LngLat, right: LngLat): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function ring(value: unknown, path: string): LngLat[] {
  if (!Array.isArray(value) || value.length < 4 || value.length > MAX_POSITIONS) {
    throw bad(`${path} must be a closed ring of 4 to ${MAX_POSITIONS} positions.`);
  }
  const positions = value.map((item, index) => position(item, `${path}/${index}`));
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (!first || !last || !samePosition(first, last)) {
    throw bad(`${path} must repeat its first position.`);
  }
  return positions;
}

function polygonCoordinates(value: unknown, path: string): LngLat[][] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RINGS) {
    throw bad(`${path} must be one exterior ring and up to 50 holes.`);
  }
  return value.map((item, index) => ring(item, `${path}/${index}`));
}

function lineCoordinates(value: unknown, path: string): LngLat[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_POSITIONS) {
    throw bad(`${path} must be 2 to ${MAX_POSITIONS} positions.`);
  }
  return value.map((item, index) => position(item, `${path}/${index}`));
}

export function parseGeometry(value: unknown): GeoJsonGeometry {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw bad("Geometry must be a GeoJSON geometry.");
  }
  const coordinates = value.coordinates;
  switch (value.type) {
    case "Point":
      return { type: "Point", coordinates: position(coordinates, "geom") };
    case "MultiPoint": {
      if (!Array.isArray(coordinates) || coordinates.length < 1 || coordinates.length > MAX_PARTS) {
        throw bad("A multipoint needs 1 to 50 positions.");
      }
      return {
        type: "MultiPoint",
        coordinates: coordinates.map((item, index) => position(item, `geom/${index}`)),
      };
    }
    case "LineString":
      return { type: "LineString", coordinates: lineCoordinates(coordinates, "geom") };
    case "MultiLineString": {
      if (!Array.isArray(coordinates) || coordinates.length < 1 || coordinates.length > MAX_PARTS) {
        throw bad("A multiline needs 1 to 50 parts.");
      }
      return {
        type: "MultiLineString",
        coordinates: coordinates.map((item, index) => lineCoordinates(item, `geom/${index}`)),
      };
    }
    case "Polygon":
      return { type: "Polygon", coordinates: polygonCoordinates(coordinates, "geom") };
    case "MultiPolygon": {
      if (!Array.isArray(coordinates) || coordinates.length < 1 || coordinates.length > MAX_PARTS) {
        throw bad("A multipolygon needs 1 to 50 parts.");
      }
      return {
        type: "MultiPolygon",
        coordinates: coordinates.map((item, index) => polygonCoordinates(item, `geom/${index}`)),
      };
    }
    default:
      throw bad("Geometry type must be Point, LineString, Polygon, or a multi of those.");
  }
}

export function parseDeductions(value: unknown): GeoJsonPolygon[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_DEDUCTIONS) {
    throw bad(`Deductions must be up to ${MAX_DEDUCTIONS} polygons.`);
  }
  return value.map((item, index) => {
    const geom = parseGeometry(item);
    if (geom.type !== "Polygon") {
      throw bad(`deductions/${index} must be a Polygon.`);
    }
    return geom;
  });
}

export function geometryMatchesKind(kind: MeasureKind, geom: GeoJsonGeometry): boolean {
  if (kind === "area") {
    return geom.type === "Polygon" || geom.type === "MultiPolygon";
  }
  if (kind === "length") {
    return geom.type === "LineString" || geom.type === "MultiLineString";
  }
  return geom.type === "Point" || geom.type === "MultiPoint";
}
