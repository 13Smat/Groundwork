drop trigger if exists imagery_capture_status_transition on imagery_capture;
drop function if exists imagery_capture_reject_illegal_transition();

drop policy if exists imagery_capture_admin_update on imagery_capture;
drop policy if exists imagery_capture_admin_insert on imagery_capture;
drop policy if exists imagery_capture_admin_select on imagery_capture;
drop policy if exists imagery_source_admin_update on imagery_source;
drop policy if exists imagery_source_admin_insert on imagery_source;
drop policy if exists imagery_source_admin_select on imagery_source;

drop table if exists imagery_ingest_job;
