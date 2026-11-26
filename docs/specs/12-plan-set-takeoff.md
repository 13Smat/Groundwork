# 12 — Plan-set takeoff

Phase: v1 = manual measuring on PDFs with scale calibration (4 person-weeks, estimate). Later = automatic symbol/legend counting and area fill detection (8+ person-weeks, estimate, high uncertainty). Depends on: 04 (measurement model), 06.

## Goal
Upload a landscape/site plan PDF, set scale per sheet, and measure areas/lengths/counts into the same takeoff items and estimate flow as aerial takeoffs.

## Hard parts
| Problem | Approach |
|---|---|
| Vector vs raster PDFs | Detect per page: pdf.js `getOperatorList` path-op count vs image XObject coverage. Vector pages: snap to real line geometry. Raster (scanned) pages: render to image; no snapping in v1. |
| Scale detection | v1: user calibrates (click two points on a known dimension, enter length) or picks from title-block scale list (1"=20', 1:240...). Auto-read scale text from the text layer as a suggestion only; always show "unverified scale" until confirmed. Scale bars detected Later. |
| Page sizes / "not to scale" sheets | Store scale per sheet; block measuring on sheets marked NTS. Detail callouts with different scales: allow multiple scale regions per sheet (Later). |
| Symbol/legend matching (Later) | Vector: hash path groups (normalized geometry signatures) from the legend and match occurrences across sheets. Raster: template matching / small detector in Python (OpenCV, a fine-tuned detector). Plant schedule tables: text-layer table extraction; OCR for scans. |
| Hatch/fill areas (Later) | Vector: closed paths with fill/hatch patterns -> polygons; raster: segmentation. |

## User stories (v1)
- I upload a multi-page PDF; pages appear as sheets with thumbnails and names (from text layer title block when found).
- I calibrate scale per sheet and see it confirmed.
- I draw polygons/lines/counts on the sheet with the same tools as the map editor; quantities in real units.
- On vector sheets my vertices snap to drawing lines.
- I count symbols by clicking each (fast-count mode with running tally per takeoff item).
- Quantities appear in the takeoff summary and estimate like aerial ones.

## Screens
Plan set upload; Sheet list; Sheet viewer (pdf.js canvas + SVG overlay for measurements); Scale dialog; Count mode; Quantity summary (shared with 04).

## API
| Method | Path |
|---|---|
| POST | /jobs/:id/takeoffs {kind:'planset'} |
| POST | /takeoffs/:id/plansets (presigned upload -> worker: page split, thumbnails, vector/raster detection, text extraction) |
| GET | /takeoffs/:id/sheets ; PATCH /sheets/:id {name, scale_units_per_pt, scale_source, nts} |
| GET | /sheets/:id/render?zoom= (cached PNG tiles for raster/large pages) |
| GET | /sheets/:id/vectors?bbox= (snap geometry, simplified) |
| PUT | /takeoffs/:id/measurements (same as 04; sheet_geom + sheet_id) |

## Entities
Takeoff, PlansetSheet, Measurement (sheet_geom), File, TakeoffItem.

## State machine — PlansetSheet processing
`uploaded -> processing -> ready | failed`; scale state `unset -> suggested -> confirmed`. Measuring allowed only when `confirmed`.

## Edge cases
- 200 MB, 80-page sets -> worker streams pages; viewer lazy-renders; tile cache.
- Rotated pages / non-square user units -> normalize to PDF user space with rotation matrix.
- Password-protected PDFs -> reject with message.
- Scale text says 1"=20' but sheet printed half-size (11x17 of a 22x34 set) -> calibration overrides title block; warn when they disagree > 2%.
- Mixed vector/raster on the same page (scanned base with vector markups) -> treat as raster for snapping.

## Acceptance criteria
- Calibrating on a test sheet with a known 100 ft dimension yields 100.0 ft ± 0.5% on a second known dimension (test with fixture PDFs).
- Vector detection classifies a fixture set of 10 vector and 10 scanned pages correctly (test).
- Area of a drawn rectangle on a 1"=20' sheet of 5" x 2" equals 4,000 ft² (unit test).
- Measuring is blocked until scale confirmed (e2e).
- 80-page fixture processes in < 3 min and first sheet viewable in < 15 s (perf test).

## Out of scope (v1)
Automatic symbol counting, plant schedule extraction, irrigation layout, AI chat over plans, comparing plan revisions (Later).

## Buy vs build
Build on pdf.js (Apache-2.0) in the browser and Node worker. Raster/OCR (Later) in Python: pypdfium2 (permissive) for rendering + OpenCV + Tesseract/cloud OCR. Avoid PyMuPDF unless buying its commercial license (it is AGPL-3.0). Commercial takeoff SDKs (e.g. Apryse/PDFTron measurement tools) exist; price not public — consider if v1 slips.
