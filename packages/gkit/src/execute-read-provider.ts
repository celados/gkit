import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ArtifactError,
  reserveArtifactDestination,
  type ArtifactReceipt,
  type ArtifactReservation,
} from "./artifact";
import { type EnvelopeMeta, GkitFailure, SecretRegistry, toFailureEnvelope } from "./envelope";
import { evaluateEffects } from "./effects";
import type { ExecuteResult } from "./execute";
import {
  getManifestRecord,
  ManifestError,
  type LoadedExecutableManifest,
  type ManifestRecord,
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
  type LoadedProfile,
  type ProviderProfile,
} from "./profile";
import type { RawJsonDispatchResult } from "./providers/raw-json";

export type ReadProviderCallCommand = {
  profileFlag: string | null;
  operationId: string;
  input: string;
  allowWrite?: boolean;
  out: string | null;
  force: boolean;
  dryRun: boolean;
};

export type ReadProviderRequestPlan = {
  method: "GET" | "POST" | "PUT";
  endpoint: string;
  diagnosticUrl?: string;
};

export type PreparedCredentials<TCredentials> = {
  credentials: TCredentials;
  secretValues: string[];
};

export type ReadProviderSpec<TConfig, TOperation, TCredentials> = {
  provider: string;
  adapterKeys: ReadonlySet<string>;
  readConfig(provider: ProviderProfile): TConfig;
  createOperation(adapterKey: string, input: Readonly<Record<string, unknown>>): TOperation;
  plan(operation: TOperation, config: TConfig): ReadProviderRequestPlan;
  prepareCredentials(options: {
    profile: LoadedProfile;
    effects: ManifestRecord["effects"];
    resolvedSecrets: Readonly<Record<string, string>>;
    readFile: typeof readFile;
    secrets: SecretRegistry;
  }): Promise<PreparedCredentials<TCredentials>>;
  dispatch(options: {
    operation: TOperation;
    config: TConfig;
    credentials: TCredentials;
    signal: AbortSignal;
  }): Promise<RawJsonDispatchResult>;
  artifactFormat: string | ((operation: TOperation) => string);
};

export type ReadProviderExecuteDependencies = {
  readFile: typeof readFile;
  loadProfile: typeof loadProfile;
  resolveProviderSecrets: typeof resolveProviderSecrets;
  reserveArtifactDestination: typeof reserveArtifactDestination;
};

const defaultDependencies: ReadProviderExecuteDependencies = {
  readFile,
  loadProfile,
  resolveProviderSecrets,
  reserveArtifactDestination,
};

type ExecutionContext = {
  profile: string | null;
  provider: string;
  capability: string | null;
  effects: string[];
  providerRequestId: string | null;
  artifact: ArtifactReceipt | null;
};

export async function executeReadProviderCall<TConfig, TOperation, TCredentials>(options: {
  command: ReadProviderCallCommand;
  manifest: LoadedExecutableManifest;
  signal: AbortSignal;
  spec: ReadProviderSpec<TConfig, TOperation, TCredentials>;
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
  dependencies?: Partial<ReadProviderExecuteDependencies>;
}): Promise<ExecuteResult> {
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const secrets = new SecretRegistry();
  const context: ExecutionContext = {
    profile: null,
    provider: options.spec.provider,
    capability: null,
    effects: [],
    providerRequestId: null,
    artifact: null,
  };
  const env = options.env ?? process.env;
  let reservation: ArtifactReservation | null = null;
  let dispatched = false;

  try {
    throwIfCancelled(options.signal);
    const record = getManifestRecord(options.manifest, options.command.operationId);
    context.capability = record.id;
    context.effects = [...record.effects];
    if (
      record.provider !== options.spec.provider ||
      !options.spec.adapterKeys.has(record.adapterKey)
    ) {
      throw new GkitFailure({
        code: "INTERNAL_ERROR",
        message: `The ${options.spec.provider} manifest references an unavailable reviewed adapter.`,
      });
    }
    if (
      record.effects.length !== 1 ||
      (record.effects[0] !== "read" && record.effects[0] !== "write") ||
      record.cost
    ) {
      throw new GkitFailure({
        code: "INTERNAL_ERROR",
        message: `${options.spec.provider} capabilities must be a single read or write effect and cost-free.`,
      });
    }

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
    const provider = getProviderProfile(profile, options.spec.provider);
    const effectDecision = evaluateEffects({
      record,
      input,
      profilePolicy: provider.policy,
      authorization: { allowWrite: options.command.allowWrite === true },
      environment: getProviderEnvironment(profile, options.spec.provider),
    });
    if (!effectDecision.allowed) {
      throw new GkitFailure({
        code: "EFFECT_NOT_ALLOWED",
        message: effectDecision.message,
        hint: effectDecision.hint,
        details: { reason: effectDecision.reason },
        meta: contextMeta(context),
      });
    }
    const config = options.spec.readConfig(provider);
    const operation = options.spec.createOperation(
      record.adapterKey,
      input as Readonly<Record<string, unknown>>,
    );
    const plan = options.spec.plan(operation, config);

    if (options.command.dryRun) {
      return {
        envelope: {
          ok: true,
          data: {
            dryRun: true,
            requestPlan: {
              provider: options.spec.provider,
              capability: record.id,
              method: plan.method,
              endpoint: plan.endpoint,
              ...(plan.diagnosticUrl ? { diagnosticUrl: plan.diagnosticUrl } : {}),
              inputSha256: sha256CanonicalJson(input),
              artifactPath: options.command.out ? resolve(options.command.out) : null,
            },
          },
          meta: contextMeta(context),
        },
        secrets,
        exitCode: 0,
      };
    }

    if (!options.command.out) {
      throw new GkitFailure({
        code: "INVALID_INPUT",
        message: `${options.spec.provider} execution requires --out for the raw provider artifact.`,
      });
    }
    reservation = await dependencies.reserveArtifactDestination({
      destinationPath: options.command.out,
      force: options.command.force,
    });
    const profileEnvironment = await loadProfileEnvironment(profile, env);
    const resolvedSecrets = dependencies.resolveProviderSecrets(
      profile,
      options.spec.provider,
      profileEnvironment,
    );
    const prepared = await options.spec.prepareCredentials({
      profile,
      effects: record.effects,
      resolvedSecrets,
      readFile: dependencies.readFile,
      secrets,
    });
    for (const secret of prepared.secretValues) secrets.register(secret);
    throwIfCancelled(options.signal);
    dispatched = true;
    const providerResult = await options.spec.dispatch({
      operation,
      config,
      credentials: prepared.credentials,
      signal: options.signal,
    });
    context.providerRequestId = safeRequestId(providerResult.providerRequestId, secrets);

    let artifactError: ArtifactError | null = null;
    if (providerResult.rawBytes) {
      try {
        context.artifact = await reservation.publish({
          source: providerResult.rawBytes,
          secretValues: prepared.secretValues,
        });
      } catch (error) {
        artifactError = normalizeArtifactError(error);
      }
    }
    try {
      await reservation.release();
      reservation = null;
    } catch (error) {
      artifactError ??= normalizeArtifactError(error);
      reservation = null;
    }
    if (artifactError) {
      throw new GkitFailure({
        code: "LOCAL_IO_ERROR",
        message: `The ${options.spec.provider} response completed, but its artifact could not be published safely.`,
        outcome: providerResult.ok ? "confirmed" : providerResult.outcome,
        meta: contextMeta(context),
      });
    }
    if (!providerResult.ok) {
      throw new GkitFailure({
        code: providerResult.code,
        message: providerResult.message,
        retryable: providerResult.retryable,
        outcome: providerResult.outcome,
        details: providerResult.details,
        meta: contextMeta(context),
      });
    }
    return {
      envelope: {
        ok: true,
        data: {
          ...providerResult.data,
          artifactFormat:
            typeof options.spec.artifactFormat === "function"
              ? options.spec.artifactFormat(operation)
              : options.spec.artifactFormat,
          artifact: context.artifact,
        },
        meta: contextMeta(context),
      },
      secrets,
      exitCode: options.signal.aborted ? 130 : 0,
    };
  } catch (error) {
    if (reservation) {
      try {
        await reservation.release();
      } catch {
        error = new GkitFailure({
          code: "LOCAL_IO_ERROR",
          message: `The ${options.spec.provider} artifact reservation could not be released safely.`,
          outcome: dispatched ? "unknown" : "not_dispatched",
          meta: contextMeta(context),
        });
      }
    }
    return {
      envelope: toFailureEnvelope(normalizeExecutionError(error, context)),
      secrets,
      exitCode: options.signal.aborted ? 130 : 1,
    };
  }
}

function contextMeta(context: ExecutionContext): EnvelopeMeta {
  return {
    profile: context.profile,
    provider: context.provider,
    capability: context.capability,
    effects: context.effects,
    cost: null,
    artifact: context.artifact,
    attemptId: null,
    spendOutcome: null,
    providerRequestId: context.providerRequestId,
  };
}

async function readRequestInput(reference: string, read: typeof readFile): Promise<unknown> {
  let source = reference;
  if (reference.startsWith("@")) {
    const path = reference.slice(1);
    if (!path)
      throw new GkitFailure({
        code: "INVALID_INPUT",
        message: "--input @<path> requires a file path.",
      });
    try {
      source = await read(path, "utf8");
    } catch {
      throw new GkitFailure({
        code: "LOCAL_IO_ERROR",
        message: "The request input file could not be read.",
      });
    }
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new GkitFailure({
      code: "INVALID_INPUT",
      message: "--input must be valid JSON or @<path>.",
    });
  }
}

function sha256CanonicalJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)))
    .digest("hex");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

function safeRequestId(value: string | null, secrets: SecretRegistry): string | null {
  if (!value || !/^[A-Za-z0-9._:-]{1,128}$/.test(value) || secrets.contains(Buffer.from(value))) {
    return null;
  }
  return value;
}

function normalizeArtifactError(error: unknown): ArtifactError {
  return error instanceof ArtifactError
    ? error
    : new ArtifactError("ARTIFACT_IO_ERROR", "Artifact publication failed.", null, error);
}

function normalizeExecutionError(error: unknown, context: ExecutionContext): unknown {
  if (error instanceof GkitFailure) return error;
  if (error instanceof ArtifactError) {
    return new GkitFailure({
      code: "LOCAL_IO_ERROR",
      message: error.message,
      meta: contextMeta(context),
    });
  }
  if (error instanceof ProfileError) {
    return new GkitFailure({
      code: "PROFILE_ERROR",
      message: error.message,
      meta: contextMeta(context),
    });
  }
  if (error instanceof ManifestError) {
    return new GkitFailure({
      code: error.kind === "CAPABILITY_NOT_FOUND" ? "CAPABILITY_NOT_FOUND" : "INTERNAL_ERROR",
      message: error.message,
      meta: contextMeta(context),
    });
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    return new GkitFailure({
      code: "INVALID_INPUT",
      message: error.message,
      meta: contextMeta(context),
    });
  }
  return new GkitFailure({
    code: "INTERNAL_ERROR",
    message: `The ${context.provider} call could not be prepared.`,
    meta: contextMeta(context),
  });
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new GkitFailure({
      code: "CANCELLED",
      message: "The invocation was cancelled before provider dispatch.",
    });
  }
}
