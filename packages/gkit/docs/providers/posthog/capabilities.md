---
type: Reference
title: PostHog reviewed executable capabilities
description: >
  Generated, searchable documentation for the reviewed PostHog operations
  that gkit is allowed to route and execute.
provider: posthog
manifestRevision: 2026-07-14.slice3.1
---

# PostHog reviewed executable capabilities

This file is byte-stably rendered from `generated/posthog/manifest.json`.
The committed manifest remains the only runtime, validation, effect, cost, and discovery source.

## posthog.query.run

Run one read-only HogQL SELECT or WITH query with an explicit result-row limit.

- Provider: `posthog`
- Adapter key: `query.run`
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
    "limit"
  ],
  "properties": {
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 20000,
      "pattern": "^\\s*(?:[Ss][Ee][Ll][Ee][Cc][Tt]|[Ww][Ii][Tt][Hh])\\b",
      "allOf": [
        {
          "not": {
            "pattern": "[Ll][Ii][Mm][Ii][Tt]\\s+[0-9]+"
          }
        },
        {
          "not": {
            "pattern": ";"
          }
        },
        {
          "not": {
            "pattern": "(?:--|/\\*|\\*/|#)"
          }
        },
        {
          "not": {
            "pattern": "\\b(?:[Ii][Nn][Ss][Ee][Rr][Tt]|[Uu][Pp][Dd][Aa][Tt][Ee]|[Dd][Ee][Ll][Ee][Tt][Ee]|[Dd][Rr][Oo][Pp]|[Aa][Ll][Tt][Ee][Rr]|[Tt][Rr][Uu][Nn][Cc][Aa][Tt][Ee]|[Cc][Rr][Ee][Aa][Tt][Ee])\\b"
          }
        }
      ]
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1000
    }
  }
}
```

### Invocation

#### Safe preflight

```bash
gkit --profile clonesite.ai posthog api call --capability-id posthog.query.run --input @req.json --out posthog-query.json --dry-run
```

#### Live call after reviewing the dry-run

```bash
gkit --profile clonesite.ai posthog api call --capability-id posthog.query.run --input @req.json --out posthog-query.json
```
