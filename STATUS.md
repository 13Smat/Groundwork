# Status

Map takeoff editor (spec 04, part 2) is the current slice. Estimating (spec 07, part 1), AI takeoff assist (spec 05, part 1), catalog and cost recipes (spec 06, part 2), takeoff and measurements (spec 04, part 1), and CRM and jobs (spec 03) are on main. Owner: Andy Silver. The agent opens a draft PR and does not merge.

## Done

- Ticket 0 through Ticket 2 are on main (`dabcba3`): agent rules, the monorepo, CI, Postgres/PostGIS, MinIO, the `groundwork_app` role, `withWorkspaceContext`, and the office shell. ADR 0001 through ADR 0005.
- Imagery registry and TiTiler are on main (`2fe041f`). Migration `0003_imagery.sql`, the fixture COG, and the guarded tile service. ADR 0006. `/imagery/*` uses the session and membership check. `x-workspace-id` still names the workspace.
- Auth and workspaces are on main (`1af0406`). Migration `0002_auth_workspaces.sql`, Better Auth organizations, invites, and the office sign-in flow. ADR 0007. `catalog.manage` is already on owner, admin, and estimator. Office does not have it.
- Imagery ingest is on main (`a48bf32`). Migration `0004_imagery_ingest.sql` adds `imagery_ingest_job` and the capture status trigger. Global imagery writes from `groundwork_app` require `app.imagery_admin=on` for that transaction. ADR 0008. There is still no admin delete policy. `POST /imagery/ingest`, `GET /imagery/ingest/:jobId`, and `GET/POST/PATCH /admin/imagery-sources` require an active `owner` or `admin`. The office app has an Imagery screen for those two roles. Live NC and NAIP downloads stay off unless both env vars are set. CI does not set them.
- Catalog and cost recipes are on main (`c58ce09`). Migration `0006_catalog_recipes.sql` adds `takeoff_item`, `catalog_item`, `cost_recipe`, and `recipe_component`. ADR 0010. `packages/pricing` evaluates formulas without `eval`. Unit factors live in `packages/geo`. Cost recipe transitions are `draft -> active -> archived`. Roles without `catalog.manage` do not receive costs. A recipe linked to a takeoff item of a different measure kind returns 409. A referenced catalog item is archived instead of deleted.
- The office catalog screen is the kind tabs, the inline grid, the detail drawer, and the CSV import wizard. Unit cost is omitted from the grid when the membership lacks `catalog.manage`. Takeoff items and the recipe builder are on the same section. Saving an active recipe opens version n+1 as a draft. `POST /catalog-items/starter-pack` loads `db/seed/starter-pack.json` and skips SKUs, takeoff names, and recipe names that are already there. An office member gets 403. ADR 0011. Playwright covers formula validation, preview, versioning, the CSV diff, and the office versus estimator cost column.
- Migration `0005_crm_jobs.sql` adds `client`, `contact`, `location` (Point and MultiPolygon, GiST), `job`, `job_note`, `job_task`, `job_file`, and the global `parcel_cache`. Tenant tables force row security. Grants are to `groundwork_app` only. ADR 0009. Imagery has no `location_id` column, so there is no foreign key. `GET /imagery/captures?locationId=` reads `location.point` and no longer returns 501.
- `Job.stage` lives in `packages/shared`. Illegal transitions and a won without `jobs.force_won` return 409 problem+json. That token is on owner and admin only. Every stage change writes `audit_log`.
- Fixture geocoder and parcel adapters. No network and no API keys. Parcel hits are cached in `parcel_cache`. The first job number in a workspace is `J-1001`.
- Fastify routes for clients, contacts, locations, resolve, jobs, transitions, notes, tasks, presigned files, search, and the pipeline summary. Creating a client warns on a duplicate email or phone and still creates the row.
- The office app has the pipeline board, jobs list, address-first job create, job detail, clients, and a location context map. Column totals come from `/pipeline/summary`. Lost asks for a reason. A 409 is shown and the card stays put. File rows include a presigned `download_url`. `GET /jobs/:id/activity` reads `audit_log`. The map uses MapLibre and only the seeded `fixture_rgbir` tile. Playwright covers create, the lost reason, the illegal transition, upload, and search.
- AI takeoff assist is migration `0012_detection.sql`. `detection_run` and `detection_feature` force row security and are granted to `groundwork_app` only. `usage_event` from `0001` records `cv_infer`. ADR 0016. `POST /takeoffs/:id/assist` requires `GROUNDWORK_AI_ASSIST=1` and `workspace.features.ai_assist`. It reuses `requireMeasurableCapture`, crops a COG from MinIO, calls the mock `services/cv`, and stores draft polygons. A polygon under 2 m² is dropped. CI runs `pnpm test:cv`, the crop unittest, and `pnpm test:assist` on the imagery job. SAM 2 is an adapter that fails closed. Nothing here accepts a draft into a measurement.
- Takeoff measurements are migration `0009_takeoff.sql`. `takeoff` and `measurement` force row security and reference the `takeoff_item` table from `0006`. ADR 0013. `Takeoff.status` is `draft -> in_review -> final`, and `final -> draft` inserts the next version. PostGIS geography is the stored area and length. Turf in `packages/geo` is the live-feedback helper. A source with `allows_tracing = false` or a null `verified_at` is 403. A capture that is not `ready` is 409.
- The takeoff editor is a lazy route on the job. ADR 0014. It draws with MapLibre and Terra Draw on `/imagery/tiles/:captureId/{z}/{x}/{y}`, lists only captures the API already marked traceable and verified, and saves through the existing measurement routes. The server summary replaces the live total after a save. The parcel is a reference layer and does not clip. The measure ruler is not saved. `GET /jobs/:id/takeoffs` lists the latest version of each lineage, newest first. Playwright covers a polygon, a line, a point, the age warning, the block when nothing covers the site, and the NAIP banner.
- Estimating part 1 is migration `0011_estimating.sql`. `estimate` and `line_item` force row security. ADR 0015. `Estimate.status` is `draft -> ready -> sent -> accepted`, with `ready -> draft` and `ready|sent -> superseded`. Leaving draft freezes `snapshot`. A flagged or unresolved line blocks `ready` with 409. Generation uses the active recipe and `previewRecipe`. A line pins the recipe row. Recalculate of a draft re-reads that component and the current catalog cost. `GET` of a non-draft estimate returns the snapshot. The first estimate number is `E-1001`. Roles without `catalog.manage` do not receive costs. A negative line needs `catalog.manage`. `template_id` is 400. Quantity diff and versions are part 2.
- Email and password, magic links, and invites. Google stays off unless both client env vars are set. With no SMTP host, development logs the message. Mailpit is the local catcher.
- Member transitions live in `packages/shared`. Illegal transitions, an expired invite, and removing the last owner return 409. Disabling a member deletes that user's sessions before the response returns.
- Tenant routes return 404 when the session is not an active member.
- CI `check` runs lint, typecheck, unit tests, the Python tile-guard tests, the imagery-ingest unit tests, and build. The `db` job migrates and runs RLS, auth, CRM, takeoff, and estimating tests. The `imagery` job installs the ingest venv, runs the CV contract tests, the chip-crop unittest, and the assist API test, renders the fixture tile, and runs the fixture ingest against MinIO and TiTiler. The `e2e` job starts MinIO, runs bucket init on its own, and runs Playwright. Scripts that load the API build its workspace dependencies first.

## Not in this slice

- A signed proposal. `hasSignedProposal` stays false until spec 08, so won is the force path only.
- v1 stages (`scheduled` through `closed`) are in the check constraint and are not reachable.
- A foreign key from `takeoff_item` to `job` or `location`. Those tables exist in `0005`. `0006` does not reference them.
- Quantity diff, apply-quantities, and estimate versions. Spec 07 part 2. A saved draft total matches `previewRecipe`. A ready or sent estimate serves its snapshot.
- Assemblies of assemblies, price lists, and vendor feeds.
- `output_unit`. The column is `input_unit`. The entity table still says `output_unit`. See `docs/specs/OPEN-QUESTIONS.md`.
- A county boundary table. A county FIPS is accepted, and the raster footprint is not checked against a county polygon.
- A live NC or NAIP download in CI. The fetcher exists and stays off.
- Holes, snap, undo/redo, PNG export, multi-parcel select, and proposal PDF attribution. The editor in this slice is select, polygon, line, point, and a measure-only ruler.
- `sheet_geom`, `planset_sheet`, and plan-set scale. Spec 12 owns those. A measurement in this slice is geographic.
- Accepting an assist draft into a measurement (`accepted_partial`, `accepted_all`, and `measurement.source = ai_assist`). This slice stores `detection_feature` drafts only. AI auto drawing is still later.
- Custom roles, SSO, SCIM, and per-field permissions beyond cost visibility.
- A browser-facing signed tile URL. Imagery still proxies.
- Marking a task done. The API stores `done` and this screen does not change it.
- A signed download that outlives the 900 second presign. See `docs/specs/OPEN-QUESTIONS.md`.
- Sentry. Choosing a license. Choosing between Fly and Render.
- The remaining gaps in `docs/specs/OPEN-QUESTIONS.md`.
- Sign-ups or spend. No hosted secrets in git. Local compose passwords, the tile signing secret, and the local Better Auth secret are laptop defaults and are refused when `NODE_ENV=production`.

## Open questions

See `docs/specs/OPEN-QUESTIONS.md`. Do not answer the unresolved lines in a drive-by.
