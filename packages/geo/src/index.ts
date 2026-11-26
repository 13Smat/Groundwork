export const GEO_PACKAGE = "@groundwork/geo" as const;

/** EPSG:4326 stays the stored CRS. Geodesic area and length are not in this slice. */
export function geoPackageName(): string {
  return GEO_PACKAGE;
}

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
