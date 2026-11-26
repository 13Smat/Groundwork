# 03 — CRM & jobs

Phase: MVP (core), v1 (pipeline automations), Later (inbox, lead forms, call tracking). Effort: 2.5 person-weeks (estimate). Depends on: 02.

## Goal
One place for clients, contacts, sites and jobs, with a sales pipeline that the takeoff/estimate/proposal flow moves forward automatically.

## User stories
- As an estimator, I create a job from an address in under 30 s; the client and site can be new or existing.
- As an owner, I see the pipeline as a board by stage with total bid value per column.
- As an estimator, I see a job page with site map, takeoffs, estimates, proposals, notes, tasks, photos, activity.
- As office staff, I find any client/job by name, number, address or phone.
- As an estimator, I mark a job lost with a reason.

## Screens
Pipeline board (Lead, Estimating, Proposed, Won, Lost; drag to change, with guards); Job list (filters: stage, owner, date, tag); Job create (address-first: autocomplete -> pick/confirm client -> name auto-filled from address); Job detail (header: number, stage, client, site, bid value, owner; tabs: Overview, Takeoffs, Estimates, Proposals, Work orders [v1], Invoices [v1], Files/Photos, Activity); Clients list/detail (contacts, locations, jobs); Location detail (map with parcel).

## API
| Method | Path |
|---|---|
| GET/POST | /clients ; GET/PATCH/DELETE /clients/:id |
| GET/POST | /clients/:id/contacts ; PATCH/DELETE /contacts/:id |
| GET/POST | /locations ; GET/PATCH /locations/:id |
| POST | /locations/resolve {address | lat,lng} -> geocode + parcel candidates (see 04) |
| GET/POST | /jobs (filters: stage, owner, q, updatedSince) ; GET/PATCH /jobs/:id |
| POST | /jobs/:id/transition {to, reason?} |
| GET/POST | /jobs/:id/notes ; /jobs/:id/tasks ; /jobs/:id/files |
| GET | /search?q= (clients, contacts, jobs, locations) |
| GET | /pipeline/summary (count + sum by stage) |

## Entities
Client, Contact, Location, Job, File, AuditLog.

## State machine — Job.stage
```
lead -> estimating        (first takeoff or estimate created; or manual)
estimating -> proposed    (proposal sent)
proposed -> won           (proposal signed; or manual with permission)
proposed -> estimating    (proposal declined/expired, revision)
any pre-won -> lost       (manual, reason required)
lost -> lead              (reopen)
won -> scheduled -> in_progress -> completed -> invoiced -> closed   (v1, driven by 09/10/11)
```
Guards: `won` requires a signed proposal or `jobs.force_won` permission (logged).

## Edge cases
- Address not geocodable (new subdivision) -> allow drop-pin on map; parcel optional.
- Same site, multiple clients over time (property manager change) -> Location belongs to client but can be re-linked; jobs keep historical client.
- Duplicate clients (same email/phone) -> warn on create; merge = Later.
- Multi-site job (HOA with 3 lots) -> Job has one primary location; additional locations = v1 (job_location join).

## Acceptance criteria
- Creating a job from an autocompleted address creates Location with point geometry and links/creates Client in one request (e2e).
- Pipeline summary sums `bid_value_cents` per stage and matches the sum of job rows (unit test on seeded data).
- Illegal transition (e.g. lead -> won without signed proposal) returns 409 with problem+json.
- Search returns a job by number, by client phone digits, and by partial street address within 300 ms on 50k jobs (perf test on seed).
- Every stage change writes an AuditLog row with actor and reason.

## Out of scope
Email/SMS inbox, lead capture forms, call tracking, follow-up automations, reviews/referrals, client merge (Later).

## Buy vs build
Build (it's the core data spine). Geocoding: buy (see 04).
