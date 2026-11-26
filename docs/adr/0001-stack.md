# ADR 0001: Clean-room stack, planned hosts, local Docker

## Status

Accepted (2026-11-26). The Node 22 versus 24 choice left open below is decided in ADR 0004.

## Context

`docs/specs/README.md` (checked 2026-11-25) records the build stack and leaves hosting open between Render, Fly, and AWS ECS, and between Neon and RDS. Auth and e-sign were also open there; those are ADR 0002 and ADR 0003.

Andy decided the hosts, with no accounts and no spend in this ticket. Local development and CI have to run without those hosts. Node 22 is what the specs write. Node 22 versus 24 was an open question and was not decided here. ADR 0004 decides it.

## Decision

- The application stack is the one in `docs/specs/README.md` and `docs/specs/00-architecture.md`: React 18, Vite, TypeScript, TanStack Router, TanStack Query, Tailwind, Radix; MapLibre GL JS, terra-draw, Turf.js; Fastify, zod, Kysely, pg-boss; Postgres 16 with PostGIS; self-hosted COGs served by TiTiler; a Python CV service; Playwright for HTML-to-PDF. Repo layout is pnpm workspaces plus Turborepo, as that README sketches. Ticket 1 creates the workspace. This ticket does not.
- Planned production hosts, none of them provisioned: Neon for Postgres, Cloudflare R2 for object storage, Fly or Render for containers, Modal for serverless GPU. Do not sign up, do not spend, and do not commit real keys.
- Local development and CI use Docker Postgres with PostGIS, and MinIO for S3-compatible storage. Dropbox Sign, Stripe, the CV service, the geocoder, and the parcel provider are fakes. A small fixture COG stands in for a county, as spec 00 and spec 04 require.
- This repository is a new codebase. Behavior is specified in `docs/specs/`. Competitor code, brand, copy, names, screenshots, and assets are not imported.

## Alternatives

- AWS ECS and RDS, which the specs left open. Rejected for the plan. Andy named Neon, R2, Fly or Render, and Modal.
- Signing up for the planned hosts during Ticket 0 so later tickets have credentials. Rejected. The repo is public, and the hosts are planned only.
- Pinning Node 24 because another repo of Andy's uses it. Rejected for Ticket 0. The specs say Node 22, and `docs/specs/OPEN-QUESTIONS.md` left 22 versus 24 open. ADR 0004 accepts Node 24.

## Consequences

- Ticket 1's `pnpm dev` and CI talk to Docker and fakes. They do not talk to Neon, R2, Fly, Render, or Modal.
- Fly versus Render stays unresolved. Either container host is allowed. Picking one needs its own ADR when someone is ready to provision it.
- Versions in the specs are the specs' claims as of 2026-11-25. A later ticket verifies a version against current docs before locking a package manager pin. This ADR does not add a pin.
- Python stays limited to the areas spec 00 names (segmentation, raster, imagery ingest, TiTiler, later plan-set raster). The API, pricing engine, and PDF templates stay TypeScript.

## References

- `docs/specs/README.md` (Stack, Repo layout, Rules for the builder)
- `docs/specs/00-architecture.md` (Environments, Where Python is warranted)
- `docs/specs/OPEN-QUESTIONS.md` (Node 22 vs 24)
- `docs/adr/0002-better-auth.md`
- `docs/adr/0003-dropbox-sign.md`
