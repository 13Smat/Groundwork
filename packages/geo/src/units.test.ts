import { describe, expect, it } from "vitest";

import {
  UnitMismatchError,
  UnknownUnitError,
  conversionRatio,
  measureKindOfUnit,
  normalizeUnit,
  unitsShareKind,
} from "./units.js";

describe("measure units", () => {
  it("normalizes display spellings onto the canonical keys", () => {
    expect(normalizeUnit("ft²")).toBe("ft2");
    expect(normalizeUnit("sq ft")).toBe("ft2");
    expect(normalizeUnit("SQYD")).toBe("yd2");
    expect(normalizeUnit("acres")).toBe("acre");
    expect(normalizeUnit("each")).toBe("ea");
    expect(normalizeUnit("ton")).toBeNull();
  });

  it("classifies area, length, and count", () => {
    expect(measureKindOfUnit("yd2")).toBe("area");
    expect(measureKindOfUnit("ft")).toBe("length");
    expect(measureKindOfUnit("ea")).toBe("count");
    expect(measureKindOfUnit("hr")).toBeNull();
    expect(unitsShareKind("ft2", "acre")).toBe(true);
    expect(unitsShareKind("ft", "ft2")).toBe(false);
  });

  it("converts a square yard to nine square feet exactly", () => {
    expect(conversionRatio("yd2", "ft2")).toEqual({ numerator: "9", denominator: "1" });
  });

  it("converts a foot to the international metre", () => {
    expect(conversionRatio("ft", "m")).toEqual({ numerator: "381", denominator: "1250" });
  });

  it("keeps an acre at 43,560 square feet", () => {
    expect(conversionRatio("acre", "ft2")).toEqual({ numerator: "43560", denominator: "1" });
  });

  it("refuses a length to area conversion", () => {
    expect(() => conversionRatio("ft", "ft2")).toThrow(UnitMismatchError);
  });

  it("refuses a catalog unit", () => {
    expect(() => conversionRatio("ton", "ft")).toThrow(UnknownUnitError);
  });
});
