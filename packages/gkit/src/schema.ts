import { siteRouter } from "./site/schema";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { c, generateSchema, group, selectSchema, type Router } from "argc";
import * as v from "valibot";

import { GkitFailure } from "./envelope";
import type { LoadedExecutableManifest } from "./manifest";

const s = toStandardJsonSchema;

export function buildGkitSchema(
  manifest: LoadedExecutableManifest | readonly LoadedExecutableManifest[],
): Router {
  const manifests = Array.isArray(manifest) ? manifest : [manifest];
  const capabilities = manifests.flatMap((candidate) => candidate.document.capabilities);
  const dataForSeoCapabilityCount = capabilities.filter(
    (capability) => capability.provider === "dataforseo",
  ).length;
  const bingCapabilityCount = capabilities.filter(
    (capability) => capability.provider === "bing",
  ).length;
  const googleAdsCapabilityCount = capabilities.filter(
    (capability) => capability.provider === "google-ads",
  ).length;
  const gscCapabilityCount = capabilities.filter(
    (capability) => capability.provider === "gsc",
  ).length;
  const hubSpotCapabilityCount = capabilities.filter(
    (capability) => capability.provider === "hubspot",
  ).length;
  if (capabilities.length === 0) {
    throw new GkitFailure({
      code: "INTERNAL_ERROR",
      message: "The executable manifest has no reviewed capabilities.",
    });
  }

  return {
    site: siteRouter,
    describe: c
      .meta({
        description: "Capability details.",
        examples: ["gkit describe --id dataforseo.backlinks.bulk_ranks.live"],
      })
      .input(s(v.strictObject({ id: v.string() }))),
    docs: c
      .meta({
        description: "Provider docs directory.",
        examples: ["gkit docs --provider dataforseo"],
      })
      .input(s(v.strictObject({ provider: v.optional(v.string()) }))),
    ledger: group(
      { description: "Spend ledger." },
      {
        status: c
          .meta({
            description: "Ledger status.",
            examples: ["gkit ledger"],
          })
          .input(s(v.strictObject({}))),
        reconcile: c
          .meta({
            description: "Manual settlement.",
            examples: [
              "gkit ledger reconcile --attempt <id> --outcome confirmed_not_charged --evidence-ref ticket:123",
            ],
          })
          .input(
            s(
              v.strictObject({
                attempt: v.string(),
                outcome: v.picklist(["confirmed_charged", "confirmed_not_charged"]),
                evidenceRef: v.string(),
                costUsd: v.optional(v.string()),
                providerRequestId: v.optional(v.string()),
              }),
            ),
          ),
      },
    ),
    dataforseo: group(
      { description: `${dataForSeoCapabilityCount} reviewed reads.` },
      {
        doctor: c
          .meta({
            description: "Profile check.",
            examples: ["gkit --profile app-a dataforseo doctor"],
          })
          .input(s(v.strictObject({}))),
        api: group(
          { description: "Native API." },
          {
            call: c
              .meta({
                description: `Call ${dataForSeoCapabilityCount} operations: gkit --profile <app> dataforseo api call --operation-id <id> --input @request.json --allow-spend --max-spend-usd <decimal> --out <path> --dry-run.`,
                examples: [
                  "gkit --profile <app> dataforseo api call --operation-id <id> --input @request.json --allow-spend --max-spend-usd <decimal> --out <path> --dry-run",
                ],
              })
              .input(s(v.strictObject({}))),
          },
        ),
      },
    ),
    bing: group(
      { description: `${bingCapabilityCount} reviewed reads.` },
      {
        doctor: c
          .meta({
            description: "Profile check.",
            examples: ["gkit --profile app-a bing doctor"],
          })
          .input(s(v.strictObject({}))),
        api: group(
          { description: "Native API." },
          {
            call: c
              .meta({
                description: `Call ${bingCapabilityCount} reads: gkit --profile <app> bing api call --operation-id <id> --input @request.json --out <path> --dry-run.`,
                examples: [
                  "gkit --profile <app> bing api call --operation-id <id> --input @request.json --out <path> --dry-run",
                ],
              })
              .input(s(v.strictObject({}))),
          },
        ),
      },
    ),
    posthog: group(
      { description: "1 reviewed read." },
      {
        doctor: c
          .meta({
            description: "Profile check.",
            examples: ["gkit --profile app-a posthog doctor"],
          })
          .input(s(v.strictObject({}))),
        api: group(
          { description: "Native API." },
          {
            call: c
              .meta({
                description:
                  "gkit --profile <app> posthog api call --operation-id posthog.query.run --input @request.json --out <path> --dry-run.",
                examples: [
                  "gkit --profile <app> posthog api call --operation-id posthog.query.run --input @request.json --out <path> --dry-run",
                ],
              })
              .input(s(v.strictObject({}))),
          },
        ),
      },
    ),
    "google-ads": group(
      { description: `${googleAdsCapabilityCount} reviewed reads.` },
      {
        doctor: c
          .meta({
            description: "Profile check.",
            examples: ["gkit --profile openclaw-web google-ads doctor"],
          })
          .input(s(v.strictObject({}))),
        api: group(
          { description: "Native API." },
          {
            call: c
              .meta({
                description: `Call ${googleAdsCapabilityCount} reads: gkit --profile <app> google-ads api call --operation-id <id> --input @request.json --out <path> --dry-run.`,
                examples: [
                  "gkit --profile <app> google-ads api call --operation-id <id> --input @request.json --out <path> --dry-run",
                ],
              })
              .input(s(v.strictObject({}))),
          },
        ),
      },
    ),
    gsc: group(
      { description: `${gscCapabilityCount} reviewed reads.` },
      {
        doctor: c
          .meta({
            description: "Profile check.",
            examples: ["gkit --profile openclaw-web gsc doctor"],
          })
          .input(s(v.strictObject({}))),
        api: group(
          { description: "Native API." },
          {
            call: c
              .meta({
                description: `Call ${gscCapabilityCount} reads: gkit --profile <app> gsc api call --operation-id <id> --input @request.json --out <path> --dry-run.`,
                examples: [
                  "gkit --profile <app> gsc api call --operation-id <id> --input @request.json --out <path> --dry-run",
                ],
              })
              .input(s(v.strictObject({}))),
          },
        ),
      },
    ),
    hubspot: group(
      { description: `${hubSpotCapabilityCount} reviewed reads.` },
      {
        doctor: c
          .meta({
            description: "Profile check.",
            examples: ["gkit --profile app-a hubspot doctor"],
          })
          .input(s(v.strictObject({}))),
        api: group(
          { description: "Native API." },
          {
            call: c
              .meta({
                description: `Call ${hubSpotCapabilityCount} reads: gkit --profile <app> hubspot api call --operation-id <id> --input @request.json --out <path> --dry-run.`,
                examples: [
                  "gkit --profile <app> hubspot api call --operation-id <id> --input @request.json --out <path> --dry-run",
                ],
              })
              .input(s(v.strictObject({}))),
          },
        ),
      },
    ),
  };
}

export function renderGkitSchema(
  manifest: LoadedExecutableManifest | readonly LoadedExecutableManifest[],
  selector: string | null,
): string {
  const root = buildGkitSchema(manifest);
  if (!selector) {
    const compactRoot = Object.fromEntries(
      Object.entries(root).filter(([name]) => name !== "site"),
    );
    return `${schemaPreamble()}${compactRootSchema(
      rewriteArgcExamples(generateSchema(compactRoot, { name: "gkit" }), manifest).replace(
        "type Gkit = {",
        "type Gkit = {\n  /** gkit --schema site */\n  site: {}",
      ),
    )}\n`;
  }

  let selected: ReturnType<typeof selectSchema>;
  try {
    const normalizedSelector =
      selector.includes("-") && /^[a-z0-9-]+$/.test(selector)
        ? `.\"${selector}\"`
        : selector.startsWith(".")
          ? selector
          : `.${selector}`;
    selected = selectSchema(root, normalizedSelector, { depth: 4 });
  } catch {
    throw new GkitFailure({
      code: "INVALID_INPUT",
      message: "The schema selector is invalid.",
    });
  }
  if (selected.empty) {
    throw new GkitFailure({
      code: "CAPABILITY_NOT_FOUND",
      message: `Schema selector ${selector} matched no commands.`,
    });
  }
  return `${schemaPreamble()}${rewriteArgcExamples(
    generateSchema(selected.schema, { name: "gkit" }),
    manifest,
  )}\n`;
}

function schemaPreamble(): string {
  return "/** argc dotted commands and @run are intentionally not exposed. */\n";
}

function compactRootSchema(generated: string): string {
  return (
    generated
      // argc 7.6+ promotes authored examples into JSDoc blocks. Keep the 7.5
      // public surface: drop doctor noise, collapse everything else that is
      // not describe / docs / ledger.reconcile.
      .replace(
        /\n[ \t]*\/\*\*\n[ \t]*\* Profile check\.\n(?:[ \t]*\*\n[ \t]*\* @example\n(?:[ \t]*\* .+\n)+)?[ \t]*\*\/\n/g,
        "\n",
      )
      .replace(
        /^([ \t]*)\/\*\*\n[ \t]*\* ([^\n]+)\n[ \t]*\*\n[ \t]*\* @example\n(?:[ \t]*\* .+\n)+[ \t]*\*\//gm,
        (block, indent: string, description: string) => {
          if (
            description.startsWith("Capability details.") ||
            description.startsWith("Provider docs directory.") ||
            description.startsWith("Manual settlement.")
          ) {
            return block;
          }
          return `${indent}/** ${description} */`;
        },
      )
      .replace(
        /^\s*\/\*\* (?:\d+ reviewed reads?\.|Profile check\.|Native API\.) \*\/\n/gm,
        "",
      )
      .replace(/\n{2,}/g, "\n")
  );
}

function rewriteArgcExamples(
  generated: string,
  _manifest: LoadedExecutableManifest | readonly LoadedExecutableManifest[],
): string {
  return generated
    .replace(/gkit describe "\{ id: 'value' \}"/g, "gkit describe --id <capability-id>")
    .replace(/gkit describe --id \S+/g, "gkit describe --id <capability-id>")
    .replace(/gkit docs "\{ provider: 'value' \}"/g, "gkit docs --provider <provider>")
    .replace(/gkit docs --provider \S+/g, "gkit docs --provider <provider>")
    .replace(
      /gkit ledger reconcile --attempt <id> --outcome confirmed_not_charged --evidence-ref ticket:123/g,
      "gkit ledger reconcile --attempt <id> --outcome <outcome> --evidence-ref <ref> [--cost-usd <decimal>]",
    )
    .replace(
      /gkit bing\.api\.call "[^"]*"/g,
      "gkit --profile <app> bing api call --operation-id <id> --input @request.json --out <path> --dry-run",
    )
    .replace(
      /gkit ledger\.reconcile "[^"]*"/g,
      "gkit ledger reconcile --attempt <id> --outcome <outcome> --evidence-ref <ref> [--cost-usd <decimal>]",
    )
    .replace(
      /gkit dataforseo\.api\.call "[^"]*"/g,
      "gkit --profile <app> dataforseo api call --operation-id <id> --input @request.json --allow-spend --max-spend-usd <decimal> --out <path> --dry-run",
    )
    .replace(
      /gkit posthog\.api\.call "[^"]*"/g,
      "gkit --profile <app> posthog api call --operation-id posthog.query.run --input @request.json --out <path> --dry-run",
    )
    .replace(
      /gkit google-ads\.api\.call "[^"]*"/g,
      "gkit --profile <app> google-ads api call --operation-id <id> --input @request.json --out <path> --dry-run",
    )
    .replace(
      /gkit gsc\.api\.call "[^"]*"/g,
      "gkit --profile <app> gsc api call --operation-id <id> --input @request.json --out <path> --dry-run",
    )
    .replace(
      /gkit hubspot\.api\.call "[^"]*"/g,
      "gkit --profile <app> hubspot api call --operation-id <id> --input @request.json --out <path> --dry-run",
    );
}
