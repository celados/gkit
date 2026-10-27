import type { ParsedCommand } from "./args";
import { executeReadProviderCall } from "./execute-read-provider";
import type { LoadedExecutableManifest } from "./manifest";
import type { ProviderProfile } from "./profile";
import {
  dispatchBing,
  planBingRequest,
  type BingConfig,
  type BingCredentials,
  type BingOperation,
} from "./providers/bing";

type BingCallCommand = Extract<ParsedCommand, { kind: "bing-call" }>;

export const bingAdapterKeys = new Set([
  "sites.list",
  "traffic.rank",
  "traffic.queries",
  "traffic.pages",
  "traffic.query",
  "traffic.page-queries",
  "traffic.query-pages",
  "traffic.query-page",
  "crawl.stats",
  "crawl.issues",
  "crawl.settings",
  "links.pages",
  "links.url",
  "sitemaps.list",
  "sitemaps.get",
  "urls.info",
  "urls.traffic",
]);

export async function executeBingCall(options: {
  command: BingCallCommand;
  manifest: LoadedExecutableManifest;
  signal: AbortSignal;
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
  journalPath?: string;
}) {
  return await executeReadProviderCall<BingConfig, BingOperation, BingCredentials>({
    ...options,
    spec: {
      provider: "bing",
      adapterKeys: bingAdapterKeys,
      readConfig,
      createOperation: (adapterKey, input) => Object.freeze({ adapterKey, input }),
      plan: planBingRequest,
      prepareCredentials: async ({ resolvedSecrets }) => {
        const apiKey = resolvedSecrets.apiKey;
        if (!apiKey) throw new TypeError("Bing requires an apiKey env reference.");
        return { credentials: Object.freeze({ apiKey }), secretValues: [apiKey] };
      },
      dispatch: dispatchBing,
      artifactFormat: "exact-bing-json-response",
    },
  });
}

function readConfig(provider: ProviderProfile): BingConfig {
  const siteUrl = provider.config.siteUrl;
  return Object.freeze({ ...(typeof siteUrl === "string" ? { siteUrl } : {}) });
}
