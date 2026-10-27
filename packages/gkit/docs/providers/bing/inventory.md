---
type: Reference
title: Bing Webmaster operation inventory
description: >
  Generated inventory of pinned Bing Webmaster operations and their gkit exposure decisions.
provider: bing
inventoryRevision: 2026-10-27.bing.search-health.1
---

# Bing Webmaster operation inventory

This pinned inventory contains 21 operations: 21 executable and 0 inventory-only.
Inventory-only operations cannot be routed by `gkit bing api call`.

| Method | Path | Operation ID | Exposure | Decision |
| --- | --- | --- | --- | --- |
| `GET` | `/GetBlockedUrls` | `GetBlockedUrls` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.crawl.blocked-urls` |
| `GET` | `/GetCrawlIssues` | `GetCrawlIssues` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.crawl.issues` |
| `GET` | `/GetCrawlSettings` | `GetCrawlSettings` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.crawl.settings` |
| `GET` | `/GetCrawlStats` | `GetCrawlStats` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.crawl.stats` |
| `GET` | `/GetFeedDetails` | `GetFeedDetails` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.sitemaps.get` |
| `GET` | `/GetFeeds` | `GetFeeds` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.sitemaps.list` |
| `GET` | `/GetLinkCounts` | `GetLinkCounts` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.links.pages` |
| `GET` | `/GetPageQueryStats` | `GetPageQueryStats` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.traffic.page-queries` |
| `GET` | `/GetPageStats` | `GetPageStats` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.traffic.pages` |
| `GET` | `/GetQueryPageDetailStats` | `GetQueryPageDetailStats` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.traffic.query-page` |
| `GET` | `/GetQueryPageStats` | `GetQueryPageStats` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.traffic.query-pages` |
| `GET` | `/GetQueryStats` | `GetQueryStats` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.traffic.queries` |
| `GET` | `/GetQueryTrafficStats` | `GetQueryTrafficStats` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.traffic.query` |
| `GET` | `/GetRankAndTrafficStats` | `GetRankAndTrafficStats` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.traffic.rank` |
| `GET` | `/GetUrlInfo` | `GetUrlInfo` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.urls.info` |
| `GET` | `/GetUrlLinks` | `GetUrlLinks` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.links.url` |
| `GET` | `/GetUrlSubmissionQuota` | `GetUrlSubmissionQuota` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.urls.submission-quota` |
| `GET` | `/GetUrlTrafficInfo` | `GetUrlTrafficInfo` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.urls.traffic` |
| `GET` | `/GetUserSites` | `GetUserSites` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.sites.list` |
| `POST` | `/SubmitFeed` | `SubmitFeed` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.sitemaps.submit` |
| `POST` | `/SubmitUrlbatch` | `SubmitUrlbatch` | `executable` | Reviewed adapter, input, effect, and response contracts are committed.; capability: `bing.urls.submit` |
