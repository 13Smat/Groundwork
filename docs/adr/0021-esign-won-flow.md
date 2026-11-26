# ADR 0021: E-sign adapter, public options, and the won flow

## Status

Accepted (2026-11-26).

## Context

ADR 0003 chose Dropbox Sign behind one provider interface and left the name as `SignatureProvider`, with a note that the later ticket should use one name. Spec 08 calls that seam `EsignProvider`. ADR 0020 stored `public_token_hash` at insert and did not return the raw token. Spec 08 sends the client to a public page to choose optional items before the envelope is created. `event_log` already exists in migration `0001` and has no `workspace_id`. Spec 01's work order sketch has no status graph.

## Decision

- The interface is `EsignProvider`. There is no second `SignatureProvider` type. `FakeEsignProvider` is the local and CI implementation. `DropboxSignProvider` is constructed only when `DROPBOX_SIGN_API_KEY` is set, and its tests use an injected `fetch` plus a recorded event hash. `DROPBOX_SIGN_CLIENT_ID` stays a placeholder and is unused.
- Migration `0017_esign_work_order.sql` adds `work_order` and `proposal_token`. Both force row security. Grants are to `groundwork_app` only. `work_order_before_update` is `SECURITY INVOKER`. `event_log` is not recreated and does not gain `workspace_id`.
- `proposal_token` is the public lookup. A SELECT policy matches `token_hash` to `app.proposal_token_hash`. The API sets `app.workspace_id` only after that hash matches with `timingSafeEqual`. The `proposal` table stays tenant-only. `POST /proposals/:id/link` replaces the hash while the proposal is `rendered` and returns the raw token once. Send does not rotate it.
- `GET/POST /public/proposals/:token` and `POST /webhooks/esign/:provider` are tagged `public` and `webhook`. They are not tenant routes. Both are limited to 30 calls per 10 seconds per address per process. A bad webhook signature is 401. A voided, expired, or superseded link was 410. ADR 0024 supersedes that status: those links, a replaced token, and an unknown token return one 404.
- Fake webhooks sign the raw body with `ESIGN_WEBHOOK_SECRET`. Dropbox Sign webhooks use that vendor's HMAC of `event_time` + `event_type` keyed by the API key. The comparison is constant time. The Dropbox reply body is `Hello API Event Received`.
- `POST /public/proposals/:token/sign` exists only when the active provider is `fake`. It is the local and CI stand-in for a signer, not a production click-to-sign product.
- When every recipient has `signed_at`, one transaction sets the proposal to `signed`, the estimate to `accepted`, the job to `won` with `hasSignedProposal`, inserts `work_order` as `ready`, stores the signed PDF, and writes `audit_log` and `usage_event`. An earlier webhook stays unprocessed until send stores the envelope id. A duplicate `(provider, event_id)` does not apply twice.
- `esign_send` is recorded on send and again when the proposal is signed. A replay does not add a third row.
- Revise voids a proposal that is not signed, then calls `POST /estimates/:id/versions`. The new proposal keeps the `P-1001` number shape. No revision suffix is added.
- `proposal_before_update` is replaced so optional items, expiry, the public hash, recipients, and the message can change while the proposal is still `rendered`. Intro, scope, terms, and the template stay draft-only.

## Alternatives

- A permissive policy on `proposal` itself. Rejected because a token setting would widen every tenant read of that table.
- Adding `workspace_id` to `event_log`. Rejected. The sketch and ADR 0005 leave it off, and the question is still open.
- A proposal number suffix on revise. Rejected. The check constraint is `^P-[0-9]+$` and spec 08 does not define the suffix.
- Calling Dropbox Sign from CI. Rejected. ADR 0003 keeps local and CI on the fake.

## Consequences

- The signed PDF object is written before the transaction commits. A fault after that write rolls the database back and can leave an object with no `file` row.
- The public and webhook limits are per process.
- Dropbox Sign's hash does not cover the body. The adapter still requires a matching hash and reads workspace and proposal ids only from that verified payload. Before `DropboxSignProvider` is enabled outside local and CI, each signed or declined webhook has to be confirmed by fetching that signature request from the Dropbox Sign API. That check is not in this adapter. `STATUS.md` records it as a go-live gate.
- `FakeEsignProvider` keeps sent PDFs in memory. A process restart drops them. The won flow for the fake reads the proposal PDF already stored for the workspace.
- Spec 08's revision suffix, and whether `event_log` should be tenant-scoped, stay in `docs/specs/OPEN-QUESTIONS.md`.

## References

- ADR 0003, ADR 0020
- `docs/specs/08-proposals-esign.md`
- `db/migrations/0017_esign_work_order.sql`
