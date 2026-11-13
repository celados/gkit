---
type: Reference
title: Bing Webmaster legacy CLI migration matrix
description: >
  Command-level replace, keep, and drop decisions for the Slice 4 Bing
  Webmaster provider slice after the real-profile and legacy-comparison gate.
status: superseded
version: 1.0
timestamp: 2026-07-14T13:53:13+08:00
resource: ../../../docs/plans/2026-07-13-gkit-vertical-slice-plan.md
---

# Bing Webmaster legacy CLI migration matrix

> Historical Slice 4 evidence. The final hard-cut decision in
> [`slice5-final-migration-matrix.md`](./slice5-final-migration-matrix.md)
> converts every `keep` row to `drop`; the package has been deleted.

## Decision rule

`replace` requires the same real profile and representative input to pass in
both CLIs without losing provider facts. That gate passed for all 17 data
commands. `keep` remains appropriate for the network-aware legacy doctor,
whose reachability behavior is intentionally absent from the local-only gkit
doctor.

## `@deniffer/bing-webmaster-cli`

| Legacy command               | Decision | gkit target or missing gate                                                                            |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `doctor dataset readiness`   | keep     | `gkit bing doctor` validates local config but intentionally does not preserve the legacy network probe |
| `site dataset sites`         | replace  | `bing.sites.list`; both returned the same five sites                                                   |
| `traffic dataset rank`       | replace  | `bing.traffic.rank`; same seven rows                                                                   |
| `traffic dataset queries`    | replace  | `bing.traffic.queries`; same 35 rows, with provider order varying between requests                     |
| `traffic dataset pages`      | replace  | `bing.traffic.pages`; same 28 rows                                                                     |
| `traffic entity query`       | replace  | `bing.traffic.query`; same six rows for the selected query                                             |
| `traffic entity pageQueries` | replace  | `bing.traffic.page-queries`; same 26 rows, with provider order varying between requests                |
| `traffic entity queryPages`  | replace  | `bing.traffic.query-pages`; same three rows                                                            |
| `traffic entity queryPage`   | replace  | `bing.traffic.query-page`; both returned the same valid empty result                                   |
| `crawl dataset stats`        | replace  | `bing.crawl.stats`; same six rows                                                                      |
| `crawl dataset issues`       | replace  | `bing.crawl.issues`; both returned the same valid empty result                                         |
| `crawl entity settings`      | replace  | `bing.crawl.settings`; same settings object                                                            |
| `link dataset pages`         | replace  | `bing.links.pages`; same link-count object                                                             |
| `link entity url`            | replace  | `bing.links.url`; same URL-link object                                                                 |
| `sitemap dataset feeds`      | replace  | `bing.sitemaps.list`; same one-sitemap result                                                          |
| `sitemap entity feed`        | replace  | `bing.sitemaps.get`; same four detail rows                                                             |
| `url entity info`            | replace  | `bing.urls.info`; same URL index object                                                                |
| `url entity traffic`         | replace  | `bing.urls.traffic`; same URL traffic object                                                           |

## Package retirement verdict

The provider data surface is replaced, but the package remains through Slice 4
because its network-aware doctor is still `keep`. See
[`slice4-bing-baseline.md`](./slice4-bing-baseline.md).
