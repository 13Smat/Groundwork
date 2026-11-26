import { ProblemError } from "../errors.js";
import { TILE_SIGNATURE_TTL_SECONDS, assertTileUpstream, buildTileUpstreamUrl } from "./policy.js";

export type TileFetch = (input: string, init: RequestInit) => Promise<Response>;

export const defaultTileFetch: TileFetch = (input, init) => fetch(input, init);

export type TileBytes = {
  contentType: string;
  body: Buffer;
};

/**
 * Fetch one signed tile from our TiTiler. Redirects are not followed: a 3xx
 * toward a state or commercial host must not be fetched.
 */
export async function fetchSignedTile(
  url: URL,
  titiler: URL,
  fetchImpl: TileFetch = defaultTileFetch,
): Promise<TileBytes> {
  assertTileUpstream(url, titiler);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new ProblemError({
      status: 502,
      title: "Bad Gateway",
      detail: `Tile service is unavailable. ${message}`,
    });
  }

  if (response.status >= 300 && response.status < 400) {
    throw new ProblemError({
      status: 502,
      title: "Bad Gateway",
      detail: "Tile service redirected. Redirects are not followed.",
    });
  }
  if (response.status === 403) {
    throw new ProblemError({
      status: 403,
      title: "Forbidden",
      detail: "This imagery source cannot be used for measurement.",
    });
  }
  if (response.status === 404) {
    throw new ProblemError({
      status: 404,
      title: "Not Found",
      detail: "No tile for that capture.",
    });
  }
  if (response.status === 401) {
    throw new ProblemError({
      status: 502,
      title: "Bad Gateway",
      detail: "Tile service rejected the signed request.",
    });
  }
  if (response.status !== 200) {
    throw new ProblemError({
      status: 502,
      title: "Bad Gateway",
      detail: "Tile service failed.",
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("image/")) {
    throw new ProblemError({
      status: 502,
      title: "Bad Gateway",
      detail: "Tile service did not return an image.",
    });
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0) {
    throw new ProblemError({
      status: 502,
      title: "Bad Gateway",
      detail: "Tile service returned an empty image.",
    });
  }
  return { contentType, body };
}

export async function checkTitiler(titiler: URL): Promise<void> {
  const health = new URL("/healthz", `${titiler.origin}/`);
  assertTileUpstream(health, titiler);
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 15_000) {
    try {
      const response = await fetch(health, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        return;
      }
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const message = lastError instanceof Error ? lastError.message : "unknown error";
  throw new Error(`Tile service at ${titiler.origin} is not reachable. ${message}`);
}

export function signedTileUrl(input: {
  titiler: URL;
  captureId: string;
  z: number;
  x: number;
  y: number;
  workspaceId: string;
  now: Date;
  secret: string;
}): URL {
  const expiresAt = Math.floor(input.now.getTime() / 1000) + TILE_SIGNATURE_TTL_SECONDS;
  return buildTileUpstreamUrl({
    titiler: input.titiler,
    captureId: input.captureId,
    z: input.z,
    x: input.x,
    y: input.y,
    workspaceId: input.workspaceId,
    expiresAt,
    secret: input.secret,
  });
}
