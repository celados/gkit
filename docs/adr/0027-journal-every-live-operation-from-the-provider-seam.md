---
type: ADR
status: accepted
---

# Journal every live Operation from the Provider Module seam

The Operation Journal (`operations.jsonl`, ADR-0015) now records every live Growth Operation for every provider and effect, and the DataForSEO-only spend ledger is removed. An Operation enters the Journal with one `attempt_started` event written immediately before the Provider Module receives control (ADR-0009), settles with `attempt_settled`, and links its published Evidence with `artifact_recorded`. Spend is not a separate store: a spend capability's `attempt_started` carries the reviewed spend authorization, and every settlement of that Operation carries its spend facts, because the authorization and settlement are created, settled, and reconciled together with the Operation. Spend blockers, Operation State (`unknown`, `not_dispatched`, `succeeded`, `failed`), and `succeeded`-requires-Evidence (ADR-0012) are projections over these events, never stored statuses.

This supersedes the start point of ADR-0003 and the vocabulary of ADR-0014. Calls that fail syntax, validation, profile, effect, or credential checks, and dry-runs, have no provider effect and are not journaled. A settlement whose provider result or spend amount is unknown stays open and changes only through an evidence-backed manual reconciliation of that same Operation (ADR-0013); a confirmed provider result is never changed. `--capability-id` now selects the capability and `meta.operationId` carries the runtime identity, completing ADR-0008. No migration reads the removed `ledger.jsonl`; no host had one when this landed.
