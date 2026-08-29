import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import StatusBadge from "./StatusBadge";
import { EmptyState } from "./LoadingState";
import { formatDateTime, formatINR } from "../utils/format";
import { toLabel } from "../utils/labels";

function toneForEventType(eventType) {
  const key = String(eventType || "").toUpperCase();
  if (key.includes("RECOVERED") || key.includes("CAPTURED")) return "success";
  if (key.includes("ESCALAT") || key.includes("BLOCKED") || key.includes("FAILED"))
    return "danger";
  if (key.includes("AWAITING") || key.includes("ORDER")) return "warning";
  if (key.includes("DIAGNOSIS") || key.includes("STRATEGY") || key.includes("ACTION"))
    return "info";
  return "neutral";
}

function LiveEventFeed({ events = [], emptyMessage = "No live events yet." }) {
  if (!events.length) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <ul className="space-y-2">
      {events.map((event) => (
        <li
          key={event.id}
          className="rounded-xl border border-ink/8 bg-mist-soft/50 px-4 py-3.5 transition hover:border-ink/12 hover:bg-white"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-[11px] text-ink-faint">
                  {formatDateTime(event.timestamp)}
                </p>
                <StatusBadge
                  value={event.eventType}
                  label={event.eventType}
                  tone={toneForEventType(event.eventType)}
                />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="font-mono text-sm font-semibold text-ink">
                  {event.caseNumber}
                </p>
                {event.caseStatus && (
                  <StatusBadge value={event.caseStatus} />
                )}
                {event.failureCategory && (
                  <span className="text-xs text-ink-mute">
                    {toLabel(event.failureCategory)}
                  </span>
                )}
              </div>

              <p className="mt-1.5 text-sm text-ink-mute">{event.description}</p>

              {event.amount != null && (
                <p className="mt-1 font-mono text-xs text-ink-faint">
                  {formatINR(event.amount)}
                </p>
              )}
            </div>

            {event.caseId && (
              <Link
                to={`/cases/${event.caseId}?from=live`}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-pine hover:underline"
              >
                View case
                <ArrowUpRight size={12} />
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default LiveEventFeed;
