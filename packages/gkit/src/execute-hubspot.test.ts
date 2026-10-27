import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ParsedCommand } from "./args";
import { serializeEnvelope } from "./envelope";
import { executeHubSpotCall } from "./execute-hubspot";
import { readJournal } from "./journal";
import { loadExecutableManifest } from "./manifest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("HubSpot execution boundary", () => {
  it("dry-runs before secret resolution, fetch, or artifact creation", async () => {
    const fixture = await createFixture();
    const fetch = vi.fn();
    const result = await executeHubSpotCall({
      command: command(fixture.outPath, true),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: { XDG_STATE_HOME: fixture.stateHome },
      xdgConfigHome: fixture.xdgConfigHome,
      fetch,
    });

    expect(result.envelope).toMatchObject({
      ok: true,
      data: {
        dryRun: true,
        requestPlan: {
          provider: "hubspot",
          method: "GET",
          endpoint: "https://api.hubapi.com/crm/objects/2026-03/contacts",
        },
      },
      meta: { provider: "hubspot", artifact: null },
    });
    expect(fetch).not.toHaveBeenCalled();
    await expect(readFile(fixture.outPath)).rejects.toThrow();
    expect((await readJournal({ journalPath: fixture.journalPath })).events).toEqual([]);
  });

  it("publishes bounded CRM facts and returns only a compact receipt", async () => {
    const fixture = await createFixture();
    const result = await executeHubSpotCall({
      command: command(fixture.outPath, false),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: { TEST_HUBSPOT_ACCESS_TOKEN: "private-secret", XDG_STATE_HOME: fixture.stateHome },
      xdgConfigHome: fixture.xdgConfigHome,
      fetch: async (_input, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-secret");
        return new Response(JSON.stringify({ results: [{ id: "1", properties: { email: "a@b.test" } }] }), {
          status: 200,
          headers: { "x-hubspot-correlation-id": "request_123" },
        });
      },
    });

    expect(result.envelope).toMatchObject({
      ok: true,
      data: {
        pages: 1,
        rowCount: 1,
        artifactFormat: "json-array-of-exact-hubspot-pages",
      },
      meta: {
        providerRequestId: "request_123",
        artifact: { path: expect.stringMatching(/result\.json$/), bytes: expect.any(Number), sha256: expect.any(String) },
      },
    });
    expect(await readFile(fixture.outPath, "utf8")).toContain("a@b.test");
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.events.map((event) => event.type)).toEqual([
      "attempt_started",
      "attempt_settled",
      "artifact_recorded",
    ]);
    expect(journal.operations[0]).toMatchObject({
      started: {
        operationId: result.envelope.meta?.operationId,
        provider: "hubspot",
        capability: "hubspot.crm.objects.list",
        effects: ["read"],
        spend: null,
      },
      latestSettlement: { providerResult: "succeeded", providerRequestId: "request_123" },
      state: "succeeded",
    });
    const serialized = serializeEnvelope(result.envelope, result.secrets);
    expect(serialized).not.toContain("private-secret");
    expect(serialized).not.toContain("a@b.test");
  });

  it("preserves no-replace behavior before dispatch", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.outPath, "existing");
    const fetch = vi.fn();
    const result = await executeHubSpotCall({
      command: command(fixture.outPath, false),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: { TEST_HUBSPOT_ACCESS_TOKEN: "private-secret", XDG_STATE_HOME: fixture.stateHome },
      xdgConfigHome: fixture.xdgConfigHome,
      fetch,
    });

    expect(result.envelope).toMatchObject({ ok: false, error: { code: "LOCAL_IO_ERROR" } });
    expect(fetch).not.toHaveBeenCalled();
    expect(await readFile(fixture.outPath, "utf8")).toBe("existing");
  });

  it("fails closed when provider bytes contain the access token", async () => {
    const fixture = await createFixture();
    const result = await executeHubSpotCall({
      command: command(fixture.outPath, false),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: { TEST_HUBSPOT_ACCESS_TOKEN: "private-secret", XDG_STATE_HOME: fixture.stateHome },
      xdgConfigHome: fixture.xdgConfigHome,
      fetch: async () =>
        new Response(JSON.stringify({ results: [{ id: "1", value: "private-secret" }] }), {
          status: 200,
        }),
    });

    expect(result.envelope).toMatchObject({
      ok: false,
      error: { code: "LOCAL_IO_ERROR", outcome: "confirmed" },
      meta: { artifact: null },
    });
    expect(serializeEnvelope(result.envelope, result.secrets)).not.toContain("private-secret");
    await expect(readFile(fixture.outPath)).rejects.toThrow();
  });

  it("records a confirmed rate-limit body as an artifact without projecting it to stdout", async () => {
    const fixture = await createFixture();
    const result = await executeHubSpotCall({
      command: command(fixture.outPath, false),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: { TEST_HUBSPOT_ACCESS_TOKEN: "private-secret", XDG_STATE_HOME: fixture.stateHome },
      xdgConfigHome: fixture.xdgConfigHome,
      fetch: async () =>
        new Response(
          JSON.stringify({
            category: "RATE_LIMITS",
            correlationId: "rate_request",
            message: "provider-only diagnostic",
          }),
          { status: 429 },
        ),
    });

    expect(result.envelope).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED", retryable: true, outcome: "confirmed" },
      meta: { providerRequestId: "rate_request", artifact: { bytes: expect.any(Number) } },
    });
    expect(serializeEnvelope(result.envelope, result.secrets)).not.toContain(
      "provider-only diagnostic",
    );
    expect(await readFile(fixture.outPath, "utf8")).toContain("provider-only diagnostic");
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.operations[0]?.latestSettlement).toMatchObject({
      providerResult: "failed",
      errorCode: "RATE_LIMITED",
    });
    expect(journal.operations[0]?.state).toBe("failed");
  });

  it("cancels before provider handoff with exit 130 and no fetch", async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn();
    const result = await executeHubSpotCall({
      command: command(fixture.outPath, false),
      manifest: fixture.manifest,
      signal: controller.signal,
      env: { TEST_HUBSPOT_ACCESS_TOKEN: "private-secret", XDG_STATE_HOME: fixture.stateHome },
      xdgConfigHome: fixture.xdgConfigHome,
      fetch,
    });

    expect(result.exitCode).toBe(130);
    expect(result.envelope).toMatchObject({
      ok: false,
      error: { code: "CANCELLED", outcome: "not_dispatched" },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect((await readJournal({ journalPath: fixture.journalPath })).events).toEqual([]);
  });
});

function command(
  outPath: string,
  dryRun: boolean,
): Extract<ParsedCommand, { kind: "hubspot-call" }> {
  return {
    kind: "hubspot-call",
    profileFlag: "app-a",
    capabilityId: "hubspot.crm.objects.list",
    input: JSON.stringify({ objectType: "contacts", properties: ["email"], limit: 1 }),
    out: outPath,
    force: false,
    dryRun,
  };
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "gkit-hubspot-execute-"));
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
        hubspot: {
          config: {},
          policy: {},
          secrets: { accessToken: "env:TEST_HUBSPOT_ACCESS_TOKEN" },
        },
      },
    }),
  );
  return {
    root,
    xdgConfigHome,
    stateHome: join(root, "state"),
    journalPath: join(root, "state", "gkit", "operations.jsonl"),
    outPath: join(root, "result.json"),
    manifest: await loadExecutableManifest(
      new URL("../generated/hubspot/manifest.json", import.meta.url).pathname,
    ),
  };
}
