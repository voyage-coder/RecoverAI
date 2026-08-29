import { formatINR } from "./format";
import { toLabel } from "./labels";

function upper(value) {
  return String(value || "").toUpperCase();
}

/**
 * Build chronological activity from timeline + payment APIs only.
 */
export function buildRecoveryActivityEvents(timeline, paymentDetails) {
  if (!timeline) return [];

  const events = [];
  const recoveryCase = timeline.case;
  const payment = paymentDetails?.payment;
  const attempts = paymentDetails?.attempts || [];

  if (payment?.created_at) {
    events.push({
      id: `payment-failed-${payment.payment_id}`,
      timestamp: payment.created_at,
      title: "Payment failure received",
      detail: payment.failure_reason || toLabel(recoveryCase?.failure_category),
      amount: payment.amount,
    });
  }

  if (recoveryCase?.created_at) {
    events.push({
      id: `case-${recoveryCase.id}`,
      timestamp: recoveryCase.created_at,
      title: "Recovery case created",
      detail: recoveryCase.case_number,
      amount: recoveryCase.amount_at_risk,
    });
  }

  if (recoveryCase?.root_cause) {
    events.push({
      id: `diagnosis-${recoveryCase.id}`,
      timestamp: recoveryCase.created_at,
      title: "AI diagnosis completed",
      detail: recoveryCase.root_cause,
    });
  }

  (timeline.strategies || []).forEach((strategy) => {
    if (!strategy.is_selected) return;
    events.push({
      id: `strategy-${strategy.id}`,
      timestamp: strategy.created_at,
      title: "Strategy selected",
      detail: toLabel(strategy.strategy_type),
    });
  });

  (timeline.audit_logs || []).forEach((log) => {
    const isSafety =
      upper(log.actor).includes("SAFETY") ||
      upper(log.action_type).includes("SAFETY");
    events.push({
      id: `audit-${log.id}`,
      timestamp: log.timestamp,
      title: isSafety ? "Safety check recorded" : toLabel(log.action_type),
      detail:
        typeof log.details === "string"
          ? log.details
          : JSON.stringify(log.details || ""),
    });
  });

  (timeline.actions || []).forEach((action) => {
    events.push({
      id: `action-created-${action.id}`,
      timestamp: action.created_at,
      title: "Recovery action created",
      detail: `${toLabel(action.action_type)} · ${toLabel(action.status)}`,
    });
    if (action.executed_at) {
      events.push({
        id: `action-exec-${action.id}`,
        timestamp: action.executed_at,
        title: "Recovery action executed",
        detail: action.result_text || toLabel(action.action_type),
      });
    }
    if (upper(action.status) === "BLOCKED") {
      events.push({
        id: `action-blocked-${action.id}`,
        timestamp: action.created_at,
        title: "Action blocked by Safety Engine",
        detail: action.result_text || "Blocked",
      });
    }
  });

  attempts.forEach((attempt) => {
    const orderId = attempt.gateway?.order_id;
    if (orderId) {
      events.push({
        id: `razorpay-order-${attempt.id}`,
        timestamp: attempt.created_at,
        title: "Razorpay order created",
        detail: `Payment link ready · ${orderId}`,
        amount: attempt.gateway?.amount,
      });
      if (
        upper(attempt.status) !== "SUCCESS" &&
        upper(recoveryCase?.status) !== "RECOVERED"
      ) {
        events.push({
          id: `awaiting-customer-${attempt.id}`,
          timestamp: attempt.created_at,
          title: "Awaiting customer payment",
          detail: "Customer must complete payment — merchant does not pay",
          amount: attempt.gateway?.amount,
        });
      }
    }
    if (upper(attempt.status) === "SUCCESS") {
      events.push({
        id: `payment-captured-${attempt.id}`,
        timestamp: attempt.created_at,
        title: "Payment captured",
        detail: attempt.gateway?.razorpay_payment_id || "Success attempt",
        amount: attempt.gateway?.amount,
      });
    }
  });

  (timeline.communications || []).forEach((comm) => {
    events.push({
      id: `comm-${comm.id}`,
      timestamp: comm.sent_at,
      title: "Customer communication sent",
      detail: `${toLabel(comm.channel)} · ${toLabel(comm.status)}`,
    });
  });

  const result = timeline.result;
  if (result?.recovered_at && upper(result.status) === "FULLY_RECOVERED") {
    events.push({
      id: `webhook-${result.id}`,
      timestamp: result.recovered_at,
      title: "Payment verified",
      detail: "Verified Razorpay payment.captured webhook applied",
    });
    events.push({
      id: `recovery-${result.id}`,
      timestamp: result.recovered_at,
      title: "Recovery completed",
      detail: toLabel(result.recovery_method),
      amount: result.recovered_amount,
    });
  } else if (result?.created_at && upper(result.status) === "NOT_RECOVERED") {
    events.push({
      id: `not-recovered-${result.id}`,
      timestamp: result.created_at,
      title: "Recovery unsuccessful",
      detail: "Not recovered",
    });
  }

  return events
    .filter((event) => event.timestamp)
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
}

export function formatActivityLine(event) {
  const parts = [event.title];
  if (event.detail) parts.push(event.detail);
  if (event.amount != null) parts.push(formatINR(event.amount));
  return parts.join(" · ");
}
