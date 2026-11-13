---
type: Reference
title: Google Ads legacy CLI migration matrix
description: >
  Command-level replace, keep, and drop decisions after the Google Ads REST
  spike and Slice 4 live gate, used to prevent premature legacy retirement.
status: superseded
version: 1.1
timestamp: 2026-07-14T13:14:48+08:00
resource: ../../../docs/plans/2026-07-13-gkit-vertical-slice-plan.md
---

# Google Ads legacy CLI migration matrix

> Historical Slice 4 evidence. The final hard-cut decision in
> [`slice5-final-migration-matrix.md`](./slice5-final-migration-matrix.md)
> converts every `keep` row to `drop`; the package has been deleted.

## Decision rule

`replace` means the REST spike demonstrated the required provider behavior and
Slice 4 may implement the replacement; it does not mean the legacy command is
retired today. `keep` means an exact command behavior or a required live gate
is still missing. `drop` means the current sole consumer does not need the
legacy runtime-only operation in the REST product.

## `@deniffer/google-ads-cli`

| Legacy command                          | Decision | gkit target or missing gate                                                                                                                        |
| --------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider action install`               | drop     | REST is in-process and has no package-local Python environment to install                                                                          |
| `doctor dataset readiness`              | keep     | gkit now validates the local single-account service-account profile, but it intentionally does not preserve legacy network/MCC readiness semantics |
| `customer dataset accounts`             | replace  | `google-ads.customers.list-accessible`; implemented contract and live artifact passed                                                              |
| `query dataset gaql`                    | replace  | `google-ads.query.gaql`; pinned search, explicit pagination, raw page bundle, negative error, and live gate passed                                 |
| `keywordPlan dataset ideas`             | replace  | `google-ads.keyword-plan.generate-ideas`; provider-native input, full-page live result, artifact, and prior legacy comparison passed               |
| `keywordPlan dataset historicalMetrics` | replace  | `google-ads.keyword-plan.generate-historical-metrics`; live REST and legacy comparison passed                                                      |
| `campaign dataset performance`          | keep     | generic GAQL is available, but the curated command's exact query/input/output golden has not run through gkit                                      |
| `adGroup dataset performance`           | keep     | generic GAQL is available, but the curated command's exact query/input/output golden has not run through gkit                                      |
| `keyword dataset performance`           | keep     | generic GAQL is available, but the curated command's exact query/input/output golden has not run through gkit                                      |
| `searchTerm dataset performance`        | keep     | the larger REST query proved capacity, not the curated command's complete behavior contract                                                        |

## Package retirement verdict

The legacy Google Ads package is not deleted. Every `replace` row now exists in
gkit with contract tests and a live smoke, but doctor plus four curated
performance commands remain `keep`. The Python installer may be dropped only
when the package itself is finally retired. See
[`slice4-google-ads-baseline.md`](./slice4-google-ads-baseline.md) for the
productized evidence.
