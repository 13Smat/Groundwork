import { ApiError, api } from "../session";

import type {
  CatalogCreate,
  CatalogItem,
  CatalogPatch,
  FormulaCheck,
  ImportPlan,
  PreviewBody,
  PreviewResult,
  Recipe,
  RecipeSummary,
  RecipeWrite,
  StarterResult,
  TakeoffCreate,
  TakeoffItem,
  TakeoffPatch,
} from "./types";

function workspaceHeaders(workspaceId: string): Headers {
  const headers = new Headers();
  headers.set("x-workspace-id", workspaceId);
  return headers;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function listCatalog(workspaceId: string): Promise<{ items: CatalogItem[] }> {
  return api("/catalog-items", { headers: workspaceHeaders(workspaceId) });
}

export function createCatalogItem(workspaceId: string, body: CatalogCreate): Promise<CatalogItem> {
  return api("/catalog-items", {
    method: "POST",
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  });
}

export function updateCatalogItem(
  workspaceId: string,
  id: string,
  body: CatalogPatch,
): Promise<CatalogItem> {
  return api(`/catalog-items/${id}`, {
    method: "PATCH",
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  });
}

export function deleteCatalogItem(
  workspaceId: string,
  id: string,
): Promise<CatalogItem | undefined> {
  return api(`/catalog-items/${id}`, {
    method: "DELETE",
    headers: workspaceHeaders(workspaceId),
  });
}

export function previewCatalogImport(workspaceId: string, csv: string): Promise<ImportPlan> {
  return api("/catalog-items/import", {
    method: "POST",
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({ csv, apply: false }),
  });
}

export function applyCatalogImport(workspaceId: string, csv: string): Promise<ImportPlan> {
  return api("/catalog-items/import", {
    method: "POST",
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({ csv, apply: true }),
  });
}

export async function exportCatalog(workspaceId: string): Promise<string> {
  const response = await fetch("/catalog-items/export", {
    headers: workspaceHeaders(workspaceId),
    credentials: "include",
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(response.status, problem?.detail ?? "The export failed.");
  }
  return response.text();
}

export function loadStarterPack(workspaceId: string): Promise<StarterResult> {
  return api("/catalog-items/starter-pack", {
    method: "POST",
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({}),
  });
}

export function listTakeoff(workspaceId: string): Promise<{ items: TakeoffItem[] }> {
  return api("/takeoff-items", { headers: workspaceHeaders(workspaceId) });
}

export function createTakeoffItem(workspaceId: string, body: TakeoffCreate): Promise<TakeoffItem> {
  return api("/takeoff-items", {
    method: "POST",
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  });
}

export function updateTakeoffItem(
  workspaceId: string,
  id: string,
  body: TakeoffPatch,
): Promise<TakeoffItem> {
  return api(`/takeoff-items/${id}`, {
    method: "PATCH",
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  });
}

export function listRecipes(
  workspaceId: string,
  query?: { familyId?: string; includeArchived?: boolean },
): Promise<{ recipes: RecipeSummary[] }> {
  const params = new URLSearchParams();
  if (query?.includeArchived) {
    params.set("include_archived", "true");
  }
  if (query?.familyId) {
    params.set("family_id", query.familyId);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return api(`/cost-recipes${suffix}`, { headers: workspaceHeaders(workspaceId) });
}

export function getRecipe(workspaceId: string, id: string): Promise<Recipe> {
  return api(`/cost-recipes/${id}`, { headers: workspaceHeaders(workspaceId) });
}

export function createRecipe(workspaceId: string, body: RecipeWrite): Promise<Recipe> {
  return api("/cost-recipes", {
    method: "POST",
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  });
}

export function updateRecipe(
  workspaceId: string,
  id: string,
  body: Partial<RecipeWrite> & { status?: Recipe["status"] },
): Promise<Recipe> {
  return api(`/cost-recipes/${id}`, {
    method: "PATCH",
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  });
}

export function previewRecipe(
  workspaceId: string,
  id: string,
  body: PreviewBody,
): Promise<PreviewResult> {
  return api(`/cost-recipes/${id}/preview`, {
    method: "POST",
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  });
}

export function validateFormulaRequest(
  workspaceId: string,
  formula: string,
  variables: string[],
): Promise<FormulaCheck> {
  return api("/formula/validate", {
    method: "POST",
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({ formula, variables }),
  });
}
