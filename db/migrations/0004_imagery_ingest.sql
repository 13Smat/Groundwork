-- Imagery ingest jobs, and the admin write path for global imagery rows.
-- ADR 0007.
--
-- groundwork_app cannot write a global imagery row (ADR 0006). County ingest
-- and the internal source editor need that write. A transaction may do it
-- only when app.imagery_admin is 'on'. The API sets that for one transaction
-- after requireImageryAdmin confirms the member role is owner or admin.
-- ADR 0008.
--
-- imagery_capture status changes are also rejected in the database when they
-- are not ingesting -> ready or ingesting -> failed. The application returns
-- 409 for the same rule before it writes.

create table imagery_ingest_job (
  id uuid primary key,
  workspace_id uuid not null,
  source_id uuid not null references imagery_source (id),
  capture_id uuid not null references imagery_capture (id),
  county_fips text,
  aoi geometry(MultiPolygon, 4326),
  year integer not null check (year between 1990 and 2100),
  idempotency_key text not null,
  request_hash text not null,
  status text not null check (status in ('ingesting', 'ready', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  constraint imagery_ingest_job_one_target check (
    (county_fips is not null and aoi is null)
    or (county_fips is null and aoi is not null)
  ),
  constraint imagery_ingest_job_county_fips check (
    county_fips is null or county_fips ~ '^[0-9]{5}$'
  ),
  unique (workspace_id, idempotency_key)
);

create index imagery_ingest_job_workspace_id_idx on imagery_ingest_job (workspace_id);
create index imagery_ingest_job_capture_id_idx on imagery_ingest_job (capture_id);

alter table imagery_ingest_job enable row level security;
alter table imagery_ingest_job force row level security;

create policy imagery_ingest_job_read on imagery_ingest_job
  for select
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    or current_setting('app.imagery_admin', true) = 'on'
  );

create policy imagery_ingest_job_insert on imagery_ingest_job
  for insert
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and current_setting('app.imagery_admin', true) = 'on'
  );

create policy imagery_ingest_job_update on imagery_ingest_job
  for update
  using (current_setting('app.imagery_admin', true) = 'on')
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and current_setting('app.imagery_admin', true) = 'on'
  );

-- OR'd with the policies in 0003. When the setting is off these do not grant
-- access. There is no admin delete policy: the app role still cannot delete a
-- global row.
create policy imagery_source_admin_select on imagery_source
  for select
  using (current_setting('app.imagery_admin', true) = 'on');

create policy imagery_source_admin_insert on imagery_source
  for insert
  with check (current_setting('app.imagery_admin', true) = 'on');

create policy imagery_source_admin_update on imagery_source
  for update
  using (current_setting('app.imagery_admin', true) = 'on')
  with check (current_setting('app.imagery_admin', true) = 'on');

create policy imagery_capture_admin_select on imagery_capture
  for select
  using (current_setting('app.imagery_admin', true) = 'on');

create policy imagery_capture_admin_insert on imagery_capture
  for insert
  with check (current_setting('app.imagery_admin', true) = 'on');

create policy imagery_capture_admin_update on imagery_capture
  for update
  using (current_setting('app.imagery_admin', true) = 'on')
  with check (current_setting('app.imagery_admin', true) = 'on');

grant select, insert, update, delete on imagery_ingest_job to groundwork_app;

create function imagery_capture_reject_illegal_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and not (old.status = 'ingesting' and new.status in ('ready', 'failed')) then
    raise exception 'illegal imagery capture transition from % to %', old.status, new.status
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger imagery_capture_status_transition
  before update of status on imagery_capture
  for each row
  execute function imagery_capture_reject_illegal_transition();
