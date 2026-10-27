---
type: Reference
title: PageSpeed Insights reviewed executable capabilities
description: >
  Generated, searchable documentation for the reviewed PageSpeed Insights operations
  that gkit is allowed to route and execute.
provider: pagespeed
manifestRevision: 2026-10-27.pagespeed.read-v1.1
---

# PageSpeed Insights reviewed executable capabilities

This file is byte-stably rendered from `generated/pagespeed/manifest.json`.
The committed manifest remains the only runtime, validation, effect, cost, and discovery source.

## pagespeed.run

Run Lighthouse for one URL and return category scores plus Chrome UX Report field data for the URL and its origin when available.

- Provider: `pagespeed`
- Adapter key: `run`
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
    "url": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "strategy": {
      "enum": [
        "mobile",
        "desktop"
      ]
    },
    "categories": {
      "type": "array",
      "minItems": 1,
      "maxItems": 4,
      "uniqueItems": true,
      "items": {
        "enum": [
          "performance",
          "seo",
          "accessibility",
          "best-practices"
        ]
      }
    },
    "locale": {
      "type": "string",
      "minLength": 2,
      "maxLength": 16
    }
  }
}
```

### Invocation

```bash
gkit --profile <app> pagespeed api call --capability-id pagespeed.run --input @request.json --out pagespeed.json --dry-run
```
