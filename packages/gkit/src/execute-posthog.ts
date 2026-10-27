import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ArtifactError,
  reserveArtifactDestination,
  type ArtifactReceipt,
  type ArtifactReservation,
} from "./artifact";
import type { ParsedCommand } from "./args";
import { sha256CanonicalJson } from "./canonical";
import {
  type Envelope,
  type EnvelopeMeta,
  GkitFailure,
  SecretRegistry,
  toFailureEnvelope,
} from "./envelope";
import type { ExecuteResult } from "./execute";
import { defaultJournalPath, JournalError } from "./journal";
import {
  defaultJournalPort,
  providerResultOf,
  startCostFreeOperation,
  type JournalPort,
} from "./operation-recorder";
import {
  getManifestRecord,
  ManifestError,
  type LoadedExecutableManifest,
  validateManifestInput,
} from "./manifest";
import {
  getProviderProfile,
  loadProfile,
  loadProfileEnvironment,
  ProfileError,
  resolveProviderSecrets,
  selectProfileName,
} from "./profile";
import { buildBoundedHogQl } from "./providers/posthog";
import type {
  PostHogConfig,
  PostHogDispatchResult,
  PostHogFetch,
  PostHogQueryInput,
} from "./providers/posthog";

type PostHogCallCommand = Extract<ParsedCommand, { kind: "posthog-call" }>;

export type PostHogExecuteDependencies = {
  readFile: typeof readFile;
  loadProfile: typeof loadProfile;
  resolveProviderSecrets: typeof resolveProviderSecrets;
  reserveArtifactDestination: typeof reserveArtifactDestination;
  loadPostHogAdapter: () => Promise<{
    dispatchPostHog: (options: {
      input: PostHogQueryInput;
      config: PostHogConfig;
      credentials: Readonly<{ apiToken: string }>;
      signal: AbortSignal;
      fetch?: PostHogFetch;
      timeoutMs?: number;
    }) => Promise<PostHogDispatchResult>;
  }>;
  journal: JournalPort;
  randomOperationId: () => string;
};

const defaultDependencies: PostHogExecuteDependencies = {
  readFile,
  loadProfile,
  resolveProviderSecrets,
  reserveArtifactDestination,
  loadPostHogAdapter: async () => await import("./providers/posthog"),
  journal: defaultJournalPort,
  randomOperationId: randomUUID,
};

type ExecutionContext = {
  profile: string | null;
  capability: string | null;
  effects: string[];
  operationId: string | null;
  providerRequestId: string | null;
  artifact: ArtifactReceipt | null;
};

function contextMeta(context: ExecutionContext): EnvelopeMeta {
  return {
    profile: context.profile,
    provider: "posthog",
    capability: context.capability,
    effects: context.effects,
    operationId: context.operationId,
    artifact: context.artifact,
    providerRequestId: context.providerRequestId,
    spend: null,
  };
}

export async function executePostHogCall(options: {
  command: PostHogCallCommand;
  manifest: LoadedExecutableManifest;
  signal: AbortSignal;
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
  journalPath?: string;
  dependencies?: Partial<PostHogExecuteDependencies>;
}): Promise<ExecuteResult> {
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const secrets = new SecretRegistry();
  const context: ExecutionContext = {
    profile: null,
    capability: null,
    effects: [],
    operationId: null,
    providerRequestId: null,
    artifact: null,
  };
  const env = options.env ?? process.env;
  let reservation: ArtifactReservation | null = null;
  let dispatched = false;

  try {
    throwIfCancelled(options.signal);
    const record = getManifestRecord(options.manifest, options.command.capabilityId);
    context.capability = record.id;
    context.effects = [...record.effects];
    if (record.provider !== "posthog" || record.adapterKey !== "query.run") {
      throw new GkitFailure({
        code: "INTERNAL_ERROR",
        message: "The PostHog manifest references an unavailable reviewed adapter.",
      });
    }
    if (record.effects.length !== 1 || record.effects[0] !== "read" || record.cost) {
      throw new GkitFailure({
        code: "INTERNAL_ERROR",
        message: "The PostHog query capability must remain read-only and cost-free.",
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
    const provider = getProviderProfile(profile, "posthog");
    const config = readPostHogConfig(provider.config);
    const queryInput = input as PostHogQueryInput;
    buildBoundedHogQl(queryInput);

    if (options.command.dryRun) {
      return {
        envelope: {
          ok: true,
          data: {
            dryRun: true,
            requestPlan: {
              provider: "posthog",
              capability: record.id,
              method: "POST",
              endpoint: `${config.host}/api/projects/${config.projectId}/query/`,
              inputSha256: sha256CanonicalJson(input),
              rowLimit: queryInput.limit,
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
        message:
          "PostHog execution requires --out so raw provider facts are not written to stdout.",
      });
    }
    throwIfCancelled(options.signal);
    reservation = await dependencies.reserveArtifactDestination({
      destinationPath: options.command.out,
      force: options.command.force,
    });
    const profileEnvironment = await loadProfileEnvironment(profile, env);
    const resolvedSecrets = dependencies.resolveProviderSecrets(
      profile,
      "posthog",
      profileEnvironment,
    );
    const apiToken = resolvedSecrets.apiToken;
    if (!apiToken) {
      throw new ProfileError(
        "invalid_profile",
        "PostHog requires an apiToken env reference under secrets.",
      );
    }
    secrets.register(apiToken);
    throwIfCancelled(options.signal);

    let adapter: Awaited<ReturnType<PostHogExecuteDependencies["loadPostHogAdapter"]>>;
    try {
      adapter = await dependencies.loadPostHogAdapter();
    } catch {
      throw new GkitFailure({
        code: "INTERNAL_ERROR",
        message: "The reviewed PostHog adapter could not be loaded.",
        outcome: "not_dispatched",
        meta: contextMeta(context),
      });
    }
    throwIfCancelled(options.signal);
    const journaled = await startCostFreeOperation({
      journal: dependencies.journal,
      journalPath: options.journalPath ?? defaultJournalPath(env),
      attempt: {
        operationId: dependencies.randomOperationId(),
        profile: profile.name,
        provider: "posthog",
        capability: record.id,
        capabilityRevision: record.revision,
        effects: record.effects,
        inputSha256: sha256CanonicalJson(input),
      },
    });
    context.operationId = journaled.operationId;

    let providerResult: PostHogDispatchResult;
    try {
      dispatched = true;
      providerResult = await adapter.dispatchPostHog({
        input: queryInput,
        config,
        credentials: Object.freeze({ apiToken }),
        signal: options.signal,
      });
    } catch {
      providerResult = {
        ok: false,
        code: "UNKNOWN_OUTCOME",
        message: "The dispatched PostHog query ended without a confirmed outcome.",
        retryable: false,
        outcome: "unknown",
        details: null,
        rawBytes: null,
        providerRequestId: null,
      };
    }

    context.providerRequestId = safeRequestId(providerResult.providerRequestId, secrets);
    let journalFailure = false;
    try {
      await journaled.settle({
        providerResult: providerResultOf(providerResult),
        errorCode: providerResult.ok ? null : providerResult.code,
        providerRequestId: context.providerRequestId,
      });
    } catch {
      journalFailure = true;
    }
    let artifactError: ArtifactError | null = null;
    if (providerResult.rawBytes) {
      try {
        context.artifact = await reservation.publish({
          source: providerResult.rawBytes,
          secretValues: Object.values(resolvedSecrets),
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
    if (context.artifact && !journalFailure) {
      try {
        await journaled.recordArtifact(context.artifact);
      } catch {
        journalFailure = true;
      }
    }

    if (journalFailure) {
      throw new GkitFailure({
        code: "LOCAL_IO_ERROR",
        message: "The PostHog response completed, but the operation journal could not record it.",
        hint: "Inspect gkit operations and the journal lock before repeating the query.",
        outcome: providerResult.ok ? "confirmed" : providerResult.outcome,
        meta: contextMeta(context),
      });
    }
    if (artifactError) {
      throw new GkitFailure({
        code: "LOCAL_IO_ERROR",
        message:
          "The PostHog response completed, but its raw artifact could not be published safely.",
        outcome: providerResult.ok ? "confirmed" : providerResult.outcome,
        meta: contextMeta(context),
      });
    }
    if (!providerResult.ok) {
      throw new GkitFailure({
        code: providerResult.code,
        message: providerResult.message,
        retryable: false,
        outcome: providerResult.outcome,
        details: providerResult.details,
        meta: contextMeta(context),
      });
    }
    return {
      envelope: {
        ok: true,
        data: { ...providerResult.data, artifact: context.artifact },
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
          message: "The PostHog artifact reservation could not be released safely.",
          meta: contextMeta(context),
        });
      }
    }
    if (options.signal.aborted && !dispatched) {
      error = new GkitFailure({
        code: "CANCELLED",
        message: "The invocation was cancelled before provider dispatch.",
        outcome: "not_dispatched",
        meta: contextMeta(context),
      });
    }
    return {
      envelope: toFailureEnvelope(normalizeExecutionError(error, context)),
      secrets,
      exitCode: options.signal.aborted ? 130 : 1,
    };
  }
}

async function readRequestInput(reference: string, read: typeof readFile): Promise<unknown> {
  let source = reference;
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

function readPostHogConfig(config: Readonly<Record<string, unknown>>): PostHogConfig {
  const host = config.host;
  const projectId = config.projectId;
  if (
    (host !== "https://us.posthog.com" && host !== "https://eu.posthog.com") ||
    typeof projectId !== "string" ||
    !/^[1-9]\d*$/.test(projectId)
  ) {
    throw new ProfileError("invalid_profile", "PostHog config is invalid.");
  }
  return Object.freeze({ host, projectId });
}

function safeRequestId(value: string | null, secrets: SecretRegistry): string | null {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && !secrets.contains(Buffer.from(value))
    ? value
    : null;
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new GkitFailure({
      code: "CANCELLED",
      message: "The invocation was cancelled before provider dispatch.",
      outcome: "not_dispatched",
    });
  }
}

function normalizeArtifactError(error: unknown): ArtifactError {
  return error instanceof ArtifactError
    ? error
    : new ArtifactError("ARTIFACT_IO_ERROR", "The artifact could not be written safely.");
}

function normalizeExecutionError(error: unknown, context: ExecutionContext): GkitFailure {
  if (error instanceof JournalError) {
    return new GkitFailure({
      code: "LOCAL_IO_ERROR",
      message: "The operation journal could not record the provider attempt, so it was not dispatched.",
      hint: "Inspect gkit operations and the journal lock before retrying.",
      outcome: "not_dispatched",
      meta: contextMeta(context),
    });
  }
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
  if (error instanceof ArtifactError) {
    return new GkitFailure({
      code: "LOCAL_IO_ERROR",
      message: "A required local artifact operation failed safely.",
      meta: contextMeta(context),
    });
  }
  return new GkitFailure({
    code: "INTERNAL_ERROR",
    message: "gkit encountered an internal error.",
    meta: contextMeta(context),
  });
}
