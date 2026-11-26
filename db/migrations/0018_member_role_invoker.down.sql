create or replace function member_fill_role_id() returns trigger
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

drop policy if exists imagery_source_admin_select on imagery_source;
drop policy if exists imagery_source_admin_insert on imagery_source;
drop policy if exists imagery_source_admin_update on imagery_source;
drop policy if exists imagery_capture_admin_select on imagery_capture;
drop policy if exists imagery_capture_admin_insert on imagery_capture;
drop policy if exists imagery_capture_admin_update on imagery_capture;
drop policy if exists imagery_ingest_job_read on imagery_ingest_job;
drop policy if exists imagery_ingest_job_update on imagery_ingest_job;

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

create policy imagery_ingest_job_read on imagery_ingest_job
  for select
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    or current_setting('app.imagery_admin', true) = 'on'
  );

create policy imagery_ingest_job_update on imagery_ingest_job
  for update
  using (current_setting('app.imagery_admin', true) = 'on')
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and current_setting('app.imagery_admin', true) = 'on'
  );

drop policy if exists role_read on "role";
drop policy if exists role_write on "role";
drop policy if exists role_update on "role";
drop policy if exists role_delete on "role";

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
