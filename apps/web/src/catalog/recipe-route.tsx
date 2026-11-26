import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@groundwork/ui";

import { ApiError, activeWorkspace, loadMe } from "../session";
import { canManageCatalog } from "./access";
import {
  createRecipe,
  errorMessage,
  getRecipe,
  listCatalog,
  listRecipes,
  listTakeoff,
  previewRecipe,
  updateRecipe,
  validateFormulaRequest,
} from "./client";
import { RecipeBuilder } from "./recipe-builder";
import { CatalogSectionNav } from "./section-nav";
import type { PreviewBody, RecipeWrite } from "./types";

function useWorkspaceId(): string | undefined {
  const profile = useQuery({ queryKey: ["me"], queryFn: loadMe });
  return profile.data ? activeWorkspace(profile.data)?.workspace_id : undefined;
}

export function RecipeIndexRoute() {
  const profile = useQuery({ queryKey: ["me"], queryFn: loadMe });
  const workspaceId = profile.data ? activeWorkspace(profile.data)?.workspace_id : undefined;
  const recipes = useQuery({
    queryKey: ["cost-recipes", workspaceId, "list"],
    queryFn: () => listRecipes(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
  });
  const manage = canManageCatalog(profile.data);

  if (!profile.data || !workspaceId) {
    return <p>Loading recipes.</p>;
  }

  const rows = recipes.data?.recipes ?? [];
  return (
    <div className="flex flex-col gap-6">
      <CatalogSectionNav />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-base leading-relaxed">
          A recipe turns a takeoff quantity into catalog costs. Editing an active recipe saves the
          next version as a draft.
        </p>
        {manage ? (
          <Button asChild>
            <Link to="/catalog/recipes/new">New recipe</Link>
          </Button>
        ) : null}
      </div>
      {recipes.error ? (
        <p role="alert">{errorMessage(recipes.error, "Could not load recipes.")}</p>
      ) : null}
      {recipes.isLoading ? (
        <p>Loading recipes.</p>
      ) : rows.length === 0 ? (
        <p>No cost recipes yet. Load the starter pack from the catalog, or create a draft.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-base">
            <caption className="sr-only">Cost recipes</caption>
            <thead>
              <tr>
                {["Name", "Version", "Status", "Input unit", "Open"].map((label) => (
                  <th key={label} scope="col" className="border-b border-line py-2 pr-3 text-left">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((recipe) => (
                <tr key={recipe.id}>
                  <th scope="row" className="py-3 pr-3 font-semibold">
                    {recipe.name}
                  </th>
                  <td className="py-3 pr-3">{recipe.version}</td>
                  <td className="py-3 pr-3">{recipe.status}</td>
                  <td className="py-3 pr-3">{recipe.input_unit}</td>
                  <td className="py-3">
                    <Link
                      className="font-semibold underline"
                      to="/catalog/recipes/$recipeId"
                      params={{ recipeId: recipe.id }}
                    >
                      Open {recipe.name} version {recipe.version}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function RecipeCreateRoute() {
  return <RecipeEditor recipeId={null} />;
}

export function RecipeEditorRoute({ recipeId }: { recipeId: string }) {
  return <RecipeEditor recipeId={recipeId} />;
}

function RecipeEditor({ recipeId }: { recipeId: string | null }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["me"], queryFn: loadMe });
  const workspaceId = useWorkspaceId();
  const recipe = useQuery({
    queryKey: ["cost-recipe", workspaceId, recipeId],
    queryFn: () => getRecipe(workspaceId ?? "", recipeId ?? ""),
    enabled: Boolean(workspaceId && recipeId),
  });
  const familyId = recipe.data?.family_id;
  const versions = useQuery({
    queryKey: ["cost-recipes", workspaceId, "family", familyId],
    queryFn: () =>
      listRecipes(workspaceId ?? "", {
        familyId: familyId ?? "",
        includeArchived: true,
      }),
    enabled: Boolean(workspaceId && familyId),
  });
  const catalog = useQuery({
    queryKey: ["catalog-items", workspaceId],
    queryFn: () => listCatalog(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
  });
  const takeoff = useQuery({
    queryKey: ["takeoff-items", workspaceId],
    queryFn: () => listTakeoff(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
  });
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const validate = useCallback(
    (formula: string, variables: string[]) => {
      if (!workspaceId) {
        return Promise.reject(new ApiError(400, "Choose a workspace first."));
      }
      return validateFormulaRequest(workspaceId, formula, variables);
    },
    [workspaceId],
  );
  const preview = useCallback(
    (body: PreviewBody) => {
      if (!workspaceId || !recipeId) {
        return Promise.reject(new ApiError(400, "Save the recipe before previewing it."));
      }
      return previewRecipe(workspaceId, recipeId, body);
    },
    [workspaceId, recipeId],
  );

  if (!profile.data || !workspaceId) {
    return <p>Loading recipe.</p>;
  }
  if (recipeId && recipe.isLoading) {
    return <p>Loading recipe.</p>;
  }
  if (recipeId && (recipe.error || !recipe.data)) {
    return (
      <div className="flex flex-col gap-4">
        <CatalogSectionNav />
        <p role="alert">{errorMessage(recipe.error, "That recipe was not found.")}</p>
      </div>
    );
  }

  const current = recipe.data ?? null;
  const save = async (body: RecipeWrite) => {
    if (recipeId && current) {
      const saved = await updateRecipe(workspaceId, recipeId, body);
      client.setQueryData(["cost-recipe", workspaceId, saved.id], saved);
      await client.invalidateQueries({ queryKey: ["cost-recipes", workspaceId] });
      if (saved.id !== current.id) {
        setNotice({
          id: saved.id,
          text: `Saved as version ${saved.version}. Version ${current.version} was not changed.`,
        });
        await navigate({ to: "/catalog/recipes/$recipeId", params: { recipeId: saved.id } });
        return;
      }
      setNotice({ id: saved.id, text: "Draft saved." });
      return;
    }
    const saved = await createRecipe(workspaceId, body);
    client.setQueryData(["cost-recipe", workspaceId, saved.id], saved);
    await client.invalidateQueries({ queryKey: ["cost-recipes", workspaceId] });
    await navigate({ to: "/catalog/recipes/$recipeId", params: { recipeId: saved.id } });
  };

  return (
    <div className="flex flex-col gap-6">
      <CatalogSectionNav />
      <RecipeBuilder
        key={current ? `${current.id}:${current.updated_at}` : "new"}
        recipe={current}
        catalog={(catalog.data?.items ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          unit: item.unit,
        }))}
        takeoff={takeoff.data?.items ?? []}
        versions={versions.data?.recipes ?? []}
        canManage={canManageCatalog(profile.data)}
        notice={notice && current && notice.id === current.id ? notice.text : null}
        onValidate={validate}
        onPreview={preview}
        onSave={save}
        onActivate={async () => {
          if (!recipeId || !current) {
            return;
          }
          const saved = await updateRecipe(workspaceId, recipeId, { status: "active" });
          client.setQueryData(["cost-recipe", workspaceId, saved.id], saved);
          await client.invalidateQueries({ queryKey: ["cost-recipes", workspaceId] });
          setNotice({ id: saved.id, text: "Version activated." });
        }}
      />
    </div>
  );
}
