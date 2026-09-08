import { describe, expect, it } from "vitest";
import * as v from "valibot";
import { audit, extractFields } from "./audit";
import { compareSnapshots, evaluateSnapshot } from "./compare";
import { parseSiteArgs } from "./commands";
import { hash, siteConfigSchema, type PageSnapshot, type SnapshotSource } from "./model";
import { makeSnapshot } from "./snapshot";
const config = v.parse(siteConfigSchema, {
  version: 1,
  site: "example.com",
  origins: ["https://example.com"],
  seeds: ["https://example.com/"],
  github: { repository: "owner/site" },
  delayMs: 0,
});
const html =
  '<html><head><title>Hello</title><meta name="description" content="Example"><link rel="canonical" href="/"></head><body><h1>Hello</h1></body></html>';
const source: SnapshotSource = {
  kind: "nuxt-build",
  build_digest: hash("build"),
  version: {
    repository: "owner/site",
    commit_sha: "a".repeat(40),
    ref: "a",
    resolved_by: "local-git",
  },
  association: "caller-supplied-build",
  runtime_context: "fixture",
};
const page = (text = html): PageSnapshot => ({
  url: config.seeds[0]!,
  observed_at: "2026-09-08T00:00:00Z",
  status: "observed",
  http_status: 200,
  final_url: config.seeds[0]!,
  redirects: [],
  html_hash: hash(text),
  fields: extractFields(text, config.seeds[0]!, null),
  error: null,
  mode: "server-http",
  response_headers: { "content-type": "text/html" },
});
const snapshot = (pages = [page()], inputSource: SnapshotSource = source) =>
  makeSnapshot(
    config,
    pages.map((p) => p.url),
    pages,
    inputSource,
    "2026-09-08T00:00:00Z",
  );
describe("SiteSnapshot functions", () => {
  it("uses parsed HTML entities and header directives", () => {
    const fields = extractFields(html.replace("Hello", "A &amp; B"), config.seeds[0]!, "noindex");
    expect(fields.title).toBe("A & B");
    expect(audit([{ ...page(), fields }], config).map((f) => f.rule)).toContain("index-directive");
  });
  it("does not treat wording changes as findings", () => {
    const diff = compareSnapshots(snapshot(), snapshot([page(html.replaceAll("Hello", "World"))]));
    expect(diff.summary.changed_pages).toBe(1);
    expect(diff.summary.new_findings).toBe(0);
  });
  it("re-evaluates rules without changing a snapshot", () => {
    const s = snapshot();
    const before = JSON.stringify(s);
    const alternate = [
      { pathPrefix: "/", indexable: false, canonical: "self" as const, required: [] },
    ];
    expect(evaluateSnapshot(s, alternate).findings).toHaveLength(1);
    expect(JSON.stringify(s)).toBe(before);
  });
  it("resolves only when both pages have relevant observations", () => {
    const a = snapshot([page(html.replace('<link rel="canonical" href="/">', ""))]);
    const b = snapshot();
    expect(compareSnapshots(a, b).summary.resolved_findings).toBe(1);
    b.pages[0]!.status = "failed";
    expect(compareSnapshots(a, b).summary.resolved_findings).toBe(0);
    b.pages[0] = { ...page(), http_status: 404, fields: null };
    expect(compareSnapshots(a, b).summary.resolved_findings).toBe(0);
  });
  it("keeps unobserved URLs unknown rather than deleted", () => {
    const a = snapshot();
    const b = snapshot([{ ...page(), url: "https://example.com/fr" }]);
    expect(compareSnapshots(a, b).coverage.comparable_urls).toBe(0);
    expect(compareSnapshots(a, b).pages.every((p) => p.status === "unobserved")).toBe(true);
  });
  it("does not compare build and production modes as release regressions", () => {
    const a = snapshot();
    const b = snapshot([page()], {
      kind: "production-http",
      version: null,
      association: "unassociated",
      runtime_context: "fixture",
    });
    expect(compareSnapshots(a, b).coverage.conditions_match).toBe(false);
    expect(compareSnapshots(a, b).summary.new_findings).toBe(0);
  });
  it("detects different capture conditions and renderer modes", () => {
    const a = snapshot();
    const b = snapshot();
    b.manifest.source.runtime_context = "other";
    expect(compareSnapshots(a, b).coverage.conditions_match).toBe(false);
    b.manifest.source.runtime_context = "fixture";
    b.pages[0]!.mode = "prerender";
    expect(compareSnapshots(a, b).pages[0]?.status).toBe("incomparable");
  });
  it("cannot resolve relations with an unobserved target", () => {
    const linked = page(html.replace("</body>", '<a href="/dead">Broken</a></body>'));
    const target = { ...page(), url: "https://example.com/dead", http_status: 404, fields: null };
    const a = snapshot([linked, target]);
    const b = snapshot([linked, { ...target, status: "failed" }]);
    expect(
      compareSnapshots(a, b).findings.find((f) => f.rule === "internal-dead-link")?.state,
    ).toBe("observed_only");
  });
  it("uses the final URL for hreflang return links", () => {
    const a = {
      ...page(html.replace("</head>", '<link hreflang="fr" href="/fr"></head>')),
      url: "https://example.com/en/",
    };
    const b = {
      ...page(html.replace("</head>", '<link hreflang="en" href="/"></head>')),
      url: "https://example.com/fr",
    };
    expect(
      audit([a, b], config).filter((f) => f.rule === "hreflang-return-link" && f.url === a.url),
    ).toEqual([]);
  });
  it("does not resolve hreflang return links when the target loses HTML evidence", () => {
    const linked = page(html.replace("</head>", '<link hreflang="fr" href="/fr"></head>'));
    const target = {
      ...page(),
      url: "https://example.com/fr",
      final_url: "https://example.com/fr",
    };
    const a = snapshot([linked, target]);
    for (const http_status of [200, 404]) {
      const b = snapshot([linked, { ...target, http_status, fields: null }]);
      expect(
        compareSnapshots(a, b).findings.find((f) => f.rule === "hreflang-return-link")?.state,
      ).toBe("observed_only");
    }
  });
  it("compares selected HTTP headers while ignoring object key order", () => {
    const a = page();
    const b = page();
    a.response_headers = { "content-type": "text/html", "cache-control": "max-age=60" };
    b.response_headers = { "cache-control": "max-age=60", "content-type": "text/html" };
    expect(compareSnapshots(snapshot([a]), snapshot([b])).summary.changed_pages).toBe(0);
    b.response_headers["cache-control"] = "no-store";
    expect(compareSnapshots(snapshot([a]), snapshot([b])).pages[0]?.changes[0]?.field).toBe(
      "response_headers",
    );
  });
  it("keeps the identity of singleton failures stable as evidence changes", () => {
    const a = page();
    const b = page();
    a.fields!.canonical = ["https://example.com/a"];
    b.fields!.canonical = ["https://example.com/b"];
    expect(audit([a], config)[0]?.id).toBe(audit([b], config)[0]?.id);
  });
  it("requires explicit snapshot source and provenance, and removes ledger commands", () => {
    expect(() => parseSiteArgs(["snapshot", "--out", "x"], "app")).toThrow();
    expect(() => parseSiteArgs(["sync"], "app")).toThrow();
    expect(() =>
      parseSiteArgs(
        [
          "snapshot",
          "--build",
          ".output",
          "--http",
          "--revision",
          "a",
          "--context",
          "x",
          "--out",
          "x",
        ],
        "app",
      ),
    ).toThrow();
    expect(parseSiteArgs(["diff", "a", "b"], null).action).toBe("diff");
    expect(
      parseSiteArgs(["snapshot", "--http", "--context", "live", "--out", "x", "--dry-run"], "app")
        .action,
    ).toBe("snapshot");
  });
});
