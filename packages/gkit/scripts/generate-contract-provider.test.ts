import { describe, expect, it } from "vitest";

import { generateContractProviderArtifacts } from "./generate-contract-provider";

const packageRoot = new URL("..", import.meta.url).pathname;

describe.each([
  ["bing", 17, "bing.sites.list"],
  ["gsc", 6, "gsc.properties.list"],
] as const)("%s contract generator", (provider, expectedCount, expectedCapability) => {
  it("is deterministic and binds reviewed capabilities to the pinned source", async () => {
    const first = await generateContractProviderArtifacts({ packageRoot, provider });
    const second = await generateContractProviderArtifacts({ packageRoot, provider });
    expect(second).toEqual(first);

    const manifest = JSON.parse(first.manifest) as {
      capabilities: Array<{ id: string; effects: string[] }>;
    };
    expect(manifest.capabilities).toHaveLength(expectedCount);
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({ id: expectedCapability, effects: ["read"] }),
    );
    expect(first.docs).toContain(expectedCapability);
  });
});
