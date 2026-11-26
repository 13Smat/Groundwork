# Status

CRM and jobs (spec 03, part 1 of 2) is the current slice. Owner: Andy Silver. The agent opens a draft PR and does not merge.

## Done

- Ticket 0 through Ticket 2 are on main (`dabcba3`): agent rules, the monorepo, CI, Postgres/PostGIS, MinIO, the `groundwork_app` role, `withWorkspaceContext`, and the office shell. ADR 0001 through ADR 0005.
- Imagery registry and TiTiler are on main (`2fe041f`). Migration `0003_imagery.sql`, the fixture COG, and the guarded tile service. ADR 0006. `/imagery/*` uses the session and membership check. `x-workspace-id` still names the workspace.
- Auth and workspaces are on main (`1af0406`). Migration `0002_auth_workspaces.sql`, Better Auth organizations, invites, and the office sign-in flow. ADR 0007.
- Imagery ingest is on main (`a48bf32`). Migration `0004_imagery_ingest.sql` adds `imagery_ingest_job` and the capture status trigger. Global imagery writes from `groundwork_app` require `app.imagery_admin=on` for that transaction. ADR 0008. There is still no admin delete policy. `POST /imagery/ingest`, `GET /imagery/ingest/:jobId`, and `GET/POST/PATCH /admin/imagery-sources` require an active `owner` or `admin`. The office app has an Imagery screen for those two roles. Live NC and NAIP downloads stay off unless both env vars are set. CI does not set them.
- Migration `0005_crm_jobs.sql` adds `client`, `contact`, `location` (Point and MultiPolygon, GiST), `job`, `job_note`, `job_task`, `job_file`, and the global `parcel_cache`. Tenant tables force row security. Grants are to `groundwork_app` only. ADR 0009. Imagery has no `location_id` column, so there is no foreign key. `GET /imagery/captures?locationId=` reads `location.point` and no longer returns 501.
- `Job.stage` lives in `packages/shared`. Illegal transitions and a won without `jobs.force_won` return 409 problem+json. That token is on owner and admin only. Every stage change writes `audit_log`.
- Fixture geocoder and parcel adapters. No network and no API keys. Parcel hits are cached in `parcel_cache`. The first job number in a workspace is `J-1001`.
- Fastify routes for clients, contacts, locations, resolve, jobs, transitions, notes, tasks, presigned files, search, and the pipeline summary. Creating a client warns on a duplicate email or phone and still creates the row.
- CI `check` runs lint, typecheck, unit tests, the Python tile-guard tests, the imagery-ingest unit tests, and build. The `db` job migrates and runs RLS, auth, and CRM tests. The `imagery` job installs the ingest venv, renders the fixture tile, and runs the fixture ingest against MinIO and TiTiler. An `e2e` job runs Playwright. There is no CRM UI in this slice.

## Not in this slice

- A signed proposal. `hasSignedProposal` stays false until spec 08, so won is the force path only.
- v1 stages (`scheduled` through `closed`) are in the check constraint and are not reachable.
- A county boundary table. A county FIPS is accepted, and the raster footprint is not checked against a county polygon.
- A live NC or NAIP download in CI. The fetcher exists and stays off.
- Takeoff drawing and proposal PDF attribution.
- A persisted catalog. `GET /catalog-items` is the cost-visibility fixture.
- Custom roles, SSO, SCIM, and per-field permissions beyond cost visibility.
- A browser-facing signed tile URL. Imagery still proxies.
- CRM screens. This is the API half of spec 03.
- Sentry. Choosing a license. Choosing between Fly and Render.
- The remaining gaps in `docs/specs/OPEN-QUESTIONS.md`.
- Sign-ups or spend. No hosted secrets in git. Local compose passwords, the tile signing secret, and the local Better Auth secret are laptop defaults and are refused when `NODE_ENV=production`.

## Open questions

See `docs/specs/OPEN-QUESTIONS.md`. Do not answer the unresolved lines in a drive-by.
