-- Foundations infra. The migrate script creates the login role groundwork_app
-- before this file runs. CREATE ROLE cannot run inside this transaction.
--
-- Tenant policy, on every table whose workspace_id is not null:
--   workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
-- FORCE ROW LEVEL SECURITY so the table owner is also subject to it.
-- Superusers and BYPASSRLS still bypass that. The API must not use those roles.
--
-- event_log follows the spec 01 sketch and has no workspace_id, so it has no
-- tenant policy. counters.last_value has no default: the sequence start is
-- still an open question. file.status is unconstrained text: the allowed
-- values are not specified. There is no foreign key to workspace: that table
-- is not created in this slice. ADR 0005.

create extension if not exists postgis;
create extension if not exists pgcrypto;
create extension if not exists citext;

create table counters (
  id uuid primary key,
  workspace_id uuid not null,
  prefix text not null check (prefix in ('J', 'E', 'P', 'INV')),
  last_value bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  unique (workspace_id, prefix)
);

create table file (
  id uuid primary key,
  workspace_id uuid not null,
  storage_key text not null unique,
  mime text,
  bytes bigint,
  sha256 text,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create index file_workspace_id_idx on file (workspace_id);

-- Sketch in spec 01. No workspace_id, so no tenant policy.
create table event_log (
  id uuid primary key,
  provider text not null,
  event_id text not null,
  payload jsonb,
  processed_at timestamptz,
  unique (provider, event_id)
);

-- Sketch uses bigserial and at, which disagrees with the uuid / created_at header.
create table audit_log (
  id bigserial primary key,
  workspace_id uuid not null,
  actor_member_id uuid,
  entity_type text,
  entity_id uuid,
  action text,
  diff jsonb,
  at timestamptz default now()
);

create index audit_log_workspace_id_idx on audit_log (workspace_id);

create table usage_event (
  id bigserial primary key,
  workspace_id uuid not null,
  kind text,
  units numeric,
  cost_estimate_cents bigint,
  at timestamptz default now()
);

create index usage_event_workspace_id_idx on usage_event (workspace_id);

alter table counters enable row level security;
alter table counters force row level security;
alter table file enable row level security;
alter table file force row level security;
alter table audit_log enable row level security;
alter table audit_log force row level security;
alter table usage_event enable row level security;
alter table usage_event force row level security;

create policy tenant_isolation on counters
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on file
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on audit_log
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on usage_event
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

grant usage on schema public to groundwork_app;
grant select, insert, update, delete on counters, file, event_log, audit_log, usage_event to groundwork_app;
grant usage, select on sequence audit_log_id_seq, usage_event_id_seq to groundwork_app;
