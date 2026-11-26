export const JOB_STAGES = [
  "lead",
  "estimating",
  "proposed",
  "won",
  "lost",
  "scheduled",
  "in_progress",
  "completed",
  "invoiced",
  "closed",
] as const;

export type JobStage = (typeof JOB_STAGES)[number];

/**
 * Stages a job can leave for `lost`. Won and the v1 stages are not pre-won.
 * Spec 03. The v1 chain (won -> scheduled -> ... -> closed) is not in this slice.
 */
const PRE_WON: ReadonlySet<JobStage> = new Set(["lead", "estimating", "proposed"]);

const NEXT: Record<JobStage, readonly JobStage[]> = {
  lead: ["estimating", "lost"],
  estimating: ["proposed", "lost"],
  proposed: ["won", "estimating", "lost"],
  won: [],
  lost: ["lead"],
  scheduled: [],
  in_progress: [],
  completed: [],
  invoiced: [],
  closed: [],
};

export class IllegalJobTransitionError extends Error {
  readonly from: JobStage;
  readonly to: JobStage;

  constructor(from: JobStage, to: JobStage) {
    super(`Cannot change a job from ${from} to ${to}.`);
    this.name = "IllegalJobTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class LostReasonRequiredError extends Error {
  constructor() {
    super("A lost job needs a reason.");
    this.name = "LostReasonRequiredError";
  }
}

export class ForceWonRequiredError extends Error {
  constructor() {
    super("Marking a job won needs a signed proposal or the jobs.force_won permission.");
    this.name = "ForceWonRequiredError";
  }
}

export function isJobStage(value: string): value is JobStage {
  return (JOB_STAGES as readonly string[]).includes(value);
}

export function isPreWonStage(stage: JobStage): boolean {
  return PRE_WON.has(stage);
}

/**
 * Spec 03. `won` is only from `proposed`, and only with a signed proposal or
 * `jobs.force_won`. `jobs.force_won` does not skip the graph: lead -> won is
 * illegal either way. The API maps every throw here to 409.
 */
export function transitionJob(input: {
  from: JobStage;
  to: JobStage;
  reason?: string | null;
  hasSignedProposal: boolean;
  canForceWon: boolean;
}): JobStage {
  if (input.from === input.to || !NEXT[input.from].includes(input.to)) {
    throw new IllegalJobTransitionError(input.from, input.to);
  }
  if (input.to === "lost") {
    const reason = input.reason?.trim() ?? "";
    if (reason.length === 0) {
      throw new LostReasonRequiredError();
    }
  }
  if (input.to === "won" && !input.hasSignedProposal && !input.canForceWon) {
    throw new ForceWonRequiredError();
  }
  return input.to;
}
