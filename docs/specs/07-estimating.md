# 07 — Estimating

Phase: MVP. Effort: 3 person-weeks (estimate). Depends on: 04 (quantities), 06 (recipes).

## Goal
Turn a takeoff into a priced estimate in minutes: quantities flow through recipes into line items, with markup, options and a margin view.

## User stories
- I create an estimate from a takeoff; each takeoff item with a linked recipe becomes a group of line items with computed qty and cost.
- I override a variable (depth 3in instead of 2in) per line and see totals update.
- I add manual lines (mobilization, traffic control, permit fee).
- I set markup and overhead at estimate or line level; I see cost, price, gross margin % and $.
- I mark lines/groups optional (alternates) for the client to choose.
- I re-sync quantities after the takeoff changes; I see a diff before applying.
- I duplicate an estimate as a new version.

## Screens
Estimate editor (groups by takeoff item/phase; columns: description, qty, unit, unit cost [cost-visible roles], unit price, total, margin; variable chips; source badge recipe/manual); Totals panel (cost, overhead, markup, tax, total, margin); Quantity sync diff modal; Versions list.

## API
| Method | Path |
|---|---|
| POST | /jobs/:id/estimates {fromTakeoffId?, templateId?} |
| GET/PATCH | /estimates/:id (markup, overhead, tax, notes) |
| POST | /estimates/:id/lines ; PATCH/DELETE /line-items/:id |
| POST | /estimates/:id/recalculate -> returns totals (server authoritative) |
| GET | /estimates/:id/quantity-diff ; POST /estimates/:id/apply-quantities |
| POST | /estimates/:id/versions (clone as n+1) |
| POST | /estimates/:id/transition {to} |

## Entities
Estimate, LineItem, CostRecipe, CatalogItem, Takeoff, Measurement, AuditLog.

## State machine — Estimate.status
`draft -> ready` (validation: no flagged lines, all recipes resolve) · `ready -> draft` · `ready -> sent` (proposal sent, 08) · `sent -> accepted` (signed) · `sent|ready -> superseded` (new version created). `snapshot` frozen on leaving draft.

## Pricing rules
- price = cost x (1 + overhead%) x (1 + markup%) unless line has explicit price.
- Tax applied per line by tax code (materials only by default; workspace setting).
- Rounding: per line to cents, totals = sum of rounded lines.
- Optional lines excluded from total, shown separately.

## Edge cases
- Takeoff item without recipe -> line with qty, price 0, flagged until priced.
- Takeoff versioned after estimate sent -> diff available only on a new estimate version.
- Negative manual lines (discount) allowed with permission.
- Mixed units (sum of area items in yd² for a sub quoting in ft²) -> conversions explicit in recipe.

## Acceptance criteria
- Estimate from a seeded takeoff produces line items whose totals match a hand-computed fixture to the cent (unit test).
- Changing a variable recalculates only affected lines; totals match fixture (test).
- Quantity diff lists added/removed/changed takeoff items with old/new qty (test).
- Office role never receives cost or margin fields (contract test).
- `ready` blocked when any line is flagged (409).

## Out of scope
Templates library beyond "clone estimate" (v1), vendor quote import, labor burden calculators, bid-day collaboration (Later).

## Buy vs build
Build (core).
