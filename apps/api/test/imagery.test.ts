import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ProblemError } from "../src/errors.js";
import {
  FORBIDDEN_HOST_SUFFIXES,
  TILE_SIGNATURE_TTL_SECONDS,
  WARNING_AGE,
  WARNING_AGE_STRONG,
  WARNING_HELENE,
  WARNING_NAIP,
  ageDays,
  assertCogKey,
  assertTileUpstream,
  buildTileUpstreamUrl,
  captureWarnings,
  compareCaptures,
  hostIsForbidden,
  parseBBox,
  signTilePayload,
  tileSignaturePayload,
} from "../src/imagery/policy.js";
import { fetchSignedTile } from "../src/imagery/proxy.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("imagery policy", () => {
  it("matches the TiTiler signature vector", () => {
    const payload = tileSignaturePayload({
      captureId: "018F5A00-0000-7000-8000-000000000108",
      z: 16,
      x: 17894,
      y: 25791,
      workspaceId: "018F5A00-0000-7000-8000-0000000000AA",
      expiresAt: 1_700_000_000,
    });
    expect(payload).toBe(
      "018f5a00-0000-7000-8000-000000000108.WebMercatorQuad.16.17894.25791.018f5a00-0000-7000-8000-0000000000aa.1700000000",
    );
    expect(signTilePayload(payload, "local-tile-signing-secret")).toBe(
      "gl1Nm8i64xqQMplCHwjcE-VA9md1HmPRQA2qop-7fHs",
    );
    expect(TILE_SIGNATURE_TTL_SECONDS).toBe(60);
  });

  it("keeps the forbidden-host list in the tile service", () => {
    const python = readFileSync(
      path.join(root, "services/tiles/groundwork_tiles/guard.py"),
      "utf8",
    );
    for (const suffix of FORBIDDEN_HOST_SUFFIXES) {
      expect(python).toContain(`"${suffix}"`);
      expect(hostIsForbidden(`tiles.${suffix}`)).toBe(true);
    }
    expect(hostIsForbidden("127.0.0.1")).toBe(false);
    expect(hostIsForbidden("minio")).toBe(false);
    expect(python).toContain("SIGNATURE_TTL_SECONDS = 60");
    expect(python).toContain("SIGNATURE_MAX_AGE_SECONDS = 120");
  });

  it("rejects state, Google, and Mapbox dataset URLs as COG keys", () => {
    expect(assertCogKey("imagery/fixtures/rgbir-cog.tif")).toBe("imagery/fixtures/rgbir-cog.tif");
    const refused = [
      "https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest/ImageServer/tile.tif",
      "https://maps.googleapis.com/maps/vt.tif",
      "https://api.mapbox.com/v4/mapbox.satellite.tif",
      "s3://groundwork/imagery/fixtures/rgbir-cog.tif",
      "../secret.tif",
      "imagery/googleapis.com/tile.tif",
    ];
    for (const key of refused) {
      expect(() => assertCogKey(key)).toThrow(ProblemError);
    }
  });

  it("builds a tile URL that stays on the configured tile service", () => {
    const titiler = new URL("http://127.0.0.1:8080");
    const url = buildTileUpstreamUrl({
      titiler,
      captureId: "018f5a00-0000-7000-8000-000000000108",
      z: 16,
      x: 17894,
      y: 25791,
      workspaceId: "018f5a00-0000-7000-8000-0000000000aa",
      expiresAt: 1_700_000_000,
      secret: "local-tile-signing-secret",
    });
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.pathname).toContain("/tiles/WebMercatorQuad/16/17894/25791.png");
    expect(url.searchParams.get("sig")).toBe("gl1Nm8i64xqQMplCHwjcE-VA9md1HmPRQA2qop-7fHs");
    for (const host of [
      "https://maps.googleapis.com/vt",
      "https://api.mapbox.com/styles/v1/tiles",
      "https://services.nconemap.gov/arcgis/rest",
    ]) {
      expect(() => assertTileUpstream(new URL(host), titiler)).toThrow(ProblemError);
    }
  });

  it("does not follow a tile redirect", async () => {
    const titiler = new URL("http://127.0.0.1:8080");
    const calls: string[] = [];
    await expect(
      fetchSignedTile(new URL("http://127.0.0.1:8080/tile.png"), titiler, async (input) => {
        calls.push(input);
        return new Response(null, {
          status: 302,
          headers: { location: "https://services.nconemap.gov/tile.png" },
        });
      }),
    ).rejects.toThrow(/redirect/i);
    expect(calls).toEqual(["http://127.0.0.1:8080/tile.png"]);
  });

  it("parses a bbox and rejects a reversed one", () => {
    expect(parseBBox("-81.95,35.52,-81.40,35.99")).toEqual({
      west: -81.95,
      south: 35.52,
      east: -81.4,
      north: 35.99,
    });
    expect(() => parseBBox("1,2,0,3")).toThrow(ProblemError);
    expect(() => parseBBox("-84.4,35")).toThrow(ProblemError);
  });

  it("orders Helene, then the newest NC ortho, then NAIP", () => {
    const captures = [
      { id: "c", provider: "naip", captureDate: "2023-07-01" },
      { id: "b", provider: "nc_ortho", captureDate: "2022-03-15" },
      { id: "d", provider: "other", captureDate: "2026-01-15" },
      { id: "a", provider: "nc_helene_2025", captureDate: "2025-04-15" },
      { id: "e", provider: "nc_ortho", captureDate: "2024-03-15" },
    ].sort(compareCaptures);
    expect(captures.map((capture) => capture.id)).toEqual(["a", "e", "b", "c", "d"]);
  });

  it("warns on age, Helene seamlines, and NAIP when no NC capture covers the site", () => {
    const asOf = new Date("2026-11-26T00:00:00Z");
    expect(ageDays("2025-05-26", asOf)).toBe(549);
    expect(
      captureWarnings({ provider: "nc_ortho", ageDays: 549, ncCaptureCoversSite: true }),
    ).toEqual([WARNING_AGE]);
    expect(
      captureWarnings({ provider: "nc_ortho", ageDays: 200, ncCaptureCoversSite: true }),
    ).toEqual([]);
    expect(
      captureWarnings({ provider: "nc_ortho", ageDays: 1400, ncCaptureCoversSite: true }),
    ).toEqual([WARNING_AGE, WARNING_AGE_STRONG]);
    expect(
      captureWarnings({ provider: "nc_helene_2025", ageDays: 590, ncCaptureCoversSite: true }),
    ).toContain(WARNING_HELENE);
    expect(captureWarnings({ provider: "naip", ageDays: 100, ncCaptureCoversSite: false })).toEqual(
      [WARNING_NAIP],
    );
    expect(captureWarnings({ provider: "naip", ageDays: 100, ncCaptureCoversSite: true })).toEqual(
      [],
    );
  });

  it("ships a tiny synthetic fixture COG and records its Burke tile in the migration", () => {
    const tif = readFileSync(path.join(root, "db/seed/fixtures/rgbir-cog.tif"));
    expect(tif.subarray(0, 4).toString("hex")).toBe("49492a00");
    expect(tif.length).toBeLessThan(100_000);
    const fixture = JSON.parse(
      readFileSync(path.join(root, "db/seed/fixtures/rgbir-cog.json"), "utf8"),
    ) as {
      bounds: { west: number; south: number };
      tile: { z: number; x: number; y: number };
      bands: number;
      color: { r: number; g: number; b: number; nir: number };
    };
    expect(fixture.bands).toBe(4);
    expect(fixture.tile).toEqual({ z: 16, x: 17894, y: 25791 });
    expect(fixture.color).toEqual({ r: 220, g: 30, b: 40, nir: 180 });
    const migration = readFileSync(path.join(root, "db/migrations/0003_imagery.sql"), "utf8");
    expect(migration).toContain(fixture.bounds.west.toFixed(12));
    expect(migration).toContain(fixture.bounds.south.toFixed(12));
    expect(migration).toContain("workspace_id is null");
    expect(migration).toContain(
      "workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid",
    );
    expect(migration).toContain("'imagery/fixtures/rgbir-cog.tif'");
    expect(migration).not.toContain("https://maps.googleapis.com");
    expect(migration).not.toContain("https://api.mapbox.com");
  });
});
