# 05 — AI takeoff assist (MVP) and auto detection (v1)

Phase: 05a click-to-segment assist = MVP behind a feature flag (3 person-weeks, estimate). 05b class auto-detection = v1 (8 person-weeks engineering, estimate; plus labeling labor, Unknown cost). Depends on: 04 (including ingested NC/NAIP COGs), GPU hosting.

## Goal
Cut drawing time: the estimator clicks inside a lawn/bed/lot (or drags a box) and gets a polygon to accept or edit (MVP). Later, one click detects all features of chosen classes within the site boundary (v1).

## Model options (checked 2026-11-25)
| Model | License | Fit |
|---|---|---|
| SAM 2 | Apache-2.0 (https://github.com/facebookresearch/sam2) | Point/box prompts -> mask. Class-agnostic. Good for 05a. |
| SAM 3 / 3.1 | Meta "SAM License" — royalty-free, commercial use allowed, custom terms (https://github.com/facebookresearch/sam3) | Adds text/exemplar concept prompts ("asphalt", "lawn"); candidate for zero-shot 05b baseline. Legal review of license. |
| Semantic segmentation (e.g. SegFormer/UNet) fine-tuned on own labels | depends on backbone license | Needed for consistent class output (asphalt vs concrete vs gravel; turf vs bed vs mulch). |
| Open aerial land-cover datasets (e.g. LoveDA, OpenEarthMap) | check each | Class sets don't match contractor classes; useful for pretraining only. |

## Data and licensing constraints
- Assist, detection, training and eval may only run on an ImageryCapture whose ImagerySource has the matching flag: `allows_tracing=true` (and `verified_at` set) for producing polygons; `allows_ml_training=true` for train/test/fine-tune. The API rejects anything else, including Google Maps Platform and Mapbox satellite (ToS 3.2.3(c)(vii) and Mapbox commercial-tracing rules). See 04.
- MVP training/eval corpus: verified NC 4-band ortho (including Helene 2025 leaf-off in the 13 western counties) and NAIP. 6-inch NC is usable for lawn, beds and lots; weak for striping, cracks and small objects — reflect that in the eval set and in 05b class list (defer striping until sharper imagery or drone uploads exist).
- NAIP is public domain (free to train on) but 30–60 cm GSD and leaf-on: coarse for residential beds/edging; prefer NC / Helene where coverage exists.
- Nearmap/Vexcel ML-training rights (v1): Unknown — must be in the contract before those captures enter the training set.
- Parcel vendor data may not be fed to AI models (Regrid AI policy, as quoted by https://forage.ai/blog/real-estate-api-pricing/ , read 2026-11-25). Use parcels only to crop/clip at inference, never as training labels — confirm with vendor.
- Customer-drawn manual takeoffs (04) are the best label source: ask for opt-in in ToS to use them for model improvement. Drone uploads (v1) need the same opt-in.

## Accuracy
No public, comparable accuracy figures exist for this task; do not claim any. Define our own: per-class IoU and absolute area error % vs a hand-measured ground-truth set (≥ 30 sites across 3 site types: commercial lot, residential landscape, HOA/common area), on each imagery source. Ship 05b only when Andy-approved thresholds are met.

## User stories
- 05a: I choose a takeoff item, enable "Assist", click inside a region; a draft polygon appears in under 5 s; I accept (becomes a manual-editable Measurement with source `ai_assist`) or add positive/negative clicks to refine.
- 05a: I drag a box over a parking lot and get the paved area minus islands.
- 05b: I pick classes (asphalt, concrete, turf, beds/mulch, trees as points, striping as lines) and run detection on the site; I get draft features grouped by class, review them, bulk-accept or delete.
- 05b: If results are bad, I flag the run; flags feed the eval set.

## Screens
Editor additions: Assist toggle + positive/negative click mode; draft feature styling (dashed); "Detect" dialog (classes, imagery capture with date/GSD, site boundary preview, estimated time); review panel (per class counts/areas, accept all/reject all, confidence filter).

## API
| Method | Path | Notes |
|---|---|---|
| POST | /takeoffs/:id/assist | {imageryCaptureId, points:[{lng,lat,label:1|0}], box?, takeoffItemId} -> {features[] (draft)} sync, 10 s timeout. 403 if source disallows tracing. |
| POST | /takeoffs/:id/detections | {classes[], boundary?} -> {runId} async (v1) |
| GET | /detections/:runId | status, progress, features (draft) |
| POST | /detections/:runId/accept | {featureIds[] | all, mapping class->takeoffItemId} |
| POST | /detections/:runId/flag | {reason} |
CV service (internal): `POST /segment/prompt` {image (COG chip url), transform, points, box} -> {polygons_px}; `POST /segment/classes` {image, transform, classes} -> {polygons_px by class, scores}.

## Pipeline
1. Worker checks `allows_tracing` (and, for training jobs, `allows_ml_training`), then crops a chip from the takeoff's ImageryCapture COG (bbox = site boundary + 10 m, at native GSD, max 4096 px side; tile into overlapping windows if larger). Chips come from our storage, never from a state ImageServer or Google/Mapbox satellite.
2. CV returns masks -> polygonize (rasterio.features.shapes) -> simplify (tolerance = 0.5 x GSD) -> georeference via affine transform -> clip to boundary -> drop slivers < 2 m².
3. API stores drafts in `detection_feature` (not `measurement`) until accepted.

## State machine — DetectionRun
`queued -> running -> succeeded | failed | cancelled`; `succeeded -> accepted_partial | accepted_all`. Retries: 2 on infra error; no retry on model error.

## Cost per takeoff (ingredients, 2026-11-25)
| Item | Price | Source |
|---|---|---|
| GPU time (Modal) | L4 $0.000222/s; A10 $0.000306/s; A100 40GB $0.000583/s | https://modal.com/pricing |
| Example arithmetic | 30 s of L4 = $0.0067 (our runtime is Unknown until benchmarked) | arithmetic |
| Imagery per site (MVP) | NC ortho + NAIP: $0 (storage/compute only) | see 04 |
| Imagery per site (v1 paid provider) | Nearmap/Vexcel: Unknown (not public) | see 04 |
| Parcel lookup | Regrid Standard: $0.1875/record at plan quota, $0.10 overage | see 04 |
| Geocode | $0.005 per request past free tier (Google Geocoding) | see 04 |
Total per AI takeoff on MVP imagery ≈ GPU + parcel + geocode (~$0.01–0.20 of the above, excluding storage amortization). Paid-provider imagery, if added at v1, is Unknown and would likely dominate.

## Edge cases
- Shadows/tree canopy over pavement -> lower confidence; recommend leaf-off capture.
- Imagery seams/date mix across tiles -> refuse runs spanning multiple capture dates.
- Huge site -> window tiling + merge masks across seams (dissolve by class).
- Draft polygons overlapping existing manual measurements -> show overlap, don't auto-subtract.
- GPU cold start -> assist UI shows spinner; warm pool during business hours (cost decision).

## Acceptance criteria
- 05a: p95 assist latency ≤ 5 s on warm GPU for a 1024 px chip (load test).
- 05a: accepted assist polygons are editable exactly like manual ones and carry `source='ai_assist'`.
- 05a/b: runs on a capture with `allows_tracing=false` or unset `verified_at` (including any Google- or Mapbox-satellite source) are rejected by the API (test). Training jobs also require `allows_ml_training=true`.
- 05b: on the ground-truth set, per-class metrics are computed by a reproducible eval script and published in the repo; the feature flag stays off in prod until thresholds (set by Andy) pass.
- Every run logs UsageEvent with GPU seconds and imagery tiles.

## Out of scope
Height/volume (excavation), roof planes, change detection between captures (Later), pavement condition rating (Later).

## Buy vs build
Build thin: open models (SAM 2 for MVP) on serverless GPU, running on our ingested NC/NAIP COGs. Do not buy imagery for MVP. Build labeling via our own editor (manual takeoffs = labels) rather than buying a labeling platform at MVP; revisit (Label Studio OSS) at v1. A paid imagery contract is a v1 decision and is not required for 05a.
