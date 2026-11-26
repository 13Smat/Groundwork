# ADR 0013: Takeoff measurements and geodesic quantities

## Status

Accepted (2026-11-26).

## Context

Spec 04 part 1 needs a takeoff, its measurements, and server-side geodesic quantities. `takeoff_item` already shipped in `0006` with no foreign key to `job` or `location`. `packages/geo` already holds exact unit ratios. Spec 01 sketches `takeoff` and `measurement`, including `sheet_geom` for plan sets, and leaves version linkage, deductions storage, and the overlap flag unspecified. Spec 04 says `final -> draft` keeps the old version read-only and that the server value wins over Turf.

Migrations `0007` and `0008` belong to the parallel catalog UI and CRM UI slices. This slice uses `0009` only.

## Decision

- Migration `0009_takeoff.sql` creates `takeoff` and `measurement`. Both force row level security with `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Grants are to `groundwork_app` only. `takeoff_item` is referenced and is not recreated.
- `takeoff.lineage_id` groups versions. `supersedes_id` points at the previous row. `final -> draft` inserts version n+1 and copies measurements onto new ids. The old row stays `final`. A partial unique index allows one `draft` or `in_review` row per lineage. `takeoff_before_update` rejects any update of a final row and any status change other than `draft -> in_review` or `in_review -> final`.
- An aerial takeoff requires `imagery_capture_id` and `location_id`. A planset takeoff may omit both. `sheet_geom` and `planset_sheet` wait for spec 12. Every measurement in this slice stores `geom geometry(Geometry, 4326)`.
- `measurement.takeoff_item_id` is not null. `deductions` is a jsonb array. On save the server cuts client deduction polygons out with `ST_Difference`, runs `ST_MakeValid`, and stores the interior rings as the deductions.
- Quantities are `ST_Area(ST_MakeValid(geom)::geography)::numeric(14,4)` and `ST_Length(geom::geography)::numeric(14,4)`. An area stores its perimeter in `value_m`. The summary sums `value_m2` for area items and `value_m` for length items, and reports the geography union beside the sum. Same-item area overlaps whose intersection is above 0.01 m² are flagged. Edge touches are not overlaps.
- `PUT /takeoffs/:id/measurements` upserts by client id. Omitted features stay. The body holds at most 2,000 features. The statement turns JIT off: `ST_Dump`'s row estimate otherwise spends longer compiling than the write takes.
- Display rounding uses `decimal.js` and the existing integer ratios. ft² rounds to 1, yd² to 0.1, ft to 1, acres to 0.001. Stored values stay unrounded. Turf in `packages/geo` is the live-feedback helper. PostGIS geography is the stored value.
- Changing `imagery_capture_id` when measurements exist requires `confirm: true` and returns a warning. A source with `allows_tracing = false` or `verified_at` null is 403. A capture that is not `ready` is 409.
- JSON is snake_case. Write routes require `takeoff.*`. Read routes accept `takeoff.*` or `takeoff.read`. Wildcards are not expanded, so office can read and crew cannot. Create, status changes, capture changes, and clones write `audit_log`.
- The measurement trigger skips `rolsuper` so the database owner can clean fixtures. `groundwork_app` is not a superuser. The takeoff status trigger applies to every role.

## Alternatives

- Recreate `takeoff_item` in `0009`. Rejected. `0006` has shipped, and this slice references it.
- Update the final row in place and bump `version`. Rejected. Estimates will point at a version, and the spec keeps the old row read-only.
- Store client deductions as sent and trust Turf area. Rejected. The spec says the server geography value wins, and a hole has to be in the geometry `ST_Area` measures.
- Treat every `ST_Intersection` with area 0 as an overlap. Rejected. Shared edges would flag adjacent pads. 0.01 m² is the provisional cut.
- Leave JIT on. Rejected. A 500-feature save compiled for about three seconds and ran in a fraction of that. The acceptance test is under two seconds.

## Consequences

- Spec 12 has to add `sheet_geom` and `planset_sheet`. Until then a planset measurement is still a geographic geometry.
- Spec 07 should point an estimate at `takeoff.id` for the version it priced. Cloning does not rewrite estimates. There is no estimate table in this slice.
- Acre display, the confirm field name, a required takeoff item, the 0.01 m² overlap cut, and one open version per lineage are recorded in `docs/specs/OPEN-QUESTIONS.md`.
- The map editor, PNG export, and AI assist are later slices. This slice is the API and the PostGIS tests.

## References

- `docs/specs/04-map-takeoff-manual.md`
- `docs/specs/01-data-model.md`
- `docs/adr/0007-auth-workspaces.md`
- `docs/adr/0010-catalog-recipes.md`
- `docs/specs/OPEN-QUESTIONS.md`
