---
type: Reference
title: SiteSnapshot CLI
description: Portable page facts, offline SEO audits and comparisons, and optional Git-backed Grok explanations.
status: implemented-in-source
version: 0.3
generated: { by: codex, at: 2026-09-08 }
---

# Contract

`gkit site` consumes and produces explicit artifacts. A **SiteSnapshot** directory is the durable input to every audit and comparison. The caller chooses and stores both snapshots. There is no internal database, release cursor, or selected baseline.

```text
Published sitemap XML      → Routes + discovery evidence
Nuxt .output or public HTTP → SiteSnapshot
SiteSnapshot + rules        → Audit
SiteSnapshot A + B          → Page and finding diff
Diff + exact Git trees      → Optional Grok explanation
```

The CLI does not build source commits, discover every route, schedule itself, select the latest deployment, or infer that a supplied SHA is serving production. Capture an actual build while it exists; rebuilding an old SHA today creates a new observation under today's inputs.

# Commands

```bash
gkit --schema site
gkit --profile example site doctor
gkit --profile example site discover --out /absolute/path/routes

gkit --profile example site snapshot \
  --build /absolute/path/.output --revision release-tag \
  --context fixed-api-fixture-v1 --routes @routes.json \
  --out /absolute/path/snapshot-a

gkit site audit /absolute/path/snapshot-a --out audit.json
gkit site diff /absolute/path/snapshot-a /absolute/path/snapshot-b --out diff.json

gkit --profile example site explain /absolute/path/snapshot-a /absolute/path/snapshot-b \
  --repo /absolute/path/checkout --model MODEL --dry-run --out explain-input.json
```

`doctor`, `discover`, `snapshot`, and `explain` require an explicit profile. `snapshot` requires exactly one of `--build` or `--http`, an explicit `--context`, and a new output directory. Build capture also requires `--revision`. `--repo` resolves that revision locally; omitting it uses `gh api repos/OWNER/REPO/commits/REF`. Both resolve to an exact SHA. The profile declares the repository; the local checkout and artifact remain caller-supplied associations, not attested build provenance.

For public endpoint observations:

```bash
gkit --profile example site snapshot --http --context production-public \
  --out /absolute/path/production-2026-09-08
```

HTTP capture may omit `--revision` and record an unassociated version. Supplying one labels the observation without proving a deployment. Capture respects declared origins and robots policy, uses `GkitSiteSnapshot/1`, and sends no application login credentials.

`audit` and `diff` need no profile, network, Git, or model. `--rules @rules.json` re-evaluates existing facts. JSON is the default; `--format markdown` requires `--out`. Existing output paths are rejected. A valid artifact can contain failed pages or findings: inspect coverage/results, not just `ok` or exit code.

`snapshot --dry-run` validates local configuration and prepares routes without resolving refs, starting servers, fetching pages, or writing a snapshot. `explain --dry-run` writes the bounded model input and response schema; it reads Git and may fetch repository objects when `--repo` is omitted, but does not invoke Grok.

# Route discovery

`site discover --out <new-directory>` reads `/sitemap.xml` from the first configured origin by default. `--sitemaps @urls.json` supplies explicit sitemap roots. Nested indexes and gzip files are supported; a strict XML parser rejects malformed input, missing/duplicate loc entries, unexpected roots and DTD declarations. XML namespace extensions are not mistaken for page URLs. The parser does not certify every sitemap protocol or search-engine requirement.

Sitemap requests stay within configured site origins and explicit root origins. To read a separately hosted CDN sitemap, pass `--sitemap-origins @origins.json`, containing extra HTTP(S) origins. This does not widen the allowed **page** origins. Redirects use the same source-origin boundary. Fetching sitemaps performs no page crawl and does not execute JavaScript.

The output directory contains `routes.json`, `manifest.json`, and `documents/<sha256>` with the fetched source bytes, including failed HTTP responses when available. The manifest records input seeds, roots, source/page origins, timestamps, source observations, checksums, rejected URLs and budget omissions. The manifest is written last. Configured seeds are included; duplicate URLs and cyclic indexes are deduplicated.

Defaults are 50 sitemap documents and 100,000 candidate URLs. `--max-sitemaps` accepts 1–500; `--max-urls` accepts 1–1,000,000. Request timeout, pacing and compressed/decompressed byte limits use the site configuration. A failed/deferred/excluded sitemap or a URL budget omission produces partial discovery coverage, with successful evidence preserved. Discovery completeness only describes the declared source traversal; it does not prove URL existence, indexability, deployment version or whole-site completeness. Rejected page URLs are retained separately.

`--dry-run` prepares inputs without network or output creation. Existing output directories are rejected before requests. Pass `--routes @<discovery>/routes.json` to capture the selected candidates. Snapshot currently accepts at most 10,000 explicit routes per invocation; larger catalogs must be partitioned into explicit batches by the caller. Discovery and page coverage are separate facts, even if one is complete.

# Profile configuration

Site configuration defaults to `<profile-directory>/<profile-name>/site.json`; the profile may instead declare `site.configFile`. Provider secrets remain managed by the existing profile implementation.

```json
{
  "version": 1,
  "site": "example.com",
  "origins": ["https://example.com"],
  "seeds": ["https://example.com/", "https://example.com/fr/"],
  "locales": ["en", "fr"],
  "github": { "repository": "owner/site" },
  "timeoutMs": 15000,
  "delayMs": 200,
  "maxBytes": 5000000,
  "rules": [{ "pathPrefix": "/", "indexable": true, "canonical": "self", "required": ["title", "description", "h1"] }]
}
```

`--routes @routes.json` replaces seeds with a JSON array of unique absolute URLs in the declared origins. Query-bearing URLs are unsupported. Locale paths and trailing-slash variants retain separate identities. `locales` documents intended scope; it does not generate routes. Rules use the longest matching path prefix. Canonical expectations are `self`, `present`, or `ignore`; `indexable: false` expects a noindex directive.

# Artifact layout

```text
snapshot-a/
  manifest.json
  pages.jsonl
  content/<sha256>
```

The manifest records schema/extractor versions, source kind, exact source version when supplied, build digest when applicable, runtime context label, timestamps, declared routes, coverage, default expectations, and the page index checksum. The context label is a caller assertion about inputs, not a capture of environment variables or external API/CMS versions. Change it when inputs are known to differ; matching labels do not prove reproducibility or causation.

Each JSONL row has URL, observation time, capture mode, status/error, HTTP status, final URL, redirect chain, selected response headers, extracted fields, and a document hash. Content is the UTF-8 document used by the extractor, including unsuccessful HTTP responses when available. Fields cover title, description, H1, canonical, robots, HTML language, hreflang, links, and normalized body-text hash. HTML remains available for future extraction; body text itself is not embedded in the diff.

The manifest is written last. Readers verify its fingerprint, page index checksum, route/coverage consistency, and referenced content hashes. Moving the entire directory preserves identity and offline usability. Checksums detect corruption, not authorship. `complete` means all **declared routes** were observed, not that every public URL was discovered or every SEO rule passed.

# Nuxt adapter

The adapter reads matching `.output/public/index.html`, `path/index.html`, or `path.html` when present. These observations use `prerender` mode and have no invented HTTP status or response headers.

For remaining URLs, it starts that artifact's `.output/server/index.mjs` with the host Node runtime on loopback, supplies logical host/protocol headers, and fetches server-rendered HTML in `server-http` mode. The child inherits the caller's runtime environment; runtime API requests may occur. The build digest is checked before and after capture. The server stops on completion or cancellation. This adapter targets Node server output; it does not execute hydration, browser-only JavaScript, or other deployment presets.

Build snapshots reveal generated/SSR content under supplied inputs. Production HTTP snapshots reveal actual endpoint responses at observation time. CDN behavior, served-SHA attestation, CMS replay, screenshots, and performance measurements require additional evidence.

# Audit and comparison

Deterministic checks cover HTTP errors, redirect chains, required fields, index directives, canonical count/target, hreflang syntax/targets/return links, and broken links to observed targets. Unvisited targets are unknown. Sitemap collection/parsing errors are recorded by `discover`; they are separate from page findings. Browser rendering remains outside this slice.

Page comparison requires matching site/origins, source kind, context label, extractor version, and per-page capture mode. Missing or failed observations are `unobserved`; different capture conditions are `incomparable`. Missing routes do not prove deletion.

Both snapshots are audited with the same current implementation. Finding transitions require matching expectations and sufficient observations on both sides, including relevant relationship targets. States are `new`, `persistent`, `resolved`, or `observed_only`. A target losing HTML cannot demonstrate a repaired hreflang return link; a 404 replacing a page cannot demonstrate repaired metadata.

`resolved` means the selected rule no longer fails in comparable observations. Issue/PR progress, deployment, production verification, and business performance are separate facts.

# Git and Grok

Explanation compares exact commit trees with `git diff A B`, with external diff/textconv disabled. A local checkout must contain both objects. Without `--repo`, the command fetches those objects into a temporary bare repository using host `gh` credentials, then removes it. There is no checkout mutation or first-commit history replay.

The model gets at most 40 useful changed-file patches, each limited to 12,000 characters, plus small Nuxt/layout/config context within a shared 100,000-character source budget. Environment files, lockfiles, maps, generated output, and dependencies are excluded. Page changes and findings have separate count/character limits; omitted records and file names are counted. Filtering bounds relevance and size; it is not a general secret scanner for arbitrary source files. `--dry-run` exposes the exact input.

Remove `--dry-run` and choose a new output path to invoke the installed host `grok` CLI. `--model` is required. gkit disables tools, subagents, web search, and planning, requests one turn and structured output, and validates cited page URLs/code paths. Interpretations include confidence, caveats, and unknowns.

Successful results are cached at `<profile-directory>/<profile-name>/cache/site-explanations/<fingerprint>.json`. The key includes exact prompt/input, schema, model, Grok CLI version, and flags. Cache entries are validated, disposable, and regenerated after corruption/deletion. Cache write failure does not discard a valid explanation. The requested report is a separate artifact.

Grok uses host authentication/billing. This integration does **not** pass through gkit provider metering or enforce a gkit dollar budget; envelope cost is unknown (`null`). Automated tests exercise a subprocess fixture; a paid live model call has not been verified in this slice.

# Warehouse and migration

Ingest each validated artifact as an immutable batch. Use `snapshot_id` for snapshots and `(snapshot_id, url)` for pages. Join manifest source metadata onto page rows and retain content under the artifact prefix or a hash-addressed object store. Audit/diff reports have separate IDs, input references, and rule versions. SQLite or warehouse indexes can be rebuilt from artifacts.

Do not make `(commit_sha, url)` unique: a SHA can have multiple observations. GSC/PostHog join by site/URL/time; deployments join by repository/SHA plus event evidence. The CLI performs no warehouse upload, metric ingestion, scheduling, or PR/issue synchronization.

The earlier unshipped `sync`, `releases`, `findings`, and `export` ledger commands are replaced. Existing ledger data is not modified or deleted. Historical observations may be converted once with original page timestamps and provenance; unavailable historical pages must stay unavailable.

# Validation

From the repository root: `bun run check-types`, `bun run test`, and `bun run verify:package`. The package check installs the tarball in an isolated directory and loads discovery with an isolated profile, without network capture. Current validation includes 190 tests and 15 CLI scenarios covering static/SSR capture, relocation, offline audit/diff, coverage, corruption, output reservation, exact Git input, and disposable caching. Real Nuxt 4.4.2 build evidence lives in the product workspace, outside this generic package.
