# gkit

Profile-bound CLI for agent-first access to growth providers (DataForSEO,
PostHog, Google Ads, Google Search Console, Bing Webmaster). One invocation
binds exactly one App profile. It does not scaffold credentials, merge
profiles, or publish to an npm registry — install from GitHub Release
tarballs.

gkit uses argc only to render the offline schema. The public dispatcher is
spaced commands (`gkit gsc api call`), not argc dotted paths or `@run`.

## Discover Capabilities First

This skill is a recipe guide, not a complete capability list. Discovery is
offline and does not load a profile or resolve secrets:

```bash
gkit --schema
gkit --schema gsc
gkit describe --id gsc.search-analytics.query
gkit docs --provider gsc
```

## Core Workflow

Create `$XDG_CONFIG_HOME/gkit/profiles/<app>.json` (or
`~/.config/gkit/profiles/<app>.json`) with provider config and `env:` secret
references only. Inject the real values at runtime. Then:

```bash
gkit --profile my-app gsc doctor
gkit --profile my-app gsc api call --operation-id gsc.properties.list --input @request.json --out result.json --dry-run
```

`--profile` wins over `GKIT_PROFILE`. DataForSEO spend calls also need
`--allow-spend` and `--max-spend-usd`. Write capabilities such as
`gsc.sitemaps.submit` need `--allow-write`, including on `--dry-run`. Default artifact behavior is
no-replace; add `--force` only after reviewing the destination.

## Anti-Patterns

| Don't | Do | Why |
| --- | --- | --- |
| Call `gkit gsc.api.call` or `@run` | Use spaced `gkit gsc api call` | argc's dispatcher is not the public surface |
| Put tokens in the profile, repo, or argv | `env:NAME` references, inject at runtime | Profiles hold non-secret defaults |
| Skip doctor before a live request | `gkit --profile <app> <provider> doctor` | Fail closed on missing config or secrets |
| Pipe a provider payload into context | Persist with `--out` and re-read | stdout is an envelope; the bulk is a file |
| Merge two App profiles in one process | One profile per invocation | Binding is exclusive |
| Add `--allow-write` to reads or by habit | Only for a reviewed write after its dry-run | Writes change provider state |
