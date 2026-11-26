# 01 — Data model

Phase: MVP core + v1 tables marked. All tables: `id uuid pk (v7)`, `workspace_id uuid not null` (except workspace/user, and global ImagerySource/ImageryCapture/ParcelCache rows where `workspace_id` is null), `created_at`, `updated_at`, `created_by`. Soft delete via `archived_at` where noted.

## Entities and relations
| Entity | Key fields | Relations | Phase |
|---|---|---|---|
| Workspace | name, slug, timezone, currency, units_pref, features jsonb, plan | has many Members, everything | MVP |
| User | email, name, phone | many Workspaces via Member | MVP |
| Member | user_id, workspace_id, role_id, status (invited/active/disabled) | User x Workspace | MVP |
| Role | name, permissions text[] (system roles: owner, admin, estimator, office, foreman, crew) | Members | MVP |
| Client | type (residential/commercial/gov/hoa), name, billing_address, tags | Contacts, Locations, Jobs | MVP |
| Contact | client_id, name, email, phone, role, is_primary | Client | MVP |
| Location (Site) | client_id, address fields, point geometry, parcel_id, parcel_geom, notes | Client, Jobs, Takeoffs | MVP |
| Job | number, client_id, location_id, name, stage (lead/estimating/proposed/won/lost/scheduled/in_progress/completed/invoiced/closed), bid_value_cents, owner_member_id, source, lost_reason | Client, Location, Takeoffs, Estimates, Proposals, WorkOrders, Invoices | MVP |
| Takeoff | job_id, location_id, kind (aerial/planset), imagery_capture_id, status, version | Job, Measurements, ImageryCapture | MVP (planset v1) |
| ImagerySource | provider (nc_ortho, nc_helene_2025, naip, county_*, nearmap, vexcel, drone_upload), name, coverage geometry, typical capture_date / year, gsd_cm, bands (e.g. RGB, RGBIR), license_text, license_url, allows_tracing, allows_ml_training, attribution, verified_at, notes | ImageryCaptures | MVP (nc_ortho, nc_helene_2025, naip); v1 (drone, nearmap, vexcel) |
| ImageryCapture | source_id, coverage geometry, capture_date, gsd_cm, bands, leaf (on/off), cog_key / tileset, status (ingesting/ready/failed), notes (e.g. seamline smears) | ImagerySource, Takeoffs | MVP |
| Measurement (Feature) | takeoff_id, takeoff_item_id, geom (4326) or sheet_geom + sheet_id, kind (area/length/count), value_m2/value_m/count, source (manual/ai_assist/ai_auto), confidence, label, deductions (holes) | Takeoff, TakeoffItem | MVP |
| TakeoffItem | name, measure_kind, default_unit, color, category (paving/landscape/hardscape/concrete/striping/other) | Measurements, CostRecipes | MVP |
| CatalogItem | kind (material/labor/equipment/sub/fee), name, unit, unit_cost_cents, vendor, sku, waste_pct, tax_code | RecipeComponents | MVP |
| CostRecipe | name, takeoff_item_id (nullable), output_unit, variables jsonb (e.g. depth_in), version | RecipeComponents, LineItems | MVP |
| RecipeComponent | recipe_id, catalog_item_id, qty_formula text (expression over takeoff qty + variables), sort | CostRecipe, CatalogItem | MVP |
| Estimate | job_id, number, version, status (draft/ready/sent/accepted/superseded), markup_pct, overhead_pct, tax_rate, totals snapshot | Job, LineItems, Proposals | MVP |
| LineItem | estimate_id, group, description, qty, unit, unit_cost_cents, unit_price_cents, source (recipe/manual), recipe_id, measurement_ids uuid[], optional (bool) | Estimate | MVP |
| Proposal | estimate_id, number, status (draft/rendered/sent/viewed/signed/declined/expired/void), pdf_file_id, signed_pdf_file_id, provider, provider_envelope_id, expires_at | Estimate, Signatures | MVP |
| Signature | proposal_id, signer_name, signer_email, signed_at, ip, provider_event_id | Proposal | MVP |
| WorkOrder | job_id, estimate_id, title, scope jsonb (line item refs), status (ready/scheduled/dispatched/in_progress/done/cancelled) | Job, ScheduleEntries | MVP (created on sign), v1 lifecycle |
| ScheduleEntry | work_order_id, crew_id, starts_at, ends_at, status (tentative/published/done/rained_out), route_order | WorkOrder, Crew | v1 |
| Crew | name, foreman_member_id, color, day_rate_cents | Members (via crew_member), ScheduleEntries | v1 |
| TimeEntry | member_id, work_order_id, crew_id, clock_in_at, clock_out_at, breaks jsonb, geo_in, geo_out, source (device/office), approved_by, client_uuid | Member, WorkOrder | v1 |
| Checklist (template) | name, scope (global/safety/job), items jsonb [{text, required, needs_photo, needs_signature}] | ChecklistRuns | v1 |
| ChecklistRun | checklist_id, work_order_id, member_id, responses jsonb, completed_at, client_uuid | Checklist, WorkOrder | v1 |
| Photo | file_id, job_id, work_order_id, taken_at, geo point, tags text[], caption, client_uuid | Job, WorkOrder | v1 (MVP: job photos via web upload) |
| DailyReport | work_order_id, date, crew_id, notes, weather jsonb, quantities_done jsonb, submitted_by, client_uuid | WorkOrder | v1 |
| Invoice | job_id, number, status (draft/sent/partially_paid/paid/void/overdue), due_date, totals, qbo_id, stripe_payment_link | Job, InvoiceLines, Payments | v1 |
| InvoiceLine | invoice_id, description, qty, unit_price_cents, line_item_id | Invoice | v1 |
| Payment | invoice_id, amount_cents, method (card/ach/check/cash), stripe_payment_intent_id, qbo_id, received_at | Invoice | v1 |
| File | storage_key, mime, bytes, sha256, status | many | MVP |
| ExternalLink | entity_type, entity_id, provider (qbo/stripe/esign), external_id, sync_state, last_synced_at | many | v1 |
| EventLog | provider, event_id (unique), payload jsonb, processed_at | webhooks | MVP |
| AuditLog | actor_member_id, entity_type, entity_id, action, diff jsonb | all | MVP |
| DetectionRun | takeoff_id, imagery_capture_id, mode (assist/classes), classes text[], status, gpu_seconds, error | Takeoff, DetectionFeatures | MVP (assist) / v1 |
| DetectionFeature | run_id, class, geom, score, accepted_measurement_id | DetectionRun | MVP / v1 |
| ParcelCache | provider, provider_parcel_id, geom, attrs jsonb, fetched_at | Locations | MVP |
| UsageEvent | kind (geocode/parcel/imagery_tile/cv_infer/esign_send), units, cost_estimate_cents | metering | MVP |

## Postgres / PostGIS schema sketch (not final; builder owns migrations)
```sql
create extension if not exists postgis;
create extension if not exists pgcrypto;

create table workspace (
  id uuid primary key, name text not null, slug text unique not null,
  timezone text not null default 'America/New_York', currency char(3) not null default 'USD',
  units_pref text not null default 'imperial' check (units_pref in ('imperial','metric')),
  features jsonb not null default '{}', created_at timestamptz not null default now()
);
create table app_user (id uuid primary key, email citext unique not null, name text, phone text, created_at timestamptz default now());
create table role (id uuid primary key, workspace_id uuid references workspace, name text not null, permissions text[] not null, is_system bool default false);
create table member (
  id uuid primary key, workspace_id uuid not null references workspace, user_id uuid references app_user,
  role_id uuid not null references role, status text not null check (status in ('invited','active','disabled')),
  invite_email citext, unique (workspace_id, user_id)
);

create table client (id uuid primary key, workspace_id uuid not null references workspace, type text not null, name text not null,
  billing_address jsonb, tags text[] default '{}', archived_at timestamptz);
create table contact (id uuid primary key, workspace_id uuid not null, client_id uuid not null references client on delete cascade,
  name text not null, email citext, phone text, role text, is_primary bool default false);
create table location (
  id uuid primary key, workspace_id uuid not null, client_id uuid references client,
  address jsonb not null, point geometry(Point,4326), parcel_cache_id uuid, site_geom geometry(MultiPolygon,4326), notes text
);
create index on location using gist (point);

create table job (
  id uuid primary key, workspace_id uuid not null, number text not null, client_id uuid references client, location_id uuid references location,
  name text not null,
  stage text not null check (stage in ('lead','estimating','proposed','won','lost','scheduled','in_progress','completed','invoiced','closed')),
  bid_value_cents bigint, owner_member_id uuid references member, source text, lost_reason text,
  unique (workspace_id, number)
);

-- Global public-program rows have workspace_id null; drone uploads (v1) are workspace-scoped.
create table imagery_source (
  id uuid primary key, workspace_id uuid references workspace,
  provider text not null check (provider in ('nc_ortho','nc_helene_2025','naip','county','nearmap','vexcel','drone_upload','other')),
  name text not null, coverage geometry(MultiPolygon,4326),
  capture_date date, gsd_cm numeric(6,2), bands text not null,
  license_text text, license_url text,
  allows_tracing bool not null default false, allows_ml_training bool not null default false,
  attribution text, verified_at timestamptz, notes text
);
create index on imagery_source using gist (coverage);
create table imagery_capture (
  id uuid primary key, workspace_id uuid references workspace,
  source_id uuid not null references imagery_source,
  coverage geometry(MultiPolygon,4326) not null, capture_date date not null,
  gsd_cm numeric(6,2) not null, bands text not null,
  leaf text check (leaf in ('on','off','mixed','unknown')),
  cog_key text, status text not null check (status in ('ingesting','ready','failed')),
  notes text
);
create index on imagery_capture using gist (coverage);
create table takeoff (
  id uuid primary key, workspace_id uuid not null, job_id uuid not null references job, location_id uuid references location,
  kind text not null check (kind in ('aerial','planset')), imagery_capture_id uuid references imagery_capture,
  status text not null check (status in ('draft','in_review','final')), version int not null default 1
);
create table takeoff_item (id uuid primary key, workspace_id uuid not null, name text not null,
  measure_kind text not null check (measure_kind in ('area','length','count')), default_unit text not null, category text, color text, archived_at timestamptz);
create table planset_sheet (id uuid primary key, workspace_id uuid not null, takeoff_id uuid references takeoff, file_id uuid, page_index int,
  name text, scale_units_per_pt numeric(18,8), scale_source text check (scale_source in ('calibrated','title_block','user')), is_vector bool);
create table measurement (
  id uuid primary key, workspace_id uuid not null, takeoff_id uuid not null references takeoff on delete cascade,
  takeoff_item_id uuid references takeoff_item, kind text not null check (kind in ('area','length','count')),
  geom geometry(Geometry,4326), sheet_id uuid references planset_sheet, sheet_geom geometry(Geometry),  -- exactly one of geom / sheet_geom
  value_m2 numeric(14,4), value_m numeric(14,4), count int,
  source text not null check (source in ('manual','ai_assist','ai_auto')), confidence real, label text,
  check ((geom is null) <> (sheet_geom is null))
);
create index on measurement using gist (geom);

create table catalog_item (id uuid primary key, workspace_id uuid not null, kind text not null check (kind in ('material','labor','equipment','sub','fee')),
  name text not null, unit text not null, unit_cost_cents bigint not null, waste_pct numeric(5,2) default 0, vendor text, sku text, tax_code text, archived_at timestamptz);
create table cost_recipe (id uuid primary key, workspace_id uuid not null, name text not null, takeoff_item_id uuid references takeoff_item,
  input_unit text not null, variables jsonb not null default '{}', version int not null default 1);
create table recipe_component (id uuid primary key, workspace_id uuid not null, recipe_id uuid not null references cost_recipe on delete cascade,
  catalog_item_id uuid not null references catalog_item, qty_formula text not null, sort int not null default 0);

create table estimate (id uuid primary key, workspace_id uuid not null, job_id uuid not null references job, number text not null, version int not null,
  status text not null check (status in ('draft','ready','sent','accepted','superseded')),
  markup_pct numeric(6,2) default 0, overhead_pct numeric(6,2) default 0, tax_rate numeric(6,4) default 0,
  subtotal_cents bigint, total_cents bigint, snapshot jsonb, unique (workspace_id, number, version));
create table line_item (id uuid primary key, workspace_id uuid not null, estimate_id uuid not null references estimate on delete cascade,
  grp text, description text not null, qty numeric(14,4) not null, unit text not null, unit_cost_cents bigint not null, unit_price_cents bigint not null,
  source text check (source in ('recipe','manual')), recipe_id uuid references cost_recipe, measurement_ids uuid[] default '{}', optional bool default false, sort int);

create table proposal (id uuid primary key, workspace_id uuid not null, estimate_id uuid not null references estimate, number text not null,
  status text not null check (status in ('draft','rendered','sent','viewed','signed','declined','expired','void')),
  pdf_file_id uuid, signed_pdf_file_id uuid, provider text, provider_envelope_id text, expires_at timestamptz);
create table signature (id uuid primary key, workspace_id uuid not null, proposal_id uuid not null references proposal,
  signer_name text, signer_email citext, signed_at timestamptz, ip inet, provider_event_id text);

create table work_order (id uuid primary key, workspace_id uuid not null, job_id uuid not null references job, estimate_id uuid references estimate,
  title text not null, scope jsonb, status text not null check (status in ('ready','scheduled','dispatched','in_progress','done','cancelled')));

-- v1
create table crew (id uuid primary key, workspace_id uuid not null, name text not null, foreman_member_id uuid references member, color text, day_rate_cents bigint);
create table crew_member (crew_id uuid references crew, member_id uuid references member, primary key (crew_id, member_id));
create table schedule_entry (id uuid primary key, workspace_id uuid not null, work_order_id uuid not null references work_order, crew_id uuid references crew,
  starts_at timestamptz not null, ends_at timestamptz not null, status text not null check (status in ('tentative','published','done','rained_out')), route_order int);
create table time_entry (id uuid primary key, workspace_id uuid not null, member_id uuid not null references member, work_order_id uuid references work_order,
  crew_id uuid references crew, clock_in_at timestamptz not null, clock_out_at timestamptz, breaks jsonb default '[]',
  geo_in geometry(Point,4326), geo_out geometry(Point,4326), source text, approved_by uuid, client_uuid uuid unique);
create table checklist (id uuid primary key, workspace_id uuid not null, name text not null, scope text, items jsonb not null);
create table checklist_run (id uuid primary key, workspace_id uuid not null, checklist_id uuid references checklist, work_order_id uuid references work_order,
  member_id uuid references member, responses jsonb, completed_at timestamptz, client_uuid uuid unique);
create table photo (id uuid primary key, workspace_id uuid not null, file_id uuid not null, job_id uuid references job, work_order_id uuid references work_order,
  taken_at timestamptz, geo geometry(Point,4326), tags text[] default '{}', caption text, client_uuid uuid unique);
create table daily_report (id uuid primary key, workspace_id uuid not null, work_order_id uuid references work_order, report_date date not null,
  crew_id uuid references crew, notes text, weather jsonb, quantities_done jsonb, submitted_by uuid, client_uuid uuid unique);
create table invoice (id uuid primary key, workspace_id uuid not null, job_id uuid references job, number text not null,
  status text not null check (status in ('draft','sent','partially_paid','paid','void','overdue')), due_date date,
  subtotal_cents bigint, tax_cents bigint, total_cents bigint, balance_cents bigint, stripe_payment_link text);
create table invoice_line (id uuid primary key, workspace_id uuid not null, invoice_id uuid references invoice on delete cascade, description text,
  qty numeric(14,4), unit_price_cents bigint, line_item_id uuid);
create table payment (id uuid primary key, workspace_id uuid not null, invoice_id uuid references invoice, amount_cents bigint not null,
  method text check (method in ('card','ach','check','cash','other')), stripe_payment_intent_id text unique, received_at timestamptz);

-- AI runs (05)
create table detection_run (id uuid primary key, workspace_id uuid not null, takeoff_id uuid not null references takeoff, imagery_capture_id uuid references imagery_capture,
  mode text check (mode in ('assist','classes')), classes text[], status text not null check (status in ('queued','running','succeeded','failed','cancelled')),
  gpu_seconds numeric(10,2), error text);
create table detection_feature (id uuid primary key, workspace_id uuid not null, run_id uuid not null references detection_run on delete cascade,
  class text, geom geometry(Geometry,4326) not null, score real, accepted_measurement_id uuid references measurement);

-- infra
create table external_link (id uuid primary key, workspace_id uuid not null, entity_type text, entity_id uuid, provider text, external_id text,
  sync_state text, last_synced_at timestamptz, unique (workspace_id, provider, entity_type, entity_id));
create table event_log (id uuid primary key, provider text not null, event_id text not null, payload jsonb, processed_at timestamptz, unique (provider, event_id));
create table audit_log (id bigserial primary key, workspace_id uuid not null, actor_member_id uuid, entity_type text, entity_id uuid, action text, diff jsonb, at timestamptz default now());
create table parcel_cache (id uuid primary key, provider text, provider_parcel_id text, geom geometry(MultiPolygon,4326), attrs jsonb, fetched_at timestamptz,
  unique (provider, provider_parcel_id));
create table usage_event (id bigserial primary key, workspace_id uuid not null, kind text, units numeric, cost_estimate_cents bigint, at timestamptz default now());

-- RLS pattern (repeat per tenant table)
alter table job enable row level security;
create policy tenant_isolation on job using (workspace_id = current_setting('app.workspace_id')::uuid);
```

## Invariants (test these)
- `measurement`: exactly one of `geom` / `sheet_geom`; `value_*` recomputed server-side on every write (`ST_Area(geom::geography)`, `ST_Length(geom::geography)`, or sheet units x scale²).
- Estimate totals are recomputed from line items; `snapshot` frozen when status leaves `draft`.
- A Proposal references an immutable estimate version; editing a sent estimate creates a new version and marks the old `superseded`.
- `parcel_cache` rows are never used as ML training input (vendor AI policy; see 05).
- Aerial takeoffs must reference an ImageryCapture whose source has `allows_tracing=true` and `verified_at` set; API and TiTiler reject the rest (403).
- Training/eval jobs may only read captures whose source has `allows_ml_training=true`.
- Public program ImagerySource/Capture rows are global (`workspace_id` null) and readable by every workspace; drone uploads (v1) are tenant-scoped.
- Mobile-created rows carry `client_uuid` (unique) for idempotent sync.
