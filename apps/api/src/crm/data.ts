import { createId, formatHumanNumber, JOB_STAGES } from "@groundwork/shared";
import { sql, type Transaction } from "kysely";

import type { Database } from "../db/types.js";
import { likeContains, phoneDigits, searchMode, type SearchMode } from "./query.js";
import type { GeoJsonMultiPolygon, LatLng, ParcelProvider } from "./providers.js";

type Db = Transaction<Database>;

export type ClientRecord = {
  id: string;
  workspace_id: string;
  type: string;
  name: string;
  billing_address: unknown;
  email: string | null;
  phone: string | null;
  tags: string[] | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type ContactRecord = {
  id: string;
  client_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  is_primary: boolean;
  created_at: Date;
  updated_at: Date;
};

export type LocationRecord = {
  id: string;
  workspace_id: string;
  client_id: string | null;
  address: unknown;
  lat: number | null;
  lng: number | null;
  parcel_cache_id: string | null;
  site_geom: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

export type JobView = {
  id: string;
  number: string;
  name: string;
  stage: string;
  client_id: string | null;
  client_name: string | null;
  location_id: string | null;
  location_line1: string | null;
  lat: number | null;
  lng: number | null;
  bid_value_cents: string | null;
  owner_member_id: string | null;
  source: string | null;
  lost_reason: string | null;
  tags: string[] | null;
  created_at: Date;
  updated_at: Date;
};

export type SavedParcel = {
  id: string;
  provider: string;
  provider_parcel_id: string;
  geom: GeoJsonMultiPolygon;
  attrs: Record<string, unknown>;
};

const clientColumns = sql`
  id::text as id,
  workspace_id::text as workspace_id,
  type,
  name,
  billing_address,
  email::text as email,
  phone,
  tags,
  archived_at,
  created_at,
  updated_at
`;

function assignedClient(column: "id" | "client_id", assigned: string | null) {
  const col = column === "id" ? sql`id` : sql`client_id`;
  return sql`(
    ${assigned}::uuid is null
    or ${col} in (
      select client_id from job
      where owner_member_id = ${assigned}::uuid and client_id is not null
    )
  )`;
}

export async function listClients(trx: Db, assigned: string | null): Promise<ClientRecord[]> {
  const result = await sql<ClientRecord>`
    select ${clientColumns}
    from client
    where archived_at is null and ${assignedClient("id", assigned)}
    order by name
    limit 200
  `.execute(trx);
  return result.rows;
}

export async function getClient(
  trx: Db,
  id: string,
  assigned: string | null,
): Promise<ClientRecord | undefined> {
  const result = await sql<ClientRecord>`
    select ${clientColumns}
    from client
    where id = ${id}::uuid
      and archived_at is null
      and ${assignedClient("id", assigned)}
  `.execute(trx);
  return result.rows[0];
}

export async function duplicateWarnings(
  trx: Db,
  input: { email: string | null; phone: string | null; excludeClientId: string | null },
): Promise<string[]> {
  const warnings: string[] = [];
  const digits = input.phone ? phoneDigits(input.phone) : "";
  if (input.email) {
    const hit = await sql`
      select 1 from client
      where archived_at is null
        and email = ${input.email}
        and (${input.excludeClientId}::uuid is null or id <> ${input.excludeClientId}::uuid)
      union all
      select 1 from contact
      where email = ${input.email}
        and (${input.excludeClientId}::uuid is null or client_id <> ${input.excludeClientId}::uuid)
      limit 1
    `.execute(trx);
    if (hit.rows.length > 0) {
      warnings.push("A client with this email already exists.");
    }
  }
  if (digits.length >= 7) {
    const hit = await sql`
      select 1 from client
      where archived_at is null
        and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${digits}
        and (${input.excludeClientId}::uuid is null or id <> ${input.excludeClientId}::uuid)
      union all
      select 1 from contact
      where regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${digits}
        and (${input.excludeClientId}::uuid is null or client_id <> ${input.excludeClientId}::uuid)
      limit 1
    `.execute(trx);
    if (hit.rows.length > 0) {
      warnings.push("A client with this phone already exists.");
    }
  }
  return warnings;
}

export async function insertClient(
  trx: Db,
  input: {
    workspaceId: string;
    memberId: string;
    type: string;
    name: string;
    billingAddress: unknown | null;
    email: string | null;
    phone: string | null;
    tags: string[];
  },
): Promise<ClientRecord> {
  const id = createId();
  await trx
    .insertInto("client")
    .values({
      id,
      workspace_id: input.workspaceId,
      type: input.type,
      name: input.name,
      billing_address: input.billingAddress,
      email: input.email,
      phone: input.phone,
      tags: input.tags,
      archived_at: null,
      created_by: input.memberId,
    })
    .execute();
  const row = await getClient(trx, id, null);
  if (!row) {
    throw new Error("Inserting a client did not return a row.");
  }
  return row;
}

export async function updateClient(
  trx: Db,
  id: string,
  patch: {
    type?: string;
    name?: string;
    billing_address?: unknown | null;
    email?: string | null;
    phone?: string | null;
    tags?: string[];
  },
): Promise<void> {
  if (Object.keys(patch).length === 0) {
    return;
  }
  await trx.updateTable("client").set(patch).where("id", "=", id).execute();
}

export async function archiveClient(trx: Db, id: string): Promise<void> {
  await trx.updateTable("client").set({ archived_at: new Date() }).where("id", "=", id).execute();
}

export async function listContacts(trx: Db, clientId: string): Promise<ContactRecord[]> {
  const result = await sql<ContactRecord>`
    select
      id::text as id,
      client_id::text as client_id,
      name,
      email::text as email,
      phone,
      role,
      is_primary,
      created_at,
      updated_at
    from contact
    where client_id = ${clientId}::uuid
    order by is_primary desc, name
  `.execute(trx);
  return result.rows;
}

export async function getContact(trx: Db, id: string): Promise<ContactRecord | undefined> {
  const result = await sql<ContactRecord>`
    select
      id::text as id,
      client_id::text as client_id,
      name,
      email::text as email,
      phone,
      role,
      is_primary,
      created_at,
      updated_at
    from contact
    where id = ${id}::uuid
  `.execute(trx);
  return result.rows[0];
}

async function clearPrimary(trx: Db, clientId: string): Promise<void> {
  await trx
    .updateTable("contact")
    .set({ is_primary: false })
    .where("client_id", "=", clientId)
    .where("is_primary", "=", true)
    .execute();
}

export async function insertContact(
  trx: Db,
  input: {
    workspaceId: string;
    memberId: string;
    clientId: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
    isPrimary: boolean;
  },
): Promise<ContactRecord> {
  if (input.isPrimary) {
    await clearPrimary(trx, input.clientId);
  }
  const id = createId();
  await trx
    .insertInto("contact")
    .values({
      id,
      workspace_id: input.workspaceId,
      client_id: input.clientId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: input.role,
      is_primary: input.isPrimary,
      created_by: input.memberId,
    })
    .execute();
  const row = await getContact(trx, id);
  if (!row) {
    throw new Error("Inserting a contact did not return a row.");
  }
  return row;
}

export async function updateContact(
  trx: Db,
  id: string,
  clientId: string,
  patch: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    role?: string | null;
    is_primary?: boolean;
  },
): Promise<void> {
  if (patch.is_primary === true) {
    await clearPrimary(trx, clientId);
  }
  const { is_primary: isPrimary, ...rest } = patch;
  const next = isPrimary === undefined ? rest : { ...rest, is_primary: isPrimary };
  if (Object.keys(next).length === 0) {
    return;
  }
  await trx.updateTable("contact").set(next).where("id", "=", id).execute();
}

export async function deleteContact(trx: Db, id: string): Promise<void> {
  await trx.deleteFrom("contact").where("id", "=", id).execute();
}

const locationColumns = sql`
  id::text as id,
  workspace_id::text as workspace_id,
  client_id::text as client_id,
  address,
  ST_Y(point)::float8 as lat,
  ST_X(point)::float8 as lng,
  parcel_cache_id::text as parcel_cache_id,
  ST_AsGeoJSON(site_geom) as site_geom,
  notes,
  created_at,
  updated_at
`;

function locationVisibility(assigned: string | null) {
  return sql`(
    ${assigned}::uuid is null
    or client_id in (
      select client_id from job
      where owner_member_id = ${assigned}::uuid and client_id is not null
    )
    or id in (
      select location_id from job
      where owner_member_id = ${assigned}::uuid and location_id is not null
    )
  )`;
}

export async function listLocations(trx: Db, assigned: string | null): Promise<LocationRecord[]> {
  const result = await sql<LocationRecord>`
    select ${locationColumns}
    from location
    where ${locationVisibility(assigned)}
    order by created_at desc
    limit 200
  `.execute(trx);
  return result.rows;
}

export async function getLocation(
  trx: Db,
  id: string,
  assigned: string | null,
): Promise<LocationRecord | undefined> {
  const result = await sql<LocationRecord>`
    select ${locationColumns}
    from location
    where id = ${id}::uuid and ${locationVisibility(assigned)}
  `.execute(trx);
  return result.rows[0];
}

export async function insertLocation(
  trx: Db,
  input: {
    workspaceId: string;
    memberId: string;
    clientId: string | null;
    address: unknown;
    lat: number | null;
    lng: number | null;
    parcelCacheId: string | null;
    siteGeom: GeoJsonMultiPolygon | null;
    notes: string | null;
  },
): Promise<LocationRecord> {
  const id = createId();
  const geom = input.siteGeom ? JSON.stringify(input.siteGeom) : null;
  await sql`
    insert into location (
      id, workspace_id, client_id, address, point, parcel_cache_id, site_geom, notes, created_by
    ) values (
      ${id}::uuid,
      ${input.workspaceId}::uuid,
      ${input.clientId}::uuid,
      ${JSON.stringify(input.address)}::jsonb,
      case
        when ${input.lat}::float8 is null or ${input.lng}::float8 is null then null
        else ST_SetSRID(ST_MakePoint(${input.lng}::float8, ${input.lat}::float8), 4326)
      end,
      ${input.parcelCacheId}::uuid,
      case
        when ${geom}::text is null then null
        else ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geom}), 4326))
      end,
      ${input.notes},
      ${input.memberId}::uuid
    )
  `.execute(trx);
  const row = await getLocation(trx, id, null);
  if (!row) {
    throw new Error("Inserting a location did not return a row.");
  }
  return row;
}

export async function updateLocation(
  trx: Db,
  id: string,
  patch: {
    clientId?: string | null;
    address?: unknown;
    lat?: number | null;
    lng?: number | null;
    notes?: string | null;
  },
): Promise<void> {
  if (patch.clientId !== undefined) {
    await sql`update location set client_id = ${patch.clientId}::uuid where id = ${id}::uuid`.execute(
      trx,
    );
  }
  if (patch.address !== undefined) {
    await sql`
      update location set address = ${JSON.stringify(patch.address)}::jsonb where id = ${id}::uuid
    `.execute(trx);
  }
  if (patch.lat !== undefined && patch.lng !== undefined) {
    await sql`
      update location
      set point = case
        when ${patch.lat}::float8 is null or ${patch.lng}::float8 is null then null
        else ST_SetSRID(ST_MakePoint(${patch.lng}::float8, ${patch.lat}::float8), 4326)
      end
      where id = ${id}::uuid
    `.execute(trx);
  }
  if (patch.notes !== undefined) {
    await sql`update location set notes = ${patch.notes} where id = ${id}::uuid`.execute(trx);
  }
}

function selectJobs(where: ReturnType<typeof sql>, limit: number) {
  return sql<JobView>`
    select
      j.id::text as id,
      j.number,
      j.name,
      j.stage,
      j.client_id::text as client_id,
      c.name as client_name,
      j.location_id::text as location_id,
      l.address->>'line1' as location_line1,
      ST_Y(l.point)::float8 as lat,
      ST_X(l.point)::float8 as lng,
      j.bid_value_cents::text as bid_value_cents,
      j.owner_member_id::text as owner_member_id,
      j.source,
      j.lost_reason,
      j.tags,
      j.created_at,
      j.updated_at
    from job j
    left join client c on c.id = j.client_id
    left join location l on l.id = j.location_id
    where ${where}
    order by j.updated_at desc
    limit ${limit}
  `;
}

function jobOwner(assigned: string | null) {
  return sql`(${assigned}::uuid is null or j.owner_member_id = ${assigned}::uuid)`;
}

export async function listJobs(
  trx: Db,
  filter: {
    assigned: string | null;
    stage: string | null;
    owner: string | null;
    q: string | null;
    updatedSince: string | null;
    tag: string | null;
    limit: number;
  },
): Promise<JobView[]> {
  const like = filter.q ? likeContains(filter.q) : "%";
  const result = await selectJobs(
    sql`
      ${jobOwner(filter.assigned)}
      and (${filter.stage}::text is null or j.stage = ${filter.stage})
      and (${filter.owner}::text is null or j.owner_member_id = ${filter.owner}::uuid)
      and (${filter.updatedSince}::timestamptz is null or j.updated_at >= ${filter.updatedSince}::timestamptz)
      and (${filter.tag}::text is null or ${filter.tag} = any(j.tags))
      and (
        ${filter.q}::text is null
        or j.name ilike ${like} escape '\\'
        or j.number ilike ${like} escape '\\'
        or c.name ilike ${like} escape '\\'
      )
    `,
    filter.limit,
  ).execute(trx);
  return result.rows;
}

export async function getJob(
  trx: Db,
  id: string,
  assigned: string | null,
): Promise<JobView | undefined> {
  const result = await selectJobs(sql`j.id = ${id}::uuid and ${jobOwner(assigned)}`, 1).execute(
    trx,
  );
  return result.rows[0];
}

export async function allocateJobNumber(
  trx: Db,
  workspaceId: string,
  memberId: string,
): Promise<string> {
  const result = await sql<{ last_value: string }>`
    insert into counters (id, workspace_id, prefix, last_value, created_by)
    values (${createId()}::uuid, ${workspaceId}::uuid, 'J', 1001, ${memberId}::uuid)
    on conflict (workspace_id, prefix)
    do update set last_value = counters.last_value + 1, updated_at = now()
    returning last_value::text as last_value
  `.execute(trx);
  const sequence = Number(result.rows[0]?.last_value);
  return formatHumanNumber("J", sequence);
}

export async function insertJob(
  trx: Db,
  input: {
    workspaceId: string;
    memberId: string;
    number: string;
    clientId: string | null;
    locationId: string | null;
    name: string;
    bidValueCents: number | null;
    ownerMemberId: string;
    source: string | null;
    tags: string[];
  },
): Promise<JobView> {
  const id = createId();
  await trx
    .insertInto("job")
    .values({
      id,
      workspace_id: input.workspaceId,
      number: input.number,
      client_id: input.clientId,
      location_id: input.locationId,
      name: input.name,
      stage: "lead",
      bid_value_cents: input.bidValueCents,
      owner_member_id: input.ownerMemberId,
      source: input.source,
      lost_reason: null,
      tags: input.tags,
      created_by: input.memberId,
    })
    .execute();
  const row = await getJob(trx, id, null);
  if (!row) {
    throw new Error("Inserting a job did not return a row.");
  }
  return row;
}

export async function updateJob(
  trx: Db,
  id: string,
  patch: {
    name?: string;
    client_id?: string | null;
    location_id?: string | null;
    bid_value_cents?: number | null;
    owner_member_id?: string;
    source?: string | null;
    tags?: string[];
  },
): Promise<void> {
  if (Object.keys(patch).length === 0) {
    return;
  }
  await trx.updateTable("job").set(patch).where("id", "=", id).execute();
}

export async function setJobStage(
  trx: Db,
  input: {
    workspaceId: string;
    jobId: string;
    memberId: string;
    from: string;
    to: string;
    reason: string | null;
    forced: boolean;
  },
): Promise<void> {
  await trx
    .updateTable("job")
    .set({
      stage: input.to,
      lost_reason: input.to === "lost" ? input.reason : null,
    })
    .where("id", "=", input.jobId)
    .execute();
  await trx
    .insertInto("audit_log")
    .values({
      workspace_id: input.workspaceId,
      actor_member_id: input.memberId,
      entity_type: "job",
      entity_id: input.jobId,
      action: "stage",
      diff: {
        from: input.from,
        to: input.to,
        reason: input.reason,
        forced: input.forced,
      },
    })
    .execute();
}

export async function activeMember(trx: Db, memberId: string): Promise<boolean> {
  const row = await trx
    .selectFrom("member")
    .select("id")
    .where("id", "=", memberId)
    .where("status", "=", "active")
    .executeTakeFirst();
  return row !== undefined;
}

export async function listNotes(trx: Db, jobId: string) {
  return trx
    .selectFrom("job_note")
    .select(["id", "job_id", "body", "created_at", "created_by"])
    .where("job_id", "=", jobId)
    .orderBy("created_at")
    .execute();
}

export async function insertNote(
  trx: Db,
  input: { workspaceId: string; jobId: string; memberId: string; body: string },
) {
  return trx
    .insertInto("job_note")
    .values({
      id: createId(),
      workspace_id: input.workspaceId,
      job_id: input.jobId,
      body: input.body,
      created_by: input.memberId,
    })
    .returning(["id", "job_id", "body", "created_at", "created_by"])
    .executeTakeFirstOrThrow();
}

export async function listTasks(trx: Db, jobId: string) {
  return trx
    .selectFrom("job_task")
    .select(["id", "job_id", "title", "done", "due_at", "created_at"])
    .where("job_id", "=", jobId)
    .orderBy("created_at")
    .execute();
}

export async function insertTask(
  trx: Db,
  input: {
    workspaceId: string;
    jobId: string;
    memberId: string;
    title: string;
    dueAt: Date | null;
  },
) {
  return trx
    .insertInto("job_task")
    .values({
      id: createId(),
      workspace_id: input.workspaceId,
      job_id: input.jobId,
      title: input.title,
      done: false,
      due_at: input.dueAt,
      created_by: input.memberId,
    })
    .returning(["id", "job_id", "title", "done", "due_at", "created_at"])
    .executeTakeFirstOrThrow();
}

export type JobFileRecord = {
  id: string;
  file_id: string;
  mime: string | null;
  bytes: string | null;
  status: string;
  storage_key: string;
  created_at: Date;
};

export async function listJobFiles(trx: Db, jobId: string): Promise<JobFileRecord[]> {
  const result = await sql<JobFileRecord>`
    select
      jf.id::text as id,
      f.id::text as file_id,
      f.mime,
      f.bytes::text as bytes,
      f.status,
      f.storage_key,
      f.created_at
    from job_file jf
    join file f on f.id = jf.file_id
    where jf.job_id = ${jobId}::uuid
    order by f.created_at
  `.execute(trx);
  return result.rows;
}

export async function insertJobFile(
  trx: Db,
  input: {
    workspaceId: string;
    jobId: string;
    memberId: string;
    fileId: string;
    storageKey: string;
    mime: string;
    bytes: number | null;
  },
): Promise<JobFileRecord> {
  await trx
    .insertInto("file")
    .values({
      id: input.fileId,
      workspace_id: input.workspaceId,
      storage_key: input.storageKey,
      mime: input.mime,
      bytes: input.bytes === null ? null : String(input.bytes),
      sha256: null,
      status: "pending",
      created_by: input.memberId,
    })
    .execute();
  const linkId = createId();
  await trx
    .insertInto("job_file")
    .values({
      id: linkId,
      workspace_id: input.workspaceId,
      job_id: input.jobId,
      file_id: input.fileId,
      created_by: input.memberId,
    })
    .execute();
  const rows = await listJobFiles(trx, input.jobId);
  const row = rows.find((item) => item.id === linkId);
  if (!row) {
    throw new Error("Inserting a job file did not return a row.");
  }
  return row;
}

export async function pipelineSummary(
  trx: Db,
  assigned: string | null,
): Promise<{ stage: string; count: number; bid_value_cents: number }[]> {
  const result = await sql<{ stage: string; count: number; bid_value_cents: string }>`
    select stage, count(*)::int as count, coalesce(sum(bid_value_cents), 0)::text as bid_value_cents
    from job
    where ${assigned}::uuid is null or owner_member_id = ${assigned}::uuid
    group by stage
  `.execute(trx);
  const byStage = new Map(result.rows.map((row) => [row.stage, row]));
  return JOB_STAGES.map((stage) => {
    const row = byStage.get(stage);
    return {
      stage,
      count: row?.count ?? 0,
      bid_value_cents: row ? Number(row.bid_value_cents) : 0,
    };
  });
}

export async function recordUsage(trx: Db, workspaceId: string, kind: string): Promise<void> {
  await trx
    .insertInto("usage_event")
    .values({
      workspace_id: workspaceId,
      kind,
      units: "1",
      cost_estimate_cents: "0",
    })
    .execute();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function rememberParcels(
  trx: Db,
  workspaceId: string,
  provider: ParcelProvider,
  point: LatLng,
): Promise<SavedParcel[]> {
  const candidates = await provider.lookup(point);
  const saved: SavedParcel[] = [];
  for (const candidate of candidates) {
    const id = createId();
    const geom = JSON.stringify(candidate.geom);
    const attrs = JSON.stringify(candidate.attrs);
    const inserted = await sql<{ id: string }>`
      insert into parcel_cache (id, provider, provider_parcel_id, geom, attrs)
      values (
        ${id}::uuid,
        ${provider.name},
        ${candidate.providerParcelId},
        ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geom}), 4326)),
        ${attrs}::jsonb
      )
      on conflict (provider, provider_parcel_id) do nothing
      returning id::text as id
    `.execute(trx);
    if (inserted.rows[0]) {
      await recordUsage(trx, workspaceId, "parcel");
    }
    const row = await sql<{ id: string; geom: string; attrs: unknown }>`
      select id::text as id, ST_AsGeoJSON(geom) as geom, attrs
      from parcel_cache
      where provider = ${provider.name}
        and provider_parcel_id = ${candidate.providerParcelId}
    `.execute(trx);
    const found = row.rows[0];
    if (!found) {
      throw new Error("Parcel cache insert did not return a row.");
    }
    saved.push({
      id: found.id,
      provider: provider.name,
      provider_parcel_id: candidate.providerParcelId,
      geom: JSON.parse(found.geom) as GeoJsonMultiPolygon,
      attrs: asRecord(found.attrs),
    });
  }
  return saved;
}

async function jobsWhere(trx: Db, where: ReturnType<typeof sql>, assigned: string | null) {
  const result = await selectJobs(sql`${where} and ${jobOwner(assigned)}`, 20).execute(trx);
  return result.rows;
}

function mergeJobs(groups: JobView[][]): JobView[] {
  const seen = new Set<string>();
  const jobs: JobView[] = [];
  for (const group of groups) {
    for (const job of group) {
      if (seen.has(job.id)) {
        continue;
      }
      seen.add(job.id);
      jobs.push(job);
      if (jobs.length === 20) {
        return jobs;
      }
    }
  }
  return jobs;
}

export async function searchWorkspace(
  trx: Db,
  input: { q: string; assigned: string | null; includeCrm: boolean; includeJobs: boolean },
): Promise<{
  clients: ClientRecord[];
  contacts: ContactRecord[];
  jobs: JobView[];
  locations: LocationRecord[];
  mode: SearchMode;
}> {
  const mode = searchMode(input.q);
  const assigned = input.assigned;
  let clients: ClientRecord[] = [];
  let contacts: ContactRecord[] = [];
  let jobs: JobView[] = [];
  let locations: LocationRecord[] = [];

  if (mode === "number" && input.includeJobs) {
    jobs = await jobsWhere(trx, sql`j.number = ${input.q.toUpperCase()}`, assigned);
  }

  if (mode === "phone") {
    const digits = phoneDigits(input.q);
    if (input.includeCrm) {
      const clientRows = await sql<ClientRecord>`
        select ${clientColumns}
        from client
        where archived_at is null
          and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${digits}
          and ${assignedClient("id", assigned)}
        limit 20
      `.execute(trx);
      clients = clientRows.rows;
      const contactRows = await sql<ContactRecord>`
        select
          id::text as id,
          client_id::text as client_id,
          name,
          email::text as email,
          phone,
          role,
          is_primary,
          created_at,
          updated_at
        from contact
        where regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${digits}
          and ${assignedClient("client_id", assigned)}
        limit 20
      `.execute(trx);
      contacts = contactRows.rows;
    }
    if (input.includeJobs) {
      jobs = await jobsWhere(
        trx,
        sql`j.client_id in (
          select id from client
          where regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${digits}
          union
          select client_id from contact
          where regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${digits}
        )`,
        assigned,
      );
    }
  }

  if (mode === "text") {
    const like = likeContains(input.q.trim());
    if (input.includeCrm) {
      const clientRows = await sql<ClientRecord>`
        select ${clientColumns}
        from client
        where archived_at is null
          and name ilike ${like} escape '\\'
          and ${assignedClient("id", assigned)}
        order by name
        limit 20
      `.execute(trx);
      clients = clientRows.rows;
      const contactRows = await sql<ContactRecord>`
        select
          ct.id::text as id,
          ct.client_id::text as client_id,
          ct.name,
          ct.email::text as email,
          ct.phone,
          ct.role,
          ct.is_primary,
          ct.created_at,
          ct.updated_at
        from contact ct
        where ct.name ilike ${like} escape '\\'
          and (
            ${assigned}::uuid is null
            or ct.client_id in (
              select client_id from job
              where owner_member_id = ${assigned}::uuid and client_id is not null
            )
          )
        order by ct.name
        limit 20
      `.execute(trx);
      contacts = contactRows.rows;
      const locationRows = await sql<LocationRecord>`
        select ${locationColumns}
        from location
        where (address->>'line1') ilike ${like} escape '\\'
          and ${locationVisibility(assigned)}
        limit 20
      `.execute(trx);
      locations = locationRows.rows;
    }
    if (input.includeJobs) {
      const byName = await jobsWhere(trx, sql`j.name ilike ${like} escape '\\'`, assigned);
      const byClient = await jobsWhere(
        trx,
        sql`j.client_id in (select id from client where name ilike ${like} escape '\\')`,
        assigned,
      );
      const byStreet = await jobsWhere(
        trx,
        sql`j.location_id in (
          select id from location where (address->>'line1') ilike ${like} escape '\\'
        )`,
        assigned,
      );
      jobs = mergeJobs([byName, byClient, byStreet]);
    }
  }

  return { clients, contacts, jobs, locations, mode };
}
