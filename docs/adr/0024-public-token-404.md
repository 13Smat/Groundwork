# ADR 0024: Public token 404 parity and the WITH CHECK audit

## Status

Accepted (2026-11-26).

## Context

ADR 0021 returned 410 for a voided, expired, or superseded public proposal link and 404 for a token that did not match a row. The two statuses, and the two problem details, told a caller that a guess was not a real token and that a real token had been revoked. A token shorter than 20 characters also returned 400 from the route schema before the handler hashed it, so that request skipped the lookup.

ADR 0023's schema audit checks that a tenant table forces row security and has some policy that names `app.workspace_id`. An INSERT, UPDATE, or ALL policy can still omit WITH CHECK. Postgres then uses the USING expression for the new row when WITH CHECK was left out, and the catalog stores no WITH CHECK to audit. ADR 0007 lets `groundwork_auth` write `member` and `invitation`. ADR 0023 keeps those grants.

`proposal.public_token_hash` and `proposal_token.token_hash` are already SHA-256 hex. A plaintext token column would undo that.

## Decision

- `GET /public/proposals/:token`, `POST /public/proposals/:token`, and `POST /public/proposals/:token/sign` return one problem+json document for an unknown token, a voided proposal, an expired proposal, a superseded estimate, and a token that no longer matches the proposal hash. The status is 404. `type` is `about:blank`, `title` is `Not Found`, `detail` is `This link isn't available.`, and `instance` is `/public/proposals/{token}`. The body does not contain the raw token. Headers do not vary with the reason. `date` may differ between requests.
- The handler hashes the token and looks the hash up before it chooses that response. It does not return on length first. Input longer than 200 characters is hashed from a 200-character prefix so one huge URL cannot skip the lookup. An issued token is 43 characters and is hashed in full.
- The server log records `unknown`, `void`, `expired`, `superseded`, or `used`. It does not record the token or the hash. A replaced link deletes the old `proposal_token` row, so that token is `unknown`. `used` is the case where the lookup row remains and `proposal.public_token_hash` does not match it.
- A rendered, sent, viewed, declined, or signed link still returns the proposal. The public page after a fake signature reads that response. The page's error state is only the heading `This link isn't available.` It does not show the response detail.
- When the active provider is not `fake`, `POST /public/proposals/:token/sign` still hashes and looks the token up, then returns that same 404. It does not describe a different missing action.
- The schema audit in `pnpm test:rls` requires every INSERT, UPDATE, and ALL policy on a table with `workspace_id NOT NULL` to have a WITH CHECK that names `app.workspace_id`. The exception is a WITH CHECK that is only `current_user = 'groundwork_auth'` on `member` or `invitation` (ADR 0007, ADR 0023). The same audit fails a token column on `proposal` or `proposal_token` other than the two hash columns, and those checks stay `^[0-9a-f]{64}$`.
- The policies already meet that WITH CHECK rule. There is no migration `0019`.
- The public token parameter no longer declares `minLength` or `maxLength`, so a short token is the same 404. That relaxation is not a breaking change under the OpenAPI differ. `info.version` stays `0.0.0`.

## Alternatives

- Keep 410 and rely on the client to hide it. Rejected. The status and the detail are the oracle.
- Return 404 with a detail that still says the link expired. Rejected. The body has to match a guess.
- Pad every rejection with the same extra queries so the timing matches a revoked row. Rejected. The requirement is to hash and look up before deciding, not to hide every later read.
- Store replaced hashes so the log can say `used` instead of `unknown`. Rejected. The old row is deleted on purpose. Keeping it would be a new capability table for no response difference.
- Edit `0017` to add WITH CHECK where it was missing. Rejected. Shipped migrations stay as they were applied, and the live policies already have the check.
- Exempt every policy that mentions `groundwork_auth`, on any table. Rejected. The exception is the login-role branch on `member` and `invitation` only.

## Consequences

- A client that treated 410 as "this proposal was real" now sees the same 404 as a bad link. ADR 0021's 410 sentence is superseded by this record.
- A signed link still loads. Refreshing the public page after a signature shows the signed proposal.
- The audit fails a new tenant write policy that omits WITH CHECK or that does not name `app.workspace_id`, unless it is the auth branch on `member` or `invitation`.
- `docs/specs/08-proposals-esign.md` does not name these public routes. The spec file was not edited.

## References

- ADR 0007, ADR 0021, ADR 0023
- `docs/specs/08-proposals-esign.md`
- `apps/api/src/proposals/esign-flow.ts`
- `apps/api/test/schema-audit.test.ts`
