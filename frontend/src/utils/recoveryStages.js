import { formatINR } from "./format";
import { toLabel } from "./labels";

const COMM_STRATEGY_MARKERS = [
  "SEND_EMAIL",
  "SEND_SMS",
  "SEND_WHATSAPP",
  "SEND_PAYMENT_LINK",
  "OFFER_ALT",
];

const RETRY_STRATEGY_MARKERS = [
  "IMMEDIATE_RETRY",
  "RETRY_AFTER_DELAY",
];

export const STAGE_STATUS = {
  COMPLETED: "COMPLETED",
  IN_PROGRESS: "IN_PROGRESS",
  PENDING: "PENDING",
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  NOT_AVAILABLE: "NOT_AVAILABLE",
};

function upper(value) {
  return String(value || "").toUpperCase();
}

function isCommStrategy(type) {
  const key = upper(type);
  return COMM_STRATEGY_MARKERS.some(
    (marker) => key === marker || key.includes(marker)
  );
}

function isRetryStrategy(type) {
  const key = upper(type);
  return RETRY_STRATEGY_MARKERS.some(
    (marker) => key === marker || key.includes(marker)
  );
}

function auditDetailText(details) {
  if (details == null || details === "") return null;
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function makeStage(key, name, overrides = {}) {
  return {
    key,
    name,
    status: STAGE_STATUS.NOT_AVAILABLE,
    timestamp: null,
    detail: null,
    ...overrides,
  };
}

/**
 * Derive recovery pipeline stages from real API payloads only.
 * Never infers completion beyond what backend records support.
 */
export function deriveRecoveryStages({
  recoveryCase,
  timeline,
  paymentDetails,
}) {
  const strategies = timeline?.strategies || [];
  const actions = timeline?.actions || [];
  const communications = timeline?.communications || [];
  const auditLogs = timeline?.audit_logs || [];
  const result = timeline?.result;
  const payment = paymentDetails?.payment;
  const gateway = paymentDetails?.gateway_summary;
  const attempts = paymentDetails?.attempts || [];

  const selectedStrategy =
    strategies.find((item) => item.is_selected) || null;
  const selectedType =
    selectedStrategy?.strategy_type || recoveryCase?.selected_strategy;

  const blockedAction = actions.find(
    (item) => upper(item.status) === "BLOCKED"
  );
  const nonBlockedActions = actions.filter(
    (item) => upper(item.status) !== "BLOCKED"
  );
  const commActions = actions.filter((item) =>
    isCommStrategy(item.action_type)
  );
  const latestAction = actions.length
    ? actions[actions.length - 1]
    : null;

  const safetyAudit = auditLogs.find(
    (log) =>
      upper(log.actor).includes("SAFETY") ||
      upper(log.action_type).includes("SAFETY")
  );

  // 1. Payment Failed
  const paymentFailed = makeStage(
    "payment_failed",
    "Payment Failed"
  );
  if (payment?.status === "FAILED" || recoveryCase?.failure_reason) {
    paymentFailed.status = STAGE_STATUS.COMPLETED;
    paymentFailed.timestamp =
      payment?.created_at || recoveryCase?.created_at;
    paymentFailed.detail =
      payment?.failure_reason ||
      recoveryCase?.failure_reason ||
      toLabel(recoveryCase?.failure_category);
  } else if (recoveryCase) {
    paymentFailed.status = STAGE_STATUS.COMPLETED;
    paymentFailed.timestamp = recoveryCase.created_at;
    paymentFailed.detail = recoveryCase.failure_reason;
  }

  // 2. Diagnosis
  const diagnosis = makeStage("diagnosis", "Diagnosis");
  if (recoveryCase?.root_cause) {
    diagnosis.status = STAGE_STATUS.COMPLETED;
    diagnosis.timestamp = recoveryCase.created_at;
    diagnosis.detail = recoveryCase.root_cause;
  } else if (paymentFailed.status === STAGE_STATUS.COMPLETED) {
    diagnosis.status = STAGE_STATUS.PENDING;
    diagnosis.detail = "Awaiting diagnosis from recovery pipeline";
  }

  // 3. Strategy Selection
  const strategyStage = makeStage(
    "strategy_selection",
    "Strategy Selected"
  );
  if (selectedStrategy || recoveryCase?.selected_strategy) {
    strategyStage.status = STAGE_STATUS.COMPLETED;
    strategyStage.timestamp = selectedStrategy?.created_at;
    strategyStage.detail = toLabel(selectedType);
    if (selectedStrategy?.expected_probability != null) {
      strategyStage.detail += ` · ${selectedStrategy.expected_probability}% expected`;
    }
  } else if (strategies.length > 0) {
    strategyStage.status = STAGE_STATUS.PENDING;
    strategyStage.detail = `${strategies.length} strategy option(s) evaluated`;
  } else if (diagnosis.status === STAGE_STATUS.COMPLETED) {
    strategyStage.status = STAGE_STATUS.PENDING;
  }

  // 4. Safety Check
  const safety = makeStage("safety_check", "Safety Check");
  if (blockedAction) {
    safety.status = STAGE_STATUS.FAILED;
    safety.timestamp = blockedAction.created_at;
    safety.detail =
      blockedAction.result_text || "Blocked by Safety Engine";
  } else if (safetyAudit) {
    safety.status = STAGE_STATUS.COMPLETED;
    safety.timestamp = safetyAudit.timestamp;
    safety.detail = auditDetailText(safetyAudit.details);
  } else if (nonBlockedActions.length > 0) {
    safety.status = STAGE_STATUS.COMPLETED;
    safety.timestamp = nonBlockedActions[0].created_at;
    safety.detail = "Action approved by safety rules";
  } else if (strategyStage.status === STAGE_STATUS.COMPLETED) {
    safety.status = STAGE_STATUS.PENDING;
    safety.detail = "Awaiting safety evaluation";
  }

  // 5. Approval / Execution
  const approvalStage = makeStage(
    "approval_execution",
    "Execution"
  );
  if (latestAction) {
    const actionStatus = upper(latestAction.status);
    if (actionStatus === "EXECUTED") {
      approvalStage.status = STAGE_STATUS.COMPLETED;
      approvalStage.detail =
        latestAction.result_text ||
        `${toLabel(latestAction.action_type)} executed`;
    } else if (actionStatus === "FAILED") {
      approvalStage.status = STAGE_STATUS.FAILED;
      approvalStage.detail =
        latestAction.result_text || "Action execution failed";
    } else if (actionStatus === "BLOCKED") {
      approvalStage.status = STAGE_STATUS.FAILED;
      approvalStage.detail =
        latestAction.result_text || "Blocked by Safety Engine";
    } else if (
      recoveryCase?.requires_approval ||
      recoveryCase?.approval_state === "AWAITING_APPROVAL"
    ) {
      approvalStage.status = STAGE_STATUS.IN_PROGRESS;
      approvalStage.detail =
        recoveryCase?.next_step_detail ||
        "Merchant approval required before execution";
    } else if (
      actionStatus === "PROCESSING" ||
      actionStatus === "PENDING"
    ) {
      approvalStage.status = STAGE_STATUS.IN_PROGRESS;
      approvalStage.detail =
        `${toLabel(latestAction.action_type)} is waiting`;
    }
    approvalStage.timestamp =
      latestAction.executed_at || latestAction.created_at;
  } else if (safety.status === STAGE_STATUS.COMPLETED) {
    approvalStage.status = STAGE_STATUS.PENDING;
  }

  // 6. Customer Payment
  const customerPayment = makeStage(
    "customer_payment",
    "Customer Payment"
  );
  const paymentStatus = upper(payment?.status);
  const successAttempt = attempts.find(
    (item) => upper(item.status) === "SUCCESS"
  );
  const awaitingWebhook = gateway?.awaiting_webhook === true;

  if (paymentStatus === "RECOVERED") {
    customerPayment.status = STAGE_STATUS.COMPLETED;
    customerPayment.timestamp =
      successAttempt?.created_at || result?.recovered_at;
    customerPayment.detail = "Customer payment completed";
  } else if (awaitingWebhook) {
    customerPayment.status = STAGE_STATUS.IN_PROGRESS;
    customerPayment.detail =
      "Waiting for the customer to complete payment";
  } else if (
    commActions.some((item) => upper(item.status) === "EXECUTED") ||
    communications.length > 0
  ) {
    customerPayment.status = STAGE_STATUS.IN_PROGRESS;
    customerPayment.detail =
      "Customer was contacted — payment not confirmed yet";
  } else if (isRetryStrategy(selectedType) || isCommStrategy(selectedType)) {
    customerPayment.status = STAGE_STATUS.PENDING;
    customerPayment.detail = "Customer payment has not started";
  } else if (strategyStage.status === STAGE_STATUS.COMPLETED) {
    customerPayment.status = STAGE_STATUS.PENDING;
  }

  // 7. Webhook Verified
  const webhookStage = makeStage(
    "webhook_verified",
    "Webhook Verified"
  );
  const verified =
    paymentStatus === "RECOVERED" ||
    upper(recoveryCase?.status) === "RECOVERED" ||
    gateway?.verified === true;
  if (verified) {
    webhookStage.status = STAGE_STATUS.COMPLETED;
    webhookStage.timestamp =
      result?.recovered_at || recoveryCase?.updated_at;
    webhookStage.detail = "Payment confirmed";
  } else if (awaitingWebhook) {
    webhookStage.status = STAGE_STATUS.IN_PROGRESS;
    webhookStage.detail = "Waiting for payment confirmation";
  } else if (customerPayment.status === STAGE_STATUS.IN_PROGRESS) {
    webhookStage.status = STAGE_STATUS.PENDING;
    webhookStage.detail = "Waiting for payment confirmation";
  }

  // 8. Recovery Confirmed
  const confirmed = makeStage(
    "recovery_confirmed",
    "Recovery Confirmed"
  );
  const resultStatus = upper(result?.status);
  const caseStatus = upper(recoveryCase?.status);

  if (
    caseStatus === "RECOVERED" &&
    resultStatus === "FULLY_RECOVERED"
  ) {
    confirmed.status = STAGE_STATUS.COMPLETED;
    confirmed.timestamp = result?.recovered_at || result?.created_at;
    confirmed.detail = `${formatINR(result.recovered_amount)} confirmed from verified webhook`;
  } else if (resultStatus === "PARTIALLY_RECOVERED") {
    confirmed.status = STAGE_STATUS.IN_PROGRESS;
    confirmed.timestamp = result?.recovered_at || result?.created_at;
    confirmed.detail = `${formatINR(result.recovered_amount)} of ${formatINR(
      result.original_amount
    )} recorded`;
  } else if (caseStatus === "CLOSED") {
    confirmed.status = STAGE_STATUS.FAILED;
    confirmed.detail = "Recovery stopped";
  } else if (caseStatus === "ESCALATED") {
    confirmed.status = STAGE_STATUS.FAILED;
    confirmed.detail =
      recoveryCase?.current_step || "Escalated — not confirmed recovered";
  } else {
    confirmed.status = STAGE_STATUS.PENDING;
    confirmed.detail =
      "Predicted recovery only until a verified webhook confirms it";
  }

  return [
    paymentFailed,
    diagnosis,
    strategyStage,
    safety,
    approvalStage,
    customerPayment,
    webhookStage,
    confirmed,
  ];
}

export function shouldPollRecoveryCase(recoveryCase) {
  if (!recoveryCase) return false;
  const status = upper(recoveryCase.status);
  return status === "ACTIVE" || status === "IN_PROGRESS";
}

export function isBackendRecovered(recoveryCase, result, payment) {
  const caseStatus = upper(recoveryCase?.status);
  const resultStatus = upper(result?.status);
  const paymentStatus = upper(payment?.status);
  return (
    caseStatus === "RECOVERED" &&
    (resultStatus === "FULLY_RECOVERED" || paymentStatus === "RECOVERED")
  );
}
