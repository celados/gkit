import { mkdir, readFile, realpath, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import * as v from "valibot";
import { withArtifactReservation, writeArtifact, type ArtifactReceipt } from "../artifact";
import { GkitFailure } from "../envelope";
import {
  EXTRACTOR_VERSION,
  hash,
  identity,
  manifestSchema,
  pageSchema,
  type PageSnapshot,
  type SiteConfig,
  type SiteSnapshot,
  type SnapshotSource,
} from "./model";

export function makeSnapshot(
  config: Pick<SiteConfig, "site" | "origins" | "rules">,
  routes: string[],
  pages: PageSnapshot[],
  source: SnapshotSource,
  started: string,
): SiteSnapshot {
  const sorted = structuredClone(pages).sort((a, b) => a.url.localeCompare(b.url));
  const body = encodePages(sorted);
  const observed = sorted.filter((page) => page.status === "observed").length;
  const payload = {
    schema_version: 1 as const,
    site: config.site,
    origins: [...config.origins],
    source: structuredClone(source),
    extractor_version: EXTRACTOR_VERSION,
    started_at: started,
    completed_at: new Date().toISOString(),
    routes: [...routes].sort(),
    coverage: {
      scope: "declared-routes" as const,
      status: !observed
        ? ("failed" as const)
        : observed < routes.length
          ? ("partial" as const)
          : ("complete" as const),
      expected: routes.length,
      observed,
      failed: routes.length - observed,
    },
    expectations: structuredClone(config.rules),
    pages: { file: "pages.jsonl" as const, sha256: hash(body), records: sorted.length },
  };
  return { manifest: { ...payload, snapshot_id: identity("snapshot", payload) }, pages: sorted };
}
export function encodePages(pages: PageSnapshot[]): string {
  return pages.map((page) => JSON.stringify(page) + "\n").join("");
}
export async function writeSnapshot(
  out: string,
  build: (save: (bytes: Uint8Array | string) => Promise<string>) => Promise<SiteSnapshot>,
): Promise<{ snapshot: SiteSnapshot; receipt: ArtifactReceipt }> {
  return withArtifactReservation(
    { destinationPath: out, lockTimeoutMs: 0 },
    async (reservation) => {
      const root = reservation.path;
      await mkdir(root, { mode: 0o700 });
      try {
        const save = async (bytes: Uint8Array | string) => {
          const sha = hash(bytes);
          const path = resolve(root, "content", sha);
          try {
            const prior = await readFile(path);
            if (hash(prior) !== sha) throw new Error("Content checksum mismatch");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            await writeArtifact({ destinationPath: path, source: bytes });
          }
          return sha;
        };
        const snapshot = await build(save);
        await writeArtifact({
          destinationPath: resolve(root, "pages.jsonl"),
          source: encodePages(snapshot.pages),
        });
        // The manifest is the commit marker. Consumers reject incomplete directories.
        const receipt = await writeArtifact({
          destinationPath: resolve(root, "manifest.json"),
          source: JSON.stringify(snapshot.manifest, null, 2) + "\n",
        });
        await readSnapshot(root);
        return { snapshot, receipt };
      } catch (error) {
        await rm(root, { recursive: true, force: true });
        throw error;
      }
    },
  );
}
async function checkedFile(root: string, relative: string): Promise<Buffer> {
  const base = await realpath(root);
  const path = await realpath(resolve(base, relative));
  if (!path.startsWith(base + sep)) throw new Error("Snapshot reference escapes its directory");
  return readFile(path);
}
export async function readSnapshot(root: string): Promise<SiteSnapshot> {
  try {
    const manifest = v.parse(
      manifestSchema,
      JSON.parse((await checkedFile(root, "manifest.json")).toString("utf8")),
    );
    const encoded = await checkedFile(root, manifest.pages.file);
    if (hash(encoded) !== manifest.pages.sha256) throw new Error("Page index checksum mismatch");
    const pages = encoded
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => v.parse(pageSchema, JSON.parse(line)));
    const { snapshot_id, ...payload } = manifest;
    if (identity("snapshot", payload) !== snapshot_id)
      throw new Error("Manifest checksum mismatch");
    const urls = new Set(pages.map((page) => page.url));
    const routes = new Set(manifest.routes);
    const observed = pages.filter((page) => page.status === "observed").length;
    if (
      pages.length !== manifest.pages.records ||
      urls.size !== pages.length ||
      routes.size !== manifest.routes.length ||
      urls.size !== routes.size ||
      [...urls].some((url) => !routes.has(url))
    )
      throw new Error("Invalid page coverage");
    const status = !observed ? "failed" : observed < routes.size ? "partial" : "complete";
    if (
      manifest.coverage.expected !== routes.size ||
      manifest.coverage.observed !== observed ||
      manifest.coverage.failed !== routes.size - observed ||
      manifest.coverage.status !== status
    )
      throw new Error("Invalid coverage counts");
    for (const page of pages) {
      if (page.status === "observed" && (!page.html_hash || !page.final_url || page.error !== null))
        throw new Error("Incomplete observed page");
      if (
        page.html_hash &&
        hash(await checkedFile(root, `content/${page.html_hash}`)) !== page.html_hash
      )
        throw new Error("Content checksum mismatch");
    }
    return { manifest, pages };
  } catch {
    throw new GkitFailure({
      code: "INVALID_INPUT",
      message: "Snapshot is missing, incomplete, invalid, or has a checksum mismatch.",
      details: { path: root },
    });
  }
}
