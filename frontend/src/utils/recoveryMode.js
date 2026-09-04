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

/**
 * Show Run Agent only in agent mode for cases that still need recovery.
 * Hidden for RECOVERED, CLOSED, ESCALATED, and awaiting customer payment.
 */
export function isCaseEligibleForRunAgent(
  item,
  { awaitingCustomerPayment = false } = {}
) {
  if (!item) return false;
  const status = upper(item.status);
  if (status === "RECOVERED" || status === "CLOSED" || status === "ESCALATED") {
    return false;
  }
  if (awaitingCustomerPayment) return false;
  const approval = upper(item.approval_state);
  if (approval === "AWAITING_APPROVAL") {
    return false;
  }
  const code = upper(item.next_step_code);
  if (
    code === "AWAITING_CUSTOMER" ||
    code === "CONFIRMED_RECOVERY" ||
    code === "RECOVERY_STOPPED" ||
    code === "ESCALATED"
  ) {
    return false;
  }
  return true;
}

export function runAgentButtonLabel({ running = false } = {}) {
  if (running) return "Running Agent...";
  return "Run Agent";
}
