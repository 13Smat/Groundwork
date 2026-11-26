-- Estimates and line items. Spec 07 part 1. ADR 0015.
--
-- Tenant policy, on both tables:
--   workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
-- FORCE ROW LEVEL SECURITY. Grants go to groundwork_app only.
-- Trigger functions stay SECURITY INVOKER. There is no BYPASSRLS.
--
-- 0010 is left for the map takeoff follow-up. This file is 0011 only.
-- takeoff, job, cost_recipe, and catalog_item already exist. Do not edit
-- those migrations. An estimate points at takeoff.id (ADR 0013): final ->
-- draft clones a new takeoff row, and the old id stays the priced version.
--
-- The spec 01 sketch has no takeoff_id, notes, per-line variables, recipe
-- version, markup, overhead, tax code, or flagged. Spec 07 uses them.
-- qty stays numeric(14,4). input_qty is text because the formula input can
-- need more than four decimal places, and a recalculation has to reuse it.
-- cost_cents and price_cents are the half-even line amounts. The rounded
-- qty times unit price is not the total.

create table estimate (
  id uuid primary key,
  workspace_id uuid not null,
  job_id uuid not null references job (id),
  takeoff_id uuid references takeoff (id),
  number text not null,
  version integer not null default 1 check (version >= 1),
  status text not null default 'draft' check (
    status in ('draft', 'ready', 'sent', 'accepted', 'superseded')
  ),
  markup_pct numeric(6, 2) not null default 0,
  overhead_pct numeric(6, 2) not null default 0,
  tax_rate numeric(6, 4) not null default 0,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  optional_subtotal_cents bigint not null default 0,
  optional_tax_cents bigint not null default 0,
  optional_total_cents bigint not null default 0,
  snapshot jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  unique (workspace_id, number, version),
  check (markup_pct >= -100),
  check (overhead_pct >= -100),
  check (tax_rate >= 0 and tax_rate <= 1),
  check (notes is null or char_length(notes) <= 8000),
  check (status = 'draft' or snapshot is not null)
);

create index estimate_workspace_id_idx on estimate (workspace_id);
create index estimate_job_id_idx on estimate (job_id);
create index estimate_takeoff_id_idx on estimate (takeoff_id);

create table line_item (
  id uuid primary key,
  workspace_id uuid not null,
  estimate_id uuid not null references estimate (id) on delete cascade,
  grp text,
  description text not null,
  qty numeric(14, 4) not null,
  unit text not null,
  unit_cost_cents bigint not null,
  unit_price_cents bigint not null,
  cost_cents bigint not null,
  price_cents bigint not null,
  tax_cents bigint not null default 0,
  source text not null check (source in ('recipe', 'manual')),
  recipe_id uuid references cost_recipe (id),
  recipe_version integer,
  recipe_component_id uuid references recipe_component (id),
  catalog_item_id uuid references catalog_item (id),
  takeoff_item_id uuid references takeoff_item (id),
  input_qty text,
  input_unit text,
  variables jsonb not null default '{}'::jsonb,
  markup_pct numeric(6, 2),
  overhead_pct numeric(6, 2),
  tax_code text,
  flagged boolean not null default false,
  optional boolean not null default false,
  price_overridden boolean not null default false,
  measurement_ids uuid[] not null default '{}',
  sort integer not null default 0 check (sort >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(description) between 1 and 500),
  check (grp is null or char_length(grp) <= 200),
  check (char_length(unit) between 1 and 40),
  check (tax_code is null or char_length(tax_code) <= 40),
  check (input_unit is null or char_length(input_unit) <= 40),
  check (markup_pct is null or markup_pct >= -100),
  check (overhead_pct is null or overhead_pct >= -100),
  check (jsonb_typeof(variables) = 'object'),
  check (recipe_version is null or recipe_version >= 1)
);

create index line_item_workspace_id_idx on line_item (workspace_id);
create index line_item_estimate_id_idx on line_item (estimate_id);

create trigger estimate_set_updated_at
  before update on estimate
  for each row
  execute function set_updated_at();

create trigger line_item_set_updated_at
  before update on line_item
  for each row
  execute function set_updated_at();

create function estimate_before_update()
returns trigger
language plpgsql
as $$
declare
  super boolean;
begin
  -- The database owner bypasses row security and cleans up fixtures.
  -- groundwork_app is not a superuser, so the API still hits the checks.
  select rolsuper into super from pg_roles where rolname = current_user;
  if super then
    return new;
  end if;
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'an estimate cannot move to another workspace' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status
     and not (
       (old.status = 'draft' and new.status = 'ready')
       or (old.status = 'ready' and new.status in ('draft', 'sent', 'superseded'))
       or (old.status = 'sent' and new.status in ('accepted', 'superseded'))
     ) then
    raise exception 'illegal estimate transition from % to %', old.status, new.status
      using errcode = 'P0001';
  end if;
  if old.status <> 'draft' and new.status = old.status then
    raise exception 'an estimate outside draft is frozen' using errcode = 'P0001';
  end if;
  if old.status = 'draft' and new.status <> 'draft' and new.snapshot is null then
    raise exception 'leaving draft freezes a snapshot' using errcode = 'P0001';
  end if;
  if old.status <> 'draft' and new.status <> 'draft' and new.snapshot is distinct from old.snapshot then
    raise exception 'a frozen snapshot cannot change' using errcode = 'P0001';
  end if;
  if new.status = 'draft' and old.status <> 'draft' then
    new.snapshot := null;
  end if;
  if old.status = 'draft' and new.status = 'ready' then
    if exists (
      select 1 from line_item
      where estimate_id = new.id
        and (flagged or (source = 'recipe' and recipe_id is null))
    ) then
      raise exception 'flagged lines block ready' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger estimate_before_update
  before update on estimate
  for each row
  execute function estimate_before_update();

create function line_item_reject_frozen_estimate()
returns trigger
language plpgsql
as $$
declare
  parent_status text;
  parent_id uuid;
  super boolean;
begin
  select rolsuper into super from pg_roles where rolname = current_user;
  if super then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  parent_id := case when tg_op = 'DELETE' then old.estimate_id else new.estimate_id end;
  select status into parent_status from estimate where id = parent_id;
  if parent_status is null then
    raise exception 'estimate not visible for this line' using errcode = 'P0001';
  end if;
  if parent_status <> 'draft' then
    raise exception 'lines on an estimate outside draft are frozen' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.estimate_id is distinct from old.estimate_id then
    raise exception 'a line cannot move to another estimate' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'a line cannot move to another workspace' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger line_item_reject_frozen_estimate
  before insert or update or delete on line_item
  for each row
  execute function line_item_reject_frozen_estimate();

alter table estimate enable row level security;
alter table estimate force row level security;
alter table line_item enable row level security;
alter table line_item force row level security;

create policy tenant_isolation on estimate
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on line_item
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

grant select, insert, update, delete on estimate, line_item to groundwork_app;
grant execute on function estimate_before_update() to groundwork_app;
grant execute on function line_item_reject_frozen_estimate() to groundwork_app;
