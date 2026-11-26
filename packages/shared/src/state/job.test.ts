import { describe, expect, it } from "vitest";

import {
  ForceWonRequiredError,
  IllegalJobTransitionError,
  JOB_STAGES,
  LostReasonRequiredError,
  isJobStage,
  isPreWonStage,
  transitionJob,
  type JobStage,
} from "./job.js";

const base = { hasSignedProposal: false, canForceWon: false };

describe("job stage machine", () => {
  it("walks lead to estimating to proposed, and proposed back to estimating", () => {
    expect(transitionJob({ from: "lead", to: "estimating", ...base })).toBe("estimating");
    expect(transitionJob({ from: "estimating", to: "proposed", ...base })).toBe("proposed");
    expect(transitionJob({ from: "proposed", to: "estimating", ...base })).toBe("estimating");
  });

  it("lets any pre-won stage become lost when a reason is present", () => {
    for (const from of ["lead", "estimating", "proposed"] as const) {
      expect(isPreWonStage(from)).toBe(true);
      expect(transitionJob({ from, to: "lost", reason: " price ", ...base })).toBe("lost");
      expect(() => transitionJob({ from, to: "lost", reason: "  ", ...base })).toThrow(
        LostReasonRequiredError,
      );
      expect(() => transitionJob({ from, to: "lost", ...base })).toThrow(LostReasonRequiredError);
    }
  });

  it("reopens a lost job to lead", () => {
    expect(transitionJob({ from: "lost", to: "lead", ...base })).toBe("lead");
  });

  it("allows proposed to won with a signed proposal or jobs.force_won", () => {
    expect(
      transitionJob({
        from: "proposed",
        to: "won",
        hasSignedProposal: true,
        canForceWon: false,
      }),
    ).toBe("won");
    expect(
      transitionJob({
        from: "proposed",
        to: "won",
        hasSignedProposal: false,
        canForceWon: true,
      }),
    ).toBe("won");
    expect(() => transitionJob({ from: "proposed", to: "won", ...base })).toThrow(
      ForceWonRequiredError,
    );
  });

  it("refuses lead to won even with jobs.force_won or a signed proposal", () => {
    expect(() =>
      transitionJob({
        from: "lead",
        to: "won",
        hasSignedProposal: true,
        canForceWon: true,
      }),
    ).toThrow(IllegalJobTransitionError);
  });

  it("rejects every pair the graph does not list, including the v1 stages", () => {
    const allowed = new Set([
      "lead->estimating",
      "lead->lost",
      "estimating->proposed",
      "estimating->lost",
      "proposed->won",
      "proposed->estimating",
      "proposed->lost",
      "lost->lead",
    ]);
    for (const from of JOB_STAGES) {
      for (const to of JOB_STAGES) {
        if (allowed.has(`${from}->${to}`)) {
          continue;
        }
        expect(() => transitionJob({ from, to, reason: "no", ...base })).toThrow(
          IllegalJobTransitionError,
        );
      }
    }
  });

  it("recognizes the stage vocabulary", () => {
    for (const stage of JOB_STAGES) {
      expect(isJobStage(stage)).toBe(true);
    }
    expect(isJobStage("open")).toBe(false);
    expect(isPreWonStage("won")).toBe(false);
    const scheduled: JobStage = "scheduled";
    expect(isPreWonStage(scheduled)).toBe(false);
  });
});
