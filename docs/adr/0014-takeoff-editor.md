# ADR 0014: Takeoff editor

## Status

Accepted (2026-11-26).

## Context

Spec 04 part 2 draws measurements on license-cleared imagery. Map Takeoff 1 already stores takeoffs and measurements and recomputes geography on save. Catalog 2 already owns `/catalog/takeoff` and the office navigation. The job page already has a Takeoffs link, and the location page already draws a MapLibre context map from the fixture capture only.

Spec 04 does not name a list of takeoffs for a job. The capture list, the age and seamline warnings, and the confirm rule already come from the API. Tile requests go through `/imagery/tiles/:captureId/{z}/{x}/{y}`. A capture with `allows_tracing = false` or a null `verified_at` is not in that list and is 403 from the tile route. Helene and the older NC orthos have no COG in this environment, so those tiles 404. The e2e job does not run TiTiler, so a fixture tile can 502.

Estimating 1 has migration `0011` and ADR 0015. AI Assist 1 has migration `0012` and ADR 0016. This slice does not need a table change.

## Decision

- The editor is a lazy route at `/jobs/$jobId/takeoffs/$takeoffId`. MapLibre, Terra Draw, and the map stylesheet stay out of the office bundle. `/catalog/takeoff` stays the takeoff-item screen. `/takeoff` stays the office placeholder.
- The job page gains a Takeoffs tab and points its Takeoffs link at `/jobs/$jobId/takeoffs`. That page creates an aerial takeoff with `POST /jobs/:id/takeoffs` on the first allowed capture. Ids created in this browser are remembered in `sessionStorage`. There is no new list route.
- Terra Draw modes are select, polygon, linestring, point, and a second linestring named `ruler`. The ruler is not included in `PUT /takeoffs/:id/measurements`. Leaving the ruler removes those features. New ids use the shared UUIDv7 `idStrategy`, because the API rejects a v4 id.
- The parcel and the site pin are MapLibre GeoJSON layers. They are not Terra Draw features, so they cannot be saved and they do not clip a measurement.
- Switching the capture calls `RasterTileSource.setTiles`. The map is not rebuilt, so drawings stay. When the takeoff already has measurements, or the editor has unsaved ones, the office asks before `PATCH` with `confirm: true`.
- Live area and length use Turf from `packages/geo`. After a successful save, the left panel shows the summary from `GET /takeoffs/:id/summary` once every feature of that item still matches the geometry the server measured. `DELETE /measurements/:id` removes a saved row. A PUT sends the current set because an omitted feature stays.
- The imagery picker uses `GET /imagery/captures?locationId=` and drops `google_satellite`, `mapbox_satellite`, and `nc_ortho_latest_viewing` again on the client. The tile template is a relative `/imagery/tiles/...` path. Attribution and warnings render in the page, not in the map control, so a failed tile cannot hide them. The quantity summary uses the existing dialog with `placement="end"`.
- An empty capture list disables New takeoff and shows the block. A final takeoff does not draw.

## Alternatives

- Add `GET /jobs/:id/takeoffs`. Rejected. Spec 04 does not name it, and a session list is enough to reopen a takeoff created in this browser. The gap is in `docs/specs/OPEN-QUESTIONS.md`.
- Put the parcel in the Terra Draw store as a locked feature. Rejected. A locked feature can still be selected and would have to be filtered out of every save.
- Rebuild the map style when the capture changes. Rejected. `setStyle` drops the parcel and the drawing.
- Wait for tile pixels before enabling draw. Rejected. Helene has no COG here, and e2e has no TiTiler. The drawing is geographic and the server measures it.
- Stream NC OneMap, Google, or Mapbox. Rejected. ADR 0006 and spec 04 forbid those as measurement imagery.

## Consequences

- A takeoff created in another browser is not listed. The editor URL still opens it.
- Tiles for Helene and the seeded NC orthos 404 until those COGs exist. The paper background shows through. Drawing and save still work.
- Holes, snap, undo/redo, PNG export, and multi-parcel select stay in part 3. The ruler is the only measure-only tool in this slice.
- ADR 0015 and ADR 0016 stay reserved. The next free number is 0017.

## References

- `docs/specs/04-map-takeoff-manual.md`
- `docs/adr/0006-imagery-registry-and-tiles.md`
- `docs/adr/0013-takeoff-measurements.md`
- `docs/specs/OPEN-QUESTIONS.md`
