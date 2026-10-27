import type { ParsedCommand } from "./args";
import { executeReadProviderCall } from "./execute-read-provider";
import type { LoadedExecutableManifest } from "./manifest";
import { ProfileError, type ProviderProfile } from "./profile";
import {
  dispatchPageSpeed,
  planPageSpeedRequest,
  type PageSpeedConfig,
  type PageSpeedCredentials,
  type PageSpeedFetch,
  type PageSpeedOperation,
} from "./providers/pagespeed";

type PageSpeedCallCommand = Extract<ParsedCommand, { kind: "pagespeed-call" }>;

export const pageSpeedAdapterKeys = new Set(["run"]);

export async function executePageSpeedCall(options: {
  command: PageSpeedCallCommand;
  manifest: LoadedExecutableManifest;
  signal: AbortSignal;
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
  journalPath?: string;
  fetch?: PageSpeedFetch;
}) {
  return await executeReadProviderCall<PageSpeedConfig, PageSpeedOperation, PageSpeedCredentials>({
    ...options,
    spec: {
      provider: "pagespeed",
      adapterKeys: pageSpeedAdapterKeys,
      readConfig,
      createOperation: (adapterKey, input) => Object.freeze({ adapterKey, input }),
      plan: planPageSpeedRequest,
      // The API key is optional: without one PageSpeed serves a low anonymous quota.
      prepareCredentials: async ({ resolvedSecrets, secrets }) => {
        const apiKey = resolvedSecrets.apiKey ?? null;
        if (apiKey) secrets.register(apiKey);
        return { credentials: Object.freeze({ apiKey }), secretValues: apiKey ? [apiKey] : [] };
      },
      dispatch: async (dispatchOptions) =>
        await dispatchPageSpeed({ ...dispatchOptions, fetch: options.fetch }),
      artifactFormat: "exact-pagespeed-json-response",
    },
  });
}

function readConfig(provider: ProviderProfile): PageSpeedConfig {
  if (Object.keys(provider.config).length > 0) {
    throw new ProfileError("invalid_profile", "PageSpeed config must be empty.");
  }
  return Object.freeze({});
}
