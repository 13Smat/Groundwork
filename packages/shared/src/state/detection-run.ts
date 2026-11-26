export const DETECTION_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "accepted_partial",
  "accepted_all",
] as const;

export type DetectionRunStatus = (typeof DETECTION_RUN_STATUSES)[number];

/**
 * Spec 05: queued -> running -> succeeded | failed | cancelled, and
 * succeeded -> accepted_partial | accepted_all. The API retries an infra
 * error twice inside one running row. A failed row stays failed. A new
 * idempotency key starts a new run. Anything else is illegal and the API
 * maps a throw to 409.
 */
const NEXT: Record<DetectionRunStatus, readonly DetectionRunStatus[]> = {
  queued: ["running"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: ["accepted_partial", "accepted_all"],
  failed: [],
  cancelled: [],
  accepted_partial: [],
  accepted_all: [],
};

export class IllegalDetectionRunTransitionError extends Error {
  readonly from: DetectionRunStatus;
  readonly to: DetectionRunStatus;

  constructor(from: DetectionRunStatus, to: DetectionRunStatus) {
    super(`Cannot change a detection run from ${from} to ${to}.`);
    this.name = "IllegalDetectionRunTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function isDetectionRunStatus(value: string): value is DetectionRunStatus {
  return (DETECTION_RUN_STATUSES as readonly string[]).includes(value);
}

export function transitionDetectionRun(
  from: DetectionRunStatus,
  to: DetectionRunStatus,
): DetectionRunStatus {
  if (from === to) {
    return from;
  }
  if (!NEXT[from].includes(to)) {
    throw new IllegalDetectionRunTransitionError(from, to);
  }
  return to;
}
