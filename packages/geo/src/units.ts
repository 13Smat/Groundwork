/**
 * Takeoff unit table. Factors are exact integer ratios, not binary floats.
 * The international foot is 0.3048 m (3048/10000). Square and acre factors
 * are that ratio squared. Catalog units such as ton or hour are not here:
 * a recipe formula turns a measure into those quantities.
 */

export type MeasureKind = "area" | "length" | "count";

export type UnitRatio = {
  kind: MeasureKind;
  /** Multiply a quantity in this unit by numerator/denominator to get the canonical unit. */
  numerator: string;
  denominator: string;
};

const FT_N = 3048n;
const FT_D = 10000n;
const YD_N = 9144n;
const IN_N = 254n;
const TEN_K = 10000n;
const FT2_N = FT_N * FT_N;
const FT2_D = FT_D * FT_D;
const YD2_N = YD_N * YD_N;
const ACRE_N = 43560n * FT2_N;

const UNITS: Record<string, UnitRatio> = {
  m: { kind: "length", numerator: "1", denominator: "1" },
  ft: { kind: "length", numerator: FT_N.toString(), denominator: FT_D.toString() },
  yd: { kind: "length", numerator: YD_N.toString(), denominator: TEN_K.toString() },
  in: { kind: "length", numerator: IN_N.toString(), denominator: TEN_K.toString() },
  m2: { kind: "area", numerator: "1", denominator: "1" },
  ft2: { kind: "area", numerator: FT2_N.toString(), denominator: FT2_D.toString() },
  yd2: { kind: "area", numerator: YD2_N.toString(), denominator: FT2_D.toString() },
  acre: { kind: "area", numerator: ACRE_N.toString(), denominator: FT2_D.toString() },
  ea: { kind: "count", numerator: "1", denominator: "1" },
};

const ALIASES: Record<string, string> = {
  m: "m",
  meter: "m",
  meters: "m",
  metre: "m",
  metres: "m",
  ft: "ft",
  foot: "ft",
  feet: "ft",
  yd: "yd",
  yard: "yd",
  yards: "yd",
  in: "in",
  inch: "in",
  inches: "in",
  m2: "m2",
  sqm: "m2",
  msq: "m2",
  ft2: "ft2",
  sqft: "ft2",
  yd2: "yd2",
  sqyd: "yd2",
  acre: "acre",
  acres: "acre",
  ac: "acre",
  ea: "ea",
  each: "ea",
  count: "ea",
  unit: "ea",
  units: "ea",
};

export class UnknownUnitError extends Error {
  readonly unit: string;

  constructor(unit: string) {
    super(`Unknown measure unit ${unit}.`);
    this.name = "UnknownUnitError";
    this.unit = unit;
  }
}

export class UnitMismatchError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(`Cannot convert ${from} to ${to}.`);
    this.name = "UnitMismatchError";
    this.from = from;
    this.to = to;
  }
}

/** Canonical key (`ft2`, `m`, `ea`) or null when the string is not a measure unit. */
export function normalizeUnit(input: string): string | null {
  const compact = input
    .trim()
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/\s+/g, "")
    .replace(/[._-]/g, "");
  return ALIASES[compact] ?? null;
}

export function unitRatio(input: string): UnitRatio | null {
  const key = normalizeUnit(input);
  if (!key) {
    return null;
  }
  return UNITS[key] ?? null;
}

export function measureKindOfUnit(input: string): MeasureKind | null {
  return unitRatio(input)?.kind ?? null;
}

export function unitsShareKind(left: string, right: string): boolean {
  const a = measureKindOfUnit(left);
  const b = measureKindOfUnit(right);
  return a !== null && a === b;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x === 0n ? 1n : x;
}

/**
 * Exact multiply/divide to convert a quantity from `from` to `to`.
 * Same measure kind only. Callers apply the ratio with decimal arithmetic.
 */
export function conversionRatio(
  from: string,
  to: string,
): { numerator: string; denominator: string } {
  const source = unitRatio(from);
  const target = unitRatio(to);
  if (!source) {
    throw new UnknownUnitError(from);
  }
  if (!target) {
    throw new UnknownUnitError(to);
  }
  if (source.kind !== target.kind) {
    throw new UnitMismatchError(from, to);
  }
  const numerator = BigInt(source.numerator) * BigInt(target.denominator);
  const denominator = BigInt(source.denominator) * BigInt(target.numerator);
  const divisor = gcd(numerator, denominator);
  return {
    numerator: (numerator / divisor).toString(),
    denominator: (denominator / divisor).toString(),
  };
}
