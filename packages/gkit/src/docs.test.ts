import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import { renderProviderDocs } from "./docs";
import { loadExecutableManifest } from "./manifest";

describe("provider docs", () => {
  it.each([
    ["bing", "capabilities.md"],
    ["dataforseo", "backlinks.md"],
    ["google-ads", "capabilities.md"],
    ["gsc", "capabilities.md"],
    ["hubspot", "capabilities.md"],
    ["pagespeed", "capabilities.md"],
    ["posthog", "capabilities.md"],
  ])("keeps %s docs as a byte-stable manifest projection", async (provider, file) => {
    const manifest = await loadExecutableManifest(
      new URL(`../generated/${provider}/manifest.json`, import.meta.url).pathname,
    );
    const committed = await readFile(
      new URL(`../docs/providers/${provider}/${file}`, import.meta.url),
      "utf8",
    );

    expect(committed).toBe(renderProviderDocs(manifest));
  });
});
