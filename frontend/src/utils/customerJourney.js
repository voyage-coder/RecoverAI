import { formatINR } from "./format";
import { toLabel } from "./labels";
import { isBackendRecovered, STAGE_STATUS } from "./recoveryStages";

function upper(value) {
  return String(value || "").toUpperCase();
}

/**
 * Compact merchant-facing journey stages from live API data only.
 */
export function deriveCustomerRecoveryJourney({
  recoveryCase,
  timeline,
  paymentDetails,
  checkoutConfig,
}) {
  const payment = paymentDetails?.payment;
  const gateway = paymentDetails?.gateway_summary;
  const result = timeline?.result;
  const actions = timeline?.actions || [];
  const strategies = timeline?.strategies || [];
  const pending = actions.find((a) =>
    ["PENDING", "PROCESSING"].includes(upper(a.status))
  );
  const blocked = actions.find((a) => upper(a.status) === "BLOCKED");
  const executed = actions.find((a) => upper(a.status) === "EXECUTED");
  const selected =
    strategies.find((s) => s.is_selected) ||
    recoveryCase?.selected_strategy;

  const stages = [];

  // 1. Payment Failed
  stages.push({
    key: "payment_failed",
    name: "Payment Failed",
    status:
      payment?.status === "FAILED" || recoveryCase?.failure_reason
        ? STAGE_STATUS.COMPLETED
        : STAGE_STATUS.NOT_AVAILABLE,
    detail:
      payment?.failure_reason ||
      recoveryCase?.failure_reason ||
      toLabel(recoveryCase?.failure_category),
  });

  // 2. AI Diagnosis
  stages.push({
    key: "diagnosis",
    name: "AI Diagnosis",
    status: recoveryCase?.root_cause
      ? STAGE_STATUS.COMPLETED
      : STAGE_STATUS.PENDING,
    detail: recoveryCase?.root_cause || "Waiting for diagnosis",
  });

  // 3. Strategy Selected
  stages.push({
    key: "strategy",
    name: "Strategy Selected",
    status: selected ? STAGE_STATUS.COMPLETED : STAGE_STATUS.PENDING,
    detail: selected
      ? toLabel(
          typeof selected === "string" ? selected : selected.strategy_type
        )
      : "Waiting for strategy",
  });

  // 4. Merchant Action
  let merchantStatus = STAGE_STATUS.PENDING;
  let merchantDetail = "Merchant has not executed a recovery action yet";
  if (blocked) {
    merchantStatus = STAGE_STATUS.BLOCKED;
    merchantDetail =
      blocked.result_text || "Action blocked by Safety Engine";
  } else if (pending) {
    merchantStatus = STAGE_STATUS.IN_PROGRESS;
    merchantDetail = `${toLabel(pending.action_type)} · ${toLabel(
      pending.status
    )}`;
  } else if (executed) {
    merchantStatus = STAGE_STATUS.COMPLETED;
    merchantDetail = `${toLabel(executed.action_type)} executed`;
  }
  stages.push({
    key: "merchant_action",
    name: "Merchant Action",
    status: merchantStatus,
    detail: merchantDetail,
  });

  // 5. Customer Payment — never COMPLETED just because order exists
  let customerStatus = STAGE_STATUS.NOT_AVAILABLE;
  let customerDetail = "Customer payment not required yet";
  const awaiting =
    gateway?.awaiting_webhook === true ||
    checkoutConfig?.awaiting_webhook === true ||
    (paymentDetails?.attempts || []).some((a) =>
      String(a.error_code || "")
        .toUpperCase()
        .includes("AWAITING")
    );
  const recovered = isBackendRecovered(recoveryCase, result, payment);

  if (recovered) {
    customerStatus = STAGE_STATUS.COMPLETED;
    customerDetail = "Customer completed payment";
  } else if (awaiting || checkoutConfig?.available) {
    customerStatus = STAGE_STATUS.IN_PROGRESS;
    customerDetail = "Awaiting customer payment";
  } else if (executed) {
    customerStatus = STAGE_STATUS.PENDING;
    customerDetail = "Customer payment may be required after action";
  }
  stages.push({
    key: "customer_payment",
    name: "Customer Payment",
    status: customerStatus,
    detail: customerDetail,
  });

  // 6. Payment Verified (webhook)
  let verifiedStatus = STAGE_STATUS.NOT_AVAILABLE;
  let verifiedDetail = "Waiting for verified webhook";
  if (recovered && result?.recovered_at) {
    verifiedStatus = STAGE_STATUS.COMPLETED;
    verifiedDetail = "Webhook signature verified";
  } else if (awaiting) {
    verifiedStatus = STAGE_STATUS.IN_PROGRESS;
    verifiedDetail = "Waiting for payment confirmation";
  }
  stages.push({
    key: "payment_verified",
    name: "Payment Verified",
    status: verifiedStatus,
    detail: verifiedDetail,
  });

  // 7. Recovered — strict backend rule
  stages.push({
    key: "recovered",
    name: "Recovered",
    status: recovered ? STAGE_STATUS.COMPLETED : STAGE_STATUS.PENDING,
    detail: recovered
      ? `${formatINR(result?.recovered_amount ?? recoveryCase?.amount_at_risk)} recovered`
      : "Not recovered yet",
  });

  return stages;
}

export function resolveActionStateLabel({
  action,
  awaitingCustomerPayment,
}) {
  if (!action && awaitingCustomerPayment) {
    return "AWAITING CUSTOMER PAYMENT";
  }
  if (!action) return null;
  const status = upper(action.status);
  if (status === "PENDING") return "PENDING";
  if (status === "PROCESSING") return "EXECUTING";
  if (status === "EXECUTED") {
    return awaitingCustomerPayment
      ? "AWAITING CUSTOMER PAYMENT"
      : "COMPLETED";
  }
  if (status === "FAILED") return "FAILED";
  if (status === "BLOCKED") return "BLOCKED";
  return status;
}
