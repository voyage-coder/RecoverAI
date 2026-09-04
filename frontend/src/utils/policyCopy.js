export function friendlyPolicyMessage(reason) {
  const text = String(reason || "").toLowerCase();
  if (!text) return null;
  if (
    text.includes("large") ||
    text.includes("high-value") ||
    text.includes("high value") ||
    text.includes("high-value approval")
  ) {
    return (
      "This payment is large, so the agent did not charge the original method. " +
      "If a payment link is waiting, click Execute on this case to send it."
    );
  }
  if (
    text.includes("rupee limit") ||
    text.includes("exceeds the maximum") ||
    text.includes("automatic recovery amount") ||
    text.includes("above the agent")
  ) {
    return (
      "This payment is above the agent rupee limit, so the agent did not charge the original method. " +
      "If a payment link is waiting, click Execute on this case to send it."
    );
  }
  if (text.includes("retry")) {
    return (
      "The agent already used the allowed payment retries, so it did not charge the original method again. " +
      "If a payment link is waiting, click Execute on this case to send it."
    );
  }
  if (text.includes("did not send") || text.includes("choose manual")) {
    return String(reason);
  }
  return null;
}

export function policyBannerFromCase(recoveryCase, { pendingType } = {}) {
  const type = String(
    pendingType || recoveryCase?.recommended_action || ""
  ).toUpperCase();
  const approval = String(recoveryCase?.approval_state || "").toUpperCase();
  if (type === "SEND_PAYMENT_LINK" && approval === "AUTO_ELIGIBLE") {
    return "Click Run Agent to send this payment link.";
  }
  if (type === "SEND_PAYMENT_LINK") {
    return "Click Send payment link to send it. You do not need to switch to Manual.";
  }
  return friendlyPolicyMessage(
    recoveryCase?.policy_reason || recoveryCase?.next_step_detail
  );
}
