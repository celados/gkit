---
type: Evaluation
title: gkit Google Ads REST feasibility spike
description: >
  Redacted live evidence for the pinned Google Ads REST read surface, including
  service-account OAuth, pagination, Keyword Planner, errors, artifacts, and
  the remaining manager-account gate.
status: conditional-pass
version: 1.0
timestamp: 2026-07-14T12:02:04+08:00
resource: ../../../docs/plans/2026-07-13-gkit-vertical-slice-plan.md
---

# gkit Google Ads REST feasibility spike

## Verdict

**CONDITIONAL PASS.** The bounded, single-account Google Ads read surface can
be implemented in-process with TypeScript and REST. A real profile completed
service-account OAuth and live calls for accessible customers, field metadata,
GAQL, Keyword Ideas, and historical metrics. The REST results matched the
legacy Python client at the compared behavior boundary.

The profile exposed one directly accessible non-manager account, so it could
not supply a truthful manager-to-child test. Slice 4 may implement the
single-account surface needed by the current sole CLI consumer, but gkit must
not claim or expose verified `login-customer-id` support until a real MCC
profile passes that smoke test. This is a scoped version of gate outcome (a),
not evidence that the manager scenario passed.

## Pinned contract

- API major: `v24`; no `latest` alias or implicit version.
- Discovery revision: `20260624`.
- Discovery document SHA-256:
  `202028d3abcb9e4681d35f3c28d06e6ced1eaac2ec57c56357c8ab5d522841d7`.
- Upgrade procedure: manually bump the major, refresh the discovery snapshot,
  review the source/manifest/docs diff, then run contract tests and the bounded
  live smoke again.
- `googleAds:search` uses its explicit `pageToken` loop. No `searchStream`
  dependency was needed by the observed workload.

## Live coverage

The isolated spike made ten REST calls: nine expected `200` responses and one
expected `400` negative response.

| Surface              | Observed result                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| OAuth                | service-account credentials produced a derived access token; the token was registered as a secret immediately |
| Accessible customers | one directly accessible account; zero directly accessible manager accounts                                    |
| Field metadata       | two pages and two rows with a real `pageToken` loop                                                           |
| Small GAQL           | one page and 12 campaign rows; legacy and REST row counts matched                                             |
| Larger GAQL          | one page and 850 search-term rows; peak observed heap delta was 1,266,192 bytes                               |
| Keyword Ideas        | two pages and four rows using a real `pageToken`; legacy and REST counts matched                              |
| Historical metrics   | one page and one row; legacy and REST counts matched                                                          |
| Negative GAQL        | HTTP `400`, status `INVALID_ARGUMENT`, allowlisted code `queryError:UNRECOGNIZED_FIELD`, and a request ID     |

REST response fields are provider-native camelCase. The legacy Python wrapper
converted protobuf messages to snake_case; gkit should preserve the REST
payload rather than reproduce that SDK formatting preference.

## Artifact and secret evidence

- Every response, including the negative response, was written as an exact
  atomic raw artifact under local gkit state.
- Ten artifacts totaled 279,092 bytes. The largest was 265,558 bytes with
  SHA-256
  `1ed7c6abdeb5841b9352bf461a20d9a0eb1b2c61dca0391f24ea3341ff6ed15f`.
- Developer token, derived access token, service-account private key, and other
  registered secret variants were absent from the sanitized summary and
  persisted artifacts.
- Diagnostics used fixed-origin, token-free URLs. Error projection retained
  only HTTP status, provider status/code, and request ID.
- The larger query did not justify `searchStream`: explicit pagination plus
  per-page artifact writes remained bounded at the observed size.

## Profile and migration findings

The real profile uses a service-account JSON credential, not a refresh token.
Google Ads REST supports that OAuth mode, so Slice 4 should be
service-account-first and treat user refresh-token auth as an additional mode
only when a real profile requires it.

The renamed profile root is `~/.config/gkit/profiles`; the legacy shared
runtime still defaults to `~/.config/product-growth-tools/profiles`. The live
legacy comparison therefore required an explicit profile-root override. This
is migration friction, not a REST capability failure.

The legacy local Python environment initially lacked its SDK dependency. It
was installed only to run the comparison; no Python runtime is required by the
REST result. See
[`google-ads-migration-matrix.md`](./google-ads-migration-matrix.md) for the
command-level disposition.

## Deferred gate

Before gkit exposes manager-account behavior, use a profile with a directly
accessible MCC and one child account, send the child as `customerId` and the
MCC as `login-customer-id`, and rerun accessible-customer, GAQL, error, request
ID, and secret-scan checks. A mocked header contract test is still required in
Slice 4, but it does not substitute for that live gate.
