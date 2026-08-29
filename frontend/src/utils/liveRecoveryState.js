import { formatINR } from "./format";
import { toLabel } from "./labels";

const WAITING = "Waiting for backend confirmation";

function upper(value) {
  return String(value || "").toUpperCase();
}

/**
 * Operator-facing live state rows — all values from API payloads.
 */
export function deriveLiveRecoveryState({
  recoveryCase,
  timeline,
  paymentDetails,
  checkoutConfig,
}) {
  const payment = paymentDetails?.payment;
  const gateway = paymentDetails?.gateway_summary;
  const result = timeline?.result;
  const actions = timeline?.actions || [];
  const latestAction = actions.length ? actions[actions.length - 1] : null;
  const pendingAction = actions.find((item) =>
    ["PENDING", "PROCESSING"].includes(upper(item.status))
  );
  const blockedAction = actions.find(
    (item) => upper(item.status) === "BLOCKED"
  );

  let paymentState = payment?.status
    ? upper(payment.status)
    : WAITING;

  let diagnosisState = recoveryCase?.root_cause
    ? recoveryCase.root_cause
    : recoveryCase?.failure_reason || WAITING;

  let strategyState = recoveryCase?.selected_strategy
    ? toLabel(recoveryCase.selected_strategy)
    : WAITING;

  let actionState = WAITING;
  if (blockedAction) {
    actionState = `BLOCKED · ${blockedAction.result_text || "Safety Engine"}`;
  } else if (pendingAction) {
    actionState = `${toLabel(pendingAction.action_type)} · PENDING`;
  } else if (latestAction) {
    actionState = `${toLabel(latestAction.action_type)} · ${toLabel(
      latestAction.status
    )}`;
  }

  let razorpayState = WAITING;
  if (gateway?.order_id) {
    razorpayState = `ORDER CREATED · ${gateway.order_id}`;
  } else if (checkoutConfig?.payment_link_url) {
    razorpayState = "PAYMENT LINK READY";
  } else if (gateway?.mode === "SIMULATED_GATEWAY") {
    razorpayState = "SIMULATED GATEWAY";
  }

  let customerPaymentState = WAITING;
  if (upper(payment?.status) === "RECOVERED") {
    customerPaymentState = "PAYMENT CAPTURED";
  } else if (gateway?.awaiting_webhook) {
    customerPaymentState = "AWAITING PAYMENT";
  } else if (checkoutConfig?.available) {
    customerPaymentState = "AWAITING PAYMENT";
  }

  let webhookState = WAITING;
  if (upper(payment?.status) === "RECOVERED" && result?.recovered_at) {
    webhookState = "VERIFIED";
  } else if (gateway?.awaiting_webhook) {
    webhookState = "WAITING";
  } else if (upper(result?.status) === "FULLY_RECOVERED") {
    webhookState = "VERIFIED";
  }

  let recoveryState = WAITING;
  if (result?.status) {
    recoveryState = toLabel(result.status);
  } else if (recoveryCase?.status) {
    recoveryState = toLabel(recoveryCase.status);
  }

  let decisionState = "AI processing";
  const caseStatus = upper(recoveryCase?.status);
  if (caseStatus === "RECOVERED" || upper(payment?.status) === "RECOVERED") {
    decisionState = "Recovered";
  } else if (caseStatus === "ESCALATED") {
    decisionState = "Escalated";
  } else if (caseStatus === "CLOSED") {
    decisionState = "Stopped";
  } else if (blockedAction && !pendingAction) {
    decisionState = "Failed";
  } else if (gateway?.awaiting_webhook || checkoutConfig?.awaiting_webhook) {
    decisionState = "Awaiting webhook";
  } else if (
    checkoutConfig?.available ||
    gateway?.order_id ||
    checkoutConfig?.payment_link_url
  ) {
    decisionState = "Awaiting customer payment";
  } else if (pendingAction) {
    decisionState = "Awaiting merchant";
  } else if (recoveryCase?.selected_strategy && recoveryCase?.root_cause) {
    decisionState = "Decision ready";
  } else if (recoveryCase?.root_cause) {
    decisionState = "Decision ready";
  }

  const recoveredAmount =
    result?.recovered_amount != null
      ? formatINR(result.recovered_amount)
      : formatINR(0);

  return [
    { key: "decision_state", label: "Decision state", value: decisionState },
    { key: "payment", label: "Payment", value: paymentState },
    { key: "diagnosis", label: "AI Diagnosis", value: diagnosisState },
    {
      key: "prediction",
      label: "Model prediction",
      value:
        recoveryCase?.recovery_probability != null
          ? `${recoveryCase.recovery_probability}% (not a guarantee)`
          : "Prediction unavailable",
    },
    { key: "strategy", label: "Strategy", value: strategyState },
    { key: "action", label: "Action", value: actionState },
    { key: "razorpay", label: "Razorpay", value: razorpayState },
    {
      key: "customer_payment",
      label: "Customer Payment",
      value: customerPaymentState,
    },
    { key: "webhook", label: "Webhook", value: webhookState },
    { key: "recovery", label: "Recovery", value: recoveryState },
    {
      key: "amount_recovered",
      label: "Amount Recovered",
      value: recoveredAmount,
    },
  ];
}
