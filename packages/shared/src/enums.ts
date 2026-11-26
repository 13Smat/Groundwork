import { z } from "zod/v4";

/** Workspace display preference. Stored measurements stay metric. Spec 00. */
export const unitsPreferenceSchema = z.enum(["imperial", "metric"]);
export type UnitsPreference = z.infer<typeof unitsPreferenceSchema>;

/** Takeoff measurement kind. Spec 01. */
export const measurementKindSchema = z.enum(["area", "length", "count"]);
export type MeasurementKind = z.infer<typeof measurementKindSchema>;

/**
 * Human number prefixes from spec 00 (`J-1001`, `E-1001`, `P-1001`, `INV-1001`).
 * The counters table that issues the sequence is still an open question.
 */
export const humanNumberPrefixSchema = z.enum(["J", "E", "P", "INV"]);
export type HumanNumberPrefix = z.infer<typeof humanNumberPrefixSchema>;
