import type { LoadedExecutableManifest, ManifestRecord } from "./manifest";

export function renderProviderDocs(manifest: LoadedExecutableManifest): string {
  const providerLabel =
    {
      dataforseo: "DataForSEO",
      "google-ads": "Google Ads",
      hubspot: "HubSpot",
      pagespeed: "PageSpeed Insights",
      posthog: "PostHog",
    }[manifest.document.provider] ?? manifest.document.provider;
  const lines = [
    "---",
    "type: Reference",
    `title: ${providerLabel} reviewed executable capabilities`,
    "description: >",
    `  Generated, searchable documentation for the reviewed ${providerLabel} operations`,
    "  that gkit is allowed to route and execute.",
    `provider: ${manifest.document.provider}`,
    `manifestRevision: ${manifest.document.revision}`,
    "---",
    "",
    `# ${providerLabel} reviewed executable capabilities`,
    "",
    `This file is byte-stably rendered from \`generated/${manifest.document.provider}/manifest.json\`.`,
    "The committed manifest remains the only runtime, validation, effect, cost, and discovery source.",
    "",
  ];

  if (manifest.document.provider === "hubspot") {
    lines.push(
      "## Data sensitivity",
      "",
      "HubSpot artifacts can contain personal data: contact names and email addresses; owner names, email addresses, and teams; ticket subjects or content; event URLs, page titles, object IDs, and event properties. Company records, deal names and amounts, association IDs, pipeline labels, and property metadata can also disclose confidential business context.",
      "",
      "Treat every HubSpot artifact as sensitive. Store it only at an access-controlled path, do not paste raw CRM rows into prompts or logs, and request only the reviewed properties required for the bounded analysis. The properties capability requests HubSpot's default non-sensitive metadata view and does not opt into sensitive-property definitions.",
      "",
    );
  }

  for (const record of manifest.document.capabilities) {
    lines.push(...renderCapability(record));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderCapability(record: ManifestRecord): string[] {
  const lines = [
    `## ${record.id}`,
    "",
    record.description,
    "",
    `- Provider: \`${record.provider}\``,
    `- Adapter key: \`${record.adapterKey}\``,
    `- Capability revision: \`${record.revision}\``,
    `- Effects: ${record.effects.map((effect) => `\`${effect}\``).join(", ")}`,
  ];

  if (record.cost) {
    lines.push(
      `- Cost-policy revision: \`${record.cost.policyRevision}\``,
      `- Conservative cost model: ${renderCostModel(record.cost.model)}`,
    );
  }

  lines.push("", "### Input schema", "", "```json");
  lines.push(JSON.stringify(record.inputSchema, null, 2));
  lines.push("```", "", "### Invocation", "");
  for (const example of record.examples) {
    if (example.title) lines.push(`#### ${example.title}`, "");
    lines.push("```bash", example.command, "```", "");
  }
  return lines;
}

function renderCostModel(model: NonNullable<ManifestRecord["cost"]>["model"]): string {
  if (model.type === "fixed") {
    return `\`${model.micros}\` micros per request`;
  }
  if (model.type === "linear-items") {
    return `\`${model.baseMicros}\` base micros + \`${model.perItemMicros}\` micros per item at \`${model.itemsJsonPointer}\` (max \`${model.maxItems}\`)`;
  }
  return `\`${model.baseMicros}\` base micros + \`${model.perUnitMicros}\` micros per numeric unit at \`${model.valueJsonPointer}\` (max \`${model.maxValue}\`)`;
}
