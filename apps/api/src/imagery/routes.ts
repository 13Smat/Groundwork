import { isUuidV7 } from "@groundwork/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";
import { z } from "zod/v4";

import type { ImageryAuthHook } from "../auth/hook.js";
import type { Database } from "../db/types.js";
import { withWorkspaceContext } from "../db/workspace.js";
import { ProblemError } from "../errors.js";
import { readTileSigningSecret, readTitilerUrl } from "../config.js";
import {
  ageDays,
  asOfDate,
  assertCogKey,
  captureWarnings,
  compareCaptures,
  isNcMeasurementProvider,
  parseBBox,
  type BBox,
} from "./policy.js";
import { registerImageryAdminRoutes } from "./admin-routes.js";
import type { IngestDispatch } from "./ingest-service.js";
import { defaultTileFetch, fetchSignedTile, signedTileUrl, type TileFetch } from "./proxy.js";

const captureResponseSchema = z.object({
  id: z.uuidv7(),
  sourceId: z.uuidv7(),
  provider: z.string(),
  name: z.string(),
  captureDate: z.string(),
  gsdCm: z.number(),
  bands: z.string(),
  leaf: z.enum(["on", "off", "mixed", "unknown"]).nullable(),
  attribution: z.string().nullable(),
  ageDays: z.number().int(),
  warnings: z.array(z.string()),
});

const capturesResponseSchema = z.object({
  captures: z.array(captureResponseSchema),
});

export type ImageryCaptureResponse = z.infer<typeof captureResponseSchema>;

export type LocationLookup = (input: { workspaceId: string; locationId: string }) => Promise<BBox>;

/**
 * Fallback when a caller has not passed a location lookup. The API wires
 * `createLocationBBoxLookup` once the location table exists. This stub remains
 * so a route registration without that lookup still fails closed.
 */
export const locationLookupUnavailable: LocationLookup = () => {
  throw new ProblemError({
    status: 501,
    title: "Not Implemented",
    detail: "locationId cannot be resolved until the location table exists. Pass bbox.",
  });
};

export type ImageryRouteOptions = {
  db: Kysely<Database>;
  auth: ImageryAuthHook;
  /** Session, membership, and the owner or admin role. ADR 0008. */
  adminAuth: ImageryAuthHook;
  locationLookup?: LocationLookup;
  now?: () => Date;
  /** Capture age is measured against this instant. Defaults to `now`. Tests freeze it. */
  asOf?: () => Date;
  titiler?: URL;
  signingSecret?: string;
  fetchImpl?: TileFetch;
  ingestDispatch?: IngestDispatch;
};

type CaptureRow = {
  id: string;
  source_id: string;
  provider: string;
  name: string;
  capture_date: string;
  gsd_cm: number;
  bands: string;
  leaf: "on" | "off" | "mixed" | "unknown" | null;
  attribution: string | null;
  age_days: number;
  allows_tracing: boolean;
  source_verified: boolean;
};

type TileRow = {
  status: string;
  cog_key: string | null;
  allows_tracing: boolean;
  source_verified: boolean;
};

const FORBIDDEN = new ProblemError({
  status: 403,
  title: "Forbidden",
  detail: "This imagery source cannot be used for measurement.",
});

export async function registerImageryRoutes(
  app: FastifyInstance,
  options: ImageryRouteOptions,
): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const auth = options.auth;
  const locationLookup = options.locationLookup ?? locationLookupUnavailable;
  const now = options.now ?? (() => new Date());
  const asOf = options.asOf ?? now;
  const titiler = options.titiler ?? readTitilerUrl();
  const signingSecret = options.signingSecret ?? readTileSigningSecret();
  const fetchImpl = options.fetchImpl ?? defaultTileFetch;
  await registerImageryAdminRoutes(app, {
    db: options.db,
    auth: options.adminAuth,
    ...(options.ingestDispatch ? { dispatch: options.ingestDispatch } : {}),
  });

  routes.get(
    "/imagery/captures",
    {
      schema: {
        tags: ["tenant-header"],
        querystring: z.object({
          bbox: z.string().optional(),
          locationId: z.string().optional(),
        }),
        response: {
          200: capturesResponseSchema,
        },
      },
    },
    async (request) => {
      const { workspaceId } = await auth(request);
      const bbox = await resolveBBox(request.query, workspaceId, locationLookup);
      const captures = await withWorkspaceContext(options.db, workspaceId, (trx) =>
        listCaptures(trx, bbox, asOfDate(asOf())),
      );
      return { captures };
    },
  );

  routes.get(
    "/imagery/tiles/:captureId/:z/:x/:y",
    {
      schema: {
        tags: ["tenant-header"],
        params: z.object({
          captureId: z.uuidv7(),
          z: z.coerce.number().int().min(0).max(24),
          x: z.coerce.number().int().min(0),
          y: z.coerce.number().int().min(0),
        }),
      },
    },
    async (request, reply) => {
      const { workspaceId } = await auth(request);
      const { captureId, z: zoom, x, y } = request.params;
      const limit = 2 ** zoom;
      if (x >= limit || y >= limit) {
        throw new ProblemError({
          status: 400,
          title: "Bad Request",
          detail: "Tile x and y must fall inside the zoom level.",
        });
      }

      await withWorkspaceContext(options.db, workspaceId, async (trx) => {
        const row = await loadCapture(trx, captureId);
        if (!row) {
          throw new ProblemError({
            status: 404,
            title: "Not Found",
            detail: "No imagery capture matches that id.",
          });
        }
        if (!row.allows_tracing || !row.source_verified) {
          throw FORBIDDEN;
        }
        if (row.status !== "ready" || row.cog_key === null) {
          throw new ProblemError({
            status: 404,
            title: "Not Found",
            detail: "That capture has no readable COG.",
          });
        }
        assertCogKey(row.cog_key);
        await trx
          .insertInto("usage_event")
          .values({
            workspace_id: workspaceId,
            kind: "imagery_tile",
            units: "1",
            cost_estimate_cents: "0",
          })
          .execute();
      });

      const upstream = signedTileUrl({
        titiler,
        captureId,
        z: zoom,
        x,
        y,
        workspaceId,
        now: now(),
        secret: signingSecret,
      });
      const tile = await fetchSignedTile(upstream, titiler, fetchImpl);
      return reply
        .header("cache-control", "private, max-age=0")
        .type(tile.contentType)
        .send(tile.body);
    },
  );
}

async function resolveBBox(
  query: { bbox?: string | undefined; locationId?: string | undefined },
  workspaceId: string,
  locationLookup: LocationLookup,
): Promise<BBox> {
  const hasBBox = query.bbox !== undefined && query.bbox !== "";
  const hasLocation = query.locationId !== undefined && query.locationId !== "";
  if (hasBBox === hasLocation) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "Pass exactly one of bbox or locationId.",
    });
  }
  if (hasBBox && query.bbox !== undefined) {
    return parseBBox(query.bbox);
  }
  if (query.locationId === undefined || !isUuidV7(query.locationId)) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "locationId must be a UUIDv7.",
    });
  }
  return locationLookup({ workspaceId, locationId: query.locationId });
}

async function listCaptures(
  trx: Transaction<Database>,
  bbox: BBox,
  asOf: string,
): Promise<ImageryCaptureResponse[]> {
  const result = await sql<CaptureRow>`
    select
      c.id,
      c.source_id,
      s.provider,
      s.name,
      c.capture_date::text as capture_date,
      c.gsd_cm::float8 as gsd_cm,
      c.bands,
      c.leaf,
      s.attribution,
      (${asOf}::date - c.capture_date)::int as age_days,
      s.allows_tracing,
      (s.verified_at is not null) as source_verified
    from imagery_capture c
    join imagery_source s on s.id = c.source_id
    where c.status = 'ready'
      and s.allows_tracing = true
      and s.verified_at is not null
      and st_intersects(
        c.coverage,
        st_setsrid(st_makeenvelope(${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}), 4326)
      )
  `.execute(trx);

  const allowed = result.rows.filter((row) => row.allows_tracing && row.source_verified);
  const ncCaptureCoversSite = allowed.some((row) => isNcMeasurementProvider(row.provider));
  const captures = allowed.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    provider: row.provider,
    name: row.name,
    captureDate: row.capture_date,
    gsdCm: Number(row.gsd_cm),
    bands: row.bands,
    leaf: row.leaf,
    attribution: row.attribution,
    ageDays: Number(row.age_days),
    warnings: captureWarnings({
      provider: row.provider,
      ageDays: row.age_days,
      ncCaptureCoversSite,
    }),
  }));
  captures.sort(compareCaptures);
  for (const capture of captures) {
    if (capture.ageDays !== ageDays(capture.captureDate, new Date(`${asOf}T00:00:00Z`))) {
      throw new Error("Capture age from Postgres did not match the UTC day count.");
    }
  }
  return captures;
}

async function loadCapture(
  trx: Transaction<Database>,
  captureId: string,
): Promise<TileRow | undefined> {
  const result = await sql<TileRow>`
    select
      c.status,
      c.cog_key,
      s.allows_tracing,
      (s.verified_at is not null) as source_verified
    from imagery_capture c
    join imagery_source s on s.id = c.source_id
    where c.id = ${captureId}::uuid
  `.execute(trx);
  return result.rows[0];
}
