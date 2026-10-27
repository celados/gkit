import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { renderProviderDocs } from "../src/docs";
import { compileExecutableManifest } from "../src/manifest";

type JsonRecord = Record<string, unknown>;

type SourceMetadata = {
  url: string;
  revision: string;
  checksum: string;
};

type SourceOperation = {
  path: string;
  method: string;
  operationId: string;
};

type SourceContract = {
  version: 1;
  provider: string;
  operations: SourceOperation[];
};

type ReviewedEntry = SourceOperation & {
  exposure: "executable" | "inventory";
  reason?: string;
  capability?: JsonRecord;
};

type ReviewedPolicy = {
  version: 1;
  provider: string;
  manifestRevision: string;
  reviewedAt: string;
  entries: ReviewedEntry[];
};

type InventoryOperation = SourceOperation & {
  exposure: "executable" | "inventory";
  capabilityId?: string;
  reason: string;
};

export type GeneratedContractProviderArtifacts = {
  manifest: string;
  inventory: string;
  docs: string;
  inventoryDocs: string;
};

export async function generateContractProviderArtifacts(options: {
  packageRoot: string;
  provider: string;
}): Promise<GeneratedContractProviderArtifacts> {
  const sourceDirectory = join(options.packageRoot, "sources", options.provider);
  const [sourceBytes, metadata, policy] = await Promise.all([
    readFile(join(sourceDirectory, "contract.json")),
    readJson<SourceMetadata>(join(sourceDirectory, "source.json")),
    readJson<ReviewedPolicy>(
      join(options.packageRoot, "policy", `${options.provider}.reviewed.json`),
    ),
  ]);
  const source = JSON.parse(sourceBytes.toString("utf8")) as SourceContract;
  verifyInputs(options.provider, sourceBytes, source, metadata, policy);

  const reviewed = new Map(policy.entries.map((entry) => [operationKey(entry), entry]));
  if (reviewed.size !== policy.entries.length) {
    throw new Error(`Reviewed ${options.provider} policy contains duplicate operations.`);
  }
  const inventoryOperations = [...source.operations]
    .sort(compareOperations)
    .map((operation): InventoryOperation => {
      const entry = reviewed.get(operationKey(operation));
      if (!entry) {
        return {
          ...operation,
          exposure: "inventory",
          reason: "Not reviewed for executable gkit exposure.",
        };
      }
      if (entry.operationId !== operation.operationId) {
        throw new Error(`Reviewed operation ${operationKey(operation)} has a stale operation ID.`);
      }
      if (entry.exposure === "inventory") {
        if (!entry.reason)
          throw new Error(`Inventory operation ${operationKey(entry)} needs a reason.`);
        return { ...operation, exposure: "inventory", reason: entry.reason };
      }
      if (!entry.capability) {
        throw new Error(`Executable operation ${operationKey(entry)} has no capability.`);
      }
      return {
        ...operation,
        exposure: "executable",
        capabilityId: String(entry.capability.id),
        reason: "Reviewed adapter, input, effect, and response contracts are committed.",
      };
    });

  for (const entry of policy.entries) {
    if (!source.operations.some((operation) => operationKey(operation) === operationKey(entry))) {
      throw new Error(
        `Reviewed operation ${operationKey(entry)} is absent from the pinned source.`,
      );
    }
  }

  const sourceDescriptor = {
    url: metadata.url,
    revision: metadata.revision,
    checksum: metadata.checksum,
  };
  const capabilities = policy.entries
    .filter((entry) => entry.exposure === "executable")
    .map((entry) => entry.capability!)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const manifest = stableJson({
    version: 1,
    provider: options.provider,
    revision: policy.manifestRevision,
    source: sourceDescriptor,
    reviewedAt: policy.reviewedAt,
    capabilities,
  });
  const compiled = compileExecutableManifest(JSON.parse(manifest));
  return {
    manifest,
    inventory: stableJson({
      version: 1,
      provider: options.provider,
      revision: policy.manifestRevision,
      source: sourceDescriptor,
      operations: inventoryOperations,
    }),
    docs: renderProviderDocs(compiled),
    inventoryDocs: renderInventoryDocs(
      options.provider,
      policy.manifestRevision,
      inventoryOperations,
    ),
  };
}

export async function writeContractProviderArtifacts(options: {
  packageRoot: string;
  provider: string;
  check: boolean;
}): Promise<void> {
  const artifacts = await generateContractProviderArtifacts(options);
  const outputs = [
    [join(options.packageRoot, "generated", options.provider, "manifest.json"), artifacts.manifest],
    [
      join(options.packageRoot, "generated", options.provider, "inventory.json"),
      artifacts.inventory,
    ],
    [
      join(options.packageRoot, "docs/providers", options.provider, "capabilities.md"),
      artifacts.docs,
    ],
    [
      join(options.packageRoot, "docs/providers", options.provider, "inventory.md"),
      artifacts.inventoryDocs,
    ],
  ] as const;

  if (options.check) {
    const drifted: string[] = [];
    for (const [path, expected] of outputs) {
      try {
        if ((await readFile(path, "utf8")) !== expected) drifted.push(path);
      } catch {
        drifted.push(path);
      }
    }
    if (drifted.length > 0) {
      throw new Error(`Generated ${options.provider} artifacts are stale: ${drifted.join(", ")}`);
    }
    return;
  }

  for (const [path, contents] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

function verifyInputs(
  provider: string,
  sourceBytes: Uint8Array,
  source: SourceContract,
  metadata: SourceMetadata,
  policy: ReviewedPolicy,
): void {
  const checksum = `sha256:${createHash("sha256").update(sourceBytes).digest("hex")}`;
  if (checksum !== metadata.checksum) {
    throw new Error(`Pinned ${provider} source checksum mismatch: expected ${metadata.checksum}.`);
  }
  if (source.version !== 1 || source.provider !== provider || !Array.isArray(source.operations)) {
    throw new Error(`Pinned ${provider} source contract is structurally invalid.`);
  }
  if (
    policy.version !== 1 ||
    policy.provider !== provider ||
    !policy.manifestRevision ||
    !policy.reviewedAt ||
    !Array.isArray(policy.entries)
  ) {
    throw new Error(`Reviewed ${provider} policy is structurally invalid.`);
  }
}

function renderInventoryDocs(
  provider: string,
  revision: string,
  operations: InventoryOperation[],
): string {
  const executable = operations.filter((operation) => operation.exposure === "executable").length;
  const title =
    provider === "gsc"
      ? "Google Search Console"
      : provider === "hubspot"
        ? "HubSpot"
        : provider === "pagespeed"
          ? "PageSpeed Insights"
        : "Bing Webmaster";
  const lines = [
    "---",
    "type: Reference",
    `title: ${title} operation inventory`,
    "description: >",
    `  Generated inventory of pinned ${title} operations and their gkit exposure decisions.`,
    `provider: ${provider}`,
    `inventoryRevision: ${revision}`,
    "---",
    "",
    `# ${title} operation inventory`,
    "",
    `This pinned inventory contains ${operations.length} operations: ${executable} executable and ${operations.length - executable} inventory-only.`,
    `Inventory-only operations cannot be routed by \`gkit ${provider} api call\`.`,
    "",
    "| Method | Path | Operation ID | Exposure | Decision |",
    "| --- | --- | --- | --- | --- |",
  ];
  if (provider === "hubspot") {
    lines.splice(
      lines.length - 2,
      0,
      "HubSpot record, owner, event, association, pipeline, and property artifacts may contain PII or confidential business data. The inventory records endpoint exposure only; it does not authorize copying provider data into logs or prompts.",
      "",
    );
  }
  for (const operation of operations) {
    const capability = operation.capabilityId ? `; capability: \`${operation.capabilityId}\`` : "";
    lines.push(
      `| \`${operation.method.toUpperCase()}\` | \`${operation.path}\` | \`${operation.operationId}\` | \`${operation.exposure}\` | ${operation.reason}${capability} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function operationKey(operation: Pick<SourceOperation, "method" | "path">): string {
  return `${operation.method.toLowerCase()} ${operation.path}`;
}

function compareOperations(left: SourceOperation, right: SourceOperation): number {
  return left.path.localeCompare(right.path) || left.method.localeCompare(right.method);
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}
