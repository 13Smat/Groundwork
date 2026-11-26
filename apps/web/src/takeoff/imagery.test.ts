import { describe, expect, it } from "vitest";

import {
  allowedCaptures,
  captureOptionLabel,
  formatGsd,
  NO_CAPTURE_MESSAGE,
  tileTemplate,
} from "./imagery";
import type { ImageryCapture } from "./types";

function capture(
  overrides: Partial<ImageryCapture> &
    Pick<ImageryCapture, "id" | "name" | "provider" | "captureDate">,
): ImageryCapture {
  return {
    sourceId: "018f5a00-0000-7000-8000-000000000099",
    gsdCm: 15.24,
    bands: "RGBIR",
    leaf: "off",
    attribution: "Test",
    ageDays: 10,
    warnings: [],
    ...overrides,
  };
}

describe("imagery picker", () => {
  it("drops blocked sources and orders Helene, newest NC ortho, then NAIP", () => {
    const ordered = allowedCaptures([
      capture({
        id: "018f5a00-0000-7000-8000-000000000004",
        name: "naip",
        provider: "naip",
        captureDate: "2023-07-01",
        gsdCm: 60,
      }),
      capture({
        id: "018f5a00-0000-7000-8000-000000000006",
        name: "google_satellite",
        provider: "other",
        captureDate: "2024-01-01",
      }),
      capture({
        id: "018f5a00-0000-7000-8000-000000000007",
        name: "mapbox_satellite",
        provider: "other",
        captureDate: "2024-01-01",
      }),
      capture({
        id: "018f5a00-0000-7000-8000-000000000005",
        name: "nc_ortho_latest_viewing",
        provider: "other",
        captureDate: "2024-01-01",
      }),
      capture({
        id: "018f5a00-0000-7000-8000-000000000003",
        name: "nc_ortho",
        provider: "nc_ortho",
        captureDate: "2022-03-15",
      }),
      capture({
        id: "018f5a00-0000-7000-8000-000000000002",
        name: "nc_ortho",
        provider: "nc_ortho",
        captureDate: "2024-03-15",
      }),
      capture({
        id: "018f5a00-0000-7000-8000-000000000001",
        name: "nc_helene_2025",
        provider: "nc_helene_2025",
        captureDate: "2025-04-15",
      }),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      "018f5a00-0000-7000-8000-000000000001",
      "018f5a00-0000-7000-8000-000000000002",
      "018f5a00-0000-7000-8000-000000000003",
      "018f5a00-0000-7000-8000-000000000004",
    ]);
    expect(NO_CAPTURE_MESSAGE).toMatch(/Measuring stays blocked/);
  });

  it("formats 6-inch and 60 cm ground sample distance", () => {
    expect(formatGsd(15.24)).toBe("6 in (15.24 cm)");
    expect(formatGsd(60)).toBe("60 cm");
    expect(
      captureOptionLabel(
        capture({
          id: "018f5a00-0000-7000-8000-000000000001",
          name: "nc_helene_2025",
          provider: "nc_helene_2025",
          captureDate: "2025-04-15",
          leaf: "off",
        }),
      ),
    ).toContain("Helene 2025 · 2025-04-15");
  });

  it("builds a relative tile path and refuses a foreign host", () => {
    const path = tileTemplate("018f5a00-0000-7000-8000-000000000101");
    expect(path).toBe("/imagery/tiles/018f5a00-0000-7000-8000-000000000101/{z}/{x}/{y}");
    expect(path).not.toMatch(/google|mapbox|nconemap|https?:/i);
    expect(() => tileTemplate("https://tile.googleapis.com/v1")).toThrow(/capture id/);
  });
});
