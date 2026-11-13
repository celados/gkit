---
type: Reference
title: Google Search Console legacy CLI migration matrix
description: >
  Command-level replace, keep, and drop decisions after the Slice 4 GSC real
  profile and legacy-comparison gate.
status: superseded
version: 1.0
timestamp: 2026-07-14T13:45:00+08:00
resource: ../../../docs/plans/2026-07-13-gkit-vertical-slice-plan.md
---

# Google Search Console legacy CLI migration matrix

> Historical Slice 4 evidence. The final hard-cut decision in
> [`slice5-final-migration-matrix.md`](./slice5-final-migration-matrix.md)
> converts every `keep` row to `drop`; the package has been deleted.

## `@deniffer/gsc-cli`

| Legacy command             | Decision | gkit target or evidence                                                                               |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `skill path`               | drop     | local package skill distribution is not a provider capability; generated docs replace discovery       |
| `skill print`              | drop     | `gkit docs --provider gsc` and `gkit describe` are the canonical discovery surfaces                   |
| `skill install`            | drop     | the sole consumer uses the linked `gkit` binary; no package-local skill install is needed             |
| `doctor dataset readiness` | keep     | `gkit gsc doctor` validates local files, but intentionally does not preserve the legacy network probe |
| `property dataset sites`   | replace  | `gsc.properties.list`; legacy and gkit both returned two properties                                   |
| `search dataset analytics` | replace  | `gsc.search-analytics.query`; same dates, query dimension, and limit returned the same 25 rows        |
| `sitemap dataset sitemaps` | replace  | `gsc.sitemaps.list`; both returned one sitemap with the same raw provider facts                       |
| `sitemap entity sitemap`   | replace  | `gsc.sitemaps.get`; both returned the selected sitemap object                                         |
| `inspection entity url`    | replace  | `gsc.url-inspection.inspect`; both returned the same indexed URL result                               |

## Package retirement verdict

The provider data surface is replaced, but the package remains through Slice 4
because its network-aware doctor is still `keep`. Its three skill helpers are
explicitly `drop`, not silently migrated. See
[`slice4-gsc-baseline.md`](./slice4-gsc-baseline.md).
