import { describe, expect, it } from "vitest";

import {
  IllegalProposalTransitionError,
  PROPOSAL_STATUSES,
  isProposalStatus,
  transitionProposal,
} from "./proposal.js";

const LEGAL = new Set([
  "draft->rendered",
  "draft->void",
  "rendered->sent",
  "rendered->void",
  "sent->viewed",
  "sent->declined",
  "sent->expired",
  "sent->void",
  "viewed->signed",
  "viewed->declined",
  "viewed->expired",
  "viewed->void",
  "declined->void",
  "expired->void",
]);

describe("proposal state machine", () => {
  it("walks draft to rendered to sent to viewed to signed", () => {
    expect(transitionProposal("draft", "rendered")).toBe("rendered");
    expect(transitionProposal("rendered", "sent")).toBe("sent");
    expect(transitionProposal("sent", "viewed")).toBe("viewed");
    expect(transitionProposal("viewed", "signed")).toBe("signed");
  });

  it("lets sent or viewed decline or expire, and voids anything that is not signed", () => {
    expect(transitionProposal("sent", "declined")).toBe("declined");
    expect(transitionProposal("sent", "expired")).toBe("expired");
    expect(transitionProposal("viewed", "void")).toBe("void");
    expect(transitionProposal("declined", "void")).toBe("void");
    expect(transitionProposal("expired", "void")).toBe("void");
    expect(transitionProposal("draft", "void")).toBe("void");
  });

  it("rejects a signed proposal moving to void and skips the rendered step", () => {
    expect(() => transitionProposal("signed", "void")).toThrow(IllegalProposalTransitionError);
    expect(() => transitionProposal("draft", "sent")).toThrow(/from draft to sent/);
    expect(() => transitionProposal("rendered", "viewed")).toThrow(IllegalProposalTransitionError);
    expect(() => transitionProposal("void", "draft")).toThrow(IllegalProposalTransitionError);
    expect(() => transitionProposal("draft", "draft")).toThrow(IllegalProposalTransitionError);
  });

  it("matches the legal set and the status list", () => {
    const seen: string[] = [];
    for (const from of PROPOSAL_STATUSES) {
      for (const to of PROPOSAL_STATUSES) {
        try {
          transitionProposal(from, to);
          seen.push(`${from}->${to}`);
        } catch (error) {
          expect(error).toBeInstanceOf(IllegalProposalTransitionError);
        }
      }
    }
    expect(seen.sort()).toEqual([...LEGAL].sort());
    expect(isProposalStatus("rendered")).toBe(true);
    expect(isProposalStatus("accepted")).toBe(false);
  });
});
