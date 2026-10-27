import { formatUsdMicros } from "./envelope";
import { isOpen, type JournalSnapshot, type OperationRecord, type OperationState } from "./journal";

/** Agent-facing projection of one journaled Growth Operation. */
export function operationView(record: OperationRecord) {
  const { started, latestSettlement } = record;
  const breach = record.settlements.some((settlement) => settlement.spend?.policyBreach === true);
  return {
    operationId: started.operationId,
    startedAt: started.occurredAt,
    profile: started.profile,
    provider: started.provider,
    capability: started.capability,
    capabilityRevision: started.capabilityRevision,
    effects: started.effects,
    inputSha256: started.inputSha256,
    state: record.state,
    providerResult: latestSettlement?.providerResult ?? null,
    errorCode: latestSettlement?.errorCode ?? null,
    providerRequestId: latestSettlement?.providerRequestId ?? null,
    reconciled: latestSettlement?.source === "manual",
    artifact: record.artifact,
    spend:
      started.spend === null
        ? null
        : {
            costPolicyRevision: started.spend.costPolicyRevision,
            maxCost: { amount: formatUsdMicros(started.spend.maxCostMicros), currency: "USD" },
            outcome: latestSettlement?.spend?.outcome ?? null,
            cost:
              latestSettlement?.spend?.costMicros === null || latestSettlement?.spend === undefined || latestSettlement.spend === null
                ? null
                : { amount: formatUsdMicros(latestSettlement.spend.costMicros), currency: "USD" },
            policyBreach: breach,
          },
  };
}

/** Operations whose execution or spend facts still need evidence-backed reconciliation. */
export function needsReconciliation(record: OperationRecord): boolean {
  return record.latestSettlement === null || isOpen(record.latestSettlement);
}

export function journalSummary(
  snapshot: JournalSnapshot,
  options: { limit: number; currentCostPolicies: Map<string, string> | null },
) {
  const byState: Record<OperationState, number> = {
    unknown: 0,
    not_dispatched: 0,
    succeeded: 0,
    failed: 0,
  };
  for (const record of snapshot.operations) byState[record.state] += 1;
  const breached = snapshot.operations.filter((record) =>
    record.settlements.some((settlement) => settlement.spend?.policyBreach === true),
  );
  const policies = options.currentCostPolicies;
  return {
    path: snapshot.path,
    operations: snapshot.operations.length,
    byState,
    unresolved: snapshot.operations.filter(needsReconciliation).length,
    recordedPolicyBreaches: breached.length,
    activePolicyBreaches:
      policies === null
        ? null
        : breached.filter(
            (record) => policies.get(record.started.capability) === record.started.spend?.costPolicyRevision,
          ).length,
    manifestStatus: policies === null ? "unavailable" : "available",
    recent: snapshot.operations.slice(-options.limit).reverse().map(operationView),
  };
}
