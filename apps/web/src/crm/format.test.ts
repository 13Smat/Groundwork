import { describe, expect, it } from "vitest";

import { dollarsToCents, formatCents, jobCountLabel, stageLabel } from "./format";

describe("crm format", () => {
  it("labels pipeline stages and formats cents", () => {
    expect(stageLabel("estimating")).toBe("Estimating");
    expect(stageLabel("scheduled")).toBe("scheduled");
    expect(formatCents(40000, "USD")).toBe("$400.00");
    expect(formatCents(0, "USD")).toBe("$0.00");
    expect(jobCountLabel(1)).toBe("1 job");
    expect(jobCountLabel(0)).toBe("0 jobs");
  });

  it("parses a dollar field into integer cents", () => {
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("12")).toBe(1200);
    expect(dollarsToCents("12.5")).toBe(1250);
    expect(dollarsToCents("0.09")).toBe(9);
    expect(() => dollarsToCents("12.345")).toThrow(/two decimal places/);
    expect(() => dollarsToCents("abc")).toThrow(/two decimal places/);
  });
});
