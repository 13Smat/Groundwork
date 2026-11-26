import { imageryCaptureStatusSchema } from "@groundwork/shared";
import { z } from "zod/v4";

import { ProblemError } from "../errors.js";

/**
 * Provisional. Spec 04 says county or AOI only and does not give a square-meter
 * cap. 60_000 km² rejects a North Carolina-sized extent and accepts the fixture
 * chip. PostGIS geography area is the check that runs before a job is queued.
 */
export const MAX_INGEST_AOI_SQ_M = 60_000_000_000;

const position = z.array(z.number()).min(2).max(3);
const ring = z.array(position).min(4).max(2000);
const polygonSchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(ring).min(1).max(20),
  })
  .strict();
const multiPolygonSchema = z
  .object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(z.array(ring).min(1).max(20)).min(1).max(20),
  })
  .strict();

export const aoiSchema = z.union([polygonSchema, multiPolygonSchema]);
export type Aoi = z.infer<typeof aoiSchema>;

const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .regex(/^https:\/\/[^\s]+$/, "License URL must be https.");

export const imageryProviderSchema = z.enum([
  "nc_ortho",
  "nc_helene_2025",
  "naip",
  "county",
  "nearmap",
  "vexcel",
  "drone_upload",
  "other",
]);

export const ingestBodySchema = z
  .object({
    sourceId: z.uuidv7(),
    year: z.number().int().min(1990).max(2100),
    countyFips: z
      .string()
      .regex(/^[0-9]{5}$/)
      .optional(),
    aoi: aoiSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const hasCounty = body.countyFips !== undefined;
    const hasAoi = body.aoi !== undefined;
    if (hasCounty === hasAoi) {
      ctx.addIssue({
        code: "custom",
        message: "Pass exactly one of countyFips or aoi.",
      });
    }
    if (body.countyFips?.endsWith("000")) {
      ctx.addIssue({
        code: "custom",
        message: "A state FIPS code is not a county.",
      });
    }
  });

export type IngestBody = z.infer<typeof ingestBodySchema>;

export const createSourceBodySchema = z
  .object({
    provider: imageryProviderSchema,
    name: z.string().trim().min(1).max(200),
    bands: z.string().trim().min(1).max(32),
    licenseText: z.string().trim().max(4000).nullable().optional(),
    licenseUrl: httpsUrl.nullable().optional(),
    allowsTracing: z.boolean(),
    allowsMlTraining: z.boolean(),
    attribution: z.string().trim().max(500).nullable().optional(),
    verifiedAt: z.iso.datetime().nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    gsdCm: z.number().positive().max(9999.99).nullable().optional(),
    captureDate: z.iso.date().nullable().optional(),
  })
  .strict();

export type CreateSourceBody = z.infer<typeof createSourceBodySchema>;

export const patchSourceBodySchema = z
  .object({
    licenseText: z.string().trim().max(4000).nullable().optional(),
    licenseUrl: httpsUrl.nullable().optional(),
    allowsTracing: z.boolean().optional(),
    allowsMlTraining: z.boolean().optional(),
    attribution: z.string().trim().max(500).nullable().optional(),
    verifiedAt: z.iso.datetime().nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Patch must include a field.",
  });

export type PatchSourceBody = z.infer<typeof patchSourceBodySchema>;

export const ingestJobResponseSchema = z.object({
  jobId: z.uuidv7(),
  captureId: z.uuidv7(),
  sourceId: z.uuidv7(),
  status: imageryCaptureStatusSchema,
  year: z.number().int(),
  countyFips: z.string().nullable(),
  error: z.string().nullable(),
  cogKey: z.string().nullable(),
  captureDate: z.string().nullable(),
  gsdCm: z.number().nullable(),
  bands: z.string().nullable(),
  leaf: z.enum(["on", "off", "mixed", "unknown"]).nullable(),
});

export type IngestJobResponse = z.infer<typeof ingestJobResponseSchema>;

const coverageSchema = z
  .object({
    west: z.number(),
    south: z.number(),
    east: z.number(),
    north: z.number(),
  })
  .nullable();

export const imagerySourceResponseSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7().nullable(),
  provider: z.string(),
  name: z.string(),
  bands: z.string(),
  gsdCm: z.number().nullable(),
  captureDate: z.string().nullable(),
  licenseText: z.string().nullable(),
  licenseUrl: z.string().nullable(),
  allowsTracing: z.boolean(),
  allowsMlTraining: z.boolean(),
  attribution: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  notes: z.string().nullable(),
  coverage: coverageSchema,
});

export type ImagerySourceResponse = z.infer<typeof imagerySourceResponseSchema>;

export function assertLicenseFlags(input: {
  allowsTracing: boolean;
  allowsMlTraining: boolean;
  verifiedAt: string | null;
}): void {
  if ((input.allowsTracing || input.allowsMlTraining) && input.verifiedAt === null) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "allows_tracing and allows_ml_training stay false until verified_at is set.",
    });
  }
}

const INGEST_ERROR_DETAIL: Record<string, string> = {
  live_fetch_disabled: "Live imagery download is disabled.",
  aoi_too_large: "That AOI is larger than one county.",
  scope_missing: "A county or an AOI is required.",
  scope_both: "Pass a county or an AOI, not both.",
  state_fips: "A state FIPS code is not a county.",
  county_fips_invalid: "County FIPS must be five digits.",
  not_four_bands: "The raster does not have four bands.",
  cog_invalid: "The raster is not a valid four-band COG.",
  missing_capture_date: "The raster has no capture date.",
  missing_leaf: "The raster has no leaf-on or leaf-off tag.",
  tile_url_missing: "No imagery tile URL is configured.",
  tile_host_forbidden: "That imagery host cannot be downloaded.",
  tile_url_invalid: "The imagery tile URL is not an HTTPS GeoTIFF.",
  tile_download_failed: "The imagery tile could not be downloaded.",
  fixture_missing: "The fixture GeoTIFF is missing.",
  upload_failed: "The COG could not be stored.",
  unsupported_provider: "That imagery source has no ingest fetcher.",
  cog_key_invalid: "The COG key is not a storage object key.",
  gsd_unknown: "The raster ground sample distance could not be read.",
  footprint_invalid: "The raster footprint could not be read.",
  aoi_invalid: "The AOI is not a polygon.",
  aoi_empty: "The AOI has no area.",
  ingest_failed: "Ingest failed.",
};

export function ingestErrorDetail(code: string | undefined): string {
  if (code !== undefined && code in INGEST_ERROR_DETAIL) {
    return INGEST_ERROR_DETAIL[code] ?? "Ingest failed.";
  }
  return "Ingest failed.";
}

export function ingestProvider(source: { provider: string; name: string }): string {
  if (source.name === "fixture_rgbir") {
    return "fixture";
  }
  if (
    source.provider === "nc_ortho" ||
    source.provider === "nc_helene_2025" ||
    source.provider === "naip"
  ) {
    return source.provider;
  }
  return "";
}
