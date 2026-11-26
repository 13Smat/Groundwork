# AGENTS.md

Groundwork is a clean-room field-service platform for paving and landscaping contractors. These are Andy's standing rules for every coding agent. Read this file before planning or editing. The product behavior is specified in `docs/specs/`. Decisions live in `docs/adr/`. Current state is `STATUS.md`.

## Process

- One ticket, one agent, one branch, one PR. Branch names start with `cursor/`. Open a draft PR early, stay until CI is green, and never merge. Andy merges.
- Small commits with meaningful messages. Never force-push `main`.
- No review-only passes. Tests, lint, typecheck, and build are the gate. Reading the diff is not finishing the ticket. There is no `package.json` or CI until Ticket 1; do not invent a green check.
- Every bug fix gets a regression test.
- Test behavior, not implementation.
- Read existing code first and match conventions. Do not rewrite what works.
- Explain the why in the PR: how to run and test it, what is risky, and what is out of scope. Use `.github/PULL_REQUEST_TEMPLATE.md`.
- Never invent APIs, versions, or "it works like..." claims. Verify against docs or by running code.
- Prefer boring, proven tools. Keep functions small with readable names, fail loudly in dev and safely in prod, and keep typed boundaries (zod at the edges).

## Security

- The repo is public. No secrets, tokens, or credentials in git. `.env.example` holds empty placeholders only. Real values stay in an untracked `.env`.
- Least privilege. Validate inputs. Keep dependency hygiene: pin on purpose, review new dependencies, and do not add one you cannot name a reason for.

## Accessibility

Target WCAG AA. Semantic HTML, keyboard access, visible focus, and large targets for field use (crew app and any screen used with gloves or a phone outdoors). Use Radix primitives rather than hand-rolled widgets.

## Clean-room

Groundwork is modeled on the behavior of a competitor only. Do not copy competitor code, brand, copy, names, screenshots, or assets. The files in `docs/specs/` describe behavior. They are not a license to import anything else.

## Domain rules

Copied from "Rules for the builder" in `docs/specs/README.md`:

- Every table has `workspace_id`; enforce with Postgres RLS + an API-level guard. No cross-tenant query without an explicit admin path.
- Geometry in EPSG:4326; compute area/length with geography casts (`ST_Area(geom::geography)`) or Turf geodesic functions; display in ft²/ft/yd²/acres. Store canonical metric values, convert at the edge.
- Money as integer cents + currency; quantities as `numeric(14,4)`.
- All state transitions go through the state machines in `packages/shared/state/*`; illegal transitions return 409.
- Every async external call (CV, e-sign, Stripe, QBO) is idempotent with a stored idempotency key and a webhook/event log table.
- Never use Google Maps Platform or Mapbox satellite imagery as a measurement or AI input (see 04). API refuses any ImagerySource with `allows_tracing=false`. Never feed parcel vendor data to model training (see 05). Training/eval only on sources with `allows_ml_training=true`.
- MVP imagery default: ingest NC Orthoimagery Program 4-band tiles (and the Helene 2025 leaf-off set where it covers) plus NAIP as fallback; convert to COG; serve from our storage via TiTiler. Do not stream NC OneMap / state ImageServers or the 2024–2027 WMS in production. Do not use Orthoimagery_Latest (3-band JPEG, "for viewing, not raster analysis") as measurement or AI input. Paid providers and customer drone uploads are v1.

Spec 04 also requires `verified_at` to be set before a capture is served. The API and TiTiler return 403 when `allows_tracing` is false or `verified_at` is unset. Do not weaken that.

## Decided, and not to be re-litigated

- Auth is Better Auth with the organizations plugin. ADR 0002. The mapping onto the `app_user` / `member` / `role` tables is still an open question. Do not guess it.
- E-sign is the Dropbox Sign API behind a `SignatureProvider` interface, with a fake for local and CI. ADR 0003.
- Neon, Cloudflare R2, Fly or Render, and Modal are planned hosts only. Do not sign up, spend, or commit real keys. Which of Fly or Render is not chosen.
- Local development and CI use Docker Postgres with PostGIS and MinIO, plus fakes for Dropbox Sign, Stripe, the CV service, the geocoder, and the parcel provider. ADR 0001.

## Status and handoff

- Update `STATUS.md` and `CHANGELOG.md` in each PR.
- Write an ADR in `docs/adr/` for any decision. Start from `docs/adr/0000-template.md`.
- Leave a handoff note from `docs/handoff-template.md` when stopping mid-ticket. Remove it when the ticket is done.
- Spec questions get flagged in the PR and in `docs/specs/OPEN-QUESTIONS.md`. They do not get guessed.
