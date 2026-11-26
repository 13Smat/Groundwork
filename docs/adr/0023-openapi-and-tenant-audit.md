# ADR 0023: OpenAPI artifact, tenant sweep, and the schema audit

## Status

Accepted (2026-11-26).

## Context

Spec 00 says `/openapi.json` is generated and diffed in CI, and a breaking change fails unless the API version is bumped. Spec 02 says a valid session that is not a member of the named workspace gets 404 on every tenant route, and that list is generated from the OpenAPI document. The same spec says a query with no `app.workspace_id` returns no rows.

The API already served the document from `@fastify/swagger`. Nothing committed it, so a route could change without a reviewable diff. The existing auth test checks that an outsider is not a member of the workspace in the header. It substitutes fresh ids, so a missing workspace filter still returns 404. It does not prove that workspace A cannot read workspace B's row.

`member_fill_role_id` in migration `0002` was `SECURITY DEFINER`. The imagery admin policies in `0004` let `app.imagery_admin=on` read and write every workspace's source, capture, and ingest job. An owner of workspace A could patch workspace B's source.

## Decision

- `apps/api/openapi.json` is the canonical document. `pnpm openapi:write` regenerates it. `pnpm openapi:check` fails when the file does not match the running API. Prettier does not format the file, so the generator's bytes stay the check. On a pull request, CI compares the file with the base. A missing base file is treated as an empty document at version `0.0.0`, so the first commit is not a break. Removed paths or operations, removed fields, newly required fields, and narrowed types fail unless `info.version` changes.
- The differ lives in `apps/api/src/openapi/diff.ts`. Fixtures cover one breaking change and one compatible change. A version bump clears the blocking list and still reports the breaks.
- Tenant operations are the ones tagged `tenant-header`, `tenant-workspace`, or `tenant-member`. `public` and `webhook` are excluded by those tags. `session` covers `/me`, `/roles`, workspace create, invite accept, and Better Auth's `/auth/*`. `meta` covers `/healthz` and `/openapi.json`. An operation with none of those tags fails the planner. A tenant operation with no fixture fails it. A caller-scoped fixture may not name a resource path parameter.
- The contract test signs in as workspace A and calls every foreign fixture with a real workspace B id. The status must be 404 problem+json. Collection routes are listed as caller-scoped and are not expected to 404.
- `state-machine` is an extra tag on the illegal-transition routes. The problem sweep requires each of them to return 409 problem+json, and every operation with a request body to return 400 or 422 problem+json for a JSON array. In production, a problem detail that contains SQL or a stack is replaced. A 500 without a safe detail is replaced. A safe 500 detail is kept.
- The schema audit reads `pg_class`. Every public table with `workspace_id NOT NULL` must have row security enabled and forced, a policy that names `app.workspace_id`, no `PUBLIC` grant, and zero rows for `groundwork_app` when the setting is unset. `member` and `invitation` may also be granted to `groundwork_auth`, because Better Auth writes them (ADR 0007). Tables without that column are named in the test with a reason. `proposal_token`'s hash policy is SELECT-only and returns zero rows when `app.proposal_token_hash` is unset. No public function is `SECURITY DEFINER` unless an extension owns it. `groundwork_app` and `groundwork_auth` are not superuser and do not bypass row security.
- Migration `0018_member_role_invoker.sql` recreates `member_fill_role_id` as `SECURITY INVOKER`. System roles are visible under the role policy. The same migration replaces the imagery admin policies so they match a null `workspace_id` or the caller's workspace. Ingest jobs are visible only in the caller's workspace. The source list, patch, and ingest lookup use the same predicate in SQL.

## Alternatives

- `oasdiff` or `openapi-diff` as a dependency. Rejected. The rules we fail on are a small set, and an in-repo differ is what the fixture tests run.
- An allowlist of public paths. Rejected. A new public route would be skipped or, if the list was forgotten, treated as tenant. The tag is the exclusion.
- Editing `0002` or `0004`. Rejected. Shipped migrations stay as they were applied.
- Leaving `member_fill_role_id` as `SECURITY DEFINER` and exempting it in the audit. Rejected. The function only reads a system role, and both app roles can already read that row.
- Revoking `groundwork_auth`'s grants on `member` and `invitation`. Rejected. Better Auth writes those tables. The audit names the exception.

## Consequences

- A new tenant route fails CI until it has a fixture. A new table fails the schema audit until it has a tenant policy or an explicit reason.
- `info.version` is still `0.0.0`. The first real break has to bump it.
- Imagery admin can still edit a global source. It cannot edit another workspace's source.
- SaaS self-billing stays out of this slice. `docs/specs/OPEN-QUESTIONS.md` already says there is no spec for it.

## References

- ADR 0006, ADR 0007, ADR 0008
- `docs/specs/00-architecture.md`
- `docs/specs/02-auth-workspaces.md`
- `apps/api/openapi.json`
