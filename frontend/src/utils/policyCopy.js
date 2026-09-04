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
      "This payment is large, so the agent did not send anything. " +
      "In Settings choose Manual, open this case, then click Execute."
    );
  }
  if (
    text.includes("rupee limit") ||
    text.includes("exceeds the maximum") ||
    text.includes("automatic recovery amount") ||
    text.includes("above the agent")
  ) {
    return (
      "This payment is above the agent rupee limit, so the agent did not send anything. " +
      "In Settings choose Manual, open this case, then click Execute."
    );
  }
  if (text.includes("retry")) {
    return (
      "The agent already used the allowed payment retries, so it did not charge the original method again. " +
      "A payment link or reminder can still run. Or choose Manual and click Execute."
    );
  }
  if (text.includes("did not send") || text.includes("choose manual")) {
    return String(reason);
  }
  return null;
}

export function policyBannerFromCase(recoveryCase) {
  return friendlyPolicyMessage(
    recoveryCase?.policy_reason || recoveryCase?.next_step_detail
  );
}
