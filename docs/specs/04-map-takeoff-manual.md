# 04 — Map takeoff (manual) and imagery ingest

Phase: MVP editor 4 person-weeks + imagery ingest 2.5 person-weeks (estimate). v1: drone upload + paid-provider adapter 1.5 person-weeks (estimate). Depends on: 03 (job/location), foundations/storage, 06 (takeoff items; can stub). Ingest can start in parallel with 03.

## Goal
From a job's address, show the parcel on license-cleared aerial imagery and let the estimator draw areas, lengths and counts, tagged to takeoff items, with live quantities.

## MVP imagery plan (approved 2026-11-25)
Default measurement imagery is **self-hosted public state/county ortho**, not a paid provider.

| Priority | Source | Role |
|---|---|---|
| 1 | NC Orthoimagery Program, ingested 4-band tiles (and the Helene 2025 leaf-off set where it covers) | Default in North Carolina |
| 2 | NAIP (USDA), ingested | Fallback when no NC capture covers the site, and everywhere outside ingested NC counties |
| v1 | Customer drone GeoTIFF / orthomosaic | Fresh, site-specific, customer-owned |
| v1 | Paid provider adapter (Nearmap or Vexcel) | Fresher / sharper (5–7 cm) when a customer needs it |
| Never | Google Maps Platform satellite / Map Tiles API; Mapbox Satellite (without a Commercial Satellite license); NC Orthoimagery_Latest 3-band JPEG ImageServer; streaming NC OneMap WMS/ImageServers in production | See licensing table |

Ingest by county or AOI (launch market first: western NC, including the 13 Helene counties). Do not pull the entire state on day one.

**Limits to show in the UI:** 6-inch (15 cm) GSD is fine for lawn, beds and parking-lot areas; it is weak for striping, cracks and small objects. A given NC site may be up to about 4 years old (the program flies ~1/4 of the state each year). Show capture date, GSD and required attribution on the editor and on the proposal PDF. If the capture is older than 12 months, show an age warning (new construction may be missing). Stronger warning as age approaches 4 years. Helene 2025: note that seamline smears are possible off major roads.

**Outside NC:** every state and county has its own product and license. Adding a launch market is a research + ingest task: find the ortho program, record license text/URL, set `allows_tracing` / `allows_ml_training` only after review, set `verified_at`, ingest to COG. NAIP covers the US as a coarse fallback in the meantime.

## NC and NAIP facts (checked 2026-11-25)
| Product | Facts | License / use | Link |
|---|---|---|---|
| NC Orthoimagery Program | 6-inch (15 cm), 4-year cycle, ~1/4 of the state per year, free public. Tiles 5,000×5,000 ft; county MrSID mosaics (50:1); streaming services; 4th band (NIR) since 2020 | Freely available per the program page. Record the exact tile/mosaic license on the ImagerySource and set `verified_at` before serving. | https://www.nconemap.gov/pages/imagery |
| Orthoimagery_Latest ImageServer | 3-band JPEG, RMSE 1.0 ft, marked "for viewing, not raster analysis" | Do not use for measurement, chips or ML. Use the 4-band tiles for analysis. | https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest/ImageServer |
| 2024–2027 WMS | Item shows "Custom License" | Must review before use. Do not stream this (or any state service) in production. | https://data-nconemap.opendata.arcgis.com/maps/66707ed653ea41c6bcb487b810618373 |
| Helene 2025 set | 13 western NC counties incl. Burke and McDowell; 6 in; 4-band RGBIR; spring 2025 leaf-off; copyright NC Collaboratory at UNC Chapel Hill; seamline smears possible off major roads | licenseInfo "None" (attribution appreciated). Record attribution; set `allows_tracing=true` and `allows_ml_training=true` only after `verified_at` is set. | https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Helene_2025/ImageServer/info/iteminfo |
| NAIP (USDA) | 60 cm standard, 30 cm in some states; ~2–3 year cycle; leaf-on | Public domain; tracing and ML training allowed | https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip |

## Imagery and licensing rules (hard requirement)
| Source | Measure? | Train? | Notes (checked 2026-11-25) |
|---|---|---|---|
| NC 4-band tiles / Helene 2025 (ingested) | Yes, after ImagerySource is verified | Yes, after `allows_ml_training` is set on that source | Self-host COGs. Never stream the state. |
| Other state/county orthos | Only if that source's `allows_tracing=true` | Only if `allows_ml_training=true` | Per-market license lookup is required. |
| NAIP | Yes | Yes (public domain) | Coarser, leaf-on. |
| Customer drone (v1) | Yes (customer-owned) | Only with customer opt-in in our ToS | CRS + georef validation. |
| Nearmap / Vexcel (v1) | Yes, under contract | Unknown — must be in the contract | Price not public. |
| Google Maps Platform satellite / Map Tiles API | NO | NO | ToS 3.2.3(c): no tracing/digitizing from the satellite base map; no using content to train/test/fine-tune ML. https://cloud.google.com/maps-platform/terms . OK only as a non-measurement context basemap with attribution, if at all. |
| Mapbox Satellite | NO without a Commercial Satellite license | Same license question | https://docs.mapbox.com/data/tilesets/guides/imagery/ |
| NC Orthoimagery_Latest (3-band JPEG service) | NO | NO | "For viewing, not raster analysis." |

The ImagerySource registry holds license flags. The API and TiTiler refuse tiles, chips, takeoffs and AI runs against a source with `allows_tracing=false` or `verified_at` unset. Every Takeoff records the ImageryCapture used. The proposal PDF prints provider, capture date, GSD and attribution.

## Ingest pipeline (MVP, 2.5 person-weeks estimate)
1. Operator (or job) selects a county/AOI and a program year (NC cycle, Helene 2025, or NAIP year).
2. Downloader pulls **4-band GeoTIFF tiles** (5,000×5,000 ft for NC). Prefer tiles over county MrSID mosaics; MrSID may need a proprietary GDAL plugin.
3. `rio-cogeo` converts to Cloud-Optimized GeoTIFF (Web Mercator or native CRS + TiTiler reprojection), stored in R2/S3. Keep NIR as a fourth band on the COG even if the map shows RGB.
4. Register an ImageryCapture (coverage, capture_date, gsd_cm, bands, leaf, cog_key, status=ready). Coverage comes from tile footprints or a county boundary clip.
5. TiTiler serves XYZ tiles from that COG. The API issues short-lived signed tile URLs. No traffic to state servers at request time.
6. Re-ingest when a new flight year is published (quarterly check is enough).

Local/dev: ship a small fixture COG, not a county.

## User stories
- As an estimator, I open a job and the map centers on the site with the parcel boundary highlighted, on the newest allowed capture (Helene 2025 in Burke/McDowell, else latest NC cycle, else NAIP).
- I see the capture date, GSD (e.g. 6 in) and attribution; I get an age warning when the imagery is more than 12 months old.
- I pick another allowed capture for the same site (older NC year, or NAIP) from a picker that only lists `allows_tracing=true` sources.
- I select a takeoff item ("Asphalt — mill & overlay 2in") and draw polygons; I see area in ft² and yd² live.
- I cut holes (islands, planters) out of a polygon; area updates.
- I draw polylines for curb/edging/striping and see linear ft; I drop points for counts (trees, catch basins, stalls).
- I split, merge, edit vertices, snap to existing vertices/edges, undo/redo.
- I see a quantity summary by takeoff item, and click an item to highlight its features.
- I multi-select parcels when a site spans several.
- I export the takeoff as an image-with-overlays and GeoJSON.
- v1: I upload a drone orthomosaic and measure on it once it is validated.
- v1: if the workspace has a paid imagery integration, those captures appear in the same picker.

## Screens
Takeoff editor: left panel (takeoff items with color, totals, visibility toggles), map (MapLibre + terra-draw), top bar (imagery picker showing source name, capture date, GSD, leaf-on/off; attribution; age warning; tools: select, polygon, hole, line, point, measure-only ruler, snap toggle, undo/redo), right panel (selected feature properties: item, label, area/length, source). Quantity summary drawer. Parcel select mode. Admin: Imagery sources list (license flags, verified_at, coverage) and ingest job status (v0/internal).

## API
| Method | Path | Notes |
|---|---|---|
| POST | /locations/resolve | {address} -> {point, parcels:[{id, geom, attrs}]} (geocoder + parcel provider, cached) |
| GET | /locations/:id/parcels?bbox= | parcel polygons around the site |
| GET | /imagery/captures?locationId= or ?bbox= | captures whose coverage intersects and whose source `allows_tracing` and is verified; includes date, GSD, attribution, ageDays, warnings[] |
| GET | /imagery/tiles/:captureId/{z}/{x}/{y} | signed/auth'd TiTiler in front of our COG; 403 if tracing not allowed; logs UsageEvent |
| POST | /imagery/ingest | internal/admin: {sourceId, aoi or countyFips, year} -> job id (MVP) |
| GET | /imagery/ingest/:jobId | ingest status |
| POST | /imagery/uploads | v1: register GeoTIFF/COG (presigned upload) -> validation worker -> ImageryCapture on a drone ImagerySource |
| POST | /jobs/:id/takeoffs | {kind:'aerial', locationId, imageryCaptureId} — 409/403 if capture not allowed |
| GET/PATCH | /takeoffs/:id | status, imagery capture (changing capture on a takeoff with measurements requires confirm) |
| GET | /takeoffs/:id/measurements | GeoJSON FeatureCollection |
| PUT | /takeoffs/:id/measurements | bulk upsert (client sends features with client ids); server recomputes values and returns canonical |
| DELETE | /measurements/:id | |
| GET | /takeoffs/:id/summary | quantities per takeoff item (area m², ft², yd²; length m, ft; count) |
| GET | /takeoffs/:id/export?format=geojson|png | |

## Entities
Location, ParcelCache, ImagerySource, ImageryCapture, Takeoff, Measurement, TakeoffItem, UsageEvent.

## State machine — Takeoff.status
`draft -> in_review -> final`; `final -> draft` creates `version+1` (old version kept read-only, estimates keep pointing at their version).

ImageryCapture: `ingesting -> ready | failed`. Measuring only on `ready`.

## Calculations
- Server authoritative: `value_m2 = ST_Area(ST_MakeValid(geom)::geography)`; `value_m = ST_Length(geom::geography)`. Client shows Turf geodesic values for live feedback; server values win on save.
- Overlaps between features of the same item are allowed but flagged; summary offers "union per item" vs "sum".
- Display rounding: ft² to 1, yd² to 0.1, ft to 1; stored unrounded.

## Edge cases
- Self-intersecting polygon -> ST_MakeValid, warn the user, show the corrected shape.
- Parcel missing or wrong -> draw site boundary manually.
- Imagery misaligned with parcel lines (common with county parcels) -> parcels are reference only; never clip measurements to parcels automatically.
- Tree canopy hiding pavement edges -> prefer leaf-off (Helene 2025 or a leaf-off NC year) in the picker; note on proposal.
- Very large sites (100+ acres) -> vector tiles for measurements beyond 2,000 features; tile requests throttled.
- No NC capture for the site (outside ingested counties, or outside NC) -> NAIP with a "lower resolution (60 cm, leaf-on)" banner; if NAIP is also missing, block measuring with a clear error (do not silently fall back to Google).
- Ingest gap: site in NC but that county not yet ingested -> queue ingest or show NAIP + "higher-res NC imagery not loaded for this county."
- Changing imagery mid-takeoff -> confirm; keep measurements (they are in geographic coords) but warn that they were drawn on a different date/GSD.
- Helene capture selected -> advisory about possible seamline smears off major roads.
- State portal outage during ingest -> job fails, already-served COGs are unaffected (we do not depend on the portal at request time).

## Acceptance criteria
- Drawing a 100 ft x 100 ft square (by coordinates in a test) yields 10,000 ft² ± 0.5% server-side at latitudes 25°N–48°N (unit test with geodesic fixtures).
- A polygon with a 20 x 20 ft hole reports 9,600 ft² (unit test).
- Polyline of known geodesic length matches within 0.5% (unit test).
- Saving 500 features in one PUT completes under 2 s and returns server-computed values (perf test).
- GET /imagery/captures and tile/takeoff/AI endpoints return 403 for a capture whose source has `allows_tracing=false` or `verified_at` null, including any Google/Mapbox satellite source (contract test). They never request a state WMS/ImageServer URL (test: no such host in outgoing allowlist).
- A Burke County fixture lists Helene 2025 ahead of an older NC cycle and NAIP; a site outside NC lists NAIP only (or other verified sources) (test).
- Editor and export/PDF show capture date, GSD and attribution; a capture dated 18 months ago shows an age warning (e2e / snapshot).
- Undo/redo covers create, edit vertex, delete, re-tag (e2e).
- Summary per takeoff item equals the sum of its measurements (property test).
- Ingest of a fixture 4-band GeoTIFF produces a ready ImageryCapture whose tiles render and whose coverage intersects the fixture AOI (integration test).
- Proposal PDF (08) prints imagery provider, capture date, GSD and attribution for each aerial takeoff used.

## Out of scope
AI detection (05), plan sets (12), 3D/height (slope, pitch: Later), offline editor. Drone upload and paid-provider adapter are v1, not MVP. Statewide NC ingest on day one is out; county/AOI only.

## Buy vs build
- Build the editor on MapLibre GL JS (BSD-3) + terra-draw (MIT) + Turf (MIT): free, no per-load fee.
- Build ingest + TiTiler on our storage. Imagery itself is $0 for NC + NAIP (storage and compute only; R2 $0.015/GB-month, https://developers.cloudflare.com/r2/pricing/, 2026-11-25).
- Do not buy Nearmap/Vexcel for MVP. Add a paid-provider adapter at v1 if freshness or 5–7 cm GSD is required; price Unknown (not public).
- Buy parcels: Regrid self-serve Standard $375/mo incl. 2,000 parcel records + 200,000 tiles, $0.10/record overage; Premium $500/mo, $0.15 overage (https://support.regrid.com/docs/getting-started-api, third-party confirmation of plan prices https://propraven.com/vs/regrid, both read 2026-11-25). Regrid bills per record returned: use `limit=1` point lookups + cache. Alternative: free county GIS parcel services (inconsistent schemas).
- Buy geocoding/autocomplete: Google Geocoding $5.00 per 1,000 after 10,000 free/month; Autocomplete Requests $2.83 per 1,000 after 10,000 free (https://developers.google.com/maps/billing-and-pricing/pricing, 2026-11-25). Check Google's display requirements; alternatives: Mapbox Search, Geocodio (not priced here).
