---
type: Reference
title: HubSpot reviewed executable capabilities
description: >
  Generated, searchable documentation for the reviewed HubSpot operations
  that gkit is allowed to route and execute.
provider: hubspot
manifestRevision: 2026-08-30.hubspot.read-v1.1
---

# HubSpot reviewed executable capabilities

This file is byte-stably rendered from `generated/hubspot/manifest.json`.
The committed manifest remains the only runtime, validation, effect, cost, and discovery source.

## Data sensitivity

HubSpot artifacts can contain personal data: contact names and email addresses; owner names, email addresses, and teams; ticket subjects or content; event URLs, page titles, object IDs, and event properties. Company records, deal names and amounts, association IDs, pipeline labels, and property metadata can also disclose confidential business context.

Treat every HubSpot artifact as sensitive. Store it only at an access-controlled path, do not paste raw CRM rows into prompts or logs, and request only the reviewed properties required for the bounded analysis. The properties capability requests HubSpot's default non-sensitive metadata view and does not opt into sensitive-property definitions.

## hubspot.crm.associations.list

List bounded associations from one reviewed CRM record to one reviewed object type.

- Provider: `hubspot`
- Adapter key: `crm.associations.list`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "fromObjectType",
    "objectId",
    "toObjectType",
    "limit"
  ],
  "properties": {
    "fromObjectType": {
      "enum": [
        "companies",
        "contacts",
        "deals",
        "tickets"
      ]
    },
    "objectId": {
      "type": "string",
      "pattern": "^[1-9]\\d{0,19}$"
    },
    "toObjectType": {
      "enum": [
        "companies",
        "contacts",
        "deals",
        "tickets"
      ]
    },
    "pageSize": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 5000
    }
  }
}
```

### Invocation

```bash
gkit --profile app-a hubspot api call --capability-id hubspot.crm.associations.list --input @request.json --out hubspot-associations.json --dry-run
```

## hubspot.crm.objects.list

List bounded records for one reviewed CRM object type and reviewed properties.

- Provider: `hubspot`
- Adapter key: `crm.objects.list`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "objectType",
    "properties",
    "limit"
  ],
  "properties": {
    "objectType": {
      "enum": [
        "companies",
        "contacts",
        "deals",
        "tickets"
      ]
    },
    "properties": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "maxItems": 50,
      "items": {
        "$ref": "#/definitions/property"
      }
    },
    "archived": {
      "type": "boolean"
    },
    "pageSize": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 5000
    }
  },
  "definitions": {
    "property": {
      "enum": [
        "amount",
        "city",
        "closedate",
        "content",
        "country",
        "createdate",
        "dealname",
        "dealstage",
        "domain",
        "email",
        "firstname",
        "hs_analytics_source",
        "hs_analytics_source_data_1",
        "hs_analytics_source_data_2",
        "hs_lastmodifieddate",
        "hs_lead_status",
        "hs_object_id",
        "hs_pipeline",
        "hs_pipeline_stage",
        "hs_ticket_category",
        "hs_ticket_priority",
        "hubspot_owner_id",
        "industry",
        "lastmodifieddate",
        "lastname",
        "lifecyclestage",
        "name",
        "numberofemployees",
        "pipeline",
        "state",
        "subject"
      ]
    }
  }
}
```

### Invocation

```bash
gkit --profile app-a hubspot api call --capability-id hubspot.crm.objects.list --input @request.json --out hubspot-contacts.json --dry-run
```

## hubspot.crm.objects.search

Run one bounded HubSpot CRM Search POST over reviewed objects, properties, filters, and sorts.

- Provider: `hubspot`
- Adapter key: `crm.objects.search`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "objectType",
    "properties",
    "limit"
  ],
  "properties": {
    "objectType": {
      "enum": [
        "companies",
        "contacts",
        "deals",
        "tickets"
      ]
    },
    "properties": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "maxItems": 50,
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      }
    },
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 3000
    },
    "filterGroups": {
      "type": "array",
      "maxItems": 5,
      "items": {
        "type": "object"
      }
    },
    "sorts": {
      "type": "array",
      "maxItems": 1,
      "items": {
        "type": "object"
      }
    },
    "pageSize": {
      "type": "integer",
      "minimum": 1,
      "maximum": 200
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10000
    }
  }
}
```

### Invocation

```bash
gkit --profile app-a hubspot api call --capability-id hubspot.crm.objects.search --input @request.json --out hubspot-contact-search.json --dry-run
```

## hubspot.crm.owners.list

List bounded active or archived HubSpot owners for attribution joins.

- Provider: `hubspot`
- Adapter key: `crm.owners.list`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "limit"
  ],
  "properties": {
    "archived": {
      "type": "boolean"
    },
    "pageSize": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 5000
    }
  }
}
```

### Invocation

```bash
gkit --profile app-a hubspot api call --capability-id hubspot.crm.owners.list --input '{"limit":100}' --out hubspot-owners.json --dry-run
```

## hubspot.crm.pipelines.list

List pipelines and stages for deals or tickets.

- Provider: `hubspot`
- Adapter key: `crm.pipelines.list`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "objectType"
  ],
  "properties": {
    "objectType": {
      "enum": [
        "deals",
        "tickets"
      ]
    }
  }
}
```

### Invocation

```bash
gkit --profile app-a hubspot api call --capability-id hubspot.crm.pipelines.list --input '{"objectType":"deals"}' --out hubspot-deal-pipelines.json --dry-run
```

## hubspot.crm.properties.list

List non-sensitive property definitions for one reviewed CRM object type.

- Provider: `hubspot`
- Adapter key: `crm.properties.list`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "objectType"
  ],
  "properties": {
    "objectType": {
      "enum": [
        "companies",
        "contacts",
        "deals",
        "tickets"
      ]
    }
  }
}
```

### Invocation

```bash
gkit --profile app-a hubspot api call --capability-id hubspot.crm.properties.list --input '{"objectType":"contacts"}' --out hubspot-contact-properties.json --dry-run
```

## hubspot.events.occurrences.list

List bounded HubSpot event occurrences within an explicit time window.

- Provider: `hubspot`
- Adapter key: `events.occurrences.list`
- Capability revision: `1`
- Effects: `read`

### Input schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "occurredAfter",
    "occurredBefore",
    "properties",
    "limit"
  ],
  "properties": {
    "occurredAfter": {
      "type": "string",
      "format": "date-time",
      "maxLength": 64
    },
    "occurredBefore": {
      "type": "string",
      "format": "date-time",
      "maxLength": 64
    },
    "eventType": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "objectType": {
      "enum": [
        "company",
        "contact",
        "deal",
        "ticket"
      ]
    },
    "objectId": {
      "type": "string",
      "pattern": "^[1-9]\\d{0,19}$"
    },
    "properties": {
      "type": "array",
      "minItems": 1,
      "maxItems": 20,
      "uniqueItems": true,
      "items": {
        "enum": [
          "hs_browser",
          "hs_city",
          "hs_content_type",
          "hs_country",
          "hs_device_name",
          "hs_device_type",
          "hs_page_title",
          "hs_referrer",
          "hs_touchpoint_source",
          "hs_url",
          "hs_utm_campaign",
          "hs_utm_medium",
          "hs_utm_source"
        ]
      }
    },
    "pageSize": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 5000
    }
  }
}
```

### Invocation

```bash
gkit --profile app-a hubspot api call --capability-id hubspot.events.occurrences.list --input @request.json --out hubspot-events.json --dry-run
```
