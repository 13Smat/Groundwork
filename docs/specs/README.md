# Contractor platform build specs (paving + landscaping)

Specs for a coding agent to build a takeoff-to-invoice platform for paving and landscaping contractors. Clean-room: written from public research and a hands-on evaluation of a competitor. Describes behavior only; no competitor copy, feature names, assets or data. Prices are quoted with a source and the date 2026-11-25; anything not public says Unknown.

Companion Page: "TruTec-style build plan" (hard parts, buy vs build, effort, risks).

## Product in one line
Address -> parcel -> self-hosted state/county ortho (MVP: NC 6-inch + NAIP fallback) -> draw (or AI-assist) areas/lengths/counts -> quantities -> estimate from catalog + cost recipes -> proposal PDF + e-sign -> won job -> (v1) schedule, crew app, invoice, QuickBooks; drone uploads and paid imagery (Nearmap/Vexcel) at v1.

## Phases
| Phase | Meaning |
|---|---|
| MVP | Sellable slice: a contractor can measure a site, price it, send a signed proposal, and get a job record. |
| v1 | Run the job: scheduling, crew mobile (offline), invoicing/payments/QBO, plan-set takeoff (manual), auto AI detection. |
| Later | Plan-set auto symbol counting, service contracts/recurring, fleet, purchasing, submittals, roofing, partner API/MCP. |

## Stack (decided unless marked open)
| Layer | Choice | Why |
|---|---|---|
| Web | React 18 + Vite + TypeScript, TanStack Router + TanStack Query, Tailwind + Radix primitives | Andy's stack; fast iteration |
| Map | MapLibre GL JS + terra-draw + Turf.js | Open source (BSD-3 / MIT / MIT); no per-load fees for the drawing layer |
| API | Node 22 + Fastify + zod (fastify-type-provider-zod) -> OpenAPI generated | One language across stack; typed contracts |
| DB | Postgres 16 + PostGIS, Kysely query builder, SQL migrations | Geometry is first-class; RLS for tenancy |
| Jobs | pg-boss (Postgres queue) | No Redis to run at MVP |
| Imagery tiles | Self-hosted COGs in R2/S3, served by TiTiler (Python); ingest job converts NC 4-band tiles / NAIP to COG. Never stream state WMS/ImageServers in production. | License-safe measurement imagery; 4-band tiles are for analysis, not the 3-band JPEG viewing service |
| CV service | Python 3.11 + FastAPI + PyTorch (SAM 2 / SAM 3), deployed on serverless GPU (e.g. Modal) | Python is warranted here: model ecosystem, raster libs (rasterio/GDAL, OpenCV) |
| Plan-set raster pipeline (v1) | Python (pypdfium2 + OpenCV) | Vector path stays in Node (pdf.js) |
| PDF output | HTML -> PDF via headless Chromium (Playwright) in a worker | Reuse React templates for proposals/invoices |
| E-sign | OPEN DECISION: Documenso (self-host, AGPL) vs Dropbox Sign API vs DocuSign API | See 08 |
| Payments | Stripe (Checkout/Payment Links + webhooks; Connect if paying contractors directly) | Standard |
| Accounting | QuickBooks Online API, Intuit App Partner Program Builder tier to start | See 11 |
| Mobile | Capacitor wrapping a crew-focused React app + SQLite + outbox sync | Reuses web code; offline via SQLite |
| Auth | Better Auth (self-hosted, organizations plugin) — or Clerk if speed beats cost | See 02 |
| Storage | S3-compatible (Cloudflare R2 or S3) with presigned uploads | Photos, PDFs, imagery chips |
| Hosting | Containers (Render / Fly / AWS ECS — open), managed Postgres with PostGIS (Neon / RDS — open) | |

## Repo layout (pnpm workspaces + Turborepo)
```
apps/
  web/            # Vite React office app
  crew/           # Vite React crew app, wrapped by Capacitor (ios/, android/)
  api/            # Fastify API + workers (pg-boss)
services/
  cv/             # Python FastAPI: segmentation endpoints (Modal deploy)
  tiles/          # TiTiler: COG raster tiles from object storage
  imagery-ingest/ # Python: download NC/NAIP tiles, convert to COG, register captures
  planset/        # Python: raster plan-set preprocessing (v1)
packages/
  shared/         # zod schemas, DTO types, enums, state machines
  geo/            # turf wrappers, unit conversions, area/length helpers
  pricing/        # cost-recipe formula engine (pure TS, heavily tested)
  pdf-templates/  # React components rendered to PDF
  ui/             # design system components
db/
  migrations/     # SQL (PostGIS)
  seed/           # demo workspace, sample catalog (our own data)
docs/specs/       # these files
```

## Module order
| # | Spec | Phase | Depends on | Effort (person-weeks, estimate) |
|---|---|---|---|---|
| — | Foundations (repo, CI, deploy, design system, observability) | MVP | — | 2 |
| 02 | auth-workspaces | MVP | foundations | 1.5 |
| 03 | crm-jobs | MVP | 02 | 2.5 |
| 04i | imagery-ingest (in 04) | MVP | foundations, storage | 2.5 |
| 04 | map-takeoff-manual | MVP | 03, 04i | 4 |
| 06 | catalog-cost-recipes | MVP | 02 | 2.5 |
| 07 | estimating | MVP | 04, 06 | 3 |
| 08 | proposals-esign | MVP | 07 | 2.5 |
| 05 | ai-takeoff-assist (click-to-segment) | MVP (flagged) | 04 | 3 |
| — | MVP hardening, onboarding, billing for our own SaaS | MVP | all | 2 |
| 09 | scheduling-dispatch | v1 | 03, 08 | 4 |
| 10 | crew-mobile (offline) | v1 | 09 | 6 |
| 11 | invoicing-payments-qbo | v1 | 07, 08 (09 optional) | 4 |
| 12 | plan-set-takeoff (manual measure + scale) | v1 | 04, 06 | 4 |
| 04v | drone upload + paid imagery adapter (in 04) | v1 | 04 | 1.5 |
| 05b | ai-takeoff auto detection (fine-tuned classes) | v1 | 05, labeled data | 8 |

MVP total: 25.5 person-weeks (estimate). v1 adds 27.5 (estimate). Total to v1: 53 person-weeks (estimate), one senior full-stack engineer with an AI coding agent; excludes labeling labor and legal review. Delta vs first plan: +2.5 MVP (ingest/COG/TiTiler/registry), +1.5 v1 (drone + paid-provider adapter).

## Rules for the builder
- Every table has `workspace_id`; enforce with Postgres RLS + an API-level guard. No cross-tenant query without an explicit admin path.
- Geometry in EPSG:4326; compute area/length with geography casts (`ST_Area(geom::geography)`) or Turf geodesic functions; display in ft²/ft/yd²/acres. Store canonical metric values, convert at the edge.
- Money as integer cents + currency; quantities as `numeric(14,4)`.
- All state transitions go through the state machines in `packages/shared/state/*`; illegal transitions return 409.
- Every async external call (CV, e-sign, Stripe, QBO) is idempotent with a stored idempotency key and a webhook/event log table.
- Never use Google Maps Platform or Mapbox satellite imagery as a measurement or AI input (see 04). API refuses any ImagerySource with `allows_tracing=false`. Never feed parcel vendor data to model training (see 05). Training/eval only on sources with `allows_ml_training=true`.
- MVP imagery default: ingest NC Orthoimagery Program 4-band tiles (and the Helene 2025 leaf-off set where it covers) plus NAIP as fallback; convert to COG; serve from our storage via TiTiler. Do not stream NC OneMap / state ImageServers or the 2024–2027 WMS in production. Do not use Orthoimagery_Latest (3-band JPEG, "for viewing, not raster analysis") as measurement or AI input. Paid providers and customer drone uploads are v1.

## Links (checked 2026-11-25)
- Google Maps Platform ToS (3.2.3(c): no tracing/digitizing from satellite, no using content to train ML): https://cloud.google.com/maps-platform/terms
- Google Maps Platform pricing: https://developers.google.com/maps/billing-and-pricing/pricing
- Mapbox imagery tracing policy: https://www.mapbox.com/imagery , https://docs.mapbox.com/data/tilesets/guides/imagery/
- Nearmap APIs: https://developer.nearmap.com/docs/about-nearmap-apis
- Regrid API billing: https://support.regrid.com/docs/getting-started-api
- NAIP: https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip
- NC Orthoimagery Program (6-inch, 4-year cycle, free public): https://www.nconemap.gov/pages/imagery
- NC Orthoimagery_Latest ImageServer (viewing-only 3-band JPEG; do not use for analysis): https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest/ImageServer
- NC 2024–2027 WMS (Custom License — review before use; do not stream in production): https://data-nconemap.opendata.arcgis.com/maps/66707ed653ea41c6bcb487b810618373
- NC Helene 2025 ImageServer iteminfo (licenseInfo "None", attribution appreciated): https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Helene_2025/ImageServer/info/iteminfo
- TiTiler: https://developmentseed.org/titiler/
- SAM 2 (Apache-2.0): https://github.com/facebookresearch/sam2 ; SAM 3 (SAM License): https://github.com/facebookresearch/sam3
- MapLibre GL JS: https://maplibre.org ; terra-draw: https://github.com/JamesLMilner/terra-draw ; Turf: https://turfjs.org
- pdf.js: https://mozilla.github.io/pdf.js/
- Documenso pricing: https://documenso.com/pricing ; Dropbox Sign API pricing: https://sign.dropbox.com/products/dropbox-sign-api/pricing ; DocuSign developer plans: https://ecom.docusign.com/isv/plans-and-pricing/developer
- Stripe pricing: https://stripe.com/pricing
- Intuit platform fees: https://help.developer.intuit.com/s/article/platform-service-fees
- Capacitor: https://capacitorjs.com ; PowerSync pricing: https://powersync.com/pricing
- Modal GPU pricing: https://modal.com/pricing ; Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/ ; Neon pricing: https://neon.com/pricing ; Clerk pricing: https://clerk.com/pricing
