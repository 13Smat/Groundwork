-- Proposals, templates, and signatures. Spec 08 part 1. ADR 0020.
--
-- Tenant policy, on all three tables:
--   workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
-- FORCE ROW LEVEL SECURITY. Grants go to groundwork_app only.
-- Trigger functions stay SECURITY INVOKER. There is no BYPASSRLS.
--
-- 0007, 0008, 0010, and 0013 through 0015 stay unused. This file is 0016.
-- estimate, file, and counters already exist. Do not edit those migrations.
-- pg-boss already owns its schema. This migration does not create a queue.
--
-- The spec 01 sketch has no proposal_template, public_token_hash,
-- selected_optional_line_ids, intro, terms, or a pinned snapshot. Spec 08
-- uses a template and a public page. The raw token is not a column.

create table proposal_template (
  id uuid primary key,
  workspace_id uuid not null,
  name text not null,
  intro text not null default '',
  scope_note text not null default '',
  terms text not null default '',
  include_site_map boolean not null default true,
  include_optional boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  unique (workspace_id, name),
  check (char_length(name) between 1 and 200),
  check (char_length(intro) <= 8000),
  check (char_length(scope_note) <= 8000),
  check (char_length(terms) <= 8000)
);

create index proposal_template_workspace_id_idx on proposal_template (workspace_id);

create table proposal (
  id uuid primary key,
  workspace_id uuid not null,
  estimate_id uuid not null references estimate (id),
  template_id uuid references proposal_template (id),
  number text not null,
  status text not null default 'draft' check (
    status in (
      'draft', 'rendered', 'sent', 'viewed', 'signed', 'declined', 'expired', 'void'
    )
  ),
  intro text not null default '',
  scope_note text not null default '',
  terms text not null default '',
  include_site_map boolean not null default true,
  include_optional boolean not null default true,
  selected_optional_line_ids uuid[] not null default '{}',
  public_token_hash text not null,
  estimate_version integer not null check (estimate_version >= 1),
  snapshot jsonb not null,
  pdf_file_id uuid references file (id),
  signed_pdf_file_id uuid references file (id),
  provider text,
  provider_envelope_id text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  unique (workspace_id, number),
  check (number ~ '^P-[0-9]+$'),
  check (public_token_hash ~ '^[0-9a-f]{64}$'),
  check (char_length(intro) <= 8000),
  check (char_length(scope_note) <= 8000),
  check (char_length(terms) <= 8000),
  check (provider is null or char_length(provider) <= 40),
  check (provider_envelope_id is null or char_length(provider_envelope_id) <= 200),
  check (jsonb_typeof(snapshot) = 'object')
);

create index proposal_workspace_id_idx on proposal (workspace_id);
create index proposal_estimate_id_idx on proposal (estimate_id);

-- One open proposal pins an estimate version. A voided row can be replaced.
create unique index proposal_one_open_per_estimate
  on proposal (estimate_id)
  where status <> 'void';

create table signature (
  id uuid primary key,
  workspace_id uuid not null,
  proposal_id uuid not null references proposal (id) on delete cascade,
  signer_name text,
  signer_email citext,
  signed_at timestamptz,
  ip inet,
  provider_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (signer_name is null or char_length(signer_name) <= 200),
  check (signer_email is null or char_length(signer_email::text) <= 320),
  check (provider_event_id is null or char_length(provider_event_id) <= 200)
);

create index signature_workspace_id_idx on signature (workspace_id);
create index signature_proposal_id_idx on signature (proposal_id);

create trigger proposal_template_set_updated_at
  before update on proposal_template
  for each row
  execute function set_updated_at();

create trigger proposal_set_updated_at
  before update on proposal
  for each row
  execute function set_updated_at();

create trigger signature_set_updated_at
  before update on signature
  for each row
  execute function set_updated_at();

create function proposal_before_update()
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
    raise exception 'a proposal cannot move to another workspace' using errcode = 'P0001';
  end if;
  if new.estimate_id is distinct from old.estimate_id then
    raise exception 'a proposal cannot move to another estimate' using errcode = 'P0001';
  end if;
  if new.snapshot is distinct from old.snapshot then
    raise exception 'a proposal snapshot is pinned' using errcode = 'P0001';
  end if;
  if new.number is distinct from old.number
     or new.estimate_version is distinct from old.estimate_version then
    raise exception 'a proposal number is fixed' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status
     and not (
       (old.status = 'draft' and new.status in ('rendered', 'void'))
       or (old.status = 'rendered' and new.status in ('sent', 'void'))
       or (old.status = 'sent' and new.status in ('viewed', 'declined', 'expired', 'void'))
       or (old.status = 'viewed' and new.status in ('signed', 'declined', 'expired', 'void'))
       or (old.status = 'declined' and new.status = 'void')
       or (old.status = 'expired' and new.status = 'void')
     ) then
    raise exception 'illegal proposal transition from % to %', old.status, new.status
      using errcode = 'P0001';
  end if;
  if old.status <> 'draft'
     and (
       new.intro is distinct from old.intro
       or new.scope_note is distinct from old.scope_note
       or new.terms is distinct from old.terms
       or new.include_site_map is distinct from old.include_site_map
       or new.include_optional is distinct from old.include_optional
       or new.selected_optional_line_ids is distinct from old.selected_optional_line_ids
       or new.expires_at is distinct from old.expires_at
       or new.template_id is distinct from old.template_id
     ) then
    raise exception 'only a draft proposal can be edited' using errcode = 'P0001';
  end if;
  if old.status = 'draft' and new.status = 'rendered' and new.pdf_file_id is null then
    raise exception 'rendering a proposal stores a pdf' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger proposal_before_update
  before update on proposal
  for each row
  execute function proposal_before_update();

-- Returning a pinned estimate to draft would unfreeze the snapshot. Clone a version.
create function proposal_pin_estimate()
returns trigger
language plpgsql
as $$
declare
  super boolean;
begin
  select rolsuper into super from pg_roles where rolname = current_user;
  if super then
    return new;
  end if;
  if new.status = 'draft'
     and old.status is distinct from 'draft'
     and exists (select 1 from proposal where estimate_id = old.id) then
    raise exception 'a proposal pins this estimate; clone a version' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger proposal_pin_estimate
  before update on estimate
  for each row
  execute function proposal_pin_estimate();

alter table proposal_template enable row level security;
alter table proposal_template force row level security;
alter table proposal enable row level security;
alter table proposal force row level security;
alter table signature enable row level security;
alter table signature force row level security;

create policy tenant_isolation on proposal_template
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on proposal
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on signature
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

grant select, insert, update, delete on proposal_template, proposal, signature to groundwork_app;
grant execute on function proposal_before_update() to groundwork_app;
grant execute on function proposal_pin_estimate() to groundwork_app;
