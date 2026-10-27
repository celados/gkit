import type { ParsedCommand } from "./args";
import { executeReadProviderCall } from "./execute-read-provider";
import type { LoadedExecutableManifest } from "./manifest";
import { ProfileError, type ProviderProfile } from "./profile";
import {
  createHubSpotOperation,
  dispatchHubSpot,
  planHubSpotRequest,
  type HubSpotConfig,
  type HubSpotCredentials,
  type HubSpotFetch,
  type HubSpotOperation,
} from "./providers/hubspot";

type HubSpotCallCommand = Extract<ParsedCommand, { kind: "hubspot-call" }>;

export const hubSpotAdapterKeys = new Set([
  "crm.associations.list",
  "crm.objects.list",
  "crm.objects.search",
  "crm.owners.list",
  "crm.pipelines.list",
  "crm.properties.list",
  "events.occurrences.list",
]);

export async function executeHubSpotCall(options: {
  command: HubSpotCallCommand;
  manifest: LoadedExecutableManifest;
  signal: AbortSignal;
  env?: Readonly<Record<string, string | undefined>>;
  xdgConfigHome?: string;
  home?: string;
  journalPath?: string;
  fetch?: HubSpotFetch;
}) {
  return await executeReadProviderCall<HubSpotConfig, HubSpotOperation, HubSpotCredentials>({
    ...options,
    spec: {
      provider: "hubspot",
      adapterKeys: hubSpotAdapterKeys,
      readConfig,
      createOperation: createHubSpotOperation,
      plan: planHubSpotRequest,
      prepareCredentials: async (credentialOptions) => {
        const accessToken = credentialOptions.resolvedSecrets.accessToken;
        if (!accessToken) {
          throw new ProfileError(
            "invalid_profile",
            "HubSpot requires an accessToken env reference under secrets.",
          );
        }
        credentialOptions.secrets.register(accessToken);
        return {
          credentials: Object.freeze({ accessToken }),
          secretValues: [accessToken],
        };
      },
      dispatch: async (dispatchOptions) =>
        await dispatchHubSpot({ ...dispatchOptions, fetch: options.fetch }),
      artifactFormat: "json-array-of-exact-hubspot-pages",
    },
  });
}

function readConfig(provider: ProviderProfile): HubSpotConfig {
  if (Object.keys(provider.config).length > 0) {
    throw new ProfileError("invalid_profile", "HubSpot config must be empty.");
  }
  return Object.freeze({});
}
