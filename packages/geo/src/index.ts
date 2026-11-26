export const GEO_PACKAGE = "@groundwork/geo" as const;

/** EPSG:4326 stays the stored CRS. Area and length are geodesic. */
export function geoPackageName(): string {
  return GEO_PACKAGE;
}

export { DISPLAY_STEPS, convertMetric, displayFromMetric, type DisplayUnit } from "./display.js";
export {
  geodesicAreaM2,
  geodesicLengthM,
  geodesicRectangle,
  geodesicRectangleWithHole,
  geodesicSegment,
  INTERNATIONAL_FOOT_M,
  type GeoJsonGeometry,
  type GeoJsonLineString,
  type GeoJsonMultiLineString,
  type GeoJsonMultiPoint,
  type GeoJsonMultiPolygon,
  type GeoJsonPoint,
  type GeoJsonPolygon,
  type LngLat,
} from "./geodesic.js";
export {
  conversionRatio,
  measureKindOfUnit,
  normalizeUnit,
  unitRatio,
  UnitMismatchError,
  unitsShareKind,
  UnknownUnitError,
  type MeasureKind,
  type UnitRatio,
} from "./units.js";
