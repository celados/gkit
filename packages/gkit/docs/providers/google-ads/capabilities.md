---
type: Reference
title: Google Ads reviewed executable capabilities
description: >
  Generated, searchable documentation for the reviewed Google Ads operations
  that gkit is allowed to route and execute.
provider: google-ads
manifestRevision: 2026-07-14.slice4.google-ads.1
---

# Google Ads reviewed executable capabilities

This file is byte-stably rendered from `generated/google-ads/manifest.json`.
The committed manifest remains the only runtime, validation, effect, cost, and discovery source.

## google-ads.customers.list-accessible

List customer resource names directly accessible to the authenticated service account.

- Provider: `google-ads`
- Adapter key: `customers.list-accessible`
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

#### Safe preflight

```bash
gkit --profile openclaw-web google-ads api call --capability-id google-ads.customers.list-accessible --input '{}' --out google-ads-customers.json --dry-run
```

#### Live read

```bash
gkit --profile openclaw-web google-ads api call --capability-id google-ads.customers.list-accessible --input '{}' --out google-ads-customers.json
```

## google-ads.fields.describe

Read metadata for one exact Google Ads field name through the pinned field service.

- Provider: `google-ads`
- Adapter key: `fields.describe`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "name"
  ],
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "pattern": "^[a-z][a-z0-9_.]*$"
    }
  }
}
```

### Invocation

#### Describe campaign.id

```bash
gkit --profile openclaw-web google-ads api call --capability-id google-ads.fields.describe --input '{"name":"campaign.id"}' --out campaign-id-field.json --dry-run
```

## google-ads.fields.search

Run one provider-native GoogleAdsField query and explicitly paginate all result pages.

- Provider: `google-ads`
- Adapter key: `fields.search`
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
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 20000
    },
    "pageSize": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10000
    }
  }
}
```

### Invocation

#### Search campaign fields

```bash
gkit --profile openclaw-web google-ads api call --capability-id google-ads.fields.search --input @fields.json --out fields-pages.json --dry-run
```

## google-ads.keyword-plan.generate-historical-metrics

Read provider-native Keyword Planner historical metrics for an explicit bounded keyword set.

- Provider: `google-ads`
- Adapter key: `keyword-plan.generate-historical-metrics`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "keywords"
  ],
  "properties": {
    "keywords": {
      "type": "array",
      "minItems": 1,
      "maxItems": 100,
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80
      }
    },
    "geoTargetConstants": {
      "type": "array",
      "maxItems": 10,
      "items": {
        "type": "string",
        "pattern": "^geoTargetConstants/[1-9][0-9]*$"
      }
    },
    "language": {
      "type": "string",
      "pattern": "^languageConstants/[1-9][0-9]*$"
    },
    "keywordPlanNetwork": {
      "enum": [
        "GOOGLE_SEARCH",
        "GOOGLE_SEARCH_AND_PARTNERS"
      ]
    },
    "historicalMetricsOptions": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "includeAverageCpc": {
          "type": "boolean"
        }
      }
    }
  }
}
```

### Invocation

#### Read US English metrics

```bash
gkit --profile openclaw-web google-ads api call --capability-id google-ads.keyword-plan.generate-historical-metrics --input @historical.json --out keyword-history-pages.json --dry-run
```

## google-ads.keyword-plan.generate-ideas

Generate and explicitly paginate provider-native Keyword Planner ideas for the profile-bound customer.

- Provider: `google-ads`
- Adapter key: `keyword-plan.generate-ideas`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "keywordSeed": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "keywords"
      ],
      "properties": {
        "keywords": {
          "type": "array",
          "minItems": 1,
          "maxItems": 20,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          }
        }
      }
    },
    "urlSeed": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "url"
      ],
      "properties": {
        "url": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2048
        }
      }
    },
    "keywordAndUrlSeed": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "keywords",
        "url"
      ],
      "properties": {
        "keywords": {
          "type": "array",
          "minItems": 1,
          "maxItems": 20,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          }
        },
        "url": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2048
        }
      }
    },
    "geoTargetConstants": {
      "type": "array",
      "maxItems": 10,
      "items": {
        "type": "string",
        "pattern": "^geoTargetConstants/[1-9][0-9]*$"
      }
    },
    "language": {
      "type": "string",
      "pattern": "^languageConstants/[1-9][0-9]*$"
    },
    "keywordPlanNetwork": {
      "enum": [
        "GOOGLE_SEARCH",
        "GOOGLE_SEARCH_AND_PARTNERS"
      ]
    },
    "includeAdultKeywords": {
      "type": "boolean"
    },
    "pageSize": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10000
    }
  },
  "oneOf": [
    {
      "required": [
        "keywordSeed"
      ],
      "properties": {
        "keywordSeed": {}
      }
    },
    {
      "required": [
        "urlSeed"
      ],
      "properties": {
        "urlSeed": {}
      }
    },
    {
      "required": [
        "keywordAndUrlSeed"
      ],
      "properties": {
        "keywordAndUrlSeed": {}
      }
    }
  ]
}
```

### Invocation

#### Generate US English ideas

```bash
gkit --profile openclaw-web google-ads api call --capability-id google-ads.keyword-plan.generate-ideas --input @ideas.json --out keyword-ideas-pages.json --dry-run
```

## google-ads.query.gaql

Run one provider-native GAQL query against the profile-bound customer and stream every REST page into one raw page bundle.

- Provider: `google-ads`
- Adapter key: `query.gaql`
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
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200000,
      "pattern": "^\\s*[Ss][Ee][Ll][Ee][Cc][Tt]\\b"
    }
  }
}
```

### Invocation

#### Read campaigns

```bash
gkit --profile openclaw-web google-ads api call --capability-id google-ads.query.gaql --input @gaql.json --out gaql-pages.json --dry-run
```
