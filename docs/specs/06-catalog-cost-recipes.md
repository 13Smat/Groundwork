# 06 — Catalog & cost recipes

Phase: MVP. Effort: 2.5 person-weeks (estimate). Depends on: 02.

## Goal
Contractors define what they buy and pay (materials, labor, equipment, subs) and recipes that turn a takeoff quantity into those costs, so estimates price themselves.

## Concepts
- TakeoffItem: what gets measured (area/length/count) e.g. "Asphalt surface 2in", "Sod", "Mulch bed", "Curb", "Tree 2in cal".
- CatalogItem: a priced unit of cost: material (ton, yd³, pallet, ea), labor (hr, crew-day), equipment (hr, day), sub (unit), fee.
- CostRecipe: maps one input quantity (+ variables) to components with formulas. Example (illustrative, user-entered values): Asphalt 2in -> asphalt tons = `area_ft2 * (depth_in/12) * density_lb_ft3 / 2000 * (1+waste)`; tack coat gal = `area_yd2 * rate`; paver crew hours = `area_yd2 / production_yd2_per_hr`.
- Variables: per-recipe defaults overridable per line item (depth, density, production rate, waste).

## User stories
- I create catalog items with unit and cost; import from CSV; bulk edit costs (spreadsheet grid).
- I build a recipe for a takeoff item with components and formulas, and preview the cost for a test quantity.
- I version a recipe when costs change; existing estimates keep their snapshot.
- I start from a starter pack (our own generic paving/landscape recipes, no competitor data) and edit.
- Office staff see sell prices but not costs (see 02).

## Screens
Catalog list (tabs by kind; grid edit; CSV import/export); Catalog item detail; Takeoff items list; Recipe builder (input unit, variables table, components table with formula editor + live preview, test quantity box); Price lists (Later).

## API
| Method | Path |
|---|---|
| GET/POST | /catalog-items ; PATCH/DELETE /catalog-items/:id ; POST /catalog-items/import (CSV) ; GET /catalog-items/export |
| GET/POST | /takeoff-items ; PATCH /takeoff-items/:id |
| GET/POST | /cost-recipes ; GET/PATCH /cost-recipes/:id ; POST /cost-recipes/:id/versions |
| POST | /cost-recipes/:id/preview {inputQty, inputUnit, variables} -> components with qty, cost |
| POST | /formula/validate {formula, variables[]} -> {ok, errors[], referencedVars[]} |

## Formula engine (packages/pricing)
- Pure TS, no `eval`. Grammar: numbers, variables, + - * / ^, parentheses, functions `ceil floor round min max if(cond,a,b)`, comparisons.
- Built-in variables from input: `qty`, `area_ft2`, `area_yd2`, `area_m2`, `length_ft`, `length_m`, `count`.
- Unit conversion table in packages/geo; recipe declares input unit; engine converts.
- Deterministic decimal math (decimal.js); round only at money output (cents, half-even).

## State machine — CostRecipe
`draft -> active -> archived`; editing an `active` recipe creates version n+1 as `draft`; activating it archives n. Estimates reference (recipe_id, version).

## Edge cases
- Formula references unknown variable -> validation error with position.
- Division by zero -> line flagged, cost 0, estimate cannot move to `ready`.
- Unit mismatch (recipe expects length, takeoff item is area) -> blocked at link time.
- CSV import with duplicate SKUs -> upsert by SKU with preview diff.
- Catalog item deleted while used -> archive only.

## Acceptance criteria
- Formula engine passes a table of ≥ 50 cases incl. precedence, functions, unit conversion, rounding (unit tests).
- Preview for a test recipe returns component quantities and costs identical to the estimate engine for the same inputs (shared code, test).
- Editing an active recipe never changes totals of an existing `ready`/`sent` estimate (e2e).
- CSV round-trip export->import produces no changes (test).
- Formula fuzz test: no input causes code execution or hang > 50 ms.

## Out of scope
Vendor price feeds, RFQs, inventory, assemblies of assemblies beyond 1 level (Later), price lists per client (Later).

## Buy vs build
Build. Small, core to differentiation; no good off-the-shelf fit.
