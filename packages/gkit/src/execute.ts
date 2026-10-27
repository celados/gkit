import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ArtifactError,
  reserveArtifactDestination,
  type ArtifactReceipt as StoredArtifactReceipt,
  type ArtifactReservation,
} from "./artifact";
import type { ParsedCommand } from "./args";
import { sha256CanonicalJson } from "./canonical";
import { evaluateEffects, type AllowedEffectDecision } from "./effects";
import {
  type Envelope,
  type EnvelopeMeta,
  formatUsdMicros,
  GkitFailure,
  SecretRegistry,
  toFailureEnvelope,
} from "./envelope";
import {
  defaultJournalPath,
  getSpendBlockers,
  JournalError,
  recordArtifact,
  settleAttempt,
  SpendBlockedError,
  startAttempt,
  type AttemptSettledEvent,
} from "./journal";
import { providerResultOf } from "./operation-recorder";
import {
  getManifestRecord,
  ManifestError,
  type LoadedExecutableManifest,
  validateManifestInput,
} from "./manifest";
import {
  getProviderEnvironment,
  getProviderProfile,
  loadProfile,
  loadProfileEnvironment,
  ProfileError,
  resolveProviderSecrets,
  selectProfileName,
} from "./profile";
import type {
  DataForSeoAdapterKey,
  DataForSeoDispatchResult,
  DataForSeoFetch,
} from "./providers/dataforseo";

type DataForSeoCallCommand = Extract<ParsedCommand, { kind: "dataforseo-call" }>;

export type ExecuteResult = {
  envelope: Envelope;
  secrets: SecretRegistry;
  exitCode: 0 | 1 | 130;
};

export type ExecuteDependencies = {
  readFile: typeof readFile;
  loadProfile: typeof loadProfile;
  resolveProviderSecrets: typeof resolveProviderSecrets;
  getSpendBlockers: typeof getSpendBlockers;
  startAttempt: typeof startAttempt;
  settleAttempt: typeof settleAttempt;
  recordArtifact: typeof recordArtifact;
  reserveArtifactDestination: typeof reserveArtifactDestination;
  loadDataForSeoAdapter: () => Promise<{
    dispatchDataForSeo: (options: {
      adapterKey: DataForSeoAdapterKey;
      input: unknown;
      credentials: Readonly<{ login: string; password: string }>;
      environment: "production" | "sandbox";
      signal: AbortSignal;
      fetch?: DataForSeoFetch;
      timeoutMs?: number;
    }) => Promise<DataForSeoDispatchResult>;
  }>;
  randomOperationId: () => string;
};

const defaultDependencies: ExecuteDependencies = {
  readFile,
  loadProfile,
  resolveProviderSecrets,
  getSpendBlockers,
  startAttempt,
  settleAttempt,
  recordArtifact,
  reserveArtifactDestination,
  loadDataForSeoAdapter: async () => await import("./providers/dataforseo"),
  randomOperationId: randomUUID,
};

const dataForSeoAdapterKeys = new Set<DataForSeoAdapterKey>([
  "ai_optimization.llm_mentions.search.live",
  "backlinks.bulk_ranks.live",
  "backlinks.referring_domains.live",
  "backlinks.summary.live",
  "serp.google.organic.live.advanced",
]);

type ExecutionContext = {
  profile: string | null;
  capability: string | null;
  effects: string[];
  operationId: string | null;
  spendOutcome: "confirmed_charged" | "confirmed_not_charged" | "unknown" | null;
  providerRequestId: string | null;
  actualCostMicros: number | null;
  artifact: StoredArtifactReceipt | null;
};

function baseContext(): ExecutionContext {
  return {
    profile: null,
    capability: null,
    effects: [],
    operationId: null,
    spendOutcome: null,
    providerRequestId: null,
    actualCostMicros: null,
    artifact: null,
  };
}

function contextMeta(context: ExecutionContext): EnvelopeMeta {
  return {
    profile: context.profile,
    provider: "dataforseo",
    capability: context.capability,
    effects: context.effects,
    operationId: context.operationId,
    artifact: context.artifact,
    providerRequestId: context.providerRequestId,
    spend:
      context.spendOutcome === null
        ? null
        : {
            outcome: context.spendOutcome,
            cost:
              context.actualCostMicros === null
                ? null
                : { amount: formatUsdMicros(context.actualCostMicros), currency: "USD" },
          },
  };
}

export async function executeDataForSeoCall(options: {
  command: DataForSeoCallCommand;
  manifest: LoadedExecutableManifest;
  signal: AbortSignal;
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
  journalPath?: string;
  dependencies?: Partial<ExecuteDependencies>;
}): Promise<ExecuteResult> {
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const secrets = new SecretRegistry();
  const context = baseContext();
  const env = options.env ?? process.env;
  let reservation: ArtifactReservation | null = null;
  let dispatched = false;
  let authorized = false;
  let authorizationSettled = false;

  try {
    throwIfCancelledBeforeAuthorization(options.signal);
    const record = getManifestRecord(options.manifest, options.command.capabilityId);
    context.capability = record.id;
    context.effects = [...record.effects];

    const input = await readRequestInput(options.command.input, dependencies.readFile);
    const validation = validateManifestInput(record, input);
    if (!validation.ok) {
      throw new GkitFailure({
        code: "INVALID_INPUT",
        message: "The request input does not satisfy the executable manifest schema.",
        details: {
          issues: validation.issues.map((issue) => ({
            path: issue.instancePath || "/",
            keyword: issue.keyword,
            message: issue.message,
          })),
        },
      });
    }

    const profileName = selectProfileName(options.command.profileFlag ?? undefined, env);
    context.profile = profileName;
    const profile = await dependencies.loadProfile(profileName, {
      xdgConfigHome: options.xdgConfigHome,
      home: options.home,
    });
    const providerProfile = getProviderProfile(profile, "dataforseo");
    const environment = getProviderEnvironment(profile, "dataforseo");
    const effectDecision = evaluateEffects({
      record,
      input,
      profilePolicy: providerProfile.policy,
      authorization: {
        allowSpend: options.command.allowSpend,
        maxSpendUsd: options.command.maxSpendUsd ?? undefined,
      },
      environment,
    });
    if (!effectDecision.allowed) {
      throw new GkitFailure({
        code: "EFFECT_NOT_ALLOWED",
        message: effectDecision.message,
        hint: effectDecision.hint,
        meta: contextMeta(context),
      });
    }
    const adapterKey = record.adapterKey;
    assertSupportedDataForSeoAdapterKey(adapterKey);

    const inputSha256 = sha256CanonicalJson(input);
    throwIfCancelledBeforeAuthorization(options.signal);
    if (options.command.dryRun) {
      return {
        envelope: dryRunEnvelope({
          context,
          effectDecision,
          input,
          inputSha256,
          out: options.command.out,
        }),
        secrets,
        exitCode: 0,
      };
    }

    if (!options.command.out) {
      throw new GkitFailure({
        code: "INVALID_INPUT",
        message:
          "DataForSEO execution requires --out so raw provider facts are not written to stdout.",
      });
    }

    throwIfCancelledBeforeAuthorization(options.signal);
    reservation = await dependencies.reserveArtifactDestination({
      destinationPath: options.command.out,
      force: options.command.force,
    });

    const journalPath = options.journalPath ?? defaultJournalPath(env);
    const blockers = await dependencies.getSpendBlockers({
      journalPath,
      profile: profile.name,
      provider: "dataforseo",
      capability: record.id,
      costPolicyRevision: requiredPolicyRevision(effectDecision),
      inputSha256,
    });
    throwIfCancelledBeforeAuthorization(options.signal);
    if (blockers.length > 0) {
      throw new SpendBlockedError(journalPath, blockers);
    }

    const profileEnvironment = await loadProfileEnvironment(profile, env);
    const resolvedSecrets = dependencies.resolveProviderSecrets(
      profile,
      "dataforseo",
      profileEnvironment,
    );
    const login = resolvedSecrets.login;
    const password = resolvedSecrets.password;
    if (!login || !password) {
      throw new ProfileError(
        "invalid_profile",
        "DataForSEO requires login and password env references under secrets.",
      );
    }
    secrets.registerBasicAuth(login, password);

    throwIfCancelledBeforeAuthorization(options.signal);
    const operationId = dependencies.randomOperationId();
    await dependencies.startAttempt({
      journalPath,
      attempt: {
        operationId,
        profile: profile.name,
        provider: "dataforseo",
        capability: record.id,
        capabilityRevision: record.revision,
        effects: record.effects,
        inputSha256,
        spend: {
          costPolicyRevision: requiredPolicyRevision(effectDecision),
          maxCostMicros: requiredMaxCost(effectDecision),
          invocationMaxCostMicros: requiredInvocationCap(effectDecision),
        },
      },
    });
    context.operationId = operationId;
    authorized = true;

    if (options.signal.aborted) {
      const settled = await dependencies.settleAttempt({
        journalPath,
        settlement: {
          operationId,
          providerResult: "not_dispatched",
          errorCode: "CANCELLED",
          spend: { outcome: "confirmed_not_charged", costMicros: 0 },
        },
      });
      applySettlement(context, settled);
      authorizationSettled = true;
      throw new GkitFailure({
        code: "CANCELLED",
        message: "The invocation was cancelled before provider dispatch.",
        outcome: "not_dispatched",
        meta: contextMeta(context),
      });
    }

    let providerResult: DataForSeoDispatchResult;
    try {
      const adapter = await dependencies.loadDataForSeoAdapter();
      if (options.signal.aborted) {
        const settled = await dependencies.settleAttempt({
          journalPath,
          settlement: {
            operationId,
            providerResult: "not_dispatched",
            errorCode: "CANCELLED",
            spend: { outcome: "confirmed_not_charged", costMicros: 0 },
          },
        });
        applySettlement(context, settled);
        authorizationSettled = true;
        throw new GkitFailure({
          code: "CANCELLED",
          message: "The invocation was cancelled before provider dispatch.",
          outcome: "not_dispatched",
          meta: contextMeta(context),
        });
      }
      dispatched = true;
      providerResult = await adapter.dispatchDataForSeo({
        adapterKey,
        input,
        credentials: Object.freeze({ login, password }),
        environment,
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof GkitFailure) throw error;
      if (!dispatched) {
        const settled = await dependencies.settleAttempt({
          journalPath,
          settlement: {
            operationId,
            providerResult: "not_dispatched",
            errorCode: "INTERNAL_ERROR",
            spend: { outcome: "confirmed_not_charged", costMicros: 0 },
          },
        });
        applySettlement(context, settled);
        authorizationSettled = true;
        throw new GkitFailure({
          code: "INTERNAL_ERROR",
          message: "The reviewed DataForSEO adapter could not be loaded.",
          outcome: "not_dispatched",
          meta: contextMeta(context),
        });
      }
      providerResult = {
        ok: false,
        code: "UNKNOWN_OUTCOME",
        message: "The dispatched DataForSEO request ended without a confirmed outcome.",
        retryable: false,
        outcome: "unknown",
        details: null,
        rawBytes: null,
        providerRequestId: null,
        costMicros: null,
        costIsConfirmed: false,
      };
    }

    const providerRequestId = safeDataForSeoRequestId(providerResult.providerRequestId, secrets);
    context.providerRequestId = providerRequestId;
    const reportedCostMicros = environment === "sandbox" ? 0 : providerResult.costMicros;
    context.actualCostMicros = reportedCostMicros;
    context.spendOutcome = settlementOutcome(
      providerResult,
      reportedCostMicros,
      environment === "sandbox",
    );

    let settlement: AttemptSettledEvent;
    try {
      settlement = await dependencies.settleAttempt({
        journalPath,
        settlement: {
          operationId,
          providerResult: providerResultOf(providerResult),
          errorCode: providerResult.ok ? null : providerResult.code,
          providerRequestId,
          spend: { outcome: context.spendOutcome ?? "unknown", costMicros: reportedCostMicros },
        },
      });
    } catch {
      if (providerResult.rawBytes) {
        try {
          context.artifact = await reservation.publish({
            source: providerResult.rawBytes,
            secretValues: Object.values(resolvedSecrets),
            basicAuthCredentials: [{ login, password }],
          });
        } catch {
          // The durable provider fact remains unresolved; artifact evidence is best effort.
        }
      }
      try {
        await reservation.release();
      } catch {
        // The settlement failure remains the primary recovery concern.
      }
      reservation = null;
      throw new GkitFailure({
        code: "LOCAL_IO_ERROR",
        message: "The provider response facts could not be appended to the durable operation journal.",
        hint: "Do not rerun the provider request; inspect and reconcile it with gkit operations.",
        retryable: false,
        outcome: providerResult.ok ? "confirmed" : providerResult.outcome,
        meta: contextMeta(context),
      });
    }
    applySettlement(context, settlement);
    authorizationSettled = true;

    let artifactFailure: ArtifactError | null = null;
    if (providerResult.rawBytes) {
      try {
        context.artifact = await reservation.publish({
          source: providerResult.rawBytes,
          secretValues: Object.values(resolvedSecrets),
          basicAuthCredentials: [{ login, password }],
        });
      } catch (error) {
        artifactFailure = normalizeArtifactError(error);
      }
    }

    try {
      await reservation.release();
      reservation = null;
    } catch (error) {
      artifactFailure ??= normalizeArtifactError(error);
      reservation = null;
    }
    if (context.artifact && !artifactFailure) {
      try {
        await dependencies.recordArtifact({
          journalPath,
          operationId,
          artifact: context.artifact,
        });
      } catch {
        throw new GkitFailure({
          code: "LOCAL_IO_ERROR",
          message: "The provider artifact was published, but the operation journal could not link it.",
          hint: "Do not rerun the provider request; inspect it with gkit operations.",
          retryable: false,
          outcome: providerResult.ok ? "confirmed" : providerResult.outcome,
          meta: contextMeta(context),
        });
      }
    }

    if (!providerResult.ok && providerResult.outcome === "unknown") {
      throw new GkitFailure({
        code: "UNKNOWN_OUTCOME",
        message: providerResult.message,
        hint: "Reconcile this attempt with provider evidence before considering another call.",
        retryable: false,
        outcome: "unknown",
        details: appendExecutionDetails(providerResult.details, {
          artifactFailure,
          policyBreach: settlement.spend?.policyBreach === true,
        }),
        meta: contextMeta(context),
      });
    }

    if (settlement.spend?.policyBreach) {
      throw new GkitFailure({
        code: "SPEND_POLICY_BREACH",
        message: "DataForSEO reported a cost above the reviewed authorized bound.",
        hint:
          context.spendOutcome === "unknown"
            ? "Reconcile the spend amount with provider evidence, then publish a new cost-policy revision before another call."
            : "Review the provider evidence and publish a new cost-policy revision before another call.",
        retryable: false,
        outcome: "confirmed",
        details: artifactFailure ? { artifactPublication: "failed" } : null,
        meta: contextMeta(context),
      });
    }

    if (artifactFailure) {
      throw new GkitFailure({
        code: "LOCAL_IO_ERROR",
        message:
          "The provider request completed, but its raw artifact could not be published safely.",
        hint: "Do not rerun a charged or unknown spend attempt; inspect gkit operations and the artifact path.",
        retryable: false,
        outcome: providerResult.ok ? "confirmed" : providerResult.outcome,
        meta: contextMeta(context),
      });
    }

    if (!providerResult.ok) {
      throw new GkitFailure({
        code: providerResult.code,
        message: providerResult.message,
        hint:
          context.spendOutcome === "unknown"
            ? "Reconcile the spend amount with provider evidence before considering another call."
            : null,
        retryable: false,
        outcome: providerResult.outcome,
        details: providerResult.details,
        meta: contextMeta(context),
      });
    }

    if (context.spendOutcome === "unknown") {
      throw new GkitFailure({
        code: "PROVIDER_ERROR",
        message: "The provider result was confirmed, but its spend amount was not.",
        hint: "Reconcile the spend amount with provider evidence before considering another call.",
        retryable: false,
        outcome: "confirmed",
        meta: contextMeta(context),
      });
    }

    return {
      envelope: {
        ok: true,
        data: {
          itemsCount: providerResult.data.itemsCount,
          artifact: context.artifact,
        },
        meta: contextMeta(context),
      },
      secrets,
      exitCode: options.signal.aborted ? 130 : 0,
    };
  } catch (error) {
    let cleanupFailed = false;
    if (reservation) {
      try {
        await reservation.release();
      } catch {
        cleanupFailed = true;
        error = new GkitFailure({
          code: "LOCAL_IO_ERROR",
          message: "The artifact reservation could not be released safely.",
          hint: "Inspect the artifact lock and gkit operations before retrying.",
          meta: contextMeta(context),
        });
      }
    }

    if (options.signal.aborted && !dispatched) {
      const localStateIsUncertain =
        cleanupFailed ||
        error instanceof JournalError ||
        error instanceof ArtifactError ||
        (error instanceof GkitFailure && error.code === "LOCAL_IO_ERROR") ||
        (authorized && !authorizationSettled);
      error = localStateIsUncertain
        ? new GkitFailure({
            code: "LOCAL_IO_ERROR",
            message:
              "The invocation was not dispatched, but its local authorization or cleanup state is unresolved.",
            hint: "Inspect gkit operations and local locks before considering another call.",
            outcome: "not_dispatched",
            meta: contextMeta(context),
          })
        : new GkitFailure({
            code: "CANCELLED",
            message: "The invocation was cancelled before provider dispatch.",
            outcome: "not_dispatched",
            meta: contextMeta(context),
          });
    }
    const normalized = normalizeExecutionError(error, context);
    return {
      envelope: toFailureEnvelope(normalized),
      secrets,
      exitCode: options.signal.aborted ? 130 : 1,
    };
  }
}

async function readRequestInput(reference: string, read: typeof readFile): Promise<unknown> {
  let source: string;
  if (reference.startsWith("@")) {
    const path = reference.slice(1);
    if (!path) {
      throw new GkitFailure({
        code: "INVALID_INPUT",
        message: "--input @<path> requires a file path.",
      });
    }
    try {
      source = await read(path, "utf8");
    } catch {
      throw new GkitFailure({
        code: "LOCAL_IO_ERROR",
        message: "The request input file could not be read.",
      });
    }
  } else {
    source = reference;
  }

  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new GkitFailure({
      code: "INVALID_INPUT",
      message: "--input must contain valid JSON or reference a JSON file with @path.",
    });
  }
}

function dryRunEnvelope(options: {
  context: ExecutionContext;
  effectDecision: AllowedEffectDecision;
  input: unknown;
  inputSha256: string;
  out: string | null;
}): Envelope {
  const targetCount =
    options.input !== null &&
    typeof options.input === "object" &&
    Array.isArray((options.input as Record<string, unknown>).targets)
      ? ((options.input as Record<string, unknown>).targets as unknown[]).length
      : null;
  return {
    ok: true,
    data: {
      dryRun: true,
      requestPlan: {
        provider: "dataforseo",
        capability: options.context.capability,
        environment: options.effectDecision.environment,
        method: "POST",
        endpoint: options.context.capability,
        targetCount,
        inputSha256: options.inputSha256,
        artifactPath: options.out ? resolve(options.out) : null,
      },
      costUpperBound: {
        amount: formatUsdMicros(requiredMaxCost(options.effectDecision)),
        liveAmount: formatUsdMicros(
          options.effectDecision.liveCostUpperBoundMicros ??
            requiredMaxCost(options.effectDecision),
        ),
        currency: "USD",
      },
    },
    meta: contextMeta(options.context),
  };
}

function requiredPolicyRevision(decision: AllowedEffectDecision): string {
  if (!decision.policyRevision) {
    throw new GkitFailure({
      code: "INTERNAL_ERROR",
      message: "A spend capability was allowed without a cost-policy revision.",
    });
  }
  return decision.policyRevision;
}

function assertSupportedDataForSeoAdapterKey(
  adapterKey: string,
): asserts adapterKey is DataForSeoAdapterKey {
  if (!dataForSeoAdapterKeys.has(adapterKey as DataForSeoAdapterKey)) {
    throw new GkitFailure({
      code: "INTERNAL_ERROR",
      message: "The executable manifest references an unavailable reviewed adapter key.",
    });
  }
}

function requiredMaxCost(decision: AllowedEffectDecision): number {
  if (decision.maxCostMicros === null) {
    throw new GkitFailure({
      code: "INTERNAL_ERROR",
      message: "A spend capability was allowed without an integer-micros cost bound.",
    });
  }
  return decision.maxCostMicros;
}

function requiredInvocationCap(decision: AllowedEffectDecision): number {
  if (decision.invocationMaxCostMicros === null) {
    throw new GkitFailure({
      code: "INTERNAL_ERROR",
      message: "A spend capability was allowed without an invocation cap.",
    });
  }
  return decision.invocationMaxCostMicros;
}

function spendOutcome(
  costMicros: number | null,
): "confirmed_charged" | "confirmed_not_charged" | "unknown" {
  if (costMicros === null) return "unknown";
  return costMicros > 0 ? "confirmed_charged" : "confirmed_not_charged";
}

function settlementOutcome(
  result: DataForSeoDispatchResult,
  costMicros: number | null,
  sandbox: boolean,
): "confirmed_charged" | "confirmed_not_charged" | "unknown" {
  if (!result.ok && result.outcome === "unknown") return "unknown";
  if (!sandbox && !result.costIsConfirmed) return "unknown";
  return spendOutcome(costMicros);
}

function appendExecutionDetails(
  details: Record<string, unknown> | null,
  options: {
    artifactFailure: ArtifactError | null;
    policyBreach: boolean;
  },
): Record<string, unknown> | null {
  if (!options.artifactFailure && !options.policyBreach) return details;
  return {
    ...(details ?? {}),
    ...(options.artifactFailure ? { artifactPublication: "failed" } : {}),
    ...(options.policyBreach ? { policyBreach: true } : {}),
  };
}

function safeDataForSeoRequestId(value: string | null, secrets: SecretRegistry): string | null {
  if (
    value === null ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
    secrets.contains(Buffer.from(value, "utf8"))
  ) {
    return null;
  }
  return value;
}

function throwIfCancelledBeforeAuthorization(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new GkitFailure({
    code: "CANCELLED",
    message: "The invocation was cancelled before provider dispatch.",
    outcome: "not_dispatched",
  });
}

function applySettlement(context: ExecutionContext, settlement: AttemptSettledEvent): void {
  context.spendOutcome = settlement.spend?.outcome ?? "unknown";
  context.actualCostMicros = settlement.spend?.costMicros ?? null;
  context.providerRequestId = settlement.providerRequestId;
}

function normalizeArtifactError(error: unknown): ArtifactError {
  return error instanceof ArtifactError
    ? error
    : new ArtifactError("ARTIFACT_IO_ERROR", "The artifact could not be written safely.");
}

function normalizeExecutionError(error: unknown, context: ExecutionContext): GkitFailure {
  if (error instanceof GkitFailure) {
    if (error.meta) return error;
    return new GkitFailure({
      code: error.code,
      message: error.message,
      hint: error.hint,
      retryable: error.retryable,
      outcome: error.outcome,
      details: error.details,
      meta: contextMeta(context),
    });
  }
  if (error instanceof ProfileError) {
    return new GkitFailure({
      code: "PROFILE_ERROR",
      message: error.message,
      hint: "Fix the selected profile or inject its referenced secret environment variables.",
      meta: contextMeta(context),
    });
  }
  if (error instanceof ManifestError) {
    return new GkitFailure({
      code: error.kind === "CAPABILITY_NOT_FOUND" ? "CAPABILITY_NOT_FOUND" : "INTERNAL_ERROR",
      message:
        error.kind === "CAPABILITY_NOT_FOUND"
          ? "The requested capability is not exposed by the executable manifest."
          : "The committed executable manifest is invalid.",
      meta: contextMeta(context),
    });
  }
  if (error instanceof SpendBlockedError) {
    return new GkitFailure({
      code: "EFFECT_NOT_ALLOWED",
      message: "A prior spend operation blocks this request.",
      hint: "Inspect gkit operations and reconcile unknown operations with provider evidence.",
      details: {
        blockers: error.blockers.map((blocker) => ({
          reason: blocker.reason,
          operationId: blocker.operationId,
        })),
      },
      meta: contextMeta(context),
    });
  }
  if (error instanceof ArtifactError || error instanceof JournalError) {
    return new GkitFailure({
      code: "LOCAL_IO_ERROR",
      message: "A required local artifact or journal operation failed safely.",
      hint: "Inspect the local path and lock state before retrying.",
      meta: contextMeta(context),
    });
  }
  return new GkitFailure({
    code: "INTERNAL_ERROR",
    message: "gkit encountered an internal error.",
    hint: "Inspect local diagnostics without exposing credentials, then retry only if no spend operation was journaled.",
    meta: contextMeta(context),
  });
}
