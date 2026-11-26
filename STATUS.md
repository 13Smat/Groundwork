# Status

Catalog and cost recipes (spec 06, part 1) is the current slice. Owner: Andy Silver. The agent opens a draft PR and does not merge.

## Done

- Ticket 0 through Ticket 2 are on main (`dabcba3`): agent rules, the monorepo, CI, Postgres/PostGIS, MinIO, the `groundwork_app` role, `withWorkspaceContext`, and the office shell. ADR 0001 through ADR 0005.
- Imagery registry and TiTiler are on main (`2fe041f`). Migration `0003_imagery.sql`, the fixture COG, and the guarded tile service. ADR 0006.
- Auth and workspaces are on main (`1af0406`). Migration `0002_auth_workspaces.sql`. ADR 0007. `/imagery/captures` and `/imagery/tiles` use the session and membership check. No session is 401. A bad `x-workspace-id` is 400. A non-member is 404. `catalog.manage` is already on owner, admin, and estimator. Office does not have it.
- Imagery ingest is on main (`a48bf32`). Migration `0004_imagery_ingest.sql` adds `imagery_ingest_job` and the capture status trigger. Global imagery writes from `groundwork_app` require `app.imagery_admin=on` for that transaction. ADR 0008. There is still no admin delete policy.
- `services/imagery-ingest` converts the fixture 4-band GeoTIFF to a COG and can download one configured HTTPS GeoTIFF for NC ortho, Helene 2025, or NAIP. Live download stays off unless both env vars are set. CI does not set them and does not call a state portal.
- `POST /imagery/ingest` and `GET /imagery/ingest/:jobId`, plus `GET/POST/PATCH /admin/imagery-sources`, use the same session and membership check as the other imagery routes, then `requireImageryAdmin`. The member's role must be `owner` or `admin`. Any other active role is 403. The office app has an Imagery screen for those two roles.
- `ImageryCapture` moves only from `ingesting` to `ready` or `failed`. The shared helper and a database trigger both reject anything else. The API returns 409.
- Migration `0006_catalog_recipes.sql` adds `takeoff_item`, `catalog_item`, `cost_recipe`, and `recipe_component`. Row level security is forced with `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Grants are to `groundwork_app` only. ADR 0010.
- `packages/pricing` evaluates recipe formulas with a recursive-descent parser and `decimal.js`. There is no `eval`. Unit factors are exact ratios in `packages/geo`. Money rounds half-even to cents in `previewRecipe`, which the estimate engine will call later.
- Cost recipe transitions live in `packages/shared`. `draft -> active -> archived`. Editing an active recipe creates version n+1 as a draft. Activating it archives the previous active version. Illegal transitions return 409.
- `/catalog-items` (including CSV import and export), `/takeoff-items`, `/cost-recipes` (versions and preview), and `POST /formula/validate` use the session and membership guard. A recipe linked to a takeoff item of a different measure kind returns 409. A referenced catalog item is archived instead of deleted. Responses for roles without `catalog.manage` omit `unit_cost_cents` and preview costs.
- Email and password, magic links, and invites. Google stays off unless both client env vars are set. With no SMTP host, development logs the message. Mailpit is the local catcher.
- Member transitions live in `packages/shared`. Illegal transitions, an expired invite, and removing the last owner return 409. Disabling a member deletes that user's sessions before the response returns.
- Tenant routes return 404 when the session is not an active member.
- The office app has sign-up, sign-in, create workspace, a switcher, settings, members, and the role list. Playwright covers the keyboard sign-up path.
- CI `check` runs lint, typecheck, unit tests, the Python tile-guard tests, the imagery-ingest unit tests, and build. The `db` job migrates and runs RLS and auth tests. The `imagery` job installs the ingest venv, renders the fixture tile, and runs the fixture ingest against MinIO and TiTiler. An `e2e` job runs Playwright. Scripts that load the API build its workspace dependencies first.

## Not in this slice

- TODO: `takeoff_item` has no foreign key to `job` or `location`. CRM lands those tables in its own migration. Do not add the key in `0006`.
- The office catalog screen. It is still the placeholder.
- Estimate snapshots. Spec 07 must call `previewRecipe` so a saved total matches the preview. This slice does not create estimates, so it cannot prove that editing a recipe leaves a `ready` or `sent` estimate unchanged.
- Assemblies of assemblies, price lists, vendor feeds, and the spreadsheet grid.
- `output_unit`. The column is `input_unit`. The entity table still says `output_unit`. See `docs/specs/OPEN-QUESTIONS.md`.
- `locationId` resolution. The location table is spec 03.
- A county boundary table. A county FIPS is accepted, and the raster footprint is not checked against a county polygon.
- A live NC or NAIP download in CI. The fetcher exists and stays off.
- Takeoff drawing and proposal PDF attribution.
- Custom roles, SSO, SCIM, and per-field permissions beyond cost visibility.
- A browser-facing signed tile URL. Imagery still proxies.
- Sentry. Choosing a license. Choosing between Fly and Render.
- The remaining gaps in `docs/specs/OPEN-QUESTIONS.md`.
- Sign-ups or spend. No hosted secrets in git.

## Open questions

See `docs/specs/OPEN-QUESTIONS.md`. Do not answer the unresolved lines in a drive-by.
