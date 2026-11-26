# ADR 0016: AI takeoff assist, the CV contract, and the mock adapter

## Status

Accepted (2026-11-26).

## Context

Spec 05 part 1 needs a detection run, draft polygons, a chip cropped from a capture we already stored, and a call to a segmentation service. Spec 01 sketches `detection_run` and `detection_feature` and already has `usage_event`. The imagery license gate from ADR 0006 and ADR 0008 is `allows_tracing` plus `verified_at`. `requireMeasurableCapture` already enforces it on takeoff create. `parcel_cache` is global vendor data and must not be sent to a model. Local and CI must not download a model, start a GPU, or open a Modal account.

Migrations `0010` and `0011` and ADRs `0014` and `0015` belong to parallel slices. This slice uses migration `0012` and ADR `0016` only.

## Decision

- Migration `0012_detection.sql` creates `detection_run` and `detection_feature`. Both force row level security with `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Grants are to `groundwork_app` only. The status trigger is `SECURITY INVOKER`. It is not `SECURITY DEFINER` and it does not bypass row security.
- `DetectionRun` lives in `packages/shared`. `queued -> running -> succeeded | failed | cancelled`. `succeeded -> accepted_partial | accepted_all`. Any other change, including a retry of `failed`, is illegal. The API records one `running` row and retries a network or 5xx response twice inside that row, still inside the 10 second deadline. A 4xx is a model rejection and is not retried.
- `usage_event` from `0001` is the usage log. Assist inserts `kind = cv_infer`, `units` equal to `gpu_seconds`, and `cost_estimate_cents = 0` for the mock. There is no second usage table.
- The run stores `idempotency_key` and `request_hash`. The header is `Idempotency-Key`. A missing header gets a new id. The same key and the same body replay a succeeded run. A different body, a failed run, or a run that is still going returns 409. The unique key is `(workspace_id, idempotency_key)`.
- `detection_feature.takeoff_item_id` remembers the area item from the request. The spec 01 sketch does not have that column. Accepting a draft into a measurement is a later slice, so nothing here writes `measurement.source`.
- `POST /takeoffs/:id/assist` requires `GROUNDWORK_AI_ASSIST=1` and `workspace.features.ai_assist = true`. Write permission is `takeoff.*`. The route tag is `tenant-header`. A planset takeoff and a final takeoff are 409.
- The license check is `requireMeasurableCapture`. A capture whose source has `allows_tracing = false` or `verified_at` null is 403, including the seeded Google and Mapbox rows. A capture with no COG is 409.
- The chip is the location's `site_geom` expanded by 10 m. The chosen capture must `ST_Covers` that envelope. Other program footprints that also overlap the site do not make the request a seam. A missing site boundary is 409. `parcel_cache` is not read. `assertCvInputsExcludeParcelCache` rejects a table list that includes it. `assertTrainingSource` is a separate helper: training also requires `allows_ml_training`. Assist does not call it, because the fixture capture allows tracing and does not allow training.
- The API downloads the COG from MinIO with the existing S3 client, writes a temp file, and runs `groundwork_cv.crop` from the imagery venv. The child receives a local path, not an imagery URL. The longest side is at most 4096 px. Objects over 512 MiB are refused. Windowed range reads and tiled windows are later work.
- The mock returns a 32 px square around the first positive point, or the requested box, and always appends a 0.8 px sliver. Rings are simplified in pixel space with tolerance `0.5 * capture GSD / ground pixel size`, transformed with the chip affine, warped to EPSG:4326, clipped to the site, and dropped when `ST_Area(geom::geography)` is under 2 m².
- `services/cv` is FastAPI. `POST /segment/prompt` and `POST /segment/classes` are the contract. `CV_BACKEND=mock` is the default. `CV_BACKEND=sam2` constructs an adapter whose initializer raises before importing torch. CI runs the contract tests and the mock. It does not download weights.
- Python dependencies for the service are the hashed pins in `services/cv/requirements.txt`, produced by `pip-compile` on 2026-11-26: fastapi 0.165.0, uvicorn 0.54.0, httpx 0.28.1, pytest 9.2.0, and the versions those pull in. The crop path uses the existing imagery venv's rasterio and is not a dependency of the mock service.

## Alternatives

- A new `cv_usage` table. Rejected. `usage_event.kind` already includes `cv_infer`.
- Treat every overlapping seed footprint as a multi-date seam. Rejected. Helene's seeded rectangle covers the fixture tile, so a Burke County site would always be 409.
- Stream the COG to the crop through `/vsis3` on the request path. Rejected for this slice. The API already downloads objects with the path-style client. The child reads the file it was given.
- Import torch when `CV_BACKEND=sam2` so the import error is the failure. Rejected. A missing extra would look like a broken environment. The adapter fails closed with a message that no model was downloaded.
- Hold one database transaction across the crop and the HTTP call. Rejected. The 10 second deadline would pin a connection, and a crash would leave the transaction open. The run is committed as `running` first.

## Consequences

- Accepting a draft (`accepted_partial`, `accepted_all`, and `measurement.source = ai_assist`) is still spec 05 part 2. This slice stores drafts only.
- SAM 2, Modal, and a GPU stay out of CI. Setting `CV_BACKEND=sam2` does not download anything.
- A full-object download is the chip path until a range read exists. A capture larger than 512 MiB cannot be assisted.
- The seam rule, the `takeoff_item_id` column, the idempotency columns, the accept statuses, the 4096 px resample, and the env flag name are recorded in `docs/specs/OPEN-QUESTIONS.md`. The spec files were not edited.

## References

- `docs/specs/05-ai-takeoff-assist.md`
- `docs/specs/01-data-model.md`
- `docs/adr/0006-imagery-registry-and-tiles.md`
- `docs/adr/0008-imagery-ingest.md`
- `docs/adr/0013-takeoff-measurements.md`
- `docs/specs/OPEN-QUESTIONS.md`
