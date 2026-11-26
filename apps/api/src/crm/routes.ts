import {
  ForceWonRequiredError,
  IllegalJobTransitionError,
  isJobStage,
  JOB_STAGES,
  LostReasonRequiredError,
  createId,
  transitionJob,
  type JobStage,
} from "@groundwork/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Kysely } from "kysely";
import type pg from "pg";
import { z } from "zod/v4";

import type { Auth } from "../auth/auth.js";
import { requireActiveMember, requireSession, type MemberRow } from "../auth/guard.js";
import { workspaceIdFromHeader } from "../auth/hook.js";
import type { Database } from "../db/types.js";
import { withWorkspaceContext } from "../db/workspace.js";
import { ProblemError } from "../errors.js";
import { parseBBox } from "../imagery/policy.js";
import { presignDownload, presignUpload, workspaceStorageKey } from "../storage/s3.js";
import { crmAccess, jobAccess, type JobAccess, type RecordAccess } from "./access.js";
import {
  activeMember,
  allocateJobNumber,
  archiveClient,
  deleteContact,
  duplicateWarnings,
  getClient,
  getContact,
  getJob,
  getLocation,
  insertClient,
  insertContact,
  insertJob,
  insertJobFile,
  insertLocation,
  insertNote,
  insertTask,
  listClients,
  listContacts,
  listJobActivity,
  listJobFiles,
  listJobs,
  listLocations,
  listNotes,
  listParcelsInBbox,
  listTasks,
  pipelineSummary,
  recordUsage,
  rememberParcels,
  searchWorkspace,
  setJobStage,
  updateClient,
  updateContact,
  updateJob,
  updateLocation,
  type ClientRecord,
  type ContactRecord,
  type JobView,
  type LocationRecord,
} from "./data.js";
import {
  createFixtureGeocoder,
  createFixtureParcelProvider,
  type GeocoderProvider,
  type GeoJsonMultiPolygon,
  type LatLng,
  type ParcelProvider,
} from "./providers.js";

const tenant = { tags: ["tenant-header"] };

const addressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postal_code: z.string().max(32).optional(),
  country: z.string().max(120).optional(),
});

const pointSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});

const clientType = z.enum(["residential", "commercial", "gov", "hoa"]);
const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(20);
const stageSchema = z.enum(JOB_STAGES);

const clientResponse = z.object({
  id: z.string(),
  workspace_id: z.string(),
  type: z.string(),
  name: z.string(),
  billing_address: addressSchema.nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  tags: z.array(z.string()),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const clientCreateResponse = clientResponse.extend({ warnings: z.array(z.string()) });

const contactResponse = z.object({
  id: z.string(),
  client_id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.string().nullable(),
  is_primary: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

const multiPolygon = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(z.array(z.array(z.number())))),
});

const locationResponse = z.object({
  id: z.string(),
  workspace_id: z.string(),
  client_id: z.string().nullable(),
  address: addressSchema,
  point: pointSchema.nullable(),
  parcel_cache_id: z.string().nullable(),
  site_geom: multiPolygon.nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const jobResponse = z.object({
  id: z.string(),
  number: z.string(),
  name: z.string(),
  stage: z.string(),
  client_id: z.string().nullable(),
  client_name: z.string().nullable(),
  location_id: z.string().nullable(),
  location_line1: z.string().nullable(),
  point: pointSchema.nullable(),
  bid_value_cents: z.number().int().nullable(),
  owner_member_id: z.string().nullable(),
  source: z.string().nullable(),
  lost_reason: z.string().nullable(),
  tags: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});

const jobCreateResponse = jobResponse.extend({ warnings: z.array(z.string()) });

const noteResponse = z.object({
  id: z.string(),
  job_id: z.string(),
  body: z.string(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});

const taskResponse = z.object({
  id: z.string(),
  job_id: z.string(),
  title: z.string(),
  done: z.boolean(),
  due_at: z.string().nullable(),
  created_at: z.string(),
});

const fileResponse = z.object({
  id: z.string(),
  file_id: z.string(),
  mime: z.string().nullable(),
  bytes: z.number().int().nullable(),
  status: z.string(),
  storage_key: z.string(),
  created_at: z.string(),
  download_url: z.string(),
});

const idParams = z.object({ id: z.uuidv7() });

type Address = z.infer<typeof addressSchema>;

export type CrmRouteOptions = {
  db: Kysely<Database>;
  authPool: pg.Pool;
  auth: Auth;
  geocoder?: GeocoderProvider;
  parcels?: ParcelProvider;
};

type Tenant = {
  workspaceId: string;
  member: MemberRow;
  crm: RecordAccess;
  jobs: JobAccess;
};

function notFound(detail: string): ProblemError {
  return new ProblemError({ status: 404, title: "Not Found", detail });
}

function forbidden(): ProblemError {
  return new ProblemError({
    status: 403,
    title: "Forbidden",
    detail: "You do not have permission to do that.",
  });
}

function badRequest(detail: string): ProblemError {
  return new ProblemError({ status: 400, title: "Bad Request", detail });
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function cents(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`bid_value_cents ${value} is not a safe integer.`);
  }
  return number;
}

function presentAddress(value: unknown): Address | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = addressSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function presentGeom(value: string | null) {
  if (!value) {
    return null;
  }
  try {
    const parsed = multiPolygon.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function presentClient(row: ClientRecord) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    type: row.type,
    name: row.name,
    billing_address: presentAddress(row.billing_address),
    email: row.email,
    phone: row.phone,
    tags: row.tags ?? [],
    archived_at: row.archived_at ? iso(row.archived_at) : null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function presentContact(row: ContactRecord) {
  return {
    id: row.id,
    client_id: row.client_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    is_primary: row.is_primary,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function presentLocation(row: LocationRecord) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    client_id: row.client_id,
    address: presentAddress(row.address) ?? {},
    point: row.lat === null || row.lng === null ? null : { lat: row.lat, lng: row.lng },
    parcel_cache_id: row.parcel_cache_id,
    site_geom: presentGeom(row.site_geom),
    notes: row.notes,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function presentJob(row: JobView) {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    stage: row.stage,
    client_id: row.client_id,
    client_name: row.client_name,
    location_id: row.location_id,
    location_line1: row.location_line1,
    point: row.lat === null || row.lng === null ? null : { lat: row.lat, lng: row.lng },
    bid_value_cents: cents(row.bid_value_cents),
    owner_member_id: row.owner_member_id,
    source: row.source,
    lost_reason: row.lost_reason,
    tags: row.tags ?? [],
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function addressLine(address: Address | null): string | null {
  if (!address) {
    return null;
  }
  const parts = [address.line1, address.city, address.region, address.postal_code].filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

function guardTransition(input: {
  from: JobStage;
  to: JobStage;
  reason?: string | undefined;
  canForceWon: boolean;
  hasSignedProposal: boolean;
}): JobStage {
  try {
    return transitionJob({
      from: input.from,
      to: input.to,
      reason: input.reason,
      hasSignedProposal: input.hasSignedProposal,
      canForceWon: input.canForceWon,
    });
  } catch (error) {
    if (
      error instanceof IllegalJobTransitionError ||
      error instanceof LostReasonRequiredError ||
      error instanceof ForceWonRequiredError
    ) {
      throw new ProblemError({ status: 409, title: "Conflict", detail: error.message });
    }
    throw error;
  }
}

export async function registerCrmRoutes(
  app: FastifyInstance,
  options: CrmRouteOptions,
): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const geocoder = options.geocoder ?? createFixtureGeocoder();
  const parcels = options.parcels ?? createFixtureParcelProvider();

  async function requireTenant(
    request: FastifyRequest,
    kind: "crm" | "jobs",
    mode: "read" | "write",
  ): Promise<Tenant> {
    const session = await requireSession(options.auth, request.headers);
    const workspaceId = workspaceIdFromHeader(request);
    const member = await requireActiveMember(
      { db: options.db, authPool: options.authPool },
      session.id,
      workspaceId,
    );
    const permissions = await withWorkspaceContext(options.db, workspaceId, async (trx) => {
      const role = await trx
        .selectFrom("role")
        .select("permissions")
        .where("id", "=", member.role_id)
        .executeTakeFirst();
      return role?.permissions ?? [];
    });
    const crm = crmAccess(permissions);
    const jobs = jobAccess(permissions);
    const access = kind === "crm" ? crm : jobs;
    if (mode === "write" ? !access.write : !access.read) {
      throw forbidden();
    }
    return { workspaceId, member, crm, jobs };
  }

  function assignedFor(tenant: Tenant, kind: "crm" | "jobs"): string | null {
    const access = kind === "crm" ? tenant.crm : tenant.jobs;
    return access.assignedOnly ? tenant.member.id : null;
  }

  routes.get(
    "/clients",
    { schema: { ...tenant, response: { 200: z.object({ clients: z.array(clientResponse) }) } } },
    async (request) => {
      const tenant = await requireTenant(request, "crm", "read");
      const clients = await withWorkspaceContext(options.db, tenant.workspaceId, (trx) =>
        listClients(trx, assignedFor(tenant, "crm")),
      );
      return { clients: clients.map(presentClient) };
    },
  );

  routes.post(
    "/clients",
    {
      schema: {
        ...tenant,
        body: z.object({
          type: clientType,
          name: z.string().trim().min(1).max(200),
          billing_address: addressSchema.nullable().optional(),
          email: z.email().max(320).nullable().optional(),
          phone: z.string().trim().max(40).nullable().optional(),
          tags: tagsSchema.optional(),
        }),
        response: { 201: clientCreateResponse },
      },
    },
    async (request, reply) => {
      const tenant = await requireTenant(request, "crm", "write");
      const email = emptyToNull(request.body.email);
      const phone = emptyToNull(request.body.phone);
      const created = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const warnings = await duplicateWarnings(trx, {
          email,
          phone,
          excludeClientId: null,
        });
        const row = await insertClient(trx, {
          workspaceId: tenant.workspaceId,
          memberId: tenant.member.id,
          type: request.body.type,
          name: request.body.name,
          billingAddress: request.body.billing_address ?? null,
          email,
          phone,
          tags: request.body.tags ?? [],
        });
        return { row, warnings };
      });
      return reply.status(201).send({ ...presentClient(created.row), warnings: created.warnings });
    },
  );

  routes.get(
    "/clients/:id",
    { schema: { ...tenant, params: idParams, response: { 200: clientResponse } } },
    async (request) => {
      const tenant = await requireTenant(request, "crm", "read");
      const row = await withWorkspaceContext(options.db, tenant.workspaceId, (trx) =>
        getClient(trx, request.params.id, assignedFor(tenant, "crm")),
      );
      if (!row) {
        throw notFound("That client was not found.");
      }
      return presentClient(row);
    },
  );

  routes.patch(
    "/clients/:id",
    {
      schema: {
        ...tenant,
        params: idParams,
        body: z
          .object({
            type: clientType.optional(),
            name: z.string().trim().min(1).max(200).optional(),
            billing_address: addressSchema.nullable().optional(),
            email: z.email().max(320).nullable().optional(),
            phone: z.string().trim().max(40).nullable().optional(),
            tags: tagsSchema.optional(),
          })
          .refine((body) => Object.values(body).some((value) => value !== undefined), {
            message: "Provide a field to change.",
          }),
        response: { 200: clientResponse },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "crm", "write");
      const row = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const existing = await getClient(trx, request.params.id, null);
        if (!existing) {
          throw notFound("That client was not found.");
        }
        await updateClient(trx, existing.id, {
          ...(request.body.type !== undefined ? { type: request.body.type } : {}),
          ...(request.body.name !== undefined ? { name: request.body.name } : {}),
          ...(request.body.billing_address !== undefined
            ? { billing_address: request.body.billing_address }
            : {}),
          ...(request.body.email !== undefined ? { email: emptyToNull(request.body.email) } : {}),
          ...(request.body.phone !== undefined ? { phone: emptyToNull(request.body.phone) } : {}),
          ...(request.body.tags !== undefined ? { tags: request.body.tags } : {}),
        });
        const next = await getClient(trx, existing.id, null);
        if (!next) {
          throw notFound("That client was not found.");
        }
        return next;
      });
      return presentClient(row);
    },
  );

  routes.delete(
    "/clients/:id",
    { schema: { ...tenant, params: idParams } },
    async (request, reply) => {
      const tenant = await requireTenant(request, "crm", "write");
      await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const existing = await getClient(trx, request.params.id, null);
        if (!existing) {
          throw notFound("That client was not found.");
        }
        await archiveClient(trx, existing.id);
      });
      return reply.status(204).send();
    },
  );

  routes.get(
    "/clients/:id/contacts",
    {
      schema: {
        ...tenant,
        params: idParams,
        response: { 200: z.object({ contacts: z.array(contactResponse) }) },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "crm", "read");
      const contacts = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const client = await getClient(trx, request.params.id, assignedFor(tenant, "crm"));
        if (!client) {
          throw notFound("That client was not found.");
        }
        return listContacts(trx, client.id);
      });
      return { contacts: contacts.map(presentContact) };
    },
  );

  routes.post(
    "/clients/:id/contacts",
    {
      schema: {
        ...tenant,
        params: idParams,
        body: z.object({
          name: z.string().trim().min(1).max(200),
          email: z.email().max(320).nullable().optional(),
          phone: z.string().trim().max(40).nullable().optional(),
          role: z.string().trim().max(80).nullable().optional(),
          is_primary: z.boolean().optional(),
        }),
        response: { 201: contactResponse.extend({ warnings: z.array(z.string()) }) },
      },
    },
    async (request, reply) => {
      const tenant = await requireTenant(request, "crm", "write");
      const email = emptyToNull(request.body.email);
      const phone = emptyToNull(request.body.phone);
      const created = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const client = await getClient(trx, request.params.id, null);
        if (!client) {
          throw notFound("That client was not found.");
        }
        const warnings = await duplicateWarnings(trx, {
          email,
          phone,
          excludeClientId: client.id,
        });
        const row = await insertContact(trx, {
          workspaceId: tenant.workspaceId,
          memberId: tenant.member.id,
          clientId: client.id,
          name: request.body.name,
          email,
          phone,
          role: emptyToNull(request.body.role),
          isPrimary: request.body.is_primary ?? false,
        });
        return { row, warnings };
      });
      return reply.status(201).send({ ...presentContact(created.row), warnings: created.warnings });
    },
  );

  routes.patch(
    "/contacts/:id",
    {
      schema: {
        ...tenant,
        params: idParams,
        body: z
          .object({
            name: z.string().trim().min(1).max(200).optional(),
            email: z.email().max(320).nullable().optional(),
            phone: z.string().trim().max(40).nullable().optional(),
            role: z.string().trim().max(80).nullable().optional(),
            is_primary: z.boolean().optional(),
          })
          .refine((body) => Object.values(body).some((value) => value !== undefined), {
            message: "Provide a field to change.",
          }),
        response: { 200: contactResponse },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "crm", "write");
      const row = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const existing = await getContact(trx, request.params.id);
        if (!existing) {
          throw notFound("That contact was not found.");
        }
        await updateContact(trx, existing.id, existing.client_id, {
          ...(request.body.name !== undefined ? { name: request.body.name } : {}),
          ...(request.body.email !== undefined ? { email: emptyToNull(request.body.email) } : {}),
          ...(request.body.phone !== undefined ? { phone: emptyToNull(request.body.phone) } : {}),
          ...(request.body.role !== undefined ? { role: emptyToNull(request.body.role) } : {}),
          ...(request.body.is_primary !== undefined ? { is_primary: request.body.is_primary } : {}),
        });
        const next = await getContact(trx, existing.id);
        if (!next) {
          throw notFound("That contact was not found.");
        }
        return next;
      });
      return presentContact(row);
    },
  );

  routes.delete(
    "/contacts/:id",
    { schema: { ...tenant, params: idParams } },
    async (request, reply) => {
      const tenant = await requireTenant(request, "crm", "write");
      await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const existing = await getContact(trx, request.params.id);
        if (!existing) {
          throw notFound("That contact was not found.");
        }
        await deleteContact(trx, existing.id);
      });
      return reply.status(204).send();
    },
  );

  routes.get(
    "/locations",
    {
      schema: { ...tenant, response: { 200: z.object({ locations: z.array(locationResponse) }) } },
    },
    async (request) => {
      const tenant = await requireTenant(request, "crm", "read");
      const locations = await withWorkspaceContext(options.db, tenant.workspaceId, (trx) =>
        listLocations(trx, assignedFor(tenant, "crm")),
      );
      return { locations: locations.map(presentLocation) };
    },
  );

  routes.post(
    "/locations",
    {
      schema: {
        ...tenant,
        body: z.object({
          client_id: z.uuidv7(),
          address: addressSchema,
          point: pointSchema.nullable().optional(),
          notes: z.string().trim().max(4000).nullable().optional(),
        }),
        response: { 201: locationResponse },
      },
    },
    async (request, reply) => {
      const tenant = await requireTenant(request, "crm", "write");
      const row = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const client = await getClient(trx, request.body.client_id, null);
        if (!client) {
          throw notFound("That client was not found.");
        }
        return insertLocation(trx, {
          workspaceId: tenant.workspaceId,
          memberId: tenant.member.id,
          clientId: client.id,
          address: request.body.address,
          lat: request.body.point?.lat ?? null,
          lng: request.body.point?.lng ?? null,
          parcelCacheId: null,
          siteGeom: null,
          notes: emptyToNull(request.body.notes),
        });
      });
      return reply.status(201).send(presentLocation(row));
    },
  );

  routes.get(
    "/locations/:id",
    { schema: { ...tenant, params: idParams, response: { 200: locationResponse } } },
    async (request) => {
      const tenant = await requireTenant(request, "crm", "read");
      const row = await withWorkspaceContext(options.db, tenant.workspaceId, (trx) =>
        getLocation(trx, request.params.id, assignedFor(tenant, "crm")),
      );
      if (!row) {
        throw notFound("That location was not found.");
      }
      return presentLocation(row);
    },
  );

  routes.get(
    "/locations/:id/parcels",
    {
      schema: {
        ...tenant,
        params: idParams,
        querystring: z.object({ bbox: z.string().optional() }),
        response: {
          200: z.object({
            parcels: z.array(
              z.object({
                id: z.string(),
                provider: z.string(),
                provider_parcel_id: z.string(),
                geom: multiPolygon,
                attrs: z.record(z.string(), z.unknown()),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "crm", "read");
      const raw = request.query.bbox;
      if (raw === undefined || raw.trim() === "") {
        throw badRequest("bbox must be west,south,east,north.");
      }
      const bbox = parseBBox(raw);
      const parcels = await withWorkspaceContext(options.db, tenant.workspaceId, (trx) =>
        listParcelsInBbox(trx, request.params.id, assignedFor(tenant, "crm"), bbox),
      );
      if (!parcels) {
        throw notFound("That location was not found.");
      }
      return { parcels };
    },
  );

  routes.patch(
    "/locations/:id",
    {
      schema: {
        ...tenant,
        params: idParams,
        body: z
          .object({
            client_id: z.uuidv7().nullable().optional(),
            address: addressSchema.optional(),
            point: pointSchema.nullable().optional(),
            notes: z.string().trim().max(4000).nullable().optional(),
          })
          .refine((body) => Object.values(body).some((value) => value !== undefined), {
            message: "Provide a field to change.",
          }),
        response: { 200: locationResponse },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "crm", "write");
      const row = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const existing = await getLocation(trx, request.params.id, null);
        if (!existing) {
          throw notFound("That location was not found.");
        }
        if (request.body.client_id) {
          const client = await getClient(trx, request.body.client_id, null);
          if (!client) {
            throw notFound("That client was not found.");
          }
        }
        await updateLocation(trx, existing.id, {
          ...(request.body.client_id !== undefined ? { clientId: request.body.client_id } : {}),
          ...(request.body.address !== undefined ? { address: request.body.address } : {}),
          ...(request.body.point !== undefined
            ? { lat: request.body.point?.lat ?? null, lng: request.body.point?.lng ?? null }
            : {}),
          ...(request.body.notes !== undefined ? { notes: emptyToNull(request.body.notes) } : {}),
        });
        const next = await getLocation(trx, existing.id, null);
        if (!next) {
          throw notFound("That location was not found.");
        }
        return next;
      });
      return presentLocation(row);
    },
  );

  routes.post(
    "/locations/resolve",
    {
      schema: {
        ...tenant,
        body: z
          .object({
            address: z.string().trim().min(1).max(300).optional(),
            lat: z.number().gte(-90).lte(90).optional(),
            lng: z.number().gte(-180).lte(180).optional(),
          })
          .refine(
            (body) => Boolean(body.address) || (body.lat !== undefined && body.lng !== undefined),
            { message: "Provide an address or both lat and lng." },
          ),
        response: {
          200: z.object({
            point: pointSchema.nullable(),
            formatted: z.string().nullable(),
            address: addressSchema.nullable(),
            parcels: z.array(
              z.object({
                id: z.string(),
                provider: z.string(),
                provider_parcel_id: z.string(),
                geom: multiPolygon,
                attrs: z.record(z.string(), z.unknown()),
              }),
            ),
            warnings: z.array(z.string()),
          }),
        },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "crm", "read");
      const query =
        request.body.address !== undefined
          ? { address: request.body.address }
          : { point: { lat: request.body.lat ?? 0, lng: request.body.lng ?? 0 } };
      const hit = await geocoder.geocode(query);
      return withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        await recordUsage(trx, tenant.workspaceId, "geocode");
        if (!hit) {
          return {
            point: null,
            formatted: null,
            address: null,
            parcels: [],
            warnings: ["Address could not be geocoded. Drop a pin to set the site."],
          };
        }
        const found = await rememberParcels(trx, tenant.workspaceId, parcels, hit.point);
        return {
          point: hit.point,
          formatted: hit.formatted,
          address: hit.address,
          parcels: found,
          warnings: [],
        };
      });
    },
  );

  const jobQuery = z.object({
    stage: stageSchema.optional(),
    owner: z.uuidv7().optional(),
    q: z.string().trim().min(1).max(200).optional(),
    updatedSince: z.string().optional(),
    tag: z.string().trim().min(1).max(40).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  });

  routes.get(
    "/jobs",
    {
      schema: {
        ...tenant,
        querystring: jobQuery,
        response: { 200: z.object({ jobs: z.array(jobResponse) }) },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "jobs", "read");
      if (
        request.query.updatedSince !== undefined &&
        Number.isNaN(Date.parse(request.query.updatedSince))
      ) {
        throw badRequest("updatedSince must be a date.");
      }
      const jobs = await withWorkspaceContext(options.db, tenant.workspaceId, (trx) =>
        listJobs(trx, {
          assigned: assignedFor(tenant, "jobs"),
          stage: request.query.stage ?? null,
          owner: request.query.owner ?? null,
          q: request.query.q ?? null,
          updatedSince: request.query.updatedSince ?? null,
          tag: request.query.tag ?? null,
          limit: request.query.limit ?? 50,
        }),
      );
      return { jobs: jobs.map(presentJob) };
    },
  );

  routes.post(
    "/jobs",
    {
      schema: {
        ...tenant,
        body: z.object({
          name: z.string().trim().min(1).max(200).optional(),
          client_id: z.uuidv7().optional(),
          client: z
            .object({
              type: clientType,
              name: z.string().trim().min(1).max(200),
              email: z.email().max(320).nullable().optional(),
              phone: z.string().trim().max(40).nullable().optional(),
            })
            .optional(),
          location_id: z.uuidv7().optional(),
          address: z.string().trim().min(1).max(300).optional(),
          point: pointSchema.optional(),
          location: z
            .object({
              address: addressSchema.optional(),
              point: pointSchema.nullable().optional(),
              notes: z.string().trim().max(4000).nullable().optional(),
            })
            .optional(),
          bid_value_cents: z.number().int().nonnegative().max(9_000_000_000_000).optional(),
          owner_member_id: z.uuidv7().optional(),
          source: z.string().trim().max(80).nullable().optional(),
          tags: tagsSchema.optional(),
        }),
        response: { 201: jobCreateResponse },
      },
    },
    async (request, reply) => {
      const tenant = await requireTenant(request, "jobs", "write");
      const body = request.body;
      if (!body.client_id && !body.client) {
        throw badRequest("A client is required.");
      }
      const createsSite = Boolean(body.address || body.point || body.location);
      if ((body.client || createsSite) && !tenant.crm.write) {
        throw forbidden();
      }
      const created = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const warnings: string[] = [];
        let clientId: string;
        if (body.client_id) {
          const existing = await getClient(trx, body.client_id, null);
          if (!existing) {
            throw notFound("That client was not found.");
          }
          clientId = existing.id;
        } else if (body.client) {
          const email = emptyToNull(body.client.email);
          const phone = emptyToNull(body.client.phone);
          warnings.push(...(await duplicateWarnings(trx, { email, phone, excludeClientId: null })));
          const client = await insertClient(trx, {
            workspaceId: tenant.workspaceId,
            memberId: tenant.member.id,
            type: body.client.type,
            name: body.client.name,
            billingAddress: null,
            email,
            phone,
            tags: [],
          });
          clientId = client.id;
        } else {
          throw badRequest("A client is required.");
        }

        let locationId: string | null = null;
        let label: string | null = null;
        if (body.location_id) {
          const existing = await getLocation(trx, body.location_id, null);
          if (!existing) {
            throw notFound("That location was not found.");
          }
          locationId = existing.id;
          label = presentAddress(existing.address)?.line1 ?? null;
        } else if (createsSite) {
          const placed = await placeSite(trx, {
            workspaceId: tenant.workspaceId,
            memberId: tenant.member.id,
            clientId,
            addressText: body.address,
            address: body.location?.address,
            point: body.point ?? body.location?.point ?? null,
            notes: emptyToNull(body.location?.notes),
            geocoder,
            parcels,
          });
          locationId = placed.location.id;
          label = placed.label;
          warnings.push(...placed.warnings);
        }

        const owner = body.owner_member_id ?? tenant.member.id;
        if (!(await activeMember(trx, owner))) {
          throw badRequest("owner_member_id must be an active member of this workspace.");
        }
        const number = await allocateJobNumber(trx, tenant.workspaceId, tenant.member.id);
        const job = await insertJob(trx, {
          workspaceId: tenant.workspaceId,
          memberId: tenant.member.id,
          number,
          clientId,
          locationId,
          name: body.name ?? label ?? "Job",
          bidValueCents: body.bid_value_cents ?? null,
          ownerMemberId: owner,
          source: emptyToNull(body.source),
          tags: body.tags ?? [],
        });
        return { job, warnings };
      });
      return reply.status(201).send({ ...presentJob(created.job), warnings: created.warnings });
    },
  );

  routes.get(
    "/jobs/:id",
    { schema: { ...tenant, params: idParams, response: { 200: jobResponse } } },
    async (request) => {
      const tenant = await requireTenant(request, "jobs", "read");
      const row = await withWorkspaceContext(options.db, tenant.workspaceId, (trx) =>
        getJob(trx, request.params.id, assignedFor(tenant, "jobs")),
      );
      if (!row) {
        throw notFound("That job was not found.");
      }
      return presentJob(row);
    },
  );

  routes.patch(
    "/jobs/:id",
    {
      schema: {
        ...tenant,
        params: idParams,
        body: z
          .object({
            name: z.string().trim().min(1).max(200).optional(),
            client_id: z.uuidv7().nullable().optional(),
            location_id: z.uuidv7().nullable().optional(),
            bid_value_cents: z
              .number()
              .int()
              .nonnegative()
              .max(9_000_000_000_000)
              .nullable()
              .optional(),
            owner_member_id: z.uuidv7().optional(),
            source: z.string().trim().max(80).nullable().optional(),
            tags: tagsSchema.optional(),
          })
          .refine((body) => Object.values(body).some((value) => value !== undefined), {
            message: "Provide a field to change.",
          }),
        response: { 200: jobResponse },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "jobs", "write");
      const row = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const existing = await getJob(trx, request.params.id, null);
        if (!existing) {
          throw notFound("That job was not found.");
        }
        if (request.body.client_id) {
          const client = await getClient(trx, request.body.client_id, null);
          if (!client) {
            throw notFound("That client was not found.");
          }
        }
        if (request.body.location_id) {
          const location = await getLocation(trx, request.body.location_id, null);
          if (!location) {
            throw notFound("That location was not found.");
          }
        }
        if (
          request.body.owner_member_id &&
          !(await activeMember(trx, request.body.owner_member_id))
        ) {
          throw badRequest("owner_member_id must be an active member of this workspace.");
        }
        await updateJob(trx, existing.id, {
          ...(request.body.name !== undefined ? { name: request.body.name } : {}),
          ...(request.body.client_id !== undefined ? { client_id: request.body.client_id } : {}),
          ...(request.body.location_id !== undefined
            ? { location_id: request.body.location_id }
            : {}),
          ...(request.body.bid_value_cents !== undefined
            ? { bid_value_cents: request.body.bid_value_cents }
            : {}),
          ...(request.body.owner_member_id !== undefined
            ? { owner_member_id: request.body.owner_member_id }
            : {}),
          ...(request.body.source !== undefined
            ? { source: emptyToNull(request.body.source) }
            : {}),
          ...(request.body.tags !== undefined ? { tags: request.body.tags } : {}),
        });
        const next = await getJob(trx, existing.id, null);
        if (!next) {
          throw notFound("That job was not found.");
        }
        return next;
      });
      return presentJob(row);
    },
  );

  routes.post(
    "/jobs/:id/transition",
    {
      schema: {
        ...tenant,
        tags: ["tenant-header", "state-machine"],
        params: idParams,
        body: z.object({
          to: stageSchema,
          reason: z.string().trim().max(500).optional(),
        }),
        response: { 200: jobResponse },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "jobs", "write");
      const row = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const existing = await getJob(trx, request.params.id, null);
        if (!existing) {
          throw notFound("That job was not found.");
        }
        if (!isJobStage(existing.stage)) {
          throw new Error(
            `Job ${existing.id} has stage ${existing.stage}, which is not in the machine.`,
          );
        }
        const signed = await trx
          .selectFrom("proposal")
          .innerJoin("estimate", "estimate.id", "proposal.estimate_id")
          .select("proposal.id")
          .where("estimate.job_id", "=", existing.id)
          .where("proposal.status", "=", "signed")
          .executeTakeFirst();
        const next = guardTransition({
          from: existing.stage,
          to: request.body.to,
          reason: request.body.reason,
          canForceWon: tenant.jobs.forceWon,
          hasSignedProposal: signed !== undefined,
        });
        const reason = request.body.reason?.trim() ? request.body.reason.trim() : null;
        await setJobStage(trx, {
          workspaceId: tenant.workspaceId,
          jobId: existing.id,
          memberId: tenant.member.id,
          from: existing.stage,
          to: next,
          reason,
          forced: next === "won",
        });
        const updated = await getJob(trx, existing.id, null);
        if (!updated) {
          throw notFound("That job was not found.");
        }
        return updated;
      });
      return presentJob(row);
    },
  );

  routes.get(
    "/jobs/:id/notes",
    {
      schema: {
        ...tenant,
        params: idParams,
        response: { 200: z.object({ notes: z.array(noteResponse) }) },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "jobs", "read");
      const notes = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const job = await getJob(trx, request.params.id, assignedFor(tenant, "jobs"));
        if (!job) {
          throw notFound("That job was not found.");
        }
        return listNotes(trx, job.id);
      });
      return {
        notes: notes.map((note) => ({
          id: note.id,
          job_id: note.job_id,
          body: note.body,
          created_by: note.created_by,
          created_at: iso(note.created_at),
        })),
      };
    },
  );

  routes.post(
    "/jobs/:id/notes",
    {
      schema: {
        ...tenant,
        params: idParams,
        body: z.object({ body: z.string().trim().min(1).max(8000) }),
        response: { 201: noteResponse },
      },
    },
    async (request, reply) => {
      const tenant = await requireTenant(request, "jobs", "write");
      const note = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const job = await getJob(trx, request.params.id, null);
        if (!job) {
          throw notFound("That job was not found.");
        }
        return insertNote(trx, {
          workspaceId: tenant.workspaceId,
          jobId: job.id,
          memberId: tenant.member.id,
          body: request.body.body,
        });
      });
      return reply.status(201).send({
        id: note.id,
        job_id: note.job_id,
        body: note.body,
        created_by: note.created_by,
        created_at: iso(note.created_at),
      });
    },
  );

  routes.get(
    "/jobs/:id/tasks",
    {
      schema: {
        ...tenant,
        params: idParams,
        response: { 200: z.object({ tasks: z.array(taskResponse) }) },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "jobs", "read");
      const tasks = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const job = await getJob(trx, request.params.id, assignedFor(tenant, "jobs"));
        if (!job) {
          throw notFound("That job was not found.");
        }
        return listTasks(trx, job.id);
      });
      return {
        tasks: tasks.map((task) => ({
          id: task.id,
          job_id: task.job_id,
          title: task.title,
          done: task.done,
          due_at: task.due_at ? iso(task.due_at) : null,
          created_at: iso(task.created_at),
        })),
      };
    },
  );

  routes.post(
    "/jobs/:id/tasks",
    {
      schema: {
        ...tenant,
        params: idParams,
        body: z.object({
          title: z.string().trim().min(1).max(200),
          due_at: z.string().nullable().optional(),
        }),
        response: { 201: taskResponse },
      },
    },
    async (request, reply) => {
      const tenant = await requireTenant(request, "jobs", "write");
      let dueAt: Date | null = null;
      if (request.body.due_at) {
        const parsed = new Date(request.body.due_at);
        if (Number.isNaN(parsed.getTime())) {
          throw badRequest("due_at must be a date.");
        }
        dueAt = parsed;
      }
      const task = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const job = await getJob(trx, request.params.id, null);
        if (!job) {
          throw notFound("That job was not found.");
        }
        return insertTask(trx, {
          workspaceId: tenant.workspaceId,
          jobId: job.id,
          memberId: tenant.member.id,
          title: request.body.title,
          dueAt,
        });
      });
      return reply.status(201).send({
        id: task.id,
        job_id: task.job_id,
        title: task.title,
        done: task.done,
        due_at: task.due_at ? iso(task.due_at) : null,
        created_at: iso(task.created_at),
      });
    },
  );

  routes.get(
    "/jobs/:id/files",
    {
      schema: {
        ...tenant,
        params: idParams,
        response: { 200: z.object({ files: z.array(fileResponse) }) },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "jobs", "read");
      const files = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const job = await getJob(trx, request.params.id, assignedFor(tenant, "jobs"));
        if (!job) {
          throw notFound("That job was not found.");
        }
        return listJobFiles(trx, job.id);
      });
      return { files: await Promise.all(files.map((file) => withDownload(file))) };
    },
  );

  routes.post(
    "/jobs/:id/files",
    {
      schema: {
        ...tenant,
        params: idParams,
        body: z.object({
          mime: z.string().trim().min(1).max(200),
          bytes: z.number().int().positive().max(50_000_000).optional(),
        }),
        response: {
          201: z.object({
            file: fileResponse,
            upload: z.object({
              url: z.string(),
              method: z.literal("PUT"),
              headers: z.object({ "content-type": z.string() }),
              expires_in_seconds: z.number().int(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const tenant = await requireTenant(request, "jobs", "write");
      const fileId = createId();
      const storageKey = workspaceStorageKey(tenant.workspaceId, fileId);
      const saved = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const job = await getJob(trx, request.params.id, null);
        if (!job) {
          throw notFound("That job was not found.");
        }
        const file = await insertJobFile(trx, {
          workspaceId: tenant.workspaceId,
          jobId: job.id,
          memberId: tenant.member.id,
          fileId,
          storageKey,
          mime: request.body.mime,
          bytes: request.body.bytes ?? null,
        });
        const upload = await presignUpload({ storageKey, mime: request.body.mime });
        const download = await presignDownload({ storageKey });
        return { file, upload, downloadUrl: download.url };
      });
      return reply.status(201).send({
        file: { ...presentFile(saved.file), download_url: saved.downloadUrl },
        upload: {
          url: saved.upload.url,
          method: saved.upload.method,
          headers: saved.upload.headers,
          expires_in_seconds: saved.upload.expiresInSeconds,
        },
      });
    },
  );

  routes.get(
    "/jobs/:id/activity",
    {
      schema: {
        ...tenant,
        params: idParams,
        response: {
          200: z.object({
            events: z.array(
              z.object({
                id: z.string(),
                actor_member_id: z.string().nullable(),
                action: z.string().nullable(),
                at: z.string().nullable(),
                diff: z
                  .object({
                    from: z.string().nullable(),
                    to: z.string().nullable(),
                    reason: z.string().nullable(),
                    forced: z.boolean(),
                  })
                  .nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "jobs", "read");
      const events = await withWorkspaceContext(options.db, tenant.workspaceId, async (trx) => {
        const job = await getJob(trx, request.params.id, assignedFor(tenant, "jobs"));
        if (!job) {
          throw notFound("That job was not found.");
        }
        return listJobActivity(trx, job.id);
      });
      return {
        events: events.map((event) => ({
          id: event.id,
          actor_member_id: event.actor_member_id,
          action: event.action,
          at: event.at ? iso(event.at) : null,
          diff: presentDiff(event.diff),
        })),
      };
    },
  );

  routes.get(
    "/search",
    {
      schema: {
        ...tenant,
        querystring: z.object({ q: z.string().trim().min(1).max(200) }),
        response: {
          200: z.object({
            clients: z.array(clientResponse),
            contacts: z.array(contactResponse),
            jobs: z.array(jobResponse),
            locations: z.array(locationResponse),
          }),
        },
      },
    },
    async (request) => {
      const session = await requireSession(options.auth, request.headers);
      const workspaceId = workspaceIdFromHeader(request);
      const member = await requireActiveMember(
        { db: options.db, authPool: options.authPool },
        session.id,
        workspaceId,
      );
      const permissions = await withWorkspaceContext(options.db, workspaceId, async (trx) => {
        const role = await trx
          .selectFrom("role")
          .select("permissions")
          .where("id", "=", member.role_id)
          .executeTakeFirst();
        return role?.permissions ?? [];
      });
      const crm = crmAccess(permissions);
      const jobs = jobAccess(permissions);
      if (!crm.read && !jobs.read) {
        throw forbidden();
      }
      const assigned = crm.assignedOnly || jobs.assignedOnly ? member.id : null;
      const found = await withWorkspaceContext(options.db, workspaceId, (trx) =>
        searchWorkspace(trx, {
          q: request.query.q,
          assigned,
          includeCrm: crm.read,
          includeJobs: jobs.read,
        }),
      );
      return {
        clients: found.clients.map(presentClient),
        contacts: found.contacts.map(presentContact),
        jobs: found.jobs.map(presentJob),
        locations: found.locations.map(presentLocation),
      };
    },
  );

  routes.get(
    "/pipeline/summary",
    {
      schema: {
        ...tenant,
        response: {
          200: z.object({
            stages: z.array(
              z.object({
                stage: z.string(),
                count: z.number().int(),
                bid_value_cents: z.number().int(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const tenant = await requireTenant(request, "jobs", "read");
      const stages = await withWorkspaceContext(options.db, tenant.workspaceId, (trx) =>
        pipelineSummary(trx, assignedFor(tenant, "jobs")),
      );
      return { stages };
    },
  );
}

function presentDiff(value: unknown): {
  from: string | null;
  to: string | null;
  reason: string | null;
  forced: boolean;
} | null {
  if (value === null || value === undefined || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  return {
    from: typeof row.from === "string" ? row.from : null,
    to: typeof row.to === "string" ? row.to : null,
    reason: typeof row.reason === "string" ? row.reason : null,
    forced: row.forced === true,
  };
}

async function withDownload(row: Parameters<typeof presentFile>[0]) {
  const download = await presignDownload({ storageKey: row.storage_key });
  return { ...presentFile(row), download_url: download.url };
}

function presentFile(row: {
  id: string;
  file_id: string;
  mime: string | null;
  bytes: string | null;
  status: string;
  storage_key: string;
  created_at: Date;
}) {
  return {
    id: row.id,
    file_id: row.file_id,
    mime: row.mime,
    bytes: row.bytes === null ? null : Number(row.bytes),
    status: row.status,
    storage_key: row.storage_key,
    created_at: iso(row.created_at),
  };
}

async function placeSite(
  trx: Parameters<typeof insertLocation>[0],
  input: {
    workspaceId: string;
    memberId: string;
    clientId: string;
    addressText?: string | undefined;
    address?: Address | undefined;
    point?: LatLng | null | undefined;
    notes: string | null;
    geocoder: GeocoderProvider;
    parcels: ParcelProvider;
  },
): Promise<{ location: LocationRecord; warnings: string[]; label: string | null }> {
  const warnings: string[] = [];
  let address: Address | null = input.address ?? null;
  let point = input.point ?? null;
  const text = input.addressText ?? addressLine(address);
  if (text && !point) {
    await recordUsage(trx, input.workspaceId, "geocode");
    const hit = await input.geocoder.geocode({ address: text });
    if (hit) {
      point = hit.point;
      address = { ...hit.address, ...stripEmpty(address) };
    } else {
      warnings.push("Address could not be geocoded. Drop a pin to set the site.");
      address = address ?? { line1: text };
    }
  } else if (point && !address) {
    if (text) {
      address = { line1: text };
    } else {
      await recordUsage(trx, input.workspaceId, "geocode");
      const hit = await input.geocoder.geocode({ point });
      address = hit?.address ?? { line1: "Dropped pin" };
    }
  }
  let parcelCacheId: string | null = null;
  let siteGeom: GeoJsonMultiPolygon | null = null;
  if (point) {
    const found = await rememberParcels(trx, input.workspaceId, input.parcels, point);
    const first = found[0];
    if (first) {
      parcelCacheId = first.id;
      siteGeom = first.geom;
    }
  }
  const location = await insertLocation(trx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    clientId: input.clientId,
    address: address ?? { line1: "Site" },
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    parcelCacheId,
    siteGeom,
    notes: input.notes,
  });
  return { location, warnings, label: address?.line1 ?? null };
}

function stripEmpty(address: Address | null): Address {
  if (!address) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(address).filter(([, value]) => value !== undefined && value !== ""),
  );
}
