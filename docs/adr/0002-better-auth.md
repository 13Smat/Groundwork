# ADR 0002: Better Auth with the organizations plugin

## Status

Accepted (2026-11-26).

## Context

`docs/specs/02-auth-workspaces.md` needs owners to sign up, create a workspace, invite members, and scope every request to one workspace. The spec's buy-versus-build section names Better Auth (self-hosted, organizations plugin, no per-user fee) and Clerk (free tier, then a per-org price) and leaves the choice open.

Each contractor workspace is an organization. Spec 02's permission table and the RLS rule in spec 00 (`app.workspace_id` on every request) still apply whichever library owns the session.

## Decision

- Auth is Better Auth, self-hosted in the API process, with the organizations plugin.
- A Better Auth organization is a Groundwork workspace. Session cookies for the office app and bearer tokens for the crew app stay as spec 00 describes.
- Disabling a member still has to end that member's sessions. The acceptance criteria in spec 02 are unchanged.
- Clerk is not the plan.

How Better Auth's own tables map onto the `app_user`, `member`, and `role` tables in `docs/specs/01-data-model.md`, and whether `citext` is required, is not decided. See `docs/specs/OPEN-QUESTIONS.md`. Do not invent that mapping in an implementation ticket without flagging it.

## Alternatives

- Clerk. The spec prices it (read 2026-11-25) and notes that the org limit is the cost driver because each workspace is an org. Rejected. Andy chose Better Auth.
- A hand-rolled session table. Rejected. Spec 02 says buy-ish, and Better Auth already has the organizations plugin this product needs.

## Consequences

- There is no per-user auth bill. We operate the auth server, the session store, and the email or OAuth configuration.
- Local and CI do not call a hosted auth vendor. Better Auth runs against the Docker Postgres from ADR 0001.
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are empty placeholders in `.env.example`. A generated secret stays in an untracked `.env`.
- Roles, cost visibility, and RLS tests in spec 02 remain the acceptance criteria. The library does not replace the API guard or the Postgres policy.

## References

- `docs/specs/02-auth-workspaces.md`
- `docs/specs/00-architecture.md` (Auth row)
- `docs/specs/01-data-model.md` (`app_user`, `member`, `role`)
- `docs/specs/OPEN-QUESTIONS.md`
- `docs/adr/0001-stack.md`
