import { ProblemError } from "../errors.js";

export const PARCEL_CACHE_TABLE = "parcel_cache";

/**
 * Tables the assist path reads. Parcel vendor rows are not in this list.
 * Training jobs must also call `assertTrainingSource`. Assist does not:
 * tracing is the assist gate, and `allows_ml_training` is the training gate.
 */
export const ASSIST_READ_TABLES = [
  "workspace",
  "takeoff",
  "location",
  "imagery_capture",
  "imagery_source",
  "takeoff_item",
] as const;

export type TrainingSource = {
  allows_tracing: boolean;
  allows_ml_training: boolean;
  verified: boolean;
};

export function assertTrainingSource(source: TrainingSource): void {
  if (!source.allows_tracing || !source.verified || !source.allows_ml_training) {
    throw new ProblemError({
      status: 403,
      title: "Forbidden",
      detail:
        "That imagery source cannot be used for training. It must allow tracing and ML training, and it must be verified.",
    });
  }
}

export function assertCvInputsExcludeParcelCache(tables: readonly string[]): void {
  if (tables.includes(PARCEL_CACHE_TABLE)) {
    throw new ProblemError({
      status: 403,
      title: "Forbidden",
      detail: "Parcel vendor data cannot be sent to a CV model.",
    });
  }
}
