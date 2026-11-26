# Migrations

SQL for Postgres 16 and PostGIS. `pnpm db:migrate` applies pending files and records them in `schema_migrations`. Running it again applies nothing new. `pnpm db:migrate:down` reverts the latest file.

The runner connects as the database owner (`DATABASE_URL`) because extensions and roles need that. Tenant queries use `groundwork_app` (`APP_DATABASE_URL`), which is not a superuser and does not bypass row security. The first migration creates that role.

A new tenant table enables and forces row level security in its own migration, grants `groundwork_app` only, and uses `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Do not edit an already-shipped migration to add that policy.

`0002_auth_workspaces.sql` adds the Better Auth tables and the six system roles. Sign-up uses `groundwork_auth`, created next to `groundwork_app` and not inside the migration transaction. Its policies name that role. `0003` is imagery and does not take `0002`. `0004_imagery_ingest.sql` is the ingest worker. `0005_crm_jobs.sql` is CRM. `0006_catalog_recipes.sql` is the catalog and cost recipes. The runner applies by set membership, so the numbers do not have to arrive in order.

`imagery_source` and `imagery_capture` are the exception. A null `workspace_id` is a global row. The read policy is `workspace_id is null or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Writes from `groundwork_app` require a non-null workspace id. ADR 0006.

`0004_imagery_ingest.sql` adds `imagery_ingest_job` and lets the app role update a global imagery row only when `app.imagery_admin` is `on` for that transaction. The API sets it after the member role is owner or admin. There is no admin delete policy. ADR 0008.

`0005_crm_jobs.sql` adds the CRM tables and the global `parcel_cache`. `parcel_cache` has no `workspace_id` and no row security. The other tables use the foundations policy and are granted to `groundwork_app` only. `0006` is the catalog. ADR 0009.

`0009_takeoff.sql` adds `takeoff` and `measurement` and references the `takeoff_item` table from `0006`. Both tables use the foundations policy and are granted to `groundwork_app` only. `0007` stays reserved for the catalog UI slice. The CRM UI shipped without a migration. ADR 0013.

`0011_estimating.sql` adds `estimate` and `line_item`. Both use the foundations policy and are granted to `groundwork_app` only. `0010` stays reserved for the map takeoff follow-up. ADR 0015.

`0012_detection.sql` adds `detection_run` and `detection_feature`. Both tables use the foundations policy and are granted to `groundwork_app` only. `usage_event` already exists in `0001` and is not recreated. ADR 0016. Accepting a draft reuses those statuses and `accepted_measurement_id`. There is no `0014` migration. `0013` stays reserved for the map takeoff follow-up and `0015` for estimating part 2. ADR 0018.
