# ADR 0010: Catalog, cost recipes, and the formula engine

## Status

Accepted (2026-11-26).

## Context

Spec 06 needs catalog items, takeoff items, and versioned cost recipes. The formula engine has to be pure TypeScript. Spec 01 sketches the tables without a recipe status, without a way to group versions, and without a sell price. Spec 02 and spec 06 both say office staff see prices and not costs. `GET /catalog-items` was a fixture row until this slice (ADR 0007).

`workspace.id` is text. These tables use uuid primary keys, matching the spec 01 sketch and the imagery tables. Job and location are spec 03 and are not migrated here.

## Decision

- Migration `0006_catalog_recipes.sql` creates `takeoff_item`, `catalog_item`, `cost_recipe`, and `recipe_component`. Each forces row level security with `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Grants are to `groundwork_app` only. There is no foreign key to `workspace`, `job`, or `location`.
- `cost_recipe.status` is `draft`, `active`, or `archived`. `family_id` groups versions. Editing an active recipe inserts version n+1 as `draft`. Activating that draft archives the previous active row in the family. Illegal transitions return 409. The machine lives in `packages/shared/src/state/recipe.ts`.
- The column is `input_unit`, which is what the SQL sketch and spec 06 name. `output_unit` in the entity table stays an open question.
- `catalog_item.unit_price_cents` is the sell price. Roles without `catalog.manage` do not receive `unit_cost_cents`, and a recipe preview does not receive `cost_cents` or `total_cost_cents`. `catalog.manage` is already on owner, admin, and estimator in `0002`. This migration does not change those rows.
- CSV import and export use the header `sku,kind,name,unit,unit_cost_cents,unit_price_cents,waste_pct,vendor,tax_code`. Import upserts by SKU. `apply: false` returns the diff and writes nothing.
- `packages/pricing` parses and evaluates formulas with a recursive descent parser and `decimal.js`. It does not call `eval` or `Function`. `^` is right-associative and binds tighter than unary minus. `if` evaluates only the chosen branch. Half-even rounding happens in the `round` function and when a component cost becomes integer cents. Unit factors live in `packages/geo` as exact integer ratios. The international foot is 0.3048 m.
- JSON fields are snake_case, matching the rest of the API. The spec table writes `inputQty` and `referencedVars`.
- Deleting a catalog item that a recipe component references sets `archived_at` and keeps the row. An unreferenced item is deleted.
- Preview and, later, estimate totals both call `previewRecipe`.

## Alternatives

- Store formulas and `eval` them. Rejected. The spec forbids `eval`, and a fuzz test has to finish in 50 ms without running caller code.
- Put the new policies back into `0001`. Rejected. That migration has shipped. `0003` already added its own policies.
- Foreign-key `workspace_id` to `workspace.id`. Rejected. One side is uuid and the other is text. RLS is the tenant boundary, as it is for imagery.
- Foreign-key `takeoff_item` to `job` or `location`. Rejected. Those tables are not in this slice.
- A second price table. Rejected. Spec 02's cost-visibility check is a field on the catalog response.

## Consequences

- A later CRM migration can add the job and location link. It is a TODO in `STATUS.md`. Do not add it in `0006`.
- Estimates must call `previewRecipe` so a saved total matches the preview. Spec 07 owns that call.
- `output_unit` is still open. This slice did not add the column.
- The office catalog screen is still the placeholder. This slice is the API.

## References

- `docs/specs/06-catalog-cost-recipes.md`
- `docs/specs/01-data-model.md`
- `docs/specs/02-auth-workspaces.md`
- `docs/adr/0007-auth-workspaces.md`
- `docs/specs/OPEN-QUESTIONS.md`
