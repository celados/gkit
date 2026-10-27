---
type: Reference
title: bing reviewed executable capabilities
description: >
  Generated, searchable documentation for the reviewed bing operations
  that gkit is allowed to route and execute.
provider: bing
manifestRevision: 2026-10-27.bing.search-health.1
---

# bing reviewed executable capabilities

This file is byte-stably rendered from `generated/bing/manifest.json`.
The committed manifest remains the only runtime, validation, effect, cost, and discovery source.

## bing.crawl.blocked-urls

Read URLs and directories blocked from Bing results for one site.

- Provider: `bing`
- Adapter key: `crawl.blocked-urls`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.crawl.blocked-urls --input '{}' --out bing-blocked-urls.json --dry-run
```

## bing.crawl.issues

Read current crawl issue URLs for one site.

- Provider: `bing`
- Adapter key: `crawl.issues`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.crawl.issues --input '{}' --out bing-crawl-issues.json --dry-run
```

## bing.crawl.settings

Read crawl settings for one site without exposing mutation methods.

- Provider: `bing`
- Adapter key: `crawl.settings`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.crawl.settings --input '{}' --out bing-crawl-settings.json --dry-run
```

## bing.crawl.stats

Read crawl statistics for one site.

- Provider: `bing`
- Adapter key: `crawl.stats`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.crawl.stats --input '{}' --out bing-crawl-stats.json --dry-run
```

## bing.links.pages

Read one provider page of URLs and inbound link counts.

- Provider: `bing`
- Adapter key: `links.pages`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "page": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100000
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.links.pages --input '{"page":0}' --out bing-links.json --dry-run
```

## bing.links.url

Read one provider page of inbound link details for an exact URL.

- Provider: `bing`
- Adapter key: `links.url`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "link"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "link": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "page": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100000
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.links.url --input @request.json --out bing-url-links.json --dry-run
```

## bing.sitemaps.get

Read details for one exact sitemap or feed URL.

- Provider: `bing`
- Adapter key: `sitemaps.get`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "feedUrl"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "feedUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.sitemaps.get --input @request.json --out bing-sitemap.json --dry-run
```

## bing.sitemaps.list

List top-level feeds or sitemaps for one site.

- Provider: `bing`
- Adapter key: `sitemaps.list`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.sitemaps.list --input '{}' --out bing-sitemaps.json --dry-run
```

## bing.sitemaps.submit

Submit or resubmit one sitemap or feed URL for one site.

- Provider: `bing`
- Adapter key: `sitemaps.submit`
- Capability revision: `1`
- Effects: `write`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "feedUrl"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "feedUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.sitemaps.submit --input @request.json --allow-write --out bing-sitemap-submit.json --dry-run
```

## bing.sites.list

List every site accessible to the profile-bound Bing Webmaster API key.

- Provider: `bing`
- Adapter key: `sites.list`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {}
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.sites.list --input '{}' --out bing-sites.json --dry-run
```

## bing.traffic.page-queries

Read query statistics for one exact page URL.

- Provider: `bing`
- Adapter key: `traffic.page-queries`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "pageUrl"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "pageUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.traffic.page-queries --input @request.json --out bing-page-queries.json --dry-run
```

## bing.traffic.pages

Read top page traffic statistics for one site.

- Provider: `bing`
- Adapter key: `traffic.pages`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.traffic.pages --input '{}' --out bing-pages.json --dry-run
```

## bing.traffic.queries

Read top query traffic statistics for one site.

- Provider: `bing`
- Adapter key: `traffic.queries`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.traffic.queries --input '{}' --out bing-queries.json --dry-run
```

## bing.traffic.query

Read daily traffic statistics for one exact query.

- Provider: `bing`
- Adapter key: `traffic.query`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "query"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.traffic.query --input @request.json --out bing-query.json --dry-run
```

## bing.traffic.query-page

Read detailed statistics for one exact query and page URL pair.

- Provider: `bing`
- Adapter key: `traffic.query-page`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "query",
    "pageUrl"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512
    },
    "pageUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.traffic.query-page --input @request.json --out bing-query-page.json --dry-run
```

## bing.traffic.query-pages

Read page statistics for one exact query.

- Provider: `bing`
- Adapter key: `traffic.query-pages`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "query"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.traffic.query-pages --input @request.json --out bing-query-pages.json --dry-run
```

## bing.traffic.rank

Read rank and traffic statistics for the profile-bound or explicitly selected site.

- Provider: `bing`
- Adapter key: `traffic.rank`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.traffic.rank --input '{}' --out bing-rank.json --dry-run
```

## bing.urls.info

Read Bing index information for one URL or domain target.

- Provider: `bing`
- Adapter key: `urls.info`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "url"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "url": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.urls.info --input @request.json --out bing-url-info.json --dry-run
```

## bing.urls.submission-quota

Read the remaining daily and monthly URL submission quota for one site.

- Provider: `bing`
- Adapter key: `urls.submission-quota`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.urls.submission-quota --input '{}' --out bing-url-quota.json --dry-run
```

## bing.urls.submit

Submit up to 500 URLs of one site for Bing crawling; consumes the daily URL submission quota.

- Provider: `bing`
- Adapter key: `urls.submit`
- Capability revision: `1`
- Effects: `write`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "urlList"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "urlList": {
      "type": "array",
      "minItems": 1,
      "maxItems": 500,
      "uniqueItems": true,
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2048
      }
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.urls.submit --input @request.json --allow-write --out bing-url-submit.json --dry-run
```

## bing.urls.traffic

Read Bing traffic information for one URL or domain target.

- Provider: `bing`
- Adapter key: `urls.traffic`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "url"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "url": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> bing api call --capability-id bing.urls.traffic --input @request.json --out bing-url-traffic.json --dry-run
```
