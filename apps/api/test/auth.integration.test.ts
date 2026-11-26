import {
  CATALOG_VISIBILITY_SAMPLE,
  SYSTEM_ROLE_PERMISSIONS,
  createId,
  type SystemRoleName,
} from "@groundwork/shared";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Mailer, OutboundMail } from "../src/auth/mail.js";
import { buildApp } from "../src/app.js";
import { readAppDatabaseUrl, readAuthDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";

const PASSWORD = "correct-horse-battery";
const BROWSER = {
  origin: "http://127.0.0.1:5173",
  host: "127.0.0.1:5173",
};

const TENANT_ROUTES = [
  "get /workspaces/{id}",
  "patch /workspaces/{id}",
  "post /workspaces/{id}/activate",
  "get /workspaces/{id}/members",
  "post /workspaces/{id}/invites",
  "patch /members/{id}",
  "get /catalog-items",
  "get /imagery/captures",
  "get /imagery/tiles/{captureId}/{z}/{x}/{y}",
];

type Session = { cookie: string; email: string };
type Workspace = { id: string; name: string };
type Me = {
  user: { id: string; email: string };
  active_workspace_id: string | null;
  memberships: {
    id: string;
    workspace_id: string;
    role: string;
    role_id: string;
    status: string;
    permissions: string[];
  }[];
};
type Role = { id: string; name: SystemRoleName; permissions: string[] };

let app: FastifyInstance | undefined;
let admin: pg.Pool | undefined;
const sent: OutboundMail[] = [];

const mailer: Mailer = {
  async send(mail) {
    sent.push(mail);
  },
};

beforeAll(async () => {
  await migrate("up");
  admin = createPool(readDatabaseUrl());
  const database = {
    app: createPool(readAppDatabaseUrl()),
    auth: createPool(readAuthDatabaseUrl()),
  };
  app = await buildApp({ logger: false, database, mailer });
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

async function signUp(name: string, email = `${createId()}@example.com`): Promise<Session> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/auth/sign-up/email",
    headers: { ...BROWSER, "content-type": "application/json" },
    payload: { name, email, password: PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: cookieFrom(response), email };
}

async function signIn(email: string): Promise<string> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/auth/sign-in/email",
    headers: { ...BROWSER, "content-type": "application/json" },
    payload: { email, password: PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(200);
  return cookieFrom(response);
}

async function createWorkspace(cookie: string, name: string): Promise<Workspace> {
  const response = await requireApp().inject({
    method: "POST",
    url: "/workspaces",
    headers: { ...BROWSER, cookie, "content-type": "application/json" },
    payload: { name, timezone: "America/New_York", currency: "USD", units_pref: "imperial" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}

async function me(cookie: string): Promise<{ status: number; body: Me }> {
  const response = await requireApp().inject({
    method: "GET",
    url: "/me",
    headers: { ...BROWSER, cookie },
  });
  return {
    status: response.statusCode,
    body: response.statusCode === 200 ? response.json() : ({} as Me),
  };
}

async function roles(cookie: string): Promise<Role[]> {
  const response = await requireApp().inject({
    method: "GET",
    url: "/roles",
    headers: { ...BROWSER, cookie },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().roles;
}

function roleId(list: Role[], name: SystemRoleName): string {
  const role = list.find((item) => item.name === name);
  if (!role) {
    throw new Error(`Missing system role ${name}.`);
  }
  return role.id;
}

async function invite(
  cookie: string,
  workspaceId: string,
  email: string,
  role: string,
): Promise<{ status: number; body: { id: string; expires_at: string; status: string } }> {
  const response = await requireApp().inject({
    method: "POST",
    url: `/workspaces/${workspaceId}/invites`,
    headers: { ...BROWSER, cookie, "content-type": "application/json" },
    payload: { email, roleId: role },
  });
  return { status: response.statusCode, body: response.json() };
}

async function accept(cookie: string, token: string): Promise<{ status: number; body: unknown }> {
  const response = await requireApp().inject({
    method: "POST",
    url: `/invites/${token}/accept`,
    headers: { ...BROWSER, cookie },
  });
  return { status: response.statusCode, body: response.json() };
}

describe("auth and workspaces", () => {
  it("signs up, signs in, and creates a workspace the caller owns", async () => {
    const owner = await signUp("Ada Owner");
    await requireApp().inject({
      method: "POST",
      url: "/auth/sign-out",
      headers: { ...BROWSER, cookie: owner.cookie },
    });
    const cookie = await signIn(owner.email);
    const workspace = await createWorkspace(cookie, "Ada Paving");
    const profile = await me(cookie);
    expect(profile.status).toBe(200);
    expect(profile.body.user.email).toBe(owner.email);
    expect(profile.body.active_workspace_id).toBe(workspace.id);
    expect(profile.body.memberships).toEqual([
      expect.objectContaining({
        workspace_id: workspace.id,
        role: "owner",
        status: "active",
        permissions: expect.arrayContaining([...SYSTEM_ROLE_PERMISSIONS.owner]),
      }),
    ]);
  });

  it("sends a magic link through the mailer", async () => {
    const owner = await signUp("Magic Owner");
    const before = sent.length;
    const response = await requireApp().inject({
      method: "POST",
      url: "/auth/sign-in/magic-link",
      headers: { ...BROWSER, "content-type": "application/json" },
      payload: { email: owner.email, callbackURL: "http://127.0.0.1:5173/" },
    });
    expect(response.statusCode, response.body).toBe(200);
    const mail = sent.slice(before).find((item) => item.to === owner.email);
    expect(mail?.text).toContain("http");
  });

  it("switches the active workspace", async () => {
    const owner = await signUp("Switch Owner");
    const first = await createWorkspace(owner.cookie, "North Yard");
    const second = await createWorkspace(owner.cookie, "South Yard");
    const activated = await requireApp().inject({
      method: "POST",
      url: `/workspaces/${second.id}/activate`,
      headers: { ...BROWSER, cookie: owner.cookie },
    });
    expect(activated.statusCode, activated.body).toBe(200);
    const profile = await me(owner.cookie);
    expect(profile.body.memberships.map((item) => item.workspace_id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(profile.body.active_workspace_id).toBe(second.id);
  });

  it("lists the six system roles and their permissions", async () => {
    const owner = await signUp("Role Owner");
    const list = await roles(owner.cookie);
    expect(list.map((role) => role.name)).toEqual([
      "owner",
      "admin",
      "estimator",
      "office",
      "foreman",
      "crew",
    ]);
    for (const role of list) {
      expect(role.permissions).toEqual([...SYSTEM_ROLE_PERMISSIONS[role.name]]);
    }
  });

  it("invites a new email, links an existing user, and resends one pending invite", async () => {
    const owner = await signUp("Invite Owner");
    const workspace = await createWorkspace(owner.cookie, "Invite Co");
    const list = await roles(owner.cookie);
    const crew = roleId(list, "crew");
    const freshEmail = `${createId()}@example.com`;
    const before = sent.length;
    const created = await invite(owner.cookie, workspace.id, freshEmail, crew);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("invited");
    const mail = sent.slice(before).find((item) => item.to === freshEmail);
    expect(mail?.text).toContain(`/invites/${created.body.id}`);

    const pool = admin;
    if (!pool) {
      throw new Error("Admin pool is not connected.");
    }
    await pool.query("update invitation set expires_at = now() - interval '1 day' where id = $1", [
      created.body.id,
    ]);
    const resent = await invite(owner.cookie, workspace.id, freshEmail, crew);
    expect(resent.status).toBe(201);
    expect(resent.body.id).toBe(created.body.id);
    expect(Date.parse(resent.body.expires_at)).toBeGreaterThan(Date.now());

    const members = await requireApp().inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/members`,
      headers: { ...BROWSER, cookie: owner.cookie },
    });
    const pending = members
      .json()
      .members.filter((item: { email: string }) => item.email === freshEmail);
    expect(pending).toHaveLength(1);
    expect(pending[0].user_id).toBeNull();

    const existing = await signUp("Existing Crew");
    const linked = await invite(owner.cookie, workspace.id, existing.email, crew);
    expect(linked.status).toBe(201);
    const again = await requireApp().inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/members`,
      headers: { ...BROWSER, cookie: owner.cookie },
    });
    const row = again
      .json()
      .members.find((item: { email: string }) => item.email === existing.email);
    expect(row.user_id).toBe((await me(existing.cookie)).body.user.id);
    expect(row.status).toBe("invited");
  });

  it("accepts an invite for the signed-in email and rejects the other cases", async () => {
    const owner = await signUp("Accept Owner");
    const workspace = await createWorkspace(owner.cookie, "Accept Co");
    const list = await roles(owner.cookie);
    const crew = await signUp("Accept Crew");
    const created = await invite(owner.cookie, workspace.id, crew.email, roleId(list, "crew"));
    const stranger = await signUp("Stranger");
    const wrongEmail = await accept(stranger.cookie, created.body.id);
    expect(wrongEmail.status).toBe(404);

    const accepted = await accept(crew.cookie, created.body.id);
    expect(accepted.status).toBe(200);
    const profile = await me(crew.cookie);
    expect(profile.body.active_workspace_id).toBe(workspace.id);
    const seen = await requireApp().inject({
      method: "GET",
      url: `/workspaces/${workspace.id}`,
      headers: { ...BROWSER, cookie: crew.cookie },
    });
    expect(seen.statusCode).toBe(200);

    const duplicate = await invite(owner.cookie, workspace.id, crew.email, roleId(list, "crew"));
    expect(duplicate.status).toBe(409);

    const expiredEmail = `${createId()}@example.com`;
    const expiring = await invite(owner.cookie, workspace.id, expiredEmail, roleId(list, "office"));
    const expiredUser = await signUp("Expired", expiredEmail);
    await admin?.query("update invitation set expires_at = now() where id = $1", [
      expiring.body.id,
    ]);
    const expired = await accept(expiredUser.cookie, expiring.body.id);
    expect(expired.status).toBe(409);

    const invited = await invite(
      owner.cookie,
      workspace.id,
      `${createId()}@example.com`,
      roleId(list, "foreman"),
    );
    const members = await requireApp().inject({
      method: "GET",
      url: `/workspaces/${workspace.id}/members`,
      headers: { ...BROWSER, cookie: owner.cookie },
    });
    const invitedRow = members
      .json()
      .members.find((item: { status: string; role: string }) => item.role === "foreman");
    const illegal = await requireApp().inject({
      method: "PATCH",
      url: `/members/${invitedRow.id}`,
      headers: { ...BROWSER, cookie: owner.cookie, "content-type": "application/json" },
      payload: { status: "disabled" },
    });
    expect(illegal.statusCode, illegal.body).toBe(409);
    expect(invited.body.id).toBeTruthy();

    const activeIllegal = await requireApp().inject({
      method: "PATCH",
      url: `/members/${profile.body.memberships[0]?.id}`,
      headers: { ...BROWSER, cookie: owner.cookie, "content-type": "application/json" },
      payload: { status: "revoked" },
    });
    expect(activeIllegal.statusCode, activeIllegal.body).toBe(409);
  });

  it("refuses to remove the last owner and allows it once another owner is active", async () => {
    const owner = await signUp("Last Owner");
    const workspace = await createWorkspace(owner.cookie, "Last Co");
    const profile = await me(owner.cookie);
    const ownerMember = profile.body.memberships[0];
    if (!ownerMember) {
      throw new Error("The owner membership is missing.");
    }
    const list = await roles(owner.cookie);
    const demote = await requireApp().inject({
      method: "PATCH",
      url: `/members/${ownerMember.id}`,
      headers: { ...BROWSER, cookie: owner.cookie, "content-type": "application/json" },
      payload: { roleId: roleId(list, "admin") },
    });
    expect(demote.statusCode, demote.body).toBe(409);
    const disable = await requireApp().inject({
      method: "PATCH",
      url: `/members/${ownerMember.id}`,
      headers: { ...BROWSER, cookie: owner.cookie, "content-type": "application/json" },
      payload: { status: "disabled" },
    });
    expect(disable.statusCode, disable.body).toBe(409);

    const second = await signUp("Second Owner");
    const created = await invite(owner.cookie, workspace.id, second.email, roleId(list, "owner"));
    expect((await accept(second.cookie, created.body.id)).status).toBe(200);
    const allowed = await requireApp().inject({
      method: "PATCH",
      url: `/members/${ownerMember.id}`,
      headers: { ...BROWSER, cookie: second.cookie, "content-type": "application/json" },
      payload: { roleId: roleId(list, "admin") },
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
  });

  it("invalidates a disabled member's sessions before the next request", async () => {
    const owner = await signUp("Disable Owner");
    const workspace = await createWorkspace(owner.cookie, "Disable Co");
    const list = await roles(owner.cookie);
    const person = await signUp("Disabled Person");
    const created = await invite(
      owner.cookie,
      workspace.id,
      person.email,
      roleId(list, "estimator"),
    );
    expect((await accept(person.cookie, created.body.id)).status).toBe(200);
    const profile = await me(person.cookie);
    const started = Date.now();
    const disabled = await requireApp().inject({
      method: "PATCH",
      url: `/members/${profile.body.memberships[0]?.id}`,
      headers: { ...BROWSER, cookie: owner.cookie, "content-type": "application/json" },
      payload: { status: "disabled" },
    });
    expect(disabled.statusCode, disabled.body).toBe(200);
    const after = await me(person.cookie);
    const tenant = await requireApp().inject({
      method: "GET",
      url: `/workspaces/${workspace.id}`,
      headers: { ...BROWSER, cookie: person.cookie },
    });
    expect(after.status).toBe(401);
    expect(tenant.statusCode).toBe(401);
    expect(Date.now() - started).toBeLessThan(60_000);

    const again = await invite(owner.cookie, workspace.id, person.email, roleId(list, "estimator"));
    expect(again.status).toBe(409);
  });

  it("serves imagery to a member and hides it from everyone else", async () => {
    const owner = await signUp("Imagery Owner");
    const workspace = await createWorkspace(owner.cookie, "Imagery Co");
    const outsider = await signUp("Imagery Outsider");
    const bbox = "/imagery/captures?bbox=-81.95,35.52,-81.40,35.99";
    const visible = await requireApp().inject({
      method: "GET",
      url: bbox,
      headers: { ...BROWSER, cookie: owner.cookie, "x-workspace-id": workspace.id },
    });
    expect(visible.statusCode, visible.body).toBe(200);
    expect(visible.json().captures.length).toBeGreaterThan(0);
    const hidden = await requireApp().inject({
      method: "GET",
      url: bbox,
      headers: { ...BROWSER, cookie: outsider.cookie, "x-workspace-id": workspace.id },
    });
    expect(hidden.statusCode, hidden.body).toBe(404);
    const signedOut = await requireApp().inject({
      method: "GET",
      url: bbox,
      headers: { ...BROWSER, "x-workspace-id": workspace.id },
    });
    expect(signedOut.statusCode).toBe(401);
  });

  it("shows unit cost only to roles with catalog.manage", async () => {
    const owner = await signUp("Catalog Owner");
    const workspace = await createWorkspace(owner.cookie, "Catalog Co");
    const list = await roles(owner.cookie);
    const estimator = await signUp("Estimator");
    const office = await signUp("Office");
    const estimatorInvite = await invite(
      owner.cookie,
      workspace.id,
      estimator.email,
      roleId(list, "estimator"),
    );
    const officeInvite = await invite(
      owner.cookie,
      workspace.id,
      office.email,
      roleId(list, "office"),
    );
    expect((await accept(estimator.cookie, estimatorInvite.body.id)).status).toBe(200);
    expect((await accept(office.cookie, officeInvite.body.id)).status).toBe(200);

    async function items(cookie: string) {
      const response = await requireApp().inject({
        method: "GET",
        url: "/catalog-items",
        headers: { ...BROWSER, cookie, "x-workspace-id": workspace.id },
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json().items[0];
    }

    const ownerItem = await items(owner.cookie);
    const estimatorItem = await items(estimator.cookie);
    const officeItem = await items(office.cookie);
    expect(ownerItem).toMatchObject(CATALOG_VISIBILITY_SAMPLE);
    expect(estimatorItem.unit_cost_cents).toBe(9200);
    expect(officeItem.unit_price_cents).toBe(18500);
    expect(officeItem).not.toHaveProperty("unit_cost_cents");
  });

  it("returns 404 for every tenant route when the caller is not a member", async () => {
    const owner = await signUp("Tenant Owner");
    const outsider = await signUp("Outsider");
    const workspace = await createWorkspace(owner.cookie, "Hidden Co");
    const other = await createWorkspace(outsider.cookie, "Other Co");
    const ownerProfile = await me(owner.cookie);
    const outsiderProfile = await me(outsider.cookie);
    const specResponse = await requireApp().inject({ method: "GET", url: "/openapi.json" });
    const spec = specResponse.json() as {
      paths: Record<string, Record<string, { tags?: string[] } | undefined>>;
    };
    const seen: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of ["get", "post", "patch", "put", "delete"]) {
        const operation = item[method];
        if (!operation) {
          continue;
        }
        const tags = operation.tags ?? [];
        const key = `${method} ${path}`;
        const tenantPath = /^\/(workspaces\/|members\/|catalog-items|imagery\/)/.test(path);
        if (tenantPath && !tags.some((tag) => tag.startsWith("tenant-"))) {
          throw new Error(`${key} is missing a tenant tag.`);
        }
        if (!tags.some((tag) => tag.startsWith("tenant-"))) {
          continue;
        }
        seen.push(key);
        let url = path
          .replace("/workspaces/{id}", `/workspaces/${workspace.id}`)
          .replace("/members/{id}", `/members/${ownerProfile.body.memberships[0]?.id}`)
          .replace("{captureId}", createId())
          .replace("{z}", "1")
          .replace("{x}", "0")
          .replace("{y}", "0");
        if (path === "/imagery/captures") {
          url += "?bbox=-81.95,35.52,-81.40,35.99";
        }
        const payload =
          key === "post /workspaces/{id}/invites"
            ? { email: "nobody@example.com", roleId: ownerProfile.body.memberships[0]?.role_id }
            : key === "patch /workspaces/{id}"
              ? { name: "Nope" }
              : key === "patch /members/{id}"
                ? { status: "disabled" }
                : undefined;
        const response = await requireApp().inject({
          method: method.toUpperCase() as "GET",
          url,
          headers: {
            ...BROWSER,
            cookie: outsider.cookie,
            "x-workspace-id": workspace.id,
            ...(payload ? { "content-type": "application/json" } : {}),
          },
          payload,
        });
        expect({ route: key, status: response.statusCode, body: response.body }).toMatchObject({
          status: 404,
        });
      }
    }
    expect(seen.sort()).toEqual([...TENANT_ROUTES].sort());
    const own = await requireApp().inject({
      method: "GET",
      url: `/workspaces/${other.id}`,
      headers: { ...BROWSER, cookie: outsider.cookie },
    });
    expect(own.statusCode).toBe(200);
    expect(outsiderProfile.body.memberships[0]?.workspace_id).toBe(other.id);
  });
});
