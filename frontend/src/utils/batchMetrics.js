import { toLabel } from "./labels";

function upper(value) {
  return String(value || "").toUpperCase();
}

export const TERMINAL_CASE_STATUSES = [
  "RECOVERED",
  "CLOSED",
  "ESCALATED",
];

export function isTerminalCaseStatus(status) {
  return TERMINAL_CASE_STATUSES.includes(upper(status));
}

export function batchHasActiveCases(cases = []) {
  if (!cases.length) return false;
  return cases.some((item) => !isTerminalCaseStatus(item.status));
}

/**
 * Aggregate batch metrics from live case list + timeline payloads.
 * All monetary values are in paise (API convention).
 */
export function computeBatchMetrics(batchCases = [], timelines = {}) {
  const caseIds = batchCases.map((c) => c.id);
  const totalCases = batchCases.length;

  let amountAtRisk = 0;
  let recoveredAmount = 0;
  let recoveredCases = 0;
  let activeCases = 0;
  let inProgressCases = 0;
  let escalatedCases = 0;
  let closedCases = 0;
  let notRecoveredCases = 0;
  let processingCases = 0;

  const failureBreakdown = {};
  let totalActions = 0;
  let communicationActions = 0;
  let escalatedInBatch = 0;
  let stoppedCases = 0;
  let auditEventCount = 0;

  batchCases.forEach((caseItem) => {
    const atRisk = Number(caseItem.amount_at_risk) || 0;
    amountAtRisk += atRisk;

    const status = upper(caseItem.status);
    const timeline = timelines[caseItem.id];
    const result = timeline?.result;
    const resultStatus = upper(result?.status);
    const actions = timeline?.actions || [];
    const auditLogs = timeline?.audit_logs || [];

    if (status === "ACTIVE") activeCases += 1;
    if (status === "IN_PROGRESS") inProgressCases += 1;
    if (status === "RECOVERED") recoveredCases += 1;
    if (status === "ESCALATED") {
      escalatedCases += 1;
      escalatedInBatch += 1;
    }
    if (status === "CLOSED") closedCases += 1;

    if (!isTerminalCaseStatus(status)) {
      processingCases += 1;
    }

    if (resultStatus === "NOT_RECOVERED") {
      notRecoveredCases += 1;
    }

    if (result?.recovered_amount != null) {
      recoveredAmount += Number(result.recovered_amount) || 0;
    }

    const category = caseItem.failure_category || "UNKNOWN";
    if (!failureBreakdown[category]) {
      failureBreakdown[category] = { count: 0, amountAtRisk: 0 };
    }
    failureBreakdown[category].count += 1;
    failureBreakdown[category].amountAtRisk += atRisk;

    totalActions += actions.length;
    communicationActions += actions.filter((action) =>
      upper(action.action_type).includes("SEND_")
    ).length;

    const hasStop = actions.some(
      (action) =>
        upper(action.action_type).includes("STOP_RECOVERY") ||
        upper(action.status) === "BLOCKED"
    );
    if (hasStop) {
      stoppedCases += 1;
    }

    auditEventCount += auditLogs.length;
  });

  const stillAtRisk = Math.max(amountAtRisk - recoveredAmount, 0);
  const recoveryRate =
    amountAtRisk > 0
      ? Math.round((recoveredAmount / amountAtRisk) * 10000) / 100
      : 0;

  const failureRows = Object.entries(failureBreakdown)
    .map(([category, data]) => ({
      category,
      label: toLabel(category),
      count: data.count,
      amountAtRisk: data.amountAtRisk,
    }))
    .sort((a, b) => b.count - a.count);

  const strategyCounts = {};
  batchCases.forEach((caseItem) => {
    const key = caseItem.selected_strategy || "UNASSIGNED";
    strategyCounts[key] = (strategyCounts[key] || 0) + 1;
  });
  const strategyMix = Object.entries(strategyCounts)
    .map(([strategy, count]) => ({
      strategy,
      label: toLabel(strategy),
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const pendingCases = activeCases + inProgressCases;
  const unrecoveredCases = notRecoveredCases + closedCases;

  return {
    caseIds,
    totalCases,
    paymentsSubmitted: totalCases,
    amountAtRisk,
    recoveredAmount,
    stillAtRisk,
    recoveryRate,
    recoveredCases,
    activeCases,
    inProgressCases,
    pendingCases,
    escalatedCases,
    closedCases,
    notRecoveredCases,
    unrecoveredCases,
    processingCases,
    failureRows,
    strategyMix,
    compliance: {
      escalatedCases: escalatedInBatch,
      stoppedCases,
      totalActions,
      communicationActions,
      auditEventCount,
    },
  };
}
