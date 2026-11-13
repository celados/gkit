---
type: Evaluation
title: gkit Slice 5 evaluation baseline
description: >
  Reproducible 40-task routing, discovery, command, negative, migration, and
  curated-promotion result for the final vertical slice.
status: passed
version: 1.1
timestamp: 2026-07-14T14:16:06+08:00
resource: ../../../docs/plans/2026-07-13-gkit-vertical-slice-plan.md
---

# gkit Slice 5 evaluation baseline

## Result

`bun run --filter gkit eval:slice5` passed the committed answer keys and
observations:

| Metric                     |                                                Result |         Gate |
| -------------------------- | ----------------------------------------------------: | -----------: |
| Task distribution          | 10 explicit / 15 business / 10 long-tail / 5 negative |        exact |
| Provider top-1             |                                          100% (35/35) | at least 95% |
| Discovery within two steps |                                          100% (35/35) | at least 90% |
| First executable command   |                                          100% (33/33) | at least 90% |
| Negative precision         |                                            100% (5/5) | at least 95% |

Two positive tasks are inventory-only DataForSEO LLM Mention requests, so they
correctly have no executable-command denominator. All 33 executable positive
tasks reference a capability present in a reviewed manifest, match its provider
and effects, and contain an API-call command accepted by the current parser.

The observations are an implementation-agent contract review, not 40 blinded
model runs. They record the provider selection and command composed while each
prompt was reviewed against only the public gkit discovery surface. The checker
makes that result reproducible and prevents answer-key drift, but it does not
claim cross-model generalization; a future model comparison should append a
separate observation set rather than overwrite this baseline.

## Evidence boundary

Slice 5 performs discovery and contract dogfood without redispatching provider
requests. Exact request/effect/output/error/exit/artifact behavior for every
`replace` row is inherited from the committed Slice 1–4 live baselines and
their provider tests. This avoids new DataForSEO spend and avoids treating a
second network response as stronger evidence than the same-input goldens.

The observation set is committed in
[`slice5-observations.jsonl`](./slice5-observations.jsonl), and
[`src/eval.test.ts`](../src/eval.test.ts) keeps the thresholds in CI.

## Original evaluation decisions

- no built-in `gkit search`; two-step discovery is above the expansion gate;
- no curated promotion; no single typed workflow has three independent demand
  instances plus a demonstrated reduction in failure, context, or calls;
- keep `packages/gkit` in the workspace layout and keep it private/unpublished.

## Hard-cut override

After this evaluation, the sole consumer explicitly retired every old tool.
All former `keep` rows are now accepted `drop` decisions; 33 behaviorally
replaced commands continue through gkit and 41 unmatched old commands are no
longer available. All nine old package directories and the shared legacy
runtime were deleted. See the final matrix for the authoritative disposition.

See [`slice5-final-migration-matrix.md`](./slice5-final-migration-matrix.md) for
the complete disposition index.
