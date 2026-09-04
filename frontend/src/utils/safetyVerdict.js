function upper(value) {
  return String(value || "").toUpperCase();
}

function auditLooksBlocked(log) {
  const type = upper(log?.action_type);
  const details = String(log?.details || "");
  if (type.includes("SAFETY") && /BLOCKED|NOT_EXECUTED|DID NOT ALLOW/i.test(details)) {
    return true;
  }
  return false;
}

/**
 * Plain-language Safety Engine result for the selected recovery plan.
 */
export function planSafetyVerdict({ timeline, decision } = {}) {
  const actions = timeline?.actions || [];
  const audits = timeline?.audit_logs || [];
  const selectedType = upper(
    timeline?.strategies?.find((item) => item.is_selected)?.strategy_type ||
      timeline?.case?.selected_strategy ||
      decision?.selected_strategy
  );

  const matching = selectedType
    ? actions.filter((item) => upper(item.action_type) === selectedType)
    : [];
  const pool = matching.length ? matching : actions;
  const latest = pool.length ? pool[pool.length - 1] : null;
  const latestStatus = upper(latest?.status);

  const safetyAudit = [...audits]
    .reverse()
    .find((log) => upper(log.action_type).includes("SAFETY"));

  const apiDecision = decision?.safety?.decision;
  const blockedText =
    latestStatus === "BLOCKED"
      ? latest?.result_text
      : decision?.safety?.blocked_result_text ||
        (safetyAudit && auditLooksBlocked(safetyAudit) ? safetyAudit.details : null);

  if (latestStatus === "BLOCKED" || apiDecision === "Blocked") {
    return {
      passed: false,
      label: "Did not pass",
      short: "Safety check: did not pass",
      detail:
        blockedText ||
        "The Safety Engine blocked this plan. It was not executed.",
      at: latest?.created_at || safetyAudit?.timestamp,
    };
  }

  if (
    safetyAudit &&
    /NOT_EXECUTED|did not allow/i.test(String(safetyAudit.details || ""))
  ) {
    return {
      passed: false,
      label: "Did not pass policy",
      short: "Policy check: did not pass",
      detail:
        String(safetyAudit.details) ||
        "Merchant policy (amount cap or high-value) stopped the agent.",
      at: safetyAudit.timestamp,
    };
  }

  if (
    ["EXECUTED", "PENDING", "PROCESSING"].includes(latestStatus) ||
    apiDecision === "Allowed"
  ) {
    return {
      passed: true,
      label: "Passed",
      short: "Safety check: passed",
      detail:
        "The Safety Engine allowed the selected plan. Executed is not the same as recovered.",
      at: latest?.created_at || safetyAudit?.timestamp,
    };
  }

  return {
    passed: null,
    label: "Not checked yet",
    short: "Safety check: not recorded yet",
    detail:
      "Run Agent or prepare an action to see whether Safety allows this plan.",
    at: null,
  };
}
