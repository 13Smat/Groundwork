import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "../db/types.js";
import { withWorkspaceContext } from "../db/workspace.js";
import { ProblemError } from "../errors.js";
import type { LocationLookup } from "../imagery/routes.js";

const PAD = 0.002;

/**
 * Turn a location point into the bbox imagery search already understands.
 * A missing row and a row with no point are both 404. RLS hides other tenants.
 */
export function createLocationBBoxLookup(db: Kysely<Database>): LocationLookup {
  return async ({ workspaceId, locationId }) => {
    const row = await withWorkspaceContext(db, workspaceId, async (trx) => {
      const result = await sql<{ lng: number | null; lat: number | null }>`
        select ST_X(point)::float8 as lng, ST_Y(point)::float8 as lat
        from location
        where id = ${locationId}::uuid
      `.execute(trx);
      return result.rows[0];
    });
    if (!row) {
      throw new ProblemError({
        status: 404,
        title: "Not Found",
        detail: "No location matches that id.",
      });
    }
    if (row.lat === null || row.lng === null) {
      throw new ProblemError({
        status: 404,
        title: "Not Found",
        detail: "That location has no point yet. Pass bbox.",
      });
    }
    return {
      west: row.lng - PAD,
      south: row.lat - PAD,
      east: row.lng + PAD,
      north: row.lat + PAD,
    };
  };
}
