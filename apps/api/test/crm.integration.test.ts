import { createId } from "@groundwork/shared";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Mailer } from "../src/auth/mail.js";
import { buildApp } from "../src/app.js";
import { readAppDatabaseUrl, readAuthDatabaseUrl, readDatabaseUrl } from "../src/config.js";
import { createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { MORGANTON_MAIN, fixtureParcelId } from "../src/crm/providers.js";

const PASSWORD = "correct-horse-battery";
const BROWSER = {
  origin: "http://127.0.0.1:5173",
  host: "127.0.0.1:5173",
};

type Session = { cookie: string; email: string };
type Membership = { id: string; workspace_id: string; role: string };

let app: FastifyInstance | undefined;
let admin: pg.Pool | undefined;

const mailer: Mailer = {
  async send() {
    return undefined;
  },
};

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

function headers(cookie: string, workspaceId: string): Record<string, string> {
  return {
    ...BROWSER,
    cookie,
    "x-workspace-id": workspaceId,
    "content-type": "application/json",
  };
}

async function membership(cookie: string, workspaceId: string): Promise<Membership> {
  const response = await requireApp().inject({
    method: "GET",
    url: "/me",
    headers: { ...BROWSER, cookie },
  });
  expect(response.statusCode, response.body).toBe(200);
  const row = response
    .json()
    .memberships.find((item: Membership) => item.workspace_id === workspaceId);
  if (!row) {
    throw new Error("Membership was not found.");
  }
  return row;
}

async function inviteAndAccept(
  ownerCookie: string,
  workspaceId: string,
  role: string,
  name: string,
): Promise<Session & { memberId: string }> {
  const person = await signUp(name);
  const roles = await requireApp().inject({
    method: "GET",
    url: "/roles",
    headers: { ...BROWSER, cookie: ownerCookie },
  });
  const roleId = roles.json().roles.find((item: { name: string; id: string }) => item.name === role)
    ?.id as string;
  const invited = await requireApp().inject({
    method: "POST",
    url: `/workspaces/${workspaceId}/invites`,
    headers: headers(ownerCookie, workspaceId),
    payload: { email: person.email, roleId },
  });
  expect(invited.statusCode, invited.body).toBe(201);
  const accepted = await requireApp().inject({
    method: "POST",
    url: `/invites/${invited.json().id}/accept`,
    headers: { ...BROWSER, cookie: person.cookie },
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
  const member = await membership(person.cookie, workspaceId);
  return { ...person, memberId: member.id };
}

describe("crm and jobs", () => {
  it("creates a job from an address with a client, a point, and J-1001", async () => {
    const owner = await signUp("Job Owner");
    const workspace = await createWorkspace(owner.cookie, "Job Co");
    const created = await requireApp().inject({
      method: "POST",
      url: "/jobs",
      headers: headers(owner.cookie, workspace.id),
      payload: {
        address: "100 Main Street, Morganton, NC 28655",
        client: {
          name: "Burke HOA",
          type: "hoa",
          email: "office@burke.example.com",
          phone: "8285550100",
        },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const job = created.json();
    expect(job.number).toBe("J-1001");
    expect(job.stage).toBe("lead");
    expect(job.name).toBe("100 Main St");
    expect(job.point.lat).toBeCloseTo(MORGANTON_MAIN.point.lat, 5);
    expect(job.point.lng).toBeCloseTo(MORGANTON_MAIN.point.lng, 5);
    expect(job.client_name).toBe("Burke HOA");

    const location = await requireApp().inject({
      method: "GET",
      url: `/locations/${job.location_id}`,
      headers: headers(owner.cookie, workspace.id),
    });
    expect(location.statusCode, location.body).toBe(200);
    expect(location.json().point.lat).toBeCloseTo(MORGANTON_MAIN.point.lat, 5);
    expect(location.json().point.lng).toBeCloseTo(MORGANTON_MAIN.point.lng, 5);
    expect(location.json().client_id).toBe(job.client_id);
    expect(location.json().parcel_cache_id).toEqual(expect.any(String));
    expect(location.json().site_geom.type).toBe("MultiPolygon");

    const second = await requireApp().inject({
      method: "POST",
      url: "/jobs",
      headers: headers(owner.cookie, workspace.id),
      payload: { name: "Follow up", client_id: job.client_id },
    });
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().number).toBe("J-1002");

    const captures = await requireApp().inject({
      method: "GET",
      url: `/imagery/captures?locationId=${job.location_id}`,
      headers: headers(owner.cookie, workspace.id),
    });
    expect(captures.statusCode, captures.body).toBe(200);
    expect(captures.json().captures.map((item: { name: string }) => item.name)).toContain(
      "nc_helene_2025",
    );
  });

  it("warns when a new client repeats an email or phone and still creates the row", async () => {
    const owner = await signUp("Dupe Owner");
    const workspace = await createWorkspace(owner.cookie, "Dupe Co");
    const first = await requireApp().inject({
      method: "POST",
      url: "/clients",
      headers: headers(owner.cookie, workspace.id),
      payload: {
        name: "Ada",
        type: "residential",
        email: "ada@example.com",
        phone: "(828) 555-0199",
      },
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().warnings).toEqual([]);
    const second = await requireApp().inject({
      method: "POST",
      url: "/clients",
      headers: headers(owner.cookie, workspace.id),
      payload: {
        name: "Ada Again",
        type: "residential",
        email: "Ada@example.com",
        phone: "8285550199",
      },
    });
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().warnings).toEqual([
      "A client with this email already exists.",
      "A client with this phone already exists.",
    ]);
    expect(second.json().id).not.toBe(first.json().id);
  });

  it("sums pipeline bid values to the same total as the job rows", async () => {
    const owner = await signUp("Pipe Owner");
    const workspace = await createWorkspace(owner.cookie, "Pipe Co");
    const client = await requireApp().inject({
      method: "POST",
      url: "/clients",
      headers: headers(owner.cookie, workspace.id),
      payload: { name: "Pipe", type: "commercial" },
    });
    expect(client.statusCode, client.body).toBe(201);
    const bids = [10000, 25000, null, 5000];
    const jobs = [];
    for (const [index, bid] of bids.entries()) {
      const response = await requireApp().inject({
        method: "POST",
        url: "/jobs",
        headers: headers(owner.cookie, workspace.id),
        payload: {
          name: `Bid ${index}`,
          client_id: client.json().id,
          ...(bid === null ? {} : { bid_value_cents: bid }),
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      jobs.push(response.json());
    }
    const moved = await requireApp().inject({
      method: "POST",
      url: `/jobs/${jobs[0].id}/transition`,
      headers: headers(owner.cookie, workspace.id),
      payload: { to: "estimating" },
    });
    expect(moved.statusCode, moved.body).toBe(200);

    const summary = await requireApp().inject({
      method: "GET",
      url: "/pipeline/summary",
      headers: headers(owner.cookie, workspace.id),
    });
    expect(summary.statusCode, summary.body).toBe(200);
    const stages = summary.json().stages as {
      stage: string;
      count: number;
      bid_value_cents: number;
    }[];
    const listed = await requireApp().inject({
      method: "GET",
      url: "/jobs?limit=50",
      headers: headers(owner.cookie, workspace.id),
    });
    const rows = listed.json().jobs as { bid_value_cents: number | null }[];
    const fromRows = rows.reduce((sum, row) => sum + (row.bid_value_cents ?? 0), 0);
    const fromSummary = stages.reduce((sum, stage) => sum + stage.bid_value_cents, 0);
    expect(fromSummary).toBe(fromRows);
    expect(fromSummary).toBe(40000);
    expect(stages.find((stage) => stage.stage === "estimating")?.count).toBe(1);
    expect(stages.find((stage) => stage.stage === "lead")?.count).toBe(3);
  });

  it("returns 409 problem+json for an illegal transition and records every stage change", async () => {
    const owner = await signUp("Stage Owner");
    const workspace = await createWorkspace(owner.cookie, "Stage Co");
    const ownerMember = await membership(owner.cookie, workspace.id);
    const estimator = await inviteAndAccept(owner.cookie, workspace.id, "estimator", "Esti");
    const client = await requireApp().inject({
      method: "POST",
      url: "/clients",
      headers: headers(owner.cookie, workspace.id),
      payload: { name: "Stage", type: "residential" },
    });
    const job = await requireApp().inject({
      method: "POST",
      url: "/jobs",
      headers: headers(owner.cookie, workspace.id),
      payload: { name: "Driveway", client_id: client.json().id },
    });
    expect(job.statusCode, job.body).toBe(201);
    const jobId = job.json().id as string;

    const illegal = await requireApp().inject({
      method: "POST",
      url: `/jobs/${jobId}/transition`,
      headers: headers(estimator.cookie, workspace.id),
      payload: { to: "won" },
    });
    expect(illegal.statusCode).toBe(409);
    expect(illegal.headers["content-type"]).toContain("application/problem+json");
    expect(illegal.json()).toMatchObject({
      status: 409,
      title: "Conflict",
      detail: "Cannot change a job from lead to won.",
    });

    for (const to of ["estimating", "proposed"]) {
      const step = await requireApp().inject({
        method: "POST",
        url: `/jobs/${jobId}/transition`,
        headers: headers(estimator.cookie, workspace.id),
        payload: { to },
      });
      expect(step.statusCode, step.body).toBe(200);
    }
    const blocked = await requireApp().inject({
      method: "POST",
      url: `/jobs/${jobId}/transition`,
      headers: headers(estimator.cookie, workspace.id),
      payload: { to: "won" },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().detail).toContain("jobs.force_won");

    const won = await requireApp().inject({
      method: "POST",
      url: `/jobs/${jobId}/transition`,
      headers: headers(owner.cookie, workspace.id),
      payload: { to: "won", reason: "handshake" },
    });
    expect(won.statusCode, won.body).toBe(200);
    expect(won.json().stage).toBe("won");

    const missingReason = await requireApp().inject({
      method: "POST",
      url: "/jobs",
      headers: headers(owner.cookie, workspace.id),
      payload: { name: "Lost later", client_id: client.json().id },
    });
    const lostId = missingReason.json().id as string;
    const noReason = await requireApp().inject({
      method: "POST",
      url: `/jobs/${lostId}/transition`,
      headers: headers(owner.cookie, workspace.id),
      payload: { to: "lost" },
    });
    expect(noReason.statusCode).toBe(409);
    const lost = await requireApp().inject({
      method: "POST",
      url: `/jobs/${lostId}/transition`,
      headers: headers(owner.cookie, workspace.id),
      payload: { to: "lost", reason: "  too expensive  " },
    });
    expect(lost.statusCode, lost.body).toBe(200);
    expect(lost.json().lost_reason).toBe("too expensive");
    const reopened = await requireApp().inject({
      method: "POST",
      url: `/jobs/${lostId}/transition`,
      headers: headers(owner.cookie, workspace.id),
      payload: { to: "lead" },
    });
    expect(reopened.statusCode, reopened.body).toBe(200);
    expect(reopened.json().stage).toBe("lead");
    expect(reopened.json().lost_reason).toBeNull();

    const audit = await requireAdmin().query<{
      actor: string;
      action: string;
      diff: { from: string; to: string; reason: string | null; forced: boolean };
    }>(
      `select actor_member_id::text as actor, action, diff
       from audit_log
       where entity_id = $1
       order by id`,
      [jobId],
    );
    expect(audit.rows.map((row) => row.diff.to)).toEqual(["estimating", "proposed", "won"]);
    expect(audit.rows.every((row) => row.action === "stage")).toBe(true);
    expect(audit.rows[0]?.actor).toBe(estimator.memberId);
    expect(audit.rows[2]).toMatchObject({
      actor: ownerMember.id,
      diff: { from: "proposed", to: "won", reason: "handshake", forced: true },
    });
    const activity = await requireApp().inject({
      method: "GET",
      url: `/jobs/${jobId}/activity`,
      headers: headers(owner.cookie, workspace.id),
    });
    expect(activity.statusCode, activity.body).toBe(200);
    const events = activity.json().events as {
      actor_member_id: string | null;
      diff: { to: string | null; reason: string | null; forced: boolean };
    }[];
    expect(events.map((event) => event.diff.to)).toEqual(["estimating", "proposed", "won"]);
    expect(events[2]).toMatchObject({
      actor_member_id: ownerMember.id,
      diff: { to: "won", reason: "handshake", forced: true },
    });
    const lostAudit = await requireAdmin().query<{ diff: { reason: string | null; to: string } }>(
      `select diff from audit_log where entity_id = $1 order by id`,
      [lostId],
    );
    expect(lostAudit.rows.map((row) => row.diff.to)).toEqual(["lost", "lead"]);
    expect(lostAudit.rows[0]?.diff.reason).toBe("too expensive");
  });

  it("finds a job by number, phone digits, and a partial street", async () => {
    const owner = await signUp("Search Owner");
    const workspace = await createWorkspace(owner.cookie, "Search Co");
    const created = await requireApp().inject({
      method: "POST",
      url: "/jobs",
      headers: headers(owner.cookie, workspace.id),
      payload: {
        address: "100 Main St, Morganton, NC 28655",
        client: { name: "Search Client", type: "residential", phone: "(919) 555-0142" },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const number = created.json().number as string;

    async function search(q: string) {
      const response = await requireApp().inject({
        method: "GET",
        url: `/search?q=${encodeURIComponent(q)}`,
        headers: headers(owner.cookie, workspace.id),
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json() as {
        jobs: { number: string }[];
        clients: { phone: string | null }[];
        locations: { address: { line1?: string } }[];
      };
    }

    const byNumber = await search(number);
    expect(byNumber.jobs.map((job) => job.number)).toContain(number);
    const byPhone = await search("9195550142");
    expect(byPhone.jobs.map((job) => job.number)).toContain(number);
    expect(byPhone.clients.some((client) => client.phone === "(919) 555-0142")).toBe(true);
    const byStreet = await search("Main St");
    expect(byStreet.jobs.map((job) => job.number)).toContain(number);
    expect(byStreet.locations.some((location) => location.address.line1 === "100 Main St")).toBe(
      true,
    );
  });

  it("answers those searches in under 300 ms with 50000 jobs", async () => {
    const owner = await signUp("Perf Owner");
    const workspace = await createWorkspace(owner.cookie, "Perf Co");
    const clientId = createId();
    const locationId = createId();
    await requireAdmin().query(
      `insert into client (id, workspace_id, type, name, phone)
       values ($1, $2, 'residential', 'Perf Phone', '(919) 555-0142')`,
      [clientId, workspace.id],
    );
    await requireAdmin().query(
      `insert into location (id, workspace_id, client_id, address, point)
       values (
         $1, $2, $3, '{"line1":"742 Evergreen Terrace"}'::jsonb,
         ST_SetSRID(ST_MakePoint($4, $5), 4326)
       )`,
      [locationId, workspace.id, clientId, MORGANTON_MAIN.point.lng, MORGANTON_MAIN.point.lat],
    );
    await requireAdmin().query(
      `insert into job (id, workspace_id, number, client_id, location_id, name, stage, bid_value_cents)
       select gen_random_uuid(), $1, 'J-' || (1000 + g), $2, $3, 'Seed ' || g, 'lead', 100
       from generate_series(1, 50000) g`,
      [workspace.id, clientId, locationId],
    );

    async function search(q: string): Promise<{ elapsed: number; jobs: { number: string }[] }> {
      const started = performance.now();
      const response = await requireApp().inject({
        method: "GET",
        url: `/search?q=${encodeURIComponent(q)}`,
        headers: headers(owner.cookie, workspace.id),
      });
      const elapsed = performance.now() - started;
      expect(response.statusCode, response.body).toBe(200);
      return { elapsed, jobs: response.json().jobs };
    }

    await search("J-42424");
    const byNumber = await search("J-42424");
    const byPhone = await search("9195550142");
    const byStreet = await search("Evergreen");
    expect(byNumber.jobs.some((job) => job.number === "J-42424")).toBe(true);
    expect(byPhone.jobs.length).toBeGreaterThan(0);
    expect(byStreet.jobs.length).toBeGreaterThan(0);
    expect(byNumber.elapsed).toBeLessThan(300);
    expect(byPhone.elapsed).toBeLessThan(300);
    expect(byStreet.elapsed).toBeLessThan(300);
  });

  it("hides a client from another workspace and refuses a crew member", async () => {
    const owner = await signUp("Iso Owner");
    const workspace = await createWorkspace(owner.cookie, "Iso Co");
    const otherOwner = await signUp("Other Owner");
    const other = await createWorkspace(otherOwner.cookie, "Other Co");
    const client = await requireApp().inject({
      method: "POST",
      url: "/clients",
      headers: headers(owner.cookie, workspace.id),
      payload: { name: "Private", type: "gov" },
    });
    const hidden = await requireApp().inject({
      method: "GET",
      url: `/clients/${client.json().id}`,
      headers: headers(otherOwner.cookie, other.id),
    });
    expect(hidden.statusCode).toBe(404);

    const crew = await inviteAndAccept(owner.cookie, workspace.id, "crew", "Crew");
    const denied = await requireApp().inject({
      method: "GET",
      url: "/jobs",
      headers: headers(crew.cookie, workspace.id),
    });
    expect(denied.statusCode).toBe(403);
  });

  it("shows a foreman only the jobs they own", async () => {
    const owner = await signUp("Assign Owner");
    const workspace = await createWorkspace(owner.cookie, "Assign Co");
    const foreman = await inviteAndAccept(owner.cookie, workspace.id, "foreman", "Foreman");
    const client = await requireApp().inject({
      method: "POST",
      url: "/clients",
      headers: headers(owner.cookie, workspace.id),
      payload: { name: "Assign", type: "residential" },
    });
    async function makeJob(name: string) {
      const response = await requireApp().inject({
        method: "POST",
        url: "/jobs",
        headers: headers(owner.cookie, workspace.id),
        payload: { name, client_id: client.json().id },
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json() as { id: string; name: string };
    }
    const owned = await makeJob("Foreman job");
    await makeJob("Office job");
    const patched = await requireApp().inject({
      method: "PATCH",
      url: `/jobs/${owned.id}`,
      headers: headers(owner.cookie, workspace.id),
      payload: { owner_member_id: foreman.memberId },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const visible = await requireApp().inject({
      method: "GET",
      url: "/jobs",
      headers: headers(foreman.cookie, workspace.id),
    });
    expect(visible.statusCode, visible.body).toBe(200);
    expect(visible.json().jobs.map((job: { name: string }) => job.name)).toEqual(["Foreman job"]);
    const blocked = await requireApp().inject({
      method: "POST",
      url: "/jobs",
      headers: headers(foreman.cookie, workspace.id),
      payload: { name: "Nope", client_id: client.json().id },
    });
    expect(blocked.statusCode).toBe(403);
  });

  it("caches a parcel, keeps an ungeocodable site, and stores notes, tasks, and a presigned file", async () => {
    const owner = await signUp("File Owner");
    const workspace = await createWorkspace(owner.cookie, "File Co");
    const resolved = await requireApp().inject({
      method: "POST",
      url: "/locations/resolve",
      headers: headers(owner.cookie, workspace.id),
      payload: { address: "100 Main St, Morganton, NC 28655" },
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    const parcelId = resolved.json().parcels[0].provider_parcel_id as string;
    expect(parcelId).toBe(fixtureParcelId(MORGANTON_MAIN.point));
    const again = await requireApp().inject({
      method: "POST",
      url: "/locations/resolve",
      headers: headers(owner.cookie, workspace.id),
      payload: { lat: MORGANTON_MAIN.point.lat, lng: MORGANTON_MAIN.point.lng },
    });
    expect(again.json().parcels[0].id).toBe(resolved.json().parcels[0].id);
    const cached = await requireAdmin().query<{ n: number }>(
      "select count(*)::int as n from parcel_cache where provider = 'fixture' and provider_parcel_id = $1",
      [parcelId],
    );
    expect(cached.rows[0]?.n).toBe(1);

    const missed = await requireApp().inject({
      method: "POST",
      url: "/locations/resolve",
      headers: headers(owner.cookie, workspace.id),
      payload: { address: "1 Uncoded Ridge, Nowhere, NC" },
    });
    expect(missed.statusCode).toBe(200);
    expect(missed.json().point).toBeNull();
    expect(missed.json().warnings[0]).toContain("could not be geocoded");

    const job = await requireApp().inject({
      method: "POST",
      url: "/jobs",
      headers: headers(owner.cookie, workspace.id),
      payload: {
        name: "New subdivision",
        address: "1 Uncoded Ridge, Nowhere, NC",
        client: { name: "New Lot", type: "residential" },
      },
    });
    expect(job.statusCode, job.body).toBe(201);
    expect(job.json().point).toBeNull();
    expect(job.json().warnings[0]).toContain("could not be geocoded");
    const jobId = job.json().id as string;

    const note = await requireApp().inject({
      method: "POST",
      url: `/jobs/${jobId}/notes`,
      headers: headers(owner.cookie, workspace.id),
      payload: { body: "Call the developer." },
    });
    expect(note.statusCode, note.body).toBe(201);
    const notes = await requireApp().inject({
      method: "GET",
      url: `/jobs/${jobId}/notes`,
      headers: headers(owner.cookie, workspace.id),
    });
    expect(notes.json().notes.map((item: { body: string }) => item.body)).toEqual([
      "Call the developer.",
    ]);

    const task = await requireApp().inject({
      method: "POST",
      url: `/jobs/${jobId}/tasks`,
      headers: headers(owner.cookie, workspace.id),
      payload: { title: "Walk the lot" },
    });
    expect(task.statusCode, task.body).toBe(201);
    expect(task.json().done).toBe(false);

    const file = await requireApp().inject({
      method: "POST",
      url: `/jobs/${jobId}/files`,
      headers: headers(owner.cookie, workspace.id),
      payload: { mime: "image/png", bytes: 12 },
    });
    expect(file.statusCode, file.body).toBe(201);
    expect(file.json().upload.method).toBe("PUT");
    expect(file.json().upload.url).toContain(file.json().file.storage_key);
    expect(file.json().file.download_url).toContain(file.json().file.storage_key);
    expect(file.json().file.status).toBe("pending");
    const files = await requireApp().inject({
      method: "GET",
      url: `/jobs/${jobId}/files`,
      headers: headers(owner.cookie, workspace.id),
    });
    expect(files.json().files).toHaveLength(1);
  });
});
