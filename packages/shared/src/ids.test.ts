import { describe, expect, it } from "vitest";

import { createId, formatHumanNumber, isHumanNumber, isUuidV7 } from "./ids.js";

describe("ids", () => {
  it("creates a UUIDv7", () => {
    const first = createId();
    const second = createId();
    expect(isUuidV7(first)).toBe(true);
    expect(isUuidV7(second)).toBe(true);
    expect(first).not.toBe(second);
  });

  it("formats human numbers without choosing the counter start", () => {
    expect(formatHumanNumber("J", 1001)).toBe("J-1001");
    expect(formatHumanNumber("INV", 2)).toBe("INV-2");
    expect(isHumanNumber("E-1001")).toBe(true);
    expect(isHumanNumber("P-1")).toBe(true);
  });

  it("rejects a non-positive sequence and a malformed number", () => {
    expect(() => formatHumanNumber("J", 0)).toThrow(RangeError);
    expect(isHumanNumber("J-0")).toBe(false);
    expect(isHumanNumber("X-1")).toBe(false);
    expect(isHumanNumber("INV-01")).toBe(false);
  });
});
