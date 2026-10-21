---
type: Reference
title: gsc reviewed executable capabilities
description: >
  Generated, searchable documentation for the reviewed gsc operations
  that gkit is allowed to route and execute.
provider: gsc
manifestRevision: 2026-10-21.gsc.3
---

# gsc reviewed executable capabilities

This file is byte-stably rendered from `generated/gsc/manifest.json`.
The committed manifest remains the only runtime, validation, effect, cost, and discovery source.

## gsc.properties.list

List Search Console properties accessible to the profile-bound service account.

- Provider: `gsc`
- Adapter key: `properties.list`
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
gkit --profile openclaw-web gsc api call --operation-id gsc.properties.list --input '{}' --out gsc-properties.json --dry-run
```

## gsc.search-analytics.query

Run one provider-native Search Analytics read for the profile-bound or explicitly selected property.

- Provider: `gsc`
- Adapter key: `search-analytics.query`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "startDate",
    "endDate"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "startDate": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "endDate": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "dimensions": {
      "type": "array",
      "maxItems": 8,
      "uniqueItems": true,
      "items": {
        "enum": [
          "country",
          "date",
          "device",
          "hour",
          "page",
          "query",
          "searchAppearance"
        ]
      }
    },
    "type": {
      "enum": [
        "discover",
        "googleNews",
        "image",
        "news",
        "video",
        "web"
      ]
    },
    "dataState": {
      "enum": [
        "all",
        "final",
        "hourly_all"
      ]
    },
    "aggregationType": {
      "enum": [
        "auto",
        "byNewsShowcasePanel",
        "byPage",
        "byProperty"
      ]
    },
    "rowLimit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 25000
    },
    "startRow": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100000000
    },
    "dimensionFilterGroups": {
      "type": "array",
      "maxItems": 10,
      "items": {
        "type": "object"
      }
    }
  }
}
```

### Invocation

```bash
gkit --profile openclaw-web gsc api call --operation-id gsc.search-analytics.query --input @request.json --out gsc-search.json --dry-run
```

## gsc.sitemaps.get

Read details for one exact sitemap URL under one Search Console property.

- Provider: `gsc`
- Adapter key: `sitemaps.get`
- Capability revision: `2`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "feedpath"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "feedpath": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

#### Read a sitemap returned by gsc.sitemaps.list for openclaw-web

```bash
gkit --profile openclaw-web gsc api call --operation-id gsc.sitemaps.get --input @request.json --out gsc-sitemap.json --dry-run
```

## gsc.sitemaps.list

List sitemaps for one Search Console property.

- Provider: `gsc`
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
    },
    "sitemapIndex": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  }
}
```

### Invocation

```bash
gkit --profile openclaw-web gsc api call --operation-id gsc.sitemaps.list --input '{}' --out gsc-sitemaps.json --dry-run
```

## gsc.sitemaps.submit

Submit or resubmit one exact sitemap URL for one Search Console property. Changes provider state, so it requires --allow-write, and the service account needs Full or Owner permission on the property; a Restricted user is rejected with AUTH_FAILED. Google returns an empty body, so the artifact is a gkit submission receipt with siteUrl, feedpath, and httpStatus.

- Provider: `gsc`
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
    "feedpath"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "feedpath": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048,
      "pattern": "^[Hh][Tt][Tt][Pp][Ss]?://[^\\s/?#]+"
    }
  }
}
```

### Invocation

#### Submit the openclaw-web sitemap index

```bash
gkit --profile openclaw-web gsc api call --operation-id gsc.sitemaps.submit --input @request.json --allow-write --out gsc-sitemap-submit.json --dry-run
```

## gsc.url-inspection.inspect

Read Google's indexed URL inspection result for one URL under the selected property.

- Provider: `gsc`
- Adapter key: `url-inspection.inspect`
- Capability revision: `2`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "inspectionUrl"
  ],
  "properties": {
    "siteUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "inspectionUrl": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "languageCode": {
      "type": "string",
      "pattern": "^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$",
      "maxLength": 35
    }
  }
}
```

### Invocation

#### Inspect a URL under the openclaw-web Search Console property

```bash
gkit --profile openclaw-web gsc api call --operation-id gsc.url-inspection.inspect --input @request.json --out gsc-inspection.json --dry-run
```
