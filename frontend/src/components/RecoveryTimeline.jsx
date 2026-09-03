import { EmptyState } from "./LoadingState";
import { formatDateTime } from "../utils/format";
import { toLabel } from "../utils/labels";
import { VerticalStepItem, VerticalStepList } from "./VerticalStepList";

function upper(value) {
  return String(value || "").toUpperCase();
}

function shortText(value, max = 72) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}…`;
}

function runnerFromResult(text) {
  const value = String(text || "");
  if (value.startsWith("[Automatic agent]")) return "Automatic agent";
  if (value.startsWith("[Merchant]")) return "Merchant";
  return null;
}

function stripRunnerPrefix(text) {
  return String(text || "")
    .replace(/^\[Automatic agent\]\s*/i, "")
    .replace(/^\[Merchant\]\s*/i, "")
    .trim();
}
  const key = upper(status);
  if (key === "EXECUTED") {
    return { title: "Action succeeded", badge: "Succeeded", tone: "success", status: "SUCCESS" };
  }
  if (key === "BLOCKED" || key === "FAILED") {
    return { title: "Action failed", badge: "Failed", tone: "danger", status: "FAILED" };
  }
  if (key === "PENDING" || key === "PROCESSING") {
    return { title: "Action waiting", badge: "Waiting", tone: "warning", status: "PENDING" };
  }
  return { title: "Action created", badge: "Created", tone: "neutral", status: "CREATED" };
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
  } = timeline;

  if (recoveryCase) {
    events.push({
      id: `case-created-${recoveryCase.id}`,
      title: "Payment failed",
      description: shortText(recoveryCase.failure_reason),
      status: "FAILED",
      badge: "Failed",
      tone: "danger",
      timestamp: recoveryCase.created_at,
    });
  }

  strategies
    .filter((strategy) => strategy.is_selected)
    .forEach((strategy) => {
      events.push({
        id: `strategy-${strategy.id}`,
        title: "Action selected",
        description: toLabel(strategy.strategy_type),
        status: "SELECTED",
        badge: "Selected",
        tone: "info",
        timestamp: strategy.created_at,
      });
    });

  if (
    !strategies.some((strategy) => strategy.is_selected) &&
    recoveryCase?.selected_strategy
  ) {
    events.push({
      id: `strategy-case-${recoveryCase.id}`,
      title: "Action selected",
      description: toLabel(recoveryCase.selected_strategy),
      status: "SELECTED",
      badge: "Selected",
      tone: "info",
      timestamp: recoveryCase.created_at,
    });
  }

  actions.forEach((action) => {
    const label = toLabel(action.action_type);
    const status = upper(action.status);
    const outcome = actionOutcome(status);

    events.push({
      id: `action-created-${action.id}`,
      title: "Action created",
      description: label,
      status: "CREATED",
      badge: "Created",
      tone: "warning",
      timestamp: action.created_at,
    });

    const outcomeKnown =
      status === "EXECUTED" ||
      status === "BLOCKED" ||
      status === "FAILED";

    if (outcomeKnown) {
      const runner = runnerFromResult(action.result_text);
      events.push({
        id: `action-outcome-${action.id}`,
        title: runner
          ? `${outcome.title} · ${runner}`
          : outcome.title,
        description: shortText(stripRunnerPrefix(action.result_text)) || label,
        status: outcome.status,
        badge: runner || outcome.badge,
        tone: runner === "Automatic agent" ? "info" : outcome.tone,
        timestamp: action.executed_at || action.created_at,
      });
    } else if (status === "PENDING" || status === "PROCESSING") {
      events.push({
        id: `action-waiting-${action.id}`,
        title: outcome.title,
        description: label,
        status: outcome.status,
        badge: outcome.badge,
        tone: outcome.tone,
        timestamp: action.created_at,
      });
    }
  });

  communications.forEach((comm) => {
    events.push({
      id: `comm-${comm.id}`,
      title: "Customer notified",
      description: toLabel(comm.channel),
      status: comm.status,
      badge: toLabel(comm.status),
      tone: "neutral",
      timestamp: comm.sent_at,
    });
  });

  if (result) {
    const recovered = upper(result.status) === "FULLY_RECOVERED";
    events.push({
      id: `result-${result.id}`,
      title: recovered ? "Payment recovered" : "Recovery result",
      description: recovered
        ? "Verified payment received"
        : toLabel(result.status),
      status: recovered ? "SUCCESS" : result.status,
      badge: recovered ? "Recovered" : toLabel(result.status),
      tone: recovered ? "success" : "neutral",
      timestamp: result.recovered_at || result.created_at,
    });
  }

  return events
    .filter((event) => event.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function RecoveryTimeline({ timeline }) {
  const events = buildTimelineEvents(timeline);

  if (!events.length) {
    return <EmptyState message="No timeline events yet." />;
  }

  return (
    <VerticalStepList>
      {events.map((event, index) => (
        <VerticalStepItem
          key={event.id}
          index={index + 1}
          isLast={index === events.length - 1}
          status={event.status}
          title={event.title}
          detail={event.description}
          badge={event.badge}
          badgeTone={event.tone}
          right={
            <span className="font-mono text-[11px] text-ink-faint">
              {formatDateTime(event.timestamp)}
            </span>
          }
        />
      ))}
    </VerticalStepList>
  );
}

export default RecoveryTimeline;
