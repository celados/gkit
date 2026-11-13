---
type: Evaluation
title: gkit Slice 1 Immediate Dogfood Baseline
description: >
  Redacted evidence from the 2026-07-14 execution of both Slice 1 executable
  tasks and both zero-dispatch negative tasks.
status: passed
version: 1.0
timestamp: 2026-07-14T10:38:32+08:00
resource: ./tasks.jsonl
---

# gkit Slice 1 Immediate Dogfood Baseline

## Verdict

**PASS.** All four Slice 1 answer-key tasks passed in one immediate, serial
dogfood run. The two paid calls succeeded on their first dispatch; the two
negative tasks made no provider calls and added no ledger attempts.

## Results

| Task                            | Kind              | Discovery | Provider calls | Result                                           |        Cost |
| ------------------------------- | ----------------- | --------: | -------------: | ------------------------------------------------ | ----------: |
| `no_spend_negative`             | negative          |    1 step |              0 | discovery only; safely blocked                   |        `$0` |
| `unsupported_mutation_negative` | negative          |    1 step |              0 | exit 1, `CAPABILITY_NOT_FOUND`, `not_dispatched` |        `$0` |
| `dfs_bulk_ranks_explicit`       | explicit provider |    1 step |              1 | first live attempt succeeded                     | `$0.024072` |
| `compare_domain_authority_goal` | business goal     |   2 steps |              1 | first live attempt succeeded                     | `$0.024108` |

Authorized exposure and actual cost were both `$0.048180`, below the `$0.15`
gate cap.

## Provider facts captured

The timestamped raw artifacts reported:

- `clonesite.ai`: rank `9`;
- `example.com`: rank `90`;
- `lovable.dev`: rank `73`;
- `bolt.new`: rank `61`.

These values are provider observations from this run, not durable product
claims.

## Spend and artifact evidence

- Explicit task attempt: `f1f45196-2178-46c8-a568-ee26d6633ef8`, durable
  `authorized(24072 micros) → settled(confirmed_charged, 24072 micros)`.
- Business-goal attempt: `9039cd5c-659c-4b87-a5db-a5c4f7087617`, durable
  `authorized(24108 micros) → settled(confirmed_charged, 24108 micros)`.
- Ledger ended at 5 total attempts, `unresolved=0`,
  `activePolicyBreaches=0`.
- Both artifacts and both request files were mode `0600` under
  `~/.local/state/gkit/dogfood/`.
- Local `events.jsonl` and sanitized `receipts.jsonl` were mode `0600`; the
  latter records the negative exit/error codes and dry-run/live receipts
  without raw argv, response bodies, or provider credentials.
- Explicit artifact: 1,372 bytes, SHA-256
  `a39921fb7cb06655b217dab278c13115b02d3ec71c79351534b52697696944c5`.
- Business-goal artifact: 1,551 bytes, SHA-256
  `83aa4a9aabbaeb3e56fc660a94da5ea2aafbaa49c933332afdc7697eb11e65d7`.
- Two artifacts plus the ledger were scanned against 13 resolved and derived
  credential forms; no match was found.
- No retry, fallback, `--force`, duplicate dispatch, unknown outcome, or policy
  breach occurred.

Raw requests, events, artifacts, provider responses, and credentials remain
local-only and are not part of this baseline.

## Observed friction

The linked provider command still requires explicit host-side secret injection:

```bash
bun --env-file="$HOME/.config/gkit/profiles/clonesite.ai/.env" \
  gkit --profile clonesite.ai dataforseo ...
```

This matched the current profile contract and caused no failed provider call.
The business-goal task reached the capability through `docs → describe` in the
two-step discovery target.

This friction was resolved after the baseline: current credentialed execution
loads the selected profile's optional adjacent `.env`, so the direct
`gkit --profile ...` invocation no longer needs the external Bun wrapper.

## Next decision

Slice 1 is complete. Proceed to the Slice 2 DataForSEO reviewed-manifest
expansion. This baseline does not authorize deleting any legacy package; each
workflow still requires its own behavior golden and real-call replacement gate.
