# 00 — Architecture

Phase: MVP (foundations). Effort: 2 person-weeks (estimate) for repo, CI/CD, environments, design system shell, observability.

## System context
```
[Office web app (Vite/React)] --HTTPS/JSON--> [API (Node/Fastify)] --SQL--> [Postgres + PostGIS]
[Crew app (Capacitor/React + SQLite)] --sync API--> [API]           |--> [pg-boss workers]
                                                                    |--> [Object storage (R2/S3)]
[API workers] --HTTPS--> [CV service (Python/FastAPI on GPU)]
[imagery-ingest] --download--> NC 4-band tiles / NAIP  --> COG --> [Object storage]
[web / api] --tiles--> [TiTiler] --reads--> [Object storage COGs]
[API workers] --HTTPS--> parcel provider | geocoder | e-sign | Stripe | QBO
                          (v1 also: paid imagery API, drone upload)
[Webhooks in] Stripe, e-sign, QBO --> [API /webhooks/*] --> event_log --> workers
```
Never stream NC OneMap / state WMS or ImageServers in production. Ingest once, serve our COGs.


## Components
| Component | Responsibility | Tech | Notes |
|---|---|---|---|
| web | Office UI: CRM, takeoff editor, catalog, estimates, proposals, schedule, invoices | React, Vite, TanStack Router/Query, MapLibre, terra-draw, pdf.js | Code-split the map and PDF editors |
| crew | Crew UI: today's work, clock in/out, checklists, photos, daily report | React + Capacitor plugins (Camera, Geolocation, Filesystem), SQLite | Offline-first; see 10 |
| api | REST, auth, tenancy, validation, state machines, webhooks | Fastify, zod, Kysely | OpenAPI generated from zod schemas at `/openapi.json` |
| workers | PDF render, CV job orchestration, e-sign/Stripe/QBO sync, email | pg-boss, Playwright | Same codebase as api, separate process |
| imagery-ingest | Download NC 4-band tiles (and Helene 2025 where covered) and NAIP; convert to COG; register ImageryCapture rows | Python, rasterio/GDAL, rio-cogeo | County/AOI on demand, not statewide on day one. Prefer GeoTIFF tiles over MrSID mosaics (MrSID may need a proprietary GDAL plugin). |
| tiles | XYZ/TMS tiles from our COGs | TiTiler (Python/FastAPI) | Auth in front (API or signed tile URLs). Refuses captures whose source has `allows_tracing=false`. |
| cv | Segmentation inference: point/box prompts (assist), class detection (v1) | Python, FastAPI, PyTorch, rasterio, shapely | Stateless; input = image chip + georef from our COG; output = polygons in chip pixel coords + georef transform |
| db | System of record | Postgres 16, PostGIS 3 | RLS on `workspace_id`; ImagerySource/Capture may be global (workspace_id null) |
| storage | Photos, PDFs, plan sets, imagery COGs, chips | R2 or S3 | Public-program COGs under a global prefix; workspace uploads prefixed by workspace |

## Key flows
1. Address -> parcel: client autocompletes address (geocoder), API resolves lat/lng -> parcel lookup (provider, cached in `parcel_cache`) -> site polygon saved on Location.
2. Imagery (MVP): API intersects the site bbox with ImageryCapture coverage. Preference order: newest NC capture with `allows_tracing=true` (Helene 2025 leaf-off in the 13 western counties, else the latest NC Ortho cycle), then NAIP. Client renders tiles from our TiTiler (not the state). UI shows capture date, GSD and required attribution; age warning if the capture is older than 12 months. v1 adds customer drone COGs and a paid-provider adapter (Nearmap/Vexcel).
3. Manual takeoff: terra-draw creates GeoJSON; client sends features; API recomputes area/length with PostGIS (server is authoritative), stores Measurement rows linked to TakeoffItems.
4. AI assist: client sends prompt points/box -> API crops a chip from the takeoff's ImageryCapture COG (worker) after checking `allows_tracing` -> CV service returns mask polygons -> API georeferences, simplifies, clips to site, returns as draft Measurements the user accepts/edits. Training/eval only if `allows_ml_training=true`.
5. Estimate: takeoff quantities -> cost recipes -> line items (materials/labor/equipment/subs) with markup -> totals.
6. Proposal: render PDF from estimate snapshot -> e-sign provider envelope -> webhook marks signed -> Job stage = Won, WorkOrder created.

## Cross-cutting decisions
| Concern | Decision |
|---|---|
| Tenancy | `workspace_id` on every row; `SET app.workspace_id` per request; RLS policies `USING (workspace_id = current_setting('app.workspace_id')::uuid)` |
| IDs | UUIDv7 primary keys; human numbers per workspace (`J-1001`, `E-1001`, `P-1001`, `INV-1001`) from a `counters` table |
| Money | integer cents, currency code per workspace |
| Units | store metric (m², m, count); workspace display preference imperial default |
| Geometry | EPSG:4326 `geometry`; area via `ST_Area(geom::geography)`; sheet geometries (plan sets) in sheet units with no SRID |
| Validation | zod at API boundary only; DB constraints for invariants |
| Errors | RFC 9457 problem+json |
| Auth | session cookies (web), bearer tokens (crew app); roles per workspace (see 02) |
| Audit | `audit_log` (actor, entity, action, diff jsonb) on all mutations of estimates, proposals, invoices, time entries |
| Files | presigned upload -> `file` row -> virus/type check worker -> ready |
| Feature flags | `workspace.features jsonb` + env overrides (AI assist behind flag) |
| Observability | OpenTelemetry traces, structured logs (pino), Sentry for web/crew/api |
| Testing | Vitest unit, Playwright e2e per acceptance criteria, contract tests against OpenAPI |
| CI/CD | GitHub Actions: lint, typecheck, test, migrate (staging), deploy; preview env per PR for web |

## Where Python is warranted
| Area | Why not Node |
|---|---|
| Segmentation inference + fine-tuning | PyTorch/SAM ecosystem, GPU tooling |
| Raster georeferencing / reprojection of imagery chips | rasterio/GDAL maturity (Node GDAL bindings exist but are rougher) |
| Imagery ingest (MrSID/GeoTIFF -> COG) and TiTiler | GDAL / rio-cogeo / TiTiler are Python-first |
| Raster plan-set symbol detection (later) | OpenCV, template matching, detectors |
Everything else (API, PDF vector parsing via pdf.js, pricing engine, sync) stays TypeScript.

## Environments
| Env | Purpose |
|---|---|
| local | docker compose: postgis, minio, mailpit, TiTiler; a small fixture COG (not a full county); CV service mocked or CPU |
| staging | real providers in sandbox/test modes (Stripe test, QBO sandbox, e-sign test mode) |
| prod | |

## Acceptance criteria (foundations)
- `pnpm i && pnpm dev` brings up web, api, db (PostGIS), storage locally in under 5 minutes on a clean machine.
- CI blocks merge on typecheck, lint, unit tests, migration up/down.
- `/openapi.json` is generated and diffed in CI; breaking change fails the build without a version bump.
- A request without workspace context cannot read any tenant table (RLS test).
- `pnpm dev` also serves tiles from a fixture COG through TiTiler; a request for a capture with `allows_tracing=false` returns 403.
