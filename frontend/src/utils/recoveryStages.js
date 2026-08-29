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
  const retryActions = actions.filter((item) =>
    isRetryStrategy(item.action_type)
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
    "Strategy Selection"
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

  // 5. Recovery Action
  const actionStage = makeStage("recovery_action", "Recovery Action");
  if (latestAction) {
    const actionStatus = upper(latestAction.status);
    if (actionStatus === "EXECUTED") {
      actionStage.status = STAGE_STATUS.COMPLETED;
    } else if (actionStatus === "FAILED") {
      actionStage.status = STAGE_STATUS.FAILED;
    } else if (
      actionStatus === "PROCESSING" ||
      actionStatus === "PENDING"
    ) {
      actionStage.status = STAGE_STATUS.IN_PROGRESS;
    } else if (actionStatus === "BLOCKED") {
      actionStage.status = STAGE_STATUS.FAILED;
    }
    actionStage.timestamp =
      latestAction.executed_at || latestAction.created_at;
    actionStage.detail =
      latestAction.result_text ||
      `${toLabel(latestAction.action_type)} · attempt ${latestAction.attempt_number}`;
  } else if (safety.status === STAGE_STATUS.COMPLETED) {
    actionStage.status = STAGE_STATUS.PENDING;
  }

  // 6. Customer Communication
  const communication = makeStage(
    "customer_communication",
    "Customer Communication"
  );
  if (communications.length > 0) {
    communication.status = STAGE_STATUS.COMPLETED;
    communication.timestamp =
      communications[communications.length - 1].sent_at;
    communication.detail = `${communications.length} outbound message(s) recorded`;
  } else if (
    commActions.some((item) => upper(item.status) === "EXECUTED")
  ) {
    communication.status = STAGE_STATUS.COMPLETED;
    communication.timestamp = commActions.find(
      (item) => upper(item.status) === "EXECUTED"
    )?.executed_at;
    communication.detail = "Communication action executed";
  } else if (
    commActions.some(
      (item) =>
        upper(item.status) === "PENDING" ||
        upper(item.status) === "PROCESSING"
    )
  ) {
    communication.status = STAGE_STATUS.IN_PROGRESS;
    communication.detail = "Communication action in progress";
  } else if (isCommStrategy(selectedType)) {
    communication.status = STAGE_STATUS.PENDING;
    communication.detail = "Communication strategy selected, not yet sent";
  } else if (
    strategyStage.status === STAGE_STATUS.COMPLETED &&
    !isCommStrategy(selectedType)
  ) {
    communication.status = STAGE_STATUS.SKIPPED;
    communication.detail = "Selected strategy does not require outreach";
  }

  // 7. Payment Recovery
  const paymentRecovery = makeStage(
    "payment_recovery",
    "Payment Recovery"
  );
  const paymentStatus = upper(payment?.status);
  const successAttempt = attempts.find(
    (item) => upper(item.status) === "SUCCESS"
  );
  const awaitingWebhook = gateway?.awaiting_webhook === true;

  if (paymentStatus === "RECOVERED" || successAttempt) {
    paymentRecovery.status = STAGE_STATUS.COMPLETED;
    paymentRecovery.timestamp =
      successAttempt?.created_at || result?.recovered_at;
    paymentRecovery.detail =
      paymentStatus === "RECOVERED"
        ? "Payment marked recovered"
        : "Successful payment attempt recorded";
  } else if (awaitingWebhook) {
    paymentRecovery.status = STAGE_STATUS.IN_PROGRESS;
    paymentRecovery.detail = "Awaiting Razorpay webhook confirmation";
    paymentRecovery.timestamp = successAttempt?.created_at;
  } else if (
    retryActions.some((item) => upper(item.status) === "EXECUTED")
  ) {
    const lastRetry = retryActions[retryActions.length - 1];
    paymentRecovery.status = STAGE_STATUS.IN_PROGRESS;
    paymentRecovery.timestamp =
      lastRetry.executed_at || lastRetry.created_at;
    paymentRecovery.detail =
      lastRetry.result_text || toLabel(lastRetry.action_type);
  } else if (
    retryActions.some(
      (item) =>
        upper(item.status) === "PENDING" ||
        upper(item.status) === "PROCESSING"
    )
  ) {
    paymentRecovery.status = STAGE_STATUS.IN_PROGRESS;
    paymentRecovery.detail = "Payment retry in progress";
  } else if (isRetryStrategy(selectedType)) {
    paymentRecovery.status = STAGE_STATUS.PENDING;
    paymentRecovery.detail = "Retry strategy selected";
  } else if (
    strategyStage.status === STAGE_STATUS.COMPLETED &&
    !isRetryStrategy(selectedType)
  ) {
    paymentRecovery.status = STAGE_STATUS.SKIPPED;
    paymentRecovery.detail = "Recovery path does not include payment retry";
  }

  // 8. Final Result
  const finalResult = makeStage("final_result", "Final Result");
  const resultStatus = upper(result?.status);
  const caseStatus = upper(recoveryCase?.status);

  if (
    caseStatus === "RECOVERED" &&
    resultStatus === "FULLY_RECOVERED"
  ) {
    finalResult.status = STAGE_STATUS.COMPLETED;
    finalResult.timestamp = result?.recovered_at || result?.created_at;
    finalResult.detail = `${formatINR(result.recovered_amount)} recovered · ${toLabel(
      result.recovery_method
    )}`;
  } else if (resultStatus === "PARTIALLY_RECOVERED") {
    finalResult.status = STAGE_STATUS.COMPLETED;
    finalResult.timestamp = result?.recovered_at || result?.created_at;
    finalResult.detail = `${formatINR(result.recovered_amount)} of ${formatINR(
      result.original_amount
    )} recovered`;
  } else if (resultStatus === "NOT_RECOVERED") {
    finalResult.status = STAGE_STATUS.COMPLETED;
    finalResult.timestamp = result?.created_at;
    finalResult.detail = `${formatINR(
      recoveryCase?.amount_at_risk ?? result.original_amount
    )} remains at risk`;
  } else if (caseStatus === "CLOSED") {
    finalResult.status = STAGE_STATUS.COMPLETED;
    finalResult.timestamp = recoveryCase?.updated_at;
    finalResult.detail = "Case closed";
  } else if (caseStatus === "ESCALATED") {
    finalResult.status = STAGE_STATUS.FAILED;
    finalResult.timestamp = recoveryCase?.updated_at;
    finalResult.detail =
      recoveryCase?.current_step || "Escalated for human follow-up";
  } else if (
    caseStatus === "ACTIVE" ||
    caseStatus === "IN_PROGRESS" ||
    resultStatus === "PENDING"
  ) {
    finalResult.status = STAGE_STATUS.IN_PROGRESS;
    finalResult.detail =
      recoveryCase?.current_step || "Recovery pipeline running";
  }

  return [
    paymentFailed,
    diagnosis,
    strategyStage,
    safety,
    actionStage,
    communication,
    paymentRecovery,
    finalResult,
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
