# Migrations

SQL for Postgres 16 and PostGIS. `pnpm db:migrate` applies pending files and records them in `schema_migrations`. Running it again applies nothing new. `pnpm db:migrate:down` reverts the latest file.

The runner connects as the database owner (`DATABASE_URL`) because extensions and roles need that. Tenant queries use `groundwork_app` (`APP_DATABASE_URL`), which is not a superuser and does not bypass row security. The first migration creates that role.

A new tenant table enables and forces row level security in its own migration, grants `groundwork_app` only, and uses `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Do not edit an already-shipped migration to add that policy.

`0002_auth_workspaces.sql` adds the Better Auth tables and the six system roles. Sign-up uses `groundwork_auth`, created next to `groundwork_app` and not inside the migration transaction. Its policies name that role. `0003` is imagery and does not take `0002`. `0006_catalog_recipes.sql` is the catalog and cost recipes. `0004` and `0005` are reserved for other slices and may land later. The runner applies by set membership, so the numbers do not have to arrive in order.

`imagery_source` and `imagery_capture` are the exception. A null `workspace_id` is a global row. The read policy is `workspace_id is null or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Writes from `groundwork_app` require a non-null workspace id. ADR 0006.
