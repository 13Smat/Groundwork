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

type Session = { cookie: string; email: string };

let app: FastifyInstance | undefined;
let admin: pg.Pool | undefined;
let pools: pg.Pool[] = [];

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

function headers(cookie: string, workspaceId: string, json = true): Record<string, string> {
  return {
    ...BROWSER,
    cookie,
    "x-workspace-id": workspaceId,
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

async function createWorkspace(cookie: string, name: string): Promise<string> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/workspaces",
    headers: { ...BROWSER, cookie, "content-type": "application/json" },
    payload: { name },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

async function readyEstimate(
  cookie: string,
  workspaceId: string,
): Promise<{ id: string; jobId: string; lineId: string }> {
  const job = await requireApp().inject({
    method: "POST",
    url: "/jobs",
    headers: headers(cookie, workspaceId),
    payload: {
      name: "Driveway",
      client: { name: "Ada", type: "residential" },
      address: "100 Main St, Morganton, NC 28655",
    },
  });
  expect(job.statusCode, job.body).toBe(201);
  const created = await requireApp().inject({
    method: "POST",
    url: `/jobs/${job.json().id}/estimates`,
    headers: headers(cookie, workspaceId),
    payload: {},
  });
  expect(created.statusCode, created.body).toBe(201);
  const added = await requireApp().inject({
    method: "POST",
    url: `/estimates/${created.json().id}/lines`,
    headers: headers(cookie, workspaceId),
    payload: {
      group: "Asphalt",
      description: "Surface course",
      qty: "2",
      unit: "sy",
      unit_cost_cents: 123456,
      unit_price_cents: 5000,
      optional: true,
    },
  });
  expect(added.statusCode, added.body).toBe(201);
  const required = await requireApp().inject({
    method: "POST",
    url: `/estimates/${created.json().id}/lines`,
    headers: headers(cookie, workspaceId),
    payload: {
      description: "Base",
      qty: "1",
      unit: "sy",
      unit_cost_cents: 100,
      unit_price_cents: 5000,
    },
  });
  expect(required.statusCode, required.body).toBe(201);
  const ready = await requireApp().inject({
    method: "POST",
    url: `/estimates/${created.json().id}/transition`,
    headers: headers(cookie, workspaceId),
    payload: { to: "ready" },
  });
  expect(ready.statusCode, ready.body).toBe(200);
  const optional = (ready.json().lines as { id: string; optional: boolean }[]).find(
    (line) => line.optional,
  );
  if (!optional) {
    throw new Error("The ready estimate has no optional line.");
  }
  return { id: created.json().id as string, jobId: job.json().id as string, lineId: optional.id };
}

describe("proposals", () => {
  it("pins a ready estimate as P-1001 and hides the raw token and costs", async () => {
    const owner = await signUp("Proposal Owner");
    const workspaceId = await createWorkspace(owner.cookie, "Proposal Co");
    const estimate = await readyEstimate(owner.cookie, workspaceId);
    const draft = await requireApp().inject({
      method: "POST",
      url: "/jobs",
      headers: headers(owner.cookie, workspaceId),
      payload: { name: "Other", client: { name: "Bea", type: "residential" } },
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const draftEstimate = await requireApp().inject({
      method: "POST",
      url: `/jobs/${draft.json().id}/estimates`,
      headers: headers(owner.cookie, workspaceId),
      payload: {},
    });
    expect(draftEstimate.statusCode, draftEstimate.body).toBe(201);
    const tooSoon = await requireApp().inject({
      method: "POST",
      url: `/estimates/${draftEstimate.json().id}/proposals`,
      headers: headers(owner.cookie, workspaceId),
      payload: {},
    });
    expect(tooSoon.statusCode, tooSoon.body).toBe(409);

    const template = await requireApp().inject({
      method: "POST",
      url: "/proposal-templates",
      headers: headers(owner.cookie, workspaceId),
      payload: { name: "Standard", intro: "Hello", terms: "Net 15" },
    });
    expect(template.statusCode, template.body).toBe(201);
    const created = await requireApp().inject({
      method: "POST",
      url: `/estimates/${estimate.id}/proposals`,
      headers: headers(owner.cookie, workspaceId),
      payload: { template_id: template.json().id },
    });
    expect(created.statusCode, created.body).toBe(201);
    const body = created.json();
    expect(body.number).toBe("P-1001");
    expect(body.status).toBe("draft");
    expect(body.intro).toBe("Hello");
    expect(body.estimate_version).toBe(1);
    expect(body).not.toHaveProperty("public_token");
    expect(body).not.toHaveProperty("public_token_hash");
    expect(JSON.stringify(body)).not.toContain("123456");
    expect(JSON.stringify(body)).not.toContain("unit_cost");
    expect(JSON.stringify(body)).not.toContain("margin");
    expect(body.lines.find((line: { optional: boolean }) => line.optional).unit_price_cents).toBe(
      5000,
    );

    const stored = await requireAdmin().query<{
      public_token_hash: string;
      snapshot: { lines: { unit_cost_cents?: number }[] };
    }>("select public_token_hash, snapshot from proposal where id = $1", [body.id]);
    expect(stored.rows[0]?.public_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(body)).not.toContain(stored.rows[0]?.public_token_hash);
    expect(JSON.stringify(stored.rows[0]?.snapshot)).toContain("123456");

    const audit = await requireAdmin().query<{ diff: unknown }>(
      "select diff from audit_log where entity_id = $1 and action = 'create'",
      [body.id],
    );
    expect(JSON.stringify(audit.rows[0]?.diff)).not.toContain(
      stored.rows[0]?.public_token_hash ?? "missing",
    );
    expect(JSON.stringify(audit.rows[0]?.diff)).not.toContain("public_token");

    const patched = await requireApp().inject({
      method: "PATCH",
      url: `/proposals/${body.id}`,
      headers: headers(owner.cookie, workspaceId),
      payload: {
        intro: "Updated intro",
        scope_note: "Measured areas only",
        terms: "Net 30",
        selected_optional_line_ids: [estimate.lineId],
      },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().intro).toBe("Updated intro");
    expect(patched.json().selected_optional_line_ids).toEqual([estimate.lineId]);
    expect(patched.json().total_cents).toBeGreaterThan(body.total_cents);

    const back = await requireApp().inject({
      method: "POST",
      url: `/estimates/${estimate.id}/transition`,
      headers: headers(owner.cookie, workspaceId),
      payload: { to: "draft" },
    });
    expect(back.statusCode, back.body).toBe(409);
    expect(back.json().detail).toMatch(/Clone a new version/);

    const version = await requireApp().inject({
      method: "POST",
      url: `/estimates/${estimate.id}/versions`,
      headers: headers(owner.cookie, workspaceId),
      payload: {},
    });
    expect(version.statusCode, version.body).toBe(201);
    expect(version.json().version).toBe(2);
    expect(version.json().status).toBe("draft");

    const other = await signUp("Other Owner");
    const otherWorkspace = await createWorkspace(other.cookie, "Other Co");
    const hidden = await requireApp().inject({
      method: "GET",
      url: `/proposals/${body.id}`,
      headers: headers(other.cookie, otherWorkspace, false),
    });
    expect(hidden.statusCode, hidden.body).toBe(404);

    const reader = await signUp("Office Reader");
    const roles = await requireApp().inject({
      method: "GET",
      url: "/roles",
      headers: { ...BROWSER, cookie: owner.cookie },
    });
    const roleId = roles.json().roles.find((item: { name: string }) => item.name === "office")?.id;
    const invited = await requireApp().inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/invites`,
      headers: headers(owner.cookie, workspaceId),
      payload: { email: reader.email, roleId },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    const accepted = await requireApp().inject({
      method: "POST",
      url: `/invites/${invited.json().id}/accept`,
      headers: { ...BROWSER, cookie: reader.cookie },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const office = await requireApp().inject({
      method: "GET",
      url: `/proposals/${body.id}`,
      headers: headers(reader.cookie, workspaceId, false),
    });
    expect(office.statusCode, office.body).toBe(200);
    expect(JSON.stringify(office.json())).not.toContain("123456");
    expect(JSON.stringify(office.json())).not.toContain("unit_cost");
    expect(JSON.stringify(office.json())).not.toContain("margin");
    const denied = await requireApp().inject({
      method: "POST",
      url: "/proposal-templates",
      headers: headers(reader.cookie, workspaceId),
      payload: { name: "Office template" },
    });
    expect(denied.statusCode).toBe(403);
  });
});
