-- Detection runs and draft polygons. Spec 05 part 1. ADR 0016.
--
-- Tenant policy, on both tables:
--   workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
-- FORCE ROW LEVEL SECURITY. Grants go to groundwork_app only.
-- The trigger function is SECURITY INVOKER. It does not bypass row security.
--
-- 0010 and 0011 belong to other slices. This file is 0012 only.
-- usage_event already exists in 0001. Assist inserts kind cv_infer there.
-- Do not create a second usage table. parcel_cache is not touched.
--
-- Spec 01's status check stops at cancelled. Spec 05 also moves a succeeded
-- run to accepted_partial or accepted_all. The check lists both. Updates go
-- through detection_run_before_update. Inserts may start at queued.
--
-- takeoff_item_id is not in the spec 01 sketch. The assist request names one
-- area item, and the draft remembers it until a later accept step.

create table detection_run (
  id uuid primary key,
  workspace_id uuid not null,
  takeoff_id uuid not null references takeoff (id),
  imagery_capture_id uuid references imagery_capture (id),
  mode text not null check (mode in ('assist', 'classes')),
  classes text[] not null default '{}',
  status text not null default 'queued' check (status in (
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled',
    'accepted_partial',
    'accepted_all'
  )),
  gpu_seconds numeric(10, 2),
  error text,
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  check (gpu_seconds is null or gpu_seconds >= 0),
  check (char_length(idempotency_key) between 8 and 200),
  check (char_length(request_hash) = 64),
  unique (workspace_id, idempotency_key)
);

create index detection_run_workspace_id_idx on detection_run (workspace_id);
create index detection_run_takeoff_id_idx on detection_run (takeoff_id);
create index detection_run_imagery_capture_id_idx on detection_run (imagery_capture_id);

create table detection_feature (
  id uuid primary key,
  workspace_id uuid not null,
  run_id uuid not null references detection_run (id) on delete cascade,
  class text,
  geom geometry(Geometry, 4326) not null,
  score real,
  accepted_measurement_id uuid references measurement (id),
  takeoff_item_id uuid references takeoff_item (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  check (score is null or (score >= 0 and score <= 1)),
  check (class is null or char_length(class) <= 80),
  check (ST_GeometryType(geom) in ('ST_Polygon', 'ST_MultiPolygon'))
);

create index detection_feature_workspace_id_idx on detection_feature (workspace_id);
create index detection_feature_run_id_idx on detection_feature (run_id);
create index detection_feature_geom_gix on detection_feature using gist (geom);

create trigger detection_run_set_updated_at
  before update on detection_run
  for each row
  execute function set_updated_at();

create trigger detection_feature_set_updated_at
  before update on detection_feature
  for each row
  execute function set_updated_at();

create function detection_run_before_update()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.takeoff_id is distinct from old.takeoff_id then
    raise exception 'a detection run cannot change workspace or takeoff'
      using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status
     and not (
       (old.status = 'queued' and new.status = 'running')
       or (old.status = 'running' and new.status in ('succeeded', 'failed', 'cancelled'))
       or (old.status = 'succeeded' and new.status in ('accepted_partial', 'accepted_all'))
     ) then
    raise exception 'illegal detection run transition from % to %', old.status, new.status
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger detection_run_before_update
  before update on detection_run
  for each row
  execute function detection_run_before_update();

alter table detection_run enable row level security;
alter table detection_run force row level security;
alter table detection_feature enable row level security;
alter table detection_feature force row level security;

create policy tenant_isolation on detection_run
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on detection_feature
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

grant select, insert, update, delete on detection_run, detection_feature to groundwork_app;
grant execute on function detection_run_before_update() to groundwork_app;
