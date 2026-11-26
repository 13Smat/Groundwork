# ADR 0020: Proposal PDF templates and the Playwright worker

## Status

Accepted (2026-11-26).

## Context

Spec 08 part 1 turns a ready or sent estimate into a proposal PDF: a template, a builder, and a Playwright render. Sending and Dropbox Sign are the next slice. ADR 0003 already chose Dropbox Sign behind `SignatureProvider` and a fake for local and CI. This slice does not call Dropbox Sign and does not add a key.

ADR 0015 freezes `estimate.snapshot` when the estimate leaves draft, and that snapshot includes costs. ADR 0019 clones version n+1 instead of editing a ready or sent estimate. ADR 0017 renders a schematic site map with `renderSiteMap` and stamps the imagery provider, date, GSD, and attribution. It does not composite a COG.

pg-boss is already the queue. ADR 0005 starts it on the database owner connection because it migrates its own schema. That schema is `pgboss`. `groundwork_app` does not own it and does not have usage on it. This slice does not add a second queue.

Spec 01 sketches `proposal` and `signature` and does not sketch `proposal_template`, `public_token_hash`, or `selected_optional_line_ids`. Spec 08 has `/proposal-templates` and a public page for optional items. Those gaps were already in `docs/specs/OPEN-QUESTIONS.md`.

Migrations `0007`, `0008`, `0010`, and `0013` through `0015` are unused. The next migration is `0016`. The next ADR is `0020`.

## Decision

- `0016_proposals.sql` creates `proposal_template`, `proposal`, and `signature`. All three force row level security with `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Grants are to `groundwork_app` only. The trigger functions are `SECURITY INVOKER`. There is no `BYPASSRLS`.
- `proposal.number` uses the `P` counter. The first number in a workspace is `P-1001`.
- A proposal can be created only from a `ready` or `sent` estimate. It stores that estimate's version and a copy of the estimate view in `proposal.snapshot`. The snapshot is not updated later. One non-void proposal can pin an estimate. A second one is 409 until the first is voided, which this slice does not do.
- `ready -> draft` is 409 while any proposal row references that estimate. The message tells the caller to clone a version. `POST /estimates/:id/versions` still works. Line edits stay blocked because the estimate is not a draft.
- `public_token_hash` is the SHA-256 hex of 32 random bytes. The raw bytes are not stored, not returned, and not written to `audit_log`. The check constraint is 64 lowercase hex characters. Public proposal routes are not in this slice.
- `selected_optional_line_ids` lists optional lines from the pinned snapshot. The price table adds those lines to the client total. Unknown ids are 400.
- `Proposal.status` lives in `packages/shared`. `draft -> rendered -> sent -> viewed -> signed`. `sent` or `viewed` may become `declined` or `expired`. Any status other than `signed` may become `void`. The same change, and any other change, is 409. This slice only performs `draft -> rendered`.
- `packages/pdf-templates` is a React document: cover, scope grouped by line group, the site-map PNG, a price table, optional items, terms, a signature block, and a footer. The footer repeats each aerial credit (provider, name, capture date, GSD, attribution) and the sentence `Quantities measured from aerial imagery; field verify.` The price table has no cost and no margin.
- The site image is `renderSiteMap` from ADR 0017. The same credit is drawn in the PNG and written as text so a PDF text extract can see it. No COG is read and no paid map is called.
- `POST /proposals/:id/render` enqueues pg-boss queue `proposal.render`. The API process and `pnpm worker` both work that queue. The request waits until `pdf_file_id` is set, then returns it. Playwright Chromium prints the HTML. The PDF is stored with the existing S3 helper and a `file` row. `GET /proposals/:id/pdf` streams those bytes for the pdf.js preview.
- Other routes: `POST /estimates/:id/proposals`, `GET /estimates/:id/proposals`, `GET /jobs/:id/proposals`, `GET/PATCH /proposals/:id`, `GET/POST /proposal-templates`, `PATCH /proposal-templates/:id`. Mutations write `audit_log`. The diff omits cost, margin, and the token hash.
- Read is `proposal.read`, `proposal.send`, `estimate.read`, or `estimate.*`. Write is `proposal.send` or `estimate.*`. Office can read and cannot write. The PDF and the proposal JSON omit cost and margin for every role.
- The builder is opened from a ready or sent estimate. It picks a template, edits introduction, scope, terms, and optional lines, then renders. The preview is the stored PDF drawn with pdf.js.

## Alternatives

- A new queue beside pg-boss. Rejected. pg-boss is already installed, and its schema is already owned by the database owner.
- Store the raw public token. Rejected. The column is a hash. The public page that would show the token once is part 2.
- Render the PDF in the request without a job. Rejected. Spec 08 names a worker. The route enqueues `proposal.render` and waits for that job.
- Composite the aerial photo into the site map. Rejected for this slice. ADR 0017 already stamps attribution without reading a COG. The PDF repeats that stamp as text. A photo composite stays open.
- Put costs in the PDF for estimators. Rejected. The PDF is the client document. Cost stays on the estimate snapshot and is not copied into the proposal response or the HTML.

## Consequences

- Chromium runs in whichever process works `proposal.render`. This slice registers that worker in the API process and in `pnpm worker`. A cold browser is part of the first render. The 40-line test measures a warm browser and stays under 10 seconds.
- The pinned snapshot still holds costs in the database. `GET /proposals/:id` does not return them. A role with `catalog.manage` does not see them on the proposal either.
- `GET /proposals/:id/pdf`, `GET /estimates/:id/proposals`, and `GET /jobs/:id/proposals` are not in the spec 08 table. They are how the builder finds and previews a proposal. The spec files were not edited.
- Dropbox Sign, send, view, decline, expire, void, the public optional-item page, and the signed-proposal job transition are the next slice. `hasSignedProposal` stays false. No Dropbox Sign account, call, or key is added.
- The hash created at insert cannot be shown later. Part 2 can replace `public_token_hash` when it issues a public link. It still must not store the raw token.

## References

- `docs/specs/08-proposals-esign.md`
- `docs/specs/01-data-model.md`
- `docs/specs/OPEN-QUESTIONS.md`
- [ADR 0003](0003-dropbox-sign.md)
- [ADR 0005](0005-local-infra-and-rls.md)
- [ADR 0015](0015-estimating-engine.md)
- [ADR 0017](0017-takeoff-tools-export.md)
- [ADR 0019](0019-estimate-sync-and-versions.md)
