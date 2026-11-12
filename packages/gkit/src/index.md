# gkit

Profile-bound CLI for agent-first access to growth providers (DataForSEO, PostHog, Google Ads, Google Search Console, Bing Webmaster, HubSpot, PageSpeed). One invocation binds exactly one App profile. It does not scaffold credentials, merge profiles or publish to an npm registry: install from GitHub Release tarballs. Preflight: `gkit --profile <app> <provider> doctor` fails closed on missing config or secrets, so run it before a live request.

Commands are spaced (`gkit gsc api call`), not argc dotted paths, and gkit parses its own flags: argc's whole-input forms (`-` stdin, YAML, inline `'{…}'`) don't apply. `--input @request.json`, `--rules @rules.json` and the other `@file` flag values (`--sitemaps`, `--routes`) are gkit's own file references and take JSON files.

Read the section for your task, then only that slice: `gkit --schema gsc`, `gkit --schema operations` or `gkit --schema site`. A provider slice lists its capability ids and the flags `api call` takes. Discovery is offline and loads no profile or secrets; `gkit describe --id <capability-id>` and `gkit docs --provider <provider>` go deeper on one capability or provider.

## Profiles

Create `$XDG_CONFIG_HOME/gkit/profiles/<app>.json` (or `~/.config/gkit/profiles/<app>.json`) with provider config and `env:NAME` secret references only; inject the real values at runtime. Tokens never go in the profile, repo or argv. `--profile` wins over `GKIT_PROFILE`. One profile per invocation: never merge two.

## Calling a provider — `gkit --schema <provider>`

Providers: dataforseo, bing, posthog, google-ads, gsc, hubspot, pagespeed.

- Run a call with `--dry-run` first. The provider payload is a file, not stdout: pass `--out` and re-read it, because stdout is only an envelope. Default artifact behavior is no-replace; add `--force` only after reviewing the destination.
- DataForSEO spend calls also need `--allow-spend` and `--max-spend-usd`.
- Write capabilities (such as `gsc.sitemaps.submit`) need `--allow-write`, even on `--dry-run`. Add it only for a reviewed write after its dry-run, never to reads or by habit.

## Site facts — `gkit --schema site`

`site` turns a build or the public site into SiteSnapshot directories, then audits and diffs them offline; `site explain` adds an optional Git-backed Grok explanation. The caller chooses and stores snapshots: nothing is selected or recorded implicitly. Contract, route discovery, profile `site.json`, artifact layout and traps: `gkit @skill references/site.md`.

## Operation journal — `gkit --schema operations`

Every live call (not dry-runs, nor calls rejected before dispatch) is recorded in `$XDG_STATE_HOME/gkit/operations.jsonl` (or `~/.local/state/gkit/operations.jsonl`) and identified by `meta.operationId`. `operations list` shows a closed `state`: `succeeded` (provider success plus a recorded artifact), `failed`, `not_dispatched`, or `unknown` (the attempt crossed the provider seam without a confirmed result).

An `unknown` result, or an unknown spend amount, changes only through `operations reconcile --id <id> ... --evidence-ref <ref>` backed by provider evidence; a successful retry is a new operation, not evidence. So never rerun after `unknown` before reconciling: the first attempt may have taken effect.
