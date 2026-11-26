-- CRM and jobs. Spec 03. ADR 0008.
--
-- Tenant policy, on every table in this file except parcel_cache:
--   workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
-- FORCE ROW LEVEL SECURITY. Grants go to groundwork_app only.
--
-- workspace.id is text (ADR 0007). These workspace_id columns stay uuid, with
-- no foreign key, matching counters and file. member.id is text too, so
-- owner_member_id and created_by are uuid with no foreign key. The values are
-- the same UUIDv7 strings.
--
-- imagery_source and imagery_capture have no location_id column. There is
-- nothing to reference. GET /imagery/captures?locationId= reads location.point.
--
-- parcel_cache is global. It has no workspace_id and no row security, same as
-- event_log. Rows are a geocode/parcel cache, never an ML training input.
--
-- Job numbers: the first counters row for prefix J stores 1001 (J-1001).
-- Later rows increment. jobs.force_won is appended to owner and admin.
-- Wildcards are not expanded, so jobs.* does not include it.
--
-- 0004 is the imagery ingest worker. 0006 is the catalog. This file is 0005.

create extension if not exists pg_trgm;

update "role"
set permissions = permissions || array['jobs.force_won']::text[]
where is_system
  and workspace_id is null
  and name in ('owner', 'admin')
  and not (permissions @> array['jobs.force_won']::text[]);

create table parcel_cache (
  id uuid primary key,
  provider text not null,
  provider_parcel_id text not null,
  geom geometry(MultiPolygon, 4326),
  attrs jsonb not null default '{}',
  fetched_at timestamptz not null default now(),
  unique (provider, provider_parcel_id)
);

create index parcel_cache_geom_gix on parcel_cache using gist (geom);

comment on table parcel_cache is
  'Global parcel lookup cache. Never use these rows as ML training input.';

create table client (
  id uuid primary key,
  workspace_id uuid not null,
  type text not null check (type in ('residential', 'commercial', 'gov', 'hoa')),
  name text not null,
  billing_address jsonb,
  -- Spec 01 puts email and phone on contact only. Spec 03 warns on duplicate
  -- client email or phone at create, so the client row stores them too.
  email citext,
  phone text,
  tags text[] not null default '{}',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create index client_workspace_id_idx on client (workspace_id);
create index client_name_trgm on client using gin (name gin_trgm_ops);
create index client_phone_digits_idx
  on client (regexp_replace(coalesce(phone, ''), '\D', '', 'g'));

create table contact (
  id uuid primary key,
  workspace_id uuid not null,
  client_id uuid not null references client (id) on delete cascade,
  name text not null,
  email citext,
  phone text,
  role text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create index contact_workspace_id_idx on contact (workspace_id);
create index contact_client_id_idx on contact (client_id);
create unique index contact_one_primary_uidx on contact (client_id) where is_primary;
create index contact_phone_digits_idx
  on contact (regexp_replace(coalesce(phone, ''), '\D', '', 'g'));

create table location (
  id uuid primary key,
  workspace_id uuid not null,
  client_id uuid references client (id),
  address jsonb not null,
  point geometry(Point, 4326),
  parcel_cache_id uuid references parcel_cache (id),
  site_geom geometry(MultiPolygon, 4326),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create index location_workspace_id_idx on location (workspace_id);
create index location_client_id_idx on location (client_id);
create index location_point_gix on location using gist (point);
create index location_site_geom_gix on location using gist (site_geom);
create index location_line1_trgm on location using gin ((address->>'line1') gin_trgm_ops);

create table job (
  id uuid primary key,
  workspace_id uuid not null,
  number text not null,
  client_id uuid references client (id),
  location_id uuid references location (id),
  name text not null,
  stage text not null default 'lead' check (stage in (
    'lead', 'estimating', 'proposed', 'won', 'lost',
    'scheduled', 'in_progress', 'completed', 'invoiced', 'closed'
  )),
  bid_value_cents bigint,
  owner_member_id uuid,
  source text,
  lost_reason text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  unique (workspace_id, number),
  constraint job_lost_reason check (
    stage <> 'lost' or (lost_reason is not null and length(btrim(lost_reason)) > 0)
  )
);

create index job_client_id_idx on job (client_id, updated_at desc);
create index job_location_id_idx on job (location_id, updated_at desc);
create index job_owner_member_id_idx on job (owner_member_id);
create index job_name_trgm on job using gin (name gin_trgm_ops);

create table job_note (
  id uuid primary key,
  workspace_id uuid not null,
  job_id uuid not null references job (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create index job_note_job_id_idx on job_note (job_id);
create index job_note_workspace_id_idx on job_note (workspace_id);

create table job_task (
  id uuid primary key,
  workspace_id uuid not null,
  job_id uuid not null references job (id) on delete cascade,
  title text not null,
  done boolean not null default false,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create index job_task_job_id_idx on job_task (job_id);
create index job_task_workspace_id_idx on job_task (workspace_id);

create table job_file (
  id uuid primary key,
  workspace_id uuid not null,
  job_id uuid not null references job (id) on delete cascade,
  file_id uuid not null references file (id),
  created_at timestamptz not null default now(),
  created_by uuid
);

create index job_file_job_id_idx on job_file (job_id);
create index job_file_file_id_idx on job_file (file_id);
create index job_file_workspace_id_idx on job_file (workspace_id);

create trigger client_set_updated_at
  before update on client
  for each row
  execute function set_updated_at();

create trigger contact_set_updated_at
  before update on contact
  for each row
  execute function set_updated_at();

create trigger location_set_updated_at
  before update on location
  for each row
  execute function set_updated_at();

create trigger job_set_updated_at
  before update on job
  for each row
  execute function set_updated_at();

create trigger job_note_set_updated_at
  before update on job_note
  for each row
  execute function set_updated_at();

create trigger job_task_set_updated_at
  before update on job_task
  for each row
  execute function set_updated_at();

alter table client enable row level security;
alter table client force row level security;
alter table contact enable row level security;
alter table contact force row level security;
alter table location enable row level security;
alter table location force row level security;
alter table job enable row level security;
alter table job force row level security;
alter table job_note enable row level security;
alter table job_note force row level security;
alter table job_task enable row level security;
alter table job_task force row level security;
alter table job_file enable row level security;
alter table job_file force row level security;

create policy tenant_isolation on client
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on contact
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on location
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on job
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on job_note
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on job_task
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on job_file
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

grant select, insert, update, delete on client, contact, location, job, job_note, job_task, job_file, parcel_cache to groundwork_app;
