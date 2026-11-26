# 02 — Auth & workspaces

Phase: MVP. Effort: 1.5 person-weeks (estimate). Depends on: foundations.

## Goal
Owners sign up, create a workspace, invite teammates with roles; every request is scoped to one workspace.

## User stories
- As an owner, I sign up with email (magic link or password) or Google and create a workspace with company name, timezone, currency, units.
- As an owner/admin, I invite members by email with a role; they accept and land in the workspace.
- As a member of two workspaces, I switch between them.
- As an admin, I disable a member; their sessions end immediately.
- As a crew member (v1), I sign in on the crew app with phone/email + code.

## Screens
Sign up / sign in; Create workspace; Workspace settings (company, logo, address, license #, defaults); Members (list, invite, role, disable); Roles (view system roles; custom roles = Later); Workspace switcher.

## API
| Method | Path | Notes |
|---|---|---|
| POST | /auth/* | provided by auth library (sign-up, sign-in, magic link, OAuth callback, sign-out) |
| GET | /me | user + memberships |
| POST | /workspaces | create; caller becomes owner |
| GET/PATCH | /workspaces/:id | settings |
| GET | /workspaces/:id/members | |
| POST | /workspaces/:id/invites | {email, roleId} |
| POST | /invites/:token/accept | |
| PATCH | /members/:id | role, status |
| GET | /roles | system roles + permissions |

## Entities
Workspace, User, Member, Role, AuditLog.

## State machine — Member
`invited -> active` (accept) · `active -> disabled` (admin) · `disabled -> active` (admin) · `invited -> (deleted)` (revoke). Invite token expires in 7 days.

## Permissions (system roles)
| Permission | owner | admin | estimator | office | foreman | crew |
|---|---|---|---|---|---|---|
| workspace.manage, billing | ✓ | ✓ (no billing) | | | | |
| members.manage | ✓ | ✓ | | | | |
| crm.* , jobs.* | ✓ | ✓ | ✓ | ✓ | read assigned | |
| takeoff.*, estimate.*, proposal.send | ✓ | ✓ | ✓ | read | | |
| catalog.manage (costs visible) | ✓ | ✓ | ✓ | | | |
| schedule.manage | ✓ | ✓ | | ✓ | read | read own |
| time.own, checklist.own, photo.own | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| time.approve | ✓ | ✓ | | ✓ | crew only | |
| invoice.* | ✓ | ✓ | | ✓ | | |

## Edge cases
- Invite to an email that already has a user -> link membership, no new user.
- Last owner cannot be demoted/disabled.
- Same email invited twice -> resend, single pending invite.
- User removed from workspace while offline on crew app -> next sync returns 401/403 and app wipes that workspace's local data.
- Cost visibility: roles without `catalog.manage` never receive unit costs in API responses (prices only).

## Acceptance criteria
- New user can sign up, create workspace, and see an empty dashboard in under 2 minutes (e2e).
- API request with a valid session but a workspace the user is not a member of returns 404 for every tenant resource (e2e across all routes, generated from OpenAPI).
- Disabling a member invalidates their sessions within 60 s.
- Estimator role GET /catalog-items includes unit_cost_cents; office role response omits it (contract test).
- RLS test: raw SQL without `app.workspace_id` set returns 0 rows from tenant tables.

## Out of scope
SSO/SAML (Later), custom roles (Later), SCIM, per-field permissions beyond cost visibility.

## Buy vs build
Buy-ish: Better Auth (open-source, self-hosted in Node, organizations plugin) — no per-user fee. Alternative Clerk: free to 50,000 monthly retained users and 100 monthly retained orgs; Pro from $20/mo billed annually (https://clerk.com/pricing, 2026-11-25). Each contractor workspace is an org, so Clerk's org limit is the cost driver; pick Better Auth unless time-to-market dominates. Open decision for Andy.
