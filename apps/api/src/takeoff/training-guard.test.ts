import { describe, expect, it } from "vitest";

import { ProblemError } from "../errors.js";
import {
  ASSIST_READ_TABLES,
  PARCEL_CACHE_TABLE,
  assertCvInputsExcludeParcelCache,
  assertTrainingSource,
} from "./training-guard.js";

describe("training source guard", () => {
  it("allows a verified source that permits tracing and training", () => {
    expect(() =>
      assertTrainingSource({
        allows_tracing: true,
        allows_ml_training: true,
        verified: true,
      }),
    ).not.toThrow();
  });

  it("rejects Google- and Mapbox-shaped sources and an unverified source", () => {
    const blocked = [
      { allows_tracing: false, allows_ml_training: false, verified: false },
      { allows_tracing: true, allows_ml_training: false, verified: true },
      { allows_tracing: true, allows_ml_training: true, verified: false },
    ];
    for (const source of blocked) {
      expect(() => assertTrainingSource(source)).toThrow(ProblemError);
      try {
        assertTrainingSource(source);
      } catch (error) {
        expect(error).toBeInstanceOf(ProblemError);
        expect((error as ProblemError).statusCode).toBe(403);
      }
    }
  });
});

describe("parcel cache exclusion", () => {
  it("refuses parcel_cache as a CV input", () => {
    expect(() => assertCvInputsExcludeParcelCache([PARCEL_CACHE_TABLE])).toThrow(ProblemError);
    try {
      assertCvInputsExcludeParcelCache(["imagery_capture", PARCEL_CACHE_TABLE]);
    } catch (error) {
      expect((error as ProblemError).statusCode).toBe(403);
    }
  });

  it("keeps parcel_cache out of the assist read list", () => {
    expect(ASSIST_READ_TABLES).not.toContain(PARCEL_CACHE_TABLE);
    expect(() => assertCvInputsExcludeParcelCache(ASSIST_READ_TABLES)).not.toThrow();
  });
});
