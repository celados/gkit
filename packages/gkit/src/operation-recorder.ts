import type { ProviderOutcome } from "./envelope";
import {
  recordArtifact,
  settleAttempt,
  startAttempt,
  type JournalArtifact,
  type ProviderResult,
  type StartAttemptInput,
} from "./journal";

export type JournalPort = {
  startAttempt: typeof startAttempt;
  settleAttempt: typeof settleAttempt;
  recordArtifact: typeof recordArtifact;
};

export const defaultJournalPort: JournalPort = { startAttempt, settleAttempt, recordArtifact };

/** Maps a Provider Module result onto the journal's closed provider-result vocabulary. */
export function providerResultOf(result: { ok: boolean; outcome?: ProviderOutcome }): ProviderResult {
  if (result.ok) return "succeeded";
  switch (result.outcome) {
    case "confirmed":
      return "failed";
    case "not_dispatched":
      return "not_dispatched";
    default:
      return "unknown";
  }
}

/**
 * One cost-free Growth Operation as seen by an executor: started at the
 * Provider Module seam, settled once with the provider result, then linked to
 * its published Evidence.
 */
export type CostFreeOperation = {
  readonly operationId: string;
  settle(result: {
    providerResult: ProviderResult;
    errorCode?: string | null;
    providerRequestId?: string | null;
  }): Promise<void>;
  recordArtifact(artifact: JournalArtifact): Promise<void>;
};

export async function startCostFreeOperation(options: {
  journal: JournalPort;
  journalPath: string;
  attempt: Omit<StartAttemptInput, "spend">;
}): Promise<CostFreeOperation> {
  const { journal, journalPath } = options;
  const operationId = options.attempt.operationId;
  await journal.startAttempt({ journalPath, attempt: { ...options.attempt, spend: null } });
  return {
    operationId,
    async settle(result) {
      await journal.settleAttempt({
        journalPath,
        settlement: {
          operationId,
          providerResult: result.providerResult,
          errorCode: result.providerResult === "succeeded" ? null : (result.errorCode ?? null),
          providerRequestId: result.providerRequestId ?? null,
          spend: null,
        },
      });
    },
    async recordArtifact(artifact) {
      await journal.recordArtifact({ journalPath, operationId, artifact });
    },
  };
}
