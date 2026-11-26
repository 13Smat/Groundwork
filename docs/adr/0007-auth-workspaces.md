# ADR 0007: Auth tables, sessions, and workspace membership

## Status

Accepted (2026-11-26).

## Context

ADR 0002 picks Better Auth with the organizations plugin. `docs/specs/01-data-model.md` sketches `app_user`, `member`, and `role` and does not say which of those Better Auth owns. `docs/specs/02-auth-workspaces.md` requires email and password, magic links, invites, six system roles, and a 404 when a session names a workspace the caller does not belong to. ADR 0006 left `/imagery/*` behind `stubImageryAuth`, which trusted `x-workspace-id` and did not check a session.

Better Auth 1.7.28's Kysely adapter binds every id as text. Postgres has no `uuid = text` operator, so a `uuid` primary key breaks the library's `where` clauses. The organizations plugin also refuses a `member` insert when a column it does not write is `not null` without a default.

## Decision

- Better Auth's tables are the domain tables. `user` is `app_user`. `organization` is `workspace`. `member` and `invitation` keep those names. There is no second membership store. Groundwork owns `role` (`permissions text[]`, `is_system`). `member.role` stays the plugin's role name. Authorization reads `member.role_id`.
- Primary keys and foreign keys that Better Auth compares are `text` holding a UUIDv7, with a check constraint. Tenant comparisons still use the foundations expression, with `::uuid` on the text column. `counters`, `file`, `audit_log`, `usage_event`, and the imagery tables stay `uuid`. This migration does not add foreign keys from those tables to `workspace`.
- A second login role, `groundwork_auth`, is created outside the migration transaction. It is not a superuser and does not bypass row security. Policies name `current_user = 'groundwork_auth'`. The app role cannot set that. Sign-up, sessions, accounts, and verification writes use this role. Tenant routes use `groundwork_app`.
- `member.role_id` is nullable only so the plugin's schema check accepts the table. A `before insert` trigger fills it from the system role name and rejects anything else. Our routes set `role_id` themselves.
- System roles are seeded with a null `workspace_id` so `GET /roles` works before a workspace is chosen. Custom role rows, later, are visible only inside their workspace. The app role cannot insert a null `workspace_id`.
- The permission matrix is stored as literal tokens. Qualifiers in the spec ("read", "read assigned", "read own", "crew only") are `takeoff.read`, `estimate.read`, `proposal.read`, `crm.read.assigned`, `jobs.read.assigned`, `schedule.read`, `schedule.read.own`, and `time.approve.crew`. Wildcards are not expanded.
- An invite is a row with status `invited`, not a delete. Revoke sets `revoked` and cancels the pending invitation (`canceled`, the plugin's spelling). The token is the invitation id. It lasts 7 days. The same pending email updates that row.
- `POST /workspaces/:id/activate` records the active workspace on the session. The spec table does not name a switch route.
- `GET /catalog-items` returns one fixture row until spec 06. `catalog.manage` keeps `unit_cost_cents`. Every other role loses that key.
- `/imagery/captures` and `/imagery/tiles/...` use the same session and membership check as the other tenant routes. `x-workspace-id` still selects the workspace. No session is 401. A bad header is 400. A session that is not an active member is 404. A disabled member loses every session and the next request is 401.
- Email and password and magic links are on. Google is registered only when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. With no `SMTP_HOST`, development logs the message and production throws. Mailpit is the local SMTP catcher.

## Alternatives

- A parallel Better Auth schema plus Groundwork tables synced by triggers. Rejected. Two membership stores drift, and the ticket asks for one organization equal to one workspace.
- `uuid` primary keys with a cast in every query. Rejected. The adapter binds text, and Postgres will not compare `uuid` to `text` in the library's SQL.
- A GUC such as `app.auth_plane` that `groundwork_app` can set to read every user. Rejected. Any tenant request could set it and bypass isolation. Naming the login role in the policy does not have that hole.
- Delete the member row on revoke, matching the spec's "(deleted)". Rejected. The audit row would point at a missing member, and a partial unique index can ignore `revoked` so the same person can be invited again.
- Leave `stubImageryAuth` in place. Rejected. The imagery routes would keep trusting a header.

## Consequences

- Disabling a member deletes every session for that user, including sessions used for another workspace. The memberships remain. The person signs in again. This is recorded in `docs/specs/OPEN-QUESTIONS.md`.
- `GET /roles` returns the six system roles with no workspace setting. A test that expects zero rows from every table without `app.workspace_id` must not include `role`.
- Imagery tables still have no foreign key to `workspace`. `0003` shipped before this table existed. Tenant imagery rows are still isolated by their own policy.
- The spec files were not edited. The token vocabulary, the `revoked` status, the activate route, the text keys, and the catalog fixture are listed in `docs/specs/OPEN-QUESTIONS.md`.

## References

- `docs/adr/0002-better-auth.md`
- `docs/adr/0006-imagery-registry-and-tiles.md`
- `docs/specs/02-auth-workspaces.md`
- `docs/specs/01-data-model.md`
- `docs/specs/OPEN-QUESTIONS.md`
