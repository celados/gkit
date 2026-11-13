---
type: Evaluation
title: gkit Slice 2 DataForSEO Baseline
description: >
  Redacted generator, contract, dry-run, live-call, ledger, and artifact evidence
  for the reviewed DataForSEO Slice 2 surface.
status: passed
version: 1.0
timestamp: 2026-07-14T13:56:00+08:00
resource: ./tasks.jsonl
---

# gkit Slice 2 DataForSEO Baseline

## Verdict

**PASS.** The pinned OpenAPI generator is byte-stable, four operations are
executable from one generated manifest, and all three new operations passed
same-input dry-run and one-attempt live gates. The ledger ended with no
unresolved spend or policy breach.

LLM Mentions remains inventory-only: its reviewed `$0.10` request floor exceeds
the active profile hard cap of `$0.03` per call.

## Generated surface

- Pinned upstream revision: `2d905ad34863444e2f1eb4272f8c9569032e4628`.
- Pinned SHA-256:
  `c73904b057e143acf571bf681a53131e429218169d9bf2c79a2ca026e0678235`.
- Inventory: 554 OpenAPI operations, four executable, 550 inventory-only.
- Executable capabilities: Bulk Ranks, Backlink Summary, Referring Domains,
  and Google Organic Live Advanced.
- `generate:dataforseo:check` passed with byte-identical manifest, inventory,
  and docs output.

## Live gates

| Capability                                     | Requested bound | Actual cost | Provider result                   | Artifact                                                                                 |
| ---------------------------------------------- | --------------: | ----------: | --------------------------------- | ---------------------------------------------------------------------------------------- |
| `dataforseo.backlinks.summary.live`            |     `$0.024036` | `$0.024036` | one summary result                | 2,846 bytes, SHA-256 `061c05629f2a5857e52899caf9c96c8b029598990274116a4ae4bd4253564463`  |
| `dataforseo.backlinks.referring_domains.live`  |     `$0.024072` | `$0.024036` | requested limit 2, returned 1 row | 2,921 bytes, SHA-256 `d1e83a6f24b9bfdb4f36b6398ecdbe960a58c45337e47c5f0dc4f451d19d223b`  |
| `dataforseo.serp.google.organic.live.advanced` |     `$0.002000` | `$0.002000` | one page, 11 SERP elements        | 25,043 bytes, SHA-256 `f557cc9f963a888d47f8d4ac333fef873ed71f955290f90f9f06227aba26e6cb` |

Actual Slice 2 live cost was `$0.050072`, below the `$0.050108` aggregate
authorization bound. Every call succeeded on its first dispatch.

The SERP result contained 11 items with `depth=10`; this is valid because the
depth bounds organic results while the returned item array also contains SERP
features.

## Durable evidence

- Summary attempt: `c591bcf3-9cb8-41e5-b601-721fa8f6717a`.
- Referring-domains attempt: `18c686ed-d28b-4db2-a2fe-e59c05e8937b`.
- SERP attempt: `4e31c68c-6c87-41d9-ab33-e876981cbe05`.
- Ledger ended at eight total attempts, `unresolved=0`,
  `recordedPolicyBreaches=0`, and `activePolicyBreaches=0`.
- Artifacts remain mode-protected and local-only under
  `~/.local/state/gkit/dogfood/`; raw provider responses and credentials are not
  committed.

## Verification

- gkit package: 12 test files, 92 tests passed before live execution.
- Each new adapter has endpoint routing and provider-result contract tests.
- Root schema remained below 2,000 bytes and describes four executable
  operations without embedding their provider schemas.
- LLM Mentions returned `CAPABILITY_NOT_FOUND`, and a SERP input containing
  `site:` returned `INVALID_INPUT`; both had `outcome=not_dispatched`, no
  attempt ID, and left the ledger at eight attempts.
- Full workspace regression: 55 test files and 228 tests passed; all ten
  workspace package typechecks passed.
