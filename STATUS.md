# Status

Foundations 2 (local infra, database, row level security, and the office shell) is the current slice. Owner: Andy Silver. The agent opens a draft PR and does not merge.

## Done

- Ticket 0: `AGENTS.md`, ADR 0001 through ADR 0003, the build specs, and the open-question list.
- Ticket 1: Node 24 LTS, pnpm workspaces, Turborepo, the Fastify API with problem+json, the Vite office shell, and `pnpm check` in GitHub Actions. ADR 0004.
- Ticket 2: `docker-compose.yml` runs Postgres/PostGIS `16-3.4`, MinIO built from the GitHub release (Docker Hub no longer serves the image), a bucket init, Mailpit, and upstream TiTiler as a placeholder. ADR 0005.
- SQL migrations in `db/migrations`. `pnpm db:migrate` is idempotent. `pnpm db:migrate:down` reverts the latest file. The first migration enables `postgis`, `pgcrypto`, and `citext`, and creates `counters`, `file`, `event_log`, `audit_log`, and `usage_event`.
- Tenant tables force row level security with `workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid`. The API uses `groundwork_app`, which is not a superuser and does not bypass row security. `withWorkspaceContext` sets the workspace for one transaction.
- `pg-boss` worker entrypoint (`pnpm worker`) on the database-owner connection. S3/MinIO presigned PUT adapter. pino redacts authorization headers. OpenTelemetry exports only when an OTLP endpoint is set.
- `@groundwork/ui` has the button, text field, dialog, and primary nav. The office app has a keyboard-accessible shell for the spec 00 sections.
- CI keeps the `check` job and adds a `db` job that migrates against PostGIS and runs the RLS tests.

## Not in this slice

- Auth, the Better Auth table mapping, and the `workspace` table. Infra rows store `workspace_id` with no foreign key.
- Product modules, imagery ingest, the fixture COG, and the TiTiler `allows_tracing` / `verified_at` gate.
- A mailer. Mailpit is only the local SMTP catcher.
- Sentry. Choosing a license. Choosing between Fly and Render.
- The remaining gaps in `docs/specs/OPEN-QUESTIONS.md`.
- Sign-ups or spend. No hosted secrets in git. Local compose passwords are laptop defaults and are refused when `NODE_ENV=production`.

## Open questions

See `docs/specs/OPEN-QUESTIONS.md`. Do not answer the unresolved lines in a drive-by.
