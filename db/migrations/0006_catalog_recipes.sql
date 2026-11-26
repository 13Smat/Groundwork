-- Catalog, takeoff items, and cost recipes. Spec 06.
--
-- Tenant policy, on every table:
--   workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
-- FORCE ROW LEVEL SECURITY. Grants go to groundwork_app only.
--
-- workspace.id is text (ADR 0007) and these ids are uuid, so there is no
-- foreign key to workspace. Isolation is the policy above.
--
-- TODO: takeoff_item must not reference job or location. Those tables arrive
-- with CRM. A later migration adds that link. Do not add it here.
--
-- catalog.manage is already on owner, admin, and estimator in
-- 0002_auth_workspaces.sql. This migration does not change role rows.
--
-- The spec 01 sketch has no recipe status and no family id. Spec 06 needs
-- draft -> active -> archived, and editing an active recipe creates version
-- n+1. family_id groups those versions. input_unit follows the SQL sketch.
-- unit_price_cents is the sell price spec 02 shows to roles without
-- catalog.manage. ADR 0008.

create table takeoff_item (
  id uuid primary key,
  workspace_id uuid not null,
  name text not null,
  measure_kind text not null check (measure_kind in ('area', 'length', 'count')),
  default_unit text not null,
  category text check (
    category is null
    or category in ('paving', 'landscape', 'hardscape', 'concrete', 'striping', 'other')
  ),
  color text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text
);

create index takeoff_item_workspace_id_idx on takeoff_item (workspace_id);

create table catalog_item (
  id uuid primary key,
  workspace_id uuid not null,
  kind text not null check (kind in ('material', 'labor', 'equipment', 'sub', 'fee')),
  name text not null,
  unit text not null,
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  waste_pct numeric(5, 2) not null default 0 check (waste_pct >= 0 and waste_pct <= 100),
  vendor text,
  sku text,
  tax_code text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text
);

create index catalog_item_workspace_id_idx on catalog_item (workspace_id);
create unique index catalog_item_workspace_sku_uidx
  on catalog_item (workspace_id, sku)
  where sku is not null and archived_at is null;

create table cost_recipe (
  id uuid primary key,
  workspace_id uuid not null,
  family_id uuid not null,
  name text not null,
  takeoff_item_id uuid references takeoff_item (id),
  input_unit text not null,
  variables jsonb not null default '{}',
  version integer not null default 1 check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  unique (workspace_id, family_id, version)
);

create index cost_recipe_workspace_id_idx on cost_recipe (workspace_id);
create index cost_recipe_takeoff_item_id_idx on cost_recipe (takeoff_item_id);
create unique index cost_recipe_one_active_uidx
  on cost_recipe (workspace_id, family_id)
  where status = 'active';
create unique index cost_recipe_one_draft_uidx
  on cost_recipe (workspace_id, family_id)
  where status = 'draft';

create table recipe_component (
  id uuid primary key,
  workspace_id uuid not null,
  recipe_id uuid not null references cost_recipe (id) on delete cascade,
  catalog_item_id uuid not null references catalog_item (id),
  qty_formula text not null check (char_length(qty_formula) between 1 and 2000),
  sort integer not null default 0 check (sort >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipe_component_workspace_id_idx on recipe_component (workspace_id);
create index recipe_component_recipe_id_idx on recipe_component (recipe_id);
create index recipe_component_catalog_item_id_idx on recipe_component (catalog_item_id);

create trigger takeoff_item_set_updated_at
  before update on takeoff_item
  for each row
  execute function set_updated_at();

create trigger catalog_item_set_updated_at
  before update on catalog_item
  for each row
  execute function set_updated_at();

create trigger cost_recipe_set_updated_at
  before update on cost_recipe
  for each row
  execute function set_updated_at();

create trigger recipe_component_set_updated_at
  before update on recipe_component
  for each row
  execute function set_updated_at();

alter table takeoff_item enable row level security;
alter table takeoff_item force row level security;
alter table catalog_item enable row level security;
alter table catalog_item force row level security;
alter table cost_recipe enable row level security;
alter table cost_recipe force row level security;
alter table recipe_component enable row level security;
alter table recipe_component force row level security;

create policy tenant_isolation on takeoff_item
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on catalog_item
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on cost_recipe
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on recipe_component
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

grant select, insert, update, delete on takeoff_item, catalog_item, cost_recipe, recipe_component to groundwork_app;
