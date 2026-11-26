import { v7 as uuidV7, validate as uuidValidate, version as uuidVersion } from "uuid";

import { humanNumberPrefixSchema, type HumanNumberPrefix } from "./enums.js";

const HUMAN_NUMBER = /^(?:J|E|P|INV)-[1-9]\d*$/;

/** UUIDv7 primary key. Spec 00. */
export function createId(): string {
  return uuidV7();
}

export function isUuidV7(value: string): boolean {
  return uuidValidate(value) && uuidVersion(value) === 7;
}

/**
 * Format a human number. The sequence start (the spec's `1001` examples) belongs to the
 * counters table, which is still an open question. This only formats a positive integer.
 */
export function formatHumanNumber(prefix: HumanNumberPrefix, sequence: number): string {
  const parsedPrefix = humanNumberPrefixSchema.parse(prefix);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError(
      `Human number sequence must be a positive integer. Received ${String(sequence)}.`,
    );
  }
  return `${parsedPrefix}-${sequence}`;
}

export function isHumanNumber(value: string): boolean {
  return HUMAN_NUMBER.test(value);
}
