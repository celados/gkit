import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ParsedCommand } from "./args";
import { reserveArtifactDestination } from "./artifact";
import { executeDataForSeoCall } from "./execute";
import { JournalError, readJournal, recordArtifact, settleAttempt, startAttempt } from "./journal";
import { compileExecutableManifest, loadExecutableManifest } from "./manifest";
import { resolveProviderSecrets } from "./profile";
import type { DataForSeoDispatchResult } from "./providers/dataforseo";

const temporaryDirectories: string[] = [];
const manifestPath = new URL("../generated/dataforseo/manifest.json", import.meta.url).pathname;
const providerTaskId = "10131644-1535-0347-0000-750206cf57d8";
const createdTaskId = "10131644-1535-0347-0000-750206cf57d9";
const credentialShapedTaskId = "10131644-1535-0347-0000-750206cf57da";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("DataForSEO execution pipeline", () => {
  it("blocks effect before secret resolution, adapter load, authorization, or transport", async () => {
    const fixture = await createFixture();
    const resolveSecrets = vi.fn(resolveProviderSecrets);
    const loadAdapter = vi.fn(async () => adapter(successResult(24_072)));
    const authorize = vi.fn();

    const result = await executeDataForSeoCall({
      command: callCommand(fixture, { allowSpend: false }),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: {},
      dependencies: {
        resolveProviderSecrets: resolveSecrets,
        loadDataForSeoAdapter: loadAdapter,
        startAttempt: authorize as never,
      },
    });

    expect(result.envelope).toMatchObject({
      ok: false,
      error: { code: "EFFECT_NOT_ALLOWED", outcome: "not_dispatched" },
      meta: {
        operationId: null,
        spend: null,
        providerRequestId: null,
      },
    });
    expect(resolveSecrets).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(loadAdapter).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(1);
  });

  it("prefers --profile and dry-runs after the gate without secrets, journal writes, artifact locks, or adapters", async () => {
    const fixture = await createFixture();
    const resolveSecrets = vi.fn(resolveProviderSecrets);
    const loadAdapter = vi.fn(async () => adapter(successResult(24_072)));
    const authorize = vi.fn();
    const reserve = vi.fn();

    const result = await executeDataForSeoCall({
      command: callCommand(fixture, { dryRun: true }),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: { GKIT_PROFILE: "other-app" },
      dependencies: {
        resolveProviderSecrets: resolveSecrets,
        loadDataForSeoAdapter: loadAdapter,
        startAttempt: authorize as never,
        reserveArtifactDestination: reserve as never,
      },
    });

    expect(result.envelope).toMatchObject({
      ok: true,
      data: {
        dryRun: true,
        requestPlan: { environment: "production", targetCount: 2 },
        costUpperBound: { amount: "0.024072" },
      },
      meta: { profile: "app-a" },
    });
    expect(resolveSecrets).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(loadAdapter).not.toHaveBeenCalled();
  });

  it("returns CANCELLED/130 for an already-aborted dry-run without touching local or provider effects", async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    controller.abort(new Error("SIGINT"));
    const reserve = vi.fn();
    const authorize = vi.fn();
    const loadAdapter = vi.fn();

    const result = await executeDataForSeoCall({
      command: callCommand(fixture, { dryRun: true }),
      manifest: fixture.manifest,
      signal: controller.signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: {
        reserveArtifactDestination: reserve as never,
        startAttempt: authorize as never,
        loadDataForSeoAdapter: loadAdapter as never,
      },
    });

    expect(result.envelope).toMatchObject({
      ok: false,
      error: { code: "CANCELLED", outcome: "not_dispatched" },
      meta: { operationId: null, spend: null },
    });
    expect(result.exitCode).toBe(130);
    expect(reserve).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(loadAdapter).not.toHaveBeenCalled();
  });

  it("normalizes a signal arriving during pre-dispatch local I/O to CANCELLED/130", async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    const authorize = vi.fn();
    const loadAdapter = vi.fn();

    const result = await executeDataForSeoCall({
      command: callCommand(fixture),
      manifest: fixture.manifest,
      signal: controller.signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: {
        getSpendBlockers: async () => {
          controller.abort(new Error("SIGINT"));
          throw new Error("simulated interrupted lock wait");
        },
        startAttempt: authorize as never,
        loadDataForSeoAdapter: loadAdapter as never,
      },
    });

    expect(result.envelope).toMatchObject({
      ok: false,
      error: { code: "CANCELLED", outcome: "not_dispatched" },
      meta: { operationId: null, spend: null },
    });
    expect(result.exitCode).toBe(130);
    expect(authorize).not.toHaveBeenCalled();
    expect(loadAdapter).not.toHaveBeenCalled();
  });

  it("fails missing secrets before adapter load or transport", async () => {
    const fixture = await createFixture();
    const loadAdapter = vi.fn(async () => adapter(successResult(24_072)));

    const result = await executeDataForSeoCall({
      command: callCommand(fixture),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: {},
      dependencies: { loadDataForSeoAdapter: loadAdapter },
    });

    expect(result.envelope).toMatchObject({
      ok: false,
      error: { code: "PROFILE_ERROR", outcome: "not_dispatched" },
    });
    expect(loadAdapter).not.toHaveBeenCalled();
    expect((await readJournal({ journalPath: fixture.journalPath })).events).toEqual([]);
  });

  it("routes from the selected manifest adapter key and rejects an unavailable key before secrets", async () => {
    const fixture = await createFixture();
    const document = JSON.parse(JSON.stringify(fixture.manifest.document)) as {
      capabilities: Array<{ id: string; adapterKey: string }>;
    };
    const selectedCapability = document.capabilities.find(
      (capability) => capability.id === "dataforseo.backlinks.bulk_ranks.live",
    );
    expect(selectedCapability).toBeDefined();
    selectedCapability!.adapterKey = "backlinks.unreviewed.live";
    const manifest = compileExecutableManifest(document);
    const resolveSecrets = vi.fn(resolveProviderSecrets);
    const loadAdapter = vi.fn(async () => adapter(successResult(24_072)));

    const result = await executeDataForSeoCall({
      command: callCommand(fixture, { dryRun: true }),
      manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: {
        resolveProviderSecrets: resolveSecrets,
        loadDataForSeoAdapter: loadAdapter,
      },
    });

    expect(result.envelope).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR", outcome: "not_dispatched" },
    });
    expect(resolveSecrets).not.toHaveBeenCalled();
    expect(loadAdapter).not.toHaveBeenCalled();
  });

  it("durably starts the attempt before dispatch, settles provider facts before publishing exact raw bytes", async () => {
    const fixture = await createFixture();
    const events: string[] = [];
    const loadAdapter = vi.fn(async () => {
      events.push("adapter-loaded");
      return adapter(successResult(24_072), () => events.push("transport"));
    });

    const result = await executeDataForSeoCall({
      command: callCommand(fixture),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: {
        loadDataForSeoAdapter: loadAdapter,
        reserveArtifactDestination: async (options) => {
          const reservation = await reserveArtifactDestination(options);
          return {
            path: reservation.path,
            force: reservation.force,
            publish: async (publication) => {
              events.push("artifact-published");
              return await reservation.publish(publication);
            },
            release: async () => await reservation.release(),
          };
        },
        startAttempt: async (options) => {
          const started = await startAttempt(options);
          events.push("started");
          return started;
        },
        settleAttempt: async (options) => {
          const settlement = await settleAttempt(options);
          events.push("settled");
          return settlement;
        },
        recordArtifact: async (options) => {
          const recorded = await recordArtifact(options);
          events.push("artifact-recorded");
          return recorded;
        },
      },
    });

    expect(events).toEqual([
      "started",
      "adapter-loaded",
      "transport",
      "settled",
      "artifact-published",
      "artifact-recorded",
    ]);
    expect(result.envelope).toMatchObject({
      ok: true,
      data: { itemsCount: 2, artifact: { bytes: 21 } },
      meta: {
        operationId: expect.any(String),
        spend: {
          outcome: "confirmed_charged",
          cost: { amount: "0.024072", currency: "USD" },
        },
        providerRequestId: providerTaskId,
      },
    });
    if (result.envelope.ok) {
      expect(result.envelope.meta.artifact?.path).toBe(await realpath(fixture.outPath));
    }
    expect(await readFile(fixture.outPath, "utf8")).toBe('{"provider":"result"}');
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.events.map((event) => event.type)).toEqual([
      "attempt_started",
      "attempt_settled",
      "artifact_recorded",
    ]);
    const operation = journal.operations[0];
    expect(operation?.started).toMatchObject({
      operationId: result.envelope.meta?.operationId,
      provider: "dataforseo",
      capability: "dataforseo.backlinks.bulk_ranks.live",
      effects: ["read", "spend"],
      spend: { maxCostMicros: 24_072, invocationMaxCostMicros: 50_000, currency: "USD" },
    });
    expect(operation?.latestSettlement).toMatchObject({
      providerResult: "succeeded",
      errorCode: null,
      providerRequestId: providerTaskId,
      source: "automatic",
      spend: { outcome: "confirmed_charged", costMicros: 24_072, policyBreach: false },
    });
    expect(operation?.artifact).toMatchObject({ bytes: 21, path: await realpath(fixture.outPath) });
    expect(operation?.state).toBe("succeeded");
  });

  it("settles a policy breach, fails non-retryably, and quarantines that policy revision", async () => {
    const fixture = await createFixture();
    const first = await executeDataForSeoCall({
      command: callCommand(fixture),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: {
        loadDataForSeoAdapter: async () => adapter(successResult(60_000)),
      },
    });
    expect(first.envelope).toMatchObject({
      ok: false,
      error: {
        code: "SPEND_POLICY_BREACH",
        retryable: false,
        outcome: "confirmed",
      },
      meta: { spend: { outcome: "confirmed_charged", cost: { amount: "0.060000" } } },
    });

    const secondFixture = { ...fixture, outPath: join(fixture.root, "second.json") };
    const resolveSecrets = vi.fn(resolveProviderSecrets);
    const second = await executeDataForSeoCall({
      command: callCommand(secondFixture),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: {
        resolveProviderSecrets: resolveSecrets,
        loadDataForSeoAdapter: async () => adapter(successResult(24_072)),
      },
    });
    expect(second.envelope).toMatchObject({
      ok: false,
      error: {
        code: "EFFECT_NOT_ALLOWED",
        details: { blockers: [{ reason: "policy_breach", operationId: first.envelope.meta?.operationId }] },
      },
    });
    expect(resolveSecrets).not.toHaveBeenCalled();
  });

  it("reports a settled policy breach even when raw artifact publication also fails", async () => {
    const fixture = await createFixture();
    const result = await executeDataForSeoCall({
      command: callCommand(fixture),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: {
        loadDataForSeoAdapter: async () =>
          adapter({
            ...successResult(60_000),
            rawBytes: Buffer.from('{"echo":"super-secret-password"}', "utf8"),
          }),
      },
    });

    expect(result.envelope).toMatchObject({
      ok: false,
      error: {
        code: "SPEND_POLICY_BREACH",
        outcome: "confirmed",
        details: { artifactPublication: "failed" },
      },
      meta: {
        spend: { outcome: "confirmed_charged" },
        artifact: null,
      },
    });
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.operations[0]?.latestSettlement?.spend?.policyBreach).toBe(true);
    expect(journal.operations[0]?.artifact).toBeNull();
    expect(journal.operations[0]?.state).toBe("failed");
    await expect(readFile(fixture.outPath, "utf8")).rejects.toThrow();
  });

  it("records unknown post-dispatch outcomes and blocks the same input before secrets", async () => {
    const fixture = await createFixture();
    const unknown: DataForSeoDispatchResult = {
      ok: false,
      code: "TIMEOUT",
      message: "The provider timed out with an unknown outcome.",
      retryable: false,
      outcome: "unknown",
      details: null,
      rawBytes: null,
      providerRequestId: null,
      costMicros: null,
      costIsConfirmed: false,
    };
    const first = await executeDataForSeoCall({
      command: callCommand(fixture),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: { loadDataForSeoAdapter: async () => adapter(unknown) },
    });
    expect(first.envelope).toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_OUTCOME", retryable: false, outcome: "unknown" },
      meta: { spend: { outcome: "unknown", cost: null } },
    });
    const afterFirst = await readJournal({ journalPath: fixture.journalPath });
    expect(afterFirst.operations[0]?.latestSettlement).toMatchObject({
      providerResult: "unknown",
      errorCode: "TIMEOUT",
      spend: { outcome: "unknown", costMicros: null, policyBreach: false },
    });
    expect(afterFirst.operations[0]?.state).toBe("unknown");

    const next = { ...fixture, outPath: join(fixture.root, "next.json") };
    const resolveSecrets = vi.fn(resolveProviderSecrets);
    const second = await executeDataForSeoCall({
      command: callCommand(next),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: { resolveProviderSecrets: resolveSecrets },
    });
    expect(second.envelope).toMatchObject({
      ok: false,
      error: {
        code: "EFFECT_NOT_ALLOWED",
        details: { blockers: [{ reason: "unknown_outcome", operationId: first.envelope.meta?.operationId }] },
      },
    });
    expect(resolveSecrets).not.toHaveBeenCalled();
  });

  it("keeps an unknown provider outcome unknown when its known cost also breaches policy", async () => {
    const fixture = await createFixture();
    const result = await executeDataForSeoCall({
      command: callCommand(fixture),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: {
        loadDataForSeoAdapter: async () =>
          adapter({
            ok: false,
            code: "UNKNOWN_OUTCOME",
            message: "The provider task was accepted but did not reach a terminal status.",
            retryable: false,
            outcome: "unknown",
            details: null,
            rawBytes: Buffer.from('{"status_code":20100}', "utf8"),
            providerRequestId: createdTaskId,
            costMicros: 60_000,
            costIsConfirmed: true,
          }),
      },
    });

    expect(result.envelope).toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_OUTCOME", outcome: "unknown" },
      meta: {
        spend: { outcome: "unknown", cost: { amount: "0.060000" } },
        providerRequestId: createdTaskId,
      },
    });
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.operations[0]?.latestSettlement).toMatchObject({
      providerResult: "unknown",
      spend: { outcome: "unknown", costMicros: 60_000, policyBreach: true },
    });
    expect(journal.operations[0]?.state).toBe("unknown");
  });

  it("uses the conservative observed cost and unknown spend state when provider cost fields disagree", async () => {
    const fixture = await createFixture();
    const result = await executeDataForSeoCall({
      command: callCommand(fixture),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: {
        loadDataForSeoAdapter: async () =>
          adapter({
            ok: false,
            code: "PROVIDER_ERROR",
            message: "The provider cost fields were inconsistent.",
            retryable: false,
            outcome: "confirmed",
            details: { contract: "dataforseo_cost_unconfirmed" },
            rawBytes: Buffer.from('{"cost":1.024}', "utf8"),
            providerRequestId: providerTaskId,
            costMicros: 1_024_000,
            costIsConfirmed: false,
          }),
      },
    });

    expect(result.envelope).toMatchObject({
      ok: false,
      error: {
        code: "SPEND_POLICY_BREACH",
        outcome: "confirmed",
        hint: expect.stringContaining("Reconcile"),
      },
      meta: {
        spend: { outcome: "unknown", cost: { amount: "1.024000" } },
      },
    });
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.operations[0]?.latestSettlement).toMatchObject({
      providerResult: "failed",
      errorCode: "PROVIDER_ERROR",
      spend: { outcome: "unknown", costMicros: 1_024_000, policyBreach: true },
    });
  });

  it("keeps confirmed provider failures correlated with complete spend metadata", async () => {
    for (const code of ["AUTH_FAILED", "RATE_LIMITED", "PROVIDER_ERROR"] as const) {
      const fixture = await createFixture();
      const providerResult: DataForSeoDispatchResult = {
        ok: false,
        code,
        message: "The provider rejected the request.",
        retryable: false,
        outcome: "confirmed",
        details: { httpStatus: code === "RATE_LIMITED" ? 429 : 401 },
        rawBytes: Buffer.from(JSON.stringify({ code }), "utf8"),
        providerRequestId: providerTaskId,
        costMicros: 0,
        costIsConfirmed: true,
      };
      const result = await executeDataForSeoCall({
        command: callCommand(fixture),
        manifest: fixture.manifest,
        signal: new AbortController().signal,
        xdgConfigHome: fixture.configHome,
        journalPath: fixture.journalPath,
        env: secretEnvironment(),
        dependencies: {
          loadDataForSeoAdapter: async () => adapter(providerResult),
        },
      });

      expect(result.envelope).toMatchObject({
        ok: false,
        error: { code, outcome: "confirmed", retryable: false },
        meta: {
          operationId: expect.any(String),
          spend: { outcome: "confirmed_not_charged", cost: { amount: "0.000000" } },
          providerRequestId: providerTaskId,
        },
      });
      const journal = await readJournal({ journalPath: fixture.journalPath });
      expect(journal.operations[0]?.latestSettlement).toMatchObject({
        providerResult: "failed",
        errorCode: code,
        spend: { outcome: "confirmed_not_charged", costMicros: 0 },
      });
      expect(journal.operations[0]?.state).toBe("failed");
    }
  });

  it("never persists a provider-controlled request ID that matches a resolved secret", async () => {
    const fixture = await createFixture();
    const result = await executeDataForSeoCall({
      command: callCommand(fixture),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: {
        TEST_DATAFORSEO_LOGIN: "account@example.com",
        TEST_DATAFORSEO_PASSWORD: credentialShapedTaskId,
      },
      dependencies: {
        loadDataForSeoAdapter: async () =>
          adapter({
            ok: true,
            rawBytes: Buffer.from(JSON.stringify({ id: credentialShapedTaskId }), "utf8"),
            providerRequestId: credentialShapedTaskId,
            costMicros: 24_072,
            costIsConfirmed: true,
            data: { itemsCount: 2 },
          }),
      },
    });

    expect(result.envelope).toMatchObject({
      ok: false,
      error: { code: "LOCAL_IO_ERROR", outcome: "confirmed" },
      meta: { providerRequestId: null, spend: { outcome: "confirmed_charged" } },
    });
    expect(await readFile(fixture.journalPath, "utf8")).not.toContain(credentialShapedTaskId);
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.operations[0]?.latestSettlement?.providerRequestId).toBeNull();
  });

  it("exits 130 when SIGINT arrives after durable settlement but before publication completes", async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    const result = await executeDataForSeoCall({
      command: callCommand(fixture),
      manifest: fixture.manifest,
      signal: controller.signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: {
        loadDataForSeoAdapter: async () => adapter(successResult(24_072)),
        settleAttempt: async (options) => {
          const settlement = await settleAttempt(options);
          controller.abort(new Error("SIGINT"));
          return settlement;
        },
      },
    });

    expect(result.envelope).toMatchObject({ ok: true });
    expect(result.exitCode).toBe(130);
    expect(await readFile(fixture.outPath, "utf8")).toBe('{"provider":"result"}');
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.operations[0]?.state).toBe("succeeded");
  });

  it("settles a cancellation after the durable start as not_dispatched and not charged", async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    const loadAdapter = vi.fn(async () => adapter(successResult(24_072)));
    const result = await executeDataForSeoCall({
      command: callCommand(fixture),
      manifest: fixture.manifest,
      signal: controller.signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: {
        loadDataForSeoAdapter: loadAdapter,
        startAttempt: async (options) => {
          const event = await startAttempt(options);
          controller.abort(new Error("SIGINT"));
          return event;
        },
      },
    });

    expect(result.exitCode).toBe(130);
    expect(result.envelope).toMatchObject({
      ok: false,
      error: { code: "CANCELLED", outcome: "not_dispatched" },
      meta: {
        operationId: expect.any(String),
        spend: { outcome: "confirmed_not_charged", cost: { amount: "0.000000" } },
      },
    });
    expect(loadAdapter).not.toHaveBeenCalled();
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.events.map((event) => event.type)).toEqual([
      "attempt_started",
      "attempt_settled",
    ]);
    expect(journal.operations[0]?.latestSettlement).toMatchObject({
      providerResult: "not_dispatched",
      errorCode: "CANCELLED",
      spend: { outcome: "confirmed_not_charged", costMicros: 0, policyBreach: false },
    });
    expect(journal.operations[0]?.state).toBe("not_dispatched");
  });

  it("preserves LOCAL_IO_ERROR when SIGINT is followed by a failed pre-dispatch settlement", async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    const result = await executeDataForSeoCall({
      command: callCommand(fixture),
      manifest: fixture.manifest,
      signal: controller.signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: {
        startAttempt: async (options) => {
          const event = await startAttempt(options);
          controller.abort(new Error("SIGINT"));
          return event;
        },
        settleAttempt: async () => {
          throw new JournalError(
            "JOURNAL_IO_ERROR",
            "simulated settlement fsync failure",
            fixture.journalPath,
          );
        },
      },
    });

    expect(result.exitCode).toBe(130);
    expect(result.envelope).toMatchObject({
      ok: false,
      error: {
        code: "LOCAL_IO_ERROR",
        outcome: "not_dispatched",
        hint: expect.stringContaining("gkit operations"),
      },
      meta: { operationId: expect.any(String) },
    });
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.events.map((event) => event.type)).toEqual(["attempt_started"]);
    expect(journal.operations[0]?.state).toBe("unknown");
  });

  it("returns confirmed LOCAL_IO_ERROR with artifact receipt when settlement append fails", async () => {
    const fixture = await createFixture();
    const result = await executeDataForSeoCall({
      command: callCommand(fixture),
      manifest: fixture.manifest,
      signal: new AbortController().signal,
      xdgConfigHome: fixture.configHome,
      journalPath: fixture.journalPath,
      env: secretEnvironment(),
      dependencies: {
        loadDataForSeoAdapter: async () => adapter(successResult(24_072)),
        settleAttempt: async () => {
          throw new Error("simulated fsync failure");
        },
      },
    });

    expect(result.envelope).toMatchObject({
      ok: false,
      error: {
        code: "LOCAL_IO_ERROR",
        retryable: false,
        outcome: "confirmed",
      },
      meta: {
        artifact: { bytes: 21 },
        spend: { outcome: "confirmed_charged" },
      },
    });
    const journal = await readJournal({ journalPath: fixture.journalPath });
    expect(journal.events.map((event) => event.type)).toEqual(["attempt_started"]);
    expect(await readFile(fixture.outPath, "utf8")).toBe('{"provider":"result"}');
  });
});

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "gkit-execute-test-"));
  temporaryDirectories.push(root);
  const configHome = join(root, "config");
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
  return {
    root,
    configHome,
    requestPath,
    outPath: join(root, "result.json"),
    journalPath: join(root, "state", "gkit", "operations.jsonl"),
    manifest: await loadExecutableManifest(manifestPath),
  };
}

function callCommand(
  fixture: Fixture,
  overrides: Partial<Extract<ParsedCommand, { kind: "dataforseo-call" }>> = {},
): Extract<ParsedCommand, { kind: "dataforseo-call" }> {
  return {
    kind: "dataforseo-call",
    profileFlag: "app-a",
    capabilityId: "dataforseo.backlinks.bulk_ranks.live",
    input: `@${fixture.requestPath}`,
    allowSpend: true,
    maxSpendUsd: "0.05",
    out: fixture.outPath,
    force: false,
    dryRun: false,
    ...overrides,
  };
}

function secretEnvironment(): Readonly<Record<string, string>> {
  return {
    TEST_DATAFORSEO_LOGIN: "account@example.com",
    TEST_DATAFORSEO_PASSWORD: "super-secret-password",
  };
}

function successResult(costMicros: number): DataForSeoDispatchResult {
  return {
    ok: true,
    rawBytes: Buffer.from('{"provider":"result"}', "utf8"),
    providerRequestId: providerTaskId,
    costMicros,
    costIsConfirmed: true,
    data: { itemsCount: 2 },
  };
}

function adapter(result: DataForSeoDispatchResult, onDispatch: () => void = () => undefined) {
  return {
    dispatchDataForSeo: async () => {
      onDispatch();
      return result;
    },
  };
}
