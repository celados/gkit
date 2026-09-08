import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { parse as parseDotenv } from "dotenv";
import {
  literal,
  optional,
  picklist,
  pipe,
  record,
  regex,
  safeParse,
  strictObject,
  string,
  unknown,
} from "valibot";

const PROFILE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const ENV_REFERENCE_PATTERN = /^env:[A-Z_][A-Z0-9_]*$/;
const USD_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

const forbiddenConfigKeys = new Set([
  "apikey",
  "apitoken",
  "baseurl",
  "clientsecret",
  "credential",
  "credentials",
  "credentialsjson",
  "developertoken",
  "oauthclientsecret",
  "origin",
  "password",
  "refreshtoken",
  "secret",
  "token",
]);

const providerPolicySchema = strictObject({
  maxSpendUsdPerCall: optional(pipe(string(), regex(USD_DECIMAL_PATTERN))),
});

const providerProfileSchema = strictObject({
  config: optional(record(string(), unknown()), {}),
  policy: optional(providerPolicySchema, {}),
  secrets: optional(record(string(), pipe(string(), regex(ENV_REFERENCE_PATTERN))), {}),
});

const profileDocumentSchema = strictObject({
  version: literal(1),
  name: pipe(string(), regex(PROFILE_SLUG_PATTERN)),
  providers: record(pipe(string(), regex(PROVIDER_ID_PATTERN)), providerProfileSchema),
  site: optional(strictObject({ configFile: string() })),
});

const dataForSeoConfigSchema = strictObject({
  environment: optional(picklist(["production", "sandbox"]), "production"),
});

const dataForSeoSecretsSchema = strictObject({
  login: pipe(string(), regex(ENV_REFERENCE_PATTERN)),
  password: pipe(string(), regex(ENV_REFERENCE_PATTERN)),
});

const postHogConfigSchema = strictObject({
  host: picklist(["https://us.posthog.com", "https://eu.posthog.com"]),
  projectId: pipe(string(), regex(/^[1-9]\d*$/)),
});

const postHogSecretsSchema = strictObject({
  apiToken: pipe(string(), regex(ENV_REFERENCE_PATTERN)),
});

const googleAdsConfigSchema = strictObject({
  customerId: pipe(string(), regex(/^[1-9]\d{9}$/)),
});

const googleAdsSecretsSchema = strictObject({
  developerToken: pipe(string(), regex(ENV_REFERENCE_PATTERN)),
  serviceAccountFile: pipe(string(), regex(ENV_REFERENCE_PATTERN)),
});

const bingConfigSchema = strictObject({
  siteUrl: optional(pipe(string(), regex(/^https?:\/\/.+/))),
});

const bingSecretsSchema = strictObject({
  apiKey: pipe(string(), regex(ENV_REFERENCE_PATTERN)),
});

const gscConfigSchema = strictObject({
  siteUrl: optional(pipe(string(), regex(/^(?:https?:\/\/.+|sc-domain:[A-Za-z0-9.-]+)$/))),
});

const gscSecretsSchema = strictObject({
  serviceAccountFile: pipe(string(), regex(ENV_REFERENCE_PATTERN)),
});

const hubSpotConfigSchema = strictObject({});

const hubSpotSecretsSchema = strictObject({
  accessToken: pipe(string(), regex(ENV_REFERENCE_PATTERN)),
});

export type ProviderEnvironment = "production" | "sandbox";

export type ProviderPolicy = {
  maxSpendUsdPerCall?: string;
};

export type ProviderProfile = {
  config: Readonly<Record<string, unknown>>;
  policy: Readonly<ProviderPolicy>;
  secrets: Readonly<Record<string, `env:${string}`>>;
};

export type LoadedProfile = {
  version: 1;
  name: string;
  path: string;
  site?: { configFile: string };
  providers: Readonly<Record<string, ProviderProfile>>;
};

export type ProfileLoadOptions = {
  xdgConfigHome?: string;
  home?: string;
  readTextFile?: (path: string) => Promise<string>;
};

export type ProfileEnvironmentLoadOptions = {
  readTextFile?: (path: string) => Promise<string>;
};

export type ProfileErrorReason =
  | "missing_selector"
  | "invalid_slug"
  | "not_found"
  | "invalid_profile"
  | "name_mismatch"
  | "provider_missing"
  | "secret_env_missing";

export class ProfileError extends Error {
  readonly reason: ProfileErrorReason;

  constructor(reason: ProfileErrorReason, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProfileError";
    this.reason = reason;
  }
}

export function selectProfileName(
  profileFlag: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const selected = profileFlag ?? env.GKIT_PROFILE;
  if (!selected) {
    throw new ProfileError(
      "missing_selector",
      "Provider execution requires --profile or GKIT_PROFILE.",
    );
  }
  assertProfileSlug(selected);
  return selected;
}

export function profilePath(profileName: string, options: ProfileLoadOptions = {}): string {
  assertProfileSlug(profileName);
  const configuredHome = options.xdgConfigHome ?? process.env.XDG_CONFIG_HOME;
  const configHome = configuredHome?.trim()
    ? configuredHome
    : resolve(options.home ?? homedir(), ".config");
  if (!isAbsolute(configHome)) {
    throw new ProfileError("invalid_profile", "XDG_CONFIG_HOME must be an absolute path when set.");
  }
  return resolve(configHome, "gkit", "profiles", `${profileName}.json`);
}

export async function loadProfile(
  profileName: string,
  options: ProfileLoadOptions = {},
): Promise<LoadedProfile> {
  const path = profilePath(profileName, options);
  const readTextFile = options.readTextFile ?? ((target) => readFile(target, "utf8"));

  let source: string;
  try {
    source = await readTextFile(path);
  } catch (error) {
    throw new ProfileError("not_found", `Unable to read profile ${profileName} at ${path}.`, error);
  }

  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error) {
    throw new ProfileError("invalid_profile", `Profile ${profileName} is not valid JSON.`, error);
  }

  const parsed = safeParse(profileDocumentSchema, input);
  if (!parsed.success) {
    throw new ProfileError(
      "invalid_profile",
      `Profile ${profileName} failed structural validation.`,
    );
  }
  if (parsed.output.name !== profileName) {
    throw new ProfileError(
      "name_mismatch",
      `Profile filename ${profileName}.json does not match profile name ${parsed.output.name}.`,
    );
  }

  const providers: Record<string, ProviderProfile> = {};
  for (const [providerId, provider] of Object.entries(parsed.output.providers)) {
    assertNonSecretConfig(provider.config, providerId);
    const config =
      providerId === "dataforseo"
        ? parseDataForSeoConfig(provider.config)
        : providerId === "bing"
          ? parseBingConfig(provider.config)
          : providerId === "gsc"
            ? parseGscConfig(provider.config)
            : providerId === "posthog"
              ? parsePostHogConfig(provider.config)
              : providerId === "hubspot"
                ? parseHubSpotConfig(provider.config)
              : providerId === "google-ads"
                ? parseGoogleAdsConfig(provider.config)
                : freezeRecord(provider.config);
    const secrets =
      providerId === "dataforseo"
        ? parseDataForSeoSecrets(provider.secrets)
        : providerId === "bing"
          ? parseBingSecrets(provider.secrets)
          : providerId === "gsc"
            ? parseGscSecrets(provider.secrets)
            : providerId === "posthog"
              ? parsePostHogSecrets(provider.secrets)
              : providerId === "hubspot"
                ? parseHubSpotSecrets(provider.secrets)
              : providerId === "google-ads"
                ? parseGoogleAdsSecrets(provider.secrets)
                : Object.freeze(provider.secrets as Record<string, `env:${string}`>);
    providers[providerId] = Object.freeze({
      config,
      policy: Object.freeze(provider.policy),
      secrets,
    });
  }

  return Object.freeze({
    version: 1,
    name: parsed.output.name,
    path,
    ...(parsed.output.site ? { site: Object.freeze(parsed.output.site) } : {}),
    providers: Object.freeze(providers),
  });
}

export async function loadProfileEnvironment(
  profile: LoadedProfile,
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: ProfileEnvironmentLoadOptions = {},
): Promise<Readonly<Record<string, string | undefined>>> {
  const path = resolve(dirname(profile.path), profile.name, ".env");
  const readTextFile = options.readTextFile ?? ((target) => readFile(target, "utf8"));

  let profileEnvironment: Record<string, string> = {};
  try {
    profileEnvironment = parseDotenv(await readTextFile(path));
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw new ProfileError(
        "invalid_profile",
        `Unable to read profile environment at ${path}.`,
        error,
      );
    }
  }

  const merged: Record<string, string | undefined> = { ...profileEnvironment };
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) merged[name] = value;
  }
  return Object.freeze(merged);
}

export function getProviderProfile(profile: LoadedProfile, providerId: string): ProviderProfile {
  const provider = profile.providers[providerId];
  if (!provider) {
    throw new ProfileError(
      "provider_missing",
      `Profile ${profile.name} does not configure provider ${providerId}.`,
    );
  }
  return provider;
}

export function getProviderEnvironment(
  profile: LoadedProfile,
  providerId: string,
): ProviderEnvironment {
  const provider = getProviderProfile(profile, providerId);
  if (providerId !== "dataforseo") {
    return "production";
  }
  return provider.config.environment as ProviderEnvironment;
}

export function resolveProviderSecrets(
  profile: LoadedProfile,
  providerId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<Record<string, string>> {
  const provider = getProviderProfile(profile, providerId);
  const resolved: Record<string, string> = {};

  for (const [name, reference] of Object.entries(provider.secrets)) {
    const environmentName = reference.slice("env:".length);
    const value = env[environmentName];
    if (!value) {
      throw new ProfileError(
        "secret_env_missing",
        `Secret environment variable ${environmentName} is not set for provider ${providerId}.`,
      );
    }
    resolved[name] = value;
  }

  return Object.freeze(resolved);
}

function assertProfileSlug(profileName: string): void {
  if (!PROFILE_SLUG_PATTERN.test(profileName)) {
    throw new ProfileError(
      "invalid_slug",
      "Profile name must use lowercase letters, digits, dots, or hyphens and be between 1 and 64 characters.",
    );
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function parseDataForSeoConfig(config: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const parsed = safeParse(dataForSeoConfigSchema, config);
  if (!parsed.success) {
    throw new ProfileError(
      "invalid_profile",
      "DataForSEO config only accepts environment=production or environment=sandbox.",
    );
  }
  return Object.freeze(parsed.output);
}

function parseDataForSeoSecrets(
  secrets: Record<string, string>,
): Readonly<Record<string, `env:${string}`>> {
  const parsed = safeParse(dataForSeoSecretsSchema, secrets);
  if (!parsed.success) {
    throw new ProfileError(
      "invalid_profile",
      "DataForSEO secrets must contain only login and password env: references.",
    );
  }
  return Object.freeze(parsed.output as Record<string, `env:${string}`>);
}

function parsePostHogConfig(config: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const parsed = safeParse(postHogConfigSchema, config);
  if (!parsed.success) {
    throw new ProfileError(
      "invalid_profile",
      "PostHog config requires a fixed US or EU host and a numeric projectId.",
    );
  }
  return Object.freeze(parsed.output);
}

function parsePostHogSecrets(
  secrets: Record<string, string>,
): Readonly<Record<string, `env:${string}`>> {
  const parsed = safeParse(postHogSecretsSchema, secrets);
  if (!parsed.success) {
    throw new ProfileError(
      "invalid_profile",
      "PostHog secrets must contain only an apiToken env: reference.",
    );
  }
  return Object.freeze(parsed.output as Record<string, `env:${string}`>);
}

function parseGoogleAdsConfig(config: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const parsed = safeParse(googleAdsConfigSchema, config);
  if (!parsed.success) {
    throw new ProfileError(
      "invalid_profile",
      "Google Ads config requires one ten-digit customerId and does not expose manager routing.",
    );
  }
  return Object.freeze(parsed.output);
}

function parseGoogleAdsSecrets(
  secrets: Record<string, string>,
): Readonly<Record<string, `env:${string}`>> {
  const parsed = safeParse(googleAdsSecretsSchema, secrets);
  if (!parsed.success) {
    throw new ProfileError(
      "invalid_profile",
      "Google Ads secrets must contain only developerToken and serviceAccountFile env: references.",
    );
  }
  return Object.freeze(parsed.output as Record<string, `env:${string}`>);
}

function parseBingConfig(config: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const parsed = safeParse(bingConfigSchema, config);
  if (!parsed.success) {
    throw new ProfileError(
      "invalid_profile",
      "Bing config accepts only an optional absolute HTTP siteUrl.",
    );
  }
  return Object.freeze(parsed.output);
}

function parseBingSecrets(
  secrets: Record<string, string>,
): Readonly<Record<string, `env:${string}`>> {
  const parsed = safeParse(bingSecretsSchema, secrets);
  if (!parsed.success) {
    throw new ProfileError(
      "invalid_profile",
      "Bing secrets must contain only an apiKey env: reference.",
    );
  }
  return Object.freeze(parsed.output as Record<string, `env:${string}`>);
}

function parseGscConfig(config: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const parsed = safeParse(gscConfigSchema, config);
  if (!parsed.success) {
    throw new ProfileError(
      "invalid_profile",
      "GSC config accepts only an optional URL-prefix or sc-domain siteUrl.",
    );
  }
  return Object.freeze(parsed.output);
}

function parseGscSecrets(
  secrets: Record<string, string>,
): Readonly<Record<string, `env:${string}`>> {
  const parsed = safeParse(gscSecretsSchema, secrets);
  if (!parsed.success) {
    throw new ProfileError(
      "invalid_profile",
      "GSC secrets must contain only a serviceAccountFile env: reference.",
    );
  }
  return Object.freeze(parsed.output as Record<string, `env:${string}`>);
}

function parseHubSpotConfig(config: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const parsed = safeParse(hubSpotConfigSchema, config);
  if (!parsed.success) {
    throw new ProfileError(
      "invalid_profile",
      "HubSpot config must be empty; the account is derived only from the profile-bound token.",
    );
  }
  return Object.freeze(parsed.output);
}

function parseHubSpotSecrets(
  secrets: Record<string, string>,
): Readonly<Record<string, `env:${string}`>> {
  const parsed = safeParse(hubSpotSecretsSchema, secrets);
  if (!parsed.success) {
    throw new ProfileError(
      "invalid_profile",
      "HubSpot secrets must contain only an accessToken env: reference.",
    );
  }
  return Object.freeze(parsed.output as Record<string, `env:${string}`>);
}

function assertNonSecretConfig(value: unknown, providerId: string): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replaceAll(/[-_.]/g, "").toLowerCase();
    if (forbiddenConfigKeys.has(normalizedKey)) {
      throw new ProfileError(
        "invalid_profile",
        `Provider ${providerId} config contains secret or transport override field ${key}; use an env: reference under secrets instead.`,
      );
    }
    assertNonSecretConfig(child, providerId);
  }
}

function freezeRecord(input: Record<string, unknown>): Readonly<Record<string, unknown>> {
  for (const child of Object.values(input)) {
    if (child !== null && typeof child === "object") {
      freezeRecord(child as Record<string, unknown>);
    }
  }
  return Object.freeze(input);
}
