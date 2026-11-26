# 08 — Proposals & e-sign

Phase: MVP. Effort: 2.5 person-weeks (estimate). Depends on: 07.

## Goal
Generate a branded proposal PDF from an estimate version, send it for e-signature, and on signature mark the job won and create a work order.

## User stories
- I pick a proposal template (cover, scope by group, site map image with takeoff overlay, price table, optional items, terms, signature block) and preview it.
- I edit intro/scope text and terms per proposal; templates hold defaults.
- I send to one or more client contacts; they sign in the browser (no account); I see sent/viewed/signed status.
- Client picks optional items before signing; total updates; the signed PDF shows choices.
- On signature: job -> won, estimate -> accepted, work order created with accepted scope, signed PDF stored, notification to owner.
- I void and resend a revised proposal (new estimate version).

## Screens
Proposal builder (template picker, sections editor, live PDF preview via pdf.js), Send dialog (recipients, message, expiry), Proposal status page (timeline), Templates settings, Client signing page (provider-hosted or embedded).

## API
| Method | Path |
|---|---|
| POST | /estimates/:id/proposals {templateId} |
| GET/PATCH | /proposals/:id (sections, terms, expiresAt) |
| POST | /proposals/:id/render -> pdf_file_id (worker; Playwright HTML->PDF) |
| POST | /proposals/:id/send {recipients[], message} -> provider envelope |
| POST | /proposals/:id/void |
| POST | /webhooks/esign/:provider (signature events; verify signature; idempotent via EventLog) |
| GET/POST | /proposal-templates ; PATCH /proposal-templates/:id |

## Entities
Proposal, Signature, Estimate, Job, WorkOrder, File, EventLog.

## State machine — Proposal.status
`draft -> rendered -> sent -> viewed -> signed`; `sent|viewed -> declined | expired`; any non-signed -> `void`. On `signed`: transaction { estimate.accepted; job.won; work_order.create(ready); store signed PDF }.

## Optional items design
Provider-agnostic approach: client selects options on our own public page (signed URL, no login) -> we render the final PDF with chosen options -> then send that PDF to e-sign. Avoids depending on provider form-field logic.

## Edge cases
- Webhook arrives before send response returns -> EventLog + upsert by envelope id.
- Duplicate webhook -> no-op.
- Signer email bounces -> status `sent` with bounce flag, owner notified.
- Estimate edited after send -> blocked; must create new version and void old proposal.
- Multiple signers (owner + property manager) -> signed only when all sign.
- Expired proposal reopened -> new send, same proposal number with revision suffix.

## Acceptance criteria
- Render of a 40-line estimate with site image completes < 10 s and is deterministic (same input -> same PDF text layer) (test).
- Webhook replay of the same event 5 times creates exactly one Signature and one WorkOrder (test).
- Signed flow in provider test mode moves job to won and creates a work order (e2e in staging).
- PDF shows imagery provider, capture date, GSD and required attribution for each aerial takeoff, plus a "quantities measured from aerial imagery; field verify" note (snapshot test).
- Voided proposal's signing link no longer allows signing (provider API call verified in test mode).

## Out of scope
Change orders, deposits at signing (v1 via 11), client portal (Later), sub e-sign agreements (Later).

## Buy vs build (prices read 2026-11-25)
| Option | Price | Notes |
|---|---|---|
| Documenso self-hosted | Software free; AGPL-3.0 (https://github.com/documenso/documenso) | AGPL: modifications must be published if offered over network; keep it as a separate unmodified service. We run/secure it. |
| Documenso cloud | Teams $40/mo (5 users, embedded signing), Platform $250/mo (unlimited docs/API, white-label embedded) billed yearly (https://documenso.com/pricing) | |
| Dropbox Sign API | Essentials from $75/mo billed yearly ($900/yr), starting at 50 signature requests/mo; Standard $250/mo billed yearly ($3,000/yr) from 100/mo; test mode free (https://sign.dropbox.com/products/dropbox-sign-api/pricing) | Page renders inconsistently; confirm in sales call |
| DocuSign developer API | Starter $50/mo annual (40 envelopes/mo), Intermediate $300/mo (100), Advanced $480/mo (100); monthly billing $75/$450/$720 (https://ecom.docusign.com/isv/plans-and-pricing/developer ; https://www.docusign.com/blog/docusign-plans-and-pricing) | Brand trust with commercial GCs |
| Build own click-to-sign | engineering time | ESIGN/UETA compliance, audit trail, tamper-evidence — not MVP |
Recommendation: wrap behind an `EsignProvider` interface; start with Documenso cloud Platform or Dropbox Sign; keep DocuSign adapter for enterprise. Open decision.
