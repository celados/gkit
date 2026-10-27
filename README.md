# gkit

Profile-bound CLI for agent-first access to growth providers. This repository
has one CLI and one workspace package: `gkit`.

The reviewed provider surface includes DataForSEO, PostHog, Google Ads, Google
Search Console, Bing Webmaster, HubSpot, and PageSpeed Insights.

## Requirements

gkit runs on [Bun](https://bun.sh/). Confirm that Bun is available before
installing:

```bash
bun --version
```

gkit is distributed only as a public npm tarball attached to GitHub Releases.
It is not published to an npm registry, so the GitHub URL is required in every
install command.

## Install

Install the latest stable release globally:

```bash
bun add --global "gkit@https://github.com/celados/gkit/releases/latest/download/gkit.tgz"
gkit --schema gsc
```

If the install succeeds but `gkit` is not found, run `bun pm bin --global` and
make sure the printed directory is included in your `PATH`.

Install an exact version instead:

```bash
VERSION=0.1.3
bun add --global "gkit@https://github.com/celados/gkit/releases/download/v${VERSION}/gkit-${VERSION}.tgz"
gkit --schema
```

Prereleases are available only through their exact version URLs and never
replace the stable `latest` download.

Because the stable URL does not change between releases, remove the installed
copy before upgrading so Bun cannot reuse an older cached resolution:

```bash
bun remove --global gkit
bun add --global "gkit@https://github.com/celados/gkit/releases/latest/download/gkit.tgz"
gkit --schema gsc
```

To uninstall:

```bash
bun remove --global gkit
```

## Quick start

### 1. Discover capabilities

Discovery commands are offline and do not load a profile or resolve secrets:

```bash
gkit --schema
gkit --schema gsc
gkit docs --provider gsc
gkit describe --id gsc.properties.list
```

Use `gkit --help` for the complete command shape. Use `describe` before calling
an operation: it returns the reviewed input schema, effects, examples, and
artifact behavior for that capability.

### 2. Configure an App profile

Provider execution must bind exactly one App profile. Create one JSON file at
`$XDG_CONFIG_HOME/gkit/profiles/<app>.json`, or at
`~/.config/gkit/profiles/<app>.json` when `XDG_CONFIG_HOME` is unset:

```json
{
  "version": 1,
  "name": "my-app",
  "providers": {
    "posthog": {
      "config": {
        "host": "https://us.posthog.com",
        "projectId": "12345"
      },
      "secrets": {
        "apiToken": "env:MY_APP_POSTHOG_TOKEN"
      }
    },
    "gsc": {
      "config": {
        "siteUrl": "sc-domain:example.com"
      },
      "secrets": {
        "serviceAccountFile": "env:MY_APP_GSC_SERVICE_ACCOUNT_FILE"
      }
    },
    "hubspot": {
      "config": {},
      "secrets": {
        "accessToken": "env:MY_APP_HUBSPOT_ACCESS_TOKEN"
      }
    },
    "pagespeed": {
      "secrets": {
        "apiKey": "env:MY_APP_PAGESPEED_API_KEY"
      }
    }
  }
}
```

Profiles contain non-secret provider defaults and `env:` references only. Keep
the referenced values in the team's secret manager and inject them into the
gkit process at runtime. Do not put plaintext credentials in the profile,
repository, Agent instructions, command arguments, or shell startup files.

For local use, gkit also loads an optional profile-adjacent environment file at
`~/.config/gkit/profiles/<app>/.env` after the profile is selected. Keep this
file outside the repository with mode `0600`; explicitly supplied process
environment values take precedence over values in the file.

Select a profile explicitly:

```bash
gkit --profile my-app posthog doctor
gkit --profile my-app gsc doctor
gkit --profile my-app hubspot doctor
```

Or bind it for one process through the environment:

```bash
GKIT_PROFILE=my-app gkit posthog doctor
```

`--profile` takes precedence over `GKIT_PROFILE`. One invocation never merges
or falls back to another App profile. Compare multiple Apps by running separate
invocations and joining their outputs outside gkit.

### 3. Check the profile

Run `doctor` before making a provider request. It checks the selected profile
and its provider configuration without printing secret values:

```bash
gkit --profile my-app gsc doctor
gkit --profile my-app hubspot doctor
```

### 4. Preview, then execute

Start with the exact example returned by `describe` and keep `--dry-run` while
reviewing the request:

```bash
gkit --profile my-app gsc api call \
  --capability-id gsc.properties.list \
  --input '{}' \
  --out ./gsc-properties-plan.json \
  --dry-run
```

Remove `--dry-run` only when the profile and request are correct:

```bash
gkit --profile my-app gsc api call \
  --capability-id gsc.properties.list \
  --input '{}' \
  --out ./gsc-properties.json
```

Artifacts use no-replace behavior by default. Choose a new output path for a
later run, or add `--force` only after reviewing the existing destination.
DataForSEO operations that can spend money additionally require both
`--allow-spend` and an explicit `--max-spend-usd` limit. Operations that change
provider state, such as `gsc.sitemaps.submit`, require `--allow-write`; without
it gkit fails with `EFFECT_NOT_ALLOWED` before any request:

```bash
gkit --profile my-app gsc api call \
  --capability-id gsc.sitemaps.submit \
  --input '{"feedpath":"https://example.com/sitemap.xml"}' \
  --allow-write \
  --out ./gsc-sitemap-submit.json
```

Sitemap submission needs Full or Owner permission for the service account in
Search Console; a Restricted user receives `AUTH_FAILED`. Google returns an
empty body, so the artifact is a gkit receipt with `siteUrl`, `feedpath`, and
`httpStatus`.

Each live call is journaled under `meta.operationId`. Run `gkit operations` to
see recent operations and anything still `unknown`; reconcile those with
`gkit operations reconcile` and a provider evidence reference instead of
rerunning them.

### HubSpot read-only example

HubSpot uses one profile-bound private-app access token and calls the REST API
directly; `@hubspot/cli` and `hs` are not runtime dependencies. The V1 surface
uses HubSpot's current `2026-03` date-versioned endpoints and exposes only
reviewed reads. CRM Search remains a POST because that is HubSpot's read API,
but create, update, delete, send, and import operations are inventory-only and
cannot be dispatched.

```bash
gkit --profile my-app hubspot doctor
gkit describe --id hubspot.crm.objects.search
gkit --profile my-app hubspot api call \
  --capability-id hubspot.crm.objects.search \
  --input @hubspot-search.json \
  --out ./hubspot-contact-search.json \
  --dry-run
```

HubSpot artifacts can contain PII and confidential business data, including
contact and owner names or email addresses, ticket text, event URLs and
properties, object and association identifiers, company or deal details, and
pipeline or property metadata. Results are therefore artifact-only: the CLI
prints a compact envelope and receipt, never the unbounded CRM payload. Keep
artifacts access-controlled and request only the reviewed properties required
for the analysis. Search pages are capped at 200 and one search query cannot
page beyond 10,000 results; other list surfaces use lower reviewed page and
total-result bounds documented by `describe`.

### PageSpeed Insights example

`pagespeed.run` runs Lighthouse for one URL and returns category scores plus
whether Chrome UX Report field data exists for the URL and its origin; the raw
PageSpeed response is the artifact. The `apiKey` secret is optional: without it
requests share Google's low anonymous quota. Runs take tens of seconds.

```bash
gkit --profile my-app pagespeed doctor
gkit --profile my-app pagespeed api call \
  --capability-id pagespeed.run \
  --input '{"url":"https://example.com/","strategy":"mobile","categories":["performance","seo"]}' \
  --out ./pagespeed-home.json
```

## Configure an Agent

Agents do not need provider-specific CLIs or their own copies of credentials.
A repository can add the following contract to its `AGENTS.md`:

```md
## Growth provider access

- Use `gkit` for all growth-provider access.
- The default App profile for this repository is `<app-name>`.
- Before a live request, run `gkit --profile <app-name> <provider> doctor`.
- Discover capabilities with `gkit --schema`,
  `gkit docs --provider <provider>`, and
  `gkit describe --id <capability-id>`.
- Never read, record, or print provider secrets.
```

The Agent only needs to know that it should use gkit and which App profile owns
the task. CLI installation and secret access belong to the machine or runtime.

All former standalone provider and local-tool packages were removed after the
sole CLI consumer explicitly selected a hard cutover. There are no compatibility
aliases or deprecated binaries. Historical behavior evidence remains under
[`packages/gkit/evals`](packages/gkit/evals).

## Verification

Development dependencies include `@celados/argc` from the private team registry `npm.celados.com`. Before `bun install`, write a gitignored `.npmrc` that maps `@celados` to that registry with the team token (template: `.npmrc.tpl` in `celados/argc`, rendered with `latch render`). CI does the same from the `NPM_TOKEN` secret. The release artifact is a bundle and needs no registry access.

```bash
bun run eval
bun run check-types
bun run test
bun run verify:package
```
