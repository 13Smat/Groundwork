# Groundwork

Groundwork is a clean-room field-service platform for paving and landscaping contractors. An estimator measures a site on license-cleared aerial imagery, prices the work from a catalog and cost recipes, sends a proposal for signature, and keeps the resulting job. It is modeled on the behavior of a competitor only. Competitor code, brand, copy, and assets do not belong in this repository.

## Phase plan

| Phase | Meaning |
|---|---|
| MVP | A contractor can measure a site, price it, send a signed proposal, and get a job record. |
| v1 | Run the job: scheduling, an offline crew app, invoicing and payments, QuickBooks, plan-set takeoff, and automatic detection. |
| Later | Symbol counting, service contracts, fleet, purchasing, submittals, roofing, and a partner API. |

Module order, the stack, and the builder rules are in [docs/specs/README.md](docs/specs/README.md).

## Run

Node 24 (see `.nvmrc`) and the pnpm version in `package.json` `packageManager`.

```bash
pnpm install
pnpm check
pnpm dev
```

`pnpm check` lints, typechecks, tests, and builds. `pnpm dev` starts the office app and the API. Postgres, object storage, and the Python services are not part of this slice.

## For agents

[AGENTS.md](AGENTS.md) is the standing rules file. Read it before changing the repo. Specs are in [docs/specs/](docs/specs/). Decisions are in [docs/adr/](docs/adr/). Current state is [STATUS.md](STATUS.md).

The workspace skeleton and CI are in place. Product modules are not built yet.

## License

Andy has not chosen a license. See [LICENSE-TBD.md](LICENSE-TBD.md).
