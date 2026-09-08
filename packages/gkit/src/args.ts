import { parseSiteArgs, type SiteCommand } from "./site/commands";
import { GkitFailure } from "./envelope";

export type ParsedCommand =
  | SiteCommand
  | { kind: "help" }
  | { kind: "schema"; selector: string | null }
  | { kind: "skill"; path: string | null }
  | { kind: "describe"; id: string }
  | { kind: "docs"; provider: string | null }
  | { kind: "ledger-status" }
  | {
      kind: "ledger-reconcile";
      attemptId: string;
      outcome: "confirmed_charged" | "confirmed_not_charged";
      evidenceRef: string;
      costUsd: string | null;
      providerRequestId: string | null;
    }
  | { kind: "dataforseo-doctor"; profileFlag: string | null }
  | { kind: "bing-doctor"; profileFlag: string | null }
  | { kind: "google-ads-doctor"; profileFlag: string | null }
  | { kind: "gsc-doctor"; profileFlag: string | null }
  | { kind: "posthog-doctor"; profileFlag: string | null }
  | { kind: "hubspot-doctor"; profileFlag: string | null }
  | {
      kind: "dataforseo-call";
      profileFlag: string | null;
      operationId: string;
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
      operationId: string;
      input: string;
      out: string | null;
      force: boolean;
      dryRun: boolean;
    }
  | {
      kind: "google-ads-call";
      profileFlag: string | null;
      operationId: string;
      input: string;
      out: string | null;
      force: boolean;
      dryRun: boolean;
    }
  | {
      kind: "gsc-call";
      profileFlag: string | null;
      operationId: string;
      input: string;
      out: string | null;
      force: boolean;
      dryRun: boolean;
    }
  | {
      kind: "posthog-call";
      profileFlag: string | null;
      operationId: string;
      input: string;
      out: string | null;
      force: boolean;
      dryRun: boolean;
    }
  | {
      kind: "hubspot-call";
      profileFlag: string | null;
      operationId: string;
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

  if (rest[0] === "ledger") {
    if (profileFlag) invalid("ledger commands do not load a profile.");
    if (rest.length === 1) return { kind: "ledger-status" };
    if (rest[1] === "status" && rest.length === 2) {
      return { kind: "ledger-status" };
    }
    if (rest[1] !== "reconcile") invalid(`Unknown ledger command: ${rest[1]}`);
    const flags = parseFlags(rest.slice(2), new Set());
    requireOnly(flags, [
      "--attempt",
      "--outcome",
      "--evidence-ref",
      "--cost-usd",
      "--provider-request-id",
    ]);
    const outcome = requiredString(flags, "--outcome");
    if (outcome !== "confirmed_charged" && outcome !== "confirmed_not_charged") {
      invalid("--outcome must be confirmed_charged or confirmed_not_charged.");
    }
    return {
      kind: "ledger-reconcile",
      attemptId: requiredString(flags, "--attempt"),
      outcome,
      evidenceRef: requiredString(flags, "--evidence-ref"),
      costUsd: optionalString(flags, "--cost-usd"),
      providerRequestId: optionalString(flags, "--provider-request-id"),
    };
  }

  if (
    rest[0] !== "bing" &&
    rest[0] !== "dataforseo" &&
    rest[0] !== "google-ads" &&
    rest[0] !== "gsc" &&
    rest[0] !== "hubspot" &&
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
                  : "posthog-doctor",
      profileFlag,
    };
  }
  if (rest[1] !== "api" || rest[2] !== "call") {
    invalid(`Expected ${provider} doctor or ${provider} api call.`);
  }

  const booleanNames = new Set(["--allow-spend", "--force", "--dry-run"]);
  const flags = parseFlags(rest.slice(3), booleanNames);
  if (provider !== "dataforseo") {
    requireOnly(flags, ["--operation-id", "--input", "--out", "--force", "--dry-run"]);
    return {
      kind:
        provider === "posthog"
          ? "posthog-call"
          : provider === "hubspot"
            ? "hubspot-call"
          : provider === "google-ads"
            ? "google-ads-call"
            : provider === "gsc"
              ? "gsc-call"
              : "bing-call",
      profileFlag,
      operationId: requiredString(flags, "--operation-id"),
      input: requiredString(flags, "--input"),
      out: optionalString(flags, "--out"),
      force: flags.get("--force") === true,
      dryRun: flags.get("--dry-run") === true,
    };
  }
  requireOnly(flags, [
    "--operation-id",
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
    operationId: requiredString(flags, "--operation-id"),
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
    "  gkit --profile <app> dataforseo api call --operation-id <id> --input @request.json --allow-spend --max-spend-usd <decimal> --out <path> --dry-run",
    "  gkit --profile <app> dataforseo api call --operation-id <id> --input @request.json --allow-spend --max-spend-usd <decimal> --out <path>",
    "  Default artifact behavior is no-replace; add --force only after reviewing the destination.",
    "",
    "Bing Webmaster:",
    "  gkit --profile <app> bing doctor",
    "  gkit --profile <app> bing api call --operation-id <id> --input @request.json --out <path> --dry-run",
    "  gkit --profile <app> bing api call --operation-id <id> --input @request.json --out <path>",
    "",
    "PostHog:",
    "  gkit --profile <app> posthog doctor",
    "  gkit --profile <app> posthog api call --operation-id posthog.query.run --input @request.json --out <path> --dry-run",
    "  gkit --profile <app> posthog api call --operation-id posthog.query.run --input @request.json --out <path>",
    "",
    "Google Ads:",
    "  gkit --profile <app> google-ads doctor",
    "  gkit --profile <app> google-ads api call --operation-id <id> --input @request.json --out <path> --dry-run",
    "  gkit --profile <app> google-ads api call --operation-id <id> --input @request.json --out <path>",
    "",
    "Google Search Console:",
    "  gkit --profile <app> gsc doctor",
    "  gkit --profile <app> gsc api call --operation-id <id> --input @request.json --out <path> --dry-run",
    "  gkit --profile <app> gsc api call --operation-id <id> --input @request.json --out <path>",
    "",
    "HubSpot:",
    "  gkit --profile <app> hubspot doctor",
    "  gkit --profile <app> hubspot api call --operation-id <id> --input @request.json --out <path> --dry-run",
    "  gkit --profile <app> hubspot api call --operation-id <id> --input @request.json --out <path>",
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
    "Spend ledger:",
    "  gkit ledger",
    "  gkit ledger reconcile --attempt <id> --outcome <outcome> --evidence-ref <ref> [--cost-usd <decimal>]",
    "",
  ].join("\n");
}
