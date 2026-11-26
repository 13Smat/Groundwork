# Migrations

SQL for Postgres 16 and PostGIS. `pnpm db:migrate` applies pending files and records them in `schema_migrations`. Running it again applies nothing new. `pnpm db:migrate:down` reverts the latest file.

The runner connects as the database owner (`DATABASE_URL`) because extensions and roles need that. Tenant queries use `groundwork_app` (`APP_DATABASE_URL`), which is not a superuser and does not bypass row security. The first migration creates that role.

A new tenant table needs the policy in `0001_extensions_and_infra.sql`, `enable` and `force` row level security, and a grant to `groundwork_app`.

`0002_auth_workspaces.sql` adds the Better Auth tables and the six system roles. Sign-up uses `groundwork_auth`, created next to `groundwork_app` and not inside the migration transaction. Its policies name that role. `0003` is imagery and does not take `0002`.

`imagery_source` and `imagery_capture` are the exception. A null `workspace_id` is a global row. The read policy is `workspace_id is null or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Writes from `groundwork_app` require a non-null workspace id. ADR 0006.
