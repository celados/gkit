import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  JournalError,
  SpendBlockedError,
  defaultJournalPath,
  getSpendBlockers,
  readJournal,
  recordArtifact,
  settleAttempt,
  startAttempt,
  type StartAttemptInput,
} from "./journal";

const temporaryDirectories: string[] = [];
const artifact = { path: "/tmp/gkit-artifact.json", bytes: 12, sha256: "f".repeat(64) };

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("operation journal", () => {
  it("uses absolute XDG/HOME locations and rejects relative state roots", () => {
    expect(defaultJournalPath({ XDG_STATE_HOME: "/tmp/gkit-state" })).toBe(
      "/tmp/gkit-state/gkit/operations.jsonl",
    );
    expect(defaultJournalPath({ HOME: "/tmp/gkit-home" })).toBe(
      "/tmp/gkit-home/.local/state/gkit/operations.jsonl",
    );
    expect(() => defaultJournalPath({ XDG_STATE_HOME: "relative-state" })).toThrow(JournalError);
    expect(() => defaultJournalPath({ HOME: "relative-home" })).toThrow(JournalError);
  });

  it("projects closed states and requires durable evidence for success", async () => {
    const journalPath = await temporaryJournalPath();
    await startAttempt({ journalPath, attempt: costFree("read-ok") });
    await startAttempt({ journalPath, attempt: costFree("read-no-artifact") });
    await startAttempt({ journalPath, attempt: costFree("read-failed") });
    await startAttempt({ journalPath, attempt: costFree("read-lost") });

    await settleAttempt({ journalPath, settlement: { operationId: "read-ok", providerResult: "succeeded" } });
    await recordArtifact({ journalPath, operationId: "read-ok", artifact });
    await settleAttempt({
      journalPath,
      settlement: { operationId: "read-no-artifact", providerResult: "succeeded" },
    });
    await settleAttempt({
      journalPath,
      settlement: { operationId: "read-failed", providerResult: "failed", errorCode: "AUTH_FAILED" },
    });

    const snapshot = await readJournal({ journalPath });
    expect(Object.fromEntries(snapshot.operations.map((record) => [record.started.operationId, record.state]))).toEqual({
      "read-ok": "succeeded",
      "read-no-artifact": "failed",
      "read-failed": "failed",
      "read-lost": "unknown",
    });
    expect(snapshot.operations[0]?.artifact).toEqual(artifact);
    expect((await stat(journalPath)).mode & 0o777).toBe(0o600);
  });

  it("rejects duplicate starts, settlements before a start, and reopened confirmed results", async () => {
    const journalPath = await temporaryJournalPath();
    await startAttempt({ journalPath, attempt: costFree("op-1") });
    await expect(startAttempt({ journalPath, attempt: costFree("op-1") })).rejects.toMatchObject({
      code: "OPERATION_ALREADY_STARTED",
    });
    await expect(
      settleAttempt({ journalPath, settlement: { operationId: "missing", providerResult: "failed" } }),
    ).rejects.toMatchObject({ code: "OPERATION_NOT_STARTED" });
    await expect(
      recordArtifact({ journalPath, operationId: "op-1", artifact }),
    ).rejects.toMatchObject({ code: "INVALID_JOURNAL_EVENT" });

    await settleAttempt({ journalPath, settlement: { operationId: "op-1", providerResult: "failed" } });
    await expect(
      settleAttempt({
        journalPath,
        settlement: {
          operationId: "op-1",
          providerResult: "succeeded",
          source: "manual",
          evidenceRef: "console:1",
        },
      }),
    ).rejects.toMatchObject({ code: "OPERATION_ALREADY_SETTLED" });
  });

  it("reconciles an unknown cost-free result only with manual evidence", async () => {
    const journalPath = await temporaryJournalPath();
    await startAttempt({ journalPath, attempt: costFree("write-1", ["write"]) });
    await settleAttempt({ journalPath, settlement: { operationId: "write-1", providerResult: "unknown" } });

    await expect(
      settleAttempt({ journalPath, settlement: { operationId: "write-1", providerResult: "succeeded" } }),
    ).rejects.toMatchObject({ code: "INVALID_JOURNAL_EVENT" });
    await expect(
      settleAttempt({
        journalPath,
        settlement: { operationId: "write-1", providerResult: "unknown", source: "manual", evidenceRef: "x" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_JOURNAL_EVENT" });

    await settleAttempt({
      journalPath,
      settlement: {
        operationId: "write-1",
        providerResult: "failed",
        errorCode: "PROVIDER_ERROR",
        source: "manual",
        evidenceRef: "gsc-console:sitemaps",
      },
    });
    const [record] = (await readJournal({ journalPath })).operations;
    expect(record).toMatchObject({ state: "failed", latestSettlement: { source: "manual" } });
  });

  it("requires spend facts exactly when the operation authorized spend", async () => {
    const journalPath = await temporaryJournalPath();
    await expect(
      startAttempt({ journalPath, attempt: { ...costFree("bad"), effects: ["spend"] } }),
    ).rejects.toMatchObject({ code: "INVALID_JOURNAL_EVENT" });

    await startAttempt({ journalPath, attempt: spendAttempt("spend-1", "a".repeat(64)) });
    await expect(
      settleAttempt({ journalPath, settlement: { operationId: "spend-1", providerResult: "succeeded" } }),
    ).rejects.toMatchObject({ code: "INVALID_JOURNAL_EVENT" });
    await expect(
      settleAttempt({
        journalPath,
        settlement: {
          operationId: "spend-1",
          providerResult: "not_dispatched",
          spend: { outcome: "unknown", costMicros: null },
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_JOURNAL_EVENT" });
  });

  it("blocks an unsettled or unknown same-input spend until evidence-backed reconciliation", async () => {
    const journalPath = await temporaryJournalPath();
    const inputSha256 = "a".repeat(64);
    await startAttempt({ journalPath, attempt: spendAttempt("op-1", inputSha256) });

    expect(await blockersFor(journalPath, inputSha256)).toMatchObject([
      { reason: "unsettled_attempt", operationId: "op-1" },
    ]);
    await expectSpendBlocked(
      startAttempt({ journalPath, attempt: spendAttempt("op-2", inputSha256) }),
      "unsettled_attempt",
    );

    await settleAttempt({
      journalPath,
      settlement: {
        operationId: "op-1",
        providerResult: "succeeded",
        providerRequestId: "task-1",
        spend: { outcome: "unknown", costMicros: null },
      },
    });
    expect(await blockersFor(journalPath, inputSha256)).toMatchObject([
      { reason: "unknown_outcome", operationId: "op-1" },
    ]);

    await settleAttempt({
      journalPath,
      settlement: {
        operationId: "op-1",
        providerResult: "succeeded",
        providerRequestId: "task-1",
        spend: { outcome: "confirmed_not_charged", costMicros: 0 },
        source: "manual",
        evidenceRef: "provider-console:task-1",
      },
    });
    expect(await blockersFor(journalPath, inputSha256)).toEqual([]);

    const next = await startAttempt({ journalPath, attempt: spendAttempt("op-2", inputSha256) });
    expect(next.type).toBe("attempt_started");
  });

  it("does not let cost-free operations block spend", async () => {
    const journalPath = await temporaryJournalPath();
    await startAttempt({ journalPath, attempt: { ...costFree("read-1"), provider: "dataforseo" } });
    expect(await blockersFor(journalPath, "a".repeat(64))).toEqual([]);
  });

  it("computes policy breach from actual cost and quarantines only that reviewed revision", async () => {
    const journalPath = await temporaryJournalPath();
    await startAttempt({ journalPath, attempt: spendAttempt("op-1", "b".repeat(64), "cost-v1", 50_000) });

    const settlement = await settleAttempt({
      journalPath,
      settlement: {
        operationId: "op-1",
        providerResult: "succeeded",
        providerRequestId: "task-1",
        spend: { outcome: "confirmed_charged", costMicros: 60_000 },
      },
    });
    expect(settlement.spend?.policyBreach).toBe(true);

    await expectSpendBlocked(
      startAttempt({ journalPath, attempt: spendAttempt("op-2", "c".repeat(64), "cost-v1", 50_000) }),
      "policy_breach",
    );

    const newRevision = await startAttempt({
      journalPath,
      attempt: spendAttempt("op-3", "c".repeat(64), "cost-v2", 70_000),
    });
    expect(newRevision.spend?.costPolicyRevision).toBe("cost-v2");
  });

  it("rejects charged manual reconciliation without an evidenced cost", async () => {
    const journalPath = await temporaryJournalPath();
    await startAttempt({ journalPath, attempt: spendAttempt("op-1", "d".repeat(64)) });
    await settleAttempt({
      journalPath,
      settlement: {
        operationId: "op-1",
        providerResult: "unknown",
        spend: { outcome: "unknown", costMicros: null },
      },
    });

    for (const costMicros of [null, 0]) {
      await expect(
        settleAttempt({
          journalPath,
          settlement: {
            operationId: "op-1",
            providerResult: "succeeded",
            spend: { outcome: "confirmed_charged", costMicros },
            source: "manual",
            evidenceRef: "provider-console:task-1",
          },
        }),
      ).rejects.toMatchObject({ code: "INVALID_JOURNAL_EVENT" });
    }
  });

  it("fails closed on unknown schema versions, foreign keys, and illegal ordering", async () => {
    const journalPath = await temporaryJournalPath();
    await startAttempt({ journalPath, attempt: costFree("op-1") });
    const [line] = (await readFile(journalPath, "utf8")).trimEnd().split("\n");
    const started = JSON.parse(line ?? "{}") as Record<string, unknown>;

    for (const corrupt of [
      { ...started, schemaVersion: 2, eventId: "e-2", operationId: "op-2" },
      { ...started, eventId: "e-3", operationId: "op-3", rawInput: "{}" },
      {
        schemaVersion: 1,
        type: "artifact_recorded",
        eventId: "e-4",
        operationId: "op-4",
        occurredAt: new Date().toISOString(),
        artifact,
      },
    ]) {
      const isolated = await temporaryJournalPath();
      await mkdir(dirname(isolated), { recursive: true });
      await writeFile(isolated, `${line}\n${JSON.stringify(corrupt)}\n`, { mode: 0o600 });
      await expect(readJournal({ journalPath: isolated })).rejects.toMatchObject({
        code: "JOURNAL_CORRUPT",
      });
    }
  });

  it("serializes independent process appends into complete canonical JSON lines", async () => {
    const journalPath = await temporaryJournalPath();
    const moduleUrl = new URL("./journal.ts", import.meta.url).href;
    const processCount = 8;
    const subprocesses = Array.from({ length: processCount }, (_, index) => {
      const attempt = spendAttempt(`process-op-${index}`, index.toString(16).padStart(64, "0"));
      const script = [
        `import { startAttempt } from ${JSON.stringify(moduleUrl)};`,
        `await startAttempt(${JSON.stringify({ journalPath, attempt })});`,
      ].join("\n");
      const subprocess = spawn("bun", ["-e", script]);
      subprocess.stdin.end();
      return subprocess;
    });

    const results = await Promise.all(subprocesses.map(waitForSubprocess));
    if (results.some((result) => result.exitCode !== 0)) {
      throw new Error(
        `Concurrent journal writer failed: ${results.map((result) => result.stderr).join("\n")}`,
      );
    }

    const contents = await readFile(journalPath, "utf8");
    expect(contents.endsWith("\n")).toBe(true);
    const lines = contents.trimEnd().split("\n");
    expect(lines).toHaveLength(processCount);
    for (const line of lines) {
      const keys = Object.keys(JSON.parse(line) as Record<string, unknown>);
      expect(keys).toEqual([...keys].sort());
    }

    const snapshot = await readJournal({ journalPath });
    expect(snapshot.operations).toHaveLength(processCount);
  }, 20_000);

  it("allows exactly one spend authorization when independent processes race the same input", async () => {
    const journalPath = await temporaryJournalPath();
    const moduleUrl = new URL("./journal.ts", import.meta.url).href;
    const processCount = 6;
    const inputSha256 = "e".repeat(64);
    const subprocesses = Array.from({ length: processCount }, (_, index) => {
      const attempt = spendAttempt(`same-input-${index}`, inputSha256);
      const script = [
        `import { startAttempt } from ${JSON.stringify(moduleUrl)};`,
        "try {",
        `  await startAttempt(${JSON.stringify({ journalPath, attempt })});`,
        "} catch (error) {",
        "  if (error?.code === 'SPEND_BLOCKED' && error.blockers?.some((blocker) => blocker.reason === 'unsettled_attempt')) {",
        "    console.error('SPEND_BLOCKED:unsettled_attempt');",
        "    process.exit(2);",
        "  }",
        "  throw error;",
        "}",
      ].join("\n");
      const subprocess = spawn("bun", ["-e", script]);
      subprocess.stdin.end();
      return subprocess;
    });

    const results = await Promise.all(subprocesses.map(waitForSubprocess));
    expect(results.filter((result) => result.exitCode === 0)).toHaveLength(1);
    expect(
      results
        .filter((result) => result.exitCode !== 0)
        .every((result) => result.stderr.includes("SPEND_BLOCKED:unsettled_attempt")),
    ).toBe(true);
    const snapshot = await readJournal({ journalPath });
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.operations[0]?.started.inputSha256).toBe(inputSha256);
  }, 20_000);
});

function costFree(
  operationId: string,
  effects: StartAttemptInput["effects"] = ["read"],
): StartAttemptInput {
  return {
    operationId,
    profile: "app-a",
    provider: "gsc",
    capability: "gsc.url-inspection.inspect",
    capabilityRevision: "gsc-v1",
    effects,
    inputSha256: "0".repeat(64),
    spend: null,
  };
}

function spendAttempt(
  operationId: string,
  inputSha256: string,
  costPolicyRevision = "cost-v1",
  maxCostMicros = 50_000,
): StartAttemptInput {
  return {
    operationId,
    profile: "app-a",
    provider: "dataforseo",
    capability: "dataforseo.backlinks.bulk_ranks.live",
    capabilityRevision: "manifest-v1",
    effects: ["read", "spend"],
    inputSha256,
    spend: { costPolicyRevision, maxCostMicros, invocationMaxCostMicros: maxCostMicros },
  };
}

async function blockersFor(journalPath: string, inputSha256: string) {
  return await getSpendBlockers({
    journalPath,
    profile: "app-a",
    provider: "dataforseo",
    capability: "dataforseo.backlinks.bulk_ranks.live",
    costPolicyRevision: "cost-v1",
    inputSha256,
  });
}

async function expectSpendBlocked(
  promise: Promise<unknown>,
  reason: "policy_breach" | "unknown_outcome" | "unsettled_attempt",
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SpendBlockedError);
    expect((error as SpendBlockedError).blockers.some((blocker) => blocker.reason === reason)).toBe(true);
    return;
  }
  throw new Error("Expected spend authorization to be blocked.");
}

async function temporaryJournalPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gkit-journal-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "state", "operations.jsonl");
}

async function waitForSubprocess(
  subprocess: ChildProcessWithoutNullStreams,
): Promise<{ exitCode: number; stderr: string }> {
  let stderr = "";
  subprocess.stderr.setEncoding("utf8");
  subprocess.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
    subprocess.once("error", rejectExit);
    subprocess.once("exit", (code) => {
      resolveExit(code ?? -1);
    });
  });
  return { exitCode, stderr };
}
