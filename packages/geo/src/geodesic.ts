import { area } from "@turf/area";
import { destination } from "@turf/destination";
import { lineString, point, polygon } from "@turf/helpers";
import { length } from "@turf/length";

/** International foot, 0.3048 m. Shape builders need a JS number; display conversion stays rational. */
export const INTERNATIONAL_FOOT_M = 0.3048;

export type LngLat = [number, number];

export type GeoJsonPoint = { type: "Point"; coordinates: LngLat };
export type GeoJsonLineString = { type: "LineString"; coordinates: LngLat[] };
export type GeoJsonPolygon = { type: "Polygon"; coordinates: LngLat[][] };
export type GeoJsonMultiPoint = { type: "MultiPoint"; coordinates: LngLat[] };
export type GeoJsonMultiLineString = { type: "MultiLineString"; coordinates: LngLat[][] };
export type GeoJsonMultiPolygon = { type: "MultiPolygon"; coordinates: LngLat[][][] };

export type GeoJsonGeometry =
  | GeoJsonPoint
  | GeoJsonLineString
  | GeoJsonPolygon
  | GeoJsonMultiPoint
  | GeoJsonMultiLineString
  | GeoJsonMultiPolygon;

/**
 * Geodesic area in square meters. Turf is the live-feedback value. The API
 * stores PostGIS `ST_Area(geom::geography)` and that number wins on save.
 */
export function geodesicAreaM2(geometry: GeoJsonGeometry): number {
  return area(geometry);
}

/** Geodesic length in meters. Points contribute nothing, matching Turf. */
export function geodesicLengthM(geometry: GeoJsonGeometry): number {
  if (geometry.type === "Point" || geometry.type === "MultiPoint") {
    return 0;
  }
  if (geometry.type === "LineString") {
    return length(lineString(geometry.coordinates), { units: "meters" });
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.reduce(
      (sum, coordinates) => sum + length(lineString(coordinates), { units: "meters" }),
      0,
    );
  }
  if (geometry.type === "Polygon") {
    return length(polygon(geometry.coordinates), { units: "meters" });
  }
  return geometry.coordinates.reduce(
    (sum, coordinates) => sum + length(polygon(coordinates), { units: "meters" }),
    0,
  );
}

function project(origin: LngLat, distanceM: number, bearing: number): LngLat {
  const next = destination(point(origin), distanceM, bearing, { units: "meters" });
  const lng = next.geometry.coordinates[0];
  const lat = next.geometry.coordinates[1];
  if (lng === undefined || lat === undefined) {
    throw new Error("Destination did not return a coordinate.");
  }
  return [lng, lat];
}

/**
 * Axis-aligned geodesic rectangle. The southwest corner is `origin`. Width
 * runs east, height runs north. The ring is closed and counter-clockwise.
 */
export function geodesicRectangle(input: {
  origin: LngLat;
  widthM: number;
  heightM: number;
}): GeoJsonPolygon {
  if (input.widthM <= 0 || input.heightM <= 0) {
    throw new RangeError("A geodesic rectangle needs a positive width and height.");
  }
  const sw = input.origin;
  const se = project(sw, input.widthM, 90);
  const ne = project(se, input.heightM, 0);
  const nw = project(sw, input.heightM, 0);
  return { type: "Polygon", coordinates: [[sw, se, ne, nw, sw]] };
}

/**
 * Rectangle with one interior ring. The hole origin is offset east and north
 * from the shell origin. The hole ring is clockwise so it reads as a hole.
 */
export function geodesicRectangleWithHole(input: {
  origin: LngLat;
  widthM: number;
  heightM: number;
  holeOrigin: LngLat;
  holeWidthM: number;
  holeHeightM: number;
}): GeoJsonPolygon {
  const shell = geodesicRectangle({
    origin: input.origin,
    widthM: input.widthM,
    heightM: input.heightM,
  });
  const hole = geodesicRectangle({
    origin: input.holeOrigin,
    widthM: input.holeWidthM,
    heightM: input.holeHeightM,
  });
  const holeRing = hole.coordinates[0];
  if (!holeRing || !shell.coordinates[0]) {
    throw new Error("Rectangle ring was empty.");
  }
  return {
    type: "Polygon",
    coordinates: [shell.coordinates[0], [...holeRing].reverse()],
  };
}

/** Straight geodesic segment from `origin` along `bearing` degrees. */
export function geodesicSegment(input: {
  origin: LngLat;
  distanceM: number;
  bearing: number;
}): GeoJsonLineString {
  if (input.distanceM <= 0) {
    throw new RangeError("A geodesic segment needs a positive length.");
  }
  return {
    type: "LineString",
    coordinates: [input.origin, project(input.origin, input.distanceM, input.bearing)],
  };
}
