---
type: Evaluation
title: gkit Slice 4 Google Ads Baseline
description: >
  Redacted generator, contract, profile, dry-run, live-read, pagination, error,
  artifact, secret, and ledger-isolation evidence for the Google Ads sub-slice.
status: passed
version: 1.0
timestamp: 2026-07-14T13:14:48+08:00
resource: ./google-ads-migration-matrix.md
---

# gkit Slice 4 Google Ads Baseline

## Verdict

**PASS for the single-account sub-slice.** Six reviewed Google Ads REST `v24`
capabilities are discoverable and executable through the shared gkit surface.
The real `openclaw-web` profile completed local readiness, dry-run, all six live
reads, and one expected provider error without exposing manager routing.

This does not complete the Bing or remaining-provider portions of Slice 4. It
also does not claim MCC support: `loginCustomerId` is rejected by the profile
and argv contracts until the separate real-MCC gate passes.

## Generated surface

- Pinned Discovery revision: `20260624`.
- Pinned source SHA-256:
  `202028d3abcb9e4681d35f3c28d06e6ced1eaac2ec57c56357c8ab5d522841d7`.
- Inventory: 176 REST methods, five executable methods, 171 inventory-only.
- Executable capabilities: accessible customers, field search, field describe,
  paginated GAQL, Keyword Ideas, and Keyword Historical Metrics.
- The reviewed policy approval is bound to the source checksum; all three
  generated-provider `--check` commands passed byte-stably.
- Root discovery schema remained 1,961 bytes.

## Real profile gate

- The new `openclaw-web.json` descriptor contains only the non-secret customer
  scope and `env:` references. Its mode is `0600`.
- `doctor` validated the single-account config, secret references, and local
  service-account file. It returned `networkProbe:"unknown"` and sent no OAuth
  or provider request.
- Same-input GAQL dry-run returned the pinned `v24` endpoint,
  `authMode:"service_account"`, and `managerRouting:false`. It did not derive
  an access token or create an artifact.

## Live gate

| Capability                                            | Pages | Rows | Artifact bytes |
| ----------------------------------------------------- | ----: | ---: | -------------: |
| `google-ads.customers.list-accessible`                |     1 |    1 |             58 |
| `google-ads.fields.describe`                          |     1 |    1 |            280 |
| `google-ads.fields.search`                            |     2 |    2 |            662 |
| `google-ads.query.gaql`                               |     1 |   12 |          2,654 |
| `google-ads.keyword-plan.generate-ideas`              |     1 |   12 |         20,917 |
| `google-ads.keyword-plan.generate-historical-metrics` |     1 |    1 |          1,904 |

The field search deliberately used a one-row page size and proved a real
two-page `pageToken` loop. Each command returned a safe provider request ID and
an atomic artifact receipt. Artifacts are JSON arrays of exact REST page
payloads, allowing streaming publication without buffering all result rows.

The negative GAQL call returned exit 1 with HTTP `400`, status
`INVALID_ARGUMENT`, allowlisted code `queryError:UNRECOGNIZED_FIELD`, a request
ID, and a 534-byte raw error artifact. Provider-controlled error text was not
copied into the envelope.

## Safety and regression evidence

- Seven artifacts totaled 27,009 bytes; every artifact parsed as a page bundle
  and had mode `0600`.
- Every live publication scanned the derived access token, developer token,
  and service-account private key. A second persistent-secret scan found zero
  developer-token or private-key variants.
- Every live envelope had `effects:["read"]`, `cost:null`, `attemptId:null`, and
  `spendOutcome:null`. The spend ledger remained at eight attempts, zero
  unresolved outcomes, and zero policy breaches; no Google Ads attempt exists.
- Package verification: 17 test files, 115 tests, and 424 expectations passed.
- Workspace verification: all ten package typechecks and 61 test files with
  255 tests and 853 expectations passed. Frozen install reported no changes.

## Retirement decision

The legacy package remains. Accounts, raw GAQL, Keyword Ideas, and Historical
Metrics now have implemented gkit replacements with live evidence. Legacy
doctor network semantics and four curated performance commands remain `keep`;
the Python installer is `drop` only when the package is eventually retired.
