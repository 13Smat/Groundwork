import { createHmac, timingSafeEqual } from "node:crypto";

import { ProblemError } from "../errors.js";
import { FORBIDDEN_HOST_SUFFIXES, hostIsForbidden } from "./hosts.js";

export { FORBIDDEN_HOST_SUFFIXES, hostIsForbidden };

export const TILE_MATRIX_SET = "WebMercatorQuad";

/** Internal signature lifetime. The spec does not set a number. See OPEN-QUESTIONS. */
export const TILE_SIGNATURE_TTL_SECONDS = 60;

export const AGE_WARNING_AFTER_DAYS = 365;
/** Provisional. The spec says "approaching 4 years" and does not give a day count. */
export const STRONG_AGE_WARNING_AFTER_DAYS = 1095;

export const WARNING_AGE =
  "This capture is more than 12 months old. New construction may be missing.";
export const WARNING_AGE_STRONG = "This capture is approaching 4 years old. Outlines may be stale.";
export const WARNING_HELENE = "Seamline smears are possible off major roads.";
export const WARNING_NAIP = "Lower resolution (60 cm, leaf-on).";

const COG_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.(tif|tiff)$/i;

export type BBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type RankedCapture = {
  id: string;
  provider: string;
  captureDate: string;
};

const PROVIDER_RANK: Record<string, number> = {
  nc_helene_2025: 0,
  nc_ortho: 1,
  naip: 2,
};

export function parseBBox(value: string): BBox {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => part === "")) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "bbox must be west,south,east,north.",
    });
  }
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((number) => !Number.isFinite(number))) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "bbox must be four finite numbers.",
    });
  }
  const west = numbers[0]!;
  const south = numbers[1]!;
  const east = numbers[2]!;
  const north = numbers[3]!;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "bbox must stay inside WGS84 with west < east and south < north.",
    });
  }
  return { west, south, east, north };
}

export function ageDays(captureDate: string, asOf: Date): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(captureDate);
  if (!match) {
    throw new Error(`Capture date must be YYYY-MM-DD. Received ${captureDate}.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = Date.UTC(year, month - 1, day);
  const end = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.round((end - start) / 86_400_000);
}

export function asOfDate(asOf: Date): string {
  const year = asOf.getUTCFullYear();
  const month = String(asOf.getUTCMonth() + 1).padStart(2, "0");
  const day = String(asOf.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isNcMeasurementProvider(provider: string): boolean {
  return provider === "nc_helene_2025" || provider === "nc_ortho";
}

export function compareCaptures(a: RankedCapture, b: RankedCapture): number {
  const rankA = PROVIDER_RANK[a.provider] ?? 3;
  const rankB = PROVIDER_RANK[b.provider] ?? 3;
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  if (a.captureDate !== b.captureDate) {
    return a.captureDate < b.captureDate ? 1 : -1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

export function captureWarnings(input: {
  provider: string;
  ageDays: number;
  ncCaptureCoversSite: boolean;
}): string[] {
  const warnings: string[] = [];
  if (input.ageDays > AGE_WARNING_AFTER_DAYS) {
    warnings.push(WARNING_AGE);
  }
  if (input.ageDays >= STRONG_AGE_WARNING_AFTER_DAYS) {
    warnings.push(WARNING_AGE_STRONG);
  }
  if (input.provider === "nc_helene_2025") {
    warnings.push(WARNING_HELENE);
  }
  if (input.provider === "naip" && !input.ncCaptureCoversSite) {
    warnings.push(WARNING_NAIP);
  }
  return warnings;
}

export function assertCogKey(key: string): string {
  if (!COG_KEY.test(key) || key.includes("..") || key.includes("\\") || key.includes("://")) {
    throw new ProblemError({
      status: 404,
      title: "Not Found",
      detail: "That capture has no readable COG.",
    });
  }
  const lowered = key.toLowerCase();
  if (FORBIDDEN_HOST_SUFFIXES.some((suffix) => lowered.includes(suffix))) {
    throw new ProblemError({
      status: 403,
      title: "Forbidden",
      detail: "Tile serving cannot contact that host.",
    });
  }
  return key;
}

export function tileSignaturePayload(input: {
  captureId: string;
  z: number;
  x: number;
  y: number;
  workspaceId: string;
  expiresAt: number;
}): string {
  return [
    input.captureId.toLowerCase(),
    TILE_MATRIX_SET,
    input.z,
    input.x,
    input.y,
    input.workspaceId.toLowerCase(),
    input.expiresAt,
  ].join(".");
}

export function signTilePayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signaturesMatch(expected: string, presented: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function assertTileUpstream(url: URL, titiler: URL): void {
  if (hostIsForbidden(url.hostname)) {
    throw new ProblemError({
      status: 403,
      title: "Forbidden",
      detail: "Tile serving cannot contact that host.",
    });
  }
  if (
    url.protocol !== titiler.protocol ||
    url.hostname !== titiler.hostname ||
    url.port !== titiler.port
  ) {
    throw new ProblemError({
      status: 502,
      title: "Bad Gateway",
      detail: "Tile upstream is not the configured tile service.",
    });
  }
}

export function buildTileUpstreamUrl(input: {
  titiler: URL;
  captureId: string;
  z: number;
  x: number;
  y: number;
  workspaceId: string;
  expiresAt: number;
  secret: string;
}): URL {
  const payload = tileSignaturePayload(input);
  const signature = signTilePayload(payload, input.secret);
  const url = new URL(input.titiler.origin);
  url.pathname = `/captures/${input.captureId.toLowerCase()}/tiles/${TILE_MATRIX_SET}/${input.z}/${input.x}/${input.y}.png`;
  url.searchParams.set("workspaceId", input.workspaceId.toLowerCase());
  url.searchParams.set("exp", String(input.expiresAt));
  url.searchParams.set("sig", signature);
  assertTileUpstream(url, input.titiler);
  return url;
}
