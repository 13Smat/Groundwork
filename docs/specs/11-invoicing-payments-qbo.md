# 11 — Invoicing, payments & QuickBooks Online

Phase: v1. Effort: 4 person-weeks (estimate). Depends on: 07, 08; 09/10 optional (progress billing from daily reports).

## Goal
Bill from the accepted estimate (deposit, progress, final), collect card/ACH online via Stripe, and keep QuickBooks Online in sync so the contractor's bookkeeper doesn't re-key anything.

## User stories
- I create an invoice from a won job: deposit (% or $), progress (by % complete or quantities from daily reports), or final (remaining balance).
- I send an invoice by email with a pay link; the client pays by card or ACH; the invoice updates to paid automatically.
- I record offline payments (check, cash).
- I connect QuickBooks Online once; customers, items, invoices and payments sync; I see sync status and errors per record.
- I see AR: outstanding, overdue, collected this month.

## Screens
Invoices list (tabs: draft, outstanding, overdue, paid); Invoice editor (lines from estimate groups, % billed to date, retainage Later); Invoice public pay page (Stripe Checkout or Payment Element); Payments list; Settings > Payments (Stripe connect onboarding); Settings > QuickBooks (connect, mappings: income account, tax codes, item mapping, sync log).

## API
| Method | Path |
|---|---|
| POST | /jobs/:id/invoices {type: deposit|progress|final, amount|percent|quantities} |
| GET/PATCH | /invoices/:id ; POST /invoices/:id/send ; POST /invoices/:id/void |
| POST | /invoices/:id/payments (manual) |
| POST | /payments/stripe/connect (account link) ; POST /webhooks/stripe |
| GET | /integrations/qbo/connect (OAuth2) ; GET /integrations/qbo/callback ; POST /integrations/qbo/disconnect |
| POST | /integrations/qbo/sync {entity?} ; GET /integrations/qbo/log ; POST /webhooks/qbo |

## Entities
Invoice, InvoiceLine, Payment, ExternalLink, EventLog, Job, Client.

## State machine — Invoice.status
`draft -> sent -> partially_paid -> paid`; `sent|partially_paid -> overdue` (nightly job past due_date) and back on payment; `draft|sent -> void` (void syncs to QBO as void).

## Stripe design
- Each contractor gets a Stripe Connect account (Standard or Express — open decision) so funds go to them; our platform can add an application fee (business decision).
- Pay page creates a PaymentIntent with `metadata.invoice_id`; webhook `payment_intent.succeeded` -> Payment row (idempotent by PI id) -> invoice balance.
- Pricing: 2.9% + 30¢ per successful domestic card transaction on standard pricing (https://stripe.com/pricing, 2026-11-25). ACH and Connect fees: see Stripe pricing page (not quoted here). Large paving invoices make ACH the default suggestion.

## QuickBooks Online design
- OAuth2 per workspace; tokens encrypted at rest; refresh job.
- Push model: our Client -> QBO Customer, Invoice -> QBO Invoice, Payment -> QBO Payment, line items -> a mapped QBO Item (service) per estimate group or single "Contract work" item (setting).
- Pull: QBO webhooks + periodic Change Data Capture for payments recorded in QBO.
- Writes (create/update) are Core calls, unmetered; reads/queries are CorePlus, metered. Builder tier: free, 500,000 CorePlus calls/month, calls beyond blocked; Silver $300/mo with 1M included (https://help.developer.intuit.com/s/article/platform-service-fees ; tier amounts as summarized at https://blogs.intuit.com/2025/10/23/unlock-premium-apis-and-developer-support-with-silver-tier/ , read 2026-11-25). Design for webhooks + CDC, never per-minute polling.
- Production access requires Intuit app review/security questionnaire (schedule time).

## Edge cases
- Customer already exists in QBO (same name) -> match by email/display name, ask user to confirm mapping.
- QBO tax: US sales tax (AST) behaves differently per company; v1 sends tax as calculated by QBO or a single tax line (setting) — test against sandbox companies.
- Partial refund in Stripe -> negative Payment/Refund record; sync as refund receipt (v1: manual flag).
- Invoice edited after sync -> push update; if paid in QBO, block edit.
- Token revoked by user in QBO -> mark disconnected, surface banner, queue changes.
- Webhook ordering (payment before invoice sync) -> queue until ExternalLink exists.

## Acceptance criteria
- Deposit 30% invoice on a $10,000.00 estimate = $3,000.00; final invoice = $7,000.00 after deposit paid (unit test).
- Stripe test-mode payment marks invoice paid exactly once under webhook replay (test).
- QBO sandbox: create client+invoice+payment in our app -> appear in QBO with matching totals; payment recorded in QBO -> appears in our app within one CDC cycle (staging e2e).
- No polling loop issues CorePlus reads more often than every 15 min per company (code review + metric).
- Every sync error is visible per record with retry action.

## Out of scope
AIA pay applications/retainage, certified payroll, Xero, payroll sync, consumer financing (Later).

## Buy vs build
Buy Stripe (payments) and integrate QBO API (no middleware at v1). Unified accounting APIs (e.g. Merge, Codat, Rutter) only if Xero/Sage demand appears — not priced here.
