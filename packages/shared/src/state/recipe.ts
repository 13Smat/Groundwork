export const RECIPE_STATUSES = ["draft", "active", "archived"] as const;

export type RecipeStatus = (typeof RECIPE_STATUSES)[number];

const TRANSITIONS: Record<RecipeStatus, readonly RecipeStatus[]> = {
  draft: ["active"],
  active: ["archived"],
  archived: [],
};

export class IllegalRecipeTransitionError extends Error {
  readonly from: RecipeStatus;
  readonly to: RecipeStatus;

  constructor(from: RecipeStatus, to: RecipeStatus) {
    super(`Cannot change a recipe from ${from} to ${to}.`);
    this.name = "IllegalRecipeTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class RecipeVersionError extends Error {
  readonly status: RecipeStatus;

  constructor(status: RecipeStatus) {
    super(
      status === "archived"
        ? "An archived recipe cannot be versioned."
        : "Only an active recipe can be versioned.",
    );
    this.name = "RecipeVersionError";
    this.status = status;
  }
}

export function isRecipeStatus(value: string): value is RecipeStatus {
  return (RECIPE_STATUSES as readonly string[]).includes(value);
}

/**
 * Spec 06: draft -> active -> archived. Anything else, including a jump from
 * draft to archived, is illegal. The API maps that to 409. Activating version
 * n+1 archives n by this same transition.
 */
export function transitionRecipe(from: RecipeStatus, to: RecipeStatus): RecipeStatus {
  if (from === to) {
    return from;
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw new IllegalRecipeTransitionError(from, to);
  }
  return to;
}

/**
 * Editing an active recipe must not change that row. The caller copies it to
 * version n+1 as a draft. Archived rows are not edited.
 */
export function recipeEditTarget(status: RecipeStatus): "in_place" | "new_version" {
  if (status === "archived") {
    throw new IllegalRecipeTransitionError(status, "draft");
  }
  return status === "active" ? "new_version" : "in_place";
}

/** POST /cost-recipes/:id/versions. Drafts are edited in place. */
export function assertCanVersion(status: RecipeStatus): void {
  if (status !== "active") {
    throw new RecipeVersionError(status);
  }
}
