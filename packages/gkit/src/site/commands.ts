import { GkitFailure } from "../envelope";
type Base = { kind: "site"; profileFlag: string | null };
type Report = { out: string | null; format: "json" | "markdown"; rules: string | null };
export type SiteCommand = Base &
  (
    | { action: "doctor" }
    | {
        action: "discover";
        sitemaps: string | null;
        sitemapOrigins: string | null;
        maxSitemaps: number;
        maxUrls: number;
        out: string;
        dryRun: boolean;
      }
    | {
        action: "snapshot";
        build: string | null;
        http: boolean;
        revision: string | null;
        repo: string | null;
        routes: string | null;
        runtimeContext: string;
        out: string;
        dryRun: boolean;
      }
    | ({ action: "audit"; snapshot: string } & Report)
    | ({ action: "diff"; base: string; head: string } & Report)
    | {
        action: "explain";
        base: string;
        head: string;
        repo: string | null;
        model: string;
        out: string;
        dryRun: boolean;
      }
  );
const invalid = (message: string): never => {
  throw new GkitFailure({ code: "INVALID_INPUT", message, hint: "Run gkit --schema site." });
};
export function parseSiteArgs(argv: string[], profileFlag: string | null): SiteCommand {
  const action = argv[0];
  if (!["doctor", "discover", "snapshot", "audit", "diff", "explain"].includes(action ?? ""))
    return invalid(
      "Unknown site command. The ledger commands have been replaced by snapshot/audit/diff/explain.",
    );
  const positional = action === "audit" ? 1 : action === "diff" || action === "explain" ? 2 : 0;
  const ids = argv.slice(1, 1 + positional);
  if (ids.length !== positional || ids.some((id) => id.startsWith("--")))
    invalid("Missing snapshot paths.");
  const allowed =
    action === "discover"
      ? ["sitemaps", "sitemap-origins", "max-sitemaps", "max-urls", "out", "dry-run"]
      : action === "snapshot"
        ? ["build", "http", "revision", "repo", "routes", "context", "out", "dry-run"]
        : action === "explain"
          ? ["repo", "model", "out", "dry-run"]
          : action === "doctor"
            ? []
            : ["out", "format", "rules"];
  const flags = new Map<string, string | true>();
  let i = 1 + positional;
  while (i < argv.length) {
    const token = argv[i++]!;
    const equal = token.indexOf("=");
    const name = (equal < 0 ? token : token.slice(0, equal)).replace(/^--/, "");
    if (!token.startsWith("--") || !allowed.includes(name) || flags.has(name))
      invalid(`Invalid or duplicate option: ${token}`);
    if (["http", "dry-run"].includes(name)) {
      if (equal >= 0) invalid(`--${name} takes no value.`);
      flags.set(name, true);
    } else {
      const value = equal >= 0 ? token.slice(equal + 1) : argv[i++];
      if (!value || value.startsWith("--")) invalid(`--${name} requires a value.`);
      flags.set(name, value!);
    }
  }
  const get = (name: string) =>
    typeof flags.get(name) === "string" ? (flags.get(name) as string) : null;
  const required = (name: string) => get(name) ?? invalid(`--${name} is required.`);
  const base = { kind: "site" as const, profileFlag };
  if (action === "doctor") return { ...base, action };
  if (action === "discover") {
    const limit = (name: string, fallback: number, max: number) => {
      const value = get(name);
      if (value !== null && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max))
        invalid(`--${name} must be an integer between 1 and ${max}.`);
      return value === null ? fallback : Number(value);
    };
    return {
      ...base,
      action,
      sitemaps: get("sitemaps"),
      sitemapOrigins: get("sitemap-origins"),
      maxSitemaps: limit("max-sitemaps", 50, 500),
      maxUrls: limit("max-urls", 100000, 1000000),
      out: required("out"),
      dryRun: flags.has("dry-run"),
    };
  }
  if (action === "snapshot") {
    const build = get("build");
    const http = flags.has("http");
    if (!!build === http) invalid("Choose exactly one source: --build <.output> or --http.");
    if (build && !get("revision")) invalid("A build snapshot requires --revision <commit-or-tag>.");
    if (get("repo") && !get("revision")) invalid("--repo requires --revision.");
    return {
      ...base,
      action,
      build,
      http,
      revision: get("revision"),
      repo: get("repo"),
      routes: get("routes"),
      runtimeContext: required("context"),
      out: required("out"),
      dryRun: flags.has("dry-run"),
    };
  }
  if (action === "explain")
    return {
      ...base,
      action,
      base: ids[0]!,
      head: ids[1]!,
      repo: get("repo"),
      model: required("model"),
      out: required("out"),
      dryRun: flags.has("dry-run"),
    };
  const format = get("format") ?? "json";
  if (!["json", "markdown"].includes(format)) invalid("--format must be json or markdown.");
  if (format === "markdown" && !get("out")) invalid("Markdown requires --out.");
  const report = { out: get("out"), format: format as "json" | "markdown", rules: get("rules") };
  return action === "audit"
    ? { ...base, ...report, action, snapshot: ids[0]! }
    : { ...base, ...report, action: "diff", base: ids[0]!, head: ids[1]! };
}
