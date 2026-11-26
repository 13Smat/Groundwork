import { describe, expect, it } from "vitest";

import {
  DETECTION_RUN_STATUSES,
  IllegalDetectionRunTransitionError,
  transitionDetectionRun,
} from "./detection-run.js";

const LEGAL = new Set([
  "queued->running",
  "running->succeeded",
  "running->failed",
  "running->cancelled",
  "succeeded->accepted_partial",
  "succeeded->accepted_all",
]);

describe("detection run state machine", () => {
  it("follows the spec 05 edges", () => {
    expect(transitionDetectionRun("queued", "running")).toBe("running");
    expect(transitionDetectionRun("running", "succeeded")).toBe("succeeded");
    expect(transitionDetectionRun("running", "failed")).toBe("failed");
    expect(transitionDetectionRun("running", "cancelled")).toBe("cancelled");
    expect(transitionDetectionRun("succeeded", "accepted_partial")).toBe("accepted_partial");
    expect(transitionDetectionRun("succeeded", "accepted_all")).toBe("accepted_all");
  });

  it("leaves a run on the same status", () => {
    for (const status of DETECTION_RUN_STATUSES) {
      expect(transitionDetectionRun(status, status)).toBe(status);
    }
  });

  it("rejects every other pair", () => {
    for (const from of DETECTION_RUN_STATUSES) {
      for (const to of DETECTION_RUN_STATUSES) {
        if (from === to || LEGAL.has(`${from}->${to}`)) {
          continue;
        }
        expect(() => transitionDetectionRun(from, to)).toThrow(IllegalDetectionRunTransitionError);
      }
    }
  });
});
