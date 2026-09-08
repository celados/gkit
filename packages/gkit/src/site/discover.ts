import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { SaxesParser } from "saxes";
import { withArtifactReservation, writeArtifact } from "../artifact";
import { hash, identity, inScope, webUrl, type SiteConfig } from "./model";
import * as v from "valibot";

const sitemapNamespace = "http://www.sitemaps.org/schemas/sitemap/0.9";
export function parseSitemap(xml: string) {
  const parser = new SaxesParser({ xmlns: true });
  const stack: string[] = [];
  const locations: string[] = [];
  let kind: "sitemapindex" | "urlset" | null = null;
  let location = "";
  let locationCount = 0;
  parser.on("doctype", () => {
    throw new Error("DOCTYPE is unsupported");
  });
  parser.on("error", () => {
    throw new Error("Malformed sitemap XML");
  });
  parser.on("opentag", (tag) => {
    if (stack.length === 0) {
      if (!["sitemapindex", "urlset"].includes(tag.local) || tag.uri !== sitemapNamespace)
        throw new Error("Expected a namespaced sitemapindex or urlset");
      kind = tag.local as "sitemapindex" | "urlset";
    }
    stack.push(tag.uri === sitemapNamespace ? tag.local : "extension");
    if (stack.length === 2) {
      if (stack[1] !== (kind === "urlset" ? "url" : "sitemap"))
        throw new Error("Unexpected sitemap entry");
      locationCount = 0;
    }
    if (stack.length === 3 && stack[2] === "loc") {
      location = "";
      locationCount++;
    }
    if (stack.length > 3 && stack[2] === "loc") throw new Error("Nested content in loc");
  });
  const text = (value: string) => {
    if (stack.length === 3 && stack[2] === "loc") location += value;
  };
  parser.on("text", text);
  parser.on("cdata", text);
  parser.on("closetag", () => {
    if (stack.length === 3 && stack[2] === "loc") {
      if (!location.trim()) throw new Error("Empty loc");
      locations.push(location.trim());
    }
    if (stack.length === 2 && locationCount !== 1)
      throw new Error("Entry requires exactly one loc");
    stack.pop();
  });
  parser.write(xml).close();
  if (!kind) throw new Error("Empty sitemap");
  return { kind: kind as "sitemapindex" | "urlset", locations };
}

async function fetchSitemap(
  url: string,
  allowedOrigins: string[],
  config: SiteConfig,
  signal: AbortSignal,
) {
  let current = url;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]);
  for (let hop = 0; hop <= 8; hop++) {
    if (!inScope(current, { origins: allowedOrigins }))
      throw new Error("Sitemap redirect outside allowed origins");
    const response = await fetch(current, {
      signal: deadline,
      redirect: "manual",
      headers: { "user-agent": "GkitSiteSnapshot/1", accept: "application/xml,text/xml,*/*;q=0.1" },
    });
    const location = response.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      await response.body?.cancel();
      const next = new URL(location, current).href;
      if (!v.safeParse(webUrl, next).success) throw new Error("Unsupported sitemap redirect URL");
      current = next;
      continue;
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader)
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > config.maxBytes) {
            await reader.cancel();
            throw new Error("Sitemap exceeds maxBytes");
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
    const body = Buffer.concat(chunks);
    return { status: response.status, url: current, body };
  }
  throw new Error("Sitemap redirect limit exceeded");
}

type SitemapObservation = {
  url: string;
  parent_url: string | null;
  observed_at: string | null;
  status: "parsed" | "failed" | "excluded" | "deferred";
  http_status: number | null;
  final_url: string | null;
  document_hash: string | null;
  kind: "sitemapindex" | "urlset" | null;
  locations: number;
  error: string | null;
};
export type DiscoveryOptions = {
  roots: string[];
  sitemapOrigins: string[];
  maxSitemaps: number;
  maxUrls: number;
  out: string;
  signal: AbortSignal;
  progress?: (message: string) => void;
};
export async function discoverRoutes(config: SiteConfig, options: DiscoveryOptions) {
  return withArtifactReservation(
    { destinationPath: options.out, lockTimeoutMs: 0 },
    async (reservation) => {
      const root = reservation.path;
      await mkdir(root, { mode: 0o700 });
      try {
        const started = new Date().toISOString();
        const queue = options.roots.map((url) => ({ url, parent_url: null as string | null }));
        const queued = new Set(options.roots);
        const routes = new Set<string>();
        const omitted = new Set<string>();
        const rejected: { url: string; source: string; reason: string }[] = [];
        const observations: SitemapObservation[] = [];
        const savedDocuments = new Set<string>();
        let requests = 0;
        const addPage = (url: string, source: string) => {
          const parsed = v.safeParse(webUrl, url);
          if (!parsed.success || !inScope(url, config)) {
            rejected.push({
              url,
              source,
              reason: parsed.success ? "outside_page_origins" : "unsupported_url",
            });
          } else if (!routes.has(url)) {
            if (routes.size < options.maxUrls) routes.add(url);
            else omitted.add(url);
          }
        };
        for (const url of config.seeds) addPage(url, "profile:seeds");
        for (let index = 0; index < queue.length; index++) {
          options.signal.throwIfAborted();
          const item = queue[index]!;
          const record: SitemapObservation = {
            ...item,
            observed_at: null,
            status: "failed",
            http_status: null,
            final_url: null,
            document_hash: null,
            kind: null,
            locations: 0,
            error: null,
          };
          observations.push(record);
          if (
            !v.safeParse(webUrl, item.url).success ||
            !inScope(item.url, { origins: options.sitemapOrigins })
          ) {
            record.status = "excluded";
            record.error = "Sitemap URL outside declared source origins or unsupported";
            continue;
          }
          if (requests >= options.maxSitemaps) {
            record.status = "deferred";
            record.error = "maxSitemaps reached";
            continue;
          }
          if (requests && config.delayMs)
            await delay(config.delayMs, undefined, { signal: options.signal });
          requests++;
          record.observed_at = new Date().toISOString();
          options.progress?.(`Sitemap ${requests}/${options.maxSitemaps}: ${item.url}`);
          let xml: string;
          try {
            const document = await fetchSitemap(
              item.url,
              options.sitemapOrigins,
              config,
              options.signal,
            );
            record.http_status = document.status;
            record.final_url = document.url;
            const sha = hash(document.body);
            if (!savedDocuments.has(sha)) {
              await writeArtifact({
                destinationPath: resolve(root, "documents", sha),
                source: document.body,
              });
              savedDocuments.add(sha);
            }
            record.document_hash = sha;
            if (document.status !== 200) throw new Error(`HTTP ${document.status}`);
            const bytes =
              document.body[0] === 0x1f && document.body[1] === 0x8b
                ? gunzipSync(document.body, { maxOutputLength: config.maxBytes })
                : document.body;
            xml = bytes.toString("utf8");
          } catch (error) {
            options.signal.throwIfAborted();
            record.error = error instanceof Error ? error.message : "Sitemap fetch failed";
            continue;
          }
          try {
            const parsed = parseSitemap(xml);
            record.kind = parsed.kind;
            record.locations = parsed.locations.length;
            for (const location of parsed.locations) {
              if (parsed.kind === "urlset") addPage(location, item.url);
              else if (!queued.has(location)) {
                queued.add(location);
                queue.push({ url: location, parent_url: item.url });
              }
            }
            record.status = "parsed";
          } catch (error) {
            record.error = error instanceof Error ? error.message : "Sitemap parse failed";
          }
        }
        const values = [...routes].sort();
        const routesReceipt = await writeArtifact({
          destinationPath: resolve(root, "routes.json"),
          source: JSON.stringify(values, null, 2) + "\n",
        });
        const payload = {
          schema_version: 1,
          collector_version: "sitemap-discovery-v1",
          site: config.site,
          started_at: started,
          completed_at: new Date().toISOString(),
          roots: options.roots,
          sitemap_origins: options.sitemapOrigins,
          page_origins: config.origins,
          seeds: config.seeds,
          limits: {
            max_sitemaps: options.maxSitemaps,
            max_urls: options.maxUrls,
            max_bytes: config.maxBytes,
          },
          coverage: {
            scope: "declared-sitemaps-and-seeds",
            status:
              observations.every((record) => record.status === "parsed") && !omitted.size
                ? "complete"
                : "partial",
            parsed_sitemaps: observations.filter((record) => record.status === "parsed").length,
            failed_sitemaps: observations.filter((record) => record.status === "failed").length,
            excluded_sitemaps: observations.filter((record) => record.status === "excluded").length,
            deferred_sitemaps: observations.filter((record) => record.status === "deferred").length,
            included_urls: values.length,
            omitted_urls: omitted.size,
            rejected_urls: rejected.length,
          },
          routes: { file: "routes.json", sha256: routesReceipt.sha256, records: values.length },
          sitemaps: observations,
          rejected_urls: rejected,
          omitted_urls: [...omitted].sort(),
          limits_note:
            "Discovery lists candidate URLs; it does not establish page existence, indexability, deployment version, or whole-site completeness.",
        };
        const manifest = { ...payload, id: identity("discovery", payload) };
        const receipt = await writeArtifact({
          destinationPath: resolve(root, "manifest.json"),
          source: JSON.stringify(manifest, null, 2) + "\n",
        });
        return { manifest, receipt };
      } catch (error) {
        await rm(root, { recursive: true, force: true });
        throw error;
      }
    },
  );
}
