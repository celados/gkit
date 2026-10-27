import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ParsedCommand } from "./args";
import { serializeEnvelope } from "./envelope";
import { executePageSpeedCall } from "./execute-pagespeed";
import { readJournal } from "./journal";
import { loadExecutableManifest } from "./manifest";

const temporaryDirectories: string[] = [];
const response = {
  lighthouseResult: {
    finalUrl: "https://example.com/",
    categories: { performance: { score: 0.91 }, seo: { score: 1 } },
  },
  loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1800 } } },
  originLoadingExperience: { metrics: {} },
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("PageSpeed execution boundary", () => {
  it("dry-runs with a key-free plan and journals nothing", async () => {
    const fixture = await createFixture({ withKey: true });
    const fetch = vi.fn();
    const result = await executePageSpeedCall({
      command: command(fixture.outPath, true),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: { TEST_PAGESPEED_KEY: "psi-secret", XDG_STATE_HOME: fixture.stateHome },
      xdgConfigHome: fixture.xdgConfigHome,
      fetch,
    });

    expect(result.envelope).toMatchObject({
      ok: true,
      data: { dryRun: true, requestPlan: { provider: "pagespeed", method: "GET" } },
      meta: { provider: "pagespeed", operationId: null, spend: null },
    });
    expect(serializeEnvelope(result.envelope, result.secrets)).not.toContain("key=");
    expect(fetch).not.toHaveBeenCalled();
    expect((await readJournal({ journalPath: fixture.journalPath })).events).toEqual([]);
  });

  it("journals a live run and summarizes scores without leaking the key", async () => {
    const fixture = await createFixture({ withKey: true });
    let requested = "";
    const result = await executePageSpeedCall({
      command: command(fixture.outPath, false),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: { TEST_PAGESPEED_KEY: "psi-secret", XDG_STATE_HOME: fixture.stateHome },
      xdgConfigHome: fixture.xdgConfigHome,
      fetch: async (input) => {
        requested = String(input);
        return new Response(JSON.stringify(response), { status: 200 });
      },
    });

    expect(new URL(requested).searchParams.get("key")).toBe("psi-secret");
    expect(result.envelope).toMatchObject({
      ok: true,
      data: {
        scores: { performance: 0.91, seo: 1 },
        fieldData: { url: true, origin: false },
        artifactFormat: "exact-pagespeed-json-response",
      },
      meta: { operationId: expect.any(String), artifact: { sha256: expect.any(String) } },
    });
    expect(serializeEnvelope(result.envelope, result.secrets)).not.toContain("psi-secret");
    expect(JSON.parse(await readFile(fixture.outPath, "utf8"))).toEqual(response);
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.events.map((event) => event.type)).toEqual([
      "attempt_started",
      "attempt_settled",
      "artifact_recorded",
    ]);
    expect(journal.operations[0]).toMatchObject({
      started: { provider: "pagespeed", capability: "pagespeed.run", effects: ["read"], spend: null },
      latestSettlement: { providerResult: "succeeded" },
      state: "succeeded",
    });
    expect(await readFile(fixture.journalPath, "utf8")).not.toContain("psi-secret");
  });

  it("runs without an API key", async () => {
    const fixture = await createFixture({ withKey: false });
    let requested = "";
    const result = await executePageSpeedCall({
      command: command(fixture.outPath, false),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: { XDG_STATE_HOME: fixture.stateHome },
      xdgConfigHome: fixture.xdgConfigHome,
      fetch: async (input) => {
        requested = String(input);
        return new Response(JSON.stringify(response), { status: 200 });
      },
    });

    expect(result.envelope.ok).toBe(true);
    expect(new URL(requested).searchParams.has("key")).toBe(false);
  });
});

function command(out: string, dryRun: boolean): Extract<ParsedCommand, { kind: "pagespeed-call" }> {
  return {
    kind: "pagespeed-call",
    profileFlag: "app-a",
    capabilityId: "pagespeed.run",
    input: JSON.stringify({ url: "https://example.com/", categories: ["performance", "seo"] }),
    out,
    force: false,
    dryRun,
  };
}

async function createFixture(options: { withKey: boolean }) {
  const root = await mkdtemp(join(tmpdir(), "gkit-pagespeed-execute-"));
  temporaryDirectories.push(root);
  const xdgConfigHome = join(root, "config");
  const profilePath = join(xdgConfigHome, "gkit/profiles/app-a.json");
  await mkdir(dirname(profilePath), { recursive: true });
  await writeFile(
    profilePath,
    JSON.stringify({
      version: 1,
      name: "app-a",
      providers: {
        pagespeed: options.withKey ? { secrets: { apiKey: "env:TEST_PAGESPEED_KEY" } } : {},
      },
    }),
  );
  return {
    xdgConfigHome,
    stateHome: join(root, "state"),
    journalPath: join(root, "state", "gkit", "operations.jsonl"),
    outPath: join(root, "result.json"),
    manifest: await loadExecutableManifest(
      new URL("../generated/pagespeed/manifest.json", import.meta.url).pathname,
    ),
  };
}
