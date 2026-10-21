---
type: Reference
title: Google Search Console operation inventory
description: >
  Generated inventory of pinned Google Search Console operations and their gkit exposure decisions.
provider: gsc
inventoryRevision: 2026-10-21.gsc.3
---

# Google Search Console operation inventory

This pinned inventory contains 10 operations: 6 executable and 4 inventory-only.
Inventory-only operations cannot be routed by `gkit gsc api call`.

| Method | Path | Operation ID | Exposure | Decision |
| --- | --- | --- | --- | --- |
| `POST` | `/v1/urlInspection/index:inspect` | `urlInspection.index.inspect` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `gsc.url-inspection.inspect` |
| `GET` | `/webmasters/v3/sites` | `sites.list` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `gsc.properties.list` |
| `DELETE` | `/webmasters/v3/sites/{siteUrl}` | `sites.delete` | `inventory` | Destructive operation is outside Slice 4. |
| `GET` | `/webmasters/v3/sites/{siteUrl}` | `sites.get` | `inventory` | The legacy CLI does not expose a distinct property-get workflow; properties.list carries the reviewed inventory use case. |
| `PUT` | `/webmasters/v3/sites/{siteUrl}` | `sites.add` | `inventory` | Write operation is outside Slice 4. |
| `POST` | `/webmasters/v3/sites/{siteUrl}/searchAnalytics/query` | `searchanalytics.query` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `gsc.search-analytics.query` |
| `GET` | `/webmasters/v3/sites/{siteUrl}/sitemaps` | `sitemaps.list` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `gsc.sitemaps.list` |
| `DELETE` | `/webmasters/v3/sites/{siteUrl}/sitemaps/{feedpath}` | `sitemaps.delete` | `inventory` | Destructive operation is outside Slice 4. |
| `GET` | `/webmasters/v3/sites/{siteUrl}/sitemaps/{feedpath}` | `sitemaps.get` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `gsc.sitemaps.get` |
| `PUT` | `/webmasters/v3/sites/{siteUrl}/sitemaps/{feedpath}` | `sitemaps.submit` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `gsc.sitemaps.submit` |
