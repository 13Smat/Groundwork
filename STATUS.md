# Status

Catalog and cost recipes (spec 06, part 1) is the current slice. Owner: Andy Silver. The agent opens a draft PR and does not merge.

## Done

- Ticket 0 through Ticket 2 are on main (`dabcba3`): agent rules, the monorepo, CI, Postgres/PostGIS, MinIO, the `groundwork_app` role, `withWorkspaceContext`, and the office shell. ADR 0001 through ADR 0005.
- Imagery registry and TiTiler are on main (`2fe041f`). Migration `0003_imagery.sql`. ADR 0006.
- Auth and workspaces are on main (`1af0406`). Migration `0002_auth_workspaces.sql`. ADR 0007. `catalog.manage` is already on owner, admin, and estimator. Office does not have it.
- Migration `0006_catalog_recipes.sql` adds `takeoff_item`, `catalog_item`, `cost_recipe`, and `recipe_component`. Row level security is forced with `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Grants are to `groundwork_app` only. ADR 0008.
- `packages/pricing` evaluates recipe formulas with a recursive-descent parser and `decimal.js`. There is no `eval`. Unit factors are exact ratios in `packages/geo`. Money rounds half-even to cents in `previewRecipe`, which the estimate engine will call later.
- Cost recipe transitions live in `packages/shared`. `draft -> active -> archived`. Editing an active recipe creates version n+1 as a draft. Activating it archives the previous active version. Illegal transitions return 409.
- `/catalog-items` (including CSV import and export), `/takeoff-items`, `/cost-recipes` (versions and preview), and `POST /formula/validate` use the session and membership guard. A recipe linked to a takeoff item of a different measure kind returns 409. A referenced catalog item is archived instead of deleted. Responses for roles without `catalog.manage` omit `unit_cost_cents` and preview costs.

## Not in this slice

- TODO: `takeoff_item` has no foreign key to `job` or `location`. CRM lands those tables in its own migration. Do not add the key in `0006`.
- The office catalog screen. It is still the placeholder.
- Estimate snapshots. Spec 07 must call `previewRecipe` so a saved total matches the preview. This slice does not create estimates, so it cannot prove that editing a recipe leaves a `ready` or `sent` estimate unchanged.
- Assemblies of assemblies, price lists, vendor feeds, and the spreadsheet grid.
- `output_unit`. The column is `input_unit`. The entity table still says `output_unit`. See `docs/specs/OPEN-QUESTIONS.md`.
- Sentry. Choosing a license. Choosing between Fly and Render.
- The remaining gaps in `docs/specs/OPEN-QUESTIONS.md`.
- Sign-ups or spend. No hosted secrets in git.

## Open questions

See `docs/specs/OPEN-QUESTIONS.md`. Do not answer the unresolved lines in a drive-by.
