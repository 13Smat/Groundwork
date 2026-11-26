# ADR 0005: Local infra, the app role, and infra table shapes

## Status

Accepted (2026-11-26).

## Context

Foundations 2 needs a local Postgres/PostGIS, MinIO, Mailpit, and a TiTiler placeholder, plus SQL migrations and row level security. The specs disagree in a few places that this migration has to touch. `docs/specs/OPEN-QUESTIONS.md` already lists them. This ADR records which concrete shape the migration uses. It does not edit the spec files.

Checked on 2026-11-26:

- Docker Hub `postgis/postgis:16-3.4` and `axllent/mailpit:v1.34.0` and `library/debian:bookworm-slim` answered 200 on the tag API.
- `ghcr.io/developmentseed/titiler:2.0.5` answered 200 for the manifest after an anonymous pull token. The Dockerfile for that tag listens on port 80.
- Docker Hub `minio/minio` tag `RELEASE.2025-09-07T16-13-09Z` answered 404. The same release's linux amd64 and arm64 binaries, and the `mc` release `RELEASE.2025-08-13T08-35-41Z` binaries, answered 200 on GitHub, with a `.sha256sum` asset next to each.
- Installed packages: `pg` 8.23.1, `kysely` 0.29.9, `pg-boss` 12.40.0, `pino` 10.4.0, `@aws-sdk/client-s3` 3.1178.0, `@opentelemetry/sdk-node` 0.301.2. `pg-boss` `start` and `stop({ graceful, close, timeout })` are on the installed type declarations. The S3 client accepts `requestChecksumCalculation`.

Postgres superusers and roles with `BYPASSRLS` skip row security even when it is forced. The ticket says the app connection must be neither.

## Decision

- Compose runs `postgis/postgis:16-3.4`, Mailpit `v1.34.0`, and TiTiler `ghcr.io/developmentseed/titiler:2.0.5`. MinIO and `mc` are built from those GitHub release binaries and checked with the published sha256. The laptop passwords in `docker-compose.yml` are local defaults. `NODE_ENV=production` refuses them. `.env.example` stays empty.
- TiTiler in compose is a placeholder. It does not serve a fixture COG and it does not enforce `allows_tracing` or `verified_at`. That stays with `services/tiles`.
- Migrations are SQL files in `db/migrations`, applied by `pg` and recorded in `schema_migrations`. Kysely is the query builder, not the migrator. `pnpm db:migrate` is idempotent. `pnpm db:migrate:down` reverts the latest file.
- The database owner (`DATABASE_URL`) runs migrations and pg-boss, because both run DDL. Tenant queries use the login role `groundwork_app` (`APP_DATABASE_URL`): `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`. `withWorkspaceContext` sets `app.workspace_id` with `set_config(..., true)` inside a transaction and rejects a superuser or `BYPASSRLS` role.
- Tenant tables in this migration are `counters`, `file`, `audit_log`, and `usage_event`. Each has `enable` and `force` row level security and this policy for both `using` and `with check`:

```sql
workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
```

- Where spec 01's sketch and its header disagree, the migration follows the sketch. `event_log` has no `workspace_id` and no tenant policy. `audit_log` and `usage_event` use `bigserial` and `at`.
- `counters` and `file` are not in the sketch. They get the columns the specs name, plus `id`, `created_at`, `updated_at`, and `created_by` on those two tables. No foreign key to `workspace`, because that table is not in this slice. `file.status` is unconstrained text. `counters.last_value` has no default. `file.storage_key` is unique. A workspace upload key is `workspaces/{workspaceId}/{fileId}`.
- Presign lifetime defaults to 900 seconds, capped at 3600. The S3 client uses path-style addressing and `requestChecksumCalculation: "WHEN_REQUIRED"` so the installed AWS SDK can talk to MinIO.
- OpenTelemetry starts only when `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set. Traces go to that OTLP HTTP endpoint. There is no vendor project.

## Alternatives

- Pull `minio/minio` from Docker Hub. Rejected. The tag URL returned 404 on 2026-11-26.
- Connect the API as the database owner and rely on `FORCE ROW LEVEL SECURITY`. Rejected. A superuser bypasses forced row security. The ticket requires a non-superuser, non-`BYPASSRLS` role.
- Put a `workspace_id` on `event_log`, a status check on `file`, or a starting value of 1001 on `counters`. Rejected. Those are unspecified. They stay in `docs/specs/OPEN-QUESTIONS.md`.
- Use Kysely's TypeScript migrator. Rejected. The repo layout and this ticket ask for SQL files in `db/migrations`.

## Consequences

- A later migration that adds a tenant table has to enable and force row security, add the policy above, and grant `groundwork_app`.
- A worker that reads tenant rows must use the app pool and `withWorkspaceContext`. The pg-boss connection is the database owner and bypasses row security. This slice only starts the queue.
- The imagery rule for a null `workspace_id` is still unwritten. Those tables are not created here.
- Sentry, named in spec 00, is not wired. Wiring it would be a vendor project.

## References

- `docs/specs/00-architecture.md`
- `docs/specs/01-data-model.md`
- `docs/specs/OPEN-QUESTIONS.md`
- `docs/adr/0001-stack.md`
- `docs/adr/0004-node-24.md`
