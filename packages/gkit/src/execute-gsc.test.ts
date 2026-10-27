import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ParsedCommand } from "./args";
import { serializeEnvelope } from "./envelope";
import { executeGscCall } from "./execute-gsc";
import { readJournal } from "./journal";
import { loadExecutableManifest } from "./manifest";

const temporaryDirectories: string[] = [];
const feedpath = "https://example.com/sitemap.xml";
const submitUrl =
  "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/sitemaps/https%3A%2F%2Fexample.com%2Fsitemap.xml";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("GSC sitemap submission execution boundary", () => {
  it.each([false, true])(
    "denies gsc.sitemaps.submit without --allow-write (dry-run: %s) before credentials or dispatch",
    async (dryRun) => {
      const fixture = await createFixture();
      const fetch = vi.fn();
      const deriveAccessToken = vi.fn();
      const result = await executeGscCall({
        command: submitCommand(fixture.outPath, { allowWrite: false, dryRun }),
        manifest: fixture.manifest,
        signal: new AbortController().signal,
        env: fixture.env,
        xdgConfigHome: fixture.xdgConfigHome,
        fetch,
        deriveAccessToken,
      });

      expect(result.exitCode).toBe(1);
      expect(result.envelope).toMatchObject({
        ok: false,
        error: {
          code: "EFFECT_NOT_ALLOWED",
          outcome: "not_dispatched",
          hint: "Review the request, then rerun with --allow-write.",
          details: { reason: "missing_allow_write" },
        },
        meta: { capability: "gsc.sitemaps.submit", effects: ["write"], artifact: null },
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(deriveAccessToken).not.toHaveBeenCalled();
      await expect(readFile(fixture.outPath)).rejects.toThrow();
      expect((await readJournal({ journalPath: fixture.journalPath })).events).toEqual([]);
    },
  );

  it("plans the PUT on --allow-write --dry-run without credentials or dispatch", async () => {
    const fixture = await createFixture();
    const fetch = vi.fn();
    const deriveAccessToken = vi.fn();
    const result = await executeGscCall({
      command: submitCommand(fixture.outPath, { allowWrite: true, dryRun: true }),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: fixture.env,
      xdgConfigHome: fixture.xdgConfigHome,
      fetch,
      deriveAccessToken,
    });

    expect(result.envelope).toMatchObject({
      ok: true,
      data: { dryRun: true, requestPlan: { method: "PUT", endpoint: submitUrl } },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(deriveAccessToken).not.toHaveBeenCalled();
    expect((await readJournal({ journalPath: fixture.journalPath })).events).toEqual([]);
  });

  it("submits with the write scope and publishes a deterministic receipt for an empty 204", async () => {
    const fixture = await createFixture();
    const deriveAccessToken = vi.fn(async () => "write-token-secret");
    const calls: Array<{ url: string; method: string | undefined; auth: string | null }> = [];
    const result = await executeGscCall({
      command: submitCommand(fixture.outPath, { allowWrite: true, dryRun: false }),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: fixture.env,
      xdgConfigHome: fixture.xdgConfigHome,
      deriveAccessToken,
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          method: init?.method,
          auth: new Headers(init?.headers).get("authorization"),
        });
        return new Response(null, { status: 204 });
      },
    });

    expect(deriveAccessToken).toHaveBeenCalledWith(expect.any(Object), "write");
    expect(calls).toEqual([
      { url: submitUrl, method: "PUT", auth: "Bearer write-token-secret" },
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.envelope).toMatchObject({
      ok: true,
      data: {
        submitted: true,
        siteUrl: "sc-domain:example.com",
        feedpath,
        httpStatus: 204,
        artifactFormat: "gkit-gsc-sitemap-submit-receipt",
        artifact: { path: expect.stringMatching(/receipt\.json$/), sha256: expect.any(String) },
      },
      meta: { capability: "gsc.sitemaps.submit", effects: ["write"], operationId: expect.any(String), spend: null },
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
        provider: "gsc",
        capability: "gsc.sitemaps.submit",
        effects: ["write"],
        spend: null,
      },
      latestSettlement: { providerResult: "succeeded", errorCode: null },
      state: "succeeded",
    });
    expect(await readFile(fixture.journalPath, "utf8")).not.toContain("write-token-secret");
    expect(JSON.parse(await readFile(fixture.outPath, "utf8"))).toEqual({
      feedpath,
      httpStatus: 204,
      operation: "sitemaps.submit",
      provider: "gsc",
      siteUrl: "sc-domain:example.com",
      submitted: true,
    });
    expect(serializeEnvelope(result.envelope, result.secrets)).not.toContain("write-token-secret");
  });

  it("surfaces a Restricted-user 403 as AUTH_FAILED with a permission explanation", async () => {
    const fixture = await createFixture();
    const result = await executeGscCall({
      command: submitCommand(fixture.outPath, { allowWrite: true, dryRun: false }),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: fixture.env,
      xdgConfigHome: fixture.xdgConfigHome,
      deriveAccessToken: async () => "write-token-secret",
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { code: 403, message: "User does not have sufficient permission.", status: "PERMISSION_DENIED" },
          }),
          { status: 403 },
        ),
    });

    expect(result.exitCode).toBe(1);
    expect(result.envelope).toMatchObject({
      ok: false,
      error: {
        code: "AUTH_FAILED",
        outcome: "confirmed",
        message: expect.stringMatching(/lacks write permission.*Restricted user/),
        details: {
          httpStatus: 403,
          providerStatus: "PERMISSION_DENIED",
          requiredPermissionLevel: "siteFullUser",
        },
      },
    });
    expect(await readFile(fixture.outPath, "utf8")).toContain("PERMISSION_DENIED");
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.operations[0]?.latestSettlement).toMatchObject({
      providerResult: "failed",
      errorCode: "AUTH_FAILED",
    });
    expect(journal.operations[0]?.state).toBe("failed");
  });

  it("keeps read capabilities on the read-only scope without --allow-write", async () => {
    const fixture = await createFixture();
    const deriveAccessToken = vi.fn(async () => "read-token-secret");
    const result = await executeGscCall({
      command: {
        ...submitCommand(fixture.outPath, { allowWrite: false, dryRun: false }),
        capabilityId: "gsc.sitemaps.get",
      },
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      env: fixture.env,
      xdgConfigHome: fixture.xdgConfigHome,
      deriveAccessToken,
      fetch: async (_input, init) => {
        expect(init?.method).toBe("GET");
        return new Response(JSON.stringify({ path: feedpath }), { status: 200 });
      },
    });

    expect(deriveAccessToken).toHaveBeenCalledWith(expect.any(Object), "read");
    expect(result.envelope).toMatchObject({
      ok: true,
      data: { rowCount: 1, artifactFormat: "exact-gsc-json-response" },
    });
  });
});

function submitCommand(
  outPath: string,
  flags: { allowWrite: boolean; dryRun: boolean },
): Extract<ParsedCommand, { kind: "gsc-call" }> {
  return {
    kind: "gsc-call",
    profileFlag: "app-a",
    capabilityId: "gsc.sitemaps.submit",
    input: JSON.stringify({ feedpath }),
    allowWrite: flags.allowWrite,
    out: outPath,
    force: false,
    dryRun: flags.dryRun,
  };
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "gkit-gsc-execute-"));
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
        gsc: {
          config: { siteUrl: "sc-domain:example.com" },
          policy: {},
          secrets: { serviceAccountFile: "env:TEST_GSC_SERVICE_ACCOUNT_FILE" },
        },
      },
    }),
  );
  const serviceAccountPath = join(root, "service-account.json");
  await writeFile(
    serviceAccountPath,
    JSON.stringify({
      type: "service_account",
      client_email: "gkit-test@example.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nfake-key-for-tests\n-----END PRIVATE KEY-----\n",
    }),
  );
  return {
    xdgConfigHome,
    outPath: join(root, "receipt.json"),
    journalPath: join(root, "state", "gkit", "operations.jsonl"),
    env: {
      TEST_GSC_SERVICE_ACCOUNT_FILE: serviceAccountPath,
      HOME: root,
      XDG_STATE_HOME: join(root, "state"),
    },
    manifest: await loadExecutableManifest(
      new URL("../generated/gsc/manifest.json", import.meta.url).pathname,
    ),
  };
}
