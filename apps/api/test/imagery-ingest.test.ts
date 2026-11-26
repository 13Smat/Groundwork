import { describe, expect, it } from "vitest";

import { requireImageryAdmin } from "../src/auth/guard.js";
import { ProblemError } from "../src/errors.js";
import {
  assertLicenseFlags,
  ingestBodySchema,
  ingestProvider,
} from "../src/imagery/ingest-schema.js";

const SOURCE = "018f5a00-0000-7000-8000-000000000007";

describe("imagery ingest request rules", () => {
  it("accepts one county and refuses a state code or both targets", () => {
    expect(
      ingestBodySchema.parse({ sourceId: SOURCE, year: 2026, countyFips: "37023" }).countyFips,
    ).toBe("37023");
    expect(
      ingestBodySchema.safeParse({ sourceId: SOURCE, year: 2026, countyFips: "37000" }).success,
    ).toBe(false);
    expect(
      ingestBodySchema.safeParse({
        sourceId: SOURCE,
        year: 2026,
        countyFips: "37023",
        aoi: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [0, 1],
              [1, 1],
              [1, 0],
              [0, 0],
            ],
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("keeps tracing and training off until a source is verified", () => {
    expect(() =>
      assertLicenseFlags({ allowsTracing: true, allowsMlTraining: false, verifiedAt: null }),
    ).toThrow(ProblemError);
    expect(() =>
      assertLicenseFlags({
        allowsTracing: true,
        allowsMlTraining: false,
        verifiedAt: "2026-11-26T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("selects the fixture fetcher by source name and the program fetchers by provider", () => {
    expect(ingestProvider({ provider: "other", name: "fixture_rgbir" })).toBe("fixture");
    expect(ingestProvider({ provider: "nc_ortho", name: "nc_ortho" })).toBe("nc_ortho");
    expect(ingestProvider({ provider: "other", name: "google_satellite" })).toBe("");
  });
});

describe("imagery admin role", () => {
  it("allows owner and admin and refuses every other role", () => {
    expect(() => requireImageryAdmin({ role: "owner" })).not.toThrow();
    expect(() => requireImageryAdmin({ role: "admin" })).not.toThrow();
    for (const role of ["estimator", "office", "foreman", "crew"]) {
      expect(() => requireImageryAdmin({ role })).toThrow(ProblemError);
    }
    try {
      requireImageryAdmin({ role: "estimator" });
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemError);
      expect((error as ProblemError).statusCode).toBe(403);
    }
  });
});
