# ADR 0019: Estimate quantity sync and versions

## Status

Accepted (2026-11-26).

## Context

Spec 07 part 2 asks for a quantity diff, applying that diff, and cloning an estimate as version n+1. ADR 0015 already stores `estimate.takeoff_id`, `estimate.version`, and `line_item.input_qty`. ADR 0013 clones a new takeoff row on `final -> draft` and leaves the priced row in place. The spec does not say which unit the diff uses, whether a draft is superseded when it is cloned, or how a partial apply chooses rows. Migration `0013` and ADR 0017 belong to the map takeoff follow-up. Migration `0014` and ADR 0018 belong to the AI assist follow-up. This slice does not add a table.

## Decision

- No new migration. Diff and versioning use `estimate`, `line_item`, and the takeoff lineage from `0009`.
- `GET /estimates/:id/quantity-diff` compares takeoff-item quantities. The old quantity is the line `input_qty`, converted into the takeoff item's default unit. The new quantity is the sum of measurements on the newest row in that takeoff's lineage, converted the same way. Rows are `added`, `removed`, or `changed`. A draft with no difference returns an empty list. A non-draft returns 409. The detail says to clone a version first.
- `POST /estimates/:id/apply-quantities` accepts optional `takeoff_item_ids`. Omitted means every current row. An id that is not in the diff is 400. Removed items delete their recipe lines. Changed items update `input_qty` and `measurement_ids` on those lines and reprice them from the pinned component. Added items are generated from the active recipe and appended. Other lines are not rewritten. Totals are then summed from every line. When anything is applied, `estimate.takeoff_id` moves to the lineage head the diff read. A non-draft returns 409.
- `POST /estimates/:id/versions` inserts the same number at `max(version) + 1` as a draft and copies the lines. `ready` and `sent` become `superseded`. A draft stays a draft. `accepted` and `superseded` stay as they are, because those transitions are not in the state machine. The new draft has no snapshot. The prior snapshot is not rewritten.
- `GET /jobs/:id/estimates` lists the job's estimates without cost or margin fields. The editor and the job page need that list. The spec table does not name it.
- The editor groups lines by `group`. Generation already sets that to the takeoff item name. There is no phase column.
- Roles without `catalog.manage` still do not receive cost or margin. The diff has neither. Office can read and cannot write.
- Apply and version writes `audit_log` on `estimate`. The diff omits cost and margin. A supersede also writes the existing transition audit.

## Alternatives

- Add migration `0015` for a stored diff or a phase column. Rejected. The quantities are already on the lines and the measurements. A phase column would invent a field the spec does not define.
- Point the diff at `estimate.takeoff_id` only. Rejected. ADR 0013 keeps the old row when a final takeoff is reopened, and the ticket asks for the newer version in the lineage.
- Return a diff for a ready or sent estimate and refuse only apply. Rejected. Spec 07 says a takeoff versioned after send is diffed on a new estimate version.
- Supersede a draft when it is cloned. Rejected. The state machine has no `draft -> superseded` transition.
- Supersede `accepted`. Rejected. The state machine does not allow it. A signed estimate stays the accepted row. Spec 08 owns the signature.

## Consequences

- A partial apply can leave the estimate pointing at a takeoff version while some lines still have the previous quantity. The next diff lists what is left.
- A price override stays the line amount when a quantity changes, the same way recalculate already does.
- Two drafts of one number can exist. Ready and sent cannot.
- The office catalog screen is unchanged. Recipe variable names on a line are not costs.

## References

- `docs/specs/07-estimating.md`
- [ADR 0013](0013-takeoff-measurements.md)
- [ADR 0015](0015-estimating-engine.md)
