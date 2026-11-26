-- Work orders and the public proposal token lookup. Spec 08 part 2. ADR 0021.
--
-- event_log already exists in 0001. It has no workspace_id. This migration
-- does not add one and does not recreate the table. Webhook idempotency uses
-- the existing unique (provider, event_id).
--
-- Tenant policy, on work_order and proposal_token:
--   workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
-- FORCE ROW LEVEL SECURITY. Grants go to groundwork_app only.
-- Trigger functions stay SECURITY INVOKER. There is no BYPASSRLS.
--
-- proposal_token is the public-link lookup. A second SELECT policy matches
-- token_hash to app.proposal_token_hash so the API can learn the workspace
-- before it sets app.workspace_id. The hash is a capability. Writes still
-- require the tenant policy. The proposal table itself stays tenant-only.

alter table proposal
  add column recipients jsonb not null default '[]',
  add column message text not null default '',
  add column bounced boolean not null default false;

alter table proposal
  add constraint proposal_recipients_array check (jsonb_typeof(recipients) = 'array'),
  add constraint proposal_message_length check (char_length(message) <= 4000);

create unique index proposal_public_token_hash_key on proposal (public_token_hash);

create index proposal_provider_envelope_idx
  on proposal (provider, provider_envelope_id)
  where provider_envelope_id is not null;

create unique index signature_one_per_signer
  on signature (proposal_id, signer_email)
  where signer_email is not null;

create table proposal_token (
  token_hash text primary key,
  workspace_id uuid not null,
  proposal_id uuid not null references proposal (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (token_hash ~ '^[0-9a-f]{64}$')
);

create index proposal_token_workspace_id_idx on proposal_token (workspace_id);
create index proposal_token_proposal_id_idx on proposal_token (proposal_id);

insert into proposal_token (token_hash, workspace_id, proposal_id)
select public_token_hash, workspace_id, id from proposal;

create table work_order (
  id uuid primary key,
  workspace_id uuid not null,
  job_id uuid not null references job (id),
  estimate_id uuid references estimate (id),
  proposal_id uuid references proposal (id),
  title text not null,
  scope jsonb not null default '{}',
  status text not null default 'ready' check (
    status in ('ready', 'scheduled', 'dispatched', 'in_progress', 'done', 'cancelled')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  check (char_length(title) between 1 and 200),
  check (jsonb_typeof(scope) = 'object')
);

create index work_order_workspace_id_idx on work_order (workspace_id);
create index work_order_job_id_idx on work_order (job_id);

create unique index work_order_one_per_proposal
  on work_order (proposal_id)
  where proposal_id is not null;

create trigger work_order_set_updated_at
  before update on work_order
  for each row
  execute function set_updated_at();

create function work_order_before_update()
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
  if new.workspace_id is distinct from old.workspace_id
     or new.job_id is distinct from old.job_id
     or new.estimate_id is distinct from old.estimate_id
     or new.proposal_id is distinct from old.proposal_id then
    raise exception 'a work order cannot move to another job' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status
     and not (
       (old.status = 'ready' and new.status in ('scheduled', 'cancelled'))
       or (old.status = 'scheduled' and new.status in ('dispatched', 'cancelled'))
       or (old.status = 'dispatched' and new.status in ('in_progress', 'cancelled'))
       or (old.status = 'in_progress' and new.status in ('done', 'cancelled'))
     ) then
    raise exception 'illegal work order transition from % to %', old.status, new.status
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger work_order_before_update
  before update on work_order
  for each row
  execute function work_order_before_update();

-- 0016 froze optional items and expiry once the proposal left draft.
-- The client chooses optional items while the proposal is rendered, and send
-- records expiry, recipients, and a replacement public hash in that same state.
create or replace function proposal_before_update()
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
       or new.template_id is distinct from old.template_id
     ) then
    raise exception 'only a draft proposal can be edited' using errcode = 'P0001';
  end if;
  if new.selected_optional_line_ids is distinct from old.selected_optional_line_ids
     and not (
       old.status = 'draft'
       or (old.status = 'rendered' and new.status = 'rendered')
     ) then
    raise exception 'optional items can change only before the proposal is sent'
      using errcode = 'P0001';
  end if;
  if new.expires_at is distinct from old.expires_at
     and old.status not in ('draft', 'rendered') then
    raise exception 'expiry is fixed once the proposal is sent' using errcode = 'P0001';
  end if;
  if new.public_token_hash is distinct from old.public_token_hash
     and old.status not in ('draft', 'rendered') then
    raise exception 'the public token is fixed once the proposal is sent' using errcode = 'P0001';
  end if;
  if (new.recipients is distinct from old.recipients or new.message is distinct from old.message)
     and old.status not in ('draft', 'rendered') then
    raise exception 'recipients are fixed once the proposal is sent' using errcode = 'P0001';
  end if;
  if new.bounced is distinct from old.bounced
     and old.status not in ('sent', 'viewed') then
    raise exception 'a bounce applies to a sent proposal' using errcode = 'P0001';
  end if;
  if old.provider_envelope_id is not null
     and new.provider_envelope_id is distinct from old.provider_envelope_id then
    raise exception 'the envelope id is fixed' using errcode = 'P0001';
  end if;
  if old.status = 'draft' and new.status = 'rendered' and new.pdf_file_id is null then
    raise exception 'rendering a proposal stores a pdf' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

alter table proposal_token enable row level security;
alter table proposal_token force row level security;
alter table work_order enable row level security;
alter table work_order force row level security;

create policy tenant_isolation on proposal_token
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy proposal_token_lookup on proposal_token
  for select
  using (token_hash = nullif(current_setting('app.proposal_token_hash', true), ''));

create policy tenant_isolation on work_order
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

grant select, insert, update, delete on proposal_token, work_order to groundwork_app;
grant execute on function work_order_before_update() to groundwork_app;
