# Migrations

SQL for Postgres 16 and PostGIS. `pnpm db:migrate` applies pending files and records them in `schema_migrations`. Running it again applies nothing new. `pnpm db:migrate:down` reverts the latest file.

The runner connects as the database owner (`DATABASE_URL`) because extensions and roles need that. Tenant queries use `groundwork_app` (`APP_DATABASE_URL`), which is not a superuser and does not bypass row security. The first migration creates that role.

A new tenant table needs the policy in `0001_extensions_and_infra.sql`, `enable` and `force` row level security, and a grant to `groundwork_app`.
