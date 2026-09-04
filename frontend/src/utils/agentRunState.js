const PREFIX = "recoverai.agentRun.";
const MAX_MS = 300000;

function key(caseId) {
  return `${PREFIX}${caseId}`;
}

export function markAgentRunStarted(caseId) {
  if (!caseId) return;
  try {
    window.localStorage.setItem(key(caseId), String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function clearAgentRunStarted(caseId) {
  if (!caseId) return;
  try {
    window.localStorage.removeItem(key(caseId));
  } catch {
    /* ignore */
  }
}

export function isLocalAgentRunActive(caseId, maxMs = MAX_MS) {
  if (!caseId) return false;
  try {
    const started = Number(window.localStorage.getItem(key(caseId)) || 0);
    if (!started) return false;
    if (Date.now() - started > maxMs) {
      window.localStorage.removeItem(key(caseId));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function actionIsProcessing(item) {
  return String(item?.status || item?.action_status || "").toUpperCase() ===
    "PROCESSING";
}

export function timelineHasProcessing(timeline) {
  return (timeline?.actions || []).some((item) => actionIsProcessing(item));
}

export function isAgentBusy({
  operating = false,
  timeline,
  caseId,
  actionStatus,
} = {}) {
  return (
    Boolean(operating) ||
    timelineHasProcessing(timeline) ||
    actionIsProcessing({ action_status: actionStatus }) ||
    isLocalAgentRunActive(caseId)
  );
}

export function isCaseRowBusy(item, executingId) {
  const id = item?.id;
  return (
    executingId === id ||
    isAgentBusy({
      caseId: id,
      actionStatus: item?.action_status,
    })
  );
}

export function shouldKeepAgentRunMark(error) {
  const status = error?.response?.status;
  const timedOut =
    error?.code === "ECONNABORTED" ||
    /timeout/i.test(String(error?.message || ""));
  return timedOut || status === 409;
}
