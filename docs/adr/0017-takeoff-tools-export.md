# ADR 0017: Takeoff holes, undo, parcel select, and export

## Status

Accepted (2026-11-26).

## Context

Spec 04 part 3 asks for hole cutting, vertex edit, split and merge, snap, undo and redo, the server's self-intersection corrections and same-item overlap warnings, a sum-versus-union toggle, parcels in the current view, a GeoJSON export, a PNG site map with the imagery provider, date, GSD, and attribution, and a slower path once a takeoff has more than 2,000 features.

Map Takeoff 1 already stores holes as `measurement.deductions`, runs `ST_Difference` then `ST_MakeValid`, and flags a same-item overlap above 0.01 m². The summary already returns a sum and a union. `parcel_cache` is global and has no tenant column. ADR 0009 keeps it out of model training. The `db` CI job has Postgres and does not start MinIO or the imagery venv. Google and Mapbox satellite tiles are not a measurement input.

AI Assist 2 shipped as ADR 0018 with no migration. Estimating 2 shipped as ADR 0019 with no migration. This slice does not add migration 0013, and it does not take 0014 or 0018.

## Decision

- No migration. A hole is an interior ring on the existing polygon. Save still writes `deductions` and the net geography. Split keeps the original id on the first part and inserts the second. Merge deletes the saved row that was absorbed. Neither operation clips to a parcel. A hole, a vertex edit, and undo copy the feature, so an accepted assist polygon stays `source = ai_assist`.
- Undo and redo are a snapshot stack in the editor: create, vertex edit, delete, re-tag, hole, split, and merge. Terra Draw's own undo stays off so a re-tag is not a second history. Vertex drags of one geometry inside 600 ms collapse into one step. Hidden and label edits are not steps.
- Snap is Terra Draw `updateModeOptions` on polygon, line, point, ruler, and the select mode's vertex flags. The checkbox is the only control.
- `GET /locations/:id/parcels?bbox=west,south,east,north` reads `parcel_cache` after the location read. The location read is the tenant guard. Rows must intersect the bbox and lie within 2 km of `location.point`, ordered by `provider_parcel_id`, capped at 50. The editor draws them as a MapLibre reference layer. A selected parcel is not a measurement and does not clip one. The fixture parcel adapter returns the subject lot and the east and west neighbors. The subject id is unchanged.
- `GET /takeoffs/:id/export?format=geojson` is a GeoJSON FeatureCollection plus an `imagery` object (`provider`, `name`, `capture_date`, `gsd_cm`, `attribution`). `format=png` is `image/png`. `renderSiteMap` in `apps/api` paints measurement outlines on a paper raster and stamps the provider, date, GSD, and attribution into the pixels and into PNG `tEXt` keywords `Provider`, `Name`, `CaptureDate`, `GsdCm`, and `Attribution`. It uses Node `zlib` only. It does not read a COG, call TiTiler, or call a paid static-map API. Proposals can import `renderSiteMap` for the same stamp.
- Above 2,000 features the editor paints a simplified MapLibre overlay and pauses drawing. `PUT /takeoffs/:id/measurements` already rejects a body over 2,000. `GET /takeoffs/:id/measurements/tiles/:z/:x/:y` returns GeoJSON (not MVT) for features that intersect that Web Mercator tile, at most 500, and returns 429 after 30 calls in 10 seconds for that workspace in that API process. The membership check runs before the counter.

## Alternatives

- Composite the COG into the PNG with sharp or a TiTiler static render. Rejected for this slice. The `db` job cannot read the imagery bucket, and a paid static map is out of bounds. The stamp is still in the file so a later photo composite can keep the same attribution.
- Encode the tile route as MVT. Rejected. That adds an encoder this route does not need. The editor's mass overlay is GeoJSON.
- Use Terra Draw's undo stack. Rejected. It does not record a re-tag, a hole cut, or a merge.
- Store the multi-parcel selection. Rejected. The selection is a reference for the open editor. The primary parcel stays on `location`.

## Consequences

- The PNG is a schematic site map. A proposal that must show the aerial photo still needs a compositor. That gap is in `docs/specs/OPEN-QUESTIONS.md`.
- The 2 km radius and the 50-row cap are not in spec 04. They are recorded as open questions rather than written into the spec.
- The tile limit is per process. Two API processes do not share a bucket.
- An accepted assist polygon stays `source = ai_assist` through a hole, a vertex edit, and undo. ADR 0018 inserts that source. This slice does not rewrite it.
- The next free ADR number is 0020. ADR 0018 is assist acceptance. ADR 0019 is estimate quantity sync. Migrations 0013 and 0014 are unused.

## References

- `docs/specs/04-map-takeoff-manual.md`
- `docs/adr/0013-takeoff-measurements.md`
- `docs/adr/0014-takeoff-editor.md`
- `docs/adr/0006-imagery-registry-and-tiles.md`
- `docs/adr/0009-crm-jobs.md`
