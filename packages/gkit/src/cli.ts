import { fileURLToPath } from "node:url";

import { ensureTrailingNewline, formatBareSkill } from "@celados/argc/skill";

import { parseArgs, renderHelp } from "./args";
import { embedSkill } from "./skill.embed";
import { describeCapability } from "./describe";
import {
  runBingDoctor,
  runDataForSeoDoctor,
  runGoogleAdsDoctor,
  runGscDoctor,
  runHubSpotDoctor,
  runPageSpeedDoctor,
  runPostHogDoctor,
} from "./doctor";
import {
  type Envelope,
  type EnvelopeMeta,
  GkitFailure,
  parseUsdMicros,
  SecretRegistry,
  serializeEnvelope,
  toFailureEnvelope,
} from "./envelope";
import { executeDataForSeoCall } from "./execute";
import { executeBingCall } from "./execute-bing";
import { executeGoogleAdsCall } from "./execute-google-ads";
import { executeGscCall } from "./execute-gsc";
import { executeHubSpotCall } from "./execute-hubspot";
import { executePageSpeedCall } from "./execute-pagespeed";
import { executePostHogCall } from "./execute-posthog";
import {
  defaultJournalPath,
  JournalError,
  readJournal,
  settleAttempt,
  type SpendOutcome,
} from "./journal";
import { journalSummary, needsReconciliation, operationView } from "./operations-view";
import { loadExecutableManifest } from "./manifest";
import { renderGkitSchema } from "./schema";

export const dataForSeoManifestPath = fileURLToPath(
  new URL("../generated/dataforseo/manifest.json", import.meta.url),
);
export const bingManifestPath = fileURLToPath(
  new URL("../generated/bing/manifest.json", import.meta.url),
);
export const bingDocsDirectory = fileURLToPath(new URL("../docs/providers/bing", import.meta.url));
export const dataForSeoDocsDirectory = fileURLToPath(
  new URL("../docs/providers/dataforseo", import.meta.url),
);
export const postHogManifestPath = fileURLToPath(
  new URL("../generated/posthog/manifest.json", import.meta.url),
);
export const postHogDocsDirectory = fileURLToPath(
  new URL("../docs/providers/posthog", import.meta.url),
);
export const googleAdsManifestPath = fileURLToPath(
  new URL("../generated/google-ads/manifest.json", import.meta.url),
);
export const googleAdsDocsDirectory = fileURLToPath(
  new URL("../docs/providers/google-ads", import.meta.url),
);
export const gscManifestPath = fileURLToPath(
  new URL("../generated/gsc/manifest.json", import.meta.url),
);
export const gscDocsDirectory = fileURLToPath(new URL("../docs/providers/gsc", import.meta.url));
export const hubSpotManifestPath = fileURLToPath(
  new URL("../generated/hubspot/manifest.json", import.meta.url),
);
export const hubSpotDocsDirectory = fileURLToPath(
  new URL("../docs/providers/hubspot", import.meta.url),
);
export const pageSpeedManifestPath = fileURLToPath(
  new URL("../generated/pagespeed/manifest.json", import.meta.url),
);
export const pageSpeedDocsDirectory = fileURLToPath(
  new URL("../docs/providers/pagespeed", import.meta.url),
);
export const providerDocsDirectory = fileURLToPath(new URL("../docs/providers", import.meta.url));

type TerminalEmitter = {
  writeText(text: string): Promise<void>;
  writeEnvelope(envelope: Envelope, secrets?: SecretRegistry): Promise<void>;
  emitted(): boolean;
};

function createTerminalEmitter(): TerminalEmitter {
  let hasEmitted = false;

  async function writeOnce(text: string): Promise<void> {
    if (hasEmitted) return;
    hasEmitted = true;
    await new Promise<void>((resolveWrite, rejectWrite) => {
      process.stdout.write(text, (error) => {
        if (error) rejectWrite(error);
        else resolveWrite();
      });
    });
  }

  return {
    writeText: writeOnce,
    writeEnvelope: async (envelope, secrets) => {
      await writeOnce(serializeEnvelope(envelope, secrets));
    },
    emitted: () => hasEmitted,
  };
}

export async function main(
  argv: string[] = process.argv.slice(2),
  options: {
    bingManifestPath?: string;
    manifestPath?: string;
    googleAdsManifestPath?: string;
    gscManifestPath?: string;
    hubSpotManifestPath?: string;
    pageSpeedManifestPath?: string;
    postHogManifestPath?: string;
  } = {},
): Promise<void> {
  const emitter = createTerminalEmitter();
  const abortController = new AbortController();
  let signalCount = 0;
  const onSigint = (): void => {
    signalCount++;
    if (signalCount === 1) {
      abortController.abort(new Error("SIGINT"));
      return;
    }
    process.exit(130);
  };
  process.on("SIGINT", onSigint);

  try {
    const command = parseArgs(argv);
    if (command.kind === "help") {
      await emitter.writeText(renderHelp());
      process.exitCode = abortController.signal.aborted ? 130 : 0;
      return;
    }

    if (command.kind === "skill") {
      const exitCode = await renderEmbeddedSkill(command.path, emitter);
      process.exitCode = abortController.signal.aborted ? 130 : exitCode;
      return;
    }

    if (command.kind === "site") {
      const { executeSite } = await import("./site/execute");
      const envelope = await executeSite(command, abortController.signal);
      await emitter.writeEnvelope(envelope);
      process.exitCode = abortController.signal.aborted ? 130 : envelope.ok ? 0 : 1;
      return;
    }

    if (command.kind === "docs") {
      if (
        command.provider &&
        command.provider !== "dataforseo" &&
        command.provider !== "bing" &&
        command.provider !== "google-ads" &&
        command.provider !== "gsc" &&
        command.provider !== "hubspot" &&
        command.provider !== "pagespeed" &&
        command.provider !== "posthog"
      ) {
        throw new GkitFailure({
          code: "CAPABILITY_NOT_FOUND",
          message: "Provider documentation is not available for that provider.",
        });
      }
      const directory =
        command.provider === "bing"
          ? bingDocsDirectory
          : command.provider === "dataforseo"
            ? dataForSeoDocsDirectory
            : command.provider === "google-ads"
              ? googleAdsDocsDirectory
              : command.provider === "gsc"
                ? gscDocsDirectory
                : command.provider === "hubspot"
                  ? hubSpotDocsDirectory
                  : command.provider === "pagespeed"
                    ? pageSpeedDocsDirectory
                  : command.provider === "posthog"
                    ? postHogDocsDirectory
                    : providerDocsDirectory;
      await emitter.writeText(`${directory}\n`);
      process.exitCode = abortController.signal.aborted ? 130 : 0;
      return;
    }
    if (command.kind === "operations-list") {
      const snapshot = await readJournal({ journalPath: defaultJournalPath() });
      const currentCostPolicies = await loadCurrentCostPolicies(
        options.manifestPath ?? dataForSeoManifestPath,
      );
      await emitter.writeEnvelope({
        ok: true,
        data: journalSummary(snapshot, { limit: command.limit, currentCostPolicies }),
        meta: localMeta(),
      });
      process.exitCode = abortController.signal.aborted ? 130 : 0;
      return;
    }
    if (command.kind === "operations-show") {
      const snapshot = await readJournal({ journalPath: defaultJournalPath() });
      const record = snapshot.operations.find(
        (candidate) => candidate.started.operationId === command.operationId,
      );
      if (!record) {
        throw new GkitFailure({
          code: "INVALID_INPUT",
          message: "The requested operation is not present in the journal.",
        });
      }
      await emitter.writeEnvelope({
        ok: true,
        data: {
          ...operationView(record),
          events: snapshot.events.filter((event) => event.operationId === command.operationId),
        },
        meta: localMeta(),
      });
      process.exitCode = abortController.signal.aborted ? 130 : 0;
      return;
    }
    if (command.kind === "operations-reconcile") {
      const journalPath = defaultJournalPath();
      const snapshot = await readJournal({ journalPath });
      const record = snapshot.operations.find(
        (candidate) => candidate.started.operationId === command.operationId,
      );
      if (!record) {
        throw new GkitFailure({
          code: "INVALID_INPUT",
          message: "The requested operation is not present in the journal.",
        });
      }
      if (!needsReconciliation(record)) {
        throw new GkitFailure({
          code: "INVALID_INPUT",
          message: "The operation already has a confirmed settlement.",
          hint: "Reconcile only operations whose provider result or spend amount is unknown.",
        });
      }
      const latest = record.latestSettlement;
      const providerResult =
        command.providerResult ??
        (latest !== null && latest.providerResult !== "unknown" ? latest.providerResult : null);
      if (providerResult === null) {
        throw new GkitFailure({
          code: "INVALID_INPUT",
          message: "The provider result is unknown; pass --result from provider evidence.",
        });
      }
      let spend: { outcome: Exclude<SpendOutcome, "unknown">; costMicros: number } | null = null;
      if (record.started.spend === null) {
        if (command.spendOutcome !== null || command.costUsd !== null) {
          throw new GkitFailure({
            code: "INVALID_INPUT",
            message: "The operation did not authorize spend, so it takes no spend reconciliation.",
          });
        }
      } else {
        const known = latest?.spend;
        if (command.spendOutcome !== null) {
          spend = {
            outcome: command.spendOutcome,
            costMicros: reconciliationCost(command.spendOutcome, command.costUsd),
          };
        } else if (known && known.outcome !== "unknown" && known.costMicros !== null) {
          spend = { outcome: known.outcome, costMicros: known.costMicros };
        } else {
          throw new GkitFailure({
            code: "INVALID_INPUT",
            message: "The spend amount is unknown; pass --spend-outcome from provider evidence.",
          });
        }
      }
      const settlement = await settleAttempt({
        journalPath,
        settlement: {
          operationId: command.operationId,
          providerResult,
          errorCode: providerResult === "succeeded" ? null : (latest?.errorCode ?? null),
          providerRequestId: command.providerRequestId ?? latest?.providerRequestId ?? null,
          spend,
          source: "manual",
          evidenceRef: command.evidenceRef,
        },
      });
      await emitter.writeEnvelope({
        ok: true,
        data: {
          operationId: settlement.operationId,
          eventId: settlement.eventId,
          providerResult: settlement.providerResult,
          providerRequestId: settlement.providerRequestId,
          spend: settlement.spend,
        },
        meta: localMeta(),
      });
      process.exitCode = abortController.signal.aborted ? 130 : 0;
      return;
    }
    if (command.kind === "dataforseo-doctor") {
      const result = await runDataForSeoDoctor({ profileFlag: command.profileFlag });
      await emitter.writeEnvelope(result.envelope, result.secrets);
      process.exitCode = abortController.signal.aborted ? 130 : result.envelope.ok ? 0 : 1;
      return;
    }
    if (command.kind === "bing-doctor") {
      const result = await runBingDoctor({ profileFlag: command.profileFlag });
      await emitter.writeEnvelope(result.envelope, result.secrets);
      process.exitCode = abortController.signal.aborted ? 130 : result.envelope.ok ? 0 : 1;
      return;
    }
    if (command.kind === "posthog-doctor") {
      const result = await runPostHogDoctor({ profileFlag: command.profileFlag });
      await emitter.writeEnvelope(result.envelope, result.secrets);
      process.exitCode = abortController.signal.aborted ? 130 : result.envelope.ok ? 0 : 1;
      return;
    }
    if (command.kind === "google-ads-doctor") {
      const result = await runGoogleAdsDoctor({ profileFlag: command.profileFlag });
      await emitter.writeEnvelope(result.envelope, result.secrets);
      process.exitCode = abortController.signal.aborted ? 130 : result.envelope.ok ? 0 : 1;
      return;
    }
    if (command.kind === "gsc-doctor") {
      const result = await runGscDoctor({ profileFlag: command.profileFlag });
      await emitter.writeEnvelope(result.envelope, result.secrets);
      process.exitCode = abortController.signal.aborted ? 130 : result.envelope.ok ? 0 : 1;
      return;
    }
    if (command.kind === "pagespeed-doctor") {
      const result = await runPageSpeedDoctor({ profileFlag: command.profileFlag });
      await emitter.writeEnvelope(result.envelope, result.secrets);
      process.exitCode = abortController.signal.aborted ? 130 : result.envelope.ok ? 0 : 1;
      return;
    }
    if (command.kind === "hubspot-doctor") {
      const result = await runHubSpotDoctor({
        profileFlag: command.profileFlag,
        signal: abortController.signal,
      });
      await emitter.writeEnvelope(result.envelope, result.secrets);
      process.exitCode = abortController.signal.aborted ? 130 : result.envelope.ok ? 0 : 1;
      return;
    }

    if (command.kind === "schema") {
      const manifests = await loadDiscoveryManifests(options);
      await emitter.writeText(renderGkitSchema(manifests, command.selector));
      process.exitCode = abortController.signal.aborted ? 130 : 0;
      return;
    }
    if (command.kind === "describe") {
      const manifests = await loadDiscoveryManifests(options);
      await emitter.writeText(describeCapability(manifests, command.id));
      process.exitCode = abortController.signal.aborted ? 130 : 0;
      return;
    }
    const result =
      command.kind === "dataforseo-call"
        ? await executeDataForSeoCall({
            command,
            manifest: await loadExecutableManifest(options.manifestPath ?? dataForSeoManifestPath),
            signal: abortController.signal,
          })
        : command.kind === "bing-call"
          ? await executeBingCall({
              command,
              manifest: await loadExecutableManifest(options.bingManifestPath ?? bingManifestPath),
              signal: abortController.signal,
            })
          : command.kind === "google-ads-call"
            ? await executeGoogleAdsCall({
                command,
                manifest: await loadExecutableManifest(
                  options.googleAdsManifestPath ?? googleAdsManifestPath,
                ),
                signal: abortController.signal,
              })
            : command.kind === "gsc-call"
              ? await executeGscCall({
                  command,
                  manifest: await loadExecutableManifest(
                    options.gscManifestPath ?? gscManifestPath,
                  ),
                  signal: abortController.signal,
                })
              : command.kind === "hubspot-call"
                ? await executeHubSpotCall({
                    command,
                    manifest: await loadExecutableManifest(
                      options.hubSpotManifestPath ?? hubSpotManifestPath,
                    ),
                    signal: abortController.signal,
                  })
              : command.kind === "pagespeed-call"
                ? await executePageSpeedCall({
                    command,
                    manifest: await loadExecutableManifest(
                      options.pageSpeedManifestPath ?? pageSpeedManifestPath,
                    ),
                    signal: abortController.signal,
                  })
              : await executePostHogCall({
                  command,
                  manifest: await loadExecutableManifest(
                    options.postHogManifestPath ?? postHogManifestPath,
                  ),
                  signal: abortController.signal,
                });
    await emitter.writeEnvelope(result.envelope, result.secrets);
    process.exitCode = abortController.signal.aborted ? 130 : result.exitCode;
  } catch (error) {
    if (!emitter.emitted()) {
      await emitter.writeEnvelope(toFailureEnvelope(normalizeTopLevelError(error)));
    }
    process.exitCode = abortController.signal.aborted ? 130 : 1;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

async function renderEmbeddedSkill(
  path: string | null,
  emitter: TerminalEmitter,
): Promise<0 | 1> {
  const vfs = await embedSkill();
  if (path === null) {
    const body = vfs["SKILL.md"];
    if (body === undefined) {
      throw new GkitFailure({
        code: "INTERNAL_ERROR",
        message: "The embedded skill is missing SKILL.md.",
      });
    }
    await emitter.writeText(formatBareSkill(body, Object.keys(vfs), "gkit"));
    return 0;
  }
  const content = vfs[path];
  if (content === undefined) {
    // Match argc's UNKNOWN_SKILL_FILE envelope so agents can correct the path
    // in one shot. This builtin is not a gkit JSON envelope.
    const files = Object.keys(vfs).sort();
    process.stderr.write(
      `error: UNKNOWN_SKILL_FILE\ngot: ${path}\nfiles:\n${files
        .map((file) => `  - ${file}`)
        .join("\n")}\n`,
    );
    return 1;
  }
  await emitter.writeText(ensureTrailingNewline(content));
  return 0;
}

async function loadDiscoveryManifests(options: {
  bingManifestPath?: string;
  manifestPath?: string;
  googleAdsManifestPath?: string;
  gscManifestPath?: string;
  hubSpotManifestPath?: string;
  pageSpeedManifestPath?: string;
  postHogManifestPath?: string;
}) {
  return await Promise.all([
    loadExecutableManifest(options.bingManifestPath ?? bingManifestPath),
    loadExecutableManifest(options.manifestPath ?? dataForSeoManifestPath),
    loadExecutableManifest(options.googleAdsManifestPath ?? googleAdsManifestPath),
    loadExecutableManifest(options.gscManifestPath ?? gscManifestPath),
    loadExecutableManifest(options.hubSpotManifestPath ?? hubSpotManifestPath),
    loadExecutableManifest(options.pageSpeedManifestPath ?? pageSpeedManifestPath),
    loadExecutableManifest(options.postHogManifestPath ?? postHogManifestPath),
  ]);
}

async function loadCurrentCostPolicies(manifestPath: string): Promise<Map<string, string> | null> {
  try {
    const manifest = await loadExecutableManifest(manifestPath);
    return new Map(
      manifest.document.capabilities.flatMap((record) =>
        record.cost ? [[record.id, record.cost.policyRevision] as const] : [],
      ),
    );
  } catch {
    return null;
  }
}

function normalizeTopLevelError(error: unknown): unknown {
  if (!(error instanceof JournalError)) return error;
  const localIoCodes = new Set(["JOURNAL_CORRUPT", "JOURNAL_IO_ERROR", "JOURNAL_LOCKED"]);
  if (localIoCodes.has(error.code)) {
    return new GkitFailure({
      code: "LOCAL_IO_ERROR",
      message: "The local operation journal could not be read or updated safely.",
      hint: "Inspect the journal path, contents, and lock before retrying.",
    });
  }
  return new GkitFailure({
    code: "INVALID_INPUT",
    message: "The requested journal change is not valid for the current operation state.",
    hint: "Run gkit operations and reconcile only unresolved operations with provider evidence.",
  });
}

function localMeta(): EnvelopeMeta {
  return {
    profile: null,
    provider: null,
    capability: null,
    effects: [],
    operationId: null,
    artifact: null,
    providerRequestId: null,
    spend: null,
  };
}

function reconciliationCost(
  outcome: Exclude<SpendOutcome, "unknown">,
  costUsd: string | null,
): number {
  if (outcome === "confirmed_charged") {
    if (costUsd === null) {
      throw new GkitFailure({
        code: "INVALID_INPUT",
        message: "A charged reconciliation requires --cost-usd from provider evidence.",
      });
    }
    const micros = parseUsdMicros(costUsd);
    if (micros === 0) {
      throw new GkitFailure({
        code: "INVALID_INPUT",
        message: "A charged reconciliation must have a positive evidenced cost.",
      });
    }
    return micros;
  }
  if (costUsd !== null && parseUsdMicros(costUsd) !== 0) {
    throw new GkitFailure({
      code: "INVALID_INPUT",
      message: "A not-charged reconciliation cannot record a positive cost.",
    });
  }
  return 0;
}

if (import.meta.main) {
  await main();
}
