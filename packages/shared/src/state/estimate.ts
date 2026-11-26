export const ESTIMATE_STATUSES = ["draft", "ready", "sent", "accepted", "superseded"] as const;

export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

const TRANSITIONS: Record<EstimateStatus, readonly EstimateStatus[]> = {
  draft: ["ready"],
  ready: ["draft", "sent", "superseded"],
  sent: ["accepted", "superseded"],
  accepted: [],
  superseded: [],
};

export class IllegalEstimateTransitionError extends Error {
  readonly from: EstimateStatus;
  readonly to: EstimateStatus;

  constructor(from: EstimateStatus, to: EstimateStatus) {
    super(`Cannot change an estimate from ${from} to ${to}.`);
    this.name = "IllegalEstimateTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class FlaggedEstimateError extends Error {
  readonly flaggedLineCount: number;

  constructor(flaggedLineCount: number) {
    super("A flagged or unresolved line blocks ready.");
    this.name = "FlaggedEstimateError";
    this.flaggedLineCount = flaggedLineCount;
  }
}

export type EstimateTransitionResult = {
  status: EstimateStatus;
  /** Leaving draft writes the immutable snapshot. */
  freezeSnapshot: boolean;
  /** Returning to draft drops the snapshot so the rows can be edited. */
  clearSnapshot: boolean;
};

export function isEstimateStatus(value: string): value is EstimateStatus {
  return (ESTIMATE_STATUSES as readonly string[]).includes(value);
}

/**
 * Spec 07: draft -> ready -> sent -> accepted, ready -> draft, and
 * ready|sent -> superseded. Ready is refused while any line is flagged or
 * its recipe did not resolve. The API maps both errors to 409. Leaving draft
 * freezes the snapshot. Later statuses do not rewrite it.
 */
export function transitionEstimate(input: {
  from: EstimateStatus;
  to: EstimateStatus;
  flaggedLineCount: number;
}): EstimateTransitionResult {
  if (input.from === input.to || !TRANSITIONS[input.from].includes(input.to)) {
    throw new IllegalEstimateTransitionError(input.from, input.to);
  }
  if (input.to === "ready" && input.flaggedLineCount > 0) {
    throw new FlaggedEstimateError(input.flaggedLineCount);
  }
  return {
    status: input.to,
    freezeSnapshot: input.from === "draft",
    clearSnapshot: input.to === "draft",
  };
}
