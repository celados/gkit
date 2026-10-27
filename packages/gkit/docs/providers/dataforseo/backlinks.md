---
type: Reference
title: DataForSEO reviewed executable capabilities
description: >
  Generated, searchable documentation for the reviewed DataForSEO operations
  that gkit is allowed to route and execute.
provider: dataforseo
manifestRevision: 2026-07-15.llm-mentions.2
---

# DataForSEO reviewed executable capabilities

This file is byte-stably rendered from `generated/dataforseo/manifest.json`.
The committed manifest remains the only runtime, validation, effect, cost, and discovery source.

## dataforseo.ai_optimization.llm_mentions.search.live

Search reviewed ChatGPT or Google AI mention records for one domain in United States English results.

- Provider: `dataforseo`
- Adapter key: `ai_optimization.llm_mentions.search.live`
- Capability revision: `1`
- Effects: `read`, `spend`
- Cost-policy revision: `dataforseo-ai-optimization-llm-mentions-pricing-2026-07-15-v2`
- Conservative cost model: `150000` micros per request

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "target",
    "location_code",
    "language_code",
    "platform",
    "limit"
  ],
  "properties": {
    "target": {
      "type": "array",
      "minItems": 1,
      "maxItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "domain"
        ],
        "properties": {
          "domain": {
            "type": "string",
            "minLength": 1,
            "maxLength": 63,
            "pattern": "^(?!https?://)(?!www\\.)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}$"
          },
          "search_filter": {
            "type": "string",
            "enum": [
              "include"
            ]
          },
          "search_scope": {
            "type": "array",
            "minItems": 1,
            "maxItems": 5,
            "uniqueItems": true,
            "items": {
              "type": "string",
              "enum": [
                "any",
                "question",
                "answer",
                "brand_entities",
                "fan_out_queries"
              ]
            }
          },
          "include_subdomains": {
            "type": "boolean"
          }
        }
      }
    },
    "location_code": {
      "type": "integer",
      "const": 2840
    },
    "language_code": {
      "type": "string",
      "const": "en"
    },
    "platform": {
      "type": "string",
      "enum": [
        "chat_gpt",
        "google"
      ]
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "order_by": {
      "type": "array",
      "minItems": 1,
      "maxItems": 1,
      "items": {
        "type": "string",
        "enum": [
          "ai_search_volume,asc",
          "ai_search_volume,desc",
          "last_response_at,asc",
          "last_response_at,desc"
        ]
      }
    },
    "tag": {
      "type": "string",
      "maxLength": 255
    }
  }
}
```

### Invocation

#### Safe preflight

```bash
gkit --profile clonesite.ai dataforseo api call --capability-id dataforseo.ai_optimization.llm_mentions.search.live --input @req.json --allow-spend --max-spend-usd 0.150000 --out llm-mentions.json --dry-run
```

#### Live call after reviewing the dry-run

```bash
gkit --profile clonesite.ai dataforseo api call --capability-id dataforseo.ai_optimization.llm_mentions.search.live --input @req.json --allow-spend --max-spend-usd 0.150000 --out llm-mentions.json
```

## dataforseo.backlinks.bulk_ranks.live

Return DataForSEO backlink ranks for up to 1,000 targets in one live request.

- Provider: `dataforseo`
- Adapter key: `backlinks.bulk_ranks.live`
- Capability revision: `2`
- Effects: `read`, `spend`
- Cost-policy revision: `dataforseo-backlinks-pricing-2026-07-14-v1`
- Conservative cost model: `24000` base micros + `36` micros per item at `/targets` (max `1000`)

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "targets"
  ],
  "properties": {
    "targets": {
      "type": "array",
      "description": "Domains, subdomains, or absolute URLs to rank.",
      "minItems": 1,
      "maxItems": 1000,
      "items": {
        "type": "string",
        "minLength": 1
      }
    },
    "rank_scale": {
      "type": "string",
      "enum": [
        "one_hundred",
        "one_thousand"
      ]
    },
    "tag": {
      "type": "string",
      "maxLength": 255
    }
  }
}
```

### Invocation

#### Safe preflight

```bash
gkit --profile clonesite.ai dataforseo api call --capability-id dataforseo.backlinks.bulk_ranks.live --input @req.json --allow-spend --max-spend-usd 0.024072 --out ranks.json --dry-run
```

#### Live call after reviewing the dry-run

```bash
gkit --profile clonesite.ai dataforseo api call --capability-id dataforseo.backlinks.bulk_ranks.live --input @req.json --allow-spend --max-spend-usd 0.024072 --out ranks.json
```

## dataforseo.backlinks.referring_domains.live

Return up to 100 reviewed referring-domain rows for one target.

- Provider: `dataforseo`
- Adapter key: `backlinks.referring_domains.live`
- Capability revision: `1`
- Effects: `read`, `spend`
- Cost-policy revision: `dataforseo-backlinks-pricing-2026-07-14-v1`
- Conservative cost model: `24000` base micros + `36` micros per numeric unit at `/limit` (max `100`)

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "target",
    "limit"
  ],
  "properties": {
    "target": {
      "type": "string",
      "minLength": 1
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "order_by": {
      "type": "array",
      "minItems": 1,
      "maxItems": 1,
      "items": {
        "type": "string",
        "enum": [
          "rank,asc",
          "rank,desc",
          "backlinks,asc",
          "backlinks,desc"
        ]
      }
    },
    "include_subdomains": {
      "type": "boolean"
    },
    "exclude_internal_backlinks": {
      "type": "boolean"
    },
    "backlinks_status_type": {
      "type": "string",
      "enum": [
        "all",
        "live",
        "lost"
      ]
    },
    "rank_scale": {
      "type": "string",
      "enum": [
        "one_hundred",
        "one_thousand"
      ]
    },
    "tag": {
      "type": "string",
      "maxLength": 255
    }
  }
}
```

### Invocation

#### Safe preflight

```bash
gkit --profile clonesite.ai dataforseo api call --capability-id dataforseo.backlinks.referring_domains.live --input @req.json --allow-spend --max-spend-usd 0.024720 --out referring-domains.json --dry-run
```

#### Live call after reviewing the dry-run

```bash
gkit --profile clonesite.ai dataforseo api call --capability-id dataforseo.backlinks.referring_domains.live --input @req.json --allow-spend --max-spend-usd 0.024720 --out referring-domains.json
```

## dataforseo.backlinks.summary.live

Return the reviewed live backlink summary for one domain, subdomain, or page.

- Provider: `dataforseo`
- Adapter key: `backlinks.summary.live`
- Capability revision: `1`
- Effects: `read`, `spend`
- Cost-policy revision: `dataforseo-backlinks-pricing-2026-07-14-v1`
- Conservative cost model: `24036` micros per request

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "target"
  ],
  "properties": {
    "target": {
      "type": "string",
      "minLength": 1
    },
    "include_subdomains": {
      "type": "boolean"
    },
    "exclude_internal_backlinks": {
      "type": "boolean"
    },
    "internal_list_limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10
    },
    "backlinks_status_type": {
      "type": "string",
      "enum": [
        "all",
        "live",
        "lost"
      ]
    },
    "rank_scale": {
      "type": "string",
      "enum": [
        "one_hundred",
        "one_thousand"
      ]
    },
    "tag": {
      "type": "string",
      "maxLength": 255
    }
  }
}
```

### Invocation

#### Safe preflight

```bash
gkit --profile clonesite.ai dataforseo api call --capability-id dataforseo.backlinks.summary.live --input @req.json --allow-spend --max-spend-usd 0.024036 --out summary.json --dry-run
```

#### Live call after reviewing the dry-run

```bash
gkit --profile clonesite.ai dataforseo api call --capability-id dataforseo.backlinks.summary.live --input @req.json --allow-spend --max-spend-usd 0.024036 --out summary.json
```

## dataforseo.serp.google.organic.live.advanced

Return one Google Organic live advanced SERP with a reviewed maximum depth of 10.

- Provider: `dataforseo`
- Adapter key: `serp.google.organic.live.advanced`
- Capability revision: `1`
- Effects: `read`, `spend`
- Cost-policy revision: `dataforseo-google-organic-live-pricing-2026-07-14-v1`
- Conservative cost model: `2000` micros per request

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "keyword",
    "location_code",
    "language_code",
    "device",
    "os",
    "depth"
  ],
  "properties": {
    "keyword": {
      "type": "string",
      "minLength": 1,
      "maxLength": 700,
      "not": {
        "pattern": "(?:[Aa][Ll][Ll][Ii][Nn][Aa][Nn][Cc][Hh][Oo][Rr]|[Aa][Ll][Ll][Ii][Nn][Tt][Ee][Xx][Tt]|[Aa][Ll][Ll][Ii][Nn][Tt][Ii][Tt][Ll][Ee]|[Aa][Ll][Ll][Ii][Nn][Uu][Rr][Ll]|[Dd][Ee][Ff][Ii][Nn][Ee]|[Dd][Ee][Ff][Ii][Nn][Ii][Tt][Ii][Oo][Nn]|[Ff][Ii][Ll][Ee][Tt][Yy][Pp][Ee]|[Ii][Dd]|[Ii][Nn][Aa][Nn][Cc][Hh][Oo][Rr]|[Ii][Nn][Ff][Oo]|[Ii][Nn][Tt][Ee][Xx][Tt]|[Ii][Nn][Tt][Ii][Tt][Ll][Ee]|[Ii][Nn][Uu][Rr][Ll]|[Ll][Ii][Nn][Kk]|[Rr][Ee][Ll][Aa][Tt][Ee][Dd]|[Ss][Ii][Tt][Ee]|[Cc][Aa][Cc][Hh][Ee]):"
      }
    },
    "location_code": {
      "type": "integer",
      "minimum": 1
    },
    "language_code": {
      "type": "string",
      "minLength": 2,
      "maxLength": 10
    },
    "device": {
      "type": "string",
      "enum": [
        "desktop",
        "mobile"
      ]
    },
    "os": {
      "type": "string",
      "enum": [
        "windows",
        "macos",
        "android",
        "ios"
      ]
    },
    "depth": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10
    },
    "tag": {
      "type": "string",
      "maxLength": 255
    }
  },
  "allOf": [
    {
      "if": {
        "properties": {
          "device": {
            "const": "desktop"
          }
        }
      },
      "then": {
        "properties": {
          "os": {
            "enum": [
              "windows",
              "macos"
            ]
          }
        }
      },
      "else": {
        "properties": {
          "os": {
            "enum": [
              "android",
              "ios"
            ]
          }
        }
      }
    }
  ]
}
```

### Invocation

#### Safe preflight

```bash
gkit --profile clonesite.ai dataforseo api call --capability-id dataforseo.serp.google.organic.live.advanced --input @req.json --allow-spend --max-spend-usd 0.002000 --out serp.json --dry-run
```

#### Live call after reviewing the dry-run

```bash
gkit --profile clonesite.ai dataforseo api call --capability-id dataforseo.serp.google.organic.live.advanced --input @req.json --allow-spend --max-spend-usd 0.002000 --out serp.json
```
