# Open questions

Known gaps between the specs. This file lists them. It does not answer them. A ticket that needs an answer flags it in the PR and waits for Andy. Do not edit `docs/specs/00` through `12` to paper over a gap. When an ADR resolves a line, the line stays here and names that ADR.

## No spec for our own SaaS billing

`docs/specs/README.md` puts "MVP hardening, onboarding, billing for our own SaaS" in the module order (2 person-weeks, estimate) and gives it no spec file. How Groundwork charges a contractor, what a `workspace.plan` value means, and how `UsageEvent` turns into an invoice are unspecified.

## RLS `current_setting` needs `missing_ok` true and a `NULLIF`, and imagery tables have a nullable `workspace_id` policy

`docs/specs/00-architecture.md` and the sketch at the bottom of `docs/specs/01-data-model.md` write:

```sql
workspace_id = current_setting('app.workspace_id')::uuid
```

`current_setting` without a true `missing_ok` argument errors when the setting is absent, and a blank string is not a uuid. The sketch also has no `NULLIF`. `imagery_source` and `imagery_capture` allow a null `workspace_id` for public-program rows that every workspace may read, but the policy pattern is equality on `workspace_id` only. The policy that satisfies both the tenant rule and the global-row rule is not written.

Foundations 2 ([ADR 0005](../adr/0005-local-infra-and-rls.md)) applies this expression to tenant tables whose `workspace_id` is `not null` (`counters`, `file`, `audit_log`, `usage_event`), for both `using` and `with check`:

```sql
workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
```

The imagery tables are not in that migration. ADR 0005 did not write the null `workspace_id` policy. ADR 0006 does.

Migration `0003_imagery.sql` ([ADR 0006](../adr/0006-imagery-registry-and-tiles.md)) applies this read policy on `imagery_source` and `imagery_capture`:

```sql
workspace_id is null
or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
```

Insert, update, and delete use a different policy: `workspace_id` must be non-null and equal to the same setting. `groundwork_app` cannot write a global row. The migration role writes the seeded global rows. The spec files were not edited.

## Mapping the Better Auth tables to the 01 `app_user` / `member` / `role` tables; the `citext` extension

ADR 0002 chooses Better Auth with the organizations plugin. `docs/specs/01-data-model.md` sketches `app_user`, `member`, and `role`, with `citext` on emails. The SQL sketch enables `postgis` and `pgcrypto` and does not enable `citext`. Which tables Better Auth owns, and which tables Groundwork owns, are unspecified.

The foundations migration creates the `citext` extension ([ADR 0005](../adr/0005-local-infra-and-rls.md)). No table in that migration uses the type.

[ADR 0007](../adr/0007-auth-workspaces.md) uses one set of tables. Better Auth's `user` is `app_user`, its organization is `workspace`, and `member` and `invitation` keep those names. Groundwork owns `role`. Email columns are `citext`. Primary keys Better Auth compares are `text` storing a UUIDv7, because the adapter binds text. The spec files were not edited.

These choices are still gaps in the specs:

- The permission matrix uses words ("read", "read assigned", "read own", "crew only") and not a token list. ADR 0007 stores `takeoff.read`, `estimate.read`, `proposal.read`, `crm.read.assigned`, `jobs.read.assigned`, `schedule.read`, `schedule.read.own`, and `time.approve.crew`. A later ticket must use those strings.
- Spec 02 says revoke goes to "(deleted)". The row stays, with status `revoked`. Invitation status `canceled` follows Better Auth's spelling.
- `GET /catalog-items` returned one fixture row so the cost-visibility check could run before spec 06. [ADR 0010](../adr/0010-catalog-recipes.md) replaces that fixture with persisted catalog items. Roles without `catalog.manage` still do not receive `unit_cost_cents`. The spec files were not edited.
- Workspace logo is a URL string. File upload is not specified.
- `workspace.plan` exists and the API does not set it. Billing is still the open question above.
- The route table has no way to record the active workspace. `POST /workspaces/:id/activate` does that.
- Better Auth's organization plugin defaults `membershipLimit` to 100. Our routes do not enforce that number.
- Disabling a member deletes every session for that user, including a session used for a different workspace. The other memberships stay. The person signs in again.
- System roles have a null `workspace_id` so they can be read with no tenant setting. That is separate from the imagery null-workspace policy.
- `0003_imagery.sql` has no foreign key to `workspace`. That table did not exist when imagery shipped. Tenant imagery rows stay isolated by the imagery policy.

## Tables missing from 01

`docs/specs/00-architecture.md` says human numbers (`J-1001` and the rest) come from a `counters` table. The entity list and the SQL sketch in `docs/specs/01-data-model.md` have no `counters` table.

The foundations migration adds `counters` with `workspace_id`, a `prefix` constrained to `J`, `E`, `P`, and `INV`, and `last_value bigint not null` ([ADR 0005](../adr/0005-local-infra-and-rls.md)). There is no default and no seed. The sequence start (the `1001` examples) is still unspecified. `workspace` now exists ([ADR 0007](../adr/0007-auth-workspaces.md)). `counters`, `file`, `audit_log`, and `usage_event` still have no foreign key to it.

The entity list names `File`. The SQL sketch has no `file` table.

The foundations migration adds `file` with `storage_key` (unique), `mime`, `bytes`, `sha256`, and `status`. Allowed `status` values are not specified, so the column is unconstrained text. The presign lifetime is not specified. The adapter defaults to 900 seconds and rejects a value above 3600 until that is decided. Whether production object storage should use path-style or virtual-host addressing is not specified. The adapter uses path-style so local MinIO works.

`docs/specs/03-crm-jobs.md` has `GET/POST /jobs/:id/notes` and `/jobs/:id/tasks`. No `job_note` or `job_task` table is sketched.

`docs/specs/08-proposals-esign.md` has `/proposal-templates`. No `proposal_template` table is sketched.

`Photo` is marked v1 in the entity table, and the same row says "MVP: job photos via web upload". The MVP photo table is not sketched.

## `event_log` has no `workspace_id` in the sketch

The header in `docs/specs/01-data-model.md` says every table has `workspace_id` except workspace, user, and global imagery and parcel rows. The `event_log` sketch has no `workspace_id`. [ADR 0005](../adr/0005-local-infra-and-rls.md) follows the sketch, so the table has no tenant policy. Whether a webhook row is tenant-scoped is unspecified.

## `audit_log` and `usage_event` primary keys

The header says `id uuid` plus `created_at` and `updated_at`. The sketch uses `bigserial` and `at` for `audit_log` and `usage_event`. [ADR 0005](../adr/0005-local-infra-and-rls.md) follows the sketch. The header was not edited.

## `line_item` is missing columns spec 06 and spec 07 use

`docs/specs/06-catalog-cost-recipes.md` and `docs/specs/07-estimating.md` describe per-line variable overrides, line-level markup and overhead, a tax code, a recipe version, and a flagged line (a line that blocks `ready`). The `line_item` sketch in `docs/specs/01-data-model.md` has none of `variables`, `markup_pct`, `overhead_pct`, `tax_code`, `recipe_version`, or `flagged`.

[ADR 0015](../adr/0015-estimating-engine.md) adds those columns, plus `recipe_component_id`, `catalog_item_id`, `takeoff_item_id`, `input_qty`, `input_unit`, `cost_cents`, `price_cents`, `tax_cents`, `price_overridden`, `optional`, and `measurement_ids`. `variables` stores overrides only. `qty` stays `numeric(14,4)`. `input_qty` is text so a recalculation can reuse the formula input. `price_cents` is the line amount. The group column is `grp` because `group` is reserved in SQL. The response field is `group`. The spec files were not edited.

## Proposal public token, selected options, and public endpoints

`docs/specs/08-proposals-esign.md` sends the client to a public signed URL to pick optional items before the PDF is sent for signature. The `proposal` sketch has no `public_token_hash` and no `selected_optional_line_ids`. The spec 08 route table has no unauthenticated public proposal endpoints.

## `cost_recipe` `output_unit` vs `input_unit`

The entity table in `docs/specs/01-data-model.md` says `CostRecipe` has `output_unit`. The SQL sketch says `input_unit text not null`. `docs/specs/06-catalog-cost-recipes.md` says the recipe declares an input unit. Which name is canonical is unspecified.

[ADR 0010](../adr/0010-catalog-recipes.md) stores `input_unit` and does not add `output_unit`. The question is still open.

The sketch also has no `status` and no column that groups versions. Spec 06 requires `draft -> active -> archived` and version n+1 when an active recipe is edited. ADR 0010 adds `status` and `family_id`.

The catalog sketch has no sell price. Spec 02 and spec 06 require one so office staff can see a price without a cost. ADR 0010 adds `unit_price_cents`.

Spec 06 writes `inputQty` and `referencedVars`. The API uses snake_case (`input_qty`, `referenced_vars`), matching the routes from ADR 0007. The spec files were not edited.

## Spec 07 `templateId` vs the v1 deferral

`POST /jobs/:id/estimates` in `docs/specs/07-estimating.md` accepts `templateId`. The same spec's out-of-scope line says a templates library beyond "clone estimate" is v1. Whether `templateId` exists at MVP is unspecified.

ADR 0015 rejects `template_id` with 400. It does not clone an estimate. The question is still open.

## Estimate rates, tax, discounts, and the snapshot

Spec 07 names markup, overhead, and tax and does not say whether the stored rates are percents or fractions. ADR 0015 stores markup and overhead as percents and `tax_rate` as a fraction from 0 to 1. A line is taxed when its tax code matches `material` or `materials`. A blank catalog tax code becomes `materials` for a material item.

Spec 07 says a negative line needs permission. Spec 02 has no discount token. ADR 0015 uses `catalog.manage` and does not add one. Roles without that token do not receive cost or margin fields. Office has `estimate.read` and not `estimate.*`.

The spec 01 sketch has `snapshot jsonb` and does not say when it is written or what it holds. ADR 0015 writes the view, including costs, when the estimate leaves draft. `GET` of a non-draft row returns that snapshot. `accepted` does not require a signature. That is spec 08.

Spec 07 part 2 asks for a quantity diff and version n+1 and does not say the unit, whether a draft is superseded, or how a partial apply chooses rows. [ADR 0019](../adr/0019-estimate-sync-and-versions.md) compares quantities in the takeoff item's default unit, reads the newest takeoff in the lineage, and returns 409 on a non-draft. `ready` and `sent` become `superseded` when cloned. A draft does not. `accepted` stays, because the state machine has no transition. `GET /jobs/:id/estimates` is the list the editor uses. The spec table does not name it. There is no phase column. The editor groups by the existing line group. The spec files were not edited.

## Node 22 vs 24

Resolved by [ADR 0004](../adr/0004-node-24.md). The runtime is Node 24 LTS. `.nvmrc` is `24`. `engines.node` is `>=24 <25`.

`docs/specs/README.md` and `docs/specs/00-architecture.md` say Node 22. They do not discuss Node 24. ADR 0001 did not pick. Ticket 1 needed an explicit choice before it pinned a runtime. The spec files were not edited.

## Context basemap, and how the PNG export works for proposals

`docs/specs/04-map-takeoff-manual.md` forbids Google Maps Platform and Mapbox satellite as a measurement or AI input, and says a non-measurement context basemap is "OK only ... with attribution, if at all." Which basemap, if any, is not chosen.

`GET /takeoffs/:id/export?format=png` and the proposal site-map image in spec 08 are required. The spec does not say whether the PNG is rendered in the browser, by Playwright, or by TiTiler, or how the overlay is composed. [ADR 0017](../adr/0017-takeoff-tools-export.md) renders it in the API as a schematic with the provider, date, GSD, and attribution. It does not composite a COG. A photo for proposals is still open.

## `locationId` on `GET /imagery/captures` before the location table exists

Spec 04 accepts `locationId` or `bbox`. Spec 03 owns `location`, and that table is not migrated. [ADR 0006](../adr/0006-imagery-registry-and-tiles.md) accepts the parameter and returns 501 until a lookup is plugged in. `bbox` is the spatial query this slice implements.

[ADR 0009](../adr/0009-crm-jobs.md) adds `location` and resolves `locationId` from `location.point` (a small padded bbox). A missing location, or a location with no point, is 404. Imagery still has no `location_id` column. The 501 stub remains only when a caller registers the imagery routes without a lookup.

## Age-warning day counts, tile signature lifetime, and who calls TiTiler

Spec 04 says to warn when a capture is older than 12 months, and to warn more strongly as it approaches 4 years. It does not give a day count for the second warning. The captures route uses 365 days and 1095 days. Both are provisional.

The same spec says the API issues short-lived signed tile URLs. It does not say the lifetime, or whether the browser calls TiTiler. This slice proxies. The HMAC lives for 60 seconds and is not given to the browser. `usage_event.cost_estimate_cents` for `imagery_tile` is 0. How a usage row becomes an invoice is already an open question above.

## County ingest has no boundary, no tile URL, and no named role

Spec 04 says ingest is county or AOI only and never statewide. It does not give a square-meter cap or a county polygon. [ADR 0008](../adr/0008-imagery-ingest.md) refuses an AOI above 60_000 km² and a FIPS code ending in `000`. A county job does not test the raster against a county boundary. The empty coverage stored while a county job is `ingesting` is replaced by the raster footprint when the job is `ready`.

The same spec cites ImageServer item pages. It does not give a 4-band GeoTIFF URL template. The live fetcher downloads one HTTPS GeoTIFF from `GROUNDWORK_IMAGERY_TILE_URL` only when `GROUNDWORK_IMAGERY_LIVE_FETCH` is `1`, and it refuses Google, Mapbox, NC OneMap, ArcGIS, ImageServer, and WMS hosts. CI leaves both variables empty. The URL is operator configuration, not a guessed portal endpoint.

`imagery_capture.capture_date`, `gsd_cm`, and `bands` are `not null` in the spec 01 sketch, including status `ingesting`. The worker stores provisional values and the job response omits date, GSD, bands, leaf, and `cog_key` until `ready`.

Spec 04 calls the source screen internal admin and does not name a system role. Ingest and source edits require `member.role` of `owner` or `admin`. Other active roles get 403. ADR 0008.

The route table does not mention `Idempotency-Key`. The builder rule requires a stored key. The same key and body return the existing job. A different body is 409. A failed job is not started again under that key.

`imagery_ingest_job` is not in the spec 01 entity list. The job's `workspace_id` is the operator's workspace. A capture for a global source stays `workspace_id` null. `event_log` still has no `workspace_id`. An ingest completion is `provider = imagery_ingest` and `event_id` equal to the job id.

## Blocked imagery products are not in the provider check

The spec 01 sketch limits `provider` to `nc_ortho`, `nc_helene_2025`, `naip`, `county`, `nearmap`, `vexcel`, `drone_upload`, and `other`. The blocked rows `nc_ortho_latest_viewing`, `google_satellite`, and `mapbox_satellite` are stored as `other`. The `name` column is the registry key. The sketch has no separate slug.

## Client email and phone are not on the spec 01 sketch

The spec 01 `client` sketch has no email or phone. Those columns are on `contact`. Spec 03 says creating a client warns on a duplicate email or phone. [ADR 0009](../adr/0009-crm-jobs.md) stores email and phone on `client` as well, so the warning has a row to match. The spec files were not edited.

## `jobs.force_won` is not in the spec 02 matrix

Spec 03 requires `jobs.force_won` to mark a job won without a signed proposal. Spec 02 does not list that token. [ADR 0007](../adr/0007-auth-workspaces.md) does not expand wildcards, so `jobs.*` does not include it. [ADR 0009](../adr/0009-crm-jobs.md) grants it to owner and admin only.

## Assigned CRM reads

Spec 02 gives foreman `crm.read.assigned` and `jobs.read.assigned`. It does not say which clients, contacts, or locations that includes. ADR 0009 treats it as jobs whose `owner_member_id` is the caller, plus clients, contacts, and locations tied to those jobs. Search uses that filter when either token is the caller's only read.

## Job number starts, and the signed-proposal flag

Spec 03's examples use `J-1001`. The start value for `E`, `P`, and `INV` was still open. ADR 0009 starts `J` at 1001 and leaves the others alone. There is no proposal table in this slice, so `hasSignedProposal` is always false. `proposed -> won` needs `jobs.force_won` until spec 08.

## Note, task, and file shapes, and an ungeocodable resolve

Spec 03 names notes, tasks, and files on a job and does not give columns. ADR 0009 stores a note body, a task title with `done` and `due_at`, and a `job_file` row pointing at `file`. `POST /locations/resolve` is not given a status for an address the geocoder cannot place. This slice returns 200 with `point: null`, an empty parcel list, and a warning. List routes cap at 200 rows. `GET /jobs` defaults to 50 and caps at 200. Paging is not in the spec.

## Takeoff version linkage, holes, acres, and the confirm field

Spec 04 says `final -> draft` creates version n+1 and keeps the old row read-only. The spec 01 sketch has `version` and no column that groups versions or points at the previous row. [ADR 0013](../adr/0013-takeoff-measurements.md) adds `lineage_id` and `supersedes_id`, inserts the new version, and copies measurements onto new ids. A partial unique index allows one `draft` or `in_review` row per lineage. The spec does not say whether two open versions may exist.

The measurement sketch allows a null `takeoff_item_id` and requires exactly one of `geom` and `sheet_geom`. ADR 0013 requires `takeoff_item_id` and stores `geom` only. `sheet_geom` and `planset_sheet` wait for spec 12. A planset takeoff may omit imagery and a location. An aerial takeoff requires both.

The entity table names deductions and the SQL sketch has no column. ADR 0013 stores them as a jsonb array of polygons, cuts those polygons out with `ST_Difference` before `ST_MakeValid`, and rewrites the array from the interior rings of the stored geometry.

`value_m = ST_Length(geom::geography)` is the perimeter when the geometry is an area. The summary adds `value_m` for length items only, so an area perimeter is not a length total. The spec does not say that split.

Overlaps of the same item are flagged. The spec does not give a minimum area. ADR 0013 flags an intersection above 0.01 m² and ignores a shared edge.

Display rounding names ft², yd², and ft. Acres are in the builder rules and have no step in spec 04. ADR 0013 rounds acres to 0.001.

`PATCH /takeoffs/:id` requires confirm before changing the capture on a takeoff that already has measurements. The spec does not name the field. The body uses `confirm: true`. JSON is snake_case (`location_id`, `imagery_capture_id`), matching the routes from ADR 0007. The spec table writes `locationId` and `imageryCaptureId`. The spec files were not edited.

## Activity list and file download URL

Spec 03's job page includes an Activity tab and Files/Photos. The API table does not name a read for `audit_log` or a way for the browser to GET a stored object. This UI reads `GET /jobs/:id/activity` (actor, action, `at`, and the stage diff already written by ADR 0009) and adds `download_url` on the file payload, signed the same way as the upload URL. The presign lifetime is still the open question above. The spec files were not edited.

## Assist statuses, the draft columns, and the single-capture seam

Spec 01's `detection_run` check stops at `cancelled`. Spec 05 also moves a succeeded run to `accepted_partial` or `accepted_all`. [ADR 0016](../adr/0016-ai-takeoff-assist.md) puts both in the check and in `DetectionRun`. [ADR 0018](../adr/0018-ai-assist-acceptance.md) exposes that transition. A review that does not keep every draft, including a discard of all of them, closes as `accepted_partial`. Spec 05 has no rejected status, so this slice does not add one.

Spec 05 part b maps a detection class to a takeoff item. This slice still uses `detection_feature.takeoff_item_id` from the assist request. `GET /detections/:id` returns status, features, and overlaps. Spec 05's progress percent is not on that response. The assist call in this slice is synchronous.

The spec 01 sketch has no `takeoff_item_id` on `detection_feature` and no idempotency columns on `detection_run`. ADR 0016 stores the area item from the request and stores `idempotency_key` plus `request_hash`. The header is `Idempotency-Key`. A missing header gets a new id. The same key and body replay a succeeded run. A different body returns 409.

Spec 05 says a site that crosses a seam is 409. ADR 0016 treats a seam as the chosen capture failing to cover the site boundary expanded by 10 m. Other program footprints that also overlap the site do not refuse the request. The capture on the request may differ from the capture stored on the takeoff. A location with no `site_geom` is 409. Assist does not read `parcel_cache`.

The chip's longest side is at most 4096 px, resampled if the window is larger. Tiled windows are deferred. The API downloads the whole COG (refusing objects over 512 MiB) and crops a local file. A range read is later work. Simplification uses `0.5 * capture GSD` converted to pixels from the measured ground pixel size, then PostGIS warps to EPSG:4326. Polygons under 2 m² are dropped.

The route is off unless `GROUNDWORK_AI_ASSIST` is `1` and `workspace.features.ai_assist` is true. The spec does not name the env flag. The mock reports `gpu_seconds = 0` and `cost_estimate_cents = 0`. `POST /segment/classes` returns no polygons. A final takeoff is 409. The spec files were not edited.

## Parcel search radius, PNG imagery pixels, and the feature-tile budget

Spec 04 asks for parcels in the current view and a PNG site map that includes the imagery. [ADR 0017](../adr/0017-takeoff-tools-export.md) returns `parcel_cache` rows that intersect the bbox and lie within 2 km of the location point, capped at 50. The PNG is a schematic of the measurement outlines. The provider, capture date, GSD, and attribution are drawn and stored in PNG text. It does not composite COG pixels: the database CI job has no imagery store, and the export must not call a paid tile service. A photo site map for proposals is still open. Feature tiles are GeoJSON, 500 features, and 30 requests per 10 seconds per workspace per API process. The spec files were not edited.
