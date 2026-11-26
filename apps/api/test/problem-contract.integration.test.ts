import { PROBLEM_JSON_CONTENT_TYPE, createId } from "@groundwork/shared";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Mailer } from "../src/auth/mail.js";
import { buildApp } from "../src/app.js";
import { readAppDatabaseUrl, readAuthDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { readOpenApi } from "../src/openapi/document.js";

const PASSWORD = "correct-horse-battery";
const BROWSER = { origin: "http://127.0.0.1:5173", host: "127.0.0.1:5173" };
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

const STATE_CASES = [
  "post /jobs/{id}/transition",
  "patch /members/{id}",
  "post /estimates/{id}/transition",
  "patch /takeoffs/{id}",
  "patch /cost-recipes/{id}",
  "post /cost-recipes/{id}/versions",
  "post /proposals/{id}/send",
  "post /detections/{id}/accept",
  "post /detections/{id}/reject",
];

describe("problem contract", () => {
  let app: FastifyInstance;
  let admin!: pg.Pool;
  const pools: pg.Pool[] = [];
  const mailer: Mailer = { async send() {} };

  beforeAll(async () => {
    await migrate("up");
    const database = {
      app: createPool(readAppDatabaseUrl()),
      auth: createPool(readAuthDatabaseUrl()),
    };
    admin = createPool(readDatabaseUrl());
    pools.push(database.app, database.auth, admin);
    app = await buildApp({ logger: false, database, mailer });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await Promise.all(pools.map((pool) => pool.end()));
  });

  it("returns problem+json for a body that fails validation", async () => {
    const failures: string[] = [];
    const document = readOpenApi();
    const paths = document.paths ?? {};
    for (const [path, item] of Object.entries(paths)) {
      if (!item || typeof item !== "object") {
        continue;
      }
      for (const method of METHODS) {
        const operation = (item as Record<string, unknown>)[method];
        if (!operation || typeof operation !== "object") {
          continue;
        }
        if (!("requestBody" in operation)) {
          continue;
        }
        const response = await app.inject({
          method: method.toUpperCase() as "POST",
          url: path.replace(/\{[^}]+\}/g, createId()),
          headers: { "content-type": "application/json", ...BROWSER },
          payload: [],
        });
        const problem = failureReason(
          response.statusCode,
          response.headers["content-type"],
          response.body,
        );
        if (problem) {
          failures.push(`${method.toUpperCase()} ${path}: ${problem}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("returns 409 problem+json for an illegal state transition", async () => {
    const tagged = stateMachineOperations(readOpenApi());
    expect(tagged.sort()).toEqual([...STATE_CASES].sort());

    const owner = await signUp("states");
    const workspace = await createWorkspace(owner.cookie, "States");
    const me = await send("GET", "/me", owner.cookie, workspace.id);
    const memberId = (
      me.body as { memberships: Array<{ workspace_id: string; id: string }> }
    ).memberships.find((row) => row.workspace_id === workspace.id)?.id;
    const client = await send("POST", "/clients", owner.cookie, workspace.id, {
      type: "residential",
      name: "State",
    });
    const location = await send("POST", "/locations", owner.cookie, workspace.id, {
      client_id: idOf(client.body),
      address: { line1: "1 State St" },
    });
    const job = await send("POST", "/jobs", owner.cookie, workspace.id, {
      client_id: idOf(client.body),
      location_id: idOf(location.body),
      name: "State job",
    });
    const jobId = idOf(job.body);
    const takeoff = await send("POST", `/jobs/${jobId}/takeoffs`, owner.cookie, workspace.id, {
      kind: "planset",
    });
    const estimate = await send("POST", `/jobs/${jobId}/estimates`, owner.cookie, workspace.id, {});
    const estimateId = idOf(estimate.body);
    const recipe = await send("POST", "/cost-recipes", owner.cookie, workspace.id, {
      name: "State recipe",
      input_unit: "ft2",
    });
    const detectionId = createId();
    await admin.query(
      `insert into detection_run (id, workspace_id, takeoff_id, mode, status, idempotency_key, request_hash)
       values ($1, $2, $3, 'assist', 'queued', $4, $5)`,
      [detectionId, workspace.id, idOf(takeoff.body), detectionId, "e".repeat(64)],
    );
    const previous = process.env.GROUNDWORK_AI_ASSIST;
    process.env.GROUNDWORK_AI_ASSIST = "1";
    try {
      await send("PATCH", `/workspaces/${workspace.id}`, owner.cookie, workspace.id, {
        features: { ai_assist: true },
      });
      const failures: string[] = [];
      const check = (key: string, entry: { method: string; url: string; body: unknown }) =>
        expectConflict(failures, key, entry, owner.cookie, workspace.id);
      await check("post /estimates/{id}/transition", {
        method: "POST",
        url: `/estimates/${estimateId}/transition`,
        body: { to: "accepted" },
      });
      await send("POST", `/estimates/${estimateId}/transition`, owner.cookie, workspace.id, {
        to: "ready",
      });
      const proposal = await send(
        "POST",
        `/estimates/${estimateId}/proposals`,
        owner.cookie,
        workspace.id,
        {},
      );
      const cases: Record<string, { method: string; url: string; body: unknown }> = {
        "post /jobs/{id}/transition": {
          method: "POST",
          url: `/jobs/${jobId}/transition`,
          body: { to: "won" },
        },
        "patch /members/{id}": {
          method: "PATCH",
          url: `/members/${memberId}`,
          body: { status: "revoked" },
        },
        "patch /takeoffs/{id}": {
          method: "PATCH",
          url: `/takeoffs/${idOf(takeoff.body)}`,
          body: { status: "final" },
        },
        "patch /cost-recipes/{id}": {
          method: "PATCH",
          url: `/cost-recipes/${idOf(recipe.body)}`,
          body: { status: "archived" },
        },
        "post /cost-recipes/{id}/versions": {
          method: "POST",
          url: `/cost-recipes/${idOf(recipe.body)}/versions`,
          body: {},
        },
        "post /proposals/{id}/send": {
          method: "POST",
          url: `/proposals/${idOf(proposal.body)}/send`,
          body: { recipients: [{ name: "Pat", email: "pat@example.com" }] },
        },
        "post /detections/{id}/accept": {
          method: "POST",
          url: `/detections/${detectionId}/accept`,
          body: { all: true },
        },
        "post /detections/{id}/reject": {
          method: "POST",
          url: `/detections/${detectionId}/reject`,
          body: { all: true },
        },
      };
      for (const key of STATE_CASES) {
        if (key === "post /estimates/{id}/transition") {
          continue;
        }
        const entry = cases[key];
        if (!entry) {
          failures.push(`${key} has no case`);
          continue;
        }
        await check(key, entry);
      }
      expect(failures).toEqual([]);
    } finally {
      if (previous === undefined) {
        delete process.env.GROUNDWORK_AI_ASSIST;
      } else {
        process.env.GROUNDWORK_AI_ASSIST = previous;
      }
    }
  }, 60_000);

  async function expectConflict(
    failures: string[],
    key: string,
    entry: { method: string; url: string; body: unknown },
    cookie: string,
    workspaceId: string,
  ) {
    const response = await app.inject({
      method: entry.method as "POST",
      url: entry.url,
      headers: {
        cookie,
        "x-workspace-id": workspaceId,
        "content-type": "application/json",
        ...BROWSER,
      },
      payload: entry.body as object,
    });
    if (response.statusCode !== 409) {
      failures.push(`${key} -> ${response.statusCode} ${response.body}`);
      return;
    }
    const problem = failureReason(409, response.headers["content-type"], response.body);
    if (problem) {
      failures.push(`${key}: ${problem}`);
    }
  }

  async function send(
    method: string,
    url: string,
    cookie: string,
    workspaceId: string,
    payload?: unknown,
  ) {
    const response = await app.inject({
      method: method as "GET",
      url,
      headers: {
        cookie,
        "x-workspace-id": workspaceId,
        ...BROWSER,
        ...(payload !== undefined ? { "content-type": "application/json" } : {}),
      },
      payload: payload as object | undefined,
    });
    if (response.statusCode >= 400) {
      throw new Error(`${method} ${url} -> ${response.statusCode} ${response.body}`);
    }
    return { status: response.statusCode, body: response.json() as unknown };
  }

  async function signUp(label: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/sign-up/email",
      headers: { "content-type": "application/json", ...BROWSER },
      payload: { name: label, email: `${label}-${createId()}@example.com`, password: PASSWORD },
    });
    if (response.statusCode !== 200) {
      throw new Error(response.body);
    }
    const cookie = response.headers["set-cookie"];
    if (!cookie) {
      throw new Error("Sign-up did not set a cookie.");
    }
    return { cookie: Array.isArray(cookie) ? cookie.join("; ") : cookie };
  }

  async function createWorkspace(cookie: string, name: string) {
    const response = await app.inject({
      method: "POST",
      url: "/workspaces",
      headers: { cookie, "content-type": "application/json", ...BROWSER },
      payload: { name },
    });
    if (response.statusCode !== 201) {
      throw new Error(response.body);
    }
    return response.json() as { id: string };
  }
});

function stateMachineOperations(document: { paths?: Record<string, unknown> }): string[] {
  const found: string[] = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    if (!item || typeof item !== "object") {
      continue;
    }
    for (const method of METHODS) {
      const operation = (item as Record<string, unknown>)[method];
      if (!operation || typeof operation !== "object") {
        continue;
      }
      const tags = (operation as { tags?: string[] }).tags ?? [];
      if (tags.includes("state-machine")) {
        found.push(`${method} ${path}`);
      }
    }
  }
  return found;
}

function failureReason(
  status: number,
  contentType: string | string[] | undefined,
  raw: string,
): string | undefined {
  const type = Array.isArray(contentType) ? contentType.join(";") : (contentType ?? "");
  if (!type.includes(PROBLEM_JSON_CONTENT_TYPE)) {
    return `content-type ${type || "missing"}`;
  }
  if (status !== 400 && status !== 409 && status !== 422) {
    return `status ${status} ${raw}`;
  }
  const body = JSON.parse(raw) as {
    type?: unknown;
    title?: unknown;
    status?: unknown;
    detail?: unknown;
  };
  if (typeof body.type !== "string" || body.type.length === 0) {
    return "missing type";
  }
  if (typeof body.title !== "string" || body.title.length === 0) {
    return "missing title";
  }
  if (body.status !== status) {
    return "status mismatch";
  }
  if (typeof body.detail !== "string" || body.detail.length === 0) {
    return "missing detail";
  }
  if (
    /\n\s+at\s+/.test(body.detail) ||
    /\b(select\s+[\s\S]{0,80}\s+from|insert\s+into)\b/i.test(body.detail)
  ) {
    return `leaked ${body.detail}`;
  }
  return undefined;
}

function idOf(body: unknown): string {
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string") {
    throw new Error("Response did not include an id.");
  }
  return body.id;
}
