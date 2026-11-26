# Status

Ticket 0 (agent rules and preferences) is the first project content. Owner: Andy Silver. No application code yet.

`main` already had commit `c3a7059` (`# Groundwork` only), so this work is a draft PR onto that commit. Nothing was pushed straight to `main`.

## Done

- `AGENTS.md` holds the standing process, security, accessibility, clean-room, and domain rules.
- Stack, Better Auth, and Dropbox Sign are recorded in ADR 0001, ADR 0002, and ADR 0003. Hosts (Neon, R2, Fly or Render, Modal) are planned only. No accounts, no spend, no keys.
- Build specs `docs/specs/README.md` and `00` through `12` are copied verbatim. Known gaps are listed in `docs/specs/OPEN-QUESTIONS.md` and are not resolved.
- `STATUS.md`, `CHANGELOG.md`, the ADR template, the handoff template, `.gitignore`, `.editorconfig`, `.env.example`, and `LICENSE-TBD.md` are in place.

## Not in this slice

- `package.json`, workspaces, CI, Docker, and any application or service code. That is Ticket 1.
- Choosing a license. `LICENSE-TBD.md` says so.
- Choosing between Fly and Render. Both are allowed; neither is provisioned.
- Resolving the gaps in `docs/specs/OPEN-QUESTIONS.md`.
- Sign-ups or spend for Neon, R2, Fly, Render, Modal, Dropbox Sign, Stripe, or any parcel, geocoder, or imagery vendor.

## Open questions

See `docs/specs/OPEN-QUESTIONS.md`. Do not answer them in a drive-by.
