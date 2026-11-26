# Status

Foundations 1 (monorepo layout and CI) is the current slice. Owner: Andy Silver. The agent opens a draft PR and does not merge.

## Done

- Ticket 0: `AGENTS.md`, ADR 0001 through ADR 0003, the build specs, and the open-question list.
- Node 24 LTS (Krypton) is the runtime. ADR 0004. `.nvmrc` is `24`. `engines.node` is `>=24 <25`. `packageManager` pins pnpm.
- pnpm workspaces and Turborepo. `pnpm check` runs lint, typecheck, test, and build. GitHub Actions runs that check on pull requests and on pushes to `main`, with `contents: read`.
- `@groundwork/shared` has the RFC 9457 problem+json schema, the base enums, and UUIDv7 / human-number helpers. `@groundwork/geo`, `@groundwork/pricing`, and `@groundwork/pdf-templates` are placeholders. `@groundwork/ui` has Tailwind tokens, a Radix Slot button, and the app shell.
- `apps/api` is Fastify with the zod type provider. `/healthz` and `/openapi.json` respond. A missing route and a validation error return problem+json.
- `apps/web` is the React 18 + Vite office shell (TanStack Router, TanStack Query, Tailwind, `@groundwork/ui`).
- `db/migrations`, `db/seed`, `services/cv`, `services/tiles`, `services/imagery-ingest`, and `apps/crew` are README placeholders.

## Not in this slice

- Docker Postgres/PostGIS, MinIO, Mailpit, and a `pnpm dev` that brings the database up. That is the rest of foundations.
- Auth, RLS, SQL migrations, imagery, and every product module.
- Choosing a license. Choosing between Fly and Render.
- The remaining gaps in `docs/specs/OPEN-QUESTIONS.md`. Node 22 versus 24 is the line ADR 0004 resolves.
- Sign-ups or spend. No secrets in git.

## Open questions

See `docs/specs/OPEN-QUESTIONS.md`. Do not answer the unresolved lines in a drive-by.
