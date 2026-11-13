---
type: Reference
title: DataForSEO legacy CLI migration matrix
description: >
  Command-level replace, keep, and drop decisions after the gkit Slice 2 live
  gates, used to prevent package-level retirement without behavior evidence.
status: superseded
version: 1.0
timestamp: 2026-07-14T13:56:00+08:00
resource: ../../../docs/plans/2026-07-13-gkit-vertical-slice-plan.md
---

# DataForSEO legacy CLI migration matrix

> Historical Slice 2 evidence. The final hard-cut decision in
> [`slice5-final-migration-matrix.md`](./slice5-final-migration-matrix.md)
> converts every `keep` row to `drop`; all three packages have been deleted.

## Decision rule

`replace` means gkit has a reviewed manifest record, compatible provider
request behavior, provider-native result validation, a dry-run cost bound, and
a successful live gate. `keep` means at least one of those facts is still
missing. No command is dropped in Slice 2.

## `@deniffer/backlink-cli`

| Legacy command                    | Decision | gkit target or missing gate                                                     |
| --------------------------------- | -------- | ------------------------------------------------------------------------------- |
| `doctor dataset readiness`        | replace  | `gkit --profile <app> dataforseo doctor`                                        |
| `domain dataset summary`          | replace  | `dataforseo.backlinks.summary.live`; domain live gate passed                    |
| `domain dataset referringDomains` | replace  | `dataforseo.backlinks.referring_domains.live`; limit/order live gate passed     |
| `domain dataset anchors`          | keep     | no reviewed executable manifest record                                          |
| `page dataset summary`            | keep     | endpoint is exposed, but page-target behavior has no dedicated golden/live gate |
| `page dataset backlinks`          | keep     | no reviewed executable manifest record                                          |
| `page dataset anchors`            | keep     | no reviewed executable manifest record                                          |

The package stays because three command families remain `keep` and page summary
has not passed its own behavior gate.

## `@deniffer/serp-snapshot-cli`

| Legacy command             | Decision | gkit target or missing gate                                                                     |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `doctor dataset readiness` | replace  | `gkit --profile <app> dataforseo doctor`                                                        |
| `query dataset results`    | replace  | `dataforseo.serp.google.organic.live.advanced`; US/en/desktop/windows/depth-10 live gate passed |
| `batch dataset results`    | keep     | gkit exposes one reviewed provider task per invocation; batch artifact behavior is not replaced |

The package stays because batch behavior is still `keep`.

## `@deniffer/ai-optimization-cli`

| Legacy command                              | Decision | gkit target or missing gate                                           |
| ------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `doctor dataset readiness`                  | replace  | `gkit --profile <app> dataforseo doctor`                              |
| `llmResponse dataset models`                | keep     | no reviewed executable manifest record                                |
| `llmResponse entity live`                   | keep     | no reviewed executable manifest record or live gate                   |
| `llmMention dataset locationsAndLanguages`  | keep     | no reviewed executable manifest record                                |
| `llmMention dataset availableFilters`       | keep     | no reviewed executable manifest record                                |
| `llmMention dataset search`                 | keep     | inventory-only; `$0.10` request floor exceeds the `$0.03` profile cap |
| `llmMention dataset topPages`               | keep     | no reviewed executable manifest record                                |
| `llmMention dataset topDomains`             | keep     | no reviewed executable manifest record                                |
| `llmMention dataset aggregatedMetrics`      | keep     | no reviewed executable manifest record                                |
| `llmMention dataset crossAggregatedMetrics` | keep     | no reviewed executable manifest record                                |

The package stays because every data workflow remains `keep`.

## Package retirement verdict

No legacy DataForSEO package is deleted in Slice 2. The unit of migration is a
command behavior, but a package can be removed only after all of its retained
commands have a `replace` or explicit `drop` decision.
