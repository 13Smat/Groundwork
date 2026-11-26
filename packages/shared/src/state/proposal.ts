export const PROPOSAL_STATUSES = [
  "draft",
  "rendered",
  "sent",
  "viewed",
  "signed",
  "declined",
  "expired",
  "void",
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

const TRANSITIONS: Record<ProposalStatus, readonly ProposalStatus[]> = {
  draft: ["rendered", "void"],
  rendered: ["sent", "void"],
  sent: ["viewed", "declined", "expired", "void"],
  viewed: ["signed", "declined", "expired", "void"],
  declined: ["void"],
  expired: ["void"],
  signed: [],
  void: [],
};

export class IllegalProposalTransitionError extends Error {
  readonly from: ProposalStatus;
  readonly to: ProposalStatus;

  constructor(from: ProposalStatus, to: ProposalStatus) {
    super(`Cannot change a proposal from ${from} to ${to}.`);
    this.name = "IllegalProposalTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function isProposalStatus(value: string): value is ProposalStatus {
  return (PROPOSAL_STATUSES as readonly string[]).includes(value);
}

/**
 * Spec 08: draft -> rendered -> sent -> viewed -> signed.
 * sent or viewed can decline or expire. Any status other than signed can
 * become void. The API maps an illegal change to 409.
 */
export function transitionProposal(from: ProposalStatus, to: ProposalStatus): ProposalStatus {
  if (from === to || !TRANSITIONS[from].includes(to)) {
    throw new IllegalProposalTransitionError(from, to);
  }
  return to;
}
