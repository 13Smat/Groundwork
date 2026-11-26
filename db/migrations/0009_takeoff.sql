-- Takeoff and measurement. Spec 04 part 1. ADR 0013.
--
-- Tenant policy, on both tables:
--   workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
-- FORCE ROW LEVEL SECURITY. Grants go to groundwork_app only.
--
-- 0007 and 0008 belong to other slices. This file is 0009 only.
-- takeoff_item already exists in 0006. Do not recreate it. measurement
-- references it. There is still no foreign key from takeoff_item to job
-- or location. 0006 shipped that way on purpose.
--
-- workspace.id is text (ADR 0007). workspace_id stays uuid with no foreign
-- key, matching job and takeoff_item. created_by is text, same as takeoff_item.
--
-- sheet_geom and planset_sheet are spec 12. This slice stores geographic
-- geom only. An aerial takeoff requires a location and an imagery capture.
-- A planset row may omit both. Measurements are not null geom.
--
-- final -> draft is not an update. The API inserts version+1. The final row
-- stays final and this trigger rejects any update of it. Estimates can keep
-- the old id. lineage_id groups the versions. supersedes_id points at the
-- previous one.

create table takeoff (
  id uuid primary key,
  workspace_id uuid not null,
  job_id uuid not null references job (id),
  location_id uuid references location (id),
  lineage_id uuid not null,
  supersedes_id uuid references takeoff (id),
  kind text not null check (kind in ('aerial', 'planset')),
  imagery_capture_id uuid references imagery_capture (id),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'final')),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  check (
    (kind = 'aerial' and imagery_capture_id is not null and location_id is not null)
    or kind = 'planset'
  ),
  unique (workspace_id, lineage_id, version)
);

create index takeoff_workspace_id_idx on takeoff (workspace_id);
create index takeoff_job_id_idx on takeoff (job_id);
create index takeoff_lineage_id_idx on takeoff (lineage_id);
create index takeoff_imagery_capture_id_idx on takeoff (imagery_capture_id);
create unique index takeoff_one_open_uidx
  on takeoff (workspace_id, lineage_id)
  where status in ('draft', 'in_review');

create table measurement (
  id uuid primary key,
  workspace_id uuid not null,
  takeoff_id uuid not null references takeoff (id) on delete cascade,
  takeoff_item_id uuid not null references takeoff_item (id),
  kind text not null check (kind in ('area', 'length', 'count')),
  geom geometry(Geometry, 4326) not null,
  value_m2 numeric(14, 4),
  value_m numeric(14, 4),
  count integer,
  source text not null check (source in ('manual', 'ai_assist', 'ai_auto')),
  confidence real,
  label text,
  deductions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  check (value_m2 is null or value_m2 >= 0),
  check (value_m is null or value_m >= 0),
  check (count is null or count >= 1),
  check (label is null or char_length(label) <= 200),
  check (jsonb_typeof(deductions) = 'array'),
  check (confidence is null or (confidence >= 0 and confidence <= 1)),
  check (
    (
      kind = 'area'
      and value_m2 is not null
      and count is null
      and ST_GeometryType(geom) in ('ST_Polygon', 'ST_MultiPolygon')
    )
    or (
      kind = 'length'
      and value_m is not null
      and value_m2 is null
      and count is null
      and ST_GeometryType(geom) in ('ST_LineString', 'ST_MultiLineString')
    )
    or (
      kind = 'count'
      and count is not null
      and value_m2 is null
      and value_m is null
      and ST_GeometryType(geom) in ('ST_Point', 'ST_MultiPoint')
    )
  )
);

create index measurement_workspace_id_idx on measurement (workspace_id);
create index measurement_takeoff_id_idx on measurement (takeoff_id);
create index measurement_takeoff_item_id_idx on measurement (takeoff_item_id);
create index measurement_geom_gix on measurement using gist (geom);

create trigger takeoff_set_updated_at
  before update on takeoff
  for each row
  execute function set_updated_at();

create trigger measurement_set_updated_at
  before update on measurement
  for each row
  execute function set_updated_at();

create function takeoff_before_update()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'final' then
    raise exception 'a final takeoff is read-only' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status
     and not (
       (old.status = 'draft' and new.status = 'in_review')
       or (old.status = 'in_review' and new.status = 'final')
     ) then
    raise exception 'illegal takeoff transition from % to %', old.status, new.status
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger takeoff_before_update
  before update on takeoff
  for each row
  execute function takeoff_before_update();

create function measurement_reject_final_takeoff()
returns trigger
language plpgsql
as $$
declare
  parent_status text;
  parent_id uuid;
  super boolean;
begin
  -- The database owner bypasses row security and cleans up fixtures.
  -- groundwork_app is not a superuser, so the API still hits the checks below.
  select rolsuper into super from pg_roles where rolname = current_user;
  if super then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  parent_id := case when tg_op = 'DELETE' then old.takeoff_id else new.takeoff_id end;
  select status into parent_status from takeoff where id = parent_id;
  if parent_status is null then
    raise exception 'takeoff not visible for this measurement' using errcode = 'P0001';
  end if;
  if parent_status = 'final' then
    raise exception 'measurements on a final takeoff are read-only' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.takeoff_id is distinct from old.takeoff_id then
    raise exception 'a measurement cannot move to another takeoff' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger measurement_reject_final_takeoff
  before insert or update or delete on measurement
  for each row
  execute function measurement_reject_final_takeoff();

alter table takeoff enable row level security;
alter table takeoff force row level security;
alter table measurement enable row level security;
alter table measurement force row level security;

create policy tenant_isolation on takeoff
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on measurement
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

grant select, insert, update, delete on takeoff, measurement to groundwork_app;
grant execute on function takeoff_before_update() to groundwork_app;
grant execute on function measurement_reject_final_takeoff() to groundwork_app;
