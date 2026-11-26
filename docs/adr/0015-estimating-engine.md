# ADR 0015: Takeoff-to-estimate engine

## Status

Accepted (2026-11-26).

## Context

Spec 07 part 1 turns a takeoff into an estimate: recipe lines, variable overrides, markup, overhead, tax, and a snapshot when the estimate leaves draft. Spec 01 sketches `estimate` and `line_item` without the columns spec 07 uses. ADR 0010 says a saved total has to match `previewRecipe`. ADR 0013 clones a new takeoff row on `final -> draft`, so an estimate has to point at one `takeoff.id`.

Migration `0010` is reserved for the map takeoff follow-up. ADR 0012 and ADR 0014 are unused. This slice is migration `0011` and ADR 0015.

## Decision

- `0011_estimating.sql` creates `estimate` and `line_item`. Both force row level security with `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Grants are to `groundwork_app` only. The trigger functions are `SECURITY INVOKER`. There is no `BYPASSRLS`.
- `estimate.takeoff_id` references `takeoff.id`. Generation reads active recipes for the takeoff items on that row. Each line stores `recipe_id`, `recipe_version`, and `recipe_component_id`. A later active version does not change a line. Recalculate re-reads the pinned component and the current catalog `unit_cost_cents`.
- `estimate.number` uses the `E` counter. The first number in a workspace is `E-1001`. `version` stays 1. Quantity diff and estimate versions are spec 07 part 2.
- `markup_pct` and `overhead_pct` are percents (`numeric(6,2)`, at least -100). `tax_rate` is a fraction (`numeric(6,4)`, 0 through 1). A line is taxed when its tax code matches `material` or `materials`. A blank catalog tax code becomes `materials` for a material item and the kind otherwise. A manual line with no tax code is not taxed.
- Price is `cost * (1 + overhead) * (1 + markup)` unless the line has an explicit price. Each line rounds half-even to integer cents, then the totals add those cents. Optional lines stay out of `subtotal_cents`, `tax_cents`, `total_cents`, cost, and margin. They are reported as `optional_*`.
- `line_item.qty` is `numeric(14,4)`. The formula quantity can need more places, so `input_qty` is text and a recalculation uses it. `price_cents` is the line amount. `unit_price_cents` is derived from the stored quantity.
- `line_item.variables` stores overrides only. The effective map is the recipe variables with the line overrides on top. A variable patch reprices that line. Recalculate reprices every line and skips the update when the money did not change.
- An item with no usable recipe, or a formula `previewRecipe` flags, becomes one flagged line at price 0. `draft -> ready` is 409 while any line is flagged or its recipe did not resolve. The client cannot set `flagged` directly.
- `estimate.status` is `draft -> ready -> sent -> accepted`, `ready -> draft`, and `ready|sent -> superseded`. Leaving draft writes `snapshot` jsonb (the view, including costs). Later statuses do not rewrite it. `ready -> draft` clears it. `GET` of a non-draft estimate returns the snapshot, then overlays the row status and `updated_at`. Triggers reject illegal transitions, a snapshot edit while frozen, and line edits outside draft. The database owner skips those checks so fixtures can be cleaned up. `groundwork_app` does not.
- `POST /jobs/:id/estimates` with `template_id` is 400. Templates are not in this slice.
- A negative quantity, unit cost, unit price, or price needs `catalog.manage`. No new permission token. Roles without `catalog.manage` do not receive `unit_cost_cents`, `cost_cents`, `margin_cents`, or `margin_pct`. Office has `estimate.read` and not `estimate.*`, so office cannot write.
- Mutations write `audit_log` with `entity_type` `estimate` or `line_item`. The diff omits cost and margin. `GET /jobs/:id/activity` still reads job rows only.
- JSON is snake_case. The group column is `grp` because `group` is reserved in SQL. The response field is `group`.

## Alternatives

- Point the estimate at `takeoff.lineage_id`. Rejected. ADR 0013 keeps the old row when a final takeoff is reopened, and the priced version is that row's id.
- Follow the newest active recipe on recalculate. Rejected. ADR 0010 versions a recipe by inserting a draft. An estimate that moved with the newest version would change a draft the user had not edited.
- Store the formula quantity in `numeric(14,4)` and recompute from it. Rejected. Half-even to four places does not round-trip the formula input, so a later recalculation would drift.
- Add a discount permission. Rejected. The ticket says to use `catalog.manage` and not invent a token.
- Accept `template_id` as a clone. Rejected. The spec defers a template library to v1 and does not say what the id loads. This slice returns 400.

## Consequences

- A ready or sent estimate stays at the cents it had when it left draft, including after a recipe edit or a catalog cost change. A new estimate from the same takeoff uses the active recipe and the current cost.
- Quantity sync, estimate versions, and the proposal signature are still spec 07 part 2 and spec 08. `accepted` does not require a signature.
- Columns beyond the spec 01 sketch are listed in `docs/specs/OPEN-QUESTIONS.md`. The spec files were not edited.

## References

- `docs/specs/07-estimating.md`
- `docs/specs/01-data-model.md`
- [ADR 0010](0010-catalog-recipes.md)
- [ADR 0013](0013-takeoff-measurements.md)
