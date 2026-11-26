import { z } from "zod/v4";

/**
 * ImageryCapture.status. Spec 04: ingesting -> ready | failed.
 * Measuring only happens on ready. A failed capture stays failed; a new ingest
 * creates a new capture.
 */
export const imageryCaptureStatusSchema = z.enum(["ingesting", "ready", "failed"]);
export type ImageryCaptureStatus = z.infer<typeof imageryCaptureStatusSchema>;

const TRANSITIONS: Record<ImageryCaptureStatus, readonly ImageryCaptureStatus[]> = {
  ingesting: ["ready", "failed"],
  ready: [],
  failed: [],
};

export class ImageryCaptureTransitionError extends Error {
  readonly from: ImageryCaptureStatus;
  readonly to: ImageryCaptureStatus;

  constructor(from: ImageryCaptureStatus, to: ImageryCaptureStatus) {
    super(`Imagery capture cannot move from ${from} to ${to}.`);
    this.name = "ImageryCaptureTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function assertImageryCaptureTransition(
  from: ImageryCaptureStatus,
  to: ImageryCaptureStatus,
): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ImageryCaptureTransitionError(from, to);
  }
}
