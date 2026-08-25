import StatusBadge from "./StatusBadge";
import { EmptyState } from "./LoadingState";
import { formatDateTime, formatINR } from "../utils/format";
import { toLabel } from "../utils/labels";

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
      title: "Payment Failed",
      description: recoveryCase.failure_reason || "Recovery case opened",
      status: recoveryCase.status,
      timestamp: recoveryCase.created_at,
      meta: toLabel(recoveryCase.failure_category),
    });
  }

  strategies.forEach((strategy) => {
    events.push({
      id: `strategy-${strategy.id}`,
      type: "strategy",
      title: strategy.is_selected ? "Strategy Selected" : "Strategy Evaluated",
      description: strategy.rationale,
      status: strategy.is_selected ? "EXECUTED" : "PENDING",
      timestamp: strategy.created_at,
      meta: toLabel(strategy.strategy_type),
    });
  });

  actions.forEach((action) => {
    events.push({
      id: `action-${action.id}`,
      type: "action",
      title: "Action Created",
      description:
        action.result_text ||
        `${toLabel(action.action_type)} · Attempt ${action.attempt_number}`,
      status: action.status,
      timestamp: action.created_at,
      meta: toLabel(action.action_type),
    });

    if (action.executed_at) {
      events.push({
        id: `action-executed-${action.id}`,
        type: "action",
        title: "Action Executed",
        description:
          action.result_text || `${toLabel(action.action_type)} completed`,
        status: action.status,
        timestamp: action.executed_at,
        meta: toLabel(action.action_type),
      });
    }
  });

  communications.forEach((comm) => {
    events.push({
      id: `comm-${comm.id}`,
      type: "communication",
      title: "Customer Communication",
      description: comm.content,
      status: comm.status,
      timestamp: comm.sent_at,
      meta: `${toLabel(comm.channel)} · ${toLabel(comm.direction)}`,
    });
  });

  if (result) {
    events.push({
      id: `result-${result.id}`,
      type: "result",
      title: "Recovery Result",
      description: `Recovered ${formatINR(result.recovered_amount)} of ${formatINR(result.original_amount)}`,
      status: result.status,
      timestamp: result.recovered_at || result.created_at,
      meta: toLabel(result.recovery_method),
    });
  }

  audit_logs.forEach((log) => {
    events.push({
      id: `audit-${log.id}`,
      type: "audit",
      title: toLabel(log.action_type),
      description: log.details,
      status: null,
      timestamp: log.timestamp,
      meta: toLabel(log.actor),
    });
  });

  return events
    .filter((event) => event.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

const TYPE_STYLES = {
  case: "bg-clay text-white",
  strategy: "bg-skyline text-white",
  action: "bg-sand text-white",
  communication: "bg-ink-soft text-white",
  result: "bg-pine text-white",
  audit: "bg-mist-deep text-ink-soft",
};

function RecoveryTimeline({ timeline }) {
  const events = buildTimelineEvents(timeline);

  if (!events.length) {
    return <EmptyState message="No timeline events available for this case." />;
  }

  return (
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
                <p className="text-sm font-semibold text-ink">{event.title}</p>
                {event.meta && event.meta !== "—" && (
                  <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
                    {event.meta}
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
              <p className="mt-3 text-sm leading-relaxed text-ink-mute">
                {event.description}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default RecoveryTimeline;
