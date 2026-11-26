import { sql, type Kysely, type Transaction } from "kysely";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";

import { applyStarterPack } from "../catalog/starter.js";
import { allocateJobNumber } from "../crm/data.js";
import type { Database } from "../db/types.js";
import { withWorkspaceContext } from "../db/workspace.js";

/**
 * Idempotent demo workspace. Names and addresses were written for Groundwork.
 * The fixture COG row is inserted by migration 0003. This seed checks that row
 * and places the sample sites inside its footprint. It does not insert imagery
 * and it does not bypass row security. ADR 0022.
 */

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const addressSchema = z.object({
  line1: z.string().trim().min(1),
  city: z.string().trim().min(1),
  region: z.string().trim().min(1),
  postal_code: z.string().trim().min(1),
  country: z.string().trim().min(1),
});

const demoSchema = z.object({
  workspace: z.object({
    id: z.string().regex(UUID_V7),
    name: z.string().trim().min(1),
    slug: z.string().trim().min(1),
    timezone: z.string().trim().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
    units_pref: z.enum(["imperial", "metric"]),
    license_number: z.string().trim().min(1),
    address: addressSchema,
  }),
  member: z.object({
    id: z.string().regex(UUID_V7),
    email: z.email(),
  }),
  clients: z
    .array(
      z.object({
        id: z.string().regex(UUID_V7),
        contact_id: z.string().regex(UUID_V7),
        type: z.enum(["residential", "commercial", "gov", "hoa"]),
        name: z.string().trim().min(1),
        email: z.email(),
        phone: z.string().trim().min(7),
        contact_name: z.string().trim().min(1),
        contact_role: z.string().trim().min(1),
        billing_address: addressSchema,
      }),
    )
    .min(1),
  locations: z
    .array(
      z.object({
        id: z.string().regex(UUID_V7),
        client_id: z.string().regex(UUID_V7),
        address: addressSchema,
        point: z.object({
          lat: z.number(),
          lng: z.number(),
          delta: z.number().positive(),
        }),
        notes: z.string().trim().min(1),
      }),
    )
    .min(1),
  job: z.object({
    id: z.string().regex(UUID_V7),
    client_id: z.string().regex(UUID_V7),
    location_id: z.string().regex(UUID_V7),
    name: z.string().trim().min(1),
  }),
  fixture_capture_id: z.string().regex(UUID_V7),
});

export type DemoData = z.infer<typeof demoSchema>;

export type SeedCounts = {
  workspace: boolean;
  member: boolean;
  clients: number;
  contacts: number;
  locations: number;
  jobs: number;
  catalog: number;
  takeoff: number;
  recipes: number;
};

export type SeedTotals = {
  clients: number;
  contacts: number;
  locations: number;
  jobs: number;
  catalog: number;
  takeoff: number;
  recipes: number;
};

export type SeedResult = {
  workspaceId: string;
  role: string;
  bypassrls: boolean;
  fixtureCaptureId: string;
  counter: string | null;
  created: SeedCounts;
  totals: SeedTotals;
};

type Bounds = { west: number; south: number; east: number; north: number };
type Trx = Transaction<Database>;

export function demoPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../../../db/seed/demo.json");
}

function fixtureBoundsPath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../db/seed/fixtures/rgbir-cog.json",
  );
}

export function loadDemo(): DemoData {
  const demo = demoSchema.parse(JSON.parse(readFileSync(demoPath(), "utf8")));
  const bounds = z
    .object({
      bounds: z.object({
        west: z.number(),
        south: z.number(),
        east: z.number(),
        north: z.number(),
      }),
    })
    .parse(JSON.parse(readFileSync(fixtureBoundsPath(), "utf8"))).bounds;
  assertInsideFixture(demo, bounds);
  return demo;
}

function inside(bounds: Bounds, lng: number, lat: number): boolean {
  return lng > bounds.west && lng < bounds.east && lat > bounds.south && lat < bounds.north;
}

function assertInsideFixture(demo: DemoData, bounds: Bounds): void {
  for (const location of demo.locations) {
    const { lat, lng, delta } = location.point;
    const corners: Array<[number, number]> = [
      [lng, lat],
      [lng - delta, lat - delta],
      [lng + delta, lat - delta],
      [lng + delta, lat + delta],
      [lng - delta, lat + delta],
    ];
    for (const [cornerLng, cornerLat] of corners) {
      if (!inside(bounds, cornerLng, cornerLat)) {
        throw new Error(`Demo location ${location.id} sits outside the fixture COG.`);
      }
    }
  }
}

function square(lng: number, lat: number, delta: number): string {
  const ring = [
    [lng - delta, lat - delta],
    [lng + delta, lat - delta],
    [lng + delta, lat + delta],
    [lng - delta, lat + delta],
    [lng - delta, lat - delta],
  ];
  return JSON.stringify({ type: "Polygon", coordinates: [ring] });
}

async function countOf(
  trx: Trx,
  table:
    "client" | "contact" | "location" | "job" | "catalog_item" | "takeoff_item" | "cost_recipe",
): Promise<number> {
  const result = await sql<{
    n: number;
  }>`select count(*)::int as n from ${sql.table(table)}`.execute(trx);
  return Number(result.rows[0]?.n ?? 0);
}

export async function seedDemo(db: Kysely<Database>): Promise<SeedResult> {
  const demo = loadDemo();
  return withWorkspaceContext(db, demo.workspace.id, async (trx) => {
    const role = await sql<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>`
      select current_user, rolsuper, rolbypassrls
      from pg_roles
      where rolname = current_user
    `.execute(trx);
    const identity = role.rows[0];
    if (
      !identity ||
      identity.current_user !== "groundwork_app" ||
      identity.rolsuper ||
      identity.rolbypassrls
    ) {
      throw new Error(
        `Demo seed must run as groundwork_app without bypassing row security. Connected as ${identity?.current_user ?? "unknown"}.`,
      );
    }

    const capture = await sql<{ id: string }>`
      select id::text as id
      from imagery_capture
      where id = ${demo.fixture_capture_id}::uuid
        and cog_key = 'imagery/fixtures/rgbir-cog.tif'
        and status = 'ready'
    `.execute(trx);
    if (!capture.rows[0]) {
      throw new Error(
        `The fixture COG capture ${demo.fixture_capture_id} is missing. Run pnpm db:migrate. The seed does not insert global imagery.`,
      );
    }

    const created: SeedCounts = {
      workspace: false,
      member: false,
      clients: 0,
      contacts: 0,
      locations: 0,
      jobs: 0,
      catalog: 0,
      takeoff: 0,
      recipes: 0,
    };
    const workspaceId = demo.workspace.id;
    const existingWorkspace = await trx
      .selectFrom("workspace")
      .select("id")
      .where("id", "=", workspaceId)
      .executeTakeFirst();
    if (!existingWorkspace) {
      await trx
        .insertInto("workspace")
        .values({
          id: workspaceId,
          name: demo.workspace.name,
          slug: demo.workspace.slug,
          logo: null,
          metadata: null,
          timezone: demo.workspace.timezone,
          currency: demo.workspace.currency,
          units_pref: demo.workspace.units_pref,
          features: { onboarding_complete: true },
          plan: null,
          address: demo.workspace.address,
          license_number: demo.workspace.license_number,
        })
        .execute();
      created.workspace = true;
    }

    const owner = await trx
      .selectFrom("role")
      .select("id")
      .where("name", "=", "owner")
      .where("is_system", "=", true)
      .where("workspace_id", "is", null)
      .executeTakeFirst();
    if (!owner) {
      throw new Error("The owner system role is not seeded.");
    }
    const memberId = demo.member.id;
    const existingMember = await trx
      .selectFrom("member")
      .select("id")
      .where("id", "=", memberId)
      .executeTakeFirst();
    if (!existingMember) {
      await trx
        .insertInto("member")
        .values({
          id: memberId,
          workspace_id: workspaceId,
          user_id: null,
          role: "owner",
          role_id: owner.id,
          status: "active",
          invite_email: demo.member.email,
        })
        .execute();
      created.member = true;
    }

    for (const client of demo.clients) {
      const found = await trx
        .selectFrom("client")
        .select("id")
        .where("id", "=", client.id)
        .executeTakeFirst();
      if (!found) {
        await trx
          .insertInto("client")
          .values({
            id: client.id,
            workspace_id: workspaceId,
            type: client.type,
            name: client.name,
            billing_address: client.billing_address,
            email: client.email,
            phone: client.phone,
            tags: ["demo"],
            archived_at: null,
            created_by: memberId,
          })
          .execute();
        created.clients += 1;
      }
      const contact = await trx
        .selectFrom("contact")
        .select("id")
        .where("id", "=", client.contact_id)
        .executeTakeFirst();
      if (!contact) {
        await trx
          .insertInto("contact")
          .values({
            id: client.contact_id,
            workspace_id: workspaceId,
            client_id: client.id,
            name: client.contact_name,
            email: client.email,
            phone: client.phone,
            role: client.contact_role,
            is_primary: true,
            created_by: memberId,
          })
          .execute();
        created.contacts += 1;
      }
    }

    for (const location of demo.locations) {
      const found = await trx
        .selectFrom("location")
        .select("id")
        .where("id", "=", location.id)
        .executeTakeFirst();
      if (found) {
        continue;
      }
      const polygon = square(location.point.lng, location.point.lat, location.point.delta);
      await sql`
        insert into location (
          id, workspace_id, client_id, address, point, parcel_cache_id, site_geom, notes, created_by
        ) values (
          ${location.id}::uuid,
          ${workspaceId}::uuid,
          ${location.client_id}::uuid,
          ${JSON.stringify(location.address)}::jsonb,
          ST_SetSRID(ST_MakePoint(${location.point.lng}::float8, ${location.point.lat}::float8), 4326),
          null,
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${polygon}), 4326)),
          ${location.notes},
          ${memberId}::uuid
        )
      `.execute(trx);
      created.locations += 1;
    }

    const existingJob = await trx
      .selectFrom("job")
      .select("id")
      .where("id", "=", demo.job.id)
      .executeTakeFirst();
    if (!existingJob) {
      const number = await allocateJobNumber(trx, workspaceId, memberId);
      await trx
        .insertInto("job")
        .values({
          id: demo.job.id,
          workspace_id: workspaceId,
          number,
          client_id: demo.job.client_id,
          location_id: demo.job.location_id,
          name: demo.job.name,
          stage: "lead",
          bid_value_cents: null,
          owner_member_id: memberId,
          source: "demo-seed",
          lost_reason: null,
          tags: ["demo"],
          created_by: memberId,
        })
        .execute();
      created.jobs += 1;
    }

    const pack = await applyStarterPack(trx, workspaceId, memberId);
    created.catalog = pack.catalog_created.length;
    created.takeoff = pack.takeoff_created.length;
    created.recipes = pack.recipes_created.length;

    const counter = await sql<{ last_value: string }>`
      select last_value::text as last_value
      from counters
      where workspace_id = ${workspaceId}::uuid and prefix = 'J'
    `.execute(trx);

    return {
      workspaceId,
      role: identity.current_user,
      bypassrls: identity.rolbypassrls,
      fixtureCaptureId: demo.fixture_capture_id,
      counter: counter.rows[0]?.last_value ?? null,
      created,
      totals: {
        clients: await countOf(trx, "client"),
        contacts: await countOf(trx, "contact"),
        locations: await countOf(trx, "location"),
        jobs: await countOf(trx, "job"),
        catalog: await countOf(trx, "catalog_item"),
        takeoff: await countOf(trx, "takeoff_item"),
        recipes: await countOf(trx, "cost_recipe"),
      },
    };
  });
}
