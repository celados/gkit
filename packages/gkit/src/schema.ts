import { siteRouter } from "./site/schema";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { c, generateSchema, group, selectSchema, type Router } from "@celados/argc";
import * as v from "valibot";

import { GkitFailure } from "./envelope";
import type { LoadedExecutableManifest } from "./manifest";

const s = toStandardJsonSchema;

export const providerNames = [
  "dataforseo",
  "bing",
  "posthog",
  "google-ads",
  "gsc",
  "hubspot",
  "pagespeed",
] as const;
const providerName = v.picklist(providerNames);

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

  const capabilityIds = (name: string): string[] =>
    capabilities.filter((capability) => capability.provider === name).map(({ id }) => id);

  // `--schema <provider>` lists the flags `api call` accepts, in the spelling the
  // parser reads; the root view stays compact (no fields) to fit its token budget.
  const callInput = (name: string, extra: v.ObjectEntries) => {
    const ids = capabilityIds(name);
    return v.strictObject({
      "capability-id": ids.length > 0 ? v.picklist(ids as [string, ...string[]]) : v.string(),
      input: v.pipe(
        v.string(),
        v.description("Request JSON: inline, or `@request.json` to read it from a file"),
      ),
      out: v.optional(
        v.pipe(
          v.string(),
          v.description("File for the provider payload (stdout carries only the envelope)"),
        ),
      ),
      force: v.optional(v.pipe(v.boolean(), v.description("Replace an existing --out file"))),
      "dry-run": v.optional(v.pipe(v.boolean(), v.description("Validate and gate, no dispatch"))),
      ...extra,
    });
  };
  const profile = v.optional(
    v.pipe(v.string(), v.description("App profile; wins over GKIT_PROFILE")),
  );

  const provider = (
    description: string,
    name: string,
    callFlags: string,
    extra: v.ObjectEntries = {},
  ) =>
    group(
      { description },
      {
        ...(compact
          ? {}
          : {
              doctor: c
                .meta({ description: "Profile check; fails closed on missing config or secrets." })
                .input(s(v.strictObject({ profile }))),
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
              .input(s(compact ? v.strictObject({}) : callInput(name, { profile, ...extra }))),
          },
        ),
      },
    );
  const idFlags = "--capability-id <id> --input @request.json";
  const allowWrite = {
    "allow-write": v.optional(
      v.pipe(v.boolean(), v.description("Required for write capabilities, even with --dry-run")),
    ),
  };

  return {
    site: siteRouter,
    describe: c
      .meta({ description: "Details of one reviewed capability: effects, cost, input schema." })
      .input(s(v.strictObject({ id: v.string() }))),
    docs: c
      .meta({ description: "Directory of the generated provider docs." })
      .input(s(v.strictObject({ provider: v.optional(providerName) }))),
    operations: group(
      { description: "Journal of live calls." },
      {
        list: c
          .meta({ description: "Summary of recent operations, newest first." })
          .input(
            s(v.strictObject({ limit: v.optional(v.pipe(v.number(), v.integer()), 20) })),
          ),
        show: c
          .meta({ description: "One operation." })
          .input(s(v.strictObject({ id: v.string() }))),
        reconcile: c
          .meta({
            description:
              "Settle an unknown result or spend with provider evidence; needs --result, --spend-outcome, or both.",
          })
          .input(
            s(
              v.strictObject({
                id: v.string(),
                result: v.optional(v.picklist(["succeeded", "failed", "not_dispatched"])),
                "spend-outcome": v.optional(
                  v.picklist(["confirmed_charged", "confirmed_not_charged"]),
                ),
                "cost-usd": v.optional(
                  v.pipe(v.string(), v.description("Decimal USD; with --spend-outcome")),
                ),
                "evidence-ref": v.pipe(
                  v.string(),
                  v.description("Where the provider evidence can be inspected"),
                ),
                "provider-request-id": v.optional(v.string()),
              }),
            ),
          ),
      },
    ),
    dataforseo: provider(
      `${dataForSeoCapabilityCount} reviewed reads.`,
      "dataforseo",
      `${idFlags} --allow-spend --max-spend-usd <decimal>`,
      {
        "allow-spend": v.optional(
          v.pipe(v.boolean(), v.description("Required for capabilities that spend")),
        ),
        "max-spend-usd": v.optional(
          v.pipe(v.string(), v.description("Decimal USD ceiling for this call")),
        ),
      },
    ),
    bing: provider(`${bingCapabilityCount} reviewed reads.`, "bing", idFlags, allowWrite),
    posthog: provider(
      "1 reviewed read.",
      "posthog",
      "--capability-id posthog.query.run --input @request.json",
    ),
    "google-ads": provider(`${googleAdsCapabilityCount} reviewed reads.`, "google-ads", idFlags),
    gsc: provider(
      `${gscCapabilityCount} reviewed capabilities; writes need --allow-write.`,
      "gsc",
      idFlags,
      allowWrite,
    ),
    hubspot: provider(`${hubSpotCapabilityCount} reviewed reads.`, "hubspot", idFlags),
    pagespeed: provider(
      `${pageSpeedCapabilityCount} reviewed reads.`,
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
