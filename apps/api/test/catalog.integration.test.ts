import { createId } from "@groundwork/shared";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Mailer } from "../src/auth/mail.js";
import { buildApp } from "../src/app.js";
import { readAppDatabaseUrl, readAuthDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";

const PASSWORD = "correct-horse-battery";
const BROWSER = {
  origin: "http://127.0.0.1:5173",
  host: "127.0.0.1:5173",
};

const mailer: Mailer = {
  async send() {
    return undefined;
  },
};

let app: FastifyInstance | undefined;
let admin: pg.Pool | undefined;

beforeAll(async () => {
  await migrate("up");
  admin = createPool(readDatabaseUrl());
  app = await buildApp({
    logger: false,
    database: {
      app: createPool(readAppDatabaseUrl()),
      auth: createPool(readAuthDatabaseUrl()),
    },
    mailer,
  });
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

function requireApp(): FastifyInstance {
  if (!app) {
    throw new Error("The API is not running.");
  }
  return app;
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

async function signUp(name: string): Promise<{ cookie: string; email: string }> {
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

async function createWorkspace(cookie: string, name: string): Promise<string> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/workspaces",
    headers: { ...BROWSER, cookie, "content-type": "application/json" },
    payload: { name, timezone: "America/New_York", currency: "USD", units_pref: "imperial" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

function headers(cookie: string, workspaceId: string, json = true): Record<string, string> {
  return {
    ...BROWSER,
    cookie,
    "x-workspace-id": workspaceId,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

describe("catalog and cost recipes", () => {
  it("prices a recipe, versions it, and keeps office from seeing cost", async () => {
    const owner = await signUp("Recipe Owner");
    const workspaceId = await createWorkspace(owner.cookie, "Recipe Co");
    const office = await signUp("Recipe Office");
    const roles = await requireApp().inject({
      method: "GET",
      url: "/roles",
      headers: { ...BROWSER, cookie: owner.cookie },
    });
    const officeRole = roles.json().roles.find((role: { name: string }) => role.name === "office");
    const invite = await requireApp().inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/invites`,
      headers: headers(owner.cookie, workspaceId),
      payload: { email: office.email, roleId: officeRole.id },
    });
    expect(invite.statusCode, invite.body).toBe(201);
    const accepted = await requireApp().inject({
      method: "POST",
      url: `/invites/${invite.json().id}/accept`,
      headers: { ...BROWSER, cookie: office.cookie },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);

    const asphalt = await requireApp().inject({
      method: "POST",
      url: "/catalog-items",
      headers: headers(owner.cookie, workspaceId),
      payload: {
        kind: "material",
        name: "Asphalt",
        unit: "ton",
        sku: "ASP",
        unit_cost_cents: 9200,
        unit_price_cents: 18500,
        waste_pct: "5",
      },
    });
    expect(asphalt.statusCode, asphalt.body).toBe(201);
    const tack = await requireApp().inject({
      method: "POST",
      url: "/catalog-items",
      headers: headers(owner.cookie, workspaceId),
      payload: {
        kind: "material",
        name: 'Tack, "SS-1"',
        unit: "gal",
        sku: "TACK",
        unit_cost_cents: 450,
        unit_price_cents: 700,
      },
    });
    expect(tack.statusCode, tack.body).toBe(201);

    const surface = await requireApp().inject({
      method: "POST",
      url: "/takeoff-items",
      headers: headers(owner.cookie, workspaceId),
      payload: {
        name: "Asphalt surface 2in",
        measure_kind: "area",
        default_unit: "yd2",
        category: "paving",
      },
    });
    expect(surface.statusCode, surface.body).toBe(201);

    const mismatched = await requireApp().inject({
      method: "POST",
      url: "/cost-recipes",
      headers: headers(owner.cookie, workspaceId),
      payload: {
        name: "Wrong kind",
        input_unit: "ft",
        takeoff_item_id: surface.json().id,
      },
    });
    expect(mismatched.statusCode, mismatched.body).toBe(409);

    const created = await requireApp().inject({
      method: "POST",
      url: "/cost-recipes",
      headers: headers(owner.cookie, workspaceId),
      payload: {
        name: "Asphalt 2in",
        input_unit: "yd2",
        takeoff_item_id: surface.json().id,
        variables: { depth_in: "2", density: "145", waste: "0.05", tack_rate: "0.1" },
        components: [
          {
            catalog_item_id: asphalt.json().id,
            qty_formula: "area_ft2 * (depth_in/12) * density / 2000 * (1+waste)",
          },
          { catalog_item_id: tack.json().id, qty_formula: "area_yd2 * tack_rate" },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const recipeId = created.json().id as string;

    const illegal = await requireApp().inject({
      method: "PATCH",
      url: `/cost-recipes/${recipeId}`,
      headers: headers(owner.cookie, workspaceId),
      payload: { status: "archived" },
    });
    expect(illegal.statusCode).toBe(409);

    const activated = await requireApp().inject({
      method: "PATCH",
      url: `/cost-recipes/${recipeId}`,
      headers: headers(owner.cookie, workspaceId),
      payload: { status: "active" },
    });
    expect(activated.statusCode, activated.body).toBe(200);
    expect(activated.json().status).toBe("active");

    const edited = await requireApp().inject({
      method: "PATCH",
      url: `/cost-recipes/${recipeId}`,
      headers: headers(owner.cookie, workspaceId),
      payload: { name: "Asphalt 2in revised" },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().status).toBe("draft");
    expect(edited.json().version).toBe(2);
    expect(edited.json().id).not.toBe(recipeId);
    const stillActive = await requireApp().inject({
      method: "GET",
      url: `/cost-recipes/${recipeId}`,
      headers: headers(owner.cookie, workspaceId),
    });
    expect(stillActive.json().status).toBe("active");
    expect(stillActive.json().name).toBe("Asphalt 2in");

    const promoted = await requireApp().inject({
      method: "PATCH",
      url: `/cost-recipes/${edited.json().id}`,
      headers: headers(owner.cookie, workspaceId),
      payload: { status: "active" },
    });
    expect(promoted.statusCode, promoted.body).toBe(200);
    const archived = await requireApp().inject({
      method: "GET",
      url: `/cost-recipes/${recipeId}`,
      headers: headers(owner.cookie, workspaceId),
    });
    expect(archived.json().status).toBe("archived");

    const preview = await requireApp().inject({
      method: "POST",
      url: `/cost-recipes/${edited.json().id}/preview`,
      headers: headers(owner.cookie, workspaceId),
      payload: { input_qty: "180", input_unit: "yd2" },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().flagged).toBe(false);
    expect(preview.json().components[0].qty).toBe("20.55375");
    expect(preview.json().components[0].cost_cents).toBe(189094);
    expect(preview.json().total_cost_cents).toBe(197194);

    const officePreview = await requireApp().inject({
      method: "POST",
      url: `/cost-recipes/${edited.json().id}/preview`,
      headers: headers(office.cookie, workspaceId),
      payload: { input_qty: "180", input_unit: "yd2" },
    });
    expect(officePreview.statusCode, officePreview.body).toBe(200);
    expect(officePreview.json().components[0].qty).toBe("20.55375");
    expect(officePreview.json()).not.toHaveProperty("total_cost_cents");
    expect(JSON.stringify(officePreview.json())).not.toContain("cost_cents");

    const officeWrite = await requireApp().inject({
      method: "POST",
      url: "/catalog-items",
      headers: headers(office.cookie, workspaceId),
      payload: { kind: "fee", name: "Nope", unit: "ea", unit_cost_cents: 1 },
    });
    expect(officeWrite.statusCode).toBe(403);

    const flagged = await requireApp().inject({
      method: "POST",
      url: `/cost-recipes/${edited.json().id}/preview`,
      headers: headers(owner.cookie, workspaceId),
      payload: { input_qty: "1", input_unit: "yd2", variables: { depth_in: "0" } },
    });
    expect(flagged.json().flagged).toBe(false);

    const zero = await requireApp().inject({
      method: "POST",
      url: "/cost-recipes",
      headers: headers(owner.cookie, workspaceId),
      payload: {
        name: "Broken",
        input_unit: "ft2",
        components: [{ catalog_item_id: asphalt.json().id, qty_formula: "1/0" }],
      },
    });
    expect(zero.statusCode, zero.body).toBe(201);
    const zeroPreview = await requireApp().inject({
      method: "POST",
      url: `/cost-recipes/${zero.json().id}/preview`,
      headers: headers(owner.cookie, workspaceId),
      payload: { input_qty: "10", input_unit: "ft2" },
    });
    expect(zeroPreview.json().flagged).toBe(true);
    expect(zeroPreview.json().components[0].cost_cents).toBe(0);
    expect(zeroPreview.json().components[0].flags).toEqual(["division_by_zero"]);

    const unknown = await requireApp().inject({
      method: "POST",
      url: "/formula/validate",
      headers: headers(owner.cookie, workspaceId),
      payload: { formula: "qty + nope", variables: [] },
    });
    expect(unknown.json()).toMatchObject({
      ok: false,
      referenced_vars: ["qty", "nope"],
      errors: [{ position: 6, length: 4 }],
    });

    const removed = await requireApp().inject({
      method: "DELETE",
      url: `/catalog-items/${asphalt.json().id}`,
      headers: headers(owner.cookie, workspaceId, false),
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().archived_at).toEqual(expect.any(String));

    const spare = await requireApp().inject({
      method: "POST",
      url: "/catalog-items",
      headers: headers(owner.cookie, workspaceId),
      payload: { kind: "fee", name: "Unused", unit: "ea", sku: "UNUSED", unit_cost_cents: 1 },
    });
    const deleted = await requireApp().inject({
      method: "DELETE",
      url: `/catalog-items/${spare.json().id}`,
      headers: headers(owner.cookie, workspaceId, false),
    });
    expect(deleted.statusCode).toBe(204);

    const exported = await requireApp().inject({
      method: "GET",
      url: "/catalog-items/export",
      headers: headers(owner.cookie, workspaceId),
    });
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers["content-type"]).toContain("text/csv");
    const previewImport = await requireApp().inject({
      method: "POST",
      url: "/catalog-items/import",
      headers: headers(owner.cookie, workspaceId),
      payload: { csv: exported.body, apply: false },
    });
    expect(previewImport.statusCode, previewImport.body).toBe(200);
    expect(previewImport.json().created).toEqual([]);
    expect(previewImport.json().updated).toEqual([]);
    expect(previewImport.json().errors).toEqual([]);

    const changed = exported.body.replace("450", "460");
    const diff = await requireApp().inject({
      method: "POST",
      url: "/catalog-items/import",
      headers: headers(owner.cookie, workspaceId),
      payload: { csv: changed, apply: true },
    });
    expect(diff.statusCode, diff.body).toBe(200);
    expect(diff.json().updated).toEqual([
      {
        sku: "TACK",
        changes: [{ field: "unit_cost_cents", from: "450", to: "460" }],
      },
    ]);
    const listed = await requireApp().inject({
      method: "GET",
      url: "/catalog-items",
      headers: headers(owner.cookie, workspaceId),
    });
    const tackRow = listed.json().items.find((item: { sku: string }) => item.sku === "TACK");
    expect(tackRow.unit_cost_cents).toBe(460);
  });
});
