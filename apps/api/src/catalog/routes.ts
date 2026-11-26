import { measureKindOfUnit, unitsShareKind } from "@groundwork/geo";
import {
  BUILTIN_VARIABLES,
  builtinValues,
  isDecimalString,
  previewRecipe,
  validateFormula,
} from "@groundwork/pricing";
import {
  applyCostVisibility,
  assertCanVersion,
  catalogKindSchema,
  createId,
  hasPermission,
  IllegalRecipeTransitionError,
  isRecipeStatus,
  isUuidV7,
  measurementKindSchema,
  RecipeVersionError,
  recipeEditTarget,
  takeoffCategorySchema,
  transitionRecipe,
  type RecipeStatus,
} from "@groundwork/shared";
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest, RawServerDefault } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { sql, type Kysely, type Selectable, type Transaction } from "kysely";
import type { IncomingMessage, ServerResponse } from "node:http";
import type pg from "pg";
import { z } from "zod/v4";

import type { Auth } from "../auth/auth.js";
import { requireActiveMember, requireSession, type MemberRow } from "../auth/guard.js";
import { workspaceIdFromHeader } from "../auth/hook.js";
import type { Database } from "../db/types.js";
import { withWorkspaceContext } from "../db/workspace.js";
import { ProblemError } from "../errors.js";
import { planCatalogImport, serializeCatalogCsv, type CatalogCsvRow } from "./csv.js";
import { applyStarterPack } from "./starter.js";

const TENANT = ["tenant-header"] as const;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FUNCTIONS = new Set(["ceil", "floor", "round", "min", "max", "if"]);

type ApiApp = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;
type AppDb = Kysely<Database>;
type Trx = Transaction<Database>;

export type CatalogContext = {
  db: AppDb;
  authPool: pg.Pool;
  auth: Auth;
};

type CatalogRow = Selectable<Database["catalog_item"]>;
type TakeoffRow = Selectable<Database["takeoff_item"]>;
type RecipeRow = Selectable<Database["cost_recipe"]>;
type ComponentRow = Selectable<Database["recipe_component"]>;

const catalogItemSchema = z.object({
  id: z.string(),
  kind: catalogKindSchema,
  name: z.string(),
  unit: z.string(),
  unit_price_cents: z.number().int(),
  unit_cost_cents: z.number().int().optional(),
  waste_pct: z.string(),
  vendor: z.string().nullable(),
  sku: z.string().nullable(),
  tax_code: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const takeoffItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  measure_kind: measurementKindSchema,
  default_unit: z.string(),
  category: takeoffCategorySchema.nullable(),
  color: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const componentSchema = z.object({
  id: z.string(),
  catalog_item_id: z.string(),
  qty_formula: z.string(),
  sort: z.number().int(),
});

const recipeSchema = z.object({
  id: z.string(),
  family_id: z.string(),
  name: z.string(),
  takeoff_item_id: z.string().nullable(),
  input_unit: z.string(),
  variables: z.record(z.string(), z.string()),
  version: z.number().int(),
  status: z.enum(["draft", "active", "archived"]),
  components: z.array(componentSchema),
  created_at: z.string(),
  updated_at: z.string(),
});

const componentBody = z.object({
  catalog_item_id: z.string(),
  qty_formula: z.string().min(1).max(2000),
  sort: z.number().int().nonnegative().optional(),
});

const variableMap = z.record(z.string(), z.string());

const catalogBody = z.object({
  kind: catalogKindSchema,
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(40),
  unit_cost_cents: z.number().int().nonnegative(),
  unit_price_cents: z.number().int().nonnegative().optional(),
  waste_pct: z.union([z.string(), z.number()]).optional(),
  vendor: z.string().trim().max(200).nullable().optional(),
  sku: z.string().trim().max(80).nullable().optional(),
  tax_code: z.string().trim().max(40).nullable().optional(),
});

const catalogPatch = catalogBody.partial();

const takeoffBody = z.object({
  name: z.string().trim().min(1).max(200),
  measure_kind: measurementKindSchema,
  default_unit: z.string().trim().min(1).max(40),
  category: takeoffCategorySchema.nullable().optional(),
  color: z.string().trim().max(32).nullable().optional(),
  archived: z.boolean().optional(),
});

const recipeBody = z.object({
  name: z.string().trim().min(1).max(200),
  input_unit: z.string().trim().min(1).max(40),
  takeoff_item_id: z.string().nullable().optional(),
  variables: variableMap.optional(),
  components: z.array(componentBody).max(100).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

function badRequest(detail: string, errors?: { message: string; path?: string }[]): ProblemError {
  return new ProblemError({
    status: 400,
    title: "Bad Request",
    detail,
    errors,
  });
}

function conflict(detail: string): ProblemError {
  return new ProblemError({ status: 409, title: "Conflict", detail });
}

function forbidden(): ProblemError {
  return new ProblemError({
    status: 403,
    title: "Forbidden",
    detail: "You do not have permission to do that.",
  });
}

function notFound(detail: string): ProblemError {
  return new ProblemError({ status: 404, title: "Not Found", detail });
}

function requireManage(permissions: readonly string[]): void {
  if (!hasPermission(permissions, "catalog.manage")) {
    throw forbidden();
  }
}

function iso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function cents(value: string | number): number {
  const text = String(value);
  if (!/^(?:0|[1-9]\d*)$/.test(text)) {
    throw new ProblemError({
      status: 500,
      title: "Internal Server Error",
      detail: "Stored cents were not an integer.",
    });
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new ProblemError({
      status: 500,
      title: "Internal Server Error",
      detail: "Stored cents were too large.",
    });
  }
  return parsed;
}

function wasteText(value: string | number | undefined): string {
  const text = value === undefined ? "0" : String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) {
    throw badRequest("Waste percent must be from 0 to 100 with at most two decimal places.");
  }
  const parsed = Number(text);
  if (parsed < 0 || parsed > 100) {
    throw badRequest("Waste percent must be from 0 to 100 with at most two decimal places.");
  }
  return text;
}

function blank(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function presentCatalog(row: CatalogRow, permissions: readonly string[]) {
  return applyCostVisibility(
    {
      id: row.id,
      kind: catalogKindSchema.parse(row.kind),
      name: row.name,
      unit: row.unit,
      unit_price_cents: cents(row.unit_price_cents),
      unit_cost_cents: cents(row.unit_cost_cents),
      waste_pct: String(row.waste_pct),
      vendor: row.vendor,
      sku: row.sku,
      tax_code: row.tax_code,
      archived_at: iso(row.archived_at),
      created_at: iso(row.created_at) ?? "",
      updated_at: iso(row.updated_at) ?? "",
    },
    permissions,
  );
}

function presentTakeoff(row: TakeoffRow) {
  return {
    id: row.id,
    name: row.name,
    measure_kind: measurementKindSchema.parse(row.measure_kind),
    default_unit: row.default_unit,
    category: row.category === null ? null : takeoffCategorySchema.parse(row.category),
    color: row.color,
    archived_at: iso(row.archived_at),
    created_at: iso(row.created_at) ?? "",
    updated_at: iso(row.updated_at) ?? "",
  };
}

function variableRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      record[key] = item;
    } else if (typeof item === "number" && Number.isFinite(item)) {
      record[key] = String(item);
    }
  }
  return record;
}

function presentRecipe(row: RecipeRow, components: ComponentRow[]) {
  if (!isRecipeStatus(row.status)) {
    throw new ProblemError({
      status: 500,
      title: "Internal Server Error",
      detail: "Stored recipe status was not recognized.",
    });
  }
  return {
    id: row.id,
    family_id: row.family_id,
    name: row.name,
    takeoff_item_id: row.takeoff_item_id,
    input_unit: row.input_unit,
    variables: variableRecord(row.variables),
    version: row.version,
    status: row.status,
    components: components
      .slice()
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      .map((component) => ({
        id: component.id,
        catalog_item_id: component.catalog_item_id,
        qty_formula: component.qty_formula,
        sort: component.sort,
      })),
    created_at: iso(row.created_at) ?? "",
    updated_at: iso(row.updated_at) ?? "",
  };
}

function assertVariables(variables: Record<string, string>): void {
  const names = Object.keys(variables);
  if (names.length > 40) {
    throw badRequest("A recipe can have at most 40 variables.");
  }
  for (const name of names) {
    if (!IDENT.test(name) || name.length > 64) {
      throw badRequest(`Variable ${name} must be an identifier.`);
    }
    if (
      BUILTIN_VARIABLES.includes(name as (typeof BUILTIN_VARIABLES)[number]) ||
      FUNCTIONS.has(name)
    ) {
      throw badRequest(`${name} is reserved.`);
    }
    const value = variables[name] ?? "";
    if (!isDecimalString(value) || value.length > 40) {
      throw badRequest(`${name} must be a decimal.`);
    }
  }
}

function assertMeasureUnit(unit: string, kind?: string): void {
  const actual = measureKindOfUnit(unit);
  if (!actual) {
    throw badRequest(`${unit} is not an area, length, or count unit.`);
  }
  if (kind && actual !== kind) {
    throw badRequest(`Unit ${unit} does not match ${kind}.`);
  }
}

function formulaProblems(
  formula: string,
  inputUnit: string,
  variables: Record<string, string>,
  path: string,
): { message: string; path: string }[] {
  const validation = validateFormula(formula, Object.keys(variables));
  const problems = validation.errors.map((error) => ({
    message: `${error.message} (position ${error.position})`,
    path,
  }));
  let available: string[];
  try {
    available = Object.keys(builtinValues("1", inputUnit));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown measure unit.";
    return [{ message, path }];
  }
  const allowed = new Set([...available, ...Object.keys(variables)]);
  for (const name of validation.referencedVars) {
    if (allowed.has(name)) {
      continue;
    }
    if (problems.some((problem) => problem.message.includes(name))) {
      continue;
    }
    const position = formula.indexOf(name);
    problems.push({
      message: `${name} is not available for ${inputUnit} (position ${position < 0 ? 0 : position}).`,
      path,
    });
  }
  return problems;
}

function assertFormulas(
  components: { qty_formula: string }[],
  inputUnit: string,
  variables: Record<string, string>,
): void {
  const problems = components.flatMap((component, index) =>
    formulaProblems(
      component.qty_formula,
      inputUnit,
      variables,
      `/components/${index}/qty_formula`,
    ),
  );
  if (problems.length > 0) {
    throw badRequest("A formula is not valid for this recipe.", problems);
  }
}

async function permissionsOf(trx: Trx, roleId: string): Promise<string[]> {
  const role = await trx
    .selectFrom("role")
    .select("permissions")
    .where("id", "=", roleId)
    .executeTakeFirst();
  return role?.permissions ?? [];
}

async function inWorkspace<T>(
  ctx: CatalogContext,
  request: FastifyRequest,
  fn: (scope: {
    trx: Trx;
    workspaceId: string;
    member: MemberRow;
    permissions: string[];
  }) => Promise<T>,
): Promise<T> {
  const session = await requireSession(ctx.auth, request.headers);
  const workspaceId = workspaceIdFromHeader(request);
  const member = await requireActiveMember(ctx, session.id, workspaceId);
  return withWorkspaceContext(ctx.db, workspaceId, async (trx) => {
    const permissions = await permissionsOf(trx, member.role_id);
    return fn({ trx, workspaceId, member, permissions });
  });
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ("code" in error && error.code === "23505") {
    return true;
  }
  return "cause" in error ? isUniqueViolation(error.cause) : false;
}

async function writeAudit(
  trx: Trx,
  input: {
    workspaceId: string;
    actorId: string;
    entityType: string;
    entityId: string;
    action: string;
    diff: Record<string, unknown>;
  },
): Promise<void> {
  await trx
    .insertInto("audit_log")
    .values({
      workspace_id: input.workspaceId,
      actor_member_id: input.actorId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      diff: input.diff,
    })
    .execute();
}

function jsonVariables(variables: Record<string, string>) {
  return sql`${JSON.stringify(variables)}::jsonb`;
}

async function loadComponents(trx: Trx, recipeId: string): Promise<ComponentRow[]> {
  return trx
    .selectFrom("recipe_component")
    .selectAll()
    .where("recipe_id", "=", recipeId)
    .orderBy("sort")
    .orderBy("id")
    .execute();
}

async function assertCatalogItems(
  trx: Trx,
  workspaceId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const rows = await trx
    .selectFrom("catalog_item")
    .select(["id", "archived_at"])
    .where("workspace_id", "=", workspaceId)
    .where("id", "in", [...ids])
    .execute();
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      throw badRequest("A catalog item on this recipe was not found.");
    }
    if (row.archived_at) {
      throw conflict("An archived catalog item cannot be added to a recipe.");
    }
  }
}

async function assertTakeoffLink(
  trx: Trx,
  workspaceId: string,
  takeoffItemId: string | null,
  inputUnit: string,
): Promise<void> {
  if (!takeoffItemId) {
    return;
  }
  if (!isUuidV7(takeoffItemId)) {
    throw badRequest("Takeoff item id must be a UUIDv7.");
  }
  const item = await trx
    .selectFrom("takeoff_item")
    .select(["id", "measure_kind"])
    .where("id", "=", takeoffItemId)
    .where("workspace_id", "=", workspaceId)
    .executeTakeFirst();
  if (!item) {
    throw notFound("That takeoff item was not found.");
  }
  if (!unitsShareKind(inputUnit, defaultUnitForKind(item.measure_kind))) {
    throw conflict(
      `The recipe measures ${measureKindOfUnit(inputUnit)} and the takeoff item measures ${item.measure_kind}.`,
    );
  }
}

function defaultUnitForKind(kind: string): string {
  if (kind === "area") {
    return "ft2";
  }
  if (kind === "length") {
    return "ft";
  }
  return "ea";
}

async function replaceComponents(
  trx: Trx,
  workspaceId: string,
  recipeId: string,
  components: { catalog_item_id: string; qty_formula: string; sort?: number | undefined }[],
): Promise<void> {
  await assertCatalogItems(
    trx,
    workspaceId,
    components.map((component) => component.catalog_item_id),
  );
  await trx.deleteFrom("recipe_component").where("recipe_id", "=", recipeId).execute();
  if (components.length === 0) {
    return;
  }
  await trx
    .insertInto("recipe_component")
    .values(
      components.map((component, index) => ({
        id: createId(),
        workspace_id: workspaceId,
        recipe_id: recipeId,
        catalog_item_id: component.catalog_item_id,
        qty_formula: component.qty_formula,
        sort: component.sort ?? index,
      })),
    )
    .execute();
}

async function copyComponents(
  trx: Trx,
  workspaceId: string,
  fromId: string,
  toId: string,
): Promise<void> {
  const components = await loadComponents(trx, fromId);
  if (components.length === 0) {
    return;
  }
  await trx
    .insertInto("recipe_component")
    .values(
      components.map((component) => ({
        id: createId(),
        workspace_id: workspaceId,
        recipe_id: toId,
        catalog_item_id: component.catalog_item_id,
        qty_formula: component.qty_formula,
        sort: component.sort,
      })),
    )
    .execute();
}

function guardRecipe(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof IllegalRecipeTransitionError || error instanceof RecipeVersionError) {
      throw conflict(error.message);
    }
    throw error;
  }
}

async function activateRecipe(trx: Trx, recipe: RecipeRow): Promise<void> {
  guardRecipe(() => {
    transitionRecipe(recipe.status as RecipeStatus, "active");
  });
  const current = await trx
    .selectFrom("cost_recipe")
    .selectAll()
    .where("family_id", "=", recipe.family_id)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (current && current.id !== recipe.id) {
    guardRecipe(() => {
      transitionRecipe(current.status as RecipeStatus, "archived");
    });
    await trx
      .updateTable("cost_recipe")
      .set({ status: "archived" })
      .where("id", "=", current.id)
      .execute();
  }
  await trx
    .updateTable("cost_recipe")
    .set({ status: "active" })
    .where("id", "=", recipe.id)
    .execute();
}

function includeArchived(value: string | undefined): boolean {
  return value === "true";
}

function csvRow(row: CatalogRow): CatalogCsvRow {
  return {
    sku: row.sku ?? "",
    kind: row.kind,
    name: row.name,
    unit: row.unit,
    unit_cost_cents: String(row.unit_cost_cents),
    unit_price_cents: String(row.unit_price_cents),
    waste_pct: String(row.waste_pct),
    vendor: row.vendor,
    tax_code: row.tax_code,
  };
}

export async function registerCatalogRoutes(app: ApiApp, ctx: CatalogContext): Promise<void> {
  app.get(
    "/catalog-items",
    {
      schema: {
        tags: [...TENANT],
        description: "Requires x-workspace-id. Unit cost is omitted without catalog.manage.",
        querystring: z.object({ include_archived: z.enum(["true", "false"]).optional() }),
        response: { 200: z.object({ items: z.array(catalogItemSchema) }) },
      },
    },
    async (request) => {
      return inWorkspace(ctx, request, async ({ trx, permissions }) => {
        let query = trx.selectFrom("catalog_item").selectAll().orderBy("name").orderBy("id");
        if (!includeArchived(request.query.include_archived)) {
          query = query.where("archived_at", "is", null);
        }
        const rows = await query.execute();
        return { items: rows.map((row) => presentCatalog(row, permissions)) };
      });
    },
  );

  app.post(
    "/catalog-items",
    {
      schema: {
        tags: [...TENANT],
        body: catalogBody,
        response: { 201: catalogItemSchema },
      },
    },
    async (request, reply) => {
      const item = await inWorkspace(
        ctx,
        request,
        async ({ trx, workspaceId, member, permissions }) => {
          requireManage(permissions);
          const id = createId();
          const sku = blank(request.body.sku);
          try {
            await trx
              .insertInto("catalog_item")
              .values({
                id,
                workspace_id: workspaceId,
                kind: request.body.kind,
                name: request.body.name,
                unit: request.body.unit,
                unit_cost_cents: String(request.body.unit_cost_cents),
                unit_price_cents: String(request.body.unit_price_cents ?? 0),
                waste_pct: wasteText(request.body.waste_pct),
                vendor: blank(request.body.vendor),
                sku,
                tax_code: blank(request.body.tax_code),
                archived_at: null,
                created_by: member.id,
              })
              .execute();
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw conflict(`SKU ${sku} is already in this workspace.`);
            }
            throw error;
          }
          await writeAudit(trx, {
            workspaceId,
            actorId: member.id,
            entityType: "catalog_item",
            entityId: id,
            action: "create",
            diff: { sku },
          });
          const row = await trx
            .selectFrom("catalog_item")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirstOrThrow();
          return presentCatalog(row, permissions);
        },
      );
      reply.code(201);
      return item;
    },
  );

  app.patch(
    "/catalog-items/:id",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.string() }),
        body: catalogPatch,
        response: { 200: catalogItemSchema },
      },
    },
    async (request) => {
      return inWorkspace(ctx, request, async ({ trx, workspaceId, permissions }) => {
        requireManage(permissions);
        if (!isUuidV7(request.params.id)) {
          throw badRequest("Catalog item id must be a UUIDv7.");
        }
        const current = await trx
          .selectFrom("catalog_item")
          .selectAll()
          .where("id", "=", request.params.id)
          .executeTakeFirst();
        if (!current) {
          throw notFound("That catalog item was not found.");
        }
        const sku = request.body.sku === undefined ? current.sku : blank(request.body.sku);
        try {
          await trx
            .updateTable("catalog_item")
            .set({
              kind: request.body.kind ?? current.kind,
              name: request.body.name ?? current.name,
              unit: request.body.unit ?? current.unit,
              unit_cost_cents:
                request.body.unit_cost_cents === undefined
                  ? current.unit_cost_cents
                  : String(request.body.unit_cost_cents),
              unit_price_cents:
                request.body.unit_price_cents === undefined
                  ? current.unit_price_cents
                  : String(request.body.unit_price_cents),
              waste_pct:
                request.body.waste_pct === undefined
                  ? current.waste_pct
                  : wasteText(request.body.waste_pct),
              vendor:
                request.body.vendor === undefined ? current.vendor : blank(request.body.vendor),
              sku,
              tax_code:
                request.body.tax_code === undefined
                  ? current.tax_code
                  : blank(request.body.tax_code),
            })
            .where("id", "=", current.id)
            .where("workspace_id", "=", workspaceId)
            .execute();
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw conflict(`SKU ${sku} is already in this workspace.`);
          }
          throw error;
        }
        const row = await trx
          .selectFrom("catalog_item")
          .selectAll()
          .where("id", "=", current.id)
          .executeTakeFirstOrThrow();
        return presentCatalog(row, permissions);
      });
    },
  );

  app.delete(
    "/catalog-items/:id",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.string() }),
        response: {
          200: catalogItemSchema,
          204: z.null(),
        },
      },
    },
    async (request, reply) => {
      const archived = await inWorkspace(
        ctx,
        request,
        async ({ trx, workspaceId, member, permissions }) => {
          requireManage(permissions);
          if (!isUuidV7(request.params.id)) {
            throw badRequest("Catalog item id must be a UUIDv7.");
          }
          const current = await trx
            .selectFrom("catalog_item")
            .selectAll()
            .where("id", "=", request.params.id)
            .executeTakeFirst();
          if (!current) {
            throw notFound("That catalog item was not found.");
          }
          const used = await trx
            .selectFrom("recipe_component")
            .select("id")
            .where("catalog_item_id", "=", current.id)
            .executeTakeFirst();
          if (used) {
            await trx
              .updateTable("catalog_item")
              .set({ archived_at: new Date() })
              .where("id", "=", current.id)
              .execute();
            await writeAudit(trx, {
              workspaceId,
              actorId: member.id,
              entityType: "catalog_item",
              entityId: current.id,
              action: "archive",
              diff: { reason: "referenced" },
            });
            const row = await trx
              .selectFrom("catalog_item")
              .selectAll()
              .where("id", "=", current.id)
              .executeTakeFirstOrThrow();
            return presentCatalog(row, permissions);
          }
          await trx.deleteFrom("catalog_item").where("id", "=", current.id).execute();
          await writeAudit(trx, {
            workspaceId,
            actorId: member.id,
            entityType: "catalog_item",
            entityId: current.id,
            action: "delete",
            diff: {},
          });
          return null;
        },
      );
      if (archived === null) {
        reply.code(204);
        return null;
      }
      return archived;
    },
  );

  app.post(
    "/catalog-items/import",
    {
      schema: {
        tags: [...TENANT],
        body: z.object({
          csv: z.string().min(1),
          apply: z.boolean().optional(),
        }),
        response: {
          200: z.object({
            apply: z.boolean(),
            created: z.array(z.object({ sku: z.string(), name: z.string() })),
            updated: z.array(
              z.object({
                sku: z.string(),
                changes: z.array(
                  z.object({
                    field: z.string(),
                    from: z.string().nullable(),
                    to: z.string().nullable(),
                  }),
                ),
              }),
            ),
            unchanged: z.array(z.string()),
            errors: z.array(z.object({ row: z.number().int(), message: z.string() })),
          }),
        },
      },
    },
    async (request) => {
      return inWorkspace(ctx, request, async ({ trx, workspaceId, member, permissions }) => {
        requireManage(permissions);
        const existing = await trx
          .selectFrom("catalog_item")
          .selectAll()
          .where("archived_at", "is", null)
          .where("sku", "is not", null)
          .execute();
        const plan = planCatalogImport(request.body.csv, existing.map(csvRow));
        const apply = request.body.apply === true;
        if (plan.errors.length > 0 && apply) {
          throw badRequest(
            "The CSV was not imported.",
            plan.errors.map((error) => ({
              message: `Row ${error.row}: ${error.message}`,
              path: "/csv",
            })),
          );
        }
        if (apply && plan.errors.length === 0) {
          const bySku = new Map(existing.map((row) => [row.sku, row]));
          for (const created of plan.created) {
            const id = createId();
            await trx
              .insertInto("catalog_item")
              .values({
                id,
                workspace_id: workspaceId,
                kind: created.kind,
                name: created.name,
                unit: created.unit,
                unit_cost_cents: created.unit_cost_cents,
                unit_price_cents: created.unit_price_cents,
                waste_pct: created.waste_pct,
                vendor: created.vendor,
                sku: created.sku,
                tax_code: created.tax_code,
                archived_at: null,
                created_by: member.id,
              })
              .execute();
          }
          for (const updated of plan.updated) {
            const current = bySku.get(updated.sku);
            if (!current) {
              continue;
            }
            const next = { ...csvRow(current) };
            for (const [field, change] of Object.entries(updated.changes)) {
              if (field === "vendor" || field === "tax_code") {
                next[field] = change.to;
              } else if (
                field === "kind" ||
                field === "name" ||
                field === "unit" ||
                field === "unit_cost_cents" ||
                field === "unit_price_cents" ||
                field === "waste_pct"
              ) {
                next[field] = change.to ?? "";
              }
            }
            await trx
              .updateTable("catalog_item")
              .set({
                kind: next.kind,
                name: next.name,
                unit: next.unit,
                unit_cost_cents: next.unit_cost_cents,
                unit_price_cents: next.unit_price_cents,
                waste_pct: next.waste_pct,
                vendor: next.vendor,
                tax_code: next.tax_code,
              })
              .where("id", "=", current.id)
              .execute();
          }
        }
        return {
          apply,
          created: plan.created.map((row) => ({ sku: row.sku, name: row.name })),
          updated: plan.updated.map((row) => ({
            sku: row.sku,
            changes: Object.entries(row.changes).map(([field, change]) => ({
              field,
              from: change.from,
              to: change.to,
            })),
          })),
          unchanged: plan.unchanged,
          errors: plan.errors,
        };
      });
    },
  );

  app.get(
    "/catalog-items/export",
    {
      schema: {
        tags: [...TENANT],
        description: "Requires catalog.manage. The body is text/csv.",
      },
    },
    async (request, reply) => {
      const csv = await inWorkspace(ctx, request, async ({ trx, permissions }) => {
        requireManage(permissions);
        const rows = await trx
          .selectFrom("catalog_item")
          .selectAll()
          .where("archived_at", "is", null)
          .where("sku", "is not", null)
          .orderBy("sku")
          .orderBy("name")
          .orderBy("id")
          .execute();
        return serializeCatalogCsv(rows.map(csvRow));
      });
      return reply.type("text/csv; charset=utf-8").send(csv);
    },
  );

  app.post(
    "/catalog-items/starter-pack",
    {
      schema: {
        tags: [...TENANT],
        description:
          "Inserts the clean-room starter pack for this workspace. Existing SKUs, takeoff names, and recipe names are left as they are.",
        body: z.object({}),
        response: {
          200: z.object({
            catalog_created: z.array(z.string()),
            catalog_skipped: z.array(z.string()),
            takeoff_created: z.array(z.string()),
            takeoff_skipped: z.array(z.string()),
            recipes_created: z.array(z.string()),
            recipes_skipped: z.array(z.string()),
          }),
        },
      },
    },
    async (request) => {
      return inWorkspace(ctx, request, async ({ trx, workspaceId, member, permissions }) => {
        requireManage(permissions);
        return applyStarterPack(trx, workspaceId, member.id);
      });
    },
  );

  app.get(
    "/takeoff-items",
    {
      schema: {
        tags: [...TENANT],
        querystring: z.object({ include_archived: z.enum(["true", "false"]).optional() }),
        response: { 200: z.object({ items: z.array(takeoffItemSchema) }) },
      },
    },
    async (request) => {
      return inWorkspace(ctx, request, async ({ trx }) => {
        let query = trx.selectFrom("takeoff_item").selectAll().orderBy("name").orderBy("id");
        if (!includeArchived(request.query.include_archived)) {
          query = query.where("archived_at", "is", null);
        }
        const rows = await query.execute();
        return { items: rows.map(presentTakeoff) };
      });
    },
  );

  app.post(
    "/takeoff-items",
    {
      schema: {
        tags: [...TENANT],
        body: takeoffBody.omit({ archived: true }),
        response: { 201: takeoffItemSchema },
      },
    },
    async (request, reply) => {
      const item = await inWorkspace(
        ctx,
        request,
        async ({ trx, workspaceId, member, permissions }) => {
          requireManage(permissions);
          assertMeasureUnit(request.body.default_unit, request.body.measure_kind);
          const id = createId();
          await trx
            .insertInto("takeoff_item")
            .values({
              id,
              workspace_id: workspaceId,
              name: request.body.name,
              measure_kind: request.body.measure_kind,
              default_unit: request.body.default_unit,
              category: request.body.category ?? null,
              color: blank(request.body.color),
              archived_at: null,
              created_by: member.id,
            })
            .execute();
          const row = await trx
            .selectFrom("takeoff_item")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirstOrThrow();
          return presentTakeoff(row);
        },
      );
      reply.code(201);
      return item;
    },
  );

  app.patch(
    "/takeoff-items/:id",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.string() }),
        body: takeoffBody.partial(),
        response: { 200: takeoffItemSchema },
      },
    },
    async (request) => {
      return inWorkspace(ctx, request, async ({ trx, workspaceId, permissions }) => {
        requireManage(permissions);
        if (!isUuidV7(request.params.id)) {
          throw badRequest("Takeoff item id must be a UUIDv7.");
        }
        const current = await trx
          .selectFrom("takeoff_item")
          .selectAll()
          .where("id", "=", request.params.id)
          .executeTakeFirst();
        if (!current) {
          throw notFound("That takeoff item was not found.");
        }
        const measureKind = request.body.measure_kind ?? current.measure_kind;
        const unit = request.body.default_unit ?? current.default_unit;
        assertMeasureUnit(unit, measureKind);
        const linked = await trx
          .selectFrom("cost_recipe")
          .select(["id", "input_unit"])
          .where("takeoff_item_id", "=", current.id)
          .execute();
        for (const recipe of linked) {
          if (!unitsShareKind(recipe.input_unit, unit)) {
            throw conflict(
              `A linked recipe measures ${measureKindOfUnit(recipe.input_unit)} and this item would measure ${measureKind}.`,
            );
          }
        }
        await trx
          .updateTable("takeoff_item")
          .set({
            name: request.body.name ?? current.name,
            measure_kind: measureKind,
            default_unit: unit,
            category:
              request.body.category === undefined ? current.category : request.body.category,
            color: request.body.color === undefined ? current.color : blank(request.body.color),
            archived_at:
              request.body.archived === undefined
                ? current.archived_at
                : request.body.archived
                  ? new Date()
                  : null,
          })
          .where("id", "=", current.id)
          .where("workspace_id", "=", workspaceId)
          .execute();
        const row = await trx
          .selectFrom("takeoff_item")
          .selectAll()
          .where("id", "=", current.id)
          .executeTakeFirstOrThrow();
        return presentTakeoff(row);
      });
    },
  );

  app.get(
    "/cost-recipes",
    {
      schema: {
        tags: [...TENANT],
        querystring: z.object({
          include_archived: z.enum(["true", "false"]).optional(),
          family_id: z.string().optional(),
        }),
        response: {
          200: z.object({
            recipes: z.array(recipeSchema.omit({ components: true, variables: true })),
          }),
        },
      },
    },
    async (request) => {
      return inWorkspace(ctx, request, async ({ trx }) => {
        let query = trx.selectFrom("cost_recipe").selectAll().orderBy("name").orderBy("version");
        if (!includeArchived(request.query.include_archived)) {
          query = query.where("status", "!=", "archived");
        }
        if (request.query.family_id) {
          if (!isUuidV7(request.query.family_id)) {
            throw badRequest("Family id must be a UUIDv7.");
          }
          query = query.where("family_id", "=", request.query.family_id);
        }
        const rows = await query.execute();
        return {
          recipes: rows.map((row) => {
            const presented = presentRecipe(row, []);
            return {
              id: presented.id,
              family_id: presented.family_id,
              name: presented.name,
              takeoff_item_id: presented.takeoff_item_id,
              input_unit: presented.input_unit,
              version: presented.version,
              status: presented.status,
              created_at: presented.created_at,
              updated_at: presented.updated_at,
            };
          }),
        };
      });
    },
  );

  app.post(
    "/cost-recipes",
    {
      schema: {
        tags: [...TENANT],
        body: recipeBody.omit({ status: true }),
        response: { 201: recipeSchema },
      },
    },
    async (request, reply) => {
      const recipe = await inWorkspace(
        ctx,
        request,
        async ({ trx, workspaceId, member, permissions }) => {
          requireManage(permissions);
          const variables = request.body.variables ?? {};
          assertVariables(variables);
          assertMeasureUnit(request.body.input_unit);
          assertFormulas(request.body.components ?? [], request.body.input_unit, variables);
          await assertTakeoffLink(
            trx,
            workspaceId,
            request.body.takeoff_item_id ?? null,
            request.body.input_unit,
          );
          const id = createId();
          await trx
            .insertInto("cost_recipe")
            .values({
              id,
              workspace_id: workspaceId,
              family_id: id,
              name: request.body.name,
              takeoff_item_id: request.body.takeoff_item_id ?? null,
              input_unit: request.body.input_unit,
              variables: jsonVariables(variables),
              version: 1,
              status: "draft",
              created_by: member.id,
            })
            .execute();
          await replaceComponents(trx, workspaceId, id, request.body.components ?? []);
          const row = await trx
            .selectFrom("cost_recipe")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirstOrThrow();
          return presentRecipe(row, await loadComponents(trx, id));
        },
      );
      reply.code(201);
      return recipe;
    },
  );

  app.get(
    "/cost-recipes/:id",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.string() }),
        response: { 200: recipeSchema },
      },
    },
    async (request) => {
      return inWorkspace(ctx, request, async ({ trx }) => {
        if (!isUuidV7(request.params.id)) {
          throw badRequest("Recipe id must be a UUIDv7.");
        }
        const row = await trx
          .selectFrom("cost_recipe")
          .selectAll()
          .where("id", "=", request.params.id)
          .executeTakeFirst();
        if (!row) {
          throw notFound("That recipe was not found.");
        }
        return presentRecipe(row, await loadComponents(trx, row.id));
      });
    },
  );

  app.patch(
    "/cost-recipes/:id",
    {
      schema: {
        tags: [...TENANT, "state-machine"],
        params: z.object({ id: z.string() }),
        body: recipeBody.partial(),
        response: { 200: recipeSchema },
      },
    },
    async (request) => {
      return inWorkspace(ctx, request, async ({ trx, workspaceId, member, permissions }) => {
        requireManage(permissions);
        if (!isUuidV7(request.params.id)) {
          throw badRequest("Recipe id must be a UUIDv7.");
        }
        const current = await trx
          .selectFrom("cost_recipe")
          .selectAll()
          .where("id", "=", request.params.id)
          .executeTakeFirst();
        if (!current || !isRecipeStatus(current.status)) {
          throw notFound("That recipe was not found.");
        }
        const content =
          request.body.name !== undefined ||
          request.body.input_unit !== undefined ||
          request.body.takeoff_item_id !== undefined ||
          request.body.variables !== undefined ||
          request.body.components !== undefined;
        let target = current;
        if (content) {
          guardRecipe(() => {
            recipeEditTarget(current.status as RecipeStatus);
          });
          if (current.status === "active") {
            const openDraft = await trx
              .selectFrom("cost_recipe")
              .select("id")
              .where("family_id", "=", current.family_id)
              .where("status", "=", "draft")
              .executeTakeFirst();
            if (openDraft) {
              throw conflict("A draft of this recipe already exists.");
            }
            const version = await nextVersion(trx, current.family_id);
            const id = createId();
            await trx
              .insertInto("cost_recipe")
              .values({
                id,
                workspace_id: workspaceId,
                family_id: current.family_id,
                name: current.name,
                takeoff_item_id: current.takeoff_item_id,
                input_unit: current.input_unit,
                variables: jsonVariables(variableRecord(current.variables)),
                version,
                status: "draft",
                created_by: member.id,
              })
              .execute();
            await copyComponents(trx, workspaceId, current.id, id);
            target =
              (await trx
                .selectFrom("cost_recipe")
                .selectAll()
                .where("id", "=", id)
                .executeTakeFirst()) ?? target;
          }
        }
        const variables =
          request.body.variables === undefined
            ? variableRecord(target.variables)
            : request.body.variables;
        const inputUnit = request.body.input_unit ?? target.input_unit;
        const takeoffItemId =
          request.body.takeoff_item_id === undefined
            ? target.takeoff_item_id
            : request.body.takeoff_item_id;
        assertVariables(variables);
        assertMeasureUnit(inputUnit);
        if (request.body.components) {
          assertFormulas(request.body.components, inputUnit, variables);
        } else if (request.body.input_unit || request.body.variables) {
          const existing = await loadComponents(trx, target.id);
          assertFormulas(existing, inputUnit, variables);
        }
        await assertTakeoffLink(trx, workspaceId, takeoffItemId, inputUnit);
        await trx
          .updateTable("cost_recipe")
          .set({
            name: request.body.name ?? target.name,
            input_unit: inputUnit,
            takeoff_item_id: takeoffItemId,
            variables: jsonVariables(variables),
          })
          .where("id", "=", target.id)
          .execute();
        if (request.body.components) {
          await replaceComponents(trx, workspaceId, target.id, request.body.components);
        }
        if (request.body.status && request.body.status !== target.status) {
          if (request.body.status === "active") {
            const fresh = await trx
              .selectFrom("cost_recipe")
              .selectAll()
              .where("id", "=", target.id)
              .executeTakeFirstOrThrow();
            await activateRecipe(trx, fresh);
          } else {
            guardRecipe(() => {
              transitionRecipe(target.status as RecipeStatus, request.body.status as RecipeStatus);
            });
            await trx
              .updateTable("cost_recipe")
              .set({ status: request.body.status })
              .where("id", "=", target.id)
              .execute();
          }
        }
        const row = await trx
          .selectFrom("cost_recipe")
          .selectAll()
          .where("id", "=", target.id)
          .executeTakeFirstOrThrow();
        return presentRecipe(row, await loadComponents(trx, row.id));
      });
    },
  );

  app.post(
    "/cost-recipes/:id/versions",
    {
      schema: {
        tags: [...TENANT, "state-machine"],
        params: z.object({ id: z.string() }),
        body: z.object({}),
        response: { 201: recipeSchema },
      },
    },
    async (request, reply) => {
      const recipe = await inWorkspace(
        ctx,
        request,
        async ({ trx, workspaceId, member, permissions }) => {
          requireManage(permissions);
          if (!isUuidV7(request.params.id)) {
            throw badRequest("Recipe id must be a UUIDv7.");
          }
          const current = await trx
            .selectFrom("cost_recipe")
            .selectAll()
            .where("id", "=", request.params.id)
            .executeTakeFirst();
          if (!current || !isRecipeStatus(current.status)) {
            throw notFound("That recipe was not found.");
          }
          guardRecipe(() => {
            assertCanVersion(current.status as RecipeStatus);
          });
          const openDraft = await trx
            .selectFrom("cost_recipe")
            .select("id")
            .where("family_id", "=", current.family_id)
            .where("status", "=", "draft")
            .executeTakeFirst();
          if (openDraft) {
            throw conflict("A draft of this recipe already exists.");
          }
          const id = createId();
          await trx
            .insertInto("cost_recipe")
            .values({
              id,
              workspace_id: workspaceId,
              family_id: current.family_id,
              name: current.name,
              takeoff_item_id: current.takeoff_item_id,
              input_unit: current.input_unit,
              variables: jsonVariables(variableRecord(current.variables)),
              version: await nextVersion(trx, current.family_id),
              status: "draft",
              created_by: member.id,
            })
            .execute();
          await copyComponents(trx, workspaceId, current.id, id);
          const row = await trx
            .selectFrom("cost_recipe")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirstOrThrow();
          return presentRecipe(row, await loadComponents(trx, id));
        },
      );
      reply.code(201);
      return recipe;
    },
  );

  app.post(
    "/cost-recipes/:id/preview",
    {
      schema: {
        tags: [...TENANT],
        params: z.object({ id: z.string() }),
        body: z.object({
          input_qty: z.union([z.string(), z.number()]),
          input_unit: z.string().trim().min(1).max(40),
          variables: variableMap.optional(),
        }),
        response: {
          200: z.object({
            flagged: z.boolean(),
            total_cost_cents: z.number().int().optional(),
            components: z.array(
              z.object({
                id: z.string(),
                catalog_item_id: z.string(),
                name: z.string(),
                qty: z.string(),
                flags: z.array(z.string()),
                errors: z.array(
                  z.object({
                    message: z.string(),
                    position: z.number().int(),
                    length: z.number().int(),
                  }),
                ),
                unit_cost_cents: z.number().int().optional(),
                cost_cents: z.number().int().optional(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      return inWorkspace(ctx, request, async ({ trx, permissions }) => {
        if (!isUuidV7(request.params.id)) {
          throw badRequest("Recipe id must be a UUIDv7.");
        }
        const recipe = await trx
          .selectFrom("cost_recipe")
          .selectAll()
          .where("id", "=", request.params.id)
          .executeTakeFirst();
        if (!recipe) {
          throw notFound("That recipe was not found.");
        }
        const inputQty = String(request.body.input_qty);
        if (!isDecimalString(inputQty)) {
          throw badRequest("Input quantity must be a decimal.");
        }
        assertMeasureUnit(request.body.input_unit);
        if (!unitsShareKind(request.body.input_unit, recipe.input_unit)) {
          throw conflict(
            `The preview measures ${measureKindOfUnit(request.body.input_unit)} and the recipe measures ${measureKindOfUnit(recipe.input_unit)}.`,
          );
        }
        const overrides = request.body.variables ?? {};
        assertVariables({ ...variableRecord(recipe.variables), ...overrides });
        const variables = { ...variableRecord(recipe.variables), ...overrides };
        const components = await loadComponents(trx, recipe.id);
        const items = await trx
          .selectFrom("catalog_item")
          .select(["id", "name", "unit_cost_cents"])
          .execute();
        const byId = new Map(items.map((item) => [item.id, item]));
        const preview = previewRecipe({
          inputQty,
          inputUnit: request.body.input_unit,
          variables,
          components: components.map((component) => ({
            id: component.id,
            catalogItemId: component.catalog_item_id,
            formula: component.qty_formula,
            unitCostCents: byId.get(component.catalog_item_id)?.unit_cost_cents ?? "0",
          })),
        });
        const manage = hasPermission(permissions, "catalog.manage");
        return {
          flagged: preview.flagged,
          ...(manage ? { total_cost_cents: Number(preview.totalCostCents) } : {}),
          components: preview.components.map((component) => {
            const item = byId.get(component.catalogItemId);
            const visible = {
              id: component.id,
              catalog_item_id: component.catalogItemId,
              name: item?.name ?? "",
              qty: component.qty,
              flags: component.flags,
              errors: component.errors,
              ...(manage
                ? {
                    unit_cost_cents: cents(item?.unit_cost_cents ?? "0"),
                    cost_cents: Number(component.costCents),
                  }
                : {}),
            };
            return visible;
          }),
        };
      });
    },
  );

  app.post(
    "/formula/validate",
    {
      schema: {
        tags: [...TENANT],
        body: z.object({
          formula: z.string().max(2000),
          variables: z.array(z.string()).max(40),
        }),
        response: {
          200: z.object({
            ok: z.boolean(),
            errors: z.array(
              z.object({
                message: z.string(),
                position: z.number().int(),
                length: z.number().int(),
              }),
            ),
            referenced_vars: z.array(z.string()),
          }),
        },
      },
    },
    async (request) => {
      await inWorkspace(ctx, request, async () => undefined);
      const result = validateFormula(request.body.formula, request.body.variables);
      return {
        ok: result.ok,
        errors: result.errors,
        referenced_vars: result.referencedVars,
      };
    },
  );
}

async function nextVersion(trx: Trx, familyId: string): Promise<number> {
  const row = await trx
    .selectFrom("cost_recipe")
    .select((eb) => eb.fn.max("version").as("version"))
    .where("family_id", "=", familyId)
    .executeTakeFirst();
  const current = Number(row?.version ?? 0);
  return Number.isInteger(current) ? current + 1 : 1;
}
