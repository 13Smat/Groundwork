-- member_fill_role_id was SECURITY DEFINER in 0002. It only reads a system
-- role, and those rows are visible to groundwork_app and groundwork_auth
-- without bypassing row security. The function does not need definer rights.
--
-- The imagery admin policies in 0004 let that setting read and write every
-- workspace's source, capture, and ingest job, including rows whose
-- workspace_id is null. An owner could change a global source that every
-- workspace reads. Admin mode may still read a global row. Insert and update
-- require workspace_id = app.workspace_id. Global rows are inserted by the
-- migration owner, which bypasses row security. ADR 0023.
--
-- The role policy was FOR ALL and its USING clause matched workspace_id is
-- null, so an update could target a system role. Reads of system roles stay
-- on role_read. Writes use role_write and do not match a null workspace_id.

create or replace function member_fill_role_id() returns trigger
language plpgsql
security invoker
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

drop policy imagery_source_admin_select on imagery_source;
drop policy imagery_source_admin_insert on imagery_source;
drop policy imagery_source_admin_update on imagery_source;
drop policy imagery_capture_admin_select on imagery_capture;
drop policy imagery_capture_admin_insert on imagery_capture;
drop policy imagery_capture_admin_update on imagery_capture;
drop policy imagery_ingest_job_read on imagery_ingest_job;
drop policy imagery_ingest_job_update on imagery_ingest_job;

create policy imagery_source_admin_select on imagery_source
  for select
  using (
    current_setting('app.imagery_admin', true) = 'on'
    and (
      workspace_id is null
      or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    )
  );

create policy imagery_source_admin_insert on imagery_source
  for insert
  with check (
    current_setting('app.imagery_admin', true) = 'on'
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy imagery_source_admin_update on imagery_source
  for update
  using (
    current_setting('app.imagery_admin', true) = 'on'
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  with check (
    current_setting('app.imagery_admin', true) = 'on'
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy imagery_capture_admin_select on imagery_capture
  for select
  using (
    current_setting('app.imagery_admin', true) = 'on'
    and (
      workspace_id is null
      or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    )
  );

create policy imagery_capture_admin_insert on imagery_capture
  for insert
  with check (
    current_setting('app.imagery_admin', true) = 'on'
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy imagery_capture_admin_update on imagery_capture
  for update
  using (
    current_setting('app.imagery_admin', true) = 'on'
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  with check (
    current_setting('app.imagery_admin', true) = 'on'
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy imagery_ingest_job_read on imagery_ingest_job
  for select
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy imagery_ingest_job_update on imagery_ingest_job
  for update
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and current_setting('app.imagery_admin', true) = 'on'
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and current_setting('app.imagery_admin', true) = 'on'
  );

drop policy tenant_isolation on "role";

create policy role_read on "role"
  for select
  using (
    current_user = 'groundwork_auth'
    or workspace_id is null
    or workspace_id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy role_write on "role"
  for insert
  with check (
    current_user = 'groundwork_auth'
    or workspace_id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy role_update on "role"
  for update
  using (
    current_user = 'groundwork_auth'
    or workspace_id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  with check (
    current_user = 'groundwork_auth'
    or workspace_id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy role_delete on "role"
  for delete
  using (
    current_user = 'groundwork_auth'
    or workspace_id::uuid = nullif(current_setting('app.workspace_id', true), '')::uuid
  );
