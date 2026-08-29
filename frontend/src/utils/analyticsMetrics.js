import { toLabel } from "./labels";

function upper(value) {
  return String(value || "").toUpperCase();
}

/**
 * Metric support notes (data audit):
 *
 * SUPPORTED from GET /api/dashboard/overview:
 * - total_cases, amount_at_risk, amount_recovered, recovery_rate
 * - active_cases, in_progress_cases, recovered_cases, escalated_cases, closed_cases
 *
 * SUPPORTED from GET /api/dashboard/failure-categories + GET /api/recovery/cases:
 * - failure category counts, failure category exposure (sum amount_at_risk)
 *
 * SUPPORTED from GET /api/recovery/cases + timeline for RECOVERED cases:
 * - recent recoveries (case_number, recovered_amount, recovery_method, recovered_at)
 *
 * PARTIALLY SUPPORTED (requires timelines for the case set):
 * - partially recovered / unrecovered (RecoveryResult.status)
 * - action created / executed funnel stages
 * - action execution counts
 *
 * NOT SUPPORTED without fabricating:
 * - failure category recovered amount (overview has no category join;
 *   only show if timelines for recovered cases are loaded and attributed)
 * - strategy effectiveness as causal % (selected strategy ≠ guaranteed cause of recovery)
 *
 * SUPPORTED (case list only):
 * - failure category recovery rate = RECOVERED cases / cases in category
 */

export const METRIC_SUPPORT = {
  totalCases: "SUPPORTED",
  totalAmountAtRisk: "SUPPORTED",
  totalRecoveredAmount: "SUPPORTED",
  recoveryRate: "SUPPORTED",
  recoveredCases: "SUPPORTED",
  partiallyRecoveredCases: "PARTIALLY_SUPPORTED",
  unrecoveredCases: "PARTIALLY_SUPPORTED",
  activeCases: "SUPPORTED",
  escalatedCases: "SUPPORTED",
  closedCases: "SUPPORTED",
  failureCategoryCounts: "SUPPORTED",
  failureCategoryExposure: "SUPPORTED",
  failureCategoryRecoveredAmount: "NOT_SUPPORTED",
  failureCategoryRecoveryRate: "SUPPORTED",
  strategyEffectiveness: "NOT_SUPPORTED",
  strategyDistribution: "SUPPORTED",
  actionExecutionCounts: "PARTIALLY_SUPPORTED",
  recoveryFunnel: "PARTIALLY_SUPPORTED",
  recentRecoveries: "PARTIALLY_SUPPORTED",
};

/**
 * Build analytics views from overview + cases + optional timelines.
 * Timelines keyed by case id. Read-only — never invent recovery.
 */
export function computeAnalyticsMetrics({
  overview = null,
  cases = [],
  timelines = {},
  failureCategories = [],
} = {}) {
  const ov = overview || {};

  const totalCases = Number(ov.total_cases) || 0;
  const amountAtRisk = Number(ov.amount_at_risk) || 0;
  const amountRecovered = Number(ov.amount_recovered) || 0;
  const recoveryRate =
    ov.recovery_rate != null
      ? Number(ov.recovery_rate)
      : amountAtRisk > 0
        ? Math.round((amountRecovered / amountAtRisk) * 10000) / 100
        : 0;

  const statusBreakdown = [
    { status: "ACTIVE", count: Number(ov.active_cases) || 0 },
    { status: "IN_PROGRESS", count: Number(ov.in_progress_cases) || 0 },
    { status: "RECOVERED", count: Number(ov.recovered_cases) || 0 },
    { status: "ESCALATED", count: Number(ov.escalated_cases) || 0 },
    { status: "CLOSED", count: Number(ov.closed_cases) || 0 },
  ];

  const activeRecovery =
    (Number(ov.active_cases) || 0) + (Number(ov.in_progress_cases) || 0);

  // Failure analysis: counts from API + exposure from case list
  const exposureByCategory = {};
  cases.forEach((item) => {
    const key = item.failure_category || "UNKNOWN";
    exposureByCategory[key] =
      (exposureByCategory[key] || 0) + (Number(item.amount_at_risk) || 0);
  });

  const failureRows = (failureCategories || []).map((item) => {
    const categoryCases = cases.filter(
      (c) => (c.failure_category || "UNKNOWN") === item.category
    );
    const recoveredInCategory = categoryCases.filter(
      (c) => upper(c.status) === "RECOVERED"
    ).length;
    const count = Number(item.count) || categoryCases.length;
    return {
      category: item.category,
      label: toLabel(item.category),
      count,
      amountAtRisk: exposureByCategory[item.category] || 0,
      recoveredCases: recoveredInCategory,
      recoveryRate:
        count > 0
          ? Math.round((recoveredInCategory / count) * 10000) / 100
          : 0,
    };
  });

  // Also include categories present only on cases (edge case)
  Object.keys(exposureByCategory).forEach((key) => {
    if (!failureRows.some((row) => row.category === key)) {
      const categoryCases = cases.filter(
        (c) => (c.failure_category || "UNKNOWN") === key
      );
      const recoveredInCategory = categoryCases.filter(
        (c) => upper(c.status) === "RECOVERED"
      ).length;
      const count = categoryCases.length;
      failureRows.push({
        category: key,
        label: toLabel(key),
        count,
        amountAtRisk: exposureByCategory[key],
        recoveredCases: recoveredInCategory,
        recoveryRate:
          count > 0
            ? Math.round((recoveredInCategory / count) * 10000) / 100
            : 0,
      });
    }
  });

  failureRows.sort((a, b) => b.count - a.count || b.amountAtRisk - a.amountAtRisk);

  // Strategy distribution (counts only — not causal effectiveness)
  const strategyCounts = {};
  cases.forEach((item) => {
    const key = item.selected_strategy || "UNASSIGNED";
    strategyCounts[key] = (strategyCounts[key] || 0) + 1;
  });
  const strategyDistribution = Object.entries(strategyCounts)
    .map(([strategy, count]) => ({
      strategy,
      label: toLabel(strategy),
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // Timeline-derived metrics (only when timelines provided)
  const timelineEntries = Object.values(timelines || {}).filter(Boolean);
  const hasTimelineCoverage = timelineEntries.length > 0;

  let partiallyRecoveredCases = null;
  let unrecoveredResultCases = null;
  let actionsCreated = 0;
  let actionsExecuted = 0;
  let casesWithActionCreated = 0;
  let casesWithActionExecuted = 0;

  if (hasTimelineCoverage) {
    partiallyRecoveredCases = 0;
    unrecoveredResultCases = 0;

    timelineEntries.forEach((timeline) => {
      const resultStatus = upper(timeline?.result?.status);
      if (resultStatus === "PARTIALLY_RECOVERED") {
        partiallyRecoveredCases += 1;
      }
      if (resultStatus === "NOT_RECOVERED") {
        unrecoveredResultCases += 1;
      }

      const actions = timeline?.actions || [];
      if (actions.length > 0) {
        casesWithActionCreated += 1;
        actionsCreated += actions.length;
      }
      const executed = actions.filter(
        (a) => upper(a.status) === "EXECUTED" || Boolean(a.executed_at)
      );
      if (executed.length > 0) {
        casesWithActionExecuted += 1;
        actionsExecuted += executed.length;
      }
      // Also count actions with executed_at
      actions.forEach((a) => {
        if (a.executed_at && !executed.includes(a)) {
          // already counted via status; skip double-count of actionsExecuted
        }
      });
    });
  }

  // Funnel — only stages we can measure
  const funnel = [
    {
      key: "payment_failed",
      name: "Payment Failed",
      count: totalCases,
      support: "SUPPORTED",
    },
    {
      key: "case_created",
      name: "Recovery Case Created",
      count: totalCases,
      support: "SUPPORTED",
    },
  ];

  if (hasTimelineCoverage) {
    funnel.push({
      key: "action_created",
      name: "Recovery Action Created",
      count: casesWithActionCreated,
      support: "PARTIALLY_SUPPORTED",
      detail: `${actionsCreated} action record(s) across loaded timelines`,
    });
    funnel.push({
      key: "action_executed",
      name: "Action Executed",
      count: casesWithActionExecuted,
      support: "PARTIALLY_SUPPORTED",
      detail: `${actionsExecuted} executed action(s)`,
    });
  }

  funnel.push({
    key: "payment_recovered",
    name: "Payment Recovered",
    count: Number(ov.recovered_cases) || 0,
    support: "SUPPORTED",
  });

  // Recent recoveries from RECOVERED cases + timeline.result
  const recoveredCases = cases.filter(
    (item) => upper(item.status) === "RECOVERED"
  );

  const recentRecoveries = recoveredCases
    .map((item) => {
      const result = timelines[item.id]?.result;
      if (!result) {
        return {
          id: item.id,
          caseNumber: item.case_number,
          amountRecovered: null,
          recoveryMethod: null,
          recoveredAt: null,
          amountAtRisk: item.amount_at_risk,
          incomplete: true,
        };
      }
      return {
        id: item.id,
        caseNumber: item.case_number,
        amountRecovered:
          result.recovered_amount != null
            ? Number(result.recovered_amount)
            : null,
        recoveryMethod: result.recovery_method || null,
        recoveredAt: result.recovered_at || null,
        amountAtRisk: item.amount_at_risk,
        incomplete: false,
      };
    })
    .filter((item) => !item.incomplete)
    .sort((a, b) => {
      const at = new Date(a.recoveredAt || 0).getTime();
      const bt = new Date(b.recoveredAt || 0).getTime();
      return bt - at;
    });

  return {
    totalCases,
    amountAtRisk,
    amountRecovered,
    recoveryRate,
    activeRecovery,
    escalatedCases: Number(ov.escalated_cases) || 0,
    recoveredCasesCount: Number(ov.recovered_cases) || 0,
    statusBreakdown,
    failureRows,
    funnel,
    recentRecoveries,
    partiallyRecoveredCases,
    unrecoveredResultCases,
    actionCounts: hasTimelineCoverage
      ? {
          actionsCreated,
          actionsExecuted,
          casesWithActionCreated,
          casesWithActionExecuted,
        }
      : null,
    strategyDistribution,
    strategyEffectivenessAvailable: false,
    strategyEffectivenessMessage:
      "Strategy effectiveness unavailable — RecoverAI does not claim that the selected strategy caused the recovery. Only strategy distribution counts are shown.",
    support: METRIC_SUPPORT,
  };
}
