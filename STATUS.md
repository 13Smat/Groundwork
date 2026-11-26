# Status

Imagery ingest (spec 04, part 2) is the current slice. Owner: Andy Silver. The agent opens a draft PR and does not merge.

## Done

- Ticket 0 through Ticket 2 are on main (`dabcba3`): agent rules, the monorepo, CI, Postgres/PostGIS, MinIO, the `groundwork_app` role, `withWorkspaceContext`, and the office shell. ADR 0001 through ADR 0005.
- Imagery registry and TiTiler are on main (`2fe041f`). Migration `0003_imagery.sql`, the fixture COG, and the guarded tile service. ADR 0006.
- Auth and workspaces are on main (`1af0406`). Migration `0002_auth_workspaces.sql`. ADR 0007. `/imagery/captures` and `/imagery/tiles` use the session and membership check. No session is 401. A bad `x-workspace-id` is 400. A non-member is 404.
- Migration `0004_imagery_ingest.sql` adds `imagery_ingest_job` and the capture status trigger. Global imagery writes from `groundwork_app` require `app.imagery_admin=on` for that transaction. ADR 0008. There is still no admin delete policy.
- `services/imagery-ingest` converts the fixture 4-band GeoTIFF to a COG and can download one configured HTTPS GeoTIFF for NC ortho, Helene 2025, or NAIP. Live download stays off unless both env vars are set. CI does not set them and does not call a state portal.
- `POST /imagery/ingest` and `GET /imagery/ingest/:jobId`, plus `GET/POST/PATCH /admin/imagery-sources`, use the same session and membership check as the other imagery routes, then `requireImageryAdmin`. The member's role must be `owner` or `admin`. Any other active role is 403. The office app has an Imagery screen for those two roles.
- `ImageryCapture` moves only from `ingesting` to `ready` or `failed`. The shared helper and a database trigger both reject anything else. The API returns 409.
- Email and password, magic links, and invites. Google stays off unless both client env vars are set. With no SMTP host, development logs the message. Mailpit is the local catcher.
- Member transitions live in `packages/shared`. Illegal transitions, an expired invite, and removing the last owner return 409. Disabling a member deletes that user's sessions before the response returns.
- Tenant routes return 404 when the session is not an active member. `GET /catalog-items` is a fixture: roles with `catalog.manage` see `unit_cost_cents`, and other roles do not.
- The office app has sign-up, sign-in, create workspace, a switcher, settings, members, and the role list. Playwright covers the keyboard sign-up path.
- CI `check` runs lint, typecheck, unit tests, the Python tile-guard tests, the imagery-ingest unit tests, and build. The `db` job migrates and runs RLS and auth tests. The `imagery` job installs the ingest venv, renders the fixture tile, and runs the fixture ingest against MinIO and TiTiler. An `e2e` job runs Playwright.

## Not in this slice

- `locationId` resolution. The location table is spec 03.
- A county boundary table. A county FIPS is accepted, and the raster footprint is not checked against a county polygon.
- A live NC or NAIP download in CI. The fetcher exists and stays off.
- Takeoff drawing and proposal PDF attribution.
- A persisted catalog. `GET /catalog-items` is the cost-visibility fixture.
- Custom roles, SSO, SCIM, and per-field permissions beyond cost visibility.
- A browser-facing signed tile URL. Imagery still proxies.
- Sentry. Choosing a license. Choosing between Fly and Render.
- The remaining gaps in `docs/specs/OPEN-QUESTIONS.md`.
- Sign-ups or spend. No hosted secrets in git. Local compose passwords, the tile signing secret, and the local Better Auth secret are laptop defaults and are refused when `NODE_ENV=production`.

## Open questions

See `docs/specs/OPEN-QUESTIONS.md`. Do not answer the unresolved lines in a drive-by.
