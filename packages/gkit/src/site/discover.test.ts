import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import * as v from "valibot";
import { discoverRoutes, parseSitemap } from "./discover";
import { hash, siteConfigSchema } from "./model";
import { parseSiteArgs } from "./commands";

const xml = (kind: "urlset" | "sitemapindex", urls: string[]) => {
  const entry = kind === "urlset" ? "url" : "sitemap";
  return `<${kind} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<${entry}><loc>${url}</loc></${entry}>`).join("")}</${kind}>`;
};
async function fixture(work: (origin: string, root: string, hits: string[]) => Promise<void>) {
  let origin = "";
  const hits: string[] = [];
  const send = (response: ServerResponse, body: string | Buffer, status = 200) => {
    response.writeHead(status, { "content-type": "application/xml" });
    response.end(body);
  };
  const server = createServer((request, response) => {
    hits.push(request.url!);
    if (request.url === "/sitemap.xml")
      return send(
        response,
        xml("sitemapindex", [`${origin}/a.xml`, `${origin}/b.xml.gz`, `${origin}/sitemap.xml`]),
      );
    if (request.url === "/a.xml")
      return send(
        response,
        xml("urlset", [`${origin}/page`, `${origin}/fr/page`, `${origin}/page`]),
      );
    if (request.url === "/b.xml.gz")
      return send(
        response,
        gzipSync(xml("urlset", [`${origin}/ja/page`, "https://outside.invalid/page"])),
      );
    if (request.url === "/failed.xml")
      return send(
        response,
        xml("sitemapindex", [`${origin}/bad.xml`, `${origin}/missing.xml`, `${origin}/a.xml`]),
      );
    if (request.url === "/bad.xml")
      return send(
        response,
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>',
      );
    if (request.url === "/external.xml")
      return send(response, xml("sitemapindex", ["https://outside.invalid/secret.xml"]));
    if (request.url === "/redirect.xml") {
      response.writeHead(302, { location: "https://outside.invalid/secret.xml" });
      return response.end();
    }
    send(response, "Missing", 404);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture port unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  const root = await mkdtemp(join(tmpdir(), "gkit-discover-test-"));
  try {
    await work(origin, root, hits);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
}
const config = (origin: string) =>
  v.parse(siteConfigSchema, {
    version: 1,
    site: "fixture.example",
    origins: [origin],
    seeds: [`${origin}/`],
    github: { repository: "fixture/site" },
    delayMs: 0,
  });
describe("sitemap discovery", () => {
  it("reads namespaced loc entries without treating extension URLs as pages", () => {
    const result = parseSitemap(
      '<s:urlset xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:x="http://www.w3.org/1999/xhtml"><s:url><s:loc>https://example.com/?a=1&amp;b=2</s:loc><x:link href="https://elsewhere.invalid" /></s:url></s:urlset>',
    );
    expect(result.locations).toEqual(["https://example.com/?a=1&b=2"]);
  });
  it("rejects malformed XML, missing or duplicate loc, HTML and DTD declarations", () => {
    for (const input of [
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>',
      xml("urlset", ["https://example.com/"]).replace(
        "</loc>",
        "</loc><loc>https://example.com/b</loc>",
      ),
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url/></urlset>',
      "<html><body>Unavailable</body></html>",
      "<!DOCTYPE urlset>" + xml("urlset", []),
    ])
      expect(() => parseSitemap(input)).toThrow();
  });
  it("deduplicates cycles and URLs, expands gzip, and preserves source bytes", async () => {
    await fixture(async (origin, root, hits) => {
      const out = join(root, "discovery");
      const result = await discoverRoutes(config(origin), {
        roots: [`${origin}/sitemap.xml`],
        sitemapOrigins: [origin],
        maxSitemaps: 10,
        maxUrls: 100,
        out,
        signal: new AbortController().signal,
      });
      expect(result.manifest.coverage).toMatchObject({
        status: "complete",
        parsed_sitemaps: 3,
        included_urls: 4,
        rejected_urls: 1,
      });
      expect(hits).toHaveLength(3);
      const routes = await readFile(join(out, "routes.json"));
      expect(hash(routes)).toBe(result.manifest.routes.sha256);
      expect(JSON.parse(routes.toString())).toContain(`${origin}/fr/page`);
      const zipped = result.manifest.sitemaps.find((record) => record.url.endsWith("gz"))!;
      const body = await readFile(join(out, "documents", zipped.document_hash!));
      expect(body[0]).toBe(0x1f);
      expect(hash(body)).toBe(zipped.document_hash);
    });
  });
  it("retains failed sources and successful routes without claiming complete coverage", async () => {
    await fixture(async (origin, root) => {
      const result = await discoverRoutes(config(origin), {
        roots: [`${origin}/failed.xml`],
        sitemapOrigins: [origin],
        maxSitemaps: 10,
        maxUrls: 100,
        out: join(root, "out"),
        signal: new AbortController().signal,
      });
      expect(result.manifest.coverage).toMatchObject({
        status: "partial",
        failed_sitemaps: 2,
        included_urls: 3,
      });
      expect(
        result.manifest.sitemaps.find((record) => record.http_status === 404)?.document_hash,
      ).not.toBeNull();
    });
  });
  it("records explicit source and URL budget omissions", async () => {
    await fixture(async (origin, root, hits) => {
      const result = await discoverRoutes(config(origin), {
        roots: [`${origin}/sitemap.xml`],
        sitemapOrigins: [origin],
        maxSitemaps: 2,
        maxUrls: 2,
        out: join(root, "out"),
        signal: new AbortController().signal,
      });
      expect(result.manifest.coverage).toMatchObject({
        status: "partial",
        deferred_sitemaps: 1,
        included_urls: 2,
        omitted_urls: 1,
      });
      expect(hits).toHaveLength(2);
    });
  });
  it("does not follow external source or redirect origins", async () => {
    await fixture(async (origin, root, hits) => {
      const result = await discoverRoutes(config(origin), {
        roots: [`${origin}/external.xml`, `${origin}/redirect.xml`],
        sitemapOrigins: [origin],
        maxSitemaps: 10,
        maxUrls: 100,
        out: join(root, "out"),
        signal: new AbortController().signal,
      });
      expect(result.manifest.coverage).toMatchObject({
        status: "partial",
        excluded_sitemaps: 1,
        failed_sitemaps: 1,
      });
      expect(hits).toHaveLength(2);
    });
  });
  it("rejects an existing artifact before making requests", async () => {
    await fixture(async (origin, root, hits) => {
      const options = {
        roots: [`${origin}/a.xml`],
        sitemapOrigins: [origin],
        maxSitemaps: 10,
        maxUrls: 100,
        out: join(root, "out"),
        signal: new AbortController().signal,
      };
      await discoverRoutes(config(origin), options);
      await expect(discoverRoutes(config(origin), options)).rejects.toThrow();
      expect(hits).toHaveLength(1);
    });
  });
  it("validates CLI limits and explicit output without accepting malformed numbers", () => {
    expect(parseSiteArgs(["discover", "--out", "out"], "example").action).toBe("discover");
    for (const value of ["0", "-2", "2x", "1000001"])
      expect(() =>
        parseSiteArgs(["discover", "--out", "out", "--max-urls", value], "example"),
      ).toThrow();
  });
});
