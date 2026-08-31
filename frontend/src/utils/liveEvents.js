import { toLabel } from "./labels";

function upper(value) {
  return String(value || "").toUpperCase();
}

export const LIVE_FILTERS = [
  { key: "all", label: "All" },
  { key: "payment_failures", label: "Payment failures" },
  { key: "recoveries", label: "Recoveries" },
  { key: "actions", label: "Actions" },
  { key: "escalations", label: "Escalations" },
  { key: "awaiting_payment", label: "Awaiting payment" },
];

export const LIVE_POLL_INTERVAL_MS = 8000;

/**
 * Prefer cases that merchants need to watch, then newest.
 * Caps detail API volume for polling.
 */
export function selectCasesForDetailFetch(cases = [], limit = 35) {
  const list = [...cases];
  const rank = (status) => {
    const s = upper(status);
    if (s === "ESCALATED") return 0;
    if (s === "IN_PROGRESS") return 1;
    if (s === "ACTIVE") return 2;
    if (s === "RECOVERED") return 3;
    if (s === "CLOSED") return 4;
    return 5;
  };

  list.sort((a, b) => {
    const rankDiff = rank(a.status) - rank(b.status);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });

  return list.slice(0, limit);
}

function baseEvent(partial) {
  return {
    amount: null,
    failureCategory: null,
    caseStatus: null,
    description: "",
    ...partial,
  };
}

function isAwaitingPayment(paymentDetails, checkoutHint, caseStatus) {
  if (upper(caseStatus) === "RECOVERED") return false;
  if (upper(paymentDetails?.payment?.status) === "RECOVERED") return false;
  if (paymentDetails?.gateway_summary?.awaiting_webhook === true) return true;
  if (checkoutHint?.awaiting_webhook === true) return true;
  return (paymentDetails?.attempts || []).some(
    (attempt) =>
      String(attempt.error_code || "")
        .toUpperCase()
        .includes("AWAITING") ||
      (attempt.gateway?.order_id &&
        upper(attempt.status) !== "SUCCESS")
  );
}

/**
 * Build live feed events from existing case / timeline / payment-details data.
 * Newest-first sorting is applied by the caller via sortLiveEventsDesc.
 */
export function buildLiveEventsForCase({
  caseItem,
  timeline,
  paymentDetails,
}) {
  if (!caseItem && !timeline?.case) return [];

  const recoveryCase = timeline?.case || caseItem;
  const caseId = recoveryCase.id || caseItem?.id;
  const caseNumber = recoveryCase.case_number || caseItem?.case_number;
  const caseStatus = recoveryCase.status || caseItem?.status;
  const failureCategory =
    recoveryCase.failure_category || caseItem?.failure_category || null;
  const amountAtRisk =
    recoveryCase.amount_at_risk ?? caseItem?.amount_at_risk ?? null;

  const events = [];
  const payment = paymentDetails?.payment;
  const attempts = paymentDetails?.attempts || [];

  // Payment failure / new case
  if (payment?.created_at || recoveryCase.created_at) {
    events.push(
      baseEvent({
        id: `payment-failed-${caseId}`,
        timestamp: payment?.created_at || recoveryCase.created_at,
        caseId,
        caseNumber,
        eventType: "PAYMENT FAILED",
        filterKey: "payment_failures",
        amount: payment?.amount ?? amountAtRisk,
        failureCategory,
        caseStatus,
        description:
          payment?.failure_reason ||
          recoveryCase.failure_reason ||
          toLabel(failureCategory) ||
          "Payment failure received",
      })
    );
  }

  if (recoveryCase.root_cause) {
    const selected =
      (timeline?.strategies || []).find((s) => s.is_selected) ||
      recoveryCase.selected_strategy;
    const strategyLabel = selected
      ? toLabel(
          typeof selected === "string" ? selected : selected.strategy_type
        )
      : null;

    events.push(
      baseEvent({
        id: `diagnosis-${caseId}`,
        timestamp: recoveryCase.created_at,
        caseId,
        caseNumber,
        eventType: "AI DIAGNOSIS",
        filterKey: "actions",
        amount: amountAtRisk,
        failureCategory,
        caseStatus,
        description: strategyLabel
          ? `Root cause: ${recoveryCase.root_cause} · Strategy: ${strategyLabel}`
          : `Root cause: ${recoveryCase.root_cause}`,
      })
    );
  }

  (timeline?.strategies || []).forEach((strategy) => {
    if (!strategy.is_selected || !strategy.created_at) return;
    events.push(
      baseEvent({
        id: `strategy-${strategy.id}`,
        timestamp: strategy.created_at,
        caseId,
        caseNumber,
        eventType: "STRATEGY SELECTED",
        filterKey: "actions",
        amount: amountAtRisk,
        failureCategory,
        caseStatus,
        description: toLabel(strategy.strategy_type),
      })
    );
  });

  (timeline?.audit_logs || []).forEach((log) => {
    if (!log.timestamp) return;
    const isSafety =
      upper(log.actor).includes("SAFETY") ||
      upper(log.action_type).includes("SAFETY");
    if (!isSafety) return;

    const detail =
      typeof log.details === "string"
        ? log.details
        : log.details
          ? JSON.stringify(log.details)
          : "Safety Engine decision recorded";

    events.push(
      baseEvent({
        id: `safety-${log.id}`,
        timestamp: log.timestamp,
        caseId,
        caseNumber,
        eventType: "SAFETY DECISION",
        filterKey: "actions",
        amount: amountAtRisk,
        failureCategory,
        caseStatus,
        description: detail,
      })
    );
  });

  (timeline?.actions || []).forEach((action) => {
    if (action.created_at) {
      const pendingish = ["PENDING", "PROCESSING"].includes(
        upper(action.status)
      );
      events.push(
        baseEvent({
          id: `action-created-${action.id}`,
          timestamp: action.created_at,
          caseId,
          caseNumber,
          eventType: pendingish ? "ACTION READY" : "ACTION CREATED",
          filterKey: "actions",
          amount: amountAtRisk,
          failureCategory,
          caseStatus,
          description: `${toLabel(action.action_type)} · ${toLabel(
            action.status
          )}`,
        })
      );
    }

    if (action.executed_at) {
      events.push(
        baseEvent({
          id: `action-exec-${action.id}`,
          timestamp: action.executed_at,
          caseId,
          caseNumber,
          eventType: "ACTION EXECUTED",
          filterKey: "actions",
          amount: amountAtRisk,
          failureCategory,
          caseStatus,
          description:
            action.result_text || toLabel(action.action_type),
        })
      );
    }

    if (upper(action.status) === "BLOCKED") {
      events.push(
        baseEvent({
          id: `action-blocked-${action.id}`,
          timestamp: action.executed_at || action.created_at,
          caseId,
          caseNumber,
          eventType: "BLOCKED",
          filterKey: "actions",
          amount: amountAtRisk,
          failureCategory,
          caseStatus,
          description:
            action.result_text ||
            "Action blocked by Safety Engine",
        })
      );
    }

    if (upper(action.action_type).includes("STOP_RECOVERY")) {
      events.push(
        baseEvent({
          id: `action-stop-${action.id}`,
          timestamp: action.executed_at || action.created_at,
          caseId,
          caseNumber,
          eventType: "STOPPED",
          filterKey: "actions",
          amount: amountAtRisk,
          failureCategory,
          caseStatus,
          description:
            action.result_text || "Recovery stopped",
        })
      );
    }
  });

  attempts.forEach((attempt) => {
    const orderId = attempt.gateway?.order_id;
    if (orderId && attempt.created_at) {
      events.push(
        baseEvent({
          id: `razorpay-order-${attempt.id}`,
          timestamp: attempt.created_at,
          caseId,
          caseNumber,
          eventType: "RAZORPAY ORDER CREATED",
          filterKey: "awaiting_payment",
          amount: attempt.gateway?.amount ?? amountAtRisk,
          failureCategory,
          caseStatus,
          description: `Razorpay TEST order created · ${orderId}`,
        })
      );

      if (
        upper(attempt.status) !== "SUCCESS" &&
        upper(caseStatus) !== "RECOVERED"
      ) {
        events.push(
          baseEvent({
            id: `awaiting-customer-${attempt.id}`,
            timestamp: attempt.created_at,
            caseId,
            caseNumber,
            eventType: "AWAITING CUSTOMER PAYMENT",
            filterKey: "awaiting_payment",
            amount: attempt.gateway?.amount ?? amountAtRisk,
            failureCategory,
            caseStatus,
            description:
              "Customer payment required — awaiting verified webhook",
          })
        );
      }
    }

    if (upper(attempt.status) === "SUCCESS" && attempt.created_at) {
      events.push(
        baseEvent({
          id: `payment-captured-${attempt.id}`,
          timestamp: attempt.created_at,
          caseId,
          caseNumber,
          eventType: "PAYMENT CAPTURED",
          filterKey: "recoveries",
          amount: attempt.gateway?.amount ?? amountAtRisk,
          failureCategory,
          caseStatus,
          description:
            attempt.gateway?.razorpay_payment_id ||
            "Gateway success attempt recorded",
        })
      );
    }
  });

  const result = timeline?.result;
  if (result?.recovered_at && upper(result.status) === "FULLY_RECOVERED") {
    events.push(
      baseEvent({
        id: `recovered-${result.id}`,
        timestamp: result.recovered_at,
        caseId,
        caseNumber,
        eventType: "RECOVERED",
        filterKey: "recoveries",
        amount: result.recovered_amount,
        failureCategory,
        caseStatus,
        description: result.recovery_method
          ? `Fully recovered · ${toLabel(result.recovery_method)}`
          : "Fully recovered",
      })
    );
  } else if (
    result?.created_at &&
    upper(result.status) === "NOT_RECOVERED"
  ) {
    events.push(
      baseEvent({
        id: `not-recovered-${result.id}`,
        timestamp: result.created_at,
        caseId,
        caseNumber,
        eventType: "NOT RECOVERED",
        filterKey: "recoveries",
        amount: amountAtRisk,
        failureCategory,
        caseStatus,
        description: "Recovery result: not recovered",
      })
    );
  } else if (
    result?.created_at &&
    upper(result.status) === "PARTIALLY_RECOVERED"
  ) {
    events.push(
      baseEvent({
        id: `partial-${result.id}`,
        timestamp: result.recovered_at || result.created_at,
        caseId,
        caseNumber,
        eventType: "PARTIALLY RECOVERED",
        filterKey: "recoveries",
        amount: result.recovered_amount,
        failureCategory,
        caseStatus,
        description: "Recovery result: partially recovered",
      })
    );
  }

  if (upper(caseStatus) === "ESCALATED") {
    events.push(
      baseEvent({
        id: `escalated-${caseId}`,
        timestamp:
          recoveryCase.updated_at || recoveryCase.created_at,
        caseId,
        caseNumber,
        eventType: "ESCALATED",
        filterKey: "escalations",
        amount: amountAtRisk,
        failureCategory,
        caseStatus,
        description:
          recoveryCase.current_step ||
          recoveryCase.failure_reason ||
          "Needs human attention",
      })
    );
  }

  if (upper(caseStatus) === "CLOSED") {
    events.push(
      baseEvent({
        id: `closed-${caseId}`,
        timestamp:
          recoveryCase.updated_at || recoveryCase.created_at,
        caseId,
        caseNumber,
        eventType: "CLOSED",
        filterKey: "actions",
        amount: amountAtRisk,
        failureCategory,
        caseStatus,
        description:
          recoveryCase.current_step || "Case closed",
      })
    );
  }

  return events
    .filter((event) => event.timestamp && event.caseId)
    .map((event) => ({
      ...event,
      sourceLabel:
        upper(caseStatus) === "RECOVERED"
          ? "Verified Webhook"
          : caseItem?.event_source_label ||
            (caseItem?.event_source === "LIVE_PROVIDER"
              ? "Live Provider Event"
              : "Demo Event"),
      outcomeKind:
        upper(caseStatus) === "RECOVERED"
          ? "CONFIRMED_RECOVERY"
          : "PREDICTED_RECOVERY",
    }));
}

export function buildLiveEvents({
  cases = [],
  timelines = {},
  paymentDetailsByCase = {},
} = {}) {
  const events = [];

  cases.forEach((caseItem) => {
    events.push(
      ...buildLiveEventsForCase({
        caseItem,
        timeline: timelines[caseItem.id],
        paymentDetails: paymentDetailsByCase[caseItem.id],
      })
    );
  });

  return sortLiveEventsDesc(events);
}

export function sortLiveEventsDesc(events = []) {
  return [...events].sort((a, b) => {
    const bt = new Date(b.timestamp).getTime();
    const at = new Date(a.timestamp).getTime();
    if (bt !== at) return bt - at;
    return String(b.id).localeCompare(String(a.id));
  });
}

export function filterLiveEvents(events = [], filterKey = "all") {
  if (!filterKey || filterKey === "all") return events;
  return events.filter((event) => event.filterKey === filterKey);
}

/**
 * Merchant attention queue from real case statuses + awaiting-payment signals.
 */
export function buildAttentionItems({
  cases = [],
  timelines = {},
  paymentDetailsByCase = {},
} = {}) {
  const items = [];

  cases.forEach((caseItem) => {
    const status = upper(caseItem.status);
    const timeline = timelines[caseItem.id];
    const paymentDetails = paymentDetailsByCase[caseItem.id];
    const awaiting = isAwaitingPayment(
      paymentDetails,
      null,
      caseItem.status
    );

    const isEscalated = status === "ESCALATED";
    const isActive = status === "ACTIVE";
    const isInProgress = status === "IN_PROGRESS";

    if (!isEscalated && !isActive && !isInProgress && !awaiting) {
      return;
    }

    const actions = timeline?.actions || [];
    const pending = actions.find((a) =>
      ["PENDING", "PROCESSING"].includes(upper(a.status))
    );

    let recommended = null;
    if (isEscalated) {
      recommended = pending
        ? `Execute pending ${toLabel(pending.action_type)}`
        : "Needs human attention — no Force Recover available";
    } else if (awaiting) {
      recommended =
        "Awaiting customer payment — complete TEST checkout / wait for webhook";
    } else if (pending) {
      recommended = `Execute recommended action: ${toLabel(
        pending.action_type
      )}`;
    } else if (isActive || isInProgress) {
      recommended = "Review case and prepare next recovery action if needed";
    }

    items.push({
      id: caseItem.id,
      caseNumber: caseItem.case_number,
      amountAtRisk: caseItem.amount_at_risk,
      failureReason: caseItem.failure_reason || null,
      failureCategory: caseItem.failure_category || null,
      currentStep: caseItem.current_step || null,
      status: caseItem.status,
      recommended,
      awaiting,
      priority: isEscalated ? 0 : awaiting ? 1 : isInProgress ? 2 : 3,
    });
  });

  return items.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (b.amountAtRisk || 0) - (a.amountAtRisk || 0);
  });
}
