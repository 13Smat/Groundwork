import type { MeasureKind } from "./types";

/**
 * Measure units a recipe input and a takeoff default unit can use.
 * The values match packages/geo. Catalog units such as ton or hour are free text.
 */
export const MEASURE_UNITS: Record<MeasureKind, readonly { value: string; label: string }[]> = {
  area: [
    { value: "ft2", label: "Square feet (ft2)" },
    { value: "yd2", label: "Square yards (yd2)" },
    { value: "m2", label: "Square meters (m2)" },
    { value: "acre", label: "Acres" },
  ],
  length: [
    { value: "ft", label: "Feet (ft)" },
    { value: "yd", label: "Yards (yd)" },
    { value: "m", label: "Meters (m)" },
    { value: "in", label: "Inches (in)" },
  ],
  count: [{ value: "ea", label: "Each (ea)" }],
};

export const ALL_MEASURE_UNITS = [
  ...MEASURE_UNITS.area,
  ...MEASURE_UNITS.length,
  ...MEASURE_UNITS.count,
];

export function unitsFor(kind: MeasureKind): readonly { value: string; label: string }[] {
  return MEASURE_UNITS[kind];
}

export function defaultUnit(kind: MeasureKind): string {
  return MEASURE_UNITS[kind][0]?.value ?? "ea";
}

export function unitMatchesKind(unit: string, kind: MeasureKind): boolean {
  return MEASURE_UNITS[kind].some((item) => item.value === unit);
}
