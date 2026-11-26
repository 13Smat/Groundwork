# Changelog

## Unreleased

### Spec 04 part 1 — Takeoff and measurement model

- Added `0009_takeoff.sql` for `takeoff` and `measurement`. Tenant row security is forced. `groundwork_app` is the only grantee. `takeoff_item` from `0006` is referenced and is not recreated. ADR 0013.
- `Takeoff.status` lives in `packages/shared`. `draft -> in_review -> final`. `final -> draft` inserts version n+1, copies measurements, and leaves the old row read-only. Any other change is 409.
- Extended `packages/geo` with Turf geodesic area, length, and rectangle helpers. Display rounding uses the existing integer ratios and `decimal.js`: ft² to 1, yd² to 0.1, ft to 1, acres to 0.001. Stored `value_m2` and `value_m` stay `numeric(14,4)`.
- Added takeoff and measurement routes. Creating an aerial takeoff is 403 when the source has `allows_tracing = false` or `verified_at` is null, and 409 when the capture is not `ready`. Changing the capture after measurements exist requires `confirm: true`. Bulk PUT upserts by client id, recomputes geography area and length, reports a self-intersection correction, and flags same-item overlaps. The summary returns the sum and the union per takeoff item.
- CI runs `pnpm test:takeoff` in the `db` job. The PostGIS tests cover the latitude sweep, the 20 ft hole, geodesic length, a 500-feature save, the summary, the imagery 403, and cross-tenant row security.
- Recorded the spec gaps in `docs/specs/OPEN-QUESTIONS.md`. The spec files were not edited.

### Ticket 03 — CRM and jobs API

- Added `0005_crm_jobs.sql` for `client`, `contact`, `location`, `job`, `job_note`, `job_task`, `job_file`, and the global `parcel_cache`. Tenant tables force row security. Grants are to `groundwork_app` only. ADR 0009. Imagery has no `location_id` column. `GET /imagery/captures?locationId=` reads the location point and returns 404 when that point is missing.
- Job stage changes go through `packages/shared`. Illegal transitions, a missing lost reason, and won without `jobs.force_won` return 409 problem+json. Owner and admin hold that token. Every change writes `audit_log` with the actor and the reason. The first job number in a workspace is `J-1001`.
- Fixture geocoder and parcel adapters answer without the network or an API key. Parcel hits are cached. Creating a client warns on a duplicate email or phone and still creates the row.
- Added the CRM and jobs routes, including search and the pipeline summary. Presigned file uploads use the existing MinIO adapter. CI runs `pnpm test:crm` in the `db` job.
- Recorded the spec gaps in `docs/specs/OPEN-QUESTIONS.md`. The spec files were not edited.

### Spec 06 part 1 — Catalog, cost recipes, and the formula engine

- Added `packages/pricing`, a recursive-descent formula parser and evaluator. Operators are `+ - * / ^` and comparisons. Functions are `ceil`, `floor`, `round`, `min`, `max`, and `if`. Built-in takeoff variables come from the input unit. `decimal.js` keeps the math exact. Half-even rounding is only at integer cents and inside `round`. The parser does not call `eval` or `Function`. A complexity cap stops a hostile formula inside 50 ms.
- Added the measure-unit table to `packages/geo`. Factors are exact integer ratios. One international foot is 0.3048 m. A square yard is nine square feet. An acre is 43,560 square feet.
- Added migration `0006_catalog_recipes.sql` for `takeoff_item`, `catalog_item`, `cost_recipe`, and `recipe_component`. Tenant row security is forced. `groundwork_app` is the only grantee. There is no foreign key to `job` or `location`. ADR 0010.
- Added the cost-recipe state machine. `draft -> active -> archived`. An edit of an active recipe creates the next version as a draft, and activating that draft archives the previous one. Anything else is 409.
- Added the catalog, takeoff item, recipe, preview, and formula routes. CSV import upserts by SKU and can return a diff without writing. Linking a recipe to a takeoff item of a different measure kind is 409. Deleting a catalog item that a component uses archives it. Roles without `catalog.manage` do not receive costs. `catalog.manage` was already seeded in `0002`.
- `GET /catalog-items` is no longer the visibility fixture. The visibility rule is unchanged.
- Scripts that load the API build `@groundwork/api`'s workspace dependencies first, the same way they already built `@groundwork/shared`.

### Imagery ingest

- Added `0004_imagery_ingest.sql` for `imagery_ingest_job` and the capture status trigger. `groundwork_app` can write a global imagery row only while `app.imagery_admin` is `on` for that transaction. ADR 0008.
- Added `services/imagery-ingest`. It converts the committed 4-band fixture GeoTIFF to a COG. NC ortho, Helene 2025, and NAIP download one configured HTTPS GeoTIFF only when the live-fetch env vars are set. CI does not set them.
- Added `POST /imagery/ingest`, `GET /imagery/ingest/:jobId`, and `GET/POST/PATCH /admin/imagery-sources`. The caller needs a session, an active membership, and the `owner` or `admin` role. Other roles get 403. All five routes are tagged `tenant-header`, so a session that is not a member gets 404. Illegal capture transitions return 409.
- The office app has an Imagery screen for owner and admin. The Python unit tests run in `check`. The imagery CI job runs the fixture ingest through MinIO and TiTiler. Recorded the spec gaps in `docs/specs/OPEN-QUESTIONS.md`. The spec files were not edited.

### Ticket 02 — Auth and workspaces

- Added `0002_auth_workspaces.sql` for `app_user`, `workspace`, the six system roles, sessions, and invites. Better Auth's organization is the workspace. ADR 0007. Primary keys the library compares are text UUIDv7s. `groundwork_auth` is the sign-up connection and cannot be assumed by `groundwork_app`.
- Wired email and password, magic links, and invites. Google is off unless both client env vars are set. Unset SMTP logs the message outside production. Mailpit remains the local catcher.
- Member transitions, the 7-day invite, and last-owner protection live in `packages/shared`. Illegal changes return 409. Disabling a member deletes that user's sessions immediately.
- Tenant routes return 404 for a session that is not an active member. `GET /catalog-items` is a fixture that hides `unit_cost_cents` without `catalog.manage`.
- Replaced `stubImageryAuth`. `/imagery/*` requires the same session and membership check. `x-workspace-id` still names the workspace.
- The office app can sign up, create a workspace, switch workspaces, edit settings, invite members, and read the role list. Playwright covers the keyboard sign-up path. CI runs the auth tests in the `db` job and Playwright in `e2e`. Playwright is 1.65 so Chromium's system dependencies install on the Ubuntu 26.04 runner.
- `groundwork_auth` is `NOSUPERUSER NOBYPASSRLS`. `groundwork_app` cannot assume that role and has no privilege on `session`, `account`, or `verification`. The sign-in pool is the one handed to Better Auth.
- Recorded the spec gaps in `docs/specs/OPEN-QUESTIONS.md`. The spec files were not edited.

### Imagery registry and TiTiler

- Added `0003_imagery.sql` for `imagery_source` and `imagery_capture`. Global rows are readable under the null-workspace policy. The app role cannot write them. ADR 0006.
- Seeded the NC Helene 2025, NC ortho, and NAIP rows, plus blocked Google, Mapbox, and Orthoimagery_Latest rows. Committed a synthetic 4-band fixture COG. Tests load it into MinIO. No state service is called.
- Added the TiTiler app in `services/tiles` and wired it into `docker-compose.yml` in place of the unguarded placeholder. XYZ tiles come from the bucket. `allows_tracing = false` or a null `verified_at` returns 403 from the API and from TiTiler.
- Added `GET /imagery/captures` and `GET /imagery/tiles/:captureId/{z}/{x}/{y}`. The tile route proxies a 60-second signed URL and writes an `imagery_tile` usage event. The first cut used `stubImageryAuth`. Ticket 02 replaced that with the session check.
- CI runs the Python guard tests in `check` and an imagery job that renders the fixture tile. Recorded the spec gaps in `docs/specs/OPEN-QUESTIONS.md`. The spec files were not edited.
- Corrected the amd64 `mc` checksum used by the bucket-init image. It was one hex digit off the published `RELEASE.2025-08-13T08-35-41Z` binary, so the imagery job could not build `minio-init`.

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
