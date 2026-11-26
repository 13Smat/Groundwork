import {
  ImageryCaptureTransitionError,
  assertImageryCaptureTransition,
  type ImageryCaptureStatus,
} from "@groundwork/shared";
import { sql, type Transaction } from "kysely";

import type { Database } from "../db/types.js";
import { ProblemError } from "../errors.js";

export function imageryCaptureConflict(from: string, to: string): ProblemError {
  return new ProblemError({
    status: 409,
    title: "Conflict",
    detail: `Imagery capture cannot move from ${from} to ${to}.`,
  });
}

export async function applyImageryCaptureTransition(
  trx: Transaction<Database>,
  input: {
    captureId: string;
    from: ImageryCaptureStatus;
    to: ImageryCaptureStatus;
    coverageGeoJson?: string | undefined;
    captureDate?: string | undefined;
    gsdCm?: number | undefined;
    bands?: string | undefined;
    leaf?: string | undefined;
    cogKey?: string | undefined;
    notes?: string | null | undefined;
  },
): Promise<void> {
  try {
    assertImageryCaptureTransition(input.from, input.to);
  } catch (error) {
    if (error instanceof ImageryCaptureTransitionError) {
      throw imageryCaptureConflict(error.from, error.to);
    }
    throw error;
  }

  const coverage =
    input.coverageGeoJson === undefined
      ? sql`coverage`
      : sql`ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${input.coverageGeoJson}), 4326)), 3))`;
  const captureDate =
    input.captureDate === undefined ? sql`capture_date` : sql`${input.captureDate}::date`;
  const gsd = input.gsdCm === undefined ? sql`gsd_cm` : sql`${input.gsdCm}`;
  const bands = input.bands === undefined ? sql`bands` : sql`${input.bands}`;
  const leaf = input.leaf === undefined ? sql`leaf` : sql`${input.leaf}`;
  const cogKey = input.cogKey === undefined ? sql`cog_key` : sql`${input.cogKey}`;
  const notes = input.notes === undefined ? sql`notes` : sql`${input.notes}`;

  const updated = await sql<{ id: string }>`
    update imagery_capture
    set status = ${input.to},
        updated_at = now(),
        coverage = ${coverage},
        capture_date = ${captureDate},
        gsd_cm = ${gsd},
        bands = ${bands},
        leaf = ${leaf},
        cog_key = ${cogKey},
        notes = ${notes}
    where id = ${input.captureId}::uuid
      and status = ${input.from}
    returning id::text as id
  `.execute(trx);

  if (updated.rows.length === 0) {
    throw imageryCaptureConflict(input.from, input.to);
  }
}
