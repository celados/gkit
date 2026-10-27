import { parseSiteArgs, type SiteCommand } from "./site/commands";
import { GkitFailure } from "./envelope";

export type ParsedCommand =
  | SiteCommand
  | { kind: "help" }
  | { kind: "schema"; selector: string | null }
  | { kind: "skill"; path: string | null }
  | { kind: "describe"; id: string }
  | { kind: "docs"; provider: string | null }
  | { kind: "operations-list"; limit: number }
  | { kind: "operations-show"; operationId: string }
  | {
      kind: "operations-reconcile";
      operationId: string;
      providerResult: "succeeded" | "failed" | "not_dispatched" | null;
      spendOutcome: "confirmed_charged" | "confirmed_not_charged" | null;
      costUsd: string | null;
      evidenceRef: string;
      providerRequestId: string | null;
    }
  | { kind: "dataforseo-doctor"; profileFlag: string | null }
  | { kind: "bing-doctor"; profileFlag: string | null }
  | { kind: "google-ads-doctor"; profileFlag: string | null }
  | { kind: "gsc-doctor"; profileFlag: string | null }
  | { kind: "posthog-doctor"; profileFlag: string | null }
  | { kind: "hubspot-doctor"; profileFlag: string | null }
  | { kind: "pagespeed-doctor"; profileFlag: string | null }
  | {
      kind: "dataforseo-call";
      profileFlag: string | null;
      capabilityId: string;
      input: string;
      allowSpend: boolean;
      maxSpendUsd: string | null;
      out: string | null;
      force: boolean;
      dryRun: boolean;
    }
  | {
      kind: "bing-call";
      profileFlag: string | null;
      capabilityId: string;
      input: string;
      allowWrite: boolean;
      out: string | null;
      force: boolean;
      dryRun: boolean;
    }
  | {
      kind: "google-ads-call";
      profileFlag: string | null;
      capabilityId: string;
      input: string;
      out: string | null;
      force: boolean;
      dryRun: boolean;
    }
  | {
      kind: "gsc-call";
      profileFlag: string | null;
      capabilityId: string;
      input: string;
      allowWrite: boolean;
      out: string | null;
      force: boolean;
      dryRun: boolean;
    }
  | {
      kind: "posthog-call";
      profileFlag: string | null;
      capabilityId: string;
      input: string;
      out: string | null;
      force: boolean;
      dryRun: boolean;
    }
  | {
      kind: "pagespeed-call";
      profileFlag: string | null;
      capabilityId: string;
      input: string;
      out: string | null;
      force: boolean;
      dryRun: boolean;
    }
  | {
      kind: "hubspot-call";
      profileFlag: string | null;
      capabilityId: string;
      input: string;
      out: string | null;
      force: boolean;
      dryRun: boolean;
    };

type FlagValue = string | true;

function invalid(message: string): never {
  throw new GkitFailure({
    code: "INVALID_INPUT",
    message,
    hint: "Run gkit --help or gkit --schema to inspect the accepted command surface.",
  });
}

function takeGlobalProfile(argv: string[]): {
  profileFlag: string | null;
  rest: string[];
} {
  let profileFlag: string | null = null;
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--profile") {
      if (profileFlag !== null) invalid("--profile may be provided only once.");
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) invalid("--profile requires a value.");
      profileFlag = value;
      index++;
      continue;
    }
    if (token.startsWith("--profile=")) {
      if (profileFlag !== null) invalid("--profile may be provided only once.");
      const value = token.slice("--profile=".length);
      if (!value) invalid("--profile requires a value.");
      profileFlag = value;
      continue;
    }
    rest.push(token);
  }
  return { profileFlag, rest };
}

function parseFlags(argv: string[], booleanNames: ReadonlySet<string>): Map<string, FlagValue> {
  const flags = new Map<string, FlagValue>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (!token.startsWith("--")) invalid(`Unexpected argument: ${token}`);
    const equal = token.indexOf("=");
    const name = equal === -1 ? token : token.slice(0, equal);
    if (flags.has(name)) invalid(`Duplicate flag: ${name}`);

    if (booleanNames.has(name)) {
      if (equal !== -1) invalid(`${name} does not accept a value.`);
      flags.set(name, true);
      continue;
    }

    const value = equal === -1 ? argv[index + 1] : token.slice(equal + 1);
    if (!value || (equal === -1 && value.startsWith("--"))) {
      invalid(`${name} requires a value.`);
    }
    flags.set(name, value);
    if (equal === -1) index++;
  }
  return flags;
}

function requireOnly(flags: Map<string, FlagValue>, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  for (const name of flags.keys()) {
    if (!allowedSet.has(name)) invalid(`Unknown flag: ${name}`);
  }
}

function requiredString(flags: Map<string, FlagValue>, name: string): string {
  const value = flags.get(name);
  if (typeof value !== "string") invalid(`${name} is required.`);
  return value;
}

function optionalString(flags: Map<string, FlagValue>, name: string): string | null {
  const value = flags.get(name);
  return typeof value === "string" ? value : null;
}

export function parseArgs(argv: string[]): ParsedCommand {
  const { profileFlag, rest } = takeGlobalProfile(argv);
  if (rest.length === 0 || rest[0] === "--help" || rest[0] === "-h") {
    if (rest.length > 1) invalid("--help does not accept additional arguments.");
    return { kind: "help" };
  }

  if (rest[0] === "--schema" || rest[0]!.startsWith("--schema=")) {
    if (profileFlag) invalid("--schema does not load a profile.");
    const first = rest[0]!;
    const inline = first.startsWith("--schema=") ? first.slice("--schema=".length) : null;
    const selector = inline || rest[1] || null;
    if (rest.length > (selector && !inline ? 2 : 1)) {
      invalid("--schema accepts at most one selector.");
    }
    return { kind: "schema", selector };
  }

  // First-token builtin matching argc's @skill contract; gkit keeps its own
  // dispatcher, so the skill must be served here rather than via cli().
  if (rest[0] === "@skill") {
    if (profileFlag) invalid("@skill does not load a profile.");
    if (rest.length > 2) invalid("@skill takes at most one path.");
    return { kind: "skill", path: rest[1] ?? null };
  }

  if (rest[0] === "describe") {
    if (profileFlag) invalid("describe does not load a profile.");
    const flags = parseFlags(rest.slice(1), new Set());
    requireOnly(flags, ["--id"]);
    return { kind: "describe", id: requiredString(flags, "--id") };
  }

  if (rest[0] === "docs") {
    if (profileFlag) invalid("docs does not load a profile.");
    const flags = parseFlags(rest.slice(1), new Set());
    requireOnly(flags, ["--provider"]);
    return { kind: "docs", provider: optionalString(flags, "--provider") };
  }

  if (rest[0] === "site") return parseSiteArgs(rest.slice(1), profileFlag);

  if (rest[0] === "operations") {
    if (profileFlag) invalid("operations commands do not load a profile.");
    if (rest.length === 1 || rest[1] === "list") {
      const flags = parseFlags(rest.slice(rest[1] === "list" ? 2 : 1), new Set());
      requireOnly(flags, ["--limit"]);
      const limitText = optionalString(flags, "--limit") ?? "20";
      if (!/^[1-9]\d{0,3}$/.test(limitText)) invalid("--limit must be an integer from 1 to 9999.");
      return { kind: "operations-list", limit: Number(limitText) };
    }
    if (rest[1] === "show") {
      const flags = parseFlags(rest.slice(2), new Set());
      requireOnly(flags, ["--id"]);
      return { kind: "operations-show", operationId: requiredString(flags, "--id") };
    }
    if (rest[1] !== "reconcile") invalid(`Unknown operations command: ${rest[1]}`);
    const flags = parseFlags(rest.slice(2), new Set());
    requireOnly(flags, [
      "--id",
      "--result",
      "--spend-outcome",
      "--evidence-ref",
      "--cost-usd",
      "--provider-request-id",
    ]);
    const providerResult = optionalString(flags, "--result");
    if (
      providerResult !== null &&
      providerResult !== "succeeded" &&
      providerResult !== "failed" &&
      providerResult !== "not_dispatched"
    ) {
      invalid("--result must be succeeded, failed, or not_dispatched.");
    }
    const spendOutcome = optionalString(flags, "--spend-outcome");
    if (
      spendOutcome !== null &&
      spendOutcome !== "confirmed_charged" &&
      spendOutcome !== "confirmed_not_charged"
    ) {
      invalid("--spend-outcome must be confirmed_charged or confirmed_not_charged.");
    }
    if (providerResult === null && spendOutcome === null) {
      invalid("operations reconcile requires --result, --spend-outcome, or both.");
    }
    return {
      kind: "operations-reconcile",
      operationId: requiredString(flags, "--id"),
      providerResult,
      spendOutcome,
      costUsd: optionalString(flags, "--cost-usd"),
      evidenceRef: requiredString(flags, "--evidence-ref"),
      providerRequestId: optionalString(flags, "--provider-request-id"),
    };
  }

  if (
    rest[0] !== "bing" &&
    rest[0] !== "dataforseo" &&
    rest[0] !== "google-ads" &&
    rest[0] !== "gsc" &&
    rest[0] !== "hubspot" &&
    rest[0] !== "pagespeed" &&
    rest[0] !== "posthog"
  ) {
    invalid(`Unknown command: ${rest[0]}`);
  }
  const provider = rest[0];
  if (rest[1] === "doctor" && rest.length === 2) {
    return {
      kind:
        provider === "dataforseo"
          ? "dataforseo-doctor"
          : provider === "bing"
            ? "bing-doctor"
            : provider === "google-ads"
              ? "google-ads-doctor"
              : provider === "gsc"
                ? "gsc-doctor"
                : provider === "hubspot"
                  ? "hubspot-doctor"
                  : provider === "pagespeed"
                    ? "pagespeed-doctor"
                    : "posthog-doctor",
      profileFlag,
    };
  }
  if (rest[1] !== "api" || rest[2] !== "call") {
    invalid(`Expected ${provider} doctor or ${provider} api call.`);
  }

  const booleanNames = new Set(["--allow-spend", "--allow-write", "--force", "--dry-run"]);
  const flags = parseFlags(rest.slice(3), booleanNames);
  if (provider === "gsc" || provider === "bing") {
    requireOnly(flags, [
      "--capability-id",
      "--input",
      "--allow-write",
      "--out",
      "--force",
      "--dry-run",
    ]);
    return {
      kind: provider === "gsc" ? "gsc-call" : "bing-call",
      profileFlag,
      capabilityId: requiredString(flags, "--capability-id"),
      input: requiredString(flags, "--input"),
      allowWrite: flags.get("--allow-write") === true,
      out: optionalString(flags, "--out"),
      force: flags.get("--force") === true,
      dryRun: flags.get("--dry-run") === true,
    };
  }
  if (provider !== "dataforseo") {
    requireOnly(flags, ["--capability-id", "--input", "--out", "--force", "--dry-run"]);
    return {
      kind:
        provider === "posthog"
          ? "posthog-call"
          : provider === "hubspot"
            ? "hubspot-call"
            : provider === "pagespeed"
              ? "pagespeed-call"
              : "google-ads-call",
      profileFlag,
      capabilityId: requiredString(flags, "--capability-id"),
      input: requiredString(flags, "--input"),
      out: optionalString(flags, "--out"),
      force: flags.get("--force") === true,
      dryRun: flags.get("--dry-run") === true,
    };
  }
  requireOnly(flags, [
    "--capability-id",
    "--input",
    "--allow-spend",
    "--max-spend-usd",
    "--out",
    "--force",
    "--dry-run",
  ]);
  return {
    kind: "dataforseo-call",
    profileFlag,
    capabilityId: requiredString(flags, "--capability-id"),
    input: requiredString(flags, "--input"),
    allowSpend: flags.get("--allow-spend") === true,
    maxSpendUsd: optionalString(flags, "--max-spend-usd"),
    out: optionalString(flags, "--out"),
    force: flags.get("--force") === true,
    dryRun: flags.get("--dry-run") === true,
  };
}

export function renderHelp(): string {
  return [
    "gkit — profile-bound growth provider CLI",
    "",
    "Discovery:",
    "  gkit --schema [selector]",
    "  gkit @skill [path]",
    "  gkit describe --id <capability-id>",
    "  gkit docs [--provider <provider>]",
    "",
    "DataForSEO:",
    "  gkit --profile <app> dataforseo doctor",
    "  gkit --profile <app> dataforseo api call --capability-id <id> --input @request.json --allow-spend --max-spend-usd <decimal> --out <path> --dry-run",
    "  gkit --profile <app> dataforseo api call --capability-id <id> --input @request.json --allow-spend --max-spend-usd <decimal> --out <path>",
    "  Default artifact behavior is no-replace; add --force only after reviewing the destination.",
    "",
    "Bing Webmaster:",
    "  gkit --profile <app> bing doctor",
    "  gkit --profile <app> bing api call --capability-id <id> --input @request.json --out <path> --dry-run",
    "  gkit --profile <app> bing api call --capability-id <id> --input @request.json --out <path>",
    "  Write capabilities (bing.urls.submit, bing.sitemaps.submit) also require --allow-write.",
    "",
    "PostHog:",
    "  gkit --profile <app> posthog doctor",
    "  gkit --profile <app> posthog api call --capability-id posthog.query.run --input @request.json --out <path> --dry-run",
    "  gkit --profile <app> posthog api call --capability-id posthog.query.run --input @request.json --out <path>",
    "",
    "Google Ads:",
    "  gkit --profile <app> google-ads doctor",
    "  gkit --profile <app> google-ads api call --capability-id <id> --input @request.json --out <path> --dry-run",
    "  gkit --profile <app> google-ads api call --capability-id <id> --input @request.json --out <path>",
    "",
    "Google Search Console:",
    "  gkit --profile <app> gsc doctor",
    "  gkit --profile <app> gsc api call --capability-id <id> --input @request.json --out <path> --dry-run",
    "  gkit --profile <app> gsc api call --capability-id <id> --input @request.json --out <path>",
    "  Write capabilities (gsc.sitemaps.submit) also require --allow-write, including --dry-run.",
    "",
    "HubSpot:",
    "  gkit --profile <app> hubspot doctor",
    "  gkit --profile <app> hubspot api call --capability-id <id> --input @request.json --out <path> --dry-run",
    "  gkit --profile <app> hubspot api call --capability-id <id> --input @request.json --out <path>",
    "",
    "PageSpeed Insights:",
    "  gkit --profile <app> pagespeed doctor",
    "  gkit --profile <app> pagespeed api call --capability-id pagespeed.run --input @request.json --out <path> --dry-run",
    "",
    "Site facts:",
    "  gkit --schema site",
    "  gkit --profile <app> site doctor",
    "  gkit --profile <app> site discover --out <new-directory>",
    "  gkit --profile <app> site snapshot --build .output --revision <sha> --context <label> --out <new-directory>",
    "  gkit site audit <snapshot> [--out <file>]",
    "  gkit site diff <snapshot-a> <snapshot-b> [--out <file>]",
    "  gkit --profile <app> site explain <snapshot-a> <snapshot-b> --model <id> --out <file>",
    "",
    "Operation journal:",
    "  gkit operations [list] [--limit <n>]",
    "  gkit operations show --id <operation-id>",
    "  gkit operations reconcile --id <operation-id> [--result <result>] [--spend-outcome <outcome> [--cost-usd <decimal>]] --evidence-ref <ref>",
    "",
  ].join("\n");
}
