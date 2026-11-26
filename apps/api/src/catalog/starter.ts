import { measureKindOfUnit, unitsShareKind } from "@groundwork/geo";
import { BUILTIN_VARIABLES, isDecimalString, validateFormula } from "@groundwork/pricing";
import { createId } from "@groundwork/shared";
import { sql, type Transaction } from "kysely";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";

import type { Database } from "../db/types.js";

/**
 * Clean-room paving and landscaping starter. The quantities are geometry
 * (volume = area × depth, tons = pounds / 2000, cubic yards = cubic feet / 27)
 * with round defaults chosen for this pack. Nothing here is copied from a
 * catalog, a price book, or another product.
 *
 * The file stays in db/seed. This module reads it from the repo tree. From
 * either apps/api/src/catalog or apps/api/dist/catalog, four levels up is the
 * repository root.
 */

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WASTE = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const FUNCTIONS = new Set(["ceil", "floor", "round", "min", "max", "if"]);
const RESERVED = new Set<string>([...BUILTIN_VARIABLES, ...FUNCTIONS]);

const catalogSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  kind: z.enum(["material", "labor", "equipment", "sub", "fee"]),
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(40),
  unit_cost_cents: z.number().int().nonnegative(),
  unit_price_cents: z.number().int().nonnegative(),
  waste_pct: z.string(),
  vendor: z.string().max(200).nullable(),
  tax_code: z.string().max(40).nullable(),
});

const takeoffSchema = z.object({
  name: z.string().trim().min(1).max(200),
  measure_kind: z.enum(["area", "length", "count"]),
  default_unit: z.string().trim().min(1).max(40),
  category: z
    .enum(["paving", "landscape", "hardscape", "concrete", "striping", "other"])
    .nullable(),
  color: z.string().trim().max(32).nullable(),
});

const recipeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  takeoff_name: z.string().trim().min(1).max(200).nullable(),
  input_unit: z.string().trim().min(1).max(40),
  variables: z.record(z.string(), z.string()),
  components: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(80),
        qty_formula: z.string().min(1).max(2000),
      }),
    )
    .max(100),
});

const starterPackSchema = z.object({
  catalog: z.array(catalogSchema).min(1),
  takeoff: z.array(takeoffSchema).min(1),
  recipes: z.array(recipeSchema).min(1),
});

export type StarterPack = z.infer<typeof starterPackSchema>;
export type StarterCatalog = StarterPack["catalog"][number];
export type StarterTakeoff = StarterPack["takeoff"][number];
export type StarterRecipe = StarterPack["recipes"][number];

export type StarterExisting = {
  catalogSkus: readonly string[];
  takeoffNames: readonly string[];
  recipeNames: readonly string[];
};

export type StarterPlan = {
  catalogToCreate: StarterCatalog[];
  catalogSkipped: string[];
  takeoffToCreate: StarterTakeoff[];
  takeoffSkipped: string[];
  recipesToCreate: StarterRecipe[];
  recipesSkipped: string[];
};

export type StarterApplyResult = {
  catalog_created: string[];
  catalog_skipped: string[];
  takeoff_created: string[];
  takeoff_skipped: string[];
  recipes_created: string[];
  recipes_skipped: string[];
};

type Trx = Transaction<Database>;

export function starterPackPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../../../db/seed/starter-pack.json");
}

export function loadStarterPack(): StarterPack {
  const parsed = starterPackSchema.parse(JSON.parse(readFileSync(starterPackPath(), "utf8")));
  return parsed;
}

function assertWaste(label: string, value: string): void {
  if (!WASTE.test(value) || Number(value) < 0 || Number(value) > 100) {
    throw new Error(`${label} waste percent must be from 0 to 100.`);
  }
}

export function assertStarterPack(pack: StarterPack): void {
  const skus = new Set<string>();
  for (const item of pack.catalog) {
    if (skus.has(item.sku)) {
      throw new Error(`Starter pack has a duplicate sku ${item.sku}.`);
    }
    skus.add(item.sku);
    assertWaste(item.sku, item.waste_pct);
  }
  const takeoffNames = new Set<string>();
  for (const item of pack.takeoff) {
    if (takeoffNames.has(item.name)) {
      throw new Error(`Starter pack has a duplicate takeoff item ${item.name}.`);
    }
    takeoffNames.add(item.name);
    if (!measureKindOfUnit(item.default_unit)) {
      throw new Error(`${item.name} default unit ${item.default_unit} is not a measure unit.`);
    }
    if (measureKindOfUnit(item.default_unit) !== item.measure_kind) {
      throw new Error(`${item.name} default unit does not match ${item.measure_kind}.`);
    }
  }
  const recipeNames = new Set<string>();
  for (const recipe of pack.recipes) {
    if (recipeNames.has(recipe.name)) {
      throw new Error(`Starter pack has a duplicate recipe ${recipe.name}.`);
    }
    recipeNames.add(recipe.name);
    if (!measureKindOfUnit(recipe.input_unit)) {
      throw new Error(`${recipe.name} input unit ${recipe.input_unit} is not a measure unit.`);
    }
    if (recipe.takeoff_name) {
      const takeoff = pack.takeoff.find((item) => item.name === recipe.takeoff_name);
      if (!takeoff) {
        throw new Error(`${recipe.name} links to a missing takeoff item.`);
      }
      if (!unitsShareKind(recipe.input_unit, takeoff.default_unit)) {
        throw new Error(`${recipe.name} input unit does not match its takeoff item.`);
      }
    }
    for (const [name, value] of Object.entries(recipe.variables)) {
      if (!IDENT.test(name) || name.length > 64 || RESERVED.has(name)) {
        throw new Error(`${recipe.name} variable ${name} is not allowed.`);
      }
      if (!isDecimalString(value) || value.length > 40) {
        throw new Error(`${recipe.name} variable ${name} must be a decimal.`);
      }
    }
    for (const component of recipe.components) {
      if (!skus.has(component.sku)) {
        throw new Error(`${recipe.name} uses a missing catalog item ${component.sku}.`);
      }
      const validation = validateFormula(component.qty_formula, Object.keys(recipe.variables));
      if (!validation.ok) {
        const detail = validation.errors.map((error) => error.message).join(" ");
        throw new Error(`${recipe.name} formula for ${component.sku} is invalid. ${detail}`);
      }
    }
  }
}

export function planStarter(pack: StarterPack, existing: StarterExisting): StarterPlan {
  const catalogSkus = new Set(existing.catalogSkus);
  const takeoffNames = new Set(existing.takeoffNames);
  const recipeNames = new Set(existing.recipeNames);
  const catalogToCreate = pack.catalog.filter((item) => !catalogSkus.has(item.sku));
  const takeoffToCreate = pack.takeoff.filter((item) => !takeoffNames.has(item.name));
  const availableSkus = new Set([...catalogSkus, ...catalogToCreate.map((item) => item.sku)]);
  const availableTakeoff = new Set([...takeoffNames, ...takeoffToCreate.map((item) => item.name)]);
  const recipesToCreate: StarterRecipe[] = [];
  const recipesSkipped: string[] = [];
  for (const recipe of pack.recipes) {
    const missingSku = recipe.components.some((component) => !availableSkus.has(component.sku));
    const missingTakeoff =
      recipe.takeoff_name !== null && !availableTakeoff.has(recipe.takeoff_name);
    if (recipeNames.has(recipe.name) || missingSku || missingTakeoff) {
      recipesSkipped.push(recipe.name);
      continue;
    }
    recipesToCreate.push(recipe);
  }
  return {
    catalogToCreate,
    catalogSkipped: pack.catalog
      .filter((item) => catalogSkus.has(item.sku))
      .map((item) => item.sku),
    takeoffToCreate,
    takeoffSkipped: pack.takeoff
      .filter((item) => takeoffNames.has(item.name))
      .map((item) => item.name),
    recipesToCreate,
    recipesSkipped,
  };
}

function jsonVariables(variables: Record<string, string>) {
  return sql`${JSON.stringify(variables)}::jsonb`;
}

export async function applyStarterPack(
  trx: Trx,
  workspaceId: string,
  memberId: string,
): Promise<StarterApplyResult> {
  const pack = loadStarterPack();
  assertStarterPack(pack);
  const catalogRows = await trx
    .selectFrom("catalog_item")
    .select(["id", "sku"])
    .where("sku", "is not", null)
    .execute();
  const takeoffRows = await trx.selectFrom("takeoff_item").select(["id", "name"]).execute();
  const recipeRows = await trx.selectFrom("cost_recipe").select("name").execute();
  const plan = planStarter(pack, {
    catalogSkus: catalogRows.flatMap((row) => (row.sku ? [row.sku] : [])),
    takeoffNames: takeoffRows.map((row) => row.name),
    recipeNames: recipeRows.map((row) => row.name),
  });

  const skuToId = new Map<string, string>();
  for (const row of catalogRows) {
    if (row.sku) {
      skuToId.set(row.sku, row.id);
    }
  }
  let firstId: string | null = null;
  for (const item of plan.catalogToCreate) {
    const id = createId();
    firstId ??= id;
    await trx
      .insertInto("catalog_item")
      .values({
        id,
        workspace_id: workspaceId,
        kind: item.kind,
        name: item.name,
        unit: item.unit,
        unit_cost_cents: String(item.unit_cost_cents),
        unit_price_cents: String(item.unit_price_cents),
        waste_pct: item.waste_pct,
        vendor: item.vendor,
        sku: item.sku,
        tax_code: item.tax_code,
        archived_at: null,
        created_by: memberId,
      })
      .execute();
    skuToId.set(item.sku, id);
  }

  const takeoffToId = new Map(takeoffRows.map((row) => [row.name, row.id]));
  for (const item of plan.takeoffToCreate) {
    const id = createId();
    firstId ??= id;
    await trx
      .insertInto("takeoff_item")
      .values({
        id,
        workspace_id: workspaceId,
        name: item.name,
        measure_kind: item.measure_kind,
        default_unit: item.default_unit,
        category: item.category,
        color: item.color,
        archived_at: null,
        created_by: memberId,
      })
      .execute();
    takeoffToId.set(item.name, id);
  }

  for (const recipe of plan.recipesToCreate) {
    const id = createId();
    firstId ??= id;
    const takeoffId = recipe.takeoff_name ? (takeoffToId.get(recipe.takeoff_name) ?? null) : null;
    await trx
      .insertInto("cost_recipe")
      .values({
        id,
        workspace_id: workspaceId,
        family_id: id,
        name: recipe.name,
        takeoff_item_id: takeoffId,
        input_unit: recipe.input_unit,
        variables: jsonVariables(recipe.variables),
        version: 1,
        status: "draft",
        created_by: memberId,
      })
      .execute();
    if (recipe.components.length === 0) {
      continue;
    }
    await trx
      .insertInto("recipe_component")
      .values(
        recipe.components.map((component, index) => {
          const catalogItemId = skuToId.get(component.sku);
          if (!catalogItemId) {
            throw new Error(`Starter pack is missing catalog item ${component.sku}.`);
          }
          return {
            id: createId(),
            workspace_id: workspaceId,
            recipe_id: id,
            catalog_item_id: catalogItemId,
            qty_formula: component.qty_formula,
            sort: index,
          };
        }),
      )
      .execute();
  }

  const result: StarterApplyResult = {
    catalog_created: plan.catalogToCreate.map((item) => item.sku),
    catalog_skipped: plan.catalogSkipped,
    takeoff_created: plan.takeoffToCreate.map((item) => item.name),
    takeoff_skipped: plan.takeoffSkipped,
    recipes_created: plan.recipesToCreate.map((recipe) => recipe.name),
    recipes_skipped: plan.recipesSkipped,
  };
  if (firstId) {
    await trx
      .insertInto("audit_log")
      .values({
        workspace_id: workspaceId,
        actor_member_id: memberId,
        entity_type: "catalog_item",
        entity_id: firstId,
        action: "starter-pack",
        diff: result,
      })
      .execute();
  }
  return result;
}
