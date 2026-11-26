# Status

Imagery registry and TiTiler (spec 04, part 1) is the current slice. Owner: Andy Silver. The agent opens a draft PR and does not merge.

## Done

- Ticket 0 through Ticket 2 are on main (`dabcba3`): agent rules, the monorepo, CI, Postgres/PostGIS, MinIO, the `groundwork_app` role, `withWorkspaceContext`, and the office shell. ADR 0001 through ADR 0005.
- Migration `0003_imagery.sql` adds `imagery_source` and `imagery_capture` with GiST coverage indexes. Global rows (`workspace_id` null) are readable by every workspace. `groundwork_app` cannot write those rows. ADR 0006. Migration `0002` is left for Auth and Workspaces.
- Seeded `nc_helene_2025`, `nc_ortho` (2024 and 2022), and `naip`, plus blocked `nc_ortho_latest_viewing`, `google_satellite`, and `mapbox_satellite` (`allows_tracing` false, `verified_at` null). A synthetic 4-band fixture COG is in `db/seed/fixtures/` and is uploaded to MinIO by the tests. No live NC OneMap pull.
- `services/tiles` is a TiTiler FastAPI app. It serves XYZ tiles from the bucket and returns 403 unless the source allows tracing and `verified_at` is set. Compose builds it in place of the unguarded placeholder.
- `GET /imagery/captures` (bbox, or locationId which returns 501) and `GET /imagery/tiles/:captureId/{z}/{x}/{y}` (signed proxy, usage event, 403 guard). Both sit behind `stubImageryAuth` (`x-workspace-id`). Auth will replace that function. There is no session middleware yet.
- CI `check` still runs lint, typecheck, unit tests, the Python guard tests, and build. The `db` job migrates and runs RLS tests, including the imagery policy. The `imagery` job builds TiTiler and renders the fixture tile.

## Not in this slice

- Auth, the Better Auth table mapping, and the `workspace` table. The imagery routes trust the stub header until that lands.
- `locationId` resolution. The location table is spec 03.
- County ingest, the ingest API, takeoff drawing, and proposal PDF attribution.
- A browser-facing signed tile URL. This slice proxies.
- Sentry. Choosing a license. Choosing between Fly and Render.
- The remaining gaps in `docs/specs/OPEN-QUESTIONS.md`.
- Sign-ups or spend. No hosted secrets in git. Local compose passwords and the tile signing secret are laptop defaults and are refused when `NODE_ENV=production`.

## Open questions

See `docs/specs/OPEN-QUESTIONS.md`. Do not answer the unresolved lines in a drive-by.
