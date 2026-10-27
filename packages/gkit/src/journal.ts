import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { mkdir, open, readFile, unlink, type FileHandle } from "node:fs/promises";

import { canonicalJson } from "./canonical";

const SCHEMA_VERSION = 1;
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_INTERVAL_MS = 10;

export type JournalEffect = "read" | "spend" | "write" | "destructive";

/** What the Provider Module established about the one attempt that crossed the runtime seam. */
export type ProviderResult = "succeeded" | "failed" | "not_dispatched" | "unknown";

export type SpendOutcome = "confirmed_charged" | "confirmed_not_charged" | "unknown";

export type SettlementSource = "automatic" | "manual";

/** Closed Operation Projection; derived from events, never stored. */
export type OperationState = "unknown" | "not_dispatched" | "succeeded" | "failed";

export type SpendAuthorization = Readonly<{
  costPolicyRevision: string;
  maxCostMicros: number;
  invocationMaxCostMicros: number;
  currency: "USD";
}>;

export type SpendSettlement = Readonly<{
  outcome: SpendOutcome;
  costMicros: number | null;
  policyBreach: boolean;
}>;

export type JournalArtifact = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
}>;

type EventEnvelope<TType extends string> = Readonly<{
  schemaVersion: typeof SCHEMA_VERSION;
  type: TType;
  eventId: string;
  operationId: string;
  occurredAt: string;
}>;

/** Written immediately before the Provider Module receives control. */
export type AttemptStartedEvent = EventEnvelope<"attempt_started"> &
  Readonly<{
    profile: string;
    provider: string;
    capability: string;
    capabilityRevision: string;
    effects: readonly JournalEffect[];
    inputSha256: string;
    spend: SpendAuthorization | null;
  }>;

export type AttemptSettledEvent = EventEnvelope<"attempt_settled"> &
  Readonly<{
    providerResult: ProviderResult;
    errorCode: string | null;
    providerRequestId: string | null;
    spend: SpendSettlement | null;
    source: SettlementSource;
    evidenceRef: string | null;
  }>;

export type ArtifactRecordedEvent = EventEnvelope<"artifact_recorded"> &
  Readonly<{
    artifact: JournalArtifact;
  }>;

export type OperationEvent = AttemptStartedEvent | AttemptSettledEvent | ArtifactRecordedEvent;

export type StartAttemptInput = Readonly<{
  operationId: string;
  profile: string;
  provider: string;
  capability: string;
  capabilityRevision: string;
  effects: readonly JournalEffect[];
  inputSha256: string;
  spend: Omit<SpendAuthorization, "currency"> | null;
}>;

export type SettleAttemptInput = Readonly<{
  operationId: string;
  providerResult: ProviderResult;
  errorCode?: string | null;
  providerRequestId?: string | null;
  spend?: Readonly<{ outcome: SpendOutcome; costMicros: number | null }> | null;
  source?: SettlementSource;
  evidenceRef?: string | null;
}>;

export type JournalOptions = Readonly<{
  journalPath: string;
  lockTimeoutMs?: number;
}>;

export type OperationRecord = Readonly<{
  started: AttemptStartedEvent;
  settlements: readonly AttemptSettledEvent[];
  latestSettlement: AttemptSettledEvent | null;
  artifact: JournalArtifact | null;
  state: OperationState;
}>;

export type JournalSnapshot = Readonly<{
  path: string;
  events: readonly OperationEvent[];
  operations: readonly OperationRecord[];
}>;

export type SpendBlockerReason = "policy_breach" | "unknown_outcome" | "unsettled_attempt";

export type SpendBlocker = Readonly<{
  reason: SpendBlockerReason;
  operationId: string;
  profile: string;
  provider: string;
  capability: string;
  costPolicyRevision: string;
  inputSha256: string;
  settlementEventId: string | null;
}>;

export type SpendBlockerQuery = Readonly<{
  profile: string;
  provider: string;
  capability?: string;
  costPolicyRevision?: string;
  inputSha256?: string;
}>;

export type JournalErrorCode =
  | "ARTIFACT_ALREADY_RECORDED"
  | "INVALID_JOURNAL_EVENT"
  | "JOURNAL_CORRUPT"
  | "JOURNAL_IO_ERROR"
  | "JOURNAL_LOCKED"
  | "OPERATION_ALREADY_SETTLED"
  | "OPERATION_ALREADY_STARTED"
  | "OPERATION_NOT_STARTED"
  | "SPEND_BLOCKED";

export class JournalError extends Error {
  readonly code: JournalErrorCode;
  readonly journalPath: string;

  constructor(code: JournalErrorCode, message: string, journalPath: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "JournalError";
    this.code = code;
    this.journalPath = journalPath;
  }
}

export class SpendBlockedError extends JournalError {
  readonly blockers: readonly SpendBlocker[];

  constructor(journalPath: string, blockers: readonly SpendBlocker[]) {
    super(
      "SPEND_BLOCKED",
      "A prior spend operation must be reconciled or its cost-policy revision must change before dispatch.",
      journalPath,
    );
    this.name = "SpendBlockedError";
    this.blockers = blockers;
  }
}

type JournalLock = Readonly<{
  handle: FileHandle;
  path: string;
  token: string;
}>;

export function defaultJournalPath(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const stateRoot = environment.XDG_STATE_HOME?.trim();
  if (stateRoot !== undefined && stateRoot.length > 0) {
    if (!isAbsolute(stateRoot)) {
      throw new JournalError(
        "INVALID_JOURNAL_EVENT",
        "XDG_STATE_HOME must be an absolute path when set.",
        resolve(stateRoot, "gkit", "operations.jsonl"),
      );
    }
    return resolve(stateRoot, "gkit", "operations.jsonl");
  }
  const configuredHome = environment.HOME?.trim();
  const home = configuredHome || homedir();
  if (!isAbsolute(home)) {
    throw new JournalError(
      "INVALID_JOURNAL_EVENT",
      "HOME must be an absolute path when used for the operation journal.",
      resolve(home, ".local", "state", "gkit", "operations.jsonl"),
    );
  }
  return join(home, ".local", "state", "gkit", "operations.jsonl");
}

export async function readJournal(options: JournalOptions): Promise<JournalSnapshot> {
  const journalPath = resolveJournalPath(options.journalPath);
  return await withJournalLock(journalPath, lockTimeout(options, journalPath), async () => {
    return await readJournalUnlocked(journalPath);
  });
}

export async function getSpendBlockers(
  options: JournalOptions & SpendBlockerQuery,
): Promise<readonly SpendBlocker[]> {
  validateBlockerQuery(options, options.journalPath);
  const snapshot = await readJournal(options);
  return findSpendBlockers(snapshot, options);
}

/**
 * Records that execution ownership is about to cross the Provider Module seam.
 * For spend capabilities this is also the durable spend authorization, so the
 * blocker check and the append share one lock.
 */
export async function startAttempt(
  options: JournalOptions & Readonly<{ attempt: StartAttemptInput }>,
): Promise<AttemptStartedEvent> {
  const journalPath = resolveJournalPath(options.journalPath);
  validateStartInput(options.attempt, journalPath);

  return await withJournalLock(journalPath, lockTimeout(options, journalPath), async () => {
    const snapshot = await readJournalUnlocked(journalPath);
    if (snapshot.operations.some((record) => record.started.operationId === options.attempt.operationId)) {
      throw new JournalError(
        "OPERATION_ALREADY_STARTED",
        "The operation has already crossed the provider seam.",
        journalPath,
      );
    }

    const spend = options.attempt.spend;
    if (spend !== null) {
      const blockers = findSpendBlockers(snapshot, {
        profile: options.attempt.profile,
        provider: options.attempt.provider,
        capability: options.attempt.capability,
        costPolicyRevision: spend.costPolicyRevision,
        inputSha256: options.attempt.inputSha256,
      });
      if (blockers.length > 0) throw new SpendBlockedError(journalPath, blockers);
    }

    const event: AttemptStartedEvent = {
      ...envelope("attempt_started", options.attempt.operationId),
      profile: options.attempt.profile,
      provider: options.attempt.provider,
      capability: options.attempt.capability,
      capabilityRevision: options.attempt.capabilityRevision,
      effects: [...options.attempt.effects],
      inputSha256: options.attempt.inputSha256,
      spend: spend === null ? null : { ...spend, currency: "USD" },
    };
    await appendEventUnlocked(journalPath, event);
    return event;
  });
}

export async function settleAttempt(
  options: JournalOptions & Readonly<{ settlement: SettleAttemptInput }>,
): Promise<AttemptSettledEvent> {
  const journalPath = resolveJournalPath(options.journalPath);
  validateSettleInput(options.settlement, journalPath);

  return await withJournalLock(journalPath, lockTimeout(options, journalPath), async () => {
    const snapshot = await readJournalUnlocked(journalPath);
    const record = requireRecord(snapshot, options.settlement.operationId, journalPath);
    const input = options.settlement;
    const event: AttemptSettledEvent = {
      ...envelope("attempt_settled", input.operationId),
      providerResult: input.providerResult,
      errorCode: input.errorCode ?? null,
      providerRequestId: input.providerRequestId ?? null,
      spend:
        input.spend === undefined || input.spend === null
          ? null
          : {
              outcome: input.spend.outcome,
              costMicros: input.spend.costMicros,
              policyBreach: isPolicyBreach(record.started, input.spend.costMicros),
            },
      source: input.source ?? "automatic",
      evidenceRef: input.evidenceRef ?? null,
    };
    assertSettlementAllowed(record, event, (message) => {
      throw new JournalError(
        record.latestSettlement === null || isOpen(record.latestSettlement)
          ? "INVALID_JOURNAL_EVENT"
          : "OPERATION_ALREADY_SETTLED",
        message,
        journalPath,
      );
    });
    await appendEventUnlocked(journalPath, event);
    return event;
  });
}

export async function recordArtifact(
  options: JournalOptions & Readonly<{ operationId: string; artifact: JournalArtifact }>,
): Promise<ArtifactRecordedEvent> {
  const journalPath = resolveJournalPath(options.journalPath);
  validateNonEmpty(options.operationId, "operationId", journalPath);
  if (!isArtifact(options.artifact)) {
    throw new JournalError("INVALID_JOURNAL_EVENT", "The artifact receipt is invalid.", journalPath);
  }

  return await withJournalLock(journalPath, lockTimeout(options, journalPath), async () => {
    const snapshot = await readJournalUnlocked(journalPath);
    const record = requireRecord(snapshot, options.operationId, journalPath);
    if (record.artifact !== null) {
      throw new JournalError(
        "ARTIFACT_ALREADY_RECORDED",
        "The operation already has a recorded artifact.",
        journalPath,
      );
    }
    if (record.latestSettlement === null || record.latestSettlement.providerResult === "not_dispatched") {
      throw new JournalError(
        "INVALID_JOURNAL_EVENT",
        "An artifact can only be recorded after a dispatched attempt settles.",
        journalPath,
      );
    }
    const event: ArtifactRecordedEvent = {
      ...envelope("artifact_recorded", options.operationId),
      artifact: { ...options.artifact },
    };
    await appendEventUnlocked(journalPath, event);
    return event;
  });
}

export function findSpendBlockers(
  snapshot: JournalSnapshot,
  query: SpendBlockerQuery,
): readonly SpendBlocker[] {
  const blockers: SpendBlocker[] = [];

  for (const record of snapshot.operations) {
    const started = record.started;
    if (started.spend === null) continue;
    if (started.profile !== query.profile || started.provider !== query.provider) continue;

    const capabilityMatches = query.capability === undefined || started.capability === query.capability;
    const inputMatches = query.inputSha256 === undefined || started.inputSha256 === query.inputSha256;
    const policyRevisionMatches =
      query.costPolicyRevision === undefined ||
      started.spend.costPolicyRevision === query.costPolicyRevision;

    if (capabilityMatches && inputMatches) {
      const latest = record.latestSettlement;
      if (latest === null) {
        blockers.push(createBlocker("unsettled_attempt", started, null));
      } else if (latest.spend?.outcome === "unknown") {
        blockers.push(createBlocker("unknown_outcome", started, latest.eventId));
      }
    }

    if (capabilityMatches && policyRevisionMatches) {
      const breach = record.settlements.find((settlement) => settlement.spend?.policyBreach);
      if (breach !== undefined) blockers.push(createBlocker("policy_breach", started, breach.eventId));
    }
  }

  return blockers.sort(compareBlockers);
}

export function projectState(
  latestSettlement: AttemptSettledEvent | null,
  artifact: JournalArtifact | null,
): OperationState {
  if (latestSettlement === null) return "unknown";
  switch (latestSettlement.providerResult) {
    case "unknown":
      return "unknown";
    case "not_dispatched":
      return "not_dispatched";
    case "failed":
      return "failed";
    case "succeeded":
      // Provider success without durable Evidence is not success (ADR-0012).
      return artifact === null ? "failed" : "succeeded";
  }
}

/** A settlement stays open while the provider result or its spend amount is unknown. */
export function isOpen(settlement: AttemptSettledEvent): boolean {
  return settlement.providerResult === "unknown" || settlement.spend?.outcome === "unknown";
}

function assertSettlementAllowed(
  record: { started: AttemptStartedEvent; latestSettlement: AttemptSettledEvent | null; artifact: JournalArtifact | null },
  event: AttemptSettledEvent,
  fail: (message: string) => never,
): void {
  const started = record.started;
  if ((started.spend === null) !== (event.spend === null)) {
    fail("A settlement must carry spend facts exactly when the operation authorized spend.");
  }
  if (event.providerResult === "succeeded" && event.errorCode !== null) {
    fail("A succeeded provider result cannot carry an error code.");
  }
  if (event.providerResult === "not_dispatched" && event.spend !== null && event.spend.outcome !== "confirmed_not_charged") {
    fail("A non-dispatched spend operation must settle as confirmed_not_charged.");
  }
  if (event.spend !== null) {
    const costIssue = spendCostIssue(event.spend.outcome, event.spend.costMicros);
    if (costIssue !== null) fail(costIssue);
  }
  if (event.source === "manual" && event.evidenceRef === null) {
    fail("A manual reconciliation requires a non-secret evidence reference.");
  }

  const latest = record.latestSettlement;
  if (latest === null) {
    if (event.source !== "automatic") fail("The first settlement of an attempt is recorded by the runtime.");
    return;
  }
  if (!isOpen(latest)) fail("The operation already has a confirmed settlement.");
  if (event.source !== "manual") {
    fail("An unknown outcome requires explicit evidence-backed manual reconciliation.");
  }
  if (isOpen(event)) fail("A reconciliation must resolve every unknown outcome it replaces.");
  if (latest.providerResult !== "unknown" && latest.providerResult !== event.providerResult) {
    fail("A reconciliation cannot change a confirmed provider result.");
  }
  if (record.artifact !== null && event.providerResult === "not_dispatched") {
    fail("An operation with a recorded artifact was dispatched.");
  }
}

function createBlocker(
  reason: SpendBlockerReason,
  started: AttemptStartedEvent,
  settlementEventId: string | null,
): SpendBlocker {
  return {
    reason,
    operationId: started.operationId,
    profile: started.profile,
    provider: started.provider,
    capability: started.capability,
    costPolicyRevision: started.spend?.costPolicyRevision ?? "",
    inputSha256: started.inputSha256,
    settlementEventId,
  };
}

function compareBlockers(left: SpendBlocker, right: SpendBlocker): number {
  const operationComparison = left.operationId.localeCompare(right.operationId);
  if (operationComparison !== 0) return operationComparison;
  return left.reason.localeCompare(right.reason);
}

function isPolicyBreach(started: AttemptStartedEvent, costMicros: number | null): boolean {
  return started.spend !== null && costMicros !== null && costMicros > started.spend.maxCostMicros;
}

function requireRecord(snapshot: JournalSnapshot, operationId: string, journalPath: string): OperationRecord {
  const record = snapshot.operations.find((candidate) => candidate.started.operationId === operationId);
  if (record === undefined) {
    throw new JournalError(
      "OPERATION_NOT_STARTED",
      "The operation has no durable provider attempt in the journal.",
      journalPath,
    );
  }
  return record;
}

function envelope<TType extends OperationEvent["type"]>(type: TType, operationId: string) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type,
    eventId: randomUUID(),
    operationId,
    occurredAt: new Date().toISOString(),
  } as const;
}

async function readJournalUnlocked(journalPath: string): Promise<JournalSnapshot> {
  let contents: string;
  try {
    contents = await readFile(journalPath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { path: journalPath, events: [], operations: [] };
    throw new JournalError("JOURNAL_IO_ERROR", "Failed to read the operation journal.", journalPath, error);
  }

  if (contents.length === 0) return { path: journalPath, events: [], operations: [] };
  if (!contents.endsWith("\n")) {
    throw new JournalError(
      "JOURNAL_CORRUPT",
      "The operation journal ends with an incomplete JSON line.",
      journalPath,
    );
  }

  const events: OperationEvent[] = [];
  const eventIds = new Map<string, string>();
  for (const [index, line] of contents.slice(0, -1).split("\n").entries()) {
    const lineNumber = index + 1;
    if (line.length === 0) {
      throw new JournalError(
        "JOURNAL_CORRUPT",
        `The operation journal contains an empty line at ${lineNumber}.`,
        journalPath,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      throw new JournalError(
        "JOURNAL_CORRUPT",
        `The operation journal contains invalid JSON at line ${lineNumber}.`,
        journalPath,
        error,
      );
    }

    const event = parseEvent(parsed, journalPath, lineNumber);
    const canonical = canonicalJson(event);
    const prior = eventIds.get(event.eventId);
    if (prior !== undefined) {
      if (prior !== canonical) {
        throw new JournalError(
          "JOURNAL_CORRUPT",
          `The operation journal reuses eventId ${event.eventId} with different data.`,
          journalPath,
        );
      }
      continue;
    }
    eventIds.set(event.eventId, canonical);
    events.push(event);
  }

  return { path: journalPath, events, operations: foldOperations(events, journalPath) };
}

function foldOperations(events: readonly OperationEvent[], journalPath: string): readonly OperationRecord[] {
  const records = new Map<
    string,
    { started: AttemptStartedEvent; settlements: AttemptSettledEvent[]; artifact: JournalArtifact | null }
  >();
  const corrupt = (message: string): never => {
    throw new JournalError("JOURNAL_CORRUPT", message, journalPath);
  };

  for (const event of events) {
    if (event.type === "attempt_started") {
      if (records.has(event.operationId)) {
        corrupt(`The operation journal starts operation ${event.operationId} more than once.`);
      }
      records.set(event.operationId, { started: event, settlements: [], artifact: null });
      continue;
    }

    const record = records.get(event.operationId);
    if (record === undefined) {
      corrupt(`The operation journal records ${event.type} before operation ${event.operationId} started.`);
      continue;
    }

    if (event.type === "artifact_recorded") {
      const latest = record.settlements.at(-1);
      if (record.artifact !== null || latest === undefined || latest.providerResult === "not_dispatched") {
        corrupt(`The operation journal has an invalid artifact for operation ${event.operationId}.`);
      }
      record.artifact = event.artifact;
      continue;
    }

    if (event.spend !== null && event.spend.policyBreach !== isPolicyBreach(record.started, event.spend.costMicros)) {
      corrupt(`The operation journal has an invalid policy-breach marker for operation ${event.operationId}.`);
    }
    assertSettlementAllowed(
      { started: record.started, latestSettlement: record.settlements.at(-1) ?? null, artifact: record.artifact },
      event,
      (message) => corrupt(`Operation ${event.operationId}: ${message}`),
    );
    record.settlements.push(event);
  }

  return [...records.values()].map((record) => {
    const latestSettlement = record.settlements.at(-1) ?? null;
    return {
      started: record.started,
      settlements: record.settlements,
      latestSettlement,
      artifact: record.artifact,
      state: projectState(latestSettlement, record.artifact),
    };
  });
}

async function appendEventUnlocked(journalPath: string, event: OperationEvent): Promise<void> {
  await mkdir(dirname(journalPath), { recursive: true, mode: 0o700 });
  const line = Buffer.from(`${canonicalJson(event)}\n`, "utf8");
  let handle: FileHandle | null = null;

  try {
    handle = await open(journalPath, "a", 0o600);
    await handle.chmod(0o600);
    const originalSize = (await handle.stat()).size;
    const writeResult = await handle.write(line, 0, line.byteLength, null);
    if (writeResult.bytesWritten !== line.byteLength) {
      await handle.truncate(originalSize);
      await handle.sync();
      throw new Error("The journal append was incomplete.");
    }
    await handle.sync();
    await handle.close();
    handle = null;
    await syncDirectory(dirname(journalPath));
  } catch (error) {
    throw new JournalError(
      "JOURNAL_IO_ERROR",
      "Failed to durably append the operation event.",
      journalPath,
      error,
    );
  } finally {
    if (handle !== null) await handle.close().catch(() => undefined);
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  const directory = await open(directoryPath, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function withJournalLock<T>(
  journalPath: string,
  lockTimeoutMs: number,
  callback: () => Promise<T>,
): Promise<T> {
  const lock = await acquireJournalLock(journalPath, lockTimeoutMs);
  try {
    return await callback();
  } finally {
    await releaseJournalLock(lock, journalPath);
  }
}

async function acquireJournalLock(journalPath: string, lockTimeoutMs: number): Promise<JournalLock> {
  await mkdir(dirname(journalPath), { recursive: true, mode: 0o700 });
  const lockPath = `${journalPath}.lock`;
  const deadline = Date.now() + lockTimeoutMs;

  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      const token = randomUUID();
      try {
        await handle.chmod(0o600);
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })}\n`,
          "utf8",
        );
        await handle.sync();
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
        throw error;
      }
      return { handle, path: lockPath, token };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        throw new JournalError(
          "JOURNAL_IO_ERROR",
          "Failed to acquire the operation journal lock.",
          journalPath,
          error,
        );
      }
      if (Date.now() >= deadline) {
        throw new JournalError(
          "JOURNAL_LOCKED",
          "The operation journal is locked by another process. Review the lock before retrying.",
          journalPath,
        );
      }
      await delay(LOCK_POLL_INTERVAL_MS);
    }
  }
}

async function releaseJournalLock(lock: JournalLock, journalPath: string): Promise<void> {
  let releaseError: unknown;

  try {
    const record = JSON.parse(await readFile(lock.path, "utf8")) as unknown;
    if (!isRecord(record) || record.token !== lock.token) {
      throw new Error("Operation journal lock ownership changed unexpectedly.");
    }
  } catch (error) {
    releaseError = error;
  }

  try {
    await lock.handle.close();
  } catch (error) {
    releaseError = error;
  }

  if (releaseError === undefined) {
    try {
      await unlink(lock.path);
    } catch (error) {
      releaseError = error;
    }
  }

  if (releaseError !== undefined) {
    throw new JournalError(
      "JOURNAL_IO_ERROR",
      "Failed to release the operation journal lock.",
      journalPath,
      releaseError,
    );
  }
}

const ENVELOPE_KEYS = ["eventId", "occurredAt", "operationId", "schemaVersion", "type"] as const;
const STARTED_KEYS = [
  ...ENVELOPE_KEYS,
  "capability",
  "capabilityRevision",
  "effects",
  "inputSha256",
  "profile",
  "provider",
  "spend",
] as const;
const SETTLED_KEYS = [
  ...ENVELOPE_KEYS,
  "errorCode",
  "evidenceRef",
  "providerRequestId",
  "providerResult",
  "source",
  "spend",
] as const;
const ARTIFACT_EVENT_KEYS = [...ENVELOPE_KEYS, "artifact"] as const;
const SPEND_AUTHORIZATION_KEYS = [
  "costPolicyRevision",
  "currency",
  "invocationMaxCostMicros",
  "maxCostMicros",
] as const;
const SPEND_SETTLEMENT_KEYS = ["costMicros", "outcome", "policyBreach"] as const;
const ARTIFACT_KEYS = ["bytes", "path", "sha256"] as const;
const EFFECTS = new Set<JournalEffect>(["read", "spend", "write", "destructive"]);
const PROVIDER_RESULTS = new Set<ProviderResult>(["succeeded", "failed", "not_dispatched", "unknown"]);
const SPEND_OUTCOMES = new Set<SpendOutcome>(["confirmed_charged", "confirmed_not_charged", "unknown"]);
const SETTLEMENT_SOURCES = new Set<SettlementSource>(["automatic", "manual"]);

function parseEvent(value: unknown, journalPath: string, lineNumber: number): OperationEvent {
  const invalid = (): never => {
    throw new JournalError(
      "JOURNAL_CORRUPT",
      `The operation journal event at line ${lineNumber} is invalid.`,
      journalPath,
    );
  };
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION) return invalid();

  const base = {
    schemaVersion: SCHEMA_VERSION,
    eventId: string(value.eventId) ?? invalid(),
    operationId: string(value.operationId) ?? invalid(),
    occurredAt: timestamp(value.occurredAt) ?? invalid(),
  } as const;

  if (value.type === "attempt_started") {
    if (!hasExactKeys(value, STARTED_KEYS)) return invalid();
    const effects = Array.isArray(value.effects) ? value.effects : invalid();
    if (
      effects.length === 0 ||
      new Set(effects).size !== effects.length ||
      !effects.every((effect) => EFFECTS.has(effect as JournalEffect))
    ) {
      return invalid();
    }
    const spend = value.spend === null ? null : parseSpendAuthorization(value.spend) ?? invalid();
    if (effects.includes("spend") !== (spend !== null)) return invalid();
    return {
      ...base,
      type: "attempt_started",
      profile: string(value.profile) ?? invalid(),
      provider: string(value.provider) ?? invalid(),
      capability: string(value.capability) ?? invalid(),
      capabilityRevision: string(value.capabilityRevision) ?? invalid(),
      effects: effects as JournalEffect[],
      inputSha256: sha256(value.inputSha256) ?? invalid(),
      spend,
    };
  }

  if (value.type === "attempt_settled") {
    if (!hasExactKeys(value, SETTLED_KEYS)) return invalid();
    if (!PROVIDER_RESULTS.has(value.providerResult as ProviderResult)) return invalid();
    if (!SETTLEMENT_SOURCES.has(value.source as SettlementSource)) return invalid();
    const spend = value.spend === null ? null : parseSpendSettlement(value.spend) ?? invalid();
    return {
      ...base,
      type: "attempt_settled",
      providerResult: value.providerResult as ProviderResult,
      errorCode: nullable(value.errorCode, invalid),
      providerRequestId: nullable(value.providerRequestId, invalid),
      spend,
      source: value.source as SettlementSource,
      evidenceRef: nullable(value.evidenceRef, invalid),
    };
  }

  if (value.type === "artifact_recorded") {
    if (!hasExactKeys(value, ARTIFACT_EVENT_KEYS) || !isArtifact(value.artifact)) return invalid();
    return {
      ...base,
      type: "artifact_recorded",
      artifact: {
        path: value.artifact.path,
        bytes: value.artifact.bytes,
        sha256: value.artifact.sha256,
      },
    };
  }

  return invalid();
}

function parseSpendAuthorization(value: unknown): SpendAuthorization | null {
  if (!isRecord(value) || !hasExactKeys(value, SPEND_AUTHORIZATION_KEYS)) return null;
  const costPolicyRevision = string(value.costPolicyRevision);
  if (
    costPolicyRevision === null ||
    value.currency !== "USD" ||
    !isMicros(value.maxCostMicros) ||
    !isMicros(value.invocationMaxCostMicros) ||
    value.maxCostMicros > value.invocationMaxCostMicros
  ) {
    return null;
  }
  return {
    costPolicyRevision,
    maxCostMicros: value.maxCostMicros,
    invocationMaxCostMicros: value.invocationMaxCostMicros,
    currency: "USD",
  };
}

function parseSpendSettlement(value: unknown): SpendSettlement | null {
  if (!isRecord(value) || !hasExactKeys(value, SPEND_SETTLEMENT_KEYS)) return null;
  if (!SPEND_OUTCOMES.has(value.outcome as SpendOutcome) || typeof value.policyBreach !== "boolean") {
    return null;
  }
  if (value.costMicros !== null && !isMicros(value.costMicros)) return null;
  return {
    outcome: value.outcome as SpendOutcome,
    costMicros: value.costMicros as number | null,
    policyBreach: value.policyBreach,
  };
}

function validateStartInput(input: StartAttemptInput, journalPath: string): void {
  validateNonEmpty(input.operationId, "operationId", journalPath);
  validateNonEmpty(input.profile, "profile", journalPath);
  validateNonEmpty(input.provider, "provider", journalPath);
  validateNonEmpty(input.capability, "capability", journalPath);
  validateNonEmpty(input.capabilityRevision, "capabilityRevision", journalPath);
  validateSha256(input.inputSha256, journalPath);
  if (
    input.effects.length === 0 ||
    new Set(input.effects).size !== input.effects.length ||
    !input.effects.every((effect) => EFFECTS.has(effect))
  ) {
    throw new JournalError("INVALID_JOURNAL_EVENT", "The operation effects are invalid.", journalPath);
  }
  if (input.effects.includes("spend") !== (input.spend !== null)) {
    throw new JournalError(
      "INVALID_JOURNAL_EVENT",
      "Spend capabilities require exactly one durable spend authorization.",
      journalPath,
    );
  }
  if (input.spend === null) return;
  validateNonEmpty(input.spend.costPolicyRevision, "costPolicyRevision", journalPath);
  validateMicros(input.spend.maxCostMicros, "maxCostMicros", journalPath);
  validateMicros(input.spend.invocationMaxCostMicros, "invocationMaxCostMicros", journalPath);
  if (input.spend.maxCostMicros > input.spend.invocationMaxCostMicros) {
    throw new JournalError(
      "INVALID_JOURNAL_EVENT",
      "The reviewed cost bound exceeds the invocation spend cap.",
      journalPath,
    );
  }
}

function validateSettleInput(input: SettleAttemptInput, journalPath: string): void {
  validateNonEmpty(input.operationId, "operationId", journalPath);
  if (!PROVIDER_RESULTS.has(input.providerResult)) {
    throw new JournalError("INVALID_JOURNAL_EVENT", "The provider result is invalid.", journalPath);
  }
  for (const [name, value] of [
    ["errorCode", input.errorCode],
    ["providerRequestId", input.providerRequestId],
    ["evidenceRef", input.evidenceRef],
  ] as const) {
    if (value !== undefined && value !== null) validateNonEmpty(value, name, journalPath);
  }
  if (input.source !== undefined && !SETTLEMENT_SOURCES.has(input.source)) {
    throw new JournalError("INVALID_JOURNAL_EVENT", "The settlement source is invalid.", journalPath);
  }
  if (input.spend !== undefined && input.spend !== null) {
    if (!SPEND_OUTCOMES.has(input.spend.outcome)) {
      throw new JournalError("INVALID_JOURNAL_EVENT", "The spend outcome is invalid.", journalPath);
    }
    if (input.spend.costMicros !== null) validateMicros(input.spend.costMicros, "costMicros", journalPath);
  }
}

function spendCostIssue(outcome: SpendOutcome, costMicros: number | null): string | null {
  if (outcome === "confirmed_charged" && (costMicros === null || costMicros <= 0)) {
    return "A confirmed charged settlement requires a positive evidenced cost.";
  }
  if (outcome === "confirmed_not_charged" && costMicros !== 0) {
    return "A confirmed not-charged settlement must record zero cost.";
  }
  return null;
}

function validateBlockerQuery(query: SpendBlockerQuery, journalPath: string): void {
  validateNonEmpty(query.profile, "profile", journalPath);
  validateNonEmpty(query.provider, "provider", journalPath);
  if (query.capability !== undefined) validateNonEmpty(query.capability, "capability", journalPath);
  if (query.costPolicyRevision !== undefined) {
    validateNonEmpty(query.costPolicyRevision, "costPolicyRevision", journalPath);
  }
  if (query.inputSha256 !== undefined) validateSha256(query.inputSha256, journalPath);
}

function validateNonEmpty(value: string, fieldName: string, journalPath: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new JournalError("INVALID_JOURNAL_EVENT", `${fieldName} must not be empty.`, journalPath);
  }
}

function validateSha256(value: string, journalPath: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new JournalError(
      "INVALID_JOURNAL_EVENT",
      "inputSha256 must be a lowercase SHA-256 digest.",
      journalPath,
    );
  }
}

function validateMicros(value: number, fieldName: string, journalPath: string): void {
  if (!isMicros(value)) {
    throw new JournalError(
      "INVALID_JOURNAL_EVENT",
      `${fieldName} must be a non-negative safe integer in micros.`,
      journalPath,
    );
  }
}

function lockTimeout(options: JournalOptions, journalPath: string): number {
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 0) {
    throw new JournalError(
      "INVALID_JOURNAL_EVENT",
      "The journal lock timeout must be a non-negative integer.",
      journalPath,
    );
  }
  return lockTimeoutMs;
}

function resolveJournalPath(journalPath: string): string {
  if (journalPath.trim().length === 0) {
    throw new JournalError("INVALID_JOURNAL_EVENT", "The journal path must not be empty.", journalPath);
  }
  return resolve(journalPath);
}

function isArtifact(value: unknown): value is JournalArtifact {
  return (
    isRecord(value) &&
    hasExactKeys(value, ARTIFACT_KEYS) &&
    typeof value.path === "string" &&
    isAbsolute(value.path) &&
    isMicros(value.bytes) &&
    typeof value.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.sha256)
  );
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullable(value: unknown, invalid: () => never): string | null {
  if (value === null) return null;
  return string(value) ?? invalid();
}

function timestamp(value: unknown): string | null {
  const candidate = string(value);
  return candidate !== null && !Number.isNaN(Date.parse(candidate)) ? candidate : null;
}

function sha256(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

function isMicros(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
