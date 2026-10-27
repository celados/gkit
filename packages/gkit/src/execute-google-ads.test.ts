import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ParsedCommand } from "./args";
import { serializeEnvelope } from "./envelope";
import { executeGoogleAdsCall } from "./execute-google-ads";
import { readJournal } from "./journal";
import { loadExecutableManifest } from "./manifest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Google Ads execution boundary", () => {
  it("dry-runs before secret resolution, OAuth, adapter loading, or artifact creation", async () => {
    const fixture = await createFixture();
    const loadAuth = vi.fn();
    const loadAdapter = vi.fn();
    const result = await executeGoogleAdsCall({
      command: command(fixture.outPath, true),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: {},
      xdgConfigHome: fixture.xdgConfigHome,
      journalPath: fixture.journalPath,
      dependencies: {
        loadGoogleAdsAuth: loadAuth,
        loadGoogleAdsAdapter: loadAdapter,
      },
    });

    expect(result.envelope).toMatchObject({
      ok: true,
      data: {
        dryRun: true,
        requestPlan: {
          apiVersion: "v24",
          authMode: "service_account",
          managerRouting: false,
          endpoint: "https://googleads.googleapis.com/v24/customers/1234567890/googleAds:search",
        },
      },
      meta: { provider: "google-ads", operationId: null, spend: null, artifact: null },
    });
    expect(loadAuth).not.toHaveBeenCalled();
    expect(loadAdapter).not.toHaveBeenCalled();
    await expect(readFile(fixture.outPath)).rejects.toThrow();
    expect((await readJournal({ journalPath: fixture.journalPath })).events).toEqual([]);
  });

  it("derives and registers the access token before streaming a secret-safe artifact", async () => {
    const fixture = await createFixture();
    const deriveAccessToken = vi.fn(async () => "derived_access_secret");
    const createDispatch = vi.fn(() => ({
      source: (async function* () {
        yield '[{"results":[{"campaign":{"id":"1"}}]}]';
      })(),
      result: Promise.resolve({
        ok: true as const,
        providerRequestId: "request_123",
        data: { pages: 1, rowCount: 1 },
      }),
    }));
    const result = await executeGoogleAdsCall({
      command: command(fixture.outPath, false),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: {
        TEST_GOOGLE_ADS_DEVELOPER_TOKEN: "developer_secret",
        TEST_GOOGLE_ADS_SERVICE_ACCOUNT_FILE: "credentials/google-ads.json",
      },
      xdgConfigHome: fixture.xdgConfigHome,
      journalPath: fixture.journalPath,
      dependencies: {
        loadGoogleAdsAuth: async () => ({ deriveGoogleAdsAccessToken: deriveAccessToken }),
        loadGoogleAdsAdapter: async () => ({ createGoogleAdsDispatch: createDispatch }),
      },
    });

    expect(deriveAccessToken).toHaveBeenCalledOnce();
    expect(createDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          developerToken: "developer_secret",
          accessToken: "derived_access_secret",
        },
      }),
    );
    expect(result.envelope).toMatchObject({
      ok: true,
      data: {
        pages: 1,
        rowCount: 1,
        artifactFormat: "json-array-of-exact-rest-pages",
      },
      meta: { providerRequestId: "request_123", operationId: expect.any(String), spend: null },
    });
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.events.map((event) => event.type)).toEqual([
      "attempt_started",
      "attempt_settled",
      "artifact_recorded",
    ]);
    expect(journal.operations[0]).toMatchObject({
      started: {
        operationId: result.envelope.meta?.operationId,
        provider: "google-ads",
        capability: "google-ads.query.gaql",
        effects: ["read"],
        spend: null,
      },
      latestSettlement: { providerResult: "succeeded", providerRequestId: "request_123", spend: null },
      state: "succeeded",
    });
    expect(await readFile(fixture.outPath, "utf8")).toBe('[{"results":[{"campaign":{"id":"1"}}]}]');
    const serialized = serializeEnvelope(result.envelope, result.secrets);
    expect(serialized).not.toContain("developer_secret");
    expect(serialized).not.toContain("derived_access_secret");
    expect(serialized).not.toContain("PRIVATE KEY");
  });

  it("returns AUTH_FAILED without dispatch or artifact when OAuth token derivation fails", async () => {
    const fixture = await createFixture();
    const loadAdapter = vi.fn();
    const result = await executeGoogleAdsCall({
      command: command(fixture.outPath, false),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: {
        TEST_GOOGLE_ADS_DEVELOPER_TOKEN: "developer_secret",
        TEST_GOOGLE_ADS_SERVICE_ACCOUNT_FILE: "credentials/google-ads.json",
      },
      xdgConfigHome: fixture.xdgConfigHome,
      journalPath: fixture.journalPath,
      dependencies: {
        loadGoogleAdsAuth: async () => ({
          deriveGoogleAdsAccessToken: async () => {
            throw new Error("private key rejected");
          },
        }),
        loadGoogleAdsAdapter: loadAdapter,
      },
    });

    expect(result.envelope).toMatchObject({
      ok: false,
      error: { code: "AUTH_FAILED", outcome: "not_dispatched" },
    });
    expect(loadAdapter).not.toHaveBeenCalled();
    await expect(readFile(fixture.outPath)).rejects.toThrow();
    expect((await readJournal({ journalPath: fixture.journalPath })).events).toEqual([]);
  });
});

function command(
  outPath: string,
  dryRun: boolean,
): Extract<ParsedCommand, { kind: "google-ads-call" }> {
  return {
    kind: "google-ads-call",
    profileFlag: "app-a",
    capabilityId: "google-ads.query.gaql",
    input: JSON.stringify({ query: "SELECT campaign.id FROM campaign LIMIT 1" }),
    out: outPath,
    force: false,
    dryRun,
  };
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "gkit-google-ads-execute-"));
  temporaryDirectories.push(root);
  const xdgConfigHome = join(root, "config");
  const profilePath = join(xdgConfigHome, "gkit/profiles/app-a.json");
  const credentialsPath = join(xdgConfigHome, "gkit/profiles/app-a/credentials/google-ads.json");
  await mkdir(dirname(credentialsPath), { recursive: true });
  await writeFile(
    profilePath,
    JSON.stringify({
      version: 1,
      name: "app-a",
      providers: {
        "google-ads": {
          config: { customerId: "1234567890" },
          policy: {},
          secrets: {
            developerToken: "env:TEST_GOOGLE_ADS_DEVELOPER_TOKEN",
            serviceAccountFile: "env:TEST_GOOGLE_ADS_SERVICE_ACCOUNT_FILE",
          },
        },
      },
    }),
  );
  await writeFile(
    credentialsPath,
    JSON.stringify({
      type: "service_account",
      client_email: "service@example.invalid",
      private_key: "-----BEGIN PRIVATE KEY-----\nprivate_secret\n-----END PRIVATE KEY-----\n",
    }),
  );
  return {
    root,
    xdgConfigHome,
    journalPath: join(root, "state", "gkit", "operations.jsonl"),
    outPath: join(root, "result.json"),
    manifest: await loadExecutableManifest(
      new URL("../generated/google-ads/manifest.json", import.meta.url).pathname,
    ),
  };
}
