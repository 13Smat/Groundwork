# ADR 0008: Imagery ingest worker

## Status

Accepted (2026-11-26).

## Context

Spec 04 says ingest is county or AOI only, never statewide, and that a worker turns a GeoTIFF into a 4-band COG, stores the footprint in EPSG:4326, and moves `ImageryCapture` from `ingesting` to `ready` or `failed`. The capture columns `capture_date`, `gsd_cm`, and `bands` are `not null` in the spec 01 sketch, including while a row is `ingesting`. Spec 04 does not give a square-meter cap, a county boundary table, or a 4-band GeoTIFF URL. The program pages it cites are ImageServers and WMS, which this repo must not stream.

ADR 0006 leaves global imagery rows unwritable by `groundwork_app`. ADR 0007 replaces the imagery header stub with a session and an active membership. Spec 04's admin screen does not name which system role may edit a source or start an ingest.

## Decision

- `services/imagery-ingest` converts one local fixture GeoTIFF, or one configured HTTPS GeoTIFF, into a 4-band COG and uploads it to the bucket. NC ortho, Helene 2025, and NAIP share that downloader. It runs only when `GROUNDWORK_IMAGERY_LIVE_FETCH` is `1` and `GROUNDWORK_IMAGERY_TILE_URL` is a single HTTPS `.tif` whose host is not Google, Mapbox, NC OneMap, or ArcGIS, and whose path is not an ImageServer or WMS. The URL is operator configuration. The code does not embed a portal URL. CI does not set the flag. The fixture fetcher is selected by the source name `fixture_rgbir`.
- An AOI is refused when `ST_Area(geom::geography)` is above 60_000 km². A county FIPS ending in `000` is refused. Both limits are provisional stand-ins for "not statewide." There is no county polygon table, so a county job stores an empty coverage until the raster footprint replaces it.
- A new capture for a global source keeps `workspace_id` null. The ingest job row stores the operator's workspace. While status is `ingesting`, the API stores provisional date, GSD, bands, and leaf so the `not null` columns hold, and it omits those fields from the job response until `ready`.
- `app.imagery_admin=on` is set for one transaction, only after `requireImageryAdmin` sees `member.role` of `owner` or `admin`. Any other active role is 403. The app role still cannot delete a global row. Product writes stay on the app pool. pg-boss uses the database owner only to enqueue.
- The same idempotency key and the same body return the existing job. A different body with that key is 409. A failed job is not started again under the same key.
- Illegal capture transitions are rejected in `packages/shared` and by a database trigger. The API returns 409.

## Alternatives

- Keep the `x-groundwork-admin` header. Rejected. ADR 0007 already replaced header trust with a session, and this ticket said to use the member's role once that landed.
- Give every active member ingest. Rejected. The screen is internal admin. Owner and admin are the workspace administration roles.
- Add an `imagery.admin` permission token. Rejected. Spec 02's matrix has no such token, and this ticket asked for the member's role rather than a new encoding.
- Relax `not null` on the capture columns. Rejected. That would fight the spec sketch and the rows already seeded as `ready`.
- Download a county from the NC OneMap ImageServer. Rejected. Spec 04 and ADR 0006 forbid streaming those services.

## Consequences

- A county ingest does not check that the raster lies inside that county. The footprint still has to be small enough to pass the area cap. The missing boundary table is recorded in `docs/specs/OPEN-QUESTIONS.md`.
- Reusing an idempotency key after a failure does not retry. A new key starts a new capture and leaves the failed row in place.
- The Python image is pinned by the `python:3.12-slim-bookworm` index digest checked on 2026-11-26. CI installs the hashed requirements into a venv and does not run that image.

## References

- `docs/adr/0006-imagery-registry-and-tiles.md`
- `docs/adr/0007-auth-workspaces.md`
- `docs/specs/04-map-takeoff-manual.md`
- `docs/specs/OPEN-QUESTIONS.md`
