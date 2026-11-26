# ADR 0009: CRM tables, job numbers, and fixture geocoding

## Status

Accepted (2026-11-26).

## Context

Spec 03 needs clients, contacts, locations, jobs, and a stage machine. Spec 01 sketches the tables and a global `parcel_cache`. Spec 04's `POST /locations/resolve` needs a geocoder and a parcel provider. ADR 0001 says local and CI use fakes for both, with no spend and no hosted keys.

ADR 0007 made `workspace.id` and `member.id` text. The spec 01 sketch declares `workspace_id uuid references workspace` and `owner_member_id uuid references member`. Those foreign keys do not type-check. Imagery tables have no `location_id` column, so there is nothing for a location foreign key to attach to. `GET /imagery/captures?locationId=` returned 501 until a lookup existed.

Spec 02 does not name `jobs.force_won`. ADR 0007 does not expand wildcards, so `jobs.*` does not include it. Spec 03 requires that token, or a signed proposal, before `proposed -> won`. There is no proposal table yet.

The job-number start (`J-1001` in the spec examples) was still an open question. This ticket states the first job number is `J-1001`.

## Decision

- Migration `0005_crm_jobs.sql` adds `client`, `contact`, `location`, `job`, `job_note`, `job_task`, and `job_file` with forced row security and the foundations `NULLIF` expression. Grants are to `groundwork_app` only. `workspace_id`, `owner_member_id`, and `created_by` are uuid with no foreign key to the text auth keys. Entity foreign keys (`client_id`, `location_id`, `job_id`, `file_id`, `parcel_cache_id`) stay inside this migration.
- `parcel_cache` is global. It has no `workspace_id` and no row security, same as `event_log`. A parcel fetched in one workspace is reused by another. These rows are not ML training input.
- The first `counters` row for prefix `J` stores `1001`. Later allocations increment. `E`, `P`, and `INV` are unchanged.
- `jobs.force_won` is appended to the owner and admin system roles. Estimator and office keep `jobs.*` and cannot skip the signed-proposal guard.
- `GeocoderProvider` and `ParcelProvider` are the boundaries. Local and CI use deterministic fixture adapters. They do not call the network. Parcel results are cached in `parcel_cache` on `(provider, provider_parcel_id)`.
- `GET /imagery/captures?locationId=` reads `location.point` and builds a small bbox. A missing location, or a location with no point, is 404. There is no imagery `location_id` column and no foreign key.
- Job stage changes go through `packages/shared/src/state/job.ts`. The API maps every refusal to 409 problem+json and writes `audit_log` with the member id, the from/to pair, the reason, and whether won was forced. `hasSignedProposal` is false until proposals exist.
- `crm.read.assigned` and `jobs.read.assigned` see jobs whose `owner_member_id` is the caller, plus clients, contacts, and locations tied to those jobs. Search uses that filter when either token is the caller's only CRM or jobs read.

## Alternatives

- `workspace_id text` with a foreign key to `workspace`. Rejected. Counters, file, audit, and imagery already use uuid, and the RLS expression casts the setting to uuid.
- Call a hosted geocoder when a key is present. Rejected. ADR 0001 forbids spend and hosted keys in local and CI. A later ticket can add another adapter behind the same interface.
- Treat `jobs.*` as including `jobs.force_won`. Rejected. ADR 0007 says wildcards are not expanded.
- Add `location_id` to `imagery_capture`. Rejected. Captures are coverage polygons, not a site. The query parameter only needs the location point.
- Enable row security on `parcel_cache` with a permissive policy. Rejected. The table is not tenant data. A policy of `true` would document a hole. No grant other than `groundwork_app` is the control, same as `event_log`.

## Consequences

- A job can be marked won in this slice only with `jobs.force_won`. The state machine still accepts a signed proposal so spec 08 can pass `hasSignedProposal: true` without a new graph.
- v1 stages (`scheduled` through `closed`) are in the check constraint and are not reachable. Transitions into them return 409.
- Client email and phone, the note/task/file shapes, the assigned-read rule, and the 200 response for an ungeocodable address are recorded in `docs/specs/OPEN-QUESTIONS.md`. The spec files were not edited.
- List routes return at most 200 rows (`/jobs` defaults to 50 and caps at 200). Paging is not in the spec.

## References

- `docs/specs/03-crm-jobs.md`
- `docs/specs/01-data-model.md`
- `docs/specs/04-map-takeoff-manual.md`
- `docs/adr/0001-stack.md`
- `docs/adr/0006-imagery-registry-and-tiles.md`
- `docs/adr/0007-auth-workspaces.md`
- `docs/specs/OPEN-QUESTIONS.md`
