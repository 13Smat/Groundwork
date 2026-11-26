# Status

Takeoff and measurements (spec 04, part 1 of 3) is the current slice. CRM and jobs (spec 03, part 2 of 2) is on main (`bfa1593`). Owner: Andy Silver. The agent opens a draft PR and does not merge.

## Done

- Ticket 0 through Ticket 2 are on main (`dabcba3`): agent rules, the monorepo, CI, Postgres/PostGIS, MinIO, the `groundwork_app` role, `withWorkspaceContext`, and the office shell. ADR 0001 through ADR 0005.
- Imagery registry and TiTiler are on main (`2fe041f`). Migration `0003_imagery.sql`, the fixture COG, and the guarded tile service. ADR 0006. `/imagery/*` uses the session and membership check. `x-workspace-id` still names the workspace.
- Auth and workspaces are on main (`1af0406`). Migration `0002_auth_workspaces.sql`, Better Auth organizations, invites, and the office sign-in flow. ADR 0007. `catalog.manage` is already on owner, admin, and estimator. Office does not have it.
- Imagery ingest is on main (`a48bf32`). Migration `0004_imagery_ingest.sql` adds `imagery_ingest_job` and the capture status trigger. Global imagery writes from `groundwork_app` require `app.imagery_admin=on` for that transaction. ADR 0008. There is still no admin delete policy. `POST /imagery/ingest`, `GET /imagery/ingest/:jobId`, and `GET/POST/PATCH /admin/imagery-sources` require an active `owner` or `admin`. The office app has an Imagery screen for those two roles. Live NC and NAIP downloads stay off unless both env vars are set. CI does not set them.
- Catalog and cost recipes are on main (`c58ce09`). Migration `0006_catalog_recipes.sql` adds `takeoff_item`, `catalog_item`, `cost_recipe`, and `recipe_component`. ADR 0010. `packages/pricing` evaluates formulas without `eval`. Unit factors live in `packages/geo`. Cost recipe transitions are `draft -> active -> archived`. Roles without `catalog.manage` do not receive costs.
- Migration `0005_crm_jobs.sql` adds `client`, `contact`, `location` (Point and MultiPolygon, GiST), `job`, `job_note`, `job_task`, `job_file`, and the global `parcel_cache`. Tenant tables force row security. Grants are to `groundwork_app` only. ADR 0009. Imagery has no `location_id` column, so there is no foreign key. `GET /imagery/captures?locationId=` reads `location.point` and no longer returns 501.
- `Job.stage` lives in `packages/shared`. Illegal transitions and a won without `jobs.force_won` return 409 problem+json. That token is on owner and admin only. Every stage change writes `audit_log`.
- Fixture geocoder and parcel adapters. No network and no API keys. Parcel hits are cached in `parcel_cache`. The first job number in a workspace is `J-1001`.
- Fastify routes for clients, contacts, locations, resolve, jobs, transitions, notes, tasks, presigned files, search, and the pipeline summary. Creating a client warns on a duplicate email or phone and still creates the row.
- The office app has the pipeline board, jobs list, address-first job create, job detail, clients, and a location context map. Column totals come from `/pipeline/summary`. Lost asks for a reason. A 409 is shown and the card stays put. File rows include a presigned `download_url`. `GET /jobs/:id/activity` reads `audit_log`. The map uses MapLibre and only the seeded `fixture_rgbir` tile. Playwright covers create, the lost reason, the illegal transition, upload, and search.
- Takeoff measurements are migration `0009_takeoff.sql`. `takeoff` and `measurement` force row security and reference the `takeoff_item` table from `0006`. ADR 0013. `Takeoff.status` is `draft -> in_review -> final`, and `final -> draft` inserts the next version. PostGIS geography is the stored area and length. Turf in `packages/geo` is the live-feedback helper. A source with `allows_tracing = false` or a null `verified_at` is 403. A capture that is not `ready` is 409.
- CI `check` runs lint, typecheck, unit tests, the Python tile-guard tests, the imagery-ingest unit tests, and build. The `db` job migrates and runs RLS, auth, CRM, and takeoff tests. The `imagery` job installs the ingest venv, renders the fixture tile, and runs the fixture ingest against MinIO and TiTiler. The `e2e` job starts MinIO, runs bucket init on its own, and runs Playwright. Scripts that load the API build its workspace dependencies first.

## Not in this slice

- A signed proposal. `hasSignedProposal` stays false until spec 08, so won is the force path only.
- v1 stages (`scheduled` through `closed`) are in the check constraint and are not reachable.
- A foreign key from `takeoff_item` to `job` or `location`. Those tables exist in `0005`. `0006` does not reference them.
- The office catalog screen. It is still the placeholder.
- Estimate snapshots. Spec 07 must call `previewRecipe` so a saved total matches the preview.
- Assemblies of assemblies, price lists, vendor feeds, and the spreadsheet grid.
- `output_unit`. The column is `input_unit`. See `docs/specs/OPEN-QUESTIONS.md`.
- A county boundary table. A county FIPS is accepted, and the raster footprint is not checked against a county polygon.
- A live NC or NAIP download in CI. The fetcher exists and stays off.
- The takeoff map editor, PNG export, undo/redo, and proposal PDF attribution. This slice is the API and the PostGIS tests.
- `sheet_geom`, `planset_sheet`, and plan-set scale. Spec 12 owns those. A measurement in this slice is geographic.
- AI assist and AI auto drawing. The `source` values exist. Nothing writes them yet.
- Custom roles, SSO, SCIM, and per-field permissions beyond cost visibility.
- A browser-facing signed tile URL. Imagery still proxies.
- Marking a task done. The API stores `done` and this screen does not change it.
- A signed download that outlives the 900 second presign. See `docs/specs/OPEN-QUESTIONS.md`.
- Sentry. Choosing a license. Choosing between Fly and Render.
- The remaining gaps in `docs/specs/OPEN-QUESTIONS.md`.
- Sign-ups or spend. No hosted secrets in git. Local compose passwords, the tile signing secret, and the local Better Auth secret are laptop defaults and are refused when `NODE_ENV=production`.

## Open questions

See `docs/specs/OPEN-QUESTIONS.md`. Do not answer the unresolved lines in a drive-by.
