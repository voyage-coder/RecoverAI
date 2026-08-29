import StatusBadge from "./StatusBadge";
import { EmptyState } from "./LoadingState";
import { formatDateTime, formatINR } from "../utils/format";
import { toLabel } from "../utils/labels";

const FLOW_STAGES = [
  "Payment Failed",
  "Diagnosis",
  "AI Prediction",
  "Strategy",
  "Safety",
  "Merchant Execution",
  "Customer Payment",
  "Webhook Verification",
  "Revenue Recovered",
];

function stageForEvent(event) {
  return event.stage || "Merchant Execution";
}

function buildTimelineEvents(timeline) {
  if (!timeline) return [];

  const events = [];
  const {
    case: recoveryCase,
    strategies = [],
    actions = [],
    communications = [],
    result,
    audit_logs = [],
  } = timeline;

  if (recoveryCase) {
    events.push({
      id: `case-created-${recoveryCase.id}`,
      type: "case",
      stage: "Payment Failed",
      title: "Payment failed",
      description: recoveryCase.failure_reason || "Recovery case opened",
      status: recoveryCase.status,
      timestamp: recoveryCase.created_at,
      meta: toLabel(recoveryCase.failure_category),
      source: "recovery_cases",
    });

    if (recoveryCase.root_cause) {
      events.push({
        id: `diagnosis-${recoveryCase.id}`,
        type: "diagnosis",
        stage: "Diagnosis",
        title: "Diagnosis",
        description: recoveryCase.root_cause,
        status: null,
        timestamp: recoveryCase.created_at,
        meta: toLabel(recoveryCase.failure_category),
        source: "recovery_cases.root_cause",
      });
    }

    if (recoveryCase.recovery_probability != null) {
      events.push({
        id: `prediction-${recoveryCase.id}`,
        type: "prediction",
        stage: "AI Prediction",
        title: "Model prediction",
        description: `Recovery probability ${recoveryCase.recovery_probability}% — prediction, not a guarantee`,
        status: null,
        timestamp: recoveryCase.created_at,
        meta:
          recoveryCase.ai_confidence != null
            ? `Confidence ${recoveryCase.ai_confidence}%`
            : null,
        source: "recovery_cases.recovery_probability",
      });
    }
  }

  strategies.forEach((strategy) => {
    events.push({
      id: `strategy-${strategy.id}`,
      type: "strategy",
      stage: "Strategy",
      title: strategy.is_selected ? "Strategy selected" : "Strategy evaluated",
      description: strategy.rationale,
      status: strategy.is_selected ? "EXECUTED" : "PENDING",
      timestamp: strategy.created_at,
      meta: toLabel(strategy.strategy_type),
      source: "recovery_strategies",
    });
  });

  audit_logs.forEach((log) => {
    const actor = String(log.actor || "").toUpperCase();
    const actionType = String(log.action_type || "").toUpperCase();
    const isSafety =
      actor.includes("SAFETY") || actionType.includes("SAFETY");

    events.push({
      id: `audit-${log.id}`,
      type: isSafety ? "safety" : "audit",
      stage: isSafety ? "Safety" : "Merchant Execution",
      title: isSafety ? "Safety check" : toLabel(log.action_type),
      description:
        typeof log.details === "string"
          ? log.details
          : JSON.stringify(log.details),
      status: null,
      timestamp: log.timestamp,
      meta: toLabel(log.actor),
      source: "audit_logs",
    });
  });

  actions.forEach((action) => {
    const actionLabel = toLabel(action.action_type);
    const status = String(action.status || "").toUpperCase();
    const stage =
      status === "BLOCKED" ? "Safety" : "Merchant Execution";

    events.push({
      id: `action-${action.id}`,
      type: "action",
      stage,
      title:
        status === "BLOCKED"
          ? "Action blocked by Safety Engine"
          : "Recovery action created",
      description:
        action.result_text ||
        `${actionLabel} · Attempt ${action.attempt_number}`,
      status: action.status,
      timestamp: action.created_at,
      meta: actionLabel,
      source: "recovery_actions",
    });

    if (action.executed_at) {
      events.push({
        id: `action-executed-${action.id}`,
        type: "action",
        stage: "Merchant Execution",
        title: "Merchant execution",
        description: action.result_text || `${actionLabel} completed`,
        status: action.status,
        timestamp: action.executed_at,
        meta: actionLabel,
        source: "recovery_actions.executed_at",
      });
    }
  });

  communications.forEach((comm) => {
    events.push({
      id: `comm-${comm.id}`,
      type: "communication",
      stage: "Customer Payment",
      title: "Customer communication",
      description: comm.content,
      status: comm.status,
      timestamp: comm.sent_at,
      meta: `${toLabel(comm.channel)} · ${toLabel(comm.direction)}`,
      source: "communications",
    });
  });

  if (result) {
    const status = String(result.status || "").toUpperCase();
    const recovered = status === "FULLY_RECOVERED";

    events.push({
      id: `result-${result.id}`,
      type: "result",
      stage: recovered ? "Revenue Recovered" : "Webhook Verification",
      title: recovered ? "Revenue recovered" : "Recovery result recorded",
      description: `Recovered ${formatINR(result.recovered_amount)} of ${formatINR(result.original_amount)}`,
      status: result.status,
      timestamp: result.recovered_at || result.created_at,
      meta: toLabel(result.recovery_method),
      source: "recovery_results",
    });

    if (recovered && result.recovered_at) {
      events.push({
        id: `webhook-${result.id}`,
        type: "webhook",
        stage: "Webhook Verification",
        title: "Webhook verification",
        description:
          "Payment confirmation applied from verified provider webhook",
        status: "VERIFIED",
        timestamp: result.recovered_at,
        meta: formatINR(result.recovered_amount),
        source: "recovery_results.recovered_at",
      });
    }
  }

  return events
    .filter((event) => event.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

const TYPE_STYLES = {
  case: "bg-clay text-white",
  diagnosis: "bg-skyline text-white",
  prediction: "bg-skyline text-white",
  strategy: "bg-skyline text-white",
  safety: "bg-sand text-white",
  action: "bg-sand text-white",
  communication: "bg-ink-soft text-white",
  result: "bg-pine text-white",
  webhook: "bg-pine text-white",
  audit: "bg-mist-deep text-ink-soft",
};

function RecoveryTimeline({ timeline }) {
  const events = buildTimelineEvents(timeline);
  const presentStages = new Set(events.map(stageForEvent));

  if (!events.length) {
    return <EmptyState message="No timeline events available for this case." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {FLOW_STAGES.map((stage) => {
          const active = presentStages.has(stage);
          return (
            <span
              key={stage}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold tracking-wide ring-1 ring-inset ${
                active
                  ? "bg-pine-soft text-pine ring-pine/20"
                  : "bg-mist-soft text-ink-faint ring-ink/5"
              }`}
            >
              {stage}
            </span>
          );
        })}
      </div>

      <ol className="relative space-y-4 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-gradient-to-b before:from-ink/15 before:via-ink/10 before:to-transparent">
        {events.map((event) => (
          <li key={event.id} className="relative pl-10">
            <span
              className={`absolute left-1.5 top-4 flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold shadow-panel ${TYPE_STYLES[event.type] || TYPE_STYLES.audit}`}
            >
              •
            </span>

            <div className="rounded-2xl border border-ink/10 bg-white p-4 shadow-panel transition hover:border-ink/15">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-pine">
                    {stageForEvent(event)}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {event.title}
                  </p>
                  {event.meta && event.meta !== "—" && (
                    <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
                      {event.meta}
                    </p>
                  )}
                  {event.source && (
                    <p className="mt-1 font-mono text-[10px] text-ink-faint">
                      source: {event.source}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {event.status && <StatusBadge value={event.status} />}
                  <span className="font-mono text-[11px] text-ink-faint">
                    {formatDateTime(event.timestamp)}
                  </span>
                </div>
              </div>

              {event.description && (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-mute">
                  {event.description}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default RecoveryTimeline;
