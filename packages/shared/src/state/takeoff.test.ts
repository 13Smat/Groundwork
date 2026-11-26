import { describe, expect, it } from "vitest";

import { IllegalTakeoffTransitionError, TAKEOFF_STATUSES, transitionTakeoff } from "./takeoff.js";

describe("takeoff state machine", () => {
  it("advances draft to in_review and in_review to final", () => {
    expect(transitionTakeoff("draft", "in_review")).toBe("advance");
    expect(transitionTakeoff("in_review", "final")).toBe("advance");
  });

  it("clones a final takeoff when it goes back to draft", () => {
    expect(transitionTakeoff("final", "draft")).toBe("clone");
  });

  it("leaves a takeoff on the same status", () => {
    for (const status of TAKEOFF_STATUSES) {
      expect(transitionTakeoff(status, status)).toBe("stay");
    }
  });

  it("rejects every other pair", () => {
    const legal = new Set(["draft->in_review", "in_review->final", "final->draft"]);
    for (const from of TAKEOFF_STATUSES) {
      for (const to of TAKEOFF_STATUSES) {
        if (from === to || legal.has(`${from}->${to}`)) {
          continue;
        }
        expect(() => transitionTakeoff(from, to)).toThrow(IllegalTakeoffTransitionError);
      }
    }
  });
});
