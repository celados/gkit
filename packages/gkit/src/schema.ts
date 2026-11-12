import { siteRouter } from "./site/schema";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { c, generateSchema, group, selectSchema, type Router } from "@celados/argc";
import * as v from "valibot";

import { GkitFailure } from "./envelope";
import type { LoadedExecutableManifest } from "./manifest";

const s = toStandardJsonSchema;

export function buildGkitSchema(
  manifest: LoadedExecutableManifest | readonly LoadedExecutableManifest[],
  { compact = false }: { compact?: boolean } = {},
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
  const pageSpeedCapabilityCount = capabilities.filter(
    (capability) => capability.provider === "pagespeed",
  ).length;
  if (capabilities.length === 0) {
    throw new GkitFailure({
      code: "INTERNAL_ERROR",
      message: "The executable manifest has no reviewed capabilities.",
    });
  }

  const provider = (description: string, doctorProfile: string, name: string, callFlags: string) =>
    group(
      { description },
      {
        ...(compact
          ? {}
          : {
              doctor: c
                .meta({
                  description: "Profile check.",
                  examples: [`gkit --profile ${doctorProfile} ${name} doctor`],
                })
                .input(s(v.strictObject({}))),
            }),
        api: group(
          {},
          {
            call: c
              .meta({
                description: "Call a reviewed capability.",
                examples: [
                  `gkit --profile <app> ${name} api call ${callFlags} --out <path> --dry-run`,
                ],
              })
              .input(s(v.strictObject({}))),
          },
        ),
      },
    );
  const idFlags = "--capability-id <id> --input @request.json";

  return {
    site: siteRouter,
    describe: c
      .meta({
        description: "Capability details.",
        examples: ["gkit describe --id <capability-id>"],
      })
      .input(s(v.strictObject({ id: v.string() }))),
    docs: c
      .meta({
        description: "Provider docs directory.",
        examples: ["gkit docs --provider <provider>"],
      })
      .input(s(v.strictObject({ provider: v.optional(v.string()) }))),
    operations: group(
      { description: "Journal." },
      {
        list: c.meta({ description: "Summary." }).input(s(v.strictObject({}))),
        show: c
          .meta({ description: "One operation." })
          .input(s(v.strictObject({ id: v.string() }))),
        reconcile: c
          .meta({
            description: "Manual settlement.",
            examples: [
              "gkit operations reconcile --id <operation-id> [--result <result>] [--spend-outcome <outcome> [--cost-usd <decimal>]] --evidence-ref <ref>",
            ],
          })
          .input(
            s(
              v.strictObject({
                id: v.string(),
                result: v.optional(v.picklist(["succeeded", "failed", "not_dispatched"])),
                spendOutcome: v.optional(
                  v.picklist(["confirmed_charged", "confirmed_not_charged"]),
                ),
                evidenceRef: v.string(),
                costUsd: v.optional(v.string()),
                providerRequestId: v.optional(v.string()),
              }),
            ),
          ),
      },
    ),
    dataforseo: provider(
      `${dataForSeoCapabilityCount} reviewed reads.`,
      "app-a",
      "dataforseo",
      `${idFlags} --allow-spend --max-spend-usd <decimal>`,
    ),
    bing: provider(`${bingCapabilityCount} reviewed reads.`, "app-a", "bing", idFlags),
    posthog: provider(
      "1 reviewed read.",
      "app-a",
      "posthog",
      "--capability-id posthog.query.run --input @request.json",
    ),
    "google-ads": provider(
      `${googleAdsCapabilityCount} reviewed reads.`,
      "openclaw-web",
      "google-ads",
      idFlags,
    ),
    gsc: provider(
      `${gscCapabilityCount} reviewed capabilities; writes need --allow-write.`,
      "openclaw-web",
      "gsc",
      idFlags,
    ),
    hubspot: provider(`${hubSpotCapabilityCount} reviewed reads.`, "app-a", "hubspot", idFlags),
    pagespeed: provider(
      `${pageSpeedCapabilityCount} reviewed reads.`,
      "app-a",
      "pagespeed",
      "--capability-id pagespeed.run --input @request.json",
    ),
  };
}

export function renderGkitSchema(
  manifest: LoadedExecutableManifest | readonly LoadedExecutableManifest[],
  selector: string | null,
): string {
  if (!selector) {
    // Root view: the dispatcher shape without `site` (own selector) and doctor noise.
    const rest = Object.fromEntries(
      Object.entries(buildGkitSchema(manifest, { compact: true })).filter(
        ([name]) => name !== "site",
      ),
    );
    return `${schemaPreamble()}${generateSchema(rest, { name: "gkit" })}\n`;
  }

  const root = buildGkitSchema(manifest);
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
  return `${schemaPreamble()}${generateSchema(selected.schema, { name: "gkit" })}\n`;
}

function schemaPreamble(): string {
  return "argc dotted commands are intentionally not exposed; run spaced commands with --flags. `gkit --schema site` lists the site commands.\n";
}
