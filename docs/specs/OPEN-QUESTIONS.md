# Open questions

Known gaps between the specs. This file lists them. It does not answer them. A ticket that needs an answer flags it in the PR and waits for Andy. Do not edit `docs/specs/00` through `12` to paper over a gap.

## No spec for our own SaaS billing

`docs/specs/README.md` puts "MVP hardening, onboarding, billing for our own SaaS" in the module order (2 person-weeks, estimate) and gives it no spec file. How Groundwork charges a contractor, what a `workspace.plan` value means, and how `UsageEvent` turns into an invoice are unspecified.

## RLS `current_setting` needs `missing_ok` true and a `NULLIF`, and imagery tables have a nullable `workspace_id` policy

`docs/specs/00-architecture.md` and the sketch at the bottom of `docs/specs/01-data-model.md` write:

```sql
workspace_id = current_setting('app.workspace_id')::uuid
```

`current_setting` without a true `missing_ok` argument errors when the setting is absent, and a blank string is not a uuid. The sketch also has no `NULLIF`. `imagery_source` and `imagery_capture` allow a null `workspace_id` for public-program rows that every workspace may read, but the policy pattern is equality on `workspace_id` only. The policy that satisfies both the tenant rule and the global-row rule is not written.

## Mapping the Better Auth tables to the 01 `app_user` / `member` / `role` tables; the `citext` extension

ADR 0002 chooses Better Auth with the organizations plugin. `docs/specs/01-data-model.md` sketches `app_user`, `member`, and `role`, with `citext` on emails. The SQL sketch enables `postgis` and `pgcrypto` and does not enable `citext`. Which tables Better Auth owns, which tables Groundwork owns, and whether `citext` is created are unspecified.

## Tables missing from 01

`docs/specs/00-architecture.md` says human numbers (`J-1001` and the rest) come from a `counters` table. The entity list and the SQL sketch in `docs/specs/01-data-model.md` have no `counters` table.

The entity list names `File`. The SQL sketch has no `file` table.

`docs/specs/03-crm-jobs.md` has `GET/POST /jobs/:id/notes` and `/jobs/:id/tasks`. No `job_note` or `job_task` table is sketched.

`docs/specs/08-proposals-esign.md` has `/proposal-templates`. No `proposal_template` table is sketched.

`Photo` is marked v1 in the entity table, and the same row says "MVP: job photos via web upload". The MVP photo table is not sketched.

## `line_item` is missing columns spec 06 and spec 07 use

`docs/specs/06-catalog-cost-recipes.md` and `docs/specs/07-estimating.md` describe per-line variable overrides, line-level markup and overhead, a tax code, a recipe version, and a flagged line (a line that blocks `ready`). The `line_item` sketch in `docs/specs/01-data-model.md` has none of `variables`, `markup_pct`, `overhead_pct`, `tax_code`, `recipe_version`, or `flagged`.

## Proposal public token, selected options, and public endpoints

`docs/specs/08-proposals-esign.md` sends the client to a public signed URL to pick optional items before the PDF is sent for signature. The `proposal` sketch has no `public_token_hash` and no `selected_optional_line_ids`. The spec 08 route table has no unauthenticated public proposal endpoints.

## `cost_recipe` `output_unit` vs `input_unit`

The entity table in `docs/specs/01-data-model.md` says `CostRecipe` has `output_unit`. The SQL sketch says `input_unit text not null`. `docs/specs/06-catalog-cost-recipes.md` says the recipe declares an input unit. Which name is canonical is unspecified.

## Spec 07 `templateId` vs the v1 deferral

`POST /jobs/:id/estimates` in `docs/specs/07-estimating.md` accepts `templateId`. The same spec's out-of-scope line says a templates library beyond "clone estimate" is v1. Whether `templateId` exists at MVP is unspecified.

## Node 22 vs 24

`docs/specs/README.md` and `docs/specs/00-architecture.md` say Node 22. They do not discuss Node 24. ADR 0001 does not pick. Ticket 1 needs an explicit choice before it pins a runtime.

## Context basemap, and how the PNG export works for proposals

`docs/specs/04-map-takeoff-manual.md` forbids Google Maps Platform and Mapbox satellite as a measurement or AI input, and says a non-measurement context basemap is "OK only ... with attribution, if at all." Which basemap, if any, is not chosen.

`GET /takeoffs/:id/export?format=png` and the proposal site-map image in spec 08 are required. The spec does not say whether the PNG is rendered in the browser, by Playwright, or by TiTiler, or how the overlay is composed.
