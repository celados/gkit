---
type: Reference
title: Slice 5 final migration matrix
description: >
  Final hard-cut disposition for every former CLI package after the sole
  consumer explicitly retired all legacy tools.
status: active
version: 1.1
timestamp: 2026-07-14T14:16:06+08:00
resource: ../../../docs/plans/2026-07-13-gkit-vertical-slice-plan.md
---

# Slice 5 final migration matrix

## Final override

On 2026-07-14 the sole CLI consumer explicitly chose a hard cutover: delete
every old tool and accept the loss of workflows that do not have a reviewed
gkit replacement. This supersedes every `keep` row in the Slice 2–4 matrices.

The historical matrices remain evidence of what was and was not behaviorally
replaced. Their final transformation is deterministic:

- historical `replace` remains `replace` and routes to its recorded gkit
  capability;
- historical `keep` becomes `drop` by explicit consumer decision;
- historical `drop` remains `drop`;
- no compatibility alias, deprecation binary, or fallback package remains.

## Provider packages

| Deleted package                 | Replace | Final drop | Evidence                                                             |
| ------------------------------- | ------: | ---------: | -------------------------------------------------------------------- |
| `@deniffer/backlink-cli`        |       3 |          4 | [`dataforseo-migration-matrix.md`](./dataforseo-migration-matrix.md) |
| `@deniffer/serp-snapshot-cli`   |       2 |          1 | [`dataforseo-migration-matrix.md`](./dataforseo-migration-matrix.md) |
| `@deniffer/ai-optimization-cli` |       1 |          9 | [`dataforseo-migration-matrix.md`](./dataforseo-migration-matrix.md) |
| `@deniffer/posthog-cli`         |       1 |         12 | [`posthog-migration-matrix.md`](./posthog-migration-matrix.md)       |
| `@deniffer/google-ads-cli`      |       4 |          6 | [`google-ads-migration-matrix.md`](./google-ads-migration-matrix.md) |
| `@deniffer/gsc-cli`             |       5 |          4 | [`gsc-migration-matrix.md`](./gsc-migration-matrix.md)               |
| `@deniffer/bing-webmaster-cli`  |      17 |          1 | [`bing-migration-matrix.md`](./bing-migration-matrix.md)             |
| **Provider total**              |  **33** |     **37** | all seven packages deleted                                           |

## Non-provider tools

| Deleted command                              | Final decision | Consequence accepted by sole consumer                                        |
| -------------------------------------------- | -------------- | ---------------------------------------------------------------------------- |
| `page-extract page entity extract`           | drop           | normalized ctx-backed SEO/GEO artifact removed; use ctx directly when needed |
| `sitemap-watch registry dataset competitors` | drop           | local competitor registry command removed                                    |
| `sitemap-watch snapshot dataset pages`       | drop           | recursive normalized sitemap snapshot command removed                        |
| `sitemap-watch snapshot entity page`         | drop           | single-page snapshot selection removed                                       |

Final old-command total: **33 replace / 41 drop**. The repository now contains
only `packages/gkit`; the private gkit package stays in the workspace layout.

## Curated-promotion audit

No curated command is promoted. Removing legacy typed workflows does not count
as demand evidence and does not lower the existing three-independent-uses
promotion threshold.
