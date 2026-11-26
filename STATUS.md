# Status

Auth and workspaces (spec 02) is the current slice. Owner: Andy Silver. The agent opens a draft PR and does not merge.

## Done

- Ticket 0 through Ticket 2 are on main (`dabcba3`): agent rules, the monorepo, CI, Postgres/PostGIS, MinIO, the `groundwork_app` role, `withWorkspaceContext`, and the office shell. ADR 0001 through ADR 0005.
- Imagery registry and TiTiler are on main (`2fe041f`). Migration `0003_imagery.sql`, the fixture COG, and the guarded tile service. ADR 0006. `/imagery/*` now uses the session and membership check from this slice. `x-workspace-id` still names the workspace.
- Migration `0002_auth_workspaces.sql` adds `app_user`, `workspace`, `role`, `session`, `account`, `verification`, `member`, and `invitation`. The six system roles and their permission tokens are seeded. ADR 0007. Better Auth's organization is the workspace. A separate `groundwork_auth` role serves sign-up and sessions. `groundwork_app` cannot assume it.
- Email and password, magic links, and invites. Google stays off unless both client env vars are set. With no SMTP host, development logs the message. Mailpit is the local catcher.
- Member transitions live in `packages/shared`. Illegal transitions, an expired invite, and removing the last owner return 409. Disabling a member deletes that user's sessions before the response returns.
- Tenant routes, including imagery, return 404 when the session is not an active member. `GET /catalog-items` is a fixture: roles with `catalog.manage` see `unit_cost_cents`, and other roles do not.
- The office app has sign-up, sign-in, create workspace, a switcher, settings, members, and the role list. Playwright covers the keyboard sign-up path.
- CI `check` runs lint, typecheck, unit tests, the Python guard tests, and build. The `db` job migrates and runs RLS and auth tests. The `imagery` job renders the fixture tile with a real session. An `e2e` job runs Playwright.

## Not in this slice

- `locationId` resolution. The location table is spec 03.
- County ingest, the ingest API, takeoff drawing, and proposal PDF attribution.
- A persisted catalog. `GET /catalog-items` is the cost-visibility fixture.
- Custom roles, SSO, SCIM, and per-field permissions beyond cost visibility.
- A browser-facing signed tile URL. Imagery still proxies.
- Sentry. Choosing a license. Choosing between Fly and Render.
- The remaining gaps in `docs/specs/OPEN-QUESTIONS.md`.
- Sign-ups or spend. No hosted secrets in git. Local compose passwords, the tile signing secret, and the local Better Auth secret are laptop defaults and are refused when `NODE_ENV=production`.

## Open questions

See `docs/specs/OPEN-QUESTIONS.md`. Do not answer the unresolved lines in a drive-by.
