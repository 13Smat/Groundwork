# ADR 0011: Clean-room catalog starter pack

## Status

Accepted (2026-11-26).

## Context

Spec 06 says a contractor can start from a starter pack of generic paving and landscaping recipes and then edit it. The pack has to be our own data. Catalog rows need a workspace, and migration `0006` has already shipped. CRM's migration `0005` is still in flight on another branch.

## Decision

- The pack is `db/seed/starter-pack.json`. Names, prices, colors, and formulas were written for Groundwork. Formulas are area, length, and count geometry: cubic volume from depth, tons from pounds, cubic yards from cubic feet. Defaults such as `depth_in`, `density_lb_ft3`, and `waste_pct` are round numbers chosen for this file.
- `POST /catalog-items/starter-pack` inserts the pack into the caller's workspace. The caller needs `catalog.manage`. A second call skips a catalog SKU, a takeoff name, or a recipe name that is already present. It does not overwrite those rows.
- Inserted recipes are version 1 drafts. Activating one uses the existing recipe route. The pack does not mark a recipe active.
- There is no new migration. The JSON is read from the repo tree at runtime.

## Alternatives

- Insert the rows from a SQL migration. Rejected. Migrate runs before any workspace exists, and a shipped migration cannot be edited to add tenant rows later.
- Upsert starter prices over matching SKUs. Rejected. Loading the pack again would undo edits the workspace had saved.
- Ship a copied starter library. Rejected. The clean-room rule forbids competitor catalog data.

## Consequences

- A recipe that was renamed is inserted again on the next load, because the match is the name.
- The recipe variable `waste_pct` is what those formulas read. `catalog_item.waste_pct` stays a stored field and is not an input to these formulas.
- Office staff cannot load the pack. The route returns 403 without `catalog.manage`.
- Deployments need the `db/seed` file next to the API source or build. This slice does not embed the JSON in the compiled output.

## References

- `docs/specs/06-catalog-cost-recipes.md`
- `docs/adr/0010-catalog-recipes.md`
- `db/seed/starter-pack.json`
