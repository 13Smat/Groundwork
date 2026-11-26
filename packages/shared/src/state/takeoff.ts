export const TAKEOFF_STATUSES = ["draft", "in_review", "final"] as const;

export type TakeoffStatus = (typeof TAKEOFF_STATUSES)[number];

/** What the API should do with a requested status. `clone` inserts version+1. */
export type TakeoffTransition = "stay" | "advance" | "clone";

const ADVANCE: Record<TakeoffStatus, TakeoffStatus | null> = {
  draft: "in_review",
  in_review: "final",
  final: null,
};

export class IllegalTakeoffTransitionError extends Error {
  readonly from: TakeoffStatus;
  readonly to: TakeoffStatus;

  constructor(from: TakeoffStatus, to: TakeoffStatus) {
    super(`Cannot change a takeoff from ${from} to ${to}.`);
    this.name = "IllegalTakeoffTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function isTakeoffStatus(value: string): value is TakeoffStatus {
  return (TAKEOFF_STATUSES as readonly string[]).includes(value);
}

/**
 * Spec 04: draft -> in_review -> final. final -> draft does not edit the
 * final row. The caller copies it to version+1 and leaves the old row
 * read-only. Anything else, including draft -> final, is illegal. The API
 * maps a throw to 409.
 */
export function transitionTakeoff(from: TakeoffStatus, to: TakeoffStatus): TakeoffTransition {
  if (from === to) {
    return "stay";
  }
  if (from === "final" && to === "draft") {
    return "clone";
  }
  if (ADVANCE[from] === to) {
    return "advance";
  }
  throw new IllegalTakeoffTransitionError(from, to);
}
