-- member_fill_role_id was SECURITY DEFINER in 0002. It only reads a system
-- role, and those rows are visible to groundwork_app and groundwork_auth
-- without bypassing row security. The function does not need definer rights.
--
-- The imagery admin policies in 0004 let that setting read and write every
-- workspace's source, capture, and ingest job. An owner of workspace A could
-- patch workspace B's source. Admin mode still sees global rows
-- (workspace_id is null) and the caller's own rows. ADR 0023.

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
    and (
      workspace_id is null
      or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    )
  );

create policy imagery_source_admin_update on imagery_source
  for update
  using (
    current_setting('app.imagery_admin', true) = 'on'
    and (
      workspace_id is null
      or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    )
  )
  with check (
    current_setting('app.imagery_admin', true) = 'on'
    and (
      workspace_id is null
      or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    )
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
    and (
      workspace_id is null
      or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    )
  );

create policy imagery_capture_admin_update on imagery_capture
  for update
  using (
    current_setting('app.imagery_admin', true) = 'on'
    and (
      workspace_id is null
      or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    )
  )
  with check (
    current_setting('app.imagery_admin', true) = 'on'
    and (
      workspace_id is null
      or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    )
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
