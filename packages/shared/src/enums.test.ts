import { describe, expect, it } from "vitest";

import { measurementKindSchema, unitsPreferenceSchema } from "./enums.js";

describe("base enums", () => {
  it("accepts the workspace unit preference and the measurement kinds", () => {
    expect(unitsPreferenceSchema.parse("imperial")).toBe("imperial");
    expect(unitsPreferenceSchema.parse("metric")).toBe("metric");
    expect(measurementKindSchema.parse("area")).toBe("area");
    expect(measurementKindSchema.parse("length")).toBe("length");
    expect(measurementKindSchema.parse("count")).toBe("count");
  });

  it("rejects a unit name that is not a preference", () => {
    expect(() => unitsPreferenceSchema.parse("feet")).toThrow();
  });
});
