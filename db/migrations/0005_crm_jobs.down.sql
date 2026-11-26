drop table if exists job_file;
drop table if exists job_task;
drop table if exists job_note;
drop table if exists job;
drop table if exists location;
drop table if exists contact;
drop table if exists client;
drop table if exists parcel_cache;

update "role"
set permissions = array_remove(permissions, 'jobs.force_won')
where is_system and workspace_id is null;
