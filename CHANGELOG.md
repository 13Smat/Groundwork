# Changelog

## Unreleased

### Ticket 2 — Local infra, database, and office shell

- Added `docker-compose.yml` for PostGIS `16-3.4`, MinIO (built from the GitHub release because Docker Hub no longer serves the image), bucket init, Mailpit `v1.34.0`, and upstream TiTiler `2.0.5` as a placeholder with no fixture COG and no `allows_tracing` gate. ADR 0005.
- Added a SQL migration runner (`pnpm db:migrate`, idempotent, with `pnpm db:migrate:down`). The first migration enables `postgis`, `pgcrypto`, and `citext`, and creates `counters`, `file`, `event_log`, `audit_log`, and `usage_event`.
- Tenant tables force row level security. The app role `groundwork_app` is not a superuser and does not bypass row security. `withWorkspaceContext` sets `app.workspace_id` for one transaction. RLS tests cover an unset workspace, a blank setting, and workspace A versus workspace B.
- Added a `pg-boss` worker entrypoint, an S3/MinIO presigned upload adapter, pino redaction, and an OpenTelemetry hook that stays off until an OTLP endpoint is set.
- Extended the existing problem+json handler with `ProblemError`. Built the office navigation shell (Radix navigation menu and dialog, arrow keys, skip link) on `@groundwork/ui`.
- CI keeps `check` and adds a PostGIS job that migrates twice and runs the RLS tests.
- Recorded the spec gaps this slice hit in `docs/specs/OPEN-QUESTIONS.md` and pointed them at ADR 0005. The spec files were not edited.

### Ticket 1 — Monorepo layout and CI

- Pinned Node 24 LTS in ADR 0004. `.nvmrc` is `24`. `engines.node` is `>=24 <25`. `packageManager` is pnpm 10.34.9.
- Added pnpm workspaces, Turborepo, shared ESLint (flat config), Prettier, TypeScript, and Vitest. `pnpm check` runs lint, typecheck, test, and build.
- Added GitHub Actions CI. It checks out the repo, installs pnpm, sets up Node from `.nvmrc` with the pnpm cache, then runs `pnpm install --frozen-lockfile` and `pnpm check` on pull requests and on pushes to `main`. The workflow permission is `contents: read`.
- Added `@groundwork/shared` (RFC 9457 problem+json, base enums, UUIDv7 and human-number helpers), placeholder geo, pricing, and pdf-templates packages, and `@groundwork/ui` (Tailwind tokens, a Radix Slot button, and the app shell).
- Added `apps/api` (Fastify, zod type provider, `/healthz`, `/openapi.json`, problem+json on 404 and on validation errors) and `apps/web` (React 18, Vite, TanStack Router, TanStack Query, Tailwind).
- Added README placeholders for `db/migrations`, `db/seed`, `services/cv`, `services/tiles`, `services/imagery-ingest`, and `apps/crew`.
- Marked the Node 22 versus 24 line in `docs/specs/OPEN-QUESTIONS.md` resolved by ADR 0004. The spec files still say Node 22.

### Ticket 0 — Agent rules and preferences

- Added `AGENTS.md` with the standing rules for every coding agent: one ticket per branch and draft PR, no merge by the agent, tests as the gate, a public repo with no secrets, WCAG AA, the clean-room rule, and the builder rules from the specs.
- Recorded the stack (ADR 0001), Better Auth with the organizations plugin (ADR 0002), and Dropbox Sign behind a `SignatureProvider` interface (ADR 0003). Hosting stays planned only.
- Added the build specs under `docs/specs/` and listed known spec gaps in `docs/specs/OPEN-QUESTIONS.md` without resolving them.
- Added `STATUS.md`, this changelog, the ADR and handoff templates, `.gitignore`, `.editorconfig`, empty `.env.example` placeholders, and `LICENSE-TBD.md`.
