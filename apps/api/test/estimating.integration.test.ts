import { geodesicRectangle } from "@groundwork/geo";
import {
  isMaterialsTaxCode,
  linesFromGroups,
  priceFromCost,
  priceRecipeComponent,
  roundQty,
  type TakeoffGroupSource,
} from "@groundwork/pricing";
import { createId } from "@groundwork/shared";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { Mailer } from "../src/auth/mail.js";
import { readAppDatabaseUrl, readAuthDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";

const PASSWORD = "correct-horse-battery";
const BROWSER = {
  origin: "http://127.0.0.1:5173",
  host: "127.0.0.1:5173",
};
const RATES = { overheadPct: "0.00", markupPct: "0.00", taxRate: "0.0000" };
const RECIPE_VARIABLES = { depth_in: "2", density: "145", waste: "0.05", tack_rate: "0.1" };

type Session = { cookie: string; email: string };
type Line = {
  id: string;
  description: string;
  qty: string;
  price_cents: number;
  tax_cents: number;
  cost_cents?: number;
  catalog_item_id: string | null;
  recipe_component_id: string | null;
  input_qty: string | null;
  tax_code: string | null;
  flagged: boolean;
  optional: boolean;
  updated_at: string;
  variables: Record<string, string>;
};
type EstimateBody = {
  id: string;
  number: string;
  version: number;
  status: string;
  markup_pct: string;
  overhead_pct: string;
  tax_rate: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  optional_subtotal_cents: number;
  optional_tax_cents: number;
  cost_cents?: number;
  margin_cents?: number;
  margin_pct?: string | null;
  lines: Line[];
};
type CatalogItem = { id: string; name: string; unit: string };
type Component = { id: string; catalog_item_id: string; qty_formula: string };

let app: FastifyInstance | undefined;
let admin: pg.Pool | undefined;
let pools: pg.Pool[] = [];
let owner: Session;
let workspaceId: string;
let surfaceId: string;
let recipeId: string;
let asphalt: CatalogItem;
let tack: CatalogItem;
let components: Component[];
let takeoffId: string;
let measurementId: string;
let valueM2: string;

const mailer: Mailer = {
  async send() {
    return undefined;
  },
};

beforeAll(async () => {
  await migrate("up");
  admin = createPool(readDatabaseUrl());
  const appPool = createPool(readAppDatabaseUrl());
  const authPool = createPool(readAuthDatabaseUrl());
  pools = [appPool, authPool];
  app = await buildApp({
    logger: false,
    database: { app: appPool, auth: authPool },
    mailer,
  });
  owner = await signUp("Estimate Owner");
  workspaceId = (await createWorkspace(owner.cookie, "Estimate Co")).id;
  asphalt = await createCatalog("Asphalt", "ton", 9200);
  tack = await createCatalog('Tack, "SS-1"', "gal", 450);
  surfaceId = await createTakeoffItem("Asphalt surface 2in");
  const recipe = await createRecipe();
  recipeId = recipe.id;
  components = recipe.components;
  const job = await createJob();
  takeoffId = await createPlanset(job.id);
  const saved = await putArea(takeoffId, surfaceId);
  measurementId = saved.id;
  valueM2 = saved.valueM2;
});

afterAll(async () => {
  await app?.close();
  await Promise.all(pools.map((pool) => pool.end()));
  await admin?.end();
});

function requireApp(): FastifyInstance {
  if (!app) {
    throw new Error("The API is not running.");
  }
  return app;
}

function requireAdmin(): pg.Pool {
  if (!admin) {
    throw new Error("Admin pool is not connected.");
  }
  return admin;
}

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const parts = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const cookie = parts.map((part) => String(part).split(";")[0]).join("; ");
  if (!cookie) {
    throw new Error("The response did not set a session cookie.");
  }
  return cookie;
}

function headers(cookie: string, workspace = workspaceId, json = true): Record<string, string> {
  return {
    ...BROWSER,
    cookie,
    "x-workspace-id": workspace,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

async function signUp(name: string): Promise<Session> {
  const email = `${createId()}@example.com`;
  const response = await requireApp().inject({
    method: "POST",
    url: "/auth/sign-up/email",
    headers: { ...BROWSER, "content-type": "application/json" },
    payload: { name, email, password: PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: cookieFrom(response), email };
}

async function createWorkspace(cookie: string, name: string): Promise<{ id: string }> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/workspaces",
    headers: { ...BROWSER, cookie, "content-type": "application/json" },
    payload: { name },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}

async function createJob(cookie = owner.cookie, workspace = workspaceId): Promise<{ id: string }> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/jobs",
    headers: headers(cookie, workspace),
    payload: {
      name: "Lot",
      client: { name: "Ada", type: "residential" },
      address: "100 Main St, Morganton, NC 28655",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}

async function createCatalog(
  name: string,
  unit: string,
  unitCostCents: number,
): Promise<CatalogItem> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/catalog-items",
    headers: headers(owner.cookie),
    payload: {
      kind: "material",
      name,
      unit,
      unit_cost_cents: unitCostCents,
      unit_price_cents: unitCostCents,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return { id: response.json().id as string, name, unit };
}

async function createTakeoffItem(name: string): Promise<string> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/takeoff-items",
    headers: headers(owner.cookie),
    payload: { name, measure_kind: "area", default_unit: "yd2" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

async function createRecipe(): Promise<{ id: string; components: Component[] }> {
  const created = await requireApp().inject({
    method: "POST",
    url: "/cost-recipes",
    headers: headers(owner.cookie),
    payload: {
      name: "Asphalt 2in",
      input_unit: "yd2",
      takeoff_item_id: surfaceId,
      variables: RECIPE_VARIABLES,
      components: [
        {
          catalog_item_id: asphalt.id,
          qty_formula: "area_ft2 * (depth_in/12) * density / 2000 * (1+waste)",
        },
        { catalog_item_id: tack.id, qty_formula: "area_yd2 * tack_rate" },
      ],
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const activated = await requireApp().inject({
    method: "PATCH",
    url: `/cost-recipes/${created.json().id}`,
    headers: headers(owner.cookie),
    payload: { status: "active" },
  });
  expect(activated.statusCode, activated.body).toBe(200);
  const body = activated.json() as { id: string; components: Component[] };
  return { id: body.id, components: body.components };
}

async function createPlanset(jobId: string): Promise<string> {
  const response = await requireApp().inject({
    method: "POST",
    url: `/jobs/${jobId}/takeoffs`,
    headers: headers(owner.cookie),
    payload: { kind: "planset" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

async function putArea(id: string, itemId: string): Promise<{ id: string; valueM2: string }> {
  const featureId = createId();
  const response = await requireApp().inject({
    method: "PUT",
    url: `/takeoffs/${id}/measurements`,
    headers: headers(owner.cookie),
    payload: {
      features: [
        {
          id: featureId,
          takeoff_item_id: itemId,
          kind: "area",
          geom: geodesicRectangle({ origin: [-81.7, 35.7], widthM: 12, heightM: 12 }),
        },
      ],
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  const feature = response
    .json()
    .features.find((item: { id: string }) => item.id === featureId) as {
    properties: { value_m2: string };
  };
  return { id: featureId, valueM2: feature.properties.value_m2 };
}

function groupFor(canonicalQty: string, ids: string[]): TakeoffGroupSource {
  const byCatalog = new Map(components.map((component) => [component.catalog_item_id, component]));
  const asphaltComponent = byCatalog.get(asphalt.id);
  const tackComponent = byCatalog.get(tack.id);
  if (!asphaltComponent || !tackComponent) {
    throw new Error("The asphalt recipe did not return both components.");
  }
  return {
    takeoffItemId: surfaceId,
    name: "Asphalt surface 2in",
    defaultUnit: "yd2",
    measureKind: "area",
    canonicalQty,
    measurementIds: ids,
    recipes: [
      {
        id: recipeId,
        version: 1,
        inputUnit: "yd2",
        variables: RECIPE_VARIABLES,
        components: [
          {
            id: asphaltComponent.id,
            catalogItemId: asphalt.id,
            name: asphalt.name,
            unit: asphalt.unit,
            unitCostCents: 9200,
            formula: asphaltComponent.qty_formula,
            taxCode: null,
            kind: "material",
          },
          {
            id: tackComponent.id,
            catalogItemId: tack.id,
            name: tack.name,
            unit: tack.unit,
            unitCostCents: 450,
            formula: tackComponent.qty_formula,
            taxCode: null,
            kind: "material",
          },
        ],
      },
    ],
  };
}

async function createEstimate(id = takeoffId): Promise<EstimateBody> {
  const response = await requireApp().inject({
    method: "POST",
    url: `/jobs/${await jobIdOf(id)}/estimates`,
    headers: headers(owner.cookie),
    payload: { from_takeoff_id: id },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}

async function jobIdOf(id: string): Promise<string> {
  const response = await requireApp().inject({
    method: "GET",
    url: `/takeoffs/${id}`,
    headers: headers(owner.cookie, workspaceId, false),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().job_id as string;
}

async function getEstimate(
  id: string,
  cookie = owner.cookie,
): Promise<{ status: number; body: EstimateBody; raw: string }> {
  const response = await requireApp().inject({
    method: "GET",
    url: `/estimates/${id}`,
    headers: headers(cookie, workspaceId, false),
  });
  return { status: response.statusCode, body: response.json(), raw: response.body };
}

function lineFor(estimate: EstimateBody, catalogId: string): Line {
  const line = estimate.lines.find((item) => item.catalog_item_id === catalogId);
  if (!line) {
    throw new Error(`No line for catalog item ${catalogId}.`);
  }
  return line;
}

function assertNoCosts(value: unknown): void {
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      expect(key).not.toMatch(/cost|margin/i);
      walk(child);
    }
  };
  walk(value);
  expect(JSON.stringify(value)).not.toMatch(/cost|margin/i);
}

describe("estimating", () => {
  it("numbers the first estimate in a workspace E-1001", async () => {
    const person = await signUp("Number Owner");
    const workspace = await createWorkspace(person.cookie, "Number Co");
    const job = await createJob(person.cookie, workspace.id);
    const first = await requireApp().inject({
      method: "POST",
      url: `/jobs/${job.id}/estimates`,
      headers: headers(person.cookie, workspace.id),
      payload: {},
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({
      number: "E-1001",
      version: 1,
      status: "draft",
      lines: [],
    });
    const second = await requireApp().inject({
      method: "POST",
      url: `/jobs/${job.id}/estimates`,
      headers: headers(person.cookie, workspace.id),
      payload: {},
    });
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().number).toBe("E-1002");
  });

  it("prices takeoff lines from the active recipe and reprices from stored cost when rates change", async () => {
    const estimate = await createEstimate();
    const expected = linesFromGroups([groupFor(valueM2, [measurementId])], RATES);
    expect(estimate.lines).toHaveLength(expected.length);
    for (const priced of expected) {
      const line = lineFor(estimate, priced.catalogItemId ?? "");
      expect(roundQty(line.qty)).toBe(priced.storedQty);
      expect(line.cost_cents).toBe(Number(priced.costCents));
      expect(line.price_cents).toBe(Number(priced.priceCents));
      expect(line.tax_cents).toBe(Number(priced.taxCents));
      expect(line.flagged).toBe(false);
      expect(line.tax_code).toBe("materials");
    }
    expect(estimate.subtotal_cents).toBe(
      estimate.lines.reduce((sum, line) => sum + line.price_cents, 0),
    );

    const rated = await requireApp().inject({
      method: "PATCH",
      url: `/estimates/${estimate.id}`,
      headers: headers(owner.cookie),
      payload: { markup_pct: "10", overhead_pct: "10", tax_rate: "0.07" },
    });
    expect(rated.statusCode, rated.body).toBe(200);
    const body = rated.json() as EstimateBody;
    expect(body.markup_pct).toBe("10.00");
    expect(body.overhead_pct).toBe("10.00");
    expect(body.tax_rate).toBe("0.0700");
    let subtotal = 0;
    let tax = 0;
    for (const line of body.lines) {
      const priced = priceFromCost({
        costCents: BigInt(line.cost_cents ?? 0),
        overheadPct: body.overhead_pct,
        markupPct: body.markup_pct,
        taxRate: body.tax_rate,
        taxable: isMaterialsTaxCode(line.tax_code),
      });
      expect(line.price_cents).toBe(Number(priced.priceCents));
      expect(line.tax_cents).toBe(Number(priced.taxCents));
      expect(line.cost_cents).toBe(lineFor(estimate, line.catalog_item_id ?? "").cost_cents);
      subtotal += line.price_cents;
      tax += line.tax_cents;
    }
    expect(body.subtotal_cents).toBe(subtotal);
    expect(body.tax_cents).toBe(tax);
    expect(body.total_cents).toBe(subtotal + tax);

    const optional = await requireApp().inject({
      method: "POST",
      url: `/estimates/${estimate.id}/lines`,
      headers: headers(owner.cookie),
      payload: {
        description: "Seal coat",
        qty: "1",
        unit: "ea",
        price_cents: 5000,
        tax_code: "materials",
        optional: true,
      },
    });
    expect(optional.statusCode, optional.body).toBe(201);
    const withOptional = optional.json() as EstimateBody;
    expect(withOptional.subtotal_cents).toBe(subtotal);
    expect(withOptional.tax_cents).toBe(tax);
    expect(withOptional.optional_subtotal_cents).toBe(5000);
    const optionalTax = priceFromCost({
      costCents: 0n,
      overheadPct: "0",
      markupPct: "0",
      taxRate: body.tax_rate,
      taxable: true,
      priceOverrideCents: 5000n,
    });
    expect(withOptional.optional_tax_cents).toBe(Number(optionalTax.taxCents));
  });

  it("recalculates only the line whose variable changed", async () => {
    const estimate = await createEstimate();
    const asphaltLine = lineFor(estimate, asphalt.id);
    const tackLine = lineFor(estimate, tack.id);
    const component = components.find((item) => item.catalog_item_id === asphalt.id);
    if (!component || !asphaltLine.recipe_component_id || !asphaltLine.input_qty) {
      throw new Error("The asphalt line is missing its pinned recipe input.");
    }
    const patched = await requireApp().inject({
      method: "PATCH",
      url: `/line-items/${asphaltLine.id}`,
      headers: headers(owner.cookie),
      payload: { variables: { depth_in: "3" } },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const after = patched.json() as EstimateBody;
    const nextAsphalt = lineFor(after, asphalt.id);
    const nextTack = lineFor(after, tack.id);
    const expected = priceRecipeComponent({
      formula: component.qty_formula,
      componentId: asphaltLine.recipe_component_id,
      catalogItemId: asphalt.id,
      unitCostCents: 9200,
      inputQty: asphaltLine.input_qty,
      inputUnit: "yd2",
      variables: { ...RECIPE_VARIABLES, depth_in: "3" },
      overheadPct: "0.00",
      markupPct: "0.00",
      taxRate: "0.0000",
      taxable: true,
      priceOverrideCents: null,
    });
    expect(nextAsphalt.cost_cents).toBe(Number(expected.costCents));
    expect(nextAsphalt.price_cents).toBe(Number(expected.priceCents));
    expect(nextAsphalt.variables).toEqual({ depth_in: "3" });
    expect(nextAsphalt.cost_cents).not.toBe(asphaltLine.cost_cents);
    expect(nextTack.updated_at).toBe(tackLine.updated_at);
    expect(nextTack.cost_cents).toBe(tackLine.cost_cents);

    const again = await requireApp().inject({
      method: "POST",
      url: `/estimates/${estimate.id}/recalculate`,
      headers: headers(owner.cookie),
      payload: {},
    });
    expect(again.statusCode, again.body).toBe(200);
    const recalculated = again.json() as EstimateBody;
    expect(lineFor(recalculated, tack.id).updated_at).toBe(tackLine.updated_at);
    expect(lineFor(recalculated, asphalt.id).cost_cents).toBe(nextAsphalt.cost_cents);
  });

  it("keeps a ready snapshot when the recipe and catalog cost change", async () => {
    const estimate = await createEstimate();
    const before = lineFor(estimate, asphalt.id).cost_cents;
    const ready = await requireApp().inject({
      method: "POST",
      url: `/estimates/${estimate.id}/transition`,
      headers: headers(owner.cookie),
      payload: { to: "ready" },
    });
    expect(ready.statusCode, ready.body).toBe(200);
    expect(ready.json().status).toBe("ready");

    const revised = await requireApp().inject({
      method: "PATCH",
      url: `/cost-recipes/${recipeId}`,
      headers: headers(owner.cookie),
      payload: {
        components: [
          { catalog_item_id: asphalt.id, qty_formula: "0" },
          { catalog_item_id: tack.id, qty_formula: "0" },
        ],
      },
    });
    expect(revised.statusCode, revised.body).toBe(200);
    expect(revised.json().id).not.toBe(recipeId);
    expect(revised.json().status).toBe("draft");
    const promoted = await requireApp().inject({
      method: "PATCH",
      url: `/cost-recipes/${revised.json().id}`,
      headers: headers(owner.cookie),
      payload: { status: "active" },
    });
    expect(promoted.statusCode, promoted.body).toBe(200);
    const cost = await requireApp().inject({
      method: "PATCH",
      url: `/catalog-items/${asphalt.id}`,
      headers: headers(owner.cookie),
      payload: { unit_cost_cents: 1 },
    });
    expect(cost.statusCode, cost.body).toBe(200);

    const frozen = await getEstimate(estimate.id);
    expect(frozen.status, frozen.raw).toBe(200);
    expect(lineFor(frozen.body, asphalt.id).cost_cents).toBe(before);
    const snapshot = await requireAdmin().query<{ cost_cents: number }>(
      `select (line->>'cost_cents')::int as cost_cents
       from estimate, jsonb_array_elements(snapshot->'lines') line
       where estimate.id = $1 and line->>'catalog_item_id' = $2`,
      [estimate.id, asphalt.id],
    );
    expect(snapshot.rows[0]?.cost_cents).toBe(before);

    const recalculate = await requireApp().inject({
      method: "POST",
      url: `/estimates/${estimate.id}/recalculate`,
      headers: headers(owner.cookie),
      payload: {},
    });
    expect(recalculate.statusCode).toBe(409);

    const sent = await requireApp().inject({
      method: "POST",
      url: `/estimates/${estimate.id}/transition`,
      headers: headers(owner.cookie),
      payload: { to: "sent" },
    });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(lineFor(sent.json() as EstimateBody, asphalt.id).cost_cents).toBe(before);

    const jobId = await jobIdOf(takeoffId);
    const fresh = await requireApp().inject({
      method: "POST",
      url: `/jobs/${jobId}/estimates`,
      headers: headers(owner.cookie),
      payload: { from_takeoff_id: takeoffId },
    });
    expect(fresh.statusCode, fresh.body).toBe(201);
    expect(lineFor(fresh.json() as EstimateBody, asphalt.id).cost_cents).toBe(0);
    expect(lineFor(fresh.json() as EstimateBody, asphalt.id).cost_cents).not.toBe(before);
  });

  it("hides costs from office and refuses an office write", async () => {
    const person = await signUp("Office Owner");
    const workspace = await createWorkspace(person.cookie, "Office Co");
    const job = await createJob(person.cookie, workspace.id);
    const created = await requireApp().inject({
      method: "POST",
      url: `/jobs/${job.id}/estimates`,
      headers: headers(person.cookie, workspace.id),
      payload: {},
    });
    expect(created.statusCode, created.body).toBe(201);
    const added = await requireApp().inject({
      method: "POST",
      url: `/estimates/${created.json().id}/lines`,
      headers: headers(person.cookie, workspace.id),
      payload: {
        description: "Labor",
        qty: "2",
        unit: "hr",
        unit_cost_cents: 4000,
        price_cents: 9000,
      },
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json().cost_cents).toEqual(expect.any(Number));

    const reader = await signUp("Office Reader");
    const roles = await requireApp().inject({
      method: "GET",
      url: "/roles",
      headers: { ...BROWSER, cookie: person.cookie },
    });
    const roleId = roles.json().roles.find((item: { name: string }) => item.name === "office")?.id;
    const invited = await requireApp().inject({
      method: "POST",
      url: `/workspaces/${workspace.id}/invites`,
      headers: headers(person.cookie, workspace.id),
      payload: { email: reader.email, roleId },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    const accepted = await requireApp().inject({
      method: "POST",
      url: `/invites/${invited.json().id}/accept`,
      headers: { ...BROWSER, cookie: reader.cookie },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);

    const seen = await requireApp().inject({
      method: "GET",
      url: `/estimates/${created.json().id}`,
      headers: headers(reader.cookie, workspace.id, false),
    });
    expect(seen.statusCode, seen.body).toBe(200);
    expect(seen.json().lines[0].price_cents).toBe(9000);
    assertNoCosts(seen.json());

    const write = await requireApp().inject({
      method: "POST",
      url: `/jobs/${job.id}/estimates`,
      headers: headers(reader.cookie, workspace.id),
      payload: {},
    });
    expect(write.statusCode).toBe(403);
  });

  it("returns 409 when a flagged line would become ready", async () => {
    const job = await createJob();
    const bare = await createTakeoffItem("Bare dirt");
    const takeoff = await createPlanset(job.id);
    await putArea(takeoff, bare);
    const estimate = await requireApp().inject({
      method: "POST",
      url: `/jobs/${job.id}/estimates`,
      headers: headers(owner.cookie),
      payload: { from_takeoff_id: takeoff },
    });
    expect(estimate.statusCode, estimate.body).toBe(201);
    const body = estimate.json() as EstimateBody;
    expect(body.lines.some((line) => line.flagged && line.price_cents === 0)).toBe(true);
    const ready = await requireApp().inject({
      method: "POST",
      url: `/estimates/${body.id}/transition`,
      headers: headers(owner.cookie),
      payload: { to: "ready" },
    });
    expect(ready.statusCode).toBe(409);
  });

  it("returns 409 for draft to sent", async () => {
    const job = await createJob();
    const created = await requireApp().inject({
      method: "POST",
      url: `/jobs/${job.id}/estimates`,
      headers: headers(owner.cookie),
      payload: {},
    });
    expect(created.statusCode, created.body).toBe(201);
    const sent = await requireApp().inject({
      method: "POST",
      url: `/estimates/${created.json().id}/transition`,
      headers: headers(owner.cookie),
      payload: { to: "sent" },
    });
    expect(sent.statusCode).toBe(409);
  });

  it("lets an owner add a negative line and rejects a template id", async () => {
    const job = await createJob();
    const created = await requireApp().inject({
      method: "POST",
      url: `/jobs/${job.id}/estimates`,
      headers: headers(owner.cookie),
      payload: {},
    });
    expect(created.statusCode, created.body).toBe(201);
    const discount = await requireApp().inject({
      method: "POST",
      url: `/estimates/${created.json().id}/lines`,
      headers: headers(owner.cookie),
      payload: { description: "Discount", qty: "-1", unit: "ea", unit_cost_cents: 2500 },
    });
    expect(discount.statusCode, discount.body).toBe(201);
    const line = (discount.json() as EstimateBody).lines.find(
      (item) => item.description === "Discount",
    );
    expect(line?.price_cents).toBeLessThan(0);

    const template = await requireApp().inject({
      method: "POST",
      url: `/jobs/${job.id}/estimates`,
      headers: headers(owner.cookie),
      payload: { template_id: createId() },
    });
    expect(template.statusCode).toBe(400);
  });

  it("returns 404 for an estimate in another workspace", async () => {
    const estimate = await createEstimate();
    const outsider = await signUp("Other Owner");
    const other = await createWorkspace(outsider.cookie, "Other Co");
    const hidden = await requireApp().inject({
      method: "GET",
      url: `/estimates/${estimate.id}`,
      headers: headers(outsider.cookie, other.id, false),
    });
    expect(hidden.statusCode).toBe(404);
    const spoofed = await requireApp().inject({
      method: "GET",
      url: `/estimates/${estimate.id}`,
      headers: headers(outsider.cookie, workspaceId, false),
    });
    expect(spoofed.statusCode).toBe(404);
  });

  it("writes audit rows for create, update, transition, and a line without costs", async () => {
    const job = await createJob();
    const created = await requireApp().inject({
      method: "POST",
      url: `/jobs/${job.id}/estimates`,
      headers: headers(owner.cookie),
      payload: {},
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const patched = await requireApp().inject({
      method: "PATCH",
      url: `/estimates/${id}`,
      headers: headers(owner.cookie),
      payload: { notes: "Hold for the owner." },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const line = await requireApp().inject({
      method: "POST",
      url: `/estimates/${id}/lines`,
      headers: headers(owner.cookie),
      payload: { description: "Flagging", qty: "1", unit: "ea", unit_cost_cents: 100 },
    });
    expect(line.statusCode, line.body).toBe(201);
    const ready = await requireApp().inject({
      method: "POST",
      url: `/estimates/${id}/transition`,
      headers: headers(owner.cookie),
      payload: { to: "ready" },
    });
    expect(ready.statusCode, ready.body).toBe(200);

    const rows = await requireAdmin().query<{ action: string; entity_type: string; diff: unknown }>(
      `select action, entity_type, diff
       from audit_log
       where entity_id = $1::uuid
          or diff->>'estimate_id' = $1::text
       order by id`,
      [id],
    );
    const actions = rows.rows.map((row) => `${row.entity_type}:${row.action}`);
    expect(actions).toEqual(
      expect.arrayContaining([
        "estimate:create",
        "estimate:update",
        "line_item:create",
        "estimate:transition",
      ]),
    );
    expect(JSON.stringify(rows.rows.map((row) => row.diff))).not.toMatch(/cost|margin/i);
  });
});
