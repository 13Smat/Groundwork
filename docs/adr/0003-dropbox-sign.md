# ADR 0003: Dropbox Sign behind a SignatureProvider

## Status

Accepted (2026-11-26). The interface name is `EsignProvider`. See ADR 0021.

## Context

`docs/specs/08-proposals-esign.md` generates a proposal PDF and sends it for signature. On signature the job becomes won and a work order is created. The spec leaves the vendor open among Documenso (self-host AGPL, or cloud), the Dropbox Sign API, and the DocuSign API, and recommends wrapping the call behind an interface.

Andy chose the Dropbox Sign API. Prices in spec 08 were read 2026-11-25; this ADR does not re-quote them. Spec 08's interface name is `EsignProvider`. This decision uses `SignatureProvider` for the same seam. The spec files are unchanged. A later ticket should use one name and flag the rename rather than silently treating them as two interfaces.

## Decision

- E-sign goes through a `SignatureProvider` interface. The first real implementation is the Dropbox Sign API.
- Local development and CI use a fake `SignatureProvider`. They do not call Dropbox Sign and do not need an account.
- Webhooks stay idempotent: verify the provider signature, store the event in `event_log`, and upsert by envelope id, as spec 08 requires.
- Optional items stay on our own public page. The signed PDF is rendered after the client chooses, then sent to Dropbox Sign. That is the spec 08 approach, and it does not depend on Dropbox Sign form fields.
- No Dropbox Sign key is committed. `.env.example` has empty `DROPBOX_SIGN_API_KEY` and `DROPBOX_SIGN_CLIENT_ID` placeholders.

## Alternatives

- Documenso self-hosted. Spec 08 notes the AGPL-3.0 duty if we modify it and offer it over the network. Rejected as the starting vendor. Andy chose Dropbox Sign.
- Documenso cloud. Rejected as the starting vendor for the same reason.
- DocuSign. Spec 08 keeps it as an enterprise option. Rejected for now. A later adapter can implement the same interface if a customer requires it.
- Building click-to-sign ourselves. Spec 08 rejects this for MVP because of ESIGN/UETA, the audit trail, and tamper evidence.

## Consequences

- Call sites depend on `SignatureProvider`, not on Dropbox Sign types. A second vendor is another implementation.
- Staging uses Dropbox Sign test mode when an account exists. Ticket 0 does not create that account.
- The public proposal page, `public_token_hash`, and `selected_optional_line_ids` are still missing from the spec 01 sketch and the spec 08 route table. That gap is listed in `docs/specs/OPEN-QUESTIONS.md` and is not designed here.

## References

- `docs/specs/08-proposals-esign.md`
- `docs/specs/OPEN-QUESTIONS.md`
- `docs/adr/0001-stack.md`
