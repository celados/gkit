---
type: Evaluation
title: gkit Slice 4 Google Search Console Baseline
description: >
  Redacted generated-contract, profile, dry-run, live-read, legacy-comparison,
  error, artifact, secret, and ledger evidence for the GSC provider slice.
status: passed
version: 1.0
timestamp: 2026-07-14T13:45:00+08:00
resource: ./gsc-migration-matrix.md
---

# gkit Slice 4 Google Search Console Baseline

## Verdict

**PASS for the provider data surface.** Five reviewed Search Console reads are
discoverable and executable through gkit with service-account OAuth restricted
to `webmasters.readonly`. The real `openclaw-web` profile passed all five live
reads, an inaccessible-property negative, and same-input legacy comparisons.

## Generated surface

- The reviewed contract inventories ten official methods: five executable
  reads and five inventory-only methods, including all write/destructive site
  and sitemap operations.
- Executable capabilities: properties list, Search Analytics query, sitemap
  list/get, and indexed URL inspection.
- Origins are fixed to the official `www.googleapis.com/webmasters/v3` and
  `searchconsole.googleapis.com/v1` surfaces. The profile accepts only an
  optional property scope and a service-account file `env:` reference.

## Real and legacy comparison gate

| Capability                   | gkit rows | Legacy result                | Artifact bytes |
| ---------------------------- | --------: | ---------------------------- | -------------: |
| `gsc.properties.list`        |         2 | 2 properties                 |            218 |
| `gsc.search-analytics.query` |        25 | same 25-row request          |          4,393 |
| `gsc.sitemaps.list`          |         1 | same one-sitemap result      |            424 |
| `gsc.sitemaps.get`           |         1 | same selected sitemap object |            337 |
| `gsc.url-inspection.inspect` |         1 | same indexed URL result      |            930 |

The negative Search Analytics request used an inaccessible property. It exited
1 with HTTP `403`, `AUTH_FAILED`, `outcome:"confirmed"`, and a 474-byte raw
error artifact. Provider-controlled messages and credential values were not
copied into the envelope.

## Safety and regression evidence

- Six artifacts totaled 6,776 bytes; all parsed as JSON and had mode `0600`.
- Runtime publication scanned the derived access token and service-account
  private key. A persistent scan found zero private-key or bearer-token
  patterns.
- Every envelope had `effects:["read"]`, `cost:null`, and `attemptId:null`.
  The shared spend ledger remained at eight attempts, zero unresolved outcomes,
  and zero policy breaches.
- The local profile and credential file both remain mode `0600`; the profile
  stores only non-secret scope and an `env:` reference.

## Retirement decision

All five legacy provider-data commands are `replace`. The network-aware legacy
doctor stays `keep`, while package-local skill path/print/install commands are
explicitly `drop`; therefore the old package is not deleted in this slice.
