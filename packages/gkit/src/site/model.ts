import { createHash } from "node:crypto";
import * as v from "valibot";

export const digestSchema = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/));
export const webUrl = v.pipe(
  v.string(),
  v.url(),
  v.check((value) => {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, "Use an HTTP(S) URL without credentials, query or fragment."),
);
export const rulesSchema = v.array(
  v.strictObject({
    pathPrefix: v.string(),
    indexable: v.optional(v.boolean(), true),
    canonical: v.optional(v.picklist(["self", "present", "ignore"]), "self"),
    required: v.optional(v.array(v.picklist(["title", "description", "h1"])), [
      "title",
      "description",
      "h1",
    ]),
  }),
);
export type Rules = v.InferOutput<typeof rulesSchema>;
export const siteConfigSchema = v.strictObject({
  version: v.literal(1),
  site: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9.-]*$/)),
  environment: v.optional(v.string(), "production"),
  origins: v.pipe(v.array(webUrl), v.minLength(1)),
  seeds: v.pipe(v.array(webUrl), v.minLength(1)),
  locales: v.optional(v.array(v.string()), []),
  timeoutMs: v.optional(v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(60000)), 15000),
  delayMs: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10000)), 200),
  maxBytes: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1024), v.maxValue(20000000)),
    5000000,
  ),
  rules: v.optional(rulesSchema, [
    {
      pathPrefix: "/",
      indexable: true,
      canonical: "self",
      required: ["title", "description", "h1"],
    },
  ]),
  github: v.strictObject({
    repository: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)),
  }),
});
export type SiteConfig = v.InferOutput<typeof siteConfigSchema>;
export const fieldsSchema = v.strictObject({
  title: v.string(),
  description: v.string(),
  h1: v.array(v.string()),
  canonical: v.array(v.string()),
  robots: v.array(v.string()),
  lang: v.string(),
  hreflang: v.array(v.strictObject({ lang: v.string(), url: v.string() })),
  links: v.array(v.string()),
  body_hash: digestSchema,
});
export type Fields = v.InferOutput<typeof fieldsSchema>;
export const pageSchema = v.strictObject({
  url: webUrl,
  observed_at: v.string(),
  status: v.picklist(["observed", "failed"]),
  http_status: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(599))),
  final_url: v.nullable(webUrl),
  redirects: v.array(v.strictObject({ url: webUrl, status: v.number(), location: webUrl })),
  html_hash: v.nullable(digestSchema),
  fields: v.nullable(fieldsSchema),
  error: v.nullable(v.string()),
  mode: v.picklist(["prerender", "server-http", "production-http"]),
  response_headers: v.record(v.string(), v.string()),
});
export type PageSnapshot = v.InferOutput<typeof pageSchema>;
export type Observation = PageSnapshot;
export type Finding = {
  id: string;
  rule: string;
  url: string;
  detail: string;
  severity: "error" | "warning";
};
export const versionSchema = v.strictObject({
  repository: v.string(),
  commit_sha: v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/)),
  ref: v.string(),
  resolved_by: v.picklist(["local-git", "github-api", "legacy-deployment-evidence"]),
});
export type SourceVersion = v.InferOutput<typeof versionSchema>;
export const sourceSchema = v.variant("kind", [
  v.strictObject({
    kind: v.literal("nuxt-build"),
    build_digest: digestSchema,
    version: versionSchema,
    association: v.literal("caller-supplied-build"),
    runtime_context: v.string(),
  }),
  v.strictObject({
    kind: v.literal("production-http"),
    version: v.nullable(versionSchema),
    association: v.picklist([
      "caller-supplied-version",
      "legacy-deployment-evidence",
      "unassociated",
    ]),
    runtime_context: v.string(),
  }),
]);
export type SnapshotSource = v.InferOutput<typeof sourceSchema>;
export const manifestSchema = v.strictObject({
  schema_version: v.literal(1),
  snapshot_id: v.string(),
  site: v.string(),
  origins: v.array(webUrl),
  source: sourceSchema,
  extractor_version: v.string(),
  started_at: v.string(),
  completed_at: v.string(),
  routes: v.array(webUrl),
  coverage: v.strictObject({
    scope: v.literal("declared-routes"),
    status: v.picklist(["complete", "partial", "failed"]),
    expected: v.number(),
    observed: v.number(),
    failed: v.number(),
  }),
  expectations: rulesSchema,
  pages: v.strictObject({
    file: v.literal("pages.jsonl"),
    sha256: digestSchema,
    records: v.number(),
  }),
});
export type SnapshotManifest = v.InferOutput<typeof manifestSchema>;
export type SiteSnapshot = { manifest: SnapshotManifest; pages: PageSnapshot[] };
export const RULES_VERSION = "seo-v3";
export const EXTRACTOR_VERSION = "html-fields-v1";
export function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
export function canonicalJson(value: unknown): string {
  const sorted = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(sorted)
      : input && typeof input === "object"
        ? Object.fromEntries(
            Object.entries(input)
              .filter(([, child]) => child !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, sorted(child)]),
          )
        : input;
  return JSON.stringify(sorted(value));
}
export function identity(prefix: string, value: unknown): string {
  return `${prefix}_${hash(canonicalJson(value)).slice(0, 24)}`;
}
export function pageUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search)
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
export function inScope(url: string, config: { origins: string[] }): boolean {
  return config.origins.some((origin) => new URL(origin).origin === new URL(url).origin);
}
