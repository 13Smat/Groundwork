-- Auth and workspaces. ADR 0007.
--
-- Better Auth 1.7.28 binds every id as text. Postgres has no uuid = text
-- operator, so these primary keys are text holding UUIDv7 (the check below).
-- Tenant comparisons still use the foundations expression, with a ::uuid cast
-- on the text column:
--   workspace_id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
--
-- groundwork_auth is the Better Auth connection. It is not a superuser and
-- does not bypass row security. Policies name that role because its queries
-- run before a workspace exists. groundwork_app cannot assume that role.
-- The role itself is created outside this transaction (CREATE ROLE).
--
-- Imagery ingest uses 0003. Do not take that number.

create table app_user (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  name text not null,
  email citext not null unique,
  email_verified boolean not null default false,
  image text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  name text not null,
  slug text not null unique,
  logo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata text,
  timezone text not null default 'America/New_York',
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  units_pref text not null default 'imperial' check (units_pref in ('imperial', 'metric')),
  features jsonb not null default '{}',
  plan text,
  address jsonb,
  license_number text
);

-- "role" is a reserved word and stays quoted. System rows have a null
-- workspace_id so they can be read without a tenant setting. Custom roles
-- (later) are workspace-scoped. ADR 0007.
create table "role" (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  workspace_id text check (
    workspace_id is null
    or workspace_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  name text not null,
  permissions text[] not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index role_system_name_uidx on "role" (name) where workspace_id is null;
create unique index role_workspace_name_uidx on "role" (workspace_id, name) where workspace_id is not null;

insert into "role" (id, workspace_id, name, permissions, is_system) values
  (
    '018f3c2e-7b10-7000-8000-000000000001',
    null,
    'owner',
    array[
      'workspace.manage', 'billing', 'members.manage', 'crm.*', 'jobs.*',
      'takeoff.*', 'estimate.*', 'proposal.send', 'catalog.manage',
      'schedule.manage', 'time.own', 'checklist.own', 'photo.own',
      'time.approve', 'invoice.*'
    ],
    true
  ),
  (
    '018f3c2e-7b10-7000-8000-000000000002',
    null,
    'admin',
    array[
      'workspace.manage', 'members.manage', 'crm.*', 'jobs.*',
      'takeoff.*', 'estimate.*', 'proposal.send', 'catalog.manage',
      'schedule.manage', 'time.own', 'checklist.own', 'photo.own',
      'time.approve', 'invoice.*'
    ],
    true
  ),
  (
    '018f3c2e-7b10-7000-8000-000000000003',
    null,
    'estimator',
    array[
      'crm.*', 'jobs.*', 'takeoff.*', 'estimate.*', 'proposal.send',
      'catalog.manage', 'time.own', 'checklist.own', 'photo.own'
    ],
    true
  ),
  (
    '018f3c2e-7b10-7000-8000-000000000004',
    null,
    'office',
    array[
      'crm.*', 'jobs.*', 'takeoff.read', 'estimate.read', 'proposal.read',
      'schedule.manage', 'time.own', 'checklist.own', 'photo.own',
      'time.approve', 'invoice.*'
    ],
    true
  ),
  (
    '018f3c2e-7b10-7000-8000-000000000005',
    null,
    'foreman',
    array[
      'crm.read.assigned', 'jobs.read.assigned', 'schedule.read',
      'time.own', 'checklist.own', 'photo.own', 'time.approve.crew'
    ],
    true
  ),
  (
    '018f3c2e-7b10-7000-8000-000000000006',
    null,
    'crew',
    array['schedule.read.own', 'time.own', 'checklist.own', 'photo.own'],
    true
  );

create table session (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  user_id text not null references app_user (id) on delete cascade,
  active_organization_id text check (
    active_organization_id is null
    or active_organization_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) references workspace (id) on delete set null
);

create index session_user_id_idx on session (user_id);

create table account (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  account_id text not null,
  provider_id text not null,
  user_id text not null references app_user (id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, account_id)
);

create index account_user_id_idx on account (user_id);

create table verification (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index verification_identifier_idx on verification (identifier);

create table member (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  workspace_id text not null references workspace (id) on delete cascade,
  user_id text check (
    user_id is null
    or user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) references app_user (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'estimator', 'office', 'foreman', 'crew')),
  -- Nullable only so Better Auth's schema check accepts the table. The
  -- member_fill_role_id trigger sets it from the role name before insert.
  role_id text references "role" (id),
  status text not null default 'active' check (status in ('invited', 'active', 'disabled', 'revoked')),
  invite_email citext,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index member_workspace_id_idx on member (workspace_id);
create index member_user_id_idx on member (user_id);
create unique index member_workspace_user_uidx
  on member (workspace_id, user_id)
  where user_id is not null and status <> 'revoked';
create unique index member_pending_email_uidx
  on member (workspace_id, invite_email)
  where status = 'invited' and invite_email is not null;

create table invitation (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  workspace_id text not null references workspace (id) on delete cascade,
  email citext not null,
  role text check (role is null or role in ('owner', 'admin', 'estimator', 'office', 'foreman', 'crew')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'canceled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  inviter_id text not null references app_user (id) on delete cascade,
  member_id text references member (id) on delete cascade
);

create index invitation_workspace_id_idx on invitation (workspace_id);
create index invitation_email_idx on invitation (email);
create unique index invitation_pending_email_uidx
  on invitation (workspace_id, email)
  where status = 'pending';

-- Plugin inserts set the role name and omit role_id. Fill it from the
-- system role of that name. Our routes set role_id themselves.
create function member_fill_role_id() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role_id is null then
    select id into new.role_id
    from "role"
    where name = new.role and is_system and workspace_id is null;
  end if;
  if new.role_id is null then
    raise exception 'role % is not a system role', new.role using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger member_fill_role_id_trg
  before insert on member
  for each row
  execute function member_fill_role_id();

create function set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspace_set_updated_at
  before update on workspace
  for each row
  execute function set_updated_at();

create trigger member_set_updated_at
  before update on member
  for each row
  execute function set_updated_at();

alter table app_user enable row level security;
alter table app_user force row level security;
alter table session enable row level security;
alter table session force row level security;
alter table account enable row level security;
alter table account force row level security;
alter table verification enable row level security;
alter table verification force row level security;
alter table workspace enable row level security;
alter table workspace force row level security;
alter table "role" enable row level security;
alter table "role" force row level security;
alter table member enable row level security;
alter table member force row level security;
alter table invitation enable row level security;
alter table invitation force row level security;

-- Identity tables. The app role sees itself, and the users in the workspace
-- it has already been allowed to open. Sign-up writes go through groundwork_auth.
create policy identity_access on app_user
  using (
    current_user = 'groundwork_auth'
    or id = nullif(current_setting('app.user_id', true), '')
    or id in (
      select m.user_id from member m
      where m.user_id is not null
        and m.workspace_id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
    )
  )
  with check (current_user = 'groundwork_auth');

create policy auth_connection on session
  using (current_user = 'groundwork_auth')
  with check (current_user = 'groundwork_auth');

create policy auth_connection on account
  using (current_user = 'groundwork_auth')
  with check (current_user = 'groundwork_auth');

create policy auth_connection on verification
  using (current_user = 'groundwork_auth')
  with check (current_user = 'groundwork_auth');

create policy tenant_isolation on workspace
  using (
    current_user = 'groundwork_auth'
    or id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
    or id in (
      select m.workspace_id from member m
      where m.user_id = nullif(current_setting('app.user_id', true), '')
    )
  )
  with check (
    current_user = 'groundwork_auth'
    or id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

-- System roles stay readable so GET /roles works before a workspace is chosen.
-- A custom role is visible only inside its workspace.
create policy tenant_isolation on "role"
  using (
    current_user = 'groundwork_auth'
    or workspace_id is null
    or workspace_id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  with check (
    current_user = 'groundwork_auth'
    or workspace_id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy tenant_isolation on member
  using (
    current_user = 'groundwork_auth'
    or workspace_id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
    or user_id = nullif(current_setting('app.user_id', true), '')
  )
  with check (
    current_user = 'groundwork_auth'
    or workspace_id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

-- app.invite_id reveals a single invitation row so accept can run before the
-- caller is a member. The id is the unguessable token.
create policy tenant_isolation on invitation
  using (
    current_user = 'groundwork_auth'
    or workspace_id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
    or id = nullif(current_setting('app.invite_id', true), '')
  )
  with check (
    current_user = 'groundwork_auth'
    or workspace_id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

grant usage on schema public to groundwork_auth;
grant select, insert, update, delete on app_user, session, account, verification, workspace, member, invitation, "role" to groundwork_auth;
grant select, insert, update, delete on workspace, member, invitation, "role" to groundwork_app;
grant select on app_user to groundwork_app;
grant execute on function member_fill_role_id() to groundwork_app, groundwork_auth;
grant execute on function set_updated_at() to groundwork_app, groundwork_auth;
