import { describe, expect, it } from "vitest";

import {
  ESTIMATE_STATUSES,
  FlaggedEstimateError,
  IllegalEstimateTransitionError,
  isEstimateStatus,
  transitionEstimate,
} from "./estimate.js";

const LEGAL = new Set([
  "draft->ready",
  "ready->draft",
  "ready->sent",
  "ready->superseded",
  "sent->accepted",
  "sent->superseded",
]);

describe("estimate state machine", () => {
  it("walks draft to ready to sent to accepted", () => {
    expect(transitionEstimate({ from: "draft", to: "ready", flaggedLineCount: 0 })).toEqual({
      status: "ready",
      freezeSnapshot: true,
      clearSnapshot: false,
    });
    expect(transitionEstimate({ from: "ready", to: "sent", flaggedLineCount: 0 })).toEqual({
      status: "sent",
      freezeSnapshot: false,
      clearSnapshot: false,
    });
    expect(transitionEstimate({ from: "sent", to: "accepted", flaggedLineCount: 0 }).status).toBe(
      "accepted",
    );
  });

  it("returns a ready estimate to draft and clears the snapshot", () => {
    expect(transitionEstimate({ from: "ready", to: "draft", flaggedLineCount: 0 })).toEqual({
      status: "draft",
      freezeSnapshot: false,
      clearSnapshot: true,
    });
  });

  it("lets ready or sent become superseded without rewriting the snapshot", () => {
    expect(
      transitionEstimate({ from: "ready", to: "superseded", flaggedLineCount: 0 }).freezeSnapshot,
    ).toBe(false);
    expect(transitionEstimate({ from: "sent", to: "superseded", flaggedLineCount: 0 }).status).toBe(
      "superseded",
    );
  });

  it("rejects ready while a line is flagged", () => {
    expect(() => transitionEstimate({ from: "draft", to: "ready", flaggedLineCount: 2 })).toThrow(
      FlaggedEstimateError,
    );
    expect(() => transitionEstimate({ from: "draft", to: "ready", flaggedLineCount: 1 })).toThrow(
      /flagged or unresolved/,
    );
  });

  it("rejects every other pair", () => {
    for (const from of ESTIMATE_STATUSES) {
      for (const to of ESTIMATE_STATUSES) {
        if (LEGAL.has(`${from}->${to}`)) {
          continue;
        }
        expect(() => transitionEstimate({ from, to, flaggedLineCount: 0 })).toThrow(
          IllegalEstimateTransitionError,
        );
      }
    }
  });

  it("recognizes stored statuses", () => {
    expect(isEstimateStatus("ready")).toBe(true);
    expect(isEstimateStatus("won")).toBe(false);
  });
});
