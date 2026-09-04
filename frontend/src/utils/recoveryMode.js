/** Two merchant-facing modes. Stored values stay MANUAL / AUTOMATIC. */

export const RECOVERY_MODES = [
  {
    id: "MANUAL",
    label: "Manual",
    detail:
      "You run each allowed action from the case or Operations. Best when you want to click through the demo.",
  },
  {
    id: "AUTOMATIC",
    label: "Run agent on every case",
    detail:
      "After saving, each eligible case gets a Run Agent button. One click runs every action Safety and your limits allow on that case — not all cases at once.",
  },
];

export function recoveryModeLabel(mode) {
  const key = String(mode || "MANUAL").toUpperCase();
  if (key === "AUTOMATIC") return "Run agent on every case";
  if (key === "APPROVAL_REQUIRED") return "Manual";
  return "Manual";
}

export function normalizeRecoveryMode(mode) {
  return String(mode || "MANUAL").toUpperCase() === "AUTOMATIC"
    ? "AUTOMATIC"
    : "MANUAL";
}

export function isAgentRecoveryMode(mode) {
  return normalizeRecoveryMode(mode) === "AUTOMATIC";
}

function upper(value) {
  return String(value || "").toUpperCase();
}

const COMMUNICATION_ACTIONS = new Set([
  "SEND_PAYMENT_LINK",
  "SEND_EMAIL_REMINDER",
  "SEND_SMS_REMINDER",
  "SEND_WHATSAPP_MESSAGE",
  "OFFER_ALT_PAYMENT_METHOD",
]);

/**
 * Show Run Agent only in agent mode for cases that still need recovery.
 * Hidden for RECOVERED, CLOSED, ESCALATED.
 * A stale "awaiting customer" flag must not hide Run Agent when a pending
 * action still needs to be sent.
 */
export function isCaseEligibleForRunAgent(
  item,
  { awaitingCustomerPayment = false, hasPendingAction = false } = {}
) {
  if (!item) return false;
  const status = upper(item.status);
  if (status === "RECOVERED" || status === "CLOSED" || status === "ESCALATED") {
    return false;
  }
  const approval = upper(item.approval_state);
  if (approval === "AUTO_ELIGIBLE") {
    return true;
  }
  if (approval === "AWAITING_APPROVAL") {
    return false;
  }
  if (awaitingCustomerPayment && !hasPendingAction) return false;
  const code = upper(item.next_step_code);
  if (
    !hasPendingAction &&
    (code === "AWAITING_CUSTOMER" ||
      code === "CONFIRMED_RECOVERY" ||
      code === "RECOVERY_STOPPED" ||
      code === "ESCALATED")
  ) {
    return false;
  }
  return true;
}

export function needsMerchantExecute(
  item,
  { awaitingCustomerPayment = false, hasPendingAction = false } = {}
) {
  if (!item) return false;
  const status = upper(item.status);
  if (status === "RECOVERED" || status === "CLOSED") {
    return false;
  }
  const approval = upper(item.approval_state);
  if (approval === "AUTO_ELIGIBLE") return false;
  if (
    approval === "AWAITING_APPROVAL" ||
    approval === "READY_TO_EXECUTE"
  ) {
    return true;
  }
  if (hasPendingAction) return true;
  if (awaitingCustomerPayment) return false;
  return false;
}

/**
 * With a pending action, always pick merchant Execute or Run Agent — never neither.
 */
export function pendingStepCta({
  agentMode = false,
  pendingAction = null,
  recoveryCase = null,
  awaitingCustomerPayment = false,
} = {}) {
  const hasPending = Boolean(pendingAction);
  if (!hasPending) {
    return {
      showMerchant: false,
      showAgent: Boolean(
        agentMode &&
          isCaseEligibleForRunAgent(recoveryCase, { awaitingCustomerPayment })
      ),
    };
  }
  if (!agentMode) {
    return { showMerchant: true, showAgent: false };
  }
  const approval = upper(recoveryCase?.approval_state);
  const type = upper(
    pendingAction?.action_type || recoveryCase?.recommended_action
  );
  if (approval === "AUTO_ELIGIBLE") {
    return { showMerchant: false, showAgent: true };
  }
  if (COMMUNICATION_ACTIONS.has(type) && approval !== "BLOCKED") {
    return { showMerchant: true, showAgent: false };
  }
  if (needsMerchantExecute(recoveryCase, { hasPendingAction: true })) {
    return { showMerchant: true, showAgent: false };
  }
  return { showMerchant: true, showAgent: false };
}

export function runAgentButtonLabel({ running = false } = {}) {
  if (running) return "Running Agent...";
  return "Run Agent";
}
