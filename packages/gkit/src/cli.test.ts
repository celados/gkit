import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { appendSettled, authorizeIfUnblocked } from "./ledger";

const temporaryDirectories: string[] = [];
const cliPath = new URL("./cli.ts", import.meta.url).pathname;
const providerTaskId = "10131644-1535-0347-0000-750206cf57d8";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("gkit process contract", () => {
  it("renders an offline argc-backed schema under the token budget with executable examples", async () => {
    const fixture = await createCliFixture();
    const result = await runCli(["--schema"], fixture.env);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(Buffer.byteLength(result.stdout)).toBeLessThan(2_000);
    expect(result.stdout).toContain("gkit --profile <app> dataforseo api call");
    expect(result.stdout).toContain("gkit --profile <app> posthog api call");
    expect(result.stdout).toContain("gkit --profile <app> google-ads api call");
    expect(result.stdout).toContain("gkit --profile <app> bing api call");
    expect(result.stdout).toContain("gkit --profile <app> gsc api call");
    expect(result.stdout).toContain("gkit --profile <app> hubspot api call");
    expect(result.stdout).toContain("gkit describe --id <capability-id>");
    expect(result.stdout).toContain("argc dotted commands and @run are intentionally not exposed");
    expect(result.stdout).not.toContain("gkit dataforseo.api.call");
    expect(result.stdout).not.toContain("gkit google-ads.api.call");
    expect(result.stdout).not.toContain("gkit bing.api.call");
    expect(result.stdout).not.toContain("gkit gsc.api.call");
    expect(result.stdout).not.toContain("gkit hubspot.api.call");

    const selected = await runCli(["--schema", "posthog"], fixture.env);
    expect(selected.exitCode).toBe(0);
    expect(selected.stdout).toContain("posthog:");
    expect(selected.stdout).not.toContain("dataforseo:");

    const googleAds = await runCli(["--schema", "google-ads"], fixture.env);
    expect(googleAds.exitCode).toBe(0);
    expect(googleAds.stdout).toContain('"google-ads":');
    expect(googleAds.stdout).not.toContain("posthog:");

    const hubspot = await runCli(["--schema", "hubspot"], fixture.env);
    expect(hubspot.exitCode).toBe(0);
    expect(hubspot.stdout).toContain("hubspot:");
    expect(hubspot.stdout).not.toContain("posthog:");
  });

  it("dispatches HubSpot through the common api call envelope and artifact contract", async () => {
    const fixture = await createCliFixture();
    const outPath = join(fixture.root, "hubspot-contacts.json");
    const result = await runMainHarness(
      [
        "--profile",
        "app-a",
        "hubspot",
        "api",
        "call",
        "--operation-id",
        "hubspot.crm.objects.list",
        "--input",
        JSON.stringify({ objectType: "contacts", properties: ["email"], limit: 1 }),
        "--out",
        outPath,
      ],
      { ...fixture.env, TEST_HUBSPOT_ACCESS_TOKEN: "hubspot-secret" },
      `async (_input, init) => {
        if (new Headers(init?.headers).get("authorization") !== "Bearer hubspot-secret") throw new Error("missing auth");
        return new Response(JSON.stringify({ results: [{ id: "1", properties: { email: "person@example.test" } }] }), { status: 200, headers: { "x-hubspot-correlation-id": "hubspot_request" } });
      }`,
    ).result;

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("hubspot-secret");
    expect(result.stdout).not.toContain("person@example.test");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: { pages: 1, rowCount: 1, artifactFormat: "json-array-of-exact-hubspot-pages" },
      meta: { provider: "hubspot", providerRequestId: "hubspot_request" },
    });
    expect(await readFile(outPath, "utf8")).toContain("person@example.test");
  });

  it("keeps describe offline and profile-free", async () => {
    const fixture = await createCliFixture();
    const result = await runCli(
      ["describe", "--id", "dataforseo.backlinks.bulk_ranks.live"],
      fixture.env,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const description = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(description.id).toBe("dataforseo.backlinks.bulk_ranks.live");
    expect(description.effects).toEqual(["read", "spend"]);

    const posthog = await runCli(["describe", "--id", "posthog.query.run"], fixture.env);
    expect(posthog.exitCode).toBe(0);
    expect(JSON.parse(posthog.stdout)).toMatchObject({
      id: "posthog.query.run",
      provider: "posthog",
      effects: ["read"],
    });

    const googleAds = await runCli(["describe", "--id", "google-ads.query.gaql"], fixture.env);
    expect(googleAds.exitCode).toBe(0);
    expect(JSON.parse(googleAds.stdout)).toMatchObject({
      id: "google-ads.query.gaql",
      provider: "google-ads",
      effects: ["read"],
    });

    const bing = await runCli(["describe", "--id", "bing.sites.list"], fixture.env);
    expect(bing.exitCode).toBe(0);
    expect(JSON.parse(bing.stdout)).toMatchObject({
      id: "bing.sites.list",
      provider: "bing",
      effects: ["read"],
    });

    const gsc = await runCli(["describe", "--id", "gsc.properties.list"], fixture.env);
    expect(gsc.exitCode).toBe(0);
    expect(JSON.parse(gsc.stdout)).toMatchObject({
      id: "gsc.properties.list",
      provider: "gsc",
      effects: ["read"],
    });
  });

  it("dry-runs Bing and GSC without resolving credentials or creating artifacts", async () => {
    const fixture = await createCliFixture();
    const bing = await runCli(
      [
        "--profile",
        "app-a",
        "bing",
        "api",
        "call",
        "--operation-id",
        "bing.traffic.rank",
        "--input",
        "{}",
        "--out",
        fixture.outPath,
        "--dry-run",
      ],
      fixture.env,
    );
    expect(bing.exitCode).toBe(0);
    expect(JSON.parse(bing.stdout)).toMatchObject({
      ok: true,
      data: {
        dryRun: true,
        requestPlan: {
          provider: "bing",
          diagnosticUrl: expect.not.stringContaining("apikey"),
        },
      },
      meta: { provider: "bing", cost: null, attemptId: null },
    });

    const gsc = await runCli(
      [
        "--profile",
        "app-a",
        "gsc",
        "api",
        "call",
        "--operation-id",
        "gsc.properties.list",
        "--input",
        "{}",
        "--out",
        fixture.outPath,
        "--dry-run",
      ],
      fixture.env,
    );
    expect(gsc.exitCode).toBe(0);
    expect(JSON.parse(gsc.stdout)).toMatchObject({
      ok: true,
      data: { dryRun: true, requestPlan: { provider: "gsc", method: "GET" } },
      meta: { provider: "gsc", cost: null, attemptId: null },
    });
    expect(await pathExists(fixture.outPath)).toBe(false);
    expect(await pathExists(fixture.ledgerPath)).toBe(false);
  });

  it("routes --allow-write from argv to the GSC effect gate for sitemap submission", async () => {
    const fixture = await createCliFixture();
    const submitArgs = [
      "--profile",
      "app-a",
      "gsc",
      "api",
      "call",
      "--operation-id",
      "gsc.sitemaps.submit",
      "--input",
      JSON.stringify({ feedpath: "https://example.com/sitemap.xml" }),
      "--out",
      fixture.outPath,
    ];

    const denied = await runMainHarness(
      submitArgs,
      fixture.env,
      "async () => { throw new Error('network must not be used'); }",
    ).result;
    expect(denied.exitCode).toBe(1);
    expect(JSON.parse(denied.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "EFFECT_NOT_ALLOWED",
        outcome: "not_dispatched",
        details: { reason: "missing_allow_write" },
      },
      meta: { capability: "gsc.sitemaps.submit", effects: ["write"] },
    });
    expect(await pathExists(fixture.outPath)).toBe(false);

    const planned = await runCli([...submitArgs, "--allow-write", "--dry-run"], fixture.env);
    expect(planned.exitCode).toBe(0);
    expect(JSON.parse(planned.stdout)).toMatchObject({
      ok: true,
      data: {
        dryRun: true,
        requestPlan: {
          provider: "gsc",
          capability: "gsc.sitemaps.submit",
          method: "PUT",
          endpoint:
            "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/sitemaps/https%3A%2F%2Fexample.com%2Fsitemap.xml",
        },
      },
    });
    expect(await pathExists(fixture.outPath)).toBe(false);
  });

  it("dry-runs and executes PostHog without touching the spend ledger", async () => {
    const fixture = await createCliFixture();
    const args = [
      "--profile",
      "app-a",
      "posthog",
      "api",
      "call",
      "--operation-id",
      "posthog.query.run",
      "--input",
      `@${fixture.posthogRequestPath}`,
      "--out",
      fixture.outPath,
    ];
    const dryRun = await runCli([...args, "--dry-run"], fixture.env);
    expect(dryRun.exitCode).toBe(0);
    expect(JSON.parse(dryRun.stdout)).toMatchObject({
      ok: true,
      data: { dryRun: true, requestPlan: { rowLimit: 10 } },
      meta: { provider: "posthog", cost: null, attemptId: null },
    });
    expect(await pathExists(fixture.outPath)).toBe(false);
    expect(await pathExists(fixture.ledgerPath)).toBe(false);

    const raw = JSON.stringify({ columns: ["event", "total"], results: [["$pageview", 4]] });
    const live = await runMainHarness(
      args,
      { ...fixture.env, TEST_POSTHOG_TOKEN: "phx_process_secret" },
      `async () => new Response(${JSON.stringify(raw)}, { status: 200, headers: { "x-posthog-request-id": "req_123" } })`,
    ).result;
    expect(live.exitCode).toBe(0);
    expect(live.stdout).not.toContain("phx_process_secret");
    expect(JSON.parse(live.stdout)).toMatchObject({
      ok: true,
      data: { rowCount: 1, columnCount: 2 },
      meta: { provider: "posthog", cost: null, attemptId: null, providerRequestId: "req_123" },
    });
    expect(await readFile(fixture.outPath, "utf8")).toBe(raw);
    expect(await pathExists(fixture.ledgerPath)).toBe(false);
  });

  it("emits exactly one JSON envelope and exits 1 for argv errors", async () => {
    const fixture = await createCliFixture();
    const result = await runCli(["unknown-command"], fixture.env);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", outcome: "not_dispatched" },
    });
  });

  it("requires a profile for provider execution", async () => {
    const fixture = await createCliFixture();
    const result = await runCli(
      [
        "dataforseo",
        "api",
        "call",
        "--operation-id",
        "dataforseo.backlinks.bulk_ranks.live",
        "--input",
        `@${fixture.requestPath}`,
        "--allow-spend",
        "--max-spend-usd",
        "0.05",
        "--out",
        fixture.outPath,
      ],
      fixture.env,
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "PROFILE_ERROR", outcome: "not_dispatched" },
    });
  });

  it("maps a corrupt ledger to LOCAL_IO_ERROR rather than INTERNAL_ERROR", async () => {
    const fixture = await createCliFixture();
    await mkdir(join(fixture.root, "state", "gkit"), { recursive: true });
    await writeFile(fixture.ledgerPath, "not-json\n");
    const result = await runCli(["ledger"], fixture.env);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "LOCAL_IO_ERROR", outcome: "not_dispatched" },
    });
  });

  it("keeps ledger status and manual reconciliation available without a provider manifest", async () => {
    const fixture = await createCliFixture();
    await authorizeIfUnblocked({
      ledgerPath: fixture.ledgerPath,
      authorization: {
        attemptId: "attempt-reconcile",
        profile: "app-a",
        provider: "dataforseo",
        capability: "dataforseo.backlinks.bulk_ranks.live",
        manifestRevision: "manifest-v1",
        costPolicyRevision: "dataforseo-backlinks-pricing-2026-07-14-v1",
        inputSha256: "f".repeat(64),
        maxCostMicros: 50_000,
        acknowledgement: {
          allowSpend: true,
          invocationMaxCostMicros: 50_000,
        },
      },
    });
    await appendSettled({
      ledgerPath: fixture.ledgerPath,
      settlement: {
        attemptId: "attempt-reconcile",
        outcome: "unknown",
        costMicros: null,
        providerRequestId: "task-reconcile",
      },
    });
    const missingManifest = join(fixture.root, "missing-manifest.json");

    const status = await runMainHarness(
      ["ledger"],
      fixture.env,
      "async () => { throw new Error('network must not be used'); }",
      { manifestPath: missingManifest },
    ).result;
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      ok: true,
      data: {
        unresolved: 1,
        activePolicyBreaches: null,
        manifestStatus: "unavailable",
      },
    });

    const reconciliation = await runMainHarness(
      [
        "ledger",
        "reconcile",
        "--attempt",
        "attempt-reconcile",
        "--outcome",
        "confirmed_charged",
        "--cost-usd",
        "0.060000",
        "--provider-request-id",
        "task-reconcile",
        "--evidence-ref",
        "provider-console:task-reconcile",
      ],
      fixture.env,
      "async () => { throw new Error('network must not be used'); }",
      { manifestPath: missingManifest },
    ).result;
    expect(reconciliation.exitCode).toBe(0);
    expect(JSON.parse(reconciliation.stdout)).toMatchObject({
      ok: true,
      data: {
        outcome: "confirmed_charged",
        costMicros: 60_000,
        policyBreach: true,
      },
    });

    const quarantined = await runCli(liveArgs(fixture), fixture.env);
    expect(quarantined.exitCode).toBe(1);
    expect(JSON.parse(quarantined.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "EFFECT_NOT_ALLOWED",
        details: { blockers: [{ reason: "policy_breach" }] },
      },
    });
    expect(await pathExists(fixture.outPath)).toBe(false);
  });

  it("dry-runs after spend gating without resolving secrets, writing ledger, or creating artifacts", async () => {
    const fixture = await createCliFixture();
    const result = await runCli(
      [
        "--profile",
        "app-a",
        "dataforseo",
        "api",
        "call",
        "--operation-id",
        "dataforseo.backlinks.bulk_ranks.live",
        "--input",
        `@${fixture.requestPath}`,
        "--allow-spend",
        "--max-spend-usd",
        "0.05",
        "--out",
        fixture.outPath,
        "--dry-run",
      ],
      fixture.env,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        dryRun: true,
        requestPlan: { targetCount: 2 },
        costUpperBound: { amount: "0.024072" },
      },
      meta: { profile: "app-a", attemptId: null },
    });
    expect(await pathExists(fixture.outPath)).toBe(false);
    expect(await pathExists(fixture.ledgerPath)).toBe(false);
  });

  it("keeps credentials out of stdout, stderr, artifacts, and the ledger on provider errors", async () => {
    const fixture = await createCliFixture();
    const login = "process-secret-login";
    const password = "process-secret-password";
    const providerPayload = {
      status_code: 20_000,
      cost: 0,
      tasks_count: 1,
      tasks_error: 1,
      tasks: [
        {
          id: providerTaskId,
          status_code: 40_204,
          cost: 0,
          status_message: `${login}:${password}`,
        },
      ],
    };
    const child = runMainHarness(
      liveArgs(fixture),
      {
        ...fixture.env,
        TEST_DATAFORSEO_LOGIN: login,
        TEST_DATAFORSEO_PASSWORD: password,
      },
      `async () => new Response(${JSON.stringify(JSON.stringify(providerPayload))}, { status: 200 })`,
    );
    const result = await child.result;

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(login);
    expect(result.stdout).not.toContain(password);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "LOCAL_IO_ERROR", outcome: "confirmed" },
      meta: {
        attemptId: expect.any(String),
        spendOutcome: "confirmed_not_charged",
        providerRequestId: providerTaskId,
        artifact: null,
      },
    });
    expect(await pathExists(fixture.outPath)).toBe(false);
    const ledger = await readFile(fixture.ledgerPath, "utf8");
    expect(ledger).not.toContain(login);
    expect(ledger).not.toContain(password);
  });

  it("redacts resolved credentials from doctor success and failure envelopes", async () => {
    const fixture = await createCliFixture();
    const secretMatchingProfile = "app-a";
    const success = await runCli(["--profile", "app-a", "dataforseo", "doctor"], {
      ...fixture.env,
      TEST_DATAFORSEO_LOGIN: "doctor-login",
      TEST_DATAFORSEO_PASSWORD: secretMatchingProfile,
    });
    expect(success.exitCode).toBe(0);
    expect(success.stdout).not.toContain(secretMatchingProfile);
    expect(JSON.parse(success.stdout)).toMatchObject({
      ok: true,
      meta: { profile: "[REDACTED]" },
    });

    await writeFile(
      fixture.profilePath,
      JSON.stringify({
        version: 1,
        name: "app-a",
        providers: {
          dataforseo: {
            config: { environment: "production" },
            policy: {},
            secrets: {
              login: "env:TEST_DATAFORSEO_LOGIN",
              password: "env:TEST_DATAFORSEO_PASSWORD",
            },
          },
        },
      }),
    );
    const failure = await runCli(["--profile", "app-a", "dataforseo", "doctor"], {
      ...fixture.env,
      TEST_DATAFORSEO_LOGIN: "doctor-login",
      TEST_DATAFORSEO_PASSWORD: secretMatchingProfile,
    });
    expect(failure.exitCode).toBe(1);
    expect(failure.stdout).not.toContain(secretMatchingProfile);
    expect(JSON.parse(failure.stdout)).toMatchObject({
      ok: false,
      error: { code: "PROFILE_ERROR" },
      meta: { profile: "[REDACTED]" },
    });
  });

  it("loads doctor credentials from the selected profile's adjacent .env", async () => {
    const fixture = await createCliFixture();
    const profileEnvironmentDirectory = join(dirname(fixture.profilePath), "app-a");
    await mkdir(profileEnvironmentDirectory, { recursive: true });
    await writeFile(
      join(profileEnvironmentDirectory, ".env"),
      [
        "TEST_DATAFORSEO_LOGIN=profile-login",
        "TEST_DATAFORSEO_PASSWORD=profile-password",
      ].join("\n"),
      { mode: 0o600 },
    );

    const result = await runCli(["--profile", "app-a", "dataforseo", "doctor"], fixture.env);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("profile-login");
    expect(result.stdout).not.toContain("profile-password");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        provider: "dataforseo",
        profileConfigured: true,
        secretsConfigured: true,
      },
    });
  });

  it("maps the first SIGINT through cleanup to one UNKNOWN_OUTCOME envelope and exit 130", async () => {
    const fixture = await createCliFixture();
    const args = liveArgs(fixture);
    const fetchStartedPath = join(fixture.root, "fetch-started.txt");
    const child = runMainHarness(
      args,
      {
        ...fixture.env,
        TEST_DATAFORSEO_LOGIN: "signal-login",
        TEST_DATAFORSEO_PASSWORD: "signal-password",
      },
      `async (_input, init) => {
        await Bun.write(${JSON.stringify(fetchStartedPath)}, "started");
        return await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }`,
    );
    await waitForText(fetchStartedPath, "started");
    child.process.kill("SIGINT");
    const result = await child.result;

    expect(result.exitCode).toBe(130);
    expect(result.stderr).toBe("");
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_OUTCOME", outcome: "unknown", retryable: false },
      meta: { spendOutcome: "unknown" },
    });
    const ledgerLines = (await readFile(fixture.ledgerPath, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; outcome?: string });
    expect(ledgerLines).toMatchObject([
      { type: "authorized" },
      { type: "settled", outcome: "unknown" },
    ]);
    expect((await readdir(fixture.root)).some((name) => name.endsWith(".lock"))).toBe(false);
  });

  it("treats a second SIGINT as the documented one-envelope exception", async () => {
    const fixture = await createCliFixture();
    const fetchStartedPath = join(fixture.root, "fetch-started.txt");
    const child = runMainHarness(
      liveArgs(fixture),
      {
        ...fixture.env,
        TEST_DATAFORSEO_LOGIN: "signal-login",
        TEST_DATAFORSEO_PASSWORD: "signal-password",
      },
      `async () => {
        await Bun.write(${JSON.stringify(fetchStartedPath)}, "started");
        return await new Promise(() => undefined);
      }`,
    );
    await waitForText(fetchStartedPath, "started");
    child.process.kill("SIGINT");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
    child.process.kill("SIGINT");
    const result = await child.result;

    expect(result.exitCode).toBe(130);
    expect(result.stdout).toBe("");
    const ledgerLines = (await readFile(fixture.ledgerPath, "utf8")).trimEnd().split("\n");
    expect(ledgerLines).toHaveLength(1);
    expect(JSON.parse(ledgerLines[0]!)).toMatchObject({ type: "authorized" });
  });
});

async function createCliFixture() {
  const root = await mkdtemp(join(tmpdir(), "gkit-cli-test-"));
  temporaryDirectories.push(root);
  const configHome = join(root, "config");
  const stateHome = join(root, "state");
  const profiles = join(configHome, "gkit", "profiles");
  await mkdir(profiles, { recursive: true });
  await writeFile(
    join(profiles, "app-a.json"),
    JSON.stringify({
      version: 1,
      name: "app-a",
      providers: {
        dataforseo: {
          config: { environment: "production" },
          policy: { maxSpendUsdPerCall: "0.10" },
          secrets: {
            login: "env:TEST_DATAFORSEO_LOGIN",
            password: "env:TEST_DATAFORSEO_PASSWORD",
          },
        },
        posthog: {
          config: { host: "https://us.posthog.com", projectId: "12345" },
          policy: {},
          secrets: { apiToken: "env:TEST_POSTHOG_TOKEN" },
        },
        bing: {
          config: { siteUrl: "https://example.com/" },
          policy: {},
          secrets: { apiKey: "env:TEST_BING_API_KEY" },
        },
        gsc: {
          config: { siteUrl: "sc-domain:example.com" },
          policy: {},
          secrets: { serviceAccountFile: "env:TEST_GSC_SERVICE_ACCOUNT_FILE" },
        },
        hubspot: {
          config: {},
          policy: {},
          secrets: { accessToken: "env:TEST_HUBSPOT_ACCESS_TOKEN" },
        },
      },
    }),
  );
  const requestPath = join(root, "request.json");
  await writeFile(
    requestPath,
    JSON.stringify({
      targets: ["clonesite.ai", "example.com"],
      rank_scale: "one_hundred",
    }),
  );
  const posthogRequestPath = join(root, "posthog-request.json");
  await writeFile(
    posthogRequestPath,
    JSON.stringify({
      query: "SELECT event, count() AS total FROM events GROUP BY event ORDER BY total DESC",
      limit: 10,
    }),
  );
  return {
    root,
    requestPath,
    posthogRequestPath,
    outPath: join(root, "result.json"),
    ledgerPath: join(stateHome, "gkit", "ledger.jsonl"),
    profilePath: join(profiles, "app-a.json"),
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      XDG_CONFIG_HOME: configHome,
      XDG_STATE_HOME: stateHome,
    },
  };
}

async function runCli(
  args: string[],
  env: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = spawn("bun", [cliPath, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code) => resolveExit(code ?? -1));
  });
  return { exitCode, stdout, stderr };
}

function liveArgs(fixture: Awaited<ReturnType<typeof createCliFixture>>): string[] {
  return [
    "--profile",
    "app-a",
    "dataforseo",
    "api",
    "call",
    "--operation-id",
    "dataforseo.backlinks.bulk_ranks.live",
    "--input",
    `@${fixture.requestPath}`,
    "--allow-spend",
    "--max-spend-usd",
    "0.05",
    "--out",
    fixture.outPath,
  ];
}

function runMainHarness(
  args: string[],
  env: Record<string, string>,
  fetchImplementation: string,
  mainOptions: { manifestPath?: string } = {},
): {
  process: ChildProcessWithoutNullStreams;
  result: Promise<{ exitCode: number; stdout: string; stderr: string }>;
} {
  const cliUrl = new URL("./cli.ts", import.meta.url).href;
  const script = [
    `globalThis.fetch = ${fetchImplementation};`,
    `const { main } = await import(${JSON.stringify(cliUrl)});`,
    `await main(${JSON.stringify(args)}, ${JSON.stringify(mainOptions)});`,
  ].join("\n");
  const child = spawn("bun", ["-e", script], { env });
  child.stdin.end();
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const result = new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolveResult, rejectResult) => {
      child.once("error", rejectResult);
      child.once("exit", (code) => {
        resolveResult({ exitCode: code ?? -1, stdout, stderr });
      });
    },
  );
  return { process: child, result };
}

async function waitForText(path: string, expected: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(path, "utf8")).includes(expected)) return;
    } catch {
      // The durable authorization file has not been created yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`Timed out waiting for ${expected}.`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
