# gkit evals

`tasks.jsonl` is the executable 40-task answer-key set for the vertical slices.
Each line is one independent prompt with:

- `kind`: explicit provider, business goal, long-tail native, or negative request.
- `answer`: the intended provider, capability, effects, command sequence, and
  observable process behavior.
- `legacy`: the workflow disposition at the slice where the task was recorded.
  `replace` requires behavioral evidence; historical `keep` rows were
  superseded by the sole consumer's final hard-cut decision; `drop` rejects the
  old surface.
- `slice1` / `slice2`: the task's exposure state at each DataForSEO vertical
  slice; `inventory` is discoverable evidence but cannot be routed.

## Manual evaluation

1. Start a fresh agent session with only `gkit --schema`, `gkit docs`, and the
   prompt.
2. Record discovery steps before the first executable command.
3. Compare the selected provider, capability ID, effects, command, exit code,
   stdout envelope, stderr, and artifact behavior with the answer key.
4. A future-slice task is not an earlier-slice failure. Evaluate the selected
   slice's `executable`, `inventory`, and `negative` tasks against their keys.
5. Never execute a paid command during evaluation unless the profile cap,
   invocation cap, and explicit spend acknowledgement are all present.

The Slice 5 targets are:

- provider top-1 accuracy: at least 95%;
- discovery: at most two steps before `describe` or execution;
- first executable command: at least 90%;
- negative precision: at least 95%, with zero provider network calls.

Run `bun run --filter gkit eval:slice5` to validate task distribution,
observation completeness, provider/capability/effect consistency, command
parsing, and all four thresholds. See [`slice5-baseline.md`](./slice5-baseline.md)
for the result and [`slice5-final-migration-matrix.md`](./slice5-final-migration-matrix.md)
for final command and package dispositions.

## Final hard cut

The sole consumer subsequently deleted every old CLI package. Earlier baseline
sections below remain chronological evidence, not current installation state.
The authoritative final state is 33 replaced old commands, 41 explicitly
dropped commands, and only `packages/gkit` remaining.

## Slice 1 dogfood

The canonical policy is defined in
[`docs/plans/2026-07-13-gkit-vertical-slice-plan.md`](../../../docs/plans/2026-07-13-gkit-vertical-slice-plan.md#slice-1-immediate-dogfood-gate2026-07-14-已完成).
The operational decision is:

- execute the two Slice 1 `executable` tasks and both `negative` tasks
  immediately; no calendar wait is required for the sole CLI consumer;
- keep live bulk-ranks inputs within 1–166 targets; the current `$0.03` profile
  cap blocks 167–1,000 targets and dogfood must not split them automatically;
- do not shadow, double-dispatch, or automatically fall back to a paid legacy
  path;
- keep unsupported manifest gaps on their current legacy CLI and record them as
  `legacy_keep` rather than manufacturing a gkit failure;
- cap this gate at `$0.15` of authorized exposure and two paid dispatches, with
  exactly one allowed live attempt per executable task;
- run the same-input dry-run with the current `$0.03` profile hard cap, then
  tighten the live invocation cap to the exact returned cost upper bound;
- stop paid dogfood on unknown/unresolved spend, policy breach, suspected
  credential exposure, journal/artifact integrity failure, or duplicate
  dispatch.

Only a pre-authorization failure with `outcome:not_dispatched`,
`operationId:null`, and no new durable journal attempt may be corrected
once. A non-null operation ID ends retries and fallback for that task. Settled
confirmed outcomes are recorded as-is; only unresolved/unknown outcomes require
reconciliation.

The single allowed break-glass legacy call is not outside the budget: it counts
as one of the two paid dispatches and must fit the remaining `$0.15` authorized
exposure. Record its reviewed maximum, actual cost in integer micros, and a
non-secret local evidence reference in the dogfood event. If actual legacy cost
cannot be confirmed, stop paid dogfood and fail the window as an external
unknown outcome.

Provider commands on the current machine use the linked binary with explicit
profile selection. Credentialed execution loads the optional profile-adjacent
`.env` automatically, while explicit process environment values take priority:

```bash
gkit --profile clonesite.ai dataforseo ...
```

Append minimal events to `$XDG_STATE_HOME/gkit/dogfood/events.jsonl`, falling
back to `~/.local/state/gkit/dogfood/events.jsonl`, and keep sanitized
command/envelope receipts in `receipts.jsonl` beside it. These files, request
bodies, and raw artifacts stay local and never enter Git. Join cost and spend
outcome from the operation journal (`gkit operations show --id <operationId>`); do not copy secrets into dogfood
evidence. After the gate, commit only a redacted aggregate to
`evals/baseline.md`.

The immediate run completed on 2026-07-14 with all four tasks passing, two
first-attempt live successes, `$0.048180` total cost, and zero unresolved spend,
policy breaches, retries, fallbacks, secret findings, or artifact integrity
failures. See [`evals/baseline.md`](./baseline.md) for the redacted evidence.

## Slice 2 evidence

Slice 2 generated a 554-operation inventory from a pinned upstream OpenAPI
snapshot while exposing only four reviewed operations. Summary, referring
domains, and Google Organic Live Advanced each passed same-input dry-run and a
single live dispatch. Actual new spend was `$0.050072`; the ledger ended with
zero unresolved attempts and zero policy breaches.

LLM Mentions remains inventory-only because its `$0.10` request floor is above
the current `$0.03` profile hard cap. See
[`slice2-baseline.md`](./slice2-baseline.md) for redacted execution evidence and
[`dataforseo-migration-matrix.md`](./dataforseo-migration-matrix.md) for the
command-level retirement decisions. No legacy package is deleted by this slice.

## Slice 3 evidence

Slice 3 selected PostHog from current repeated workspace demand. A pinned
2,516-operation OpenAPI inventory exposes only one reviewed capability:
`posthog.query.run`. One bounded live HogQL read returned ten rows and two
columns into an atomic raw artifact without changing the spend ledger.

See [`slice3-baseline.md`](./slice3-baseline.md) for the redacted gate evidence
and [`posthog-migration-matrix.md`](./posthog-migration-matrix.md) for the
command-level retirement decisions. The legacy PostHog package remains because
twelve command behaviors are still `keep`; no provider runtime interface was
extracted because the second adapter did not reveal a branch-removing seam.

## Google Ads REST spike evidence

The Slice 1.5 spike pinned Google Ads REST `v24` and used the real
`openclaw-web` profile. Service-account OAuth, accessible customers, field
metadata, paginated GAQL, Keyword Ideas, historical metrics, provider errors,
request IDs, atomic artifacts, and secret scanning all passed. REST and the
legacy Python client matched on the compared row counts and provider behavior.

The profile has no directly accessible manager account, so manager-to-child
`login-customer-id` behavior remains a separate live gate. This does not block
the current sole consumer's single-account Slice 4 surface, but gkit must not
claim manager support until that gate passes. See
[`google-ads-rest-spike.md`](./google-ads-rest-spike.md) for the redacted
evidence and
[`google-ads-migration-matrix.md`](./google-ads-migration-matrix.md) for the
command-level decisions. The legacy Google Ads package remains installed.

## Slice 4 Google Ads evidence

The Google Ads sub-slice now productizes the scoped Slice 1.5 result. A pinned
`v24` Discovery snapshot generates a 176-method inventory and six reviewed
single-account read capabilities. The real profile passed doctor, same-input
dry-run, all six live reads, a real two-page field query, and one expected
provider error.

Seven local artifacts totaled 27,009 bytes, all parsed as streamed raw-page
bundles with mode `0600`, and secret scanning found no credential material.
Google Ads remained isolated from the spend ledger. See
[`slice4-google-ads-baseline.md`](./slice4-google-ads-baseline.md) for the
redacted productization evidence. Manager routing, legacy doctor network
semantics, and four curated performance commands remain outside the replaced
surface, so the legacy package is not deleted.

## Slice 4 Bing evidence

The Bing sub-slice exposes all 17 existing JSON read methods through a pinned,
checksum-bound contract. Request planning preserves provider-required JSON
string query encoding and `apikey` authentication while emitting only a
key-free `diagnosticUrl`. Plain and URL-encoded key variants are absent from
all tested result and failure paths. The real `openclaw-web` profile then
passed all 17 reads against `openclawai.io` and all 17 same-input legacy calls.
Fifteen result payloads matched exactly; the two query-list payloads contained
the same rows in provider-varying order.

Seventeen gkit artifacts totaled 26,855 bytes, all JSON and mode `0600`;
combined gkit and legacy evidence contained no API-key value. Bing remained
isolated from the spend ledger. All provider-data commands are now `replace`,
while the legacy network-aware doctor remains `keep`, so the old package is not
deleted in this slice.
See [`slice4-bing-baseline.md`](./slice4-bing-baseline.md) and
[`bing-migration-matrix.md`](./bing-migration-matrix.md).

## Slice 4 GSC evidence

The GSC sub-slice inventories ten official methods and exposes five read-only
capabilities using service-account OAuth with the `webmasters.readonly` scope.
The real `openclaw-web` profile completed properties, Search Analytics,
sitemap list/get, URL Inspection, and an inaccessible-property negative.
Same-input legacy calls matched the two-property, 25-row, one-sitemap, selected
sitemap, and indexed-URL outcomes.

Six raw JSON artifacts totaled 6,776 bytes, all mode `0600`; secret scanning
found no persisted credential material and the spend ledger remained unchanged.
See [`slice4-gsc-baseline.md`](./slice4-gsc-baseline.md) and
[`gsc-migration-matrix.md`](./gsc-migration-matrix.md). The provider data
surface is replaced, but the legacy network-aware doctor remains `keep`.
