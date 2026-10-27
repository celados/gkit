import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";

import type { Envelope, EnvelopeMeta } from "./envelope";
import { GkitFailure, SecretRegistry, toFailureEnvelope } from "./envelope";
import {
  readGoogleAdsServiceAccount,
  resolveGoogleAdsServiceAccountPath,
} from "./google-ads-credentials";
import { readGscServiceAccount, resolveGscServiceAccountPath } from "./gsc-credentials";
import {
  getProviderEnvironment,
  getProviderProfile,
  loadProfile,
  loadProfileEnvironment,
  ProfileError,
  resolveProviderSecrets,
  selectProfileName,
} from "./profile";

export type DoctorResult = {
  profilePath: string;
  provider: "bing" | "dataforseo" | "google-ads" | "gsc" | "hubspot" | "posthog";
  environment: "production" | "sandbox" | null;
  host?: string;
  projectId?: string;
  customerId?: string;
  siteUrl?: string;
  portalId?: string;
  authMode?: "private_app_token" | "service_account";
  profileConfigured: true;
  secretsConfigured: true;
  spendPolicyConfigured: boolean;
  networkProbe: "connected" | "unknown";
  note: string;
};

function doctorMeta(profile: string, provider = "dataforseo"): EnvelopeMeta {
  return {
    profile,
    provider,
    capability: null,
    effects: [],
    operationId: null,
    artifact: null,
    providerRequestId: null,
    spend: null,
  };
}

export async function runBingDoctor(options: {
  profileFlag: string | null;
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
}): Promise<DoctorExecutionResult> {
  return await runSimpleReadDoctor({ ...options, provider: "bing", secretName: "apiKey" });
}

export async function runGscDoctor(options: {
  profileFlag: string | null;
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
}): Promise<DoctorExecutionResult> {
  const env = options.env ?? process.env;
  const secrets = new SecretRegistry();
  let selectedProfile = options.profileFlag ?? env.GKIT_PROFILE ?? null;
  try {
    selectedProfile = selectProfileName(options.profileFlag ?? undefined, env);
    const profile = await loadProfile(selectedProfile, {
      xdgConfigHome: options.xdgConfigHome,
      home: options.home,
    });
    const provider = getProviderProfile(profile, "gsc");
    const profileEnvironment = await loadProfileEnvironment(profile, env);
    const resolved = resolveProviderSecrets(profile, "gsc", profileEnvironment);
    const serviceAccountFile = resolved.serviceAccountFile;
    if (!serviceAccountFile) {
      throw new ProfileError("invalid_profile", "GSC requires a serviceAccountFile env reference.");
    }
    const credentialsPath = resolveGscServiceAccountPath(profile, serviceAccountFile);
    const serviceAccount = await readGscServiceAccount(credentialsPath, readFile);
    secrets.register(serviceAccount.privateKey);
    return {
      envelope: {
        ok: true,
        data: {
          profilePath: profile.path,
          provider: "gsc",
          environment: null,
          ...(typeof provider.config.siteUrl === "string"
            ? { siteUrl: provider.config.siteUrl }
            : {}),
          authMode: "service_account",
          profileConfigured: true,
          secretsConfigured: true,
          spendPolicyConfigured: false,
          networkProbe: "unknown",
          note: "GSC readiness validates local service-account configuration only; no OAuth or provider network request was sent.",
        },
        meta: doctorMeta(profile.name, "gsc"),
      },
      secrets,
    };
  } catch (error) {
    return doctorProfileFailure(error, selectedProfile, "gsc", secrets);
  }
}

async function runSimpleReadDoctor(options: {
  profileFlag: string | null;
  provider: "bing";
  secretName: "apiKey";
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
}): Promise<DoctorExecutionResult> {
  const env = options.env ?? process.env;
  const secrets = new SecretRegistry();
  let selectedProfile = options.profileFlag ?? env.GKIT_PROFILE ?? null;
  try {
    selectedProfile = selectProfileName(options.profileFlag ?? undefined, env);
    const profile = await loadProfile(selectedProfile, {
      xdgConfigHome: options.xdgConfigHome,
      home: options.home,
    });
    const provider = getProviderProfile(profile, options.provider);
    const profileEnvironment = await loadProfileEnvironment(profile, env);
    const resolved = resolveProviderSecrets(profile, options.provider, profileEnvironment);
    const secret = resolved[options.secretName];
    if (!secret)
      throw new ProfileError("invalid_profile", "Bing requires an apiKey env reference.");
    secrets.register(secret);
    return {
      envelope: {
        ok: true,
        data: {
          profilePath: profile.path,
          provider: options.provider,
          environment: null,
          ...(typeof provider.config.siteUrl === "string"
            ? { siteUrl: provider.config.siteUrl }
            : {}),
          profileConfigured: true,
          secretsConfigured: true,
          spendPolicyConfigured: false,
          networkProbe: "unknown",
          note: "Bing readiness validates local API-key configuration only; no provider network request was sent.",
        },
        meta: doctorMeta(profile.name, options.provider),
      },
      secrets,
    };
  } catch (error) {
    return doctorProfileFailure(error, selectedProfile, options.provider, secrets);
  }
}

function doctorProfileFailure(
  error: unknown,
  selectedProfile: string | null,
  provider: "bing" | "gsc",
  secrets: SecretRegistry,
): DoctorExecutionResult {
  if (!(error instanceof ProfileError)) throw error;
  return {
    envelope: toFailureEnvelope(
      new GkitFailure({
        code: "PROFILE_ERROR",
        message: error.message,
        hint: "Fix the selected profile, credential file, or referenced environment variables.",
        meta: selectedProfile ? doctorMeta(selectedProfile, provider) : undefined,
      }),
    ),
    secrets,
  };
}

export async function runPostHogDoctor(options: {
  profileFlag: string | null;
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
}): Promise<DoctorExecutionResult> {
  const env = options.env ?? process.env;
  const secrets = new SecretRegistry();
  let selectedProfile = options.profileFlag ?? env.GKIT_PROFILE ?? null;

  try {
    selectedProfile = selectProfileName(options.profileFlag ?? undefined, env);
    const profile = await loadProfile(selectedProfile, {
      xdgConfigHome: options.xdgConfigHome,
      home: options.home,
    });
    const provider = getProviderProfile(profile, "posthog");
    const profileEnvironment = await loadProfileEnvironment(profile, env);
    for (const reference of Object.values(provider.secrets)) {
      const value = profileEnvironment[reference.slice("env:".length)];
      if (value) secrets.register(value);
    }
    const resolvedSecrets = resolveProviderSecrets(profile, "posthog", profileEnvironment);
    if (!resolvedSecrets.apiToken) {
      throw new ProfileError(
        "invalid_profile",
        "PostHog requires an apiToken env reference under secrets.",
      );
    }

    return {
      envelope: {
        ok: true,
        data: {
          profilePath: profile.path,
          provider: "posthog",
          environment: null,
          host: String(provider.config.host),
          projectId: String(provider.config.projectId),
          profileConfigured: true,
          secretsConfigured: true,
          spendPolicyConfigured: false,
          networkProbe: "unknown",
          note: "PostHog readiness validates local configuration only; no network request was sent.",
        },
        meta: doctorMeta(profile.name, "posthog"),
      },
      secrets,
    };
  } catch (error) {
    if (error instanceof ProfileError) {
      return {
        envelope: toFailureEnvelope(
          new GkitFailure({
            code: "PROFILE_ERROR",
            message: error.message,
            hint: "Fix the selected profile or inject its referenced secret environment variables.",
            meta: selectedProfile ? doctorMeta(selectedProfile, "posthog") : undefined,
          }),
        ),
        secrets,
      };
    }
    throw error;
  }
}

export async function runHubSpotDoctor(options: {
  profileFlag: string | null;
  signal: AbortSignal;
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}): Promise<DoctorExecutionResult> {
  const env = options.env ?? process.env;
  const secrets = new SecretRegistry();
  let selectedProfile = options.profileFlag ?? env.GKIT_PROFILE ?? null;
  let providerRequestId: string | null = null;

  try {
    selectedProfile = selectProfileName(options.profileFlag ?? undefined, env);
    const profile = await loadProfile(selectedProfile, {
      xdgConfigHome: options.xdgConfigHome,
      home: options.home,
    });
    getProviderProfile(profile, "hubspot");
    const profileEnvironment = await loadProfileEnvironment(profile, env);
    const resolved = resolveProviderSecrets(profile, "hubspot", profileEnvironment);
    const accessToken = resolved.accessToken;
    if (!accessToken) {
      throw new ProfileError(
        "invalid_profile",
        "HubSpot requires an accessToken env reference under secrets.",
      );
    }
    secrets.register(accessToken);
    if (options.signal.aborted) {
      throw new GkitFailure({
        code: "CANCELLED",
        message: "The invocation was cancelled before the HubSpot connectivity probe.",
        outcome: "not_dispatched",
        meta: doctorMeta(profile.name, "hubspot"),
      });
    }

    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new GkitFailure({ code: "INVALID_INPUT", message: "HubSpot doctor timeout is invalid." });
    }
    const dispatchSignal = createDoctorSignal(options.signal, timeoutMs);
    let response: Response;
    let rawBytes: Uint8Array;
    try {
      response = await (options.fetch ?? globalThis.fetch)(
        "https://api.hubapi.com/account-info/2026-03/details",
        {
          method: "GET",
          headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
          signal: dispatchSignal.signal,
        },
      );
      rawBytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      throw new GkitFailure({
        code: dispatchSignal.timedOut()
          ? "TIMEOUT"
          : options.signal.aborted
            ? "UNKNOWN_OUTCOME"
            : "NETWORK_ERROR",
        message: dispatchSignal.timedOut()
          ? "The HubSpot connectivity probe exceeded its deadline."
          : "The HubSpot connectivity probe ended without a confirmed response.",
        retryable: true,
        outcome: "unknown",
        meta: doctorMeta(profile.name, "hubspot"),
      });
    } finally {
      dispatchSignal.dispose();
    }

    const payload = parseDoctorJson(rawBytes);
    providerRequestId = hubSpotDoctorRequestId(response, payload, accessToken);
    const meta = { ...doctorMeta(profile.name, "hubspot"), providerRequestId };
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? "AUTH_FAILED"
          : response.status === 429
            ? "RATE_LIMITED"
            : response.status === 408 || response.status >= 500
              ? "UNKNOWN_OUTCOME"
              : "PROVIDER_ERROR";
      throw new GkitFailure({
        code,
        message:
          code === "AUTH_FAILED"
            ? "HubSpot rejected the configured token or account-info scope."
            : code === "RATE_LIMITED"
              ? "HubSpot rate-limited the connectivity probe."
              : "HubSpot did not accept the connectivity probe.",
        retryable: code === "RATE_LIMITED" || code === "UNKNOWN_OUTCOME",
        outcome: code === "UNKNOWN_OUTCOME" ? "unknown" : "confirmed",
        details: {
          httpStatus: response.status,
          ...hubSpotDoctorErrorDetails(payload),
        },
        meta,
      });
    }
    if (!isDoctorRecord(payload)) {
      throw new GkitFailure({
        code: "PROVIDER_ERROR",
        message: "HubSpot returned an invalid account-details response.",
        outcome: "confirmed",
        meta,
      });
    }
    const portalId = payload.portalId;
    const portalIdText = typeof portalId === "number" ? String(portalId) : portalId;
    if (typeof portalIdText !== "string" || !/^[1-9]\d*$/.test(portalIdText)) {
      throw new GkitFailure({
        code: "PROVIDER_ERROR",
        message: "HubSpot returned account details without a valid portal identifier.",
        outcome: "confirmed",
        meta,
      });
    }
    return {
      envelope: {
        ok: true,
        data: {
          profilePath: profile.path,
          provider: "hubspot",
          environment: null,
          portalId: portalIdText,
          authMode: "private_app_token",
          profileConfigured: true,
          secretsConfigured: true,
          spendPolicyConfigured: false,
          networkProbe: "connected",
          note: "HubSpot readiness verified the profile-bound account through the fixed account-details endpoint.",
        },
        meta,
      },
      secrets,
    };
  } catch (error) {
    if (error instanceof GkitFailure) {
      return { envelope: toFailureEnvelope(error), secrets };
    }
    if (error instanceof ProfileError) {
      return {
        envelope: toFailureEnvelope(
          new GkitFailure({
            code: "PROFILE_ERROR",
            message: error.message,
            hint: "Fix the selected HubSpot profile or its referenced access-token environment variable.",
            meta: selectedProfile ? doctorMeta(selectedProfile, "hubspot") : undefined,
          }),
        ),
        secrets,
      };
    }
    throw error;
  }
}

function createDoctorSignal(
  externalSignal: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; timedOut(): boolean; dispose(): void } {
  const controller = new AbortController();
  let didTimeOut = false;
  const onExternalAbort = (): void => controller.abort(externalSignal.reason);
  externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort(new Error("HubSpot doctor deadline exceeded."));
  }, timeoutMs);
  timer.unref();
  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    dispose: () => {
      clearTimeout(timer);
      externalSignal.removeEventListener("abort", onExternalAbort);
    },
  };
}

function parseDoctorJson(rawBytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(rawBytes).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function hubSpotDoctorRequestId(
  response: Response,
  payload: unknown,
  accessToken: string,
): string | null {
  const header =
    response.headers.get("x-hubspot-correlation-id") ?? response.headers.get("x-request-id");
  if (header && header !== accessToken && /^[A-Za-z0-9._:-]{1,128}$/.test(header)) return header;
  if (!isDoctorRecord(payload)) return null;
  const value = payload.correlationId;
  return typeof value === "string" &&
    value !== accessToken &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : null;
}

function hubSpotDoctorErrorDetails(payload: unknown): Record<string, unknown> {
  if (!isDoctorRecord(payload)) return {};
  const category = payload.category;
  return typeof category === "string" && /^[A-Z0-9_]{1,80}$/.test(category)
    ? { providerCategory: category }
    : {};
}

function isDoctorRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type DoctorExecutionResult = {
  envelope: Envelope<DoctorResult>;
  secrets: SecretRegistry;
};

export async function runGoogleAdsDoctor(options: {
  profileFlag: string | null;
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
}): Promise<DoctorExecutionResult> {
  const env = options.env ?? process.env;
  const secrets = new SecretRegistry();
  let selectedProfile = options.profileFlag ?? env.GKIT_PROFILE ?? null;

  try {
    selectedProfile = selectProfileName(options.profileFlag ?? undefined, env);
    const profile = await loadProfile(selectedProfile, {
      xdgConfigHome: options.xdgConfigHome,
      home: options.home,
    });
    const provider = getProviderProfile(profile, "google-ads");
    const profileEnvironment = await loadProfileEnvironment(profile, env);
    const resolvedSecrets = resolveProviderSecrets(profile, "google-ads", profileEnvironment);
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
    const serviceAccount = await readGoogleAdsServiceAccount(credentialsPath, readFile);
    secrets.register(serviceAccount.privateKey);

    return {
      envelope: {
        ok: true,
        data: {
          profilePath: profile.path,
          provider: "google-ads",
          environment: null,
          customerId: String(provider.config.customerId),
          authMode: "service_account",
          profileConfigured: true,
          secretsConfigured: true,
          spendPolicyConfigured: false,
          networkProbe: "unknown",
          note: "Google Ads readiness validates the local single-account service-account profile only; no OAuth or provider network request was sent.",
        },
        meta: doctorMeta(profile.name, "google-ads"),
      },
      secrets,
    };
  } catch (error) {
    if (error instanceof ProfileError) {
      return {
        envelope: toFailureEnvelope(
          new GkitFailure({
            code: "PROFILE_ERROR",
            message: error.message,
            hint: "Fix the selected profile, service-account file, or referenced environment variables.",
            meta: selectedProfile ? doctorMeta(selectedProfile, "google-ads") : undefined,
          }),
        ),
        secrets,
      };
    }
    throw error;
  }
}

export async function runDataForSeoDoctor(options: {
  profileFlag: string | null;
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
}): Promise<DoctorExecutionResult> {
  const env = options.env ?? process.env;
  const secrets = new SecretRegistry();
  let selectedProfile = options.profileFlag ?? env.GKIT_PROFILE ?? null;

  try {
    selectedProfile = selectProfileName(options.profileFlag ?? undefined, env);
    const profile = await loadProfile(selectedProfile, {
      xdgConfigHome: options.xdgConfigHome,
      home: options.home,
    });
    const provider = getProviderProfile(profile, "dataforseo");
    const profileEnvironment = await loadProfileEnvironment(profile, env);
    for (const reference of Object.values(provider.secrets)) {
      const value = profileEnvironment[reference.slice("env:".length)];
      if (value) secrets.register(value);
    }
    const resolvedSecrets = resolveProviderSecrets(profile, "dataforseo", profileEnvironment);
    if (!resolvedSecrets.login || !resolvedSecrets.password) {
      throw new ProfileError(
        "invalid_profile",
        "DataForSEO requires login and password env references under secrets.",
      );
    }
    secrets.registerBasicAuth(resolvedSecrets.login, resolvedSecrets.password);
    if (typeof provider.policy.maxSpendUsdPerCall !== "string") {
      throw new ProfileError(
        "invalid_profile",
        "DataForSEO execution requires policy.maxSpendUsdPerCall in the selected profile.",
      );
    }

    return {
      envelope: {
        ok: true,
        data: {
          profilePath: profile.path,
          provider: "dataforseo",
          environment: getProviderEnvironment(profile, "dataforseo"),
          profileConfigured: true,
          secretsConfigured: true,
          spendPolicyConfigured: true,
          networkProbe: "unknown",
          note: "No safe, no-side-effect DataForSEO credential probe is available; no network request was sent.",
        },
        meta: doctorMeta(profile.name),
      },
      secrets,
    };
  } catch (error) {
    if (error instanceof ProfileError) {
      return {
        envelope: toFailureEnvelope(
          new GkitFailure({
            code: "PROFILE_ERROR",
            message: error.message,
            hint: "Fix the selected profile or inject its referenced secret environment variables.",
            meta: selectedProfile ? doctorMeta(selectedProfile) : undefined,
          }),
        ),
        secrets,
      };
    }
    throw error;
  }
}
