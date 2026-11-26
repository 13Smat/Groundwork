# ADR 0018: Accepting an AI assist draft

## Status

Accepted (2026-11-26)

## Context

Spec 05 part 2 turns a succeeded `detection_feature` into a `measurement` and moves `detection_run` to `accepted_partial` or `accepted_all`. Migration `0012_detection.sql` already stores those statuses, `detection_feature.accepted_measurement_id`, and `measurement.source` already includes `ai_assist` (`0009_takeoff.sql`). The `DetectionRun` machine in `packages/shared` already allows `succeeded -> accepted_partial | accepted_all` and treats both as terminal.

The editor from ADR 0014 owns the map. A parallel slice adds holes, undo, and snapping in that same editor and takes migration `0013` and ADR 0017. Estimating part 2 takes migration `0015` and ADR 0019. This slice must not take those numbers.

Spec 05 has no rejected status. It also does not say what happens when the reviewer keeps none of the drafts. Class-to-item mapping is spec 05 part b. This slice already stored `detection_feature.takeoff_item_id` from the assist request (ADR 0016).

## Decision

No new migration. `0014` is unused so the parallel slices keep `0013` and `0015`.

`GET /detections/:id` returns the run status, each draft's GeoJSON, area, takeoff item, and `accepted_measurement_id`, and the unaccepted drafts that overlap a measurement by more than 0.01 m².

`POST /detections/:id/accept` takes `{ all: true }` or `{ feature_ids }`, not both. It inserts a new area measurement for each named draft (`source = ai_assist`, `confidence` from the draft score, empty deductions) and stores the geography area and perimeter. It does not update any other measurement. Unlisted drafts stay, with `accepted_measurement_id` null. Every draft accepted moves the run to `accepted_all`. Any leftover draft moves it to `accepted_partial`. A second review returns 409.

`POST /detections/:id/reject` takes `{ all: true }` only. It writes no measurements and closes the run as `accepted_partial`, including a run with zero drafts. Spec 05 has no rejected status, so a review that keeps nothing still leaves the run terminal.

Both routes use the same gates as `POST /takeoffs/:id/assist`: `GROUNDWORK_AI_ASSIST=1` and `workspace.features.ai_assist`. The editor hides the Assist controls unless the workspace flag is true. The API still requires the env flag. A mutation writes one `audit_log` row (`entity_type = detection_run`, action `accept` or `reject`).

Draft polygons are a MapLibre layer in new files (`assist-layer.ts`, `use-assist.ts`, `assist-panel.tsx`). They are not Terra Draw features, so Save does not persist them. Accept loads the new measurement through the existing draw API. Refine sends a new assist request with a new idempotency key and then rejects the previous run.

The Playwright job starts the mock CV service (`CV_BACKEND=mock`) and the e2e API uploads the fixture COG and warms the imagery venv. No Modal, GPU, or model download.

## Alternatives

- A `rejected` status. Rejected because spec 05 and the `0012` check do not have one, and a new status would be a migration this slice does not need.
- Deleting rejected `detection_feature` rows. Rejected because the audit row and the terminal status are enough, and the row still shows what the model returned.
- Putting the draft on the Terra Draw store. Rejected because a later Save would persist a polygon the reviewer had not accepted.
- Migration `0014` for an accept table. Rejected because `0012` already has the columns.

## Consequences

Hole cut and undo/redo on an accepted polygon wait for the map follow-up (ADR 0017). This slice checks vertex edit and the server summary. Overlap stays a warning. Accept does not subtract the manual polygon.

The class-to-item mapping and a progress field on the detection response stay open. See `docs/specs/OPEN-QUESTIONS.md`.

## References

- `docs/specs/05-ai-takeoff-assist.md`
- ADR 0013, ADR 0014, ADR 0016
