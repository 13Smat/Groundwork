import type { MeasureKind } from "@groundwork/geo";
import {
  canonicalUnit,
  convertQuantity,
  extendCents,
  isMaterialsTaxCode,
  linesFromGroups,
  marginPct,
  priceFromCost,
  priceManualLine,
  priceRecipeComponent,
  QuantityRangeError,
  roundQty,
  summarizeLines,
  sumQuantities,
  takeoffQuantityForRecipe,
  unitCentsFromExtended,
  type EstimateRates,
  type EstimateTotals,
  type PricedLine,
  type TakeoffGroupSource,
} from "@groundwork/pricing";
import {
  createId,
  FlaggedEstimateError,
  formatHumanNumber,
  IllegalEstimateTransitionError,
  isEstimateStatus,
  isUuidV7,
  transitionEstimate,
  type EstimateStatus,
} from "@groundwork/shared";
import { sql, type Selectable, type Transaction } from "kysely";

import type { Database } from "../db/types.js";
import { ProblemError } from "../errors.js";
import { assertDiscountAllowed } from "./access.js";

type Trx = Transaction<Database>;
type EstimateRow = Selectable<Database["estimate"]>;
type LineRow = Selectable<Database["line_item"]>;

export type LineView = {
  id: string;
  group: string | null;
  description: string;
  qty: string;
  unit: string;
  unit_price_cents: number;
  price_cents: number;
  tax_cents: number;
  unit_cost_cents: number;
  cost_cents: number;
  margin_cents: number;
  margin_pct: string | null;
  source: "recipe" | "manual";
  recipe_id: string | null;
  recipe_version: number | null;
  recipe_component_id: string | null;
  catalog_item_id: string | null;
  takeoff_item_id: string | null;
  input_qty: string | null;
  input_unit: string | null;
  variables: Record<string, string>;
  markup_pct: string | null;
  overhead_pct: string | null;
  tax_code: string | null;
  flagged: boolean;
  optional: boolean;
  price_overridden: boolean;
  measurement_ids: string[];
  sort: number;
  /** Recipe defaults. Overrides stay on `variables`. Manual lines are empty. */
  recipe_variables: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type EstimateView = {
  id: string;
  job_id: string;
  takeoff_id: string | null;
  number: string;
  version: number;
  status: EstimateStatus;
  markup_pct: string;
  overhead_pct: string;
  tax_rate: string;
  notes: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  optional_subtotal_cents: number;
  optional_tax_cents: number;
  optional_total_cents: number;
  cost_cents: number;
  margin_cents: number;
  margin_pct: string | null;
  lines: LineView[];
  created_at: string;
  updated_at: string;
};

type ComponentRow = {
  id: string;
  recipe_id: string;
  catalog_item_id: string;
  qty_formula: string;
  sort: number;
  name: string;
  unit: string;
  unit_cost_cents: string;
  tax_code: string | null;
  kind: string;
};

type PricedComponentRow = ComponentRow & {
  variables: unknown;
  input_unit: string;
};

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function badRequest(detail: string): ProblemError {
  return new ProblemError({ status: 400, title: "Bad Request", detail });
}

function conflict(detail: string): ProblemError {
  return new ProblemError({ status: 409, title: "Conflict", detail });
}

function notFound(detail: string): ProblemError {
  return new ProblemError({ status: 404, title: "Not Found", detail });
}

type ErrorNode = { message?: unknown; code?: unknown; cause?: unknown };

function errorNodes(error: unknown): ErrorNode[] {
  const nodes: ErrorNode[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    nodes.push(current as ErrorNode);
    current = (current as ErrorNode).cause;
  }
  return nodes;
}

function errorText(error: unknown): string {
  return errorNodes(error)
    .map((node) => (typeof node.message === "string" ? node.message : ""))
    .filter((message) => message !== "")
    .join("\n");
}

function rethrowEstimate(error: unknown): never {
  if (error instanceof ProblemError) {
    throw error;
  }
  if (error instanceof QuantityRangeError) {
    throw badRequest(error.message);
  }
  const text = errorText(error);
  if (text.includes("flagged lines block ready")) {
    throw conflict("A flagged or unresolved line blocks ready.");
  }
  if (text.includes("estimate_workspace_id_number_version")) {
    throw conflict("That estimate version already exists.");
  }
  if (text.includes("illegal estimate transition")) {
    throw conflict("That estimate status change is not allowed.");
  }
  if (
    text.includes("outside draft is frozen") ||
    text.includes("lines on an estimate outside draft") ||
    text.includes("frozen snapshot")
  ) {
    throw conflict("Only a draft estimate can be edited.");
  }
  throw error;
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    rethrowEstimate(error);
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function cents(value: string | number | bigint): number {
  const text = String(value);
  if (!/^-?(?:0|[1-9]\d*)$/.test(text)) {
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

function asVariables(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      out[key] = item;
    } else if (typeof item === "number" && Number.isFinite(item)) {
      out[key] = String(item);
    }
  }
  return out;
}

function asUuidArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value !== "string") {
    return [];
  }
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "{}") {
    return [];
  }
  const body = trimmed.startsWith("{") ? trimmed.slice(1, -1) : trimmed;
  if (body === "") {
    return [];
  }
  return body.split(",").map((part) => part.trim().replaceAll('"', ""));
}

function uuidArray(ids: readonly string[]) {
  if (ids.length === 0) {
    return sql`'{}'::uuid[]`;
  }
  return sql`array[${sql.join(ids.map((id) => sql`${id}::uuid`))}]::uuid[]`;
}

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

function parsePercent(value: string | number, label: string): string {
  const text = String(value).trim();
  if (!/^-?(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/.test(text)) {
    throw badRequest(
      `${label} must be a percent from -100 to 9999.99 with at most two decimal places.`,
    );
  }
  const negative = text.startsWith("-");
  const [whole, frac = ""] = text.slice(negative ? 1 : 0).split(".");
  const padded = `${negative ? "-" : ""}${whole}.${frac.padEnd(2, "0")}`;
  const numeric = Number(padded);
  if (numeric < -100 || numeric > 9999.99) {
    throw badRequest(
      `${label} must be a percent from -100 to 9999.99 with at most two decimal places.`,
    );
  }
  return padded;
}

function parseTax(value: string | number): string {
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(text)) {
    throw badRequest("Tax rate must be a fraction from 0 to 1 with at most four decimal places.");
  }
  const [whole, frac = ""] = text.split(".");
  const padded = `${whole}.${frac.padEnd(4, "0")}`;
  if (Number(padded) > 1) {
    throw badRequest("Tax rate must be a fraction from 0 to 1 with at most four decimal places.");
  }
  return padded;
}

function assertVariables(variables: Record<string, string>): void {
  const keys = Object.keys(variables);
  if (keys.length > 40) {
    throw badRequest("A line can override at most 40 variables.");
  }
  for (const key of keys) {
    if (!IDENT.test(key) || key.length > 40) {
      throw badRequest(`Variable ${key} is not a name.`);
    }
    const raw = variables[key];
    if (raw === undefined || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
      throw badRequest(`${key} must be a decimal.`);
    }
  }
}

function measureKind(value: string): MeasureKind {
  if (value === "area" || value === "length" || value === "count") {
    return value;
  }
  throw new ProblemError({
    status: 500,
    title: "Internal Server Error",
    detail: "A takeoff item has an unknown measure kind.",
  });
}

function sourceOf(value: string): "recipe" | "manual" {
  if (value === "recipe" || value === "manual") {
    return value;
  }
  throw new ProblemError({
    status: 500,
    title: "Internal Server Error",
    detail: "A line has an unknown source.",
  });
}

function ratesOf(
  row: Pick<EstimateRow, "overhead_pct" | "markup_pct" | "tax_rate">,
): EstimateRates {
  return {
    overheadPct: String(row.overhead_pct),
    markupPct: String(row.markup_pct),
    taxRate: String(row.tax_rate),
  };
}

function lineOverhead(line: Pick<LineRow, "overhead_pct">, rates: EstimateRates): string {
  return line.overhead_pct === null ? rates.overheadPct : String(line.overhead_pct);
}

function lineMarkup(line: Pick<LineRow, "markup_pct">, rates: EstimateRates): string {
  return line.markup_pct === null ? rates.markupPct : String(line.markup_pct);
}

function sameQty(left: string, right: string): boolean {
  try {
    return roundQty(left) === roundQty(right);
  } catch {
    return left === right;
  }
}

function blocked(line: Pick<LineRow, "flagged" | "source" | "recipe_id">): boolean {
  return line.flagged || (line.source === "recipe" && line.recipe_id === null);
}

async function audit(
  trx: Trx,
  input: {
    workspaceId: string;
    actorId: string;
    entityType: "estimate" | "line_item";
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

async function loadEstimate(trx: Trx, id: string): Promise<EstimateRow | undefined> {
  return trx.selectFrom("estimate").selectAll().where("id", "=", id).executeTakeFirst();
}

async function loadLines(trx: Trx, estimateId: string): Promise<LineRow[]> {
  return trx
    .selectFrom("line_item")
    .selectAll()
    .where("estimate_id", "=", estimateId)
    .orderBy("sort")
    .orderBy("id")
    .execute();
}

function requireDraft(status: string): void {
  if (status !== "draft") {
    throw conflict("Only a draft estimate can be edited.");
  }
}

function viewLine(row: LineRow, recipeVariables: Record<string, string>): LineView {
  const price = BigInt(row.price_cents);
  const cost = BigInt(row.cost_cents);
  return {
    id: row.id,
    group: row.grp,
    description: row.description,
    qty: String(row.qty),
    unit: row.unit,
    unit_price_cents: cents(row.unit_price_cents),
    price_cents: cents(price),
    tax_cents: cents(row.tax_cents),
    unit_cost_cents: cents(row.unit_cost_cents),
    cost_cents: cents(cost),
    margin_cents: cents(price - cost),
    margin_pct: marginPct(price, cost),
    source: sourceOf(row.source),
    recipe_id: row.recipe_id,
    recipe_version: row.recipe_version,
    recipe_component_id: row.recipe_component_id,
    catalog_item_id: row.catalog_item_id,
    takeoff_item_id: row.takeoff_item_id,
    input_qty: row.input_qty,
    input_unit: row.input_unit,
    variables: asVariables(row.variables),
    markup_pct: row.markup_pct === null ? null : String(row.markup_pct),
    overhead_pct: row.overhead_pct === null ? null : String(row.overhead_pct),
    tax_code: row.tax_code,
    flagged: row.flagged,
    optional: row.optional,
    price_overridden: row.price_overridden,
    measurement_ids: asUuidArray(row.measurement_ids),
    sort: row.sort,
    recipe_variables: recipeVariables,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function viewEstimate(
  row: EstimateRow,
  lines: LineRow[],
  recipes: ReadonlyMap<string, Record<string, string>>,
): EstimateView {
  if (!isEstimateStatus(row.status)) {
    throw new ProblemError({
      status: 500,
      title: "Internal Server Error",
      detail: "An estimate has an unknown status.",
    });
  }
  const totals = summarizeLines(
    lines.map((line) => ({
      priceCents: BigInt(line.price_cents),
      taxCents: BigInt(line.tax_cents),
      costCents: BigInt(line.cost_cents),
      optional: line.optional,
    })),
  );
  return {
    id: row.id,
    job_id: row.job_id,
    takeoff_id: row.takeoff_id,
    number: row.number,
    version: row.version,
    status: row.status,
    markup_pct: String(row.markup_pct),
    overhead_pct: String(row.overhead_pct),
    tax_rate: String(row.tax_rate),
    notes: row.notes,
    subtotal_cents: cents(totals.subtotalCents),
    tax_cents: cents(totals.taxCents),
    total_cents: cents(totals.totalCents),
    optional_subtotal_cents: cents(totals.optionalSubtotalCents),
    optional_tax_cents: cents(totals.optionalTaxCents),
    optional_total_cents: cents(totals.optionalTotalCents),
    cost_cents: cents(totals.costCents),
    margin_cents: cents(totals.marginCents),
    margin_pct: totals.marginPct,
    lines: lines.map((line) => viewLine(line, recipeDefaults(recipes, line.recipe_id))),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function parseSnapshot(value: unknown): EstimateView {
  const body = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!body || typeof body !== "object" || !("lines" in body) || !Array.isArray(body.lines)) {
    throw new ProblemError({
      status: 500,
      title: "Internal Server Error",
      detail: "The estimate snapshot is unreadable.",
    });
  }
  return body as EstimateView;
}

async function recipeVariableMap(
  trx: Trx,
  lines: readonly LineRow[],
): Promise<Map<string, Record<string, string>>> {
  const ids = [...new Set(lines.flatMap((line) => (line.recipe_id ? [line.recipe_id] : [])))];
  const map = new Map<string, Record<string, string>>();
  if (ids.length === 0) {
    return map;
  }
  const rows = await trx
    .selectFrom("cost_recipe")
    .select(["id", "variables"])
    .where("id", "in", ids)
    .execute();
  for (const row of rows) {
    map.set(row.id, asVariables(row.variables));
  }
  return map;
}

function recipeDefaults(
  recipes: ReadonlyMap<string, Record<string, string>>,
  recipeId: string | null,
): Record<string, string> {
  if (!recipeId) {
    return {};
  }
  return recipes.get(recipeId) ?? {};
}

async function fullView(trx: Trx, id: string): Promise<EstimateView> {
  const row = await loadEstimate(trx, id);
  if (!row) {
    throw notFound("That estimate was not found.");
  }
  const lines = await loadLines(trx, id);
  return viewEstimate(row, lines, await recipeVariableMap(trx, lines));
}

async function writeTotals(trx: Trx, id: string, totals: EstimateTotals): Promise<void> {
  await trx
    .updateTable("estimate")
    .set({
      subtotal_cents: totals.subtotalCents.toString(),
      tax_cents: totals.taxCents.toString(),
      total_cents: totals.totalCents.toString(),
      optional_subtotal_cents: totals.optionalSubtotalCents.toString(),
      optional_tax_cents: totals.optionalTaxCents.toString(),
      optional_total_cents: totals.optionalTotalCents.toString(),
    })
    .where("id", "=", id)
    .execute();
}

async function persistTotals(trx: Trx, id: string): Promise<void> {
  const lines = await loadLines(trx, id);
  const totals = summarizeLines(
    lines.map((line) => ({
      priceCents: BigInt(line.price_cents),
      taxCents: BigInt(line.tax_cents),
      costCents: BigInt(line.cost_cents),
      optional: line.optional,
    })),
  );
  await writeTotals(trx, id, totals);
}

async function allocateEstimateNumber(
  trx: Trx,
  workspaceId: string,
  memberId: string,
): Promise<string> {
  const result = await sql<{ last_value: string }>`
    insert into counters (id, workspace_id, prefix, last_value, created_by)
    values (${createId()}::uuid, ${workspaceId}::uuid, 'E', 1001, ${memberId}::uuid)
    on conflict (workspace_id, prefix)
    do update set last_value = counters.last_value + 1, updated_at = now()
    returning last_value::text as last_value
  `.execute(trx);
  const sequence = Number(result.rows[0]?.last_value);
  if (!Number.isSafeInteger(sequence)) {
    throw new Error("Estimate counter did not return a sequence.");
  }
  return formatHumanNumber("E", sequence);
}

async function generateLines(
  trx: Trx,
  takeoffId: string,
  rates: EstimateRates,
): Promise<PricedLine[]> {
  const measurements = await trx
    .selectFrom("measurement")
    .select(["id", "takeoff_item_id", "kind", "value_m2", "value_m", "count"])
    .where("takeoff_id", "=", takeoffId)
    .execute();
  if (measurements.length === 0) {
    return [];
  }
  const itemIds = [...new Set(measurements.map((row) => row.takeoff_item_id))];
  const items = await trx
    .selectFrom("takeoff_item")
    .selectAll()
    .where("id", "in", itemIds)
    .execute();
  const recipes = await trx
    .selectFrom("cost_recipe")
    .selectAll()
    .where("takeoff_item_id", "in", itemIds)
    .where("status", "=", "active")
    .orderBy("name")
    .orderBy("id")
    .execute();
  const recipeIds = recipes.map((recipe) => recipe.id);
  const components =
    recipeIds.length === 0
      ? []
      : (
          await sql<ComponentRow>`
            select
              rc.id,
              rc.recipe_id,
              rc.catalog_item_id,
              rc.qty_formula,
              rc.sort,
              ci.name,
              ci.unit,
              ci.unit_cost_cents::text as unit_cost_cents,
              ci.tax_code,
              ci.kind
            from recipe_component rc
            join catalog_item ci on ci.id = rc.catalog_item_id
            where rc.recipe_id = any(${recipeIds}::uuid[])
            order by rc.sort, rc.id
          `.execute(trx)
        ).rows;
  const groups: TakeoffGroupSource[] = items
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    .map((item) => {
      const kind = measureKind(item.measure_kind);
      const mine = measurements.filter(
        (row) => row.takeoff_item_id === item.id && row.kind === kind,
      );
      const canonicalQty = sumQuantities(
        mine.map((row) => {
          if (kind === "area") {
            return row.value_m2 ?? "0";
          }
          if (kind === "length") {
            return row.value_m ?? "0";
          }
          return String(row.count ?? 0);
        }),
      );
      return {
        takeoffItemId: item.id,
        name: item.name,
        defaultUnit: item.default_unit,
        measureKind: kind,
        canonicalQty,
        measurementIds: mine.map((row) => row.id),
        recipes: recipes
          .filter((recipe) => recipe.takeoff_item_id === item.id)
          .map((recipe) => ({
            id: recipe.id,
            version: recipe.version,
            inputUnit: recipe.input_unit,
            variables: asVariables(recipe.variables),
            components: components
              .filter((component) => component.recipe_id === recipe.id)
              .map((component) => ({
                id: component.id,
                catalogItemId: component.catalog_item_id,
                name: component.name,
                unit: component.unit,
                unitCostCents: component.unit_cost_cents,
                formula: component.qty_formula,
                taxCode: component.tax_code,
                kind: component.kind,
              })),
          })),
      };
    });
  return linesFromGroups(groups, rates);
}

async function insertPricedLines(
  trx: Trx,
  workspaceId: string,
  estimateId: string,
  lines: readonly PricedLine[],
  sortStart = 0,
): Promise<void> {
  let sort = sortStart;
  for (const line of lines) {
    await trx
      .insertInto("line_item")
      .values({
        id: createId(),
        workspace_id: workspaceId,
        estimate_id: estimateId,
        grp: line.group,
        description: line.description,
        qty: line.storedQty,
        unit: line.unit,
        unit_cost_cents: line.unitCostCents.toString(),
        unit_price_cents: line.unitPriceCents.toString(),
        cost_cents: line.costCents.toString(),
        price_cents: line.priceCents.toString(),
        tax_cents: line.taxCents.toString(),
        source: line.source,
        recipe_id: line.recipeId,
        recipe_version: line.recipeVersion,
        recipe_component_id: line.recipeComponentId,
        catalog_item_id: line.catalogItemId,
        takeoff_item_id: line.takeoffItemId,
        input_qty: line.inputQty,
        input_unit: line.inputUnit,
        variables: jsonb(line.variables),
        markup_pct: line.markupPct,
        overhead_pct: line.overheadPct,
        tax_code: line.taxCode,
        flagged: line.flagged,
        optional: line.optional,
        price_overridden: line.priceOverridden,
        measurement_ids: uuidArray(line.measurementIds),
        sort,
      })
      .execute();
    sort += 1;
  }
}

type LineMoney = {
  qty: string;
  unit_cost_cents: string;
  unit_price_cents: string;
  cost_cents: string;
  price_cents: string;
  tax_cents: string;
  flagged: boolean;
};

function moneyFromRates(line: LineRow, rates: EstimateRates): LineMoney {
  const overhead = lineOverhead(line, rates);
  const markup = lineMarkup(line, rates);
  const taxable = isMaterialsTaxCode(line.tax_code);
  const cost = BigInt(line.cost_cents);
  if (line.flagged && !line.price_overridden) {
    return {
      qty: String(line.qty),
      unit_cost_cents: line.unit_cost_cents,
      unit_price_cents: "0",
      cost_cents: line.cost_cents,
      price_cents: "0",
      tax_cents: "0",
      flagged: true,
    };
  }
  const priced = priceFromCost({
    costCents: cost,
    overheadPct: overhead,
    markupPct: markup,
    taxRate: rates.taxRate,
    taxable,
    priceOverrideCents: line.price_overridden ? BigInt(line.price_cents) : null,
  });
  return {
    qty: String(line.qty),
    unit_cost_cents: line.unit_cost_cents,
    unit_price_cents: line.price_overridden
      ? line.unit_price_cents
      : unitPrice(String(line.qty), priced.priceCents),
    cost_cents: line.cost_cents,
    price_cents: priced.priceCents.toString(),
    tax_cents: priced.taxCents.toString(),
    flagged: line.flagged,
  };
}

function unitPrice(qty: string, price: bigint): string {
  try {
    const quantity = roundQty(qty);
    if (quantity === "0.0000" || quantity === "-0.0000") {
      return "0";
    }
    return unitCentsFromExtended(quantity, price).toString();
  } catch {
    return "0";
  }
}

function moneyChanged(line: LineRow, next: LineMoney): boolean {
  return (
    !sameQty(String(line.qty), next.qty) ||
    line.unit_cost_cents !== next.unit_cost_cents ||
    line.unit_price_cents !== next.unit_price_cents ||
    line.cost_cents !== next.cost_cents ||
    line.price_cents !== next.price_cents ||
    line.tax_cents !== next.tax_cents ||
    line.flagged !== next.flagged
  );
}

async function applyMoney(trx: Trx, line: LineRow, next: LineMoney): Promise<boolean> {
  if (!moneyChanged(line, next)) {
    return false;
  }
  await trx
    .updateTable("line_item")
    .set({
      qty: roundQty(next.qty),
      unit_cost_cents: next.unit_cost_cents,
      unit_price_cents: next.unit_price_cents,
      cost_cents: next.cost_cents,
      price_cents: next.price_cents,
      tax_cents: next.tax_cents,
      flagged: next.flagged,
    })
    .where("id", "=", line.id)
    .execute();
  return true;
}

async function loadComponent(
  trx: Trx,
  componentId: string,
): Promise<PricedComponentRow | undefined> {
  const result = await sql<PricedComponentRow>`
    select
      rc.id,
      rc.recipe_id,
      rc.catalog_item_id,
      rc.qty_formula,
      rc.sort,
      ci.name,
      ci.unit,
      ci.unit_cost_cents::text as unit_cost_cents,
      ci.tax_code,
      ci.kind,
      cr.variables,
      cr.input_unit
    from recipe_component rc
    join catalog_item ci on ci.id = rc.catalog_item_id
    join cost_recipe cr on cr.id = rc.recipe_id
    where rc.id = ${componentId}::uuid
  `.execute(trx);
  return result.rows[0];
}

async function moneyFromFormula(trx: Trx, line: LineRow, rates: EstimateRates): Promise<LineMoney> {
  if (line.source !== "recipe" || line.recipe_component_id === null) {
    if (line.source === "manual") {
      const priced = priceManualLine({
        qty: String(line.qty),
        unitCostCents: BigInt(line.unit_cost_cents),
        unitPriceCents: line.price_overridden ? BigInt(line.unit_price_cents) : null,
        explicitPriceCents: null,
        overheadPct: lineOverhead(line, rates),
        markupPct: lineMarkup(line, rates),
        taxRate: rates.taxRate,
        taxable: isMaterialsTaxCode(line.tax_code),
      });
      return {
        qty: priced.storedQty,
        unit_cost_cents: priced.unitCostCents.toString(),
        unit_price_cents: priced.unitPriceCents.toString(),
        cost_cents: priced.costCents.toString(),
        price_cents: priced.priceCents.toString(),
        tax_cents: priced.taxCents.toString(),
        flagged: false,
      };
    }
    return moneyFromRates(line, rates);
  }
  const component = await loadComponent(trx, line.recipe_component_id);
  if (!component || line.input_qty === null) {
    return {
      qty: String(line.qty),
      unit_cost_cents: line.unit_cost_cents,
      unit_price_cents: "0",
      cost_cents: "0",
      price_cents: "0",
      tax_cents: "0",
      flagged: true,
    };
  }
  const taxCode = line.tax_code;
  const priced = priceRecipeComponent({
    formula: component.qty_formula,
    componentId: component.id,
    catalogItemId: component.catalog_item_id,
    unitCostCents: component.unit_cost_cents,
    inputQty: line.input_qty,
    inputUnit: line.input_unit ?? component.input_unit,
    variables: { ...asVariables(component.variables), ...asVariables(line.variables) },
    overheadPct: lineOverhead(line, rates),
    markupPct: lineMarkup(line, rates),
    taxRate: rates.taxRate,
    taxable: isMaterialsTaxCode(taxCode),
    priceOverrideCents: line.price_overridden ? BigInt(line.price_cents) : null,
  });
  return {
    qty: priced.storedQty,
    unit_cost_cents: priced.unitCostCents.toString(),
    unit_price_cents: priced.unitPriceCents.toString(),
    cost_cents: priced.costCents.toString(),
    price_cents: priced.priceCents.toString(),
    tax_cents: priced.taxCents.toString(),
    flagged: priced.flagged,
  };
}

async function repriceAll(
  trx: Trx,
  estimateId: string,
  rates: EstimateRates,
  formula: boolean,
): Promise<void> {
  const lines = await loadLines(trx, estimateId);
  for (const line of lines) {
    const next = formula ? await moneyFromFormula(trx, line, rates) : moneyFromRates(line, rates);
    await applyMoney(trx, line, next);
  }
  await persistTotals(trx, estimateId);
}

export async function createEstimate(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    jobId: string;
    fromTakeoffId?: string | undefined;
  },
): Promise<EstimateView> {
  return run(async () => {
    const job = await trx
      .selectFrom("job")
      .select("id")
      .where("id", "=", input.jobId)
      .executeTakeFirst();
    if (!job) {
      throw notFound("That job was not found.");
    }
    let takeoffId: string | null = null;
    if (input.fromTakeoffId) {
      if (!isUuidV7(input.fromTakeoffId)) {
        throw badRequest("Takeoff id must be a UUIDv7.");
      }
      const takeoff = await trx
        .selectFrom("takeoff")
        .select(["id", "job_id"])
        .where("id", "=", input.fromTakeoffId)
        .executeTakeFirst();
      if (!takeoff) {
        throw notFound("That takeoff was not found.");
      }
      if (takeoff.job_id !== job.id) {
        throw conflict("That takeoff belongs to another job.");
      }
      takeoffId = takeoff.id;
    }
    const id = createId();
    const number = await allocateEstimateNumber(trx, input.workspaceId, input.memberId);
    const rates: EstimateRates = { overheadPct: "0.00", markupPct: "0.00", taxRate: "0.0000" };
    await trx
      .insertInto("estimate")
      .values({
        id,
        workspace_id: input.workspaceId,
        job_id: job.id,
        takeoff_id: takeoffId,
        number,
        version: 1,
        status: "draft",
        markup_pct: rates.markupPct,
        overhead_pct: rates.overheadPct,
        tax_rate: rates.taxRate,
        subtotal_cents: "0",
        tax_cents: "0",
        total_cents: "0",
        optional_subtotal_cents: "0",
        optional_tax_cents: "0",
        optional_total_cents: "0",
        snapshot: null,
        notes: null,
        created_by: input.memberId,
      })
      .execute();
    if (takeoffId) {
      await insertPricedLines(
        trx,
        input.workspaceId,
        id,
        await generateLines(trx, takeoffId, rates),
      );
      await persistTotals(trx, id);
    }
    const view = await fullView(trx, id);
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "estimate",
      entityId: id,
      action: "create",
      diff: {
        number: view.number,
        job_id: view.job_id,
        takeoff_id: view.takeoff_id,
        line_count: view.lines.length,
        total_cents: view.total_cents,
      },
    });
    return view;
  });
}

export async function getEstimate(trx: Trx, id: string): Promise<EstimateView> {
  const row = await loadEstimate(trx, id);
  if (!row) {
    throw notFound("That estimate was not found.");
  }
  if (row.status !== "draft" && row.snapshot) {
    const frozen = parseSnapshot(row.snapshot);
    return {
      ...frozen,
      status: isEstimateStatus(row.status) ? row.status : frozen.status,
      updated_at: iso(row.updated_at),
    };
  }
  const lines = await loadLines(trx, id);
  return viewEstimate(row, lines, await recipeVariableMap(trx, lines));
}

export async function patchEstimate(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    estimateId: string;
    markupPct?: string | number | undefined;
    overheadPct?: string | number | undefined;
    taxRate?: string | number | undefined;
    notes?: string | null | undefined;
  },
): Promise<EstimateView> {
  return run(async () => {
    const row = await loadEstimate(trx, input.estimateId);
    if (!row) {
      throw notFound("That estimate was not found.");
    }
    requireDraft(row.status);
    const markup =
      input.markupPct === undefined
        ? String(row.markup_pct)
        : parsePercent(input.markupPct, "Markup");
    const overhead =
      input.overheadPct === undefined
        ? String(row.overhead_pct)
        : parsePercent(input.overheadPct, "Overhead");
    const tax = input.taxRate === undefined ? String(row.tax_rate) : parseTax(input.taxRate);
    const notes = input.notes === undefined ? row.notes : cleanNotes(input.notes);
    const ratesChanged =
      markup !== String(row.markup_pct) ||
      overhead !== String(row.overhead_pct) ||
      tax !== String(row.tax_rate);
    await trx
      .updateTable("estimate")
      .set({ markup_pct: markup, overhead_pct: overhead, tax_rate: tax, notes })
      .where("id", "=", row.id)
      .execute();
    if (ratesChanged) {
      await repriceAll(
        trx,
        row.id,
        { overheadPct: overhead, markupPct: markup, taxRate: tax },
        false,
      );
    }
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "estimate",
      entityId: row.id,
      action: "update",
      diff: { markup_pct: markup, overhead_pct: overhead, tax_rate: tax, notes },
    });
    return fullView(trx, row.id);
  });
}

function cleanNotes(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length > 8000) {
    throw badRequest("Notes must be 8000 characters or fewer.");
  }
  return trimmed === "" ? null : trimmed;
}

async function nextSort(trx: Trx, estimateId: string): Promise<number> {
  const row = await sql<{ sort: number }>`
    select coalesce(max(sort), -1)::int as sort from line_item where estimate_id = ${estimateId}::uuid
  `.execute(trx);
  return (row.rows[0]?.sort ?? -1) + 1;
}

export async function addManualLine(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    permissions: readonly string[];
    estimateId: string;
    group: string | null;
    description: string;
    qty: string;
    unit: string;
    unitCostCents: bigint;
    unitPriceCents: bigint | null;
    explicitPriceCents: bigint | null;
    markupPct: string | null;
    overheadPct: string | null;
    taxCode: string | null;
    optional: boolean;
  },
): Promise<EstimateView> {
  return run(async () => {
    const estimate = await loadEstimate(trx, input.estimateId);
    if (!estimate) {
      throw notFound("That estimate was not found.");
    }
    requireDraft(estimate.status);
    const count = await sql<{ n: number }>`
      select count(*)::int as n from line_item where estimate_id = ${estimate.id}::uuid
    `.execute(trx);
    if ((count.rows[0]?.n ?? 0) >= 500) {
      throw badRequest("An estimate can have at most 500 lines.");
    }
    const rates = ratesOf(estimate);
    const priced = priceManualLine({
      qty: input.qty,
      unitCostCents: input.unitCostCents,
      unitPriceCents: input.unitPriceCents,
      explicitPriceCents: input.explicitPriceCents,
      overheadPct: input.overheadPct ?? rates.overheadPct,
      markupPct: input.markupPct ?? rates.markupPct,
      taxRate: rates.taxRate,
      taxable: isMaterialsTaxCode(input.taxCode),
    });
    assertDiscountAllowed(input.permissions, {
      qty: priced.storedQty,
      unitCostCents: priced.unitCostCents,
      unitPriceCents: priced.unitPriceCents,
      priceCents: priced.priceCents,
    });
    const id = createId();
    await trx
      .insertInto("line_item")
      .values({
        id,
        workspace_id: input.workspaceId,
        estimate_id: estimate.id,
        grp: input.group,
        description: input.description,
        qty: priced.storedQty,
        unit: input.unit,
        unit_cost_cents: priced.unitCostCents.toString(),
        unit_price_cents: priced.unitPriceCents.toString(),
        cost_cents: priced.costCents.toString(),
        price_cents: priced.priceCents.toString(),
        tax_cents: priced.taxCents.toString(),
        source: "manual",
        recipe_id: null,
        recipe_version: null,
        recipe_component_id: null,
        catalog_item_id: null,
        takeoff_item_id: null,
        input_qty: null,
        input_unit: null,
        variables: jsonb({}),
        markup_pct: input.markupPct,
        overhead_pct: input.overheadPct,
        tax_code: input.taxCode,
        flagged: false,
        optional: input.optional,
        price_overridden: priced.priceOverridden,
        measurement_ids: uuidArray([]),
        sort: await nextSort(trx, estimate.id),
      })
      .execute();
    await persistTotals(trx, estimate.id);
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "line_item",
      entityId: id,
      action: "create",
      diff: {
        estimate_id: estimate.id,
        description: input.description,
        price_cents: cents(priced.priceCents),
        optional: input.optional,
      },
    });
    return fullView(trx, estimate.id);
  });
}

export type LinePatch = {
  group?: string | null;
  description?: string;
  qty?: string;
  unit?: string;
  unitCostCents?: bigint;
  unitPriceCents?: bigint;
  explicitPriceCents?: bigint;
  clearPriceOverride?: boolean;
  variables?: Record<string, string>;
  markupPct?: string | null;
  overheadPct?: string | null;
  taxCode?: string | null;
  optional?: boolean;
};

export async function patchLine(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    permissions: readonly string[];
    lineId: string;
    patch: LinePatch;
  },
): Promise<EstimateView> {
  return run(async () => {
    const line = await trx
      .selectFrom("line_item")
      .selectAll()
      .where("id", "=", input.lineId)
      .executeTakeFirst();
    if (!line) {
      throw notFound("That line was not found.");
    }
    const estimate = await loadEstimate(trx, line.estimate_id);
    if (!estimate) {
      throw notFound("That estimate was not found.");
    }
    requireDraft(estimate.status);
    if (line.source === "recipe" && input.patch.qty !== undefined) {
      throw badRequest("Recipe line quantity comes from the formula. Override a variable instead.");
    }
    if (input.patch.variables) {
      assertVariables(input.patch.variables);
    }
    const rates = ratesOf(estimate);
    const variables = input.patch.variables ?? asVariables(line.variables);
    const markupPct =
      input.patch.markupPct === undefined
        ? line.markup_pct === null
          ? null
          : String(line.markup_pct)
        : input.patch.markupPct === null
          ? null
          : parsePercent(input.patch.markupPct, "Markup");
    const overheadPct =
      input.patch.overheadPct === undefined
        ? line.overhead_pct === null
          ? null
          : String(line.overhead_pct)
        : input.patch.overheadPct === null
          ? null
          : parsePercent(input.patch.overheadPct, "Overhead");
    const taxCode = input.patch.taxCode === undefined ? line.tax_code : input.patch.taxCode;
    let priceOverridden = line.price_overridden;
    if (input.patch.clearPriceOverride) {
      priceOverridden = false;
    }
    if (input.patch.unitPriceCents !== undefined || input.patch.explicitPriceCents !== undefined) {
      priceOverridden = true;
    }
    const draft: LineRow = {
      ...line,
      grp: input.patch.group === undefined ? line.grp : input.patch.group,
      description: input.patch.description ?? line.description,
      qty: input.patch.qty ?? String(line.qty),
      unit: input.patch.unit ?? line.unit,
      unit_cost_cents:
        input.patch.unitCostCents === undefined
          ? line.unit_cost_cents
          : input.patch.unitCostCents.toString(),
      unit_price_cents:
        input.patch.unitPriceCents === undefined
          ? line.unit_price_cents
          : input.patch.unitPriceCents.toString(),
      price_cents:
        input.patch.explicitPriceCents === undefined
          ? line.price_cents
          : input.patch.explicitPriceCents.toString(),
      variables,
      markup_pct: markupPct,
      overhead_pct: overheadPct,
      tax_code: taxCode,
      optional: input.patch.optional ?? line.optional,
      price_overridden: priceOverridden,
    };
    const formula =
      line.source === "recipe" &&
      (input.patch.variables !== undefined || input.patch.clearPriceOverride === true);
    const next = formula
      ? await moneyFromFormula(trx, draft, rates)
      : pricePatchedLine(draft, rates, input.patch);
    assertDiscountAllowed(input.permissions, {
      qty: next.qty,
      unitCostCents: BigInt(next.unit_cost_cents),
      unitPriceCents: BigInt(next.unit_price_cents),
      priceCents: BigInt(next.price_cents),
    });
    await trx
      .updateTable("line_item")
      .set({
        grp: draft.grp,
        description: draft.description,
        qty: roundQty(next.qty),
        unit: draft.unit,
        unit_cost_cents: next.unit_cost_cents,
        unit_price_cents: next.unit_price_cents,
        cost_cents: next.cost_cents,
        price_cents: next.price_cents,
        tax_cents: next.tax_cents,
        variables: jsonb(variables),
        markup_pct: markupPct,
        overhead_pct: overheadPct,
        tax_code: taxCode,
        optional: draft.optional,
        price_overridden: input.patch.clearPriceOverride ? false : priceOverridden,
        flagged: next.flagged,
      })
      .where("id", "=", line.id)
      .execute();
    await persistTotals(trx, estimate.id);
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "line_item",
      entityId: line.id,
      action: "update",
      diff: {
        estimate_id: estimate.id,
        price_cents: cents(next.price_cents),
        variables: input.patch.variables ?? null,
      },
    });
    return fullView(trx, estimate.id);
  });
}

function pricePatchedLine(line: LineRow, rates: EstimateRates, patch: LinePatch): LineMoney {
  const explicit = patch.explicitPriceCents !== undefined || patch.unitPriceCents !== undefined;
  if (line.source === "recipe" && explicit && !patch.clearPriceOverride) {
    const price =
      patch.explicitPriceCents ??
      extendCents(roundQty(String(line.qty)), patch.unitPriceCents ?? 0n);
    const tax = priceFromCost({
      costCents: BigInt(line.cost_cents),
      overheadPct: lineOverhead(line, rates),
      markupPct: lineMarkup(line, rates),
      taxRate: rates.taxRate,
      taxable: isMaterialsTaxCode(line.tax_code),
      priceOverrideCents: price,
    });
    return {
      qty: String(line.qty),
      unit_cost_cents: line.unit_cost_cents,
      unit_price_cents:
        patch.unitPriceCents === undefined
          ? unitPrice(String(line.qty), price)
          : patch.unitPriceCents.toString(),
      cost_cents: line.cost_cents,
      price_cents: tax.priceCents.toString(),
      tax_cents: tax.taxCents.toString(),
      flagged: false,
    };
  }
  if (
    line.source === "manual" ||
    patch.qty !== undefined ||
    patch.unitCostCents !== undefined ||
    explicit ||
    patch.clearPriceOverride
  ) {
    const priced = priceManualLine({
      qty: String(line.qty),
      unitCostCents: BigInt(line.unit_cost_cents),
      unitPriceCents:
        line.price_overridden && patch.explicitPriceCents === undefined
          ? BigInt(line.unit_price_cents)
          : null,
      explicitPriceCents: patch.explicitPriceCents ?? null,
      overheadPct: lineOverhead(line, rates),
      markupPct: lineMarkup(line, rates),
      taxRate: rates.taxRate,
      taxable: isMaterialsTaxCode(line.tax_code),
    });
    return {
      qty: priced.storedQty,
      unit_cost_cents: priced.unitCostCents.toString(),
      unit_price_cents: priced.unitPriceCents.toString(),
      cost_cents: priced.costCents.toString(),
      price_cents: priced.priceCents.toString(),
      tax_cents: priced.taxCents.toString(),
      flagged:
        patch.explicitPriceCents !== undefined || patch.unitPriceCents !== undefined
          ? false
          : line.flagged,
    };
  }
  return moneyFromRates(line, rates);
}

export async function deleteLine(
  trx: Trx,
  input: { workspaceId: string; memberId: string; lineId: string },
): Promise<void> {
  await run(async () => {
    const line = await trx
      .selectFrom("line_item")
      .selectAll()
      .where("id", "=", input.lineId)
      .executeTakeFirst();
    if (!line) {
      throw notFound("That line was not found.");
    }
    const estimate = await loadEstimate(trx, line.estimate_id);
    if (!estimate) {
      throw notFound("That estimate was not found.");
    }
    requireDraft(estimate.status);
    await trx.deleteFrom("line_item").where("id", "=", line.id).execute();
    await persistTotals(trx, estimate.id);
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "line_item",
      entityId: line.id,
      action: "delete",
      diff: { estimate_id: estimate.id, description: line.description },
    });
  });
}

export async function recalculateEstimate(
  trx: Trx,
  input: { workspaceId: string; memberId: string; estimateId: string },
): Promise<EstimateView> {
  return run(async () => {
    const estimate = await loadEstimate(trx, input.estimateId);
    if (!estimate) {
      throw notFound("That estimate was not found.");
    }
    requireDraft(estimate.status);
    await repriceAll(trx, estimate.id, ratesOf(estimate), true);
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "estimate",
      entityId: estimate.id,
      action: "recalculate",
      diff: { total_cents: (await fullView(trx, estimate.id)).total_cents },
    });
    return fullView(trx, estimate.id);
  });
}

export async function transitionEstimateStatus(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    estimateId: string;
    to: EstimateStatus;
  },
): Promise<EstimateView> {
  return run(async () => {
    const estimate = await loadEstimate(trx, input.estimateId);
    if (!estimate || !isEstimateStatus(estimate.status)) {
      throw notFound("That estimate was not found.");
    }
    const lines = await loadLines(trx, estimate.id);
    const flaggedLineCount = lines.filter((line) => blocked(line)).length;
    let result;
    try {
      result = transitionEstimate({
        from: estimate.status,
        to: input.to,
        flaggedLineCount,
      });
    } catch (error) {
      if (
        error instanceof FlaggedEstimateError ||
        error instanceof IllegalEstimateTransitionError
      ) {
        throw conflict(error.message);
      }
      throw error;
    }
    if (result.freezeSnapshot) {
      const frozen = viewEstimate(estimate, lines, await recipeVariableMap(trx, lines));
      frozen.status = result.status;
      await trx
        .updateTable("estimate")
        .set({ status: result.status, snapshot: jsonb(frozen) })
        .where("id", "=", estimate.id)
        .execute();
    } else if (result.clearSnapshot) {
      await trx
        .updateTable("estimate")
        .set({ status: "draft", snapshot: null })
        .where("id", "=", estimate.id)
        .execute();
    } else {
      await trx
        .updateTable("estimate")
        .set({ status: result.status })
        .where("id", "=", estimate.id)
        .execute();
    }
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "estimate",
      entityId: estimate.id,
      action: "transition",
      diff: { from: estimate.status, to: result.status },
    });
    return getEstimate(trx, estimate.id);
  });
}

export type QuantityChange = {
  change: "added" | "removed" | "changed";
  takeoff_item_id: string;
  name: string;
  unit: string;
  old_qty: string | null;
  new_qty: string | null;
};

export type QuantityDiff = {
  estimate_id: string;
  takeoff_id: string | null;
  compared_takeoff_id: string | null;
  compared_takeoff_version: number | null;
  items: QuantityChange[];
};

export type EstimateSummary = {
  id: string;
  job_id: string;
  takeoff_id: string | null;
  number: string;
  version: number;
  status: EstimateStatus;
  total_cents: number;
  updated_at: string;
};

type TakeoffQty = {
  id: string;
  name: string;
  measureKind: MeasureKind;
  canonicalQty: string;
  qty: string;
  unit: string;
  measurementIds: string[];
};

type StoredQty = {
  id: string;
  name: string;
  qty: string;
  unit: string;
};

function draftOnly(status: string): void {
  if (status !== "draft") {
    throw conflict("Quantity sync is available on a draft. Clone a new version first.");
  }
}

function inUnit(qty: string, from: string, to: string): string | undefined {
  try {
    return convertQuantity(qty, from, to);
  } catch {
    return undefined;
  }
}

function qtyChanged(left: string, right: string): boolean {
  try {
    return roundQty(left) !== roundQty(right);
  } catch {
    return left !== right;
  }
}

async function comparedTakeoff(
  trx: Trx,
  takeoffId: string | null,
): Promise<{ id: string; version: number } | undefined> {
  if (!takeoffId) {
    return undefined;
  }
  const row = await trx
    .selectFrom("takeoff")
    .select(["lineage_id"])
    .where("id", "=", takeoffId)
    .executeTakeFirst();
  if (!row) {
    return undefined;
  }
  return trx
    .selectFrom("takeoff")
    .select(["id", "version"])
    .where("lineage_id", "=", row.lineage_id)
    .orderBy("version", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
}

async function loadCurrentItems(trx: Trx, takeoffId: string): Promise<TakeoffQty[]> {
  const measurements = await trx
    .selectFrom("measurement")
    .select(["id", "takeoff_item_id", "kind", "value_m2", "value_m", "count"])
    .where("takeoff_id", "=", takeoffId)
    .execute();
  if (measurements.length === 0) {
    return [];
  }
  const itemIds = [...new Set(measurements.map((row) => row.takeoff_item_id))];
  const items = await trx
    .selectFrom("takeoff_item")
    .selectAll()
    .where("id", "in", itemIds)
    .execute();
  const quantities: TakeoffQty[] = [];
  for (const item of items) {
    const kind = measureKind(item.measure_kind);
    const mine = measurements.filter((row) => row.takeoff_item_id === item.id && row.kind === kind);
    if (mine.length === 0) {
      continue;
    }
    const canonicalQty = sumQuantities(
      mine.map((row) => {
        if (kind === "area") {
          return row.value_m2 ?? "0";
        }
        if (kind === "length") {
          return row.value_m ?? "0";
        }
        return String(row.count ?? 0);
      }),
    );
    let qty = canonicalQty;
    let unit = canonicalUnit(kind);
    try {
      qty = takeoffQuantityForRecipe(kind, canonicalQty, item.default_unit);
      unit = item.default_unit;
    } catch {
      // The item's display unit is not a measure unit. Keep metres or count.
    }
    quantities.push({
      id: item.id,
      name: item.name,
      measureKind: kind,
      canonicalQty,
      qty,
      unit,
      measurementIds: mine.map((row) => row.id),
    });
  }
  return quantities;
}

async function storedQuantities(
  trx: Trx,
  lines: readonly LineRow[],
): Promise<Map<string, StoredQty>> {
  const ids = [
    ...new Set(lines.flatMap((line) => (line.takeoff_item_id ? [line.takeoff_item_id] : []))),
  ];
  const map = new Map<string, StoredQty>();
  if (ids.length === 0) {
    return map;
  }
  const items = await trx
    .selectFrom("takeoff_item")
    .select(["id", "name", "default_unit"])
    .where("id", "in", ids)
    .execute();
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const id of ids) {
    const group = lines.filter((line) => line.takeoff_item_id === id);
    const source = group.find((line) => line.input_qty !== null) ?? group[0];
    const item = byId.get(id);
    if (!source) {
      continue;
    }
    const name = item?.name ?? source.grp ?? "Takeoff item";
    const fromQty = source.input_qty ?? String(source.qty);
    const fromUnit = source.input_unit ?? source.unit;
    const preferred = item?.default_unit;
    if (preferred) {
      const converted = inUnit(fromQty, fromUnit, preferred);
      if (converted !== undefined) {
        map.set(id, { id, name, qty: converted, unit: preferred });
        continue;
      }
    }
    map.set(id, { id, name, qty: fromQty, unit: fromUnit });
  }
  return map;
}

async function buildQuantityDiff(trx: Trx, estimate: EstimateRow): Promise<QuantityDiff> {
  const lines = await loadLines(trx, estimate.id);
  const compared = await comparedTakeoff(trx, estimate.takeoff_id);
  const current = compared ? await loadCurrentItems(trx, compared.id) : [];
  const stored = await storedQuantities(trx, lines);
  const currentById = new Map(current.map((item) => [item.id, item]));
  const ids = new Set([...stored.keys(), ...currentById.keys()]);
  const items: QuantityChange[] = [];
  for (const id of ids) {
    const oldItem = stored.get(id);
    const next = currentById.get(id);
    if (oldItem && next) {
      const converted = inUnit(oldItem.qty, oldItem.unit, next.unit);
      const oldQty = converted ?? oldItem.qty;
      const unit = converted === undefined ? oldItem.unit : next.unit;
      const newQty =
        converted === undefined
          ? (inUnit(next.qty, next.unit, oldItem.unit) ?? next.qty)
          : next.qty;
      if (!qtyChanged(oldQty, newQty)) {
        continue;
      }
      items.push({
        change: "changed",
        takeoff_item_id: id,
        name: next.name,
        unit,
        old_qty: oldQty,
        new_qty: newQty,
      });
    } else if (next) {
      items.push({
        change: "added",
        takeoff_item_id: id,
        name: next.name,
        unit: next.unit,
        old_qty: null,
        new_qty: next.qty,
      });
    } else if (oldItem) {
      items.push({
        change: "removed",
        takeoff_item_id: id,
        name: oldItem.name,
        unit: oldItem.unit,
        old_qty: oldItem.qty,
        new_qty: null,
      });
    }
  }
  const rank = { added: 0, changed: 1, removed: 2 } as const;
  items.sort(
    (left, right) =>
      rank[left.change] - rank[right.change] ||
      left.name.localeCompare(right.name) ||
      left.takeoff_item_id.localeCompare(right.takeoff_item_id),
  );
  return {
    estimate_id: estimate.id,
    takeoff_id: estimate.takeoff_id,
    compared_takeoff_id: compared?.id ?? null,
    compared_takeoff_version: compared?.version ?? null,
    items,
  };
}

async function syncChangedLine(
  trx: Trx,
  line: LineRow,
  item: TakeoffQty,
  rates: EstimateRates,
): Promise<void> {
  let inputQty = item.canonicalQty;
  let inputUnit = line.input_unit;
  let convertible = true;
  if (line.input_unit) {
    try {
      inputQty = takeoffQuantityForRecipe(item.measureKind, item.canonicalQty, line.input_unit);
    } catch {
      convertible = false;
      inputUnit = null;
    }
  } else {
    try {
      inputQty = takeoffQuantityForRecipe(item.measureKind, item.canonicalQty, line.unit);
    } catch {
      inputQty = item.canonicalQty;
    }
  }
  const measurementIds = uuidArray(item.measurementIds);
  if (!convertible || line.recipe_component_id === null) {
    await trx
      .updateTable("line_item")
      .set({
        qty: roundQty(inputQty),
        input_qty: inputQty,
        input_unit: inputUnit,
        measurement_ids: measurementIds,
        flagged: true,
        unit_price_cents: "0",
        cost_cents: "0",
        price_cents: "0",
        tax_cents: "0",
      })
      .where("id", "=", line.id)
      .execute();
    return;
  }
  const next = await moneyFromFormula(
    trx,
    { ...line, input_qty: inputQty, input_unit: inputUnit },
    rates,
  );
  await trx
    .updateTable("line_item")
    .set({
      qty: roundQty(next.qty),
      unit_cost_cents: next.unit_cost_cents,
      unit_price_cents: next.unit_price_cents,
      cost_cents: next.cost_cents,
      price_cents: next.price_cents,
      tax_cents: next.tax_cents,
      input_qty: inputQty,
      input_unit: inputUnit,
      measurement_ids: measurementIds,
      flagged: next.flagged,
    })
    .where("id", "=", line.id)
    .execute();
}

export async function quantityDiff(trx: Trx, estimateId: string): Promise<QuantityDiff> {
  return run(async () => {
    const estimate = await loadEstimate(trx, estimateId);
    if (!estimate) {
      throw notFound("That estimate was not found.");
    }
    draftOnly(estimate.status);
    return buildQuantityDiff(trx, estimate);
  });
}

export async function applyQuantities(
  trx: Trx,
  input: {
    workspaceId: string;
    memberId: string;
    estimateId: string;
    takeoffItemIds?: readonly string[] | undefined;
  },
): Promise<EstimateView> {
  return run(async () => {
    const estimate = await loadEstimate(trx, input.estimateId);
    if (!estimate) {
      throw notFound("That estimate was not found.");
    }
    draftOnly(estimate.status);
    const diff = await buildQuantityDiff(trx, estimate);
    const wanted = input.takeoffItemIds;
    if (wanted) {
      const known = new Set(diff.items.map((item) => item.takeoff_item_id));
      for (const id of wanted) {
        if (!known.has(id)) {
          throw badRequest("That takeoff item is not in the quantity diff.");
        }
      }
    }
    const selected = wanted
      ? diff.items.filter((item) => wanted.includes(item.takeoff_item_id))
      : diff.items;
    if (selected.length === 0) {
      return fullView(trx, estimate.id);
    }
    const current = diff.compared_takeoff_id
      ? await loadCurrentItems(trx, diff.compared_takeoff_id)
      : [];
    const byId = new Map(current.map((item) => [item.id, item]));
    const rates = ratesOf(estimate);
    const lines = await loadLines(trx, estimate.id);
    for (const change of selected) {
      if (change.change !== "removed") {
        continue;
      }
      await trx
        .deleteFrom("line_item")
        .where("estimate_id", "=", estimate.id)
        .where("takeoff_item_id", "=", change.takeoff_item_id)
        .execute();
    }
    for (const change of selected) {
      if (change.change !== "changed") {
        continue;
      }
      const item = byId.get(change.takeoff_item_id);
      if (!item) {
        throw conflict("That takeoff item changed before the sync was applied.");
      }
      for (const line of lines) {
        if (line.takeoff_item_id !== item.id) {
          continue;
        }
        await syncChangedLine(trx, line, item, rates);
      }
    }
    const added = selected.filter((change) => change.change === "added");
    if (added.length > 0) {
      if (!diff.compared_takeoff_id) {
        throw conflict("That takeoff item changed before the sync was applied.");
      }
      const ids = new Set(added.map((change) => change.takeoff_item_id));
      const generated = (await generateLines(trx, diff.compared_takeoff_id, rates)).filter(
        (line) => line.takeoffItemId !== null && ids.has(line.takeoffItemId),
      );
      await insertPricedLines(
        trx,
        input.workspaceId,
        estimate.id,
        generated,
        await nextSort(trx, estimate.id),
      );
    }
    if (diff.compared_takeoff_id && diff.compared_takeoff_id !== estimate.takeoff_id) {
      await trx
        .updateTable("estimate")
        .set({ takeoff_id: diff.compared_takeoff_id })
        .where("id", "=", estimate.id)
        .execute();
    }
    await persistTotals(trx, estimate.id);
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "estimate",
      entityId: estimate.id,
      action: "apply_quantities",
      diff: {
        compared_takeoff_id: diff.compared_takeoff_id,
        items: selected.map((item) => ({
          change: item.change,
          takeoff_item_id: item.takeoff_item_id,
          unit: item.unit,
          old_qty: item.old_qty,
          new_qty: item.new_qty,
        })),
      },
    });
    return fullView(trx, estimate.id);
  });
}

export async function cloneEstimateVersion(
  trx: Trx,
  input: { workspaceId: string; memberId: string; estimateId: string },
): Promise<EstimateView> {
  return run(async () => {
    const estimate = await loadEstimate(trx, input.estimateId);
    if (!estimate || !isEstimateStatus(estimate.status)) {
      throw notFound("That estimate was not found.");
    }
    const locked = await sql<{ version: number }>`
      select version from estimate
      where workspace_id = ${input.workspaceId}::uuid and number = ${estimate.number}
      for update
    `.execute(trx);
    const version = locked.rows.reduce((max, row) => Math.max(max, Number(row.version)), 0) + 1;
    const id = createId();
    await trx
      .insertInto("estimate")
      .values({
        id,
        workspace_id: input.workspaceId,
        job_id: estimate.job_id,
        takeoff_id: estimate.takeoff_id,
        number: estimate.number,
        version,
        status: "draft",
        markup_pct: String(estimate.markup_pct),
        overhead_pct: String(estimate.overhead_pct),
        tax_rate: String(estimate.tax_rate),
        subtotal_cents: "0",
        tax_cents: "0",
        total_cents: "0",
        optional_subtotal_cents: "0",
        optional_tax_cents: "0",
        optional_total_cents: "0",
        snapshot: null,
        notes: estimate.notes,
        created_by: input.memberId,
      })
      .execute();
    const lines = await loadLines(trx, estimate.id);
    for (const line of lines) {
      await trx
        .insertInto("line_item")
        .values({
          id: createId(),
          workspace_id: input.workspaceId,
          estimate_id: id,
          grp: line.grp,
          description: line.description,
          qty: String(line.qty),
          unit: line.unit,
          unit_cost_cents: line.unit_cost_cents,
          unit_price_cents: line.unit_price_cents,
          cost_cents: line.cost_cents,
          price_cents: line.price_cents,
          tax_cents: line.tax_cents,
          source: sourceOf(line.source),
          recipe_id: line.recipe_id,
          recipe_version: line.recipe_version,
          recipe_component_id: line.recipe_component_id,
          catalog_item_id: line.catalog_item_id,
          takeoff_item_id: line.takeoff_item_id,
          input_qty: line.input_qty,
          input_unit: line.input_unit,
          variables: jsonb(asVariables(line.variables)),
          markup_pct: line.markup_pct === null ? null : String(line.markup_pct),
          overhead_pct: line.overhead_pct === null ? null : String(line.overhead_pct),
          tax_code: line.tax_code,
          flagged: line.flagged,
          optional: line.optional,
          price_overridden: line.price_overridden,
          measurement_ids: uuidArray(asUuidArray(line.measurement_ids)),
          sort: line.sort,
        })
        .execute();
    }
    await persistTotals(trx, id);
    const supersede = estimate.status === "ready" || estimate.status === "sent";
    if (supersede) {
      await transitionEstimateStatus(trx, {
        workspaceId: input.workspaceId,
        memberId: input.memberId,
        estimateId: estimate.id,
        to: "superseded",
      });
    }
    const view = await fullView(trx, id);
    await audit(trx, {
      workspaceId: input.workspaceId,
      actorId: input.memberId,
      entityType: "estimate",
      entityId: id,
      action: "version",
      diff: {
        from_estimate_id: estimate.id,
        number: estimate.number,
        version,
        superseded: supersede,
      },
    });
    return view;
  });
}

export async function listJobEstimates(
  trx: Trx,
  jobId: string,
): Promise<{ estimates: EstimateSummary[] }> {
  const job = await trx.selectFrom("job").select("id").where("id", "=", jobId).executeTakeFirst();
  if (!job) {
    throw notFound("That job was not found.");
  }
  const rows = await trx
    .selectFrom("estimate")
    .selectAll()
    .where("job_id", "=", jobId)
    .orderBy("created_at", "desc")
    .orderBy("version", "desc")
    .execute();
  return {
    estimates: rows.map((row) => {
      if (!isEstimateStatus(row.status)) {
        throw new ProblemError({
          status: 500,
          title: "Internal Server Error",
          detail: "An estimate has an unknown status.",
        });
      }
      return {
        id: row.id,
        job_id: row.job_id,
        takeoff_id: row.takeoff_id,
        number: row.number,
        version: row.version,
        status: row.status,
        total_cents: cents(row.total_cents),
        updated_at: iso(row.updated_at),
      };
    }),
  };
}
