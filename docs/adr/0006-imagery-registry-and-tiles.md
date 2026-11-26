# ADR 0006: Imagery registry and the TiTiler gate

## Status

Accepted (2026-11-26).

## Context

Spec 04 requires a registry of imagery sources and captures, a fixture COG, and tile serving through TiTiler. The API and TiTiler both return 403 when `allows_tracing` is false or `verified_at` is null. Google Maps Platform satellite, Mapbox satellite, NC Orthoimagery_Latest, and state WMS or ImageServers are never streamed.

`docs/specs/OPEN-QUESTIONS.md` says the read policy for a null `workspace_id` is not written. Foundations 2 ([ADR 0005](0005-local-infra-and-rls.md)) left the imagery tables out and ran upstream TiTiler with no gate. Auth and session middleware are not in the repo yet. A parallel change owns migration `0002`. This migration is `0003_imagery.sql`.

Checked while building this slice:

- `titiler.core` 2.0.5 declares `rio-tiler>=9,<10` and FastAPI. `TilerFactory` registers `/tiles/{tileMatrixSetId}/{z}/{x}/{y}` and, unless told otherwise, also info, statistics, preview, and point.
- `pg8000` 1.31.6 imports and connects. It is pure Python, so the TiTiler image does not need a binary driver wheel. 1.31.5 cannot talk to a TLS-capable Postgres with `scramp` 1.5.0.
- `Reader.tile(tile_x, tile_y, tile_z, tilesize=None, indexes=None, expression=None, buffer=None, **kwargs)` is the rio-tiler method the factory calls.
- The fixture tile math uses morecantile's WebMercatorQuad bounds for z=16, x=17894, y=25791, rounded to 12 decimal places.

## Decision

- `imagery_source` and `imagery_capture` follow the spec 01 sketch, plus `created_at`, `updated_at`, and `created_by` from the header. There is no foreign key to `workspace`. `cog_key` must be a relative `.tif` object key. A URL does not pass the check.
- The provider check stays the spec list. `nc_ortho_latest_viewing`, `google_satellite`, `mapbox_satellite`, and `fixture_rgbir` are `provider = 'other'` and are distinguished by `name`.
- Reads use `workspace_id is null or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Insert, update, and delete policies require a non-null `workspace_id` equal to that setting. `groundwork_app` cannot write a global row. The migration role inserts the seed because it is a superuser and bypasses row security.
- The seed records the three programs spec 04 allows (`nc_helene_2025`, `nc_ortho`, `naip`) with `verified_at` of 2026-11-25, and the three blocked products with `allows_tracing = false` and `verified_at` null. Coverage rectangles are test fixtures, not surveyed boundaries. Two NC ortho captures (2024 and 2022) share one source so newest-first can be tested.
- Ordering is Helene, then NC ortho by capture date descending, then NAIP, then any other allowed provider. Age warnings start after 365 days. A stronger warning starts at 1095 days. Both numbers are provisional.
- `GET /imagery/captures` accepts `bbox` or `locationId`. `locationId` returns 501 until the location table exists. The lookup is a function the CRM slice can replace.
- `GET /imagery/tiles/:captureId/{z}/{x}/{y}` checks the registry, writes a `usage_event` with kind `imagery_tile` and `cost_estimate_cents` 0, and proxies a 60-second HMAC URL to TiTiler. Redirects are not followed. The only allowed upstream host is the configured TiTiler host, and that host cannot be on the forbidden-suffix list.
- The tile service subclasses `TilerFactory` and registers only the tile route, with an `RgbReader` that always renders bands 1–3. The path dependency verifies the HMAC, rejects a `url` query, loads the capture as `groundwork_app`, and opens `/vsis3/{bucket}/{key}`. A bad signature is 401. A failed license check is 403.
- Captures and tile routes use `stubImageryAuth`, which reads `x-workspace-id`. Auth and Workspaces replaces that function. It is not a session.
- The compose file builds this service instead of the unguarded `ghcr.io/developmentseed/titiler:2.0.5` process. The base image is still that tag. `TILE_SIGNING_SECRET` in compose is the laptop default and is refused when `NODE_ENV=production`.
- The fixture COG is generated, committed, and uploaded to MinIO by tests. No request in this slice downloads NC OneMap.

## Alternatives

- One read policy that also allows `workspace_id is null` on insert. Rejected. That would let the app role create global rows.
- Mount stock `TilerFactory`, which accepts `?url=`. Rejected. A caller could pass a state ImageServer or a Google tile URL.
- Give the browser a signed TiTiler URL. Rejected for this slice. The spec says the API issues signed URLs, and the ticket asks for a proxy. The browser does not learn the signing secret. The choice is flagged in `docs/specs/OPEN-QUESTIONS.md`.
- Add `google_satellite` to the provider check. Rejected. The sketch's check list does not include it. `other` plus `name` keeps the check and still names the row.
- Stream Orthoimagery_Latest for the blocked-source test. Rejected. The blocked rows point at the fixture object key so the 403 is the only reason the pixels are withheld.

## Consequences

- A later tenant imagery row (drone, v1) can be inserted by `groundwork_app` when its `workspace_id` matches the setting. Global rows stay a migration or admin write.
- TiTiler must receive `APP_DATABASE_URL` for `groundwork_app`. The role is created by migrate, which may run after the container starts. Health does not need the database. The first tile request does.
- `locationId`, the 1095-day threshold, the 60-second signature, `cost_estimate_cents` of 0, and proxy-versus-browser-URL are recorded in `docs/specs/OPEN-QUESTIONS.md`. The spec files were not edited.
- CI's imagery job builds this image and renders one tile. `pnpm check` does not need Docker. It does run the Python guard tests.
- [ADR 0007](0007-auth-workspaces.md) replaced `stubImageryAuth`. `x-workspace-id` still names the workspace. The route now requires a session, and a caller who is not an active member receives 404.

## References

- `docs/specs/04-map-takeoff-manual.md`
- `docs/specs/01-data-model.md`
- `docs/specs/OPEN-QUESTIONS.md`
- `docs/adr/0005-local-infra-and-rls.md`
