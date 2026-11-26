# ADR 0022: Onboarding flag and the demo seed

## Status

Accepted (2026-11-26).

## Context

The office already creates a workspace with a name, timezone, currency, and units preference. Spec 02 also asks for a company profile, and spec 06 already loads a clean-room starter pack through `POST /catalog-items/starter-pack`. `workspace.features` is a jsonb object of boolean flags. `ai_assist` is one of those flags. A patch that replaced the whole object would clear the other flag.

`pnpm db:seed` has to create tenant rows. Migration `0003` already inserts the global fixture COG capture. `groundwork_app` cannot insert a global imagery row unless `app.imagery_admin` is on, and that setting is for an owner or admin request, not a seed script. The demo data has to be idempotent and must not bypass row security.

## Decision

- First-run setup is `/onboarding` after the workspace is created. It saves the company profile, the timezone, and imperial or metric units, then loads the existing starter pack. Finish and skip set `features.onboarding_complete` to true. The office redirects there until that flag is true.
- `PATCH /workspaces/:id` merges feature flags. A key in the body replaces that key. Keys that are not in the body stay as they are. An empty `features` object clears the map. That is how a caller turns every flag off, including `ai_assist`.
- `pnpm db:seed` connects as `groundwork_app` and calls `withWorkspaceContext`. It inserts one demo workspace, an owner member with no user, two clients, two locations, and one job, then applies the starter pack. A second run inserts nothing. The sample sites sit inside the fixture COG footprint. The seed reads that capture and does not write imagery. The member has no password, so the seed is not a login.
- There is no migration `0018`. Onboarding state stays in `features`.

## Alternatives

- A new `onboarding_complete` column. Rejected. The flag is a boolean on a workspace that already has `features`, and a column would be a migration for one bit.
- Replacing `features` on every patch. Rejected. Enabling assist would wipe the onboarding flag and send the office back through setup.
- Treating an empty `features` object as a no-op. Rejected. The previous API, and the assist tests, send `{}` to turn every flag off. Leaving `ai_assist` on made accept and assist return 200 when the workspace flag was supposed to be off.
- Inserting the fixture COG from the seed with `app.imagery_admin`. Rejected. Migration `0003` already owns that global row, and the seed should not take the imagery-admin capability.
- A demo user with a password in git. Rejected. The repository is public.

## Consequences

- A workspace created before this slice has no `onboarding_complete` flag, so the next visit opens setup. Skip leaves the existing settings in place.
- The demo workspace cannot be signed into. It is data for a local database, not an account.
- `pnpm db:seed` does not upload the COG object. The e2e server and the imagery tests still put `imagery/fixtures/rgbir-cog.tif` in object storage.
- Dropbox Sign's `event_hash` still does not cover the webhook body. Enabling `DropboxSignProvider` stays behind the go-live gate in `STATUS.md`.

## References

- ADR 0005, ADR 0009, ADR 0011, ADR 0021
- `docs/specs/02-auth-workspaces.md`
- `db/seed/demo.json`
