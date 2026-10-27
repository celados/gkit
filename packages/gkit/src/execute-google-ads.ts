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
import { type EnvelopeMeta, GkitFailure, SecretRegistry, toFailureEnvelope } from "./envelope";
import type { ExecuteResult } from "./execute";
import { defaultJournalPath, JournalError } from "./journal";
import {
  defaultJournalPort,
  providerResultOf,
  startCostFreeOperation,
  type JournalPort,
} from "./operation-recorder";
import {
  readGoogleAdsServiceAccount,
  resolveGoogleAdsServiceAccountPath,
  type GoogleAdsServiceAccount,
} from "./google-ads-credentials";
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
import type {
  GoogleAdsAdapterKey,
  GoogleAdsConfig,
  GoogleAdsDispatch,
  GoogleAdsOperation,
} from "./providers/google-ads";
import { planGoogleAdsRequest } from "./providers/google-ads";

type GoogleAdsCallCommand = Extract<ParsedCommand, { kind: "google-ads-call" }>;

export type GoogleAdsExecuteDependencies = {
  readFile: typeof readFile;
  loadProfile: typeof loadProfile;
  resolveProviderSecrets: typeof resolveProviderSecrets;
  reserveArtifactDestination: typeof reserveArtifactDestination;
  loadGoogleAdsAuth: () => Promise<{
    deriveGoogleAdsAccessToken: (credentials: GoogleAdsServiceAccount) => Promise<string>;
  }>;
  loadGoogleAdsAdapter: () => Promise<{
    createGoogleAdsDispatch: (options: {
      operation: GoogleAdsOperation;
      config: GoogleAdsConfig;
      credentials: Readonly<{ developerToken: string; accessToken: string }>;
      signal: AbortSignal;
    }) => GoogleAdsDispatch;
  }>;
  journal: JournalPort;
  randomOperationId: () => string;
};

const defaultDependencies: GoogleAdsExecuteDependencies = {
  readFile,
  loadProfile,
  resolveProviderSecrets,
  reserveArtifactDestination,
  loadGoogleAdsAuth: async () => await import("./providers/google-ads-auth"),
  loadGoogleAdsAdapter: async () => await import("./providers/google-ads"),
  journal: defaultJournalPort,
  randomOperationId: randomUUID,
};

const adapterKeys = new Set<GoogleAdsAdapterKey>([
  "customers.list-accessible",
  "fields.describe",
  "fields.search",
  "keyword-plan.generate-historical-metrics",
  "keyword-plan.generate-ideas",
  "query.gaql",
]);

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
    provider: "google-ads",
    capability: context.capability,
    effects: context.effects,
    operationId: context.operationId,
    artifact: context.artifact,
    providerRequestId: context.providerRequestId,
    spend: null,
  };
}

export async function executeGoogleAdsCall(options: {
  command: GoogleAdsCallCommand;
  manifest: LoadedExecutableManifest;
  signal: AbortSignal;
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
  journalPath?: string;
  dependencies?: Partial<GoogleAdsExecuteDependencies>;
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
    if (
      record.provider !== "google-ads" ||
      !adapterKeys.has(record.adapterKey as GoogleAdsAdapterKey)
    ) {
      throw new GkitFailure({
        code: "INTERNAL_ERROR",
        message: "The Google Ads manifest references an unavailable reviewed adapter.",
      });
    }
    if (record.effects.length !== 1 || record.effects[0] !== "read" || record.cost) {
      throw new GkitFailure({
        code: "INTERNAL_ERROR",
        message: "Google Ads Slice 4 capabilities must remain read-only and cost-free in gkit.",
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
    const provider = getProviderProfile(profile, "google-ads");
    const config = readGoogleAdsConfig(provider.config);
    const operation: GoogleAdsOperation = Object.freeze({
      adapterKey: record.adapterKey as GoogleAdsAdapterKey,
      input: input as Readonly<Record<string, unknown>>,
    });
    const requestPlan = planGoogleAdsRequest(operation, config);

    if (options.command.dryRun) {
      return {
        envelope: {
          ok: true,
          data: {
            dryRun: true,
            requestPlan: {
              provider: "google-ads",
              capability: record.id,
              apiVersion: "v24",
              authMode: "service_account",
              method: requestPlan.method,
              endpoint: requestPlan.endpoint,
              inputSha256: sha256CanonicalJson(input),
              artifactPath: options.command.out ? resolve(options.command.out) : null,
              managerRouting: false,
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
        message: "Google Ads execution requires --out for the streamed raw page bundle.",
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
      "google-ads",
      profileEnvironment,
    );
    const developerToken = resolvedSecrets.developerToken;
    const serviceAccountFile = resolvedSecrets.serviceAccountFile;
    if (!developerToken || !serviceAccountFile) {
      throw new ProfileError(
        "invalid_profile",
        "Google Ads requires developerToken and serviceAccountFile env references.",
      );
    }
    secrets.register(developerToken);
    const credentialsPath = resolveGoogleAdsServiceAccountPath(profile, serviceAccountFile);
    const serviceAccount = await readGoogleAdsServiceAccount(
      credentialsPath,
      dependencies.readFile,
    );
    secrets.register(serviceAccount.privateKey);

    let accessToken: string;
    try {
      const auth = await dependencies.loadGoogleAdsAuth();
      accessToken = await auth.deriveGoogleAdsAccessToken(serviceAccount.credentials);
    } catch {
      throw new GkitFailure({
        code: "AUTH_FAILED",
        message: "Google OAuth could not derive an access token from the service account.",
        outcome: "not_dispatched",
      });
    }
    secrets.register(accessToken);
    throwIfCancelled(options.signal);

    const adapter = await dependencies.loadGoogleAdsAdapter();
    throwIfCancelled(options.signal);
    const journaled = await startCostFreeOperation({
      journal: dependencies.journal,
      journalPath: options.journalPath ?? defaultJournalPath(env),
      attempt: {
        operationId: dependencies.randomOperationId(),
        profile: profile.name,
        provider: "google-ads",
        capability: record.id,
        capabilityRevision: record.revision,
        effects: record.effects,
        inputSha256: sha256CanonicalJson(input),
      },
    });
    context.operationId = journaled.operationId;
    const dispatch = adapter.createGoogleAdsDispatch({
      operation,
      config,
      credentials: Object.freeze({ developerToken, accessToken }),
      signal: options.signal,
    });
    dispatched = true;
    try {
      context.artifact = await reservation.publish({
        source: dispatch.source,
        secretValues: [developerToken, accessToken, serviceAccount.privateKey],
      });
    } catch (error) {
      // The streamed response was not captured, so the provider result stays unknown.
      await journaled
        .settle({ providerResult: "unknown", errorCode: "LOCAL_IO_ERROR" })
        .catch(() => undefined);
      throw normalizeArtifactError(error);
    }
    let providerResult: Awaited<typeof dispatch.result>;
    try {
      providerResult = await dispatch.result;
    } catch {
      providerResult = {
        ok: false,
        code: "UNKNOWN_OUTCOME",
        message: "The streamed Google Ads response ended without a confirmed outcome.",
        retryable: false,
        outcome: "unknown",
        details: null,
        providerRequestId: null,
      };
    }
    context.providerRequestId = safeRequestId(providerResult.providerRequestId, secrets);
    await reservation.release();
    reservation = null;
    try {
      await journaled.settle({
        providerResult: providerResultOf(providerResult),
        errorCode: providerResult.ok ? null : providerResult.code,
        providerRequestId: context.providerRequestId,
      });
      if (context.artifact) await journaled.recordArtifact(context.artifact);
    } catch {
      throw new GkitFailure({
        code: "LOCAL_IO_ERROR",
        message: "The Google Ads response completed, but the operation journal could not record it.",
        hint: "Inspect gkit operations and the journal lock before repeating the request.",
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
          artifactFormat: "json-array-of-exact-rest-pages",
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
          message: "The Google Ads artifact reservation could not be released safely.",
          outcome: dispatched ? "unknown" : "not_dispatched",
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
    if (error instanceof ArtifactError && dispatched) {
      error = new GkitFailure({
        code: "LOCAL_IO_ERROR",
        message: "The Google Ads response could not be published as a safe artifact.",
        outcome: "unknown",
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

function readGoogleAdsConfig(config: Readonly<Record<string, unknown>>): GoogleAdsConfig {
  const customerId = config.customerId;
  if (typeof customerId !== "string" || !/^[1-9]\d{9}$/.test(customerId)) {
    throw new ProfileError("invalid_profile", "Google Ads customerId is invalid.");
  }
  return Object.freeze({ customerId });
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
      hint: "Fix the selected Google Ads profile or its referenced service-account file.",
      meta: contextMeta(context),
    });
  }
  if (error instanceof ManifestError) {
    return new GkitFailure({
      code: error.kind === "CAPABILITY_NOT_FOUND" ? "CAPABILITY_NOT_FOUND" : "INTERNAL_ERROR",
      message:
        error.kind === "CAPABILITY_NOT_FOUND"
          ? "The requested capability is not exposed by the Google Ads manifest."
          : "The committed Google Ads manifest is invalid.",
      meta: contextMeta(context),
    });
  }
  if (error instanceof ArtifactError) {
    return new GkitFailure({
      code: "LOCAL_IO_ERROR",
      message: "A required Google Ads artifact operation failed safely.",
      meta: contextMeta(context),
    });
  }
  return new GkitFailure({
    code: "INTERNAL_ERROR",
    message: "gkit encountered an internal Google Ads error.",
    meta: contextMeta(context),
  });
}
