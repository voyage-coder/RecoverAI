import { formatDateTime } from "../utils/format";
import { formatActivityLine } from "../utils/recoveryActivity";
import { EmptyState } from "./LoadingState";

function RecoveryActivityFeed({ events = [] }) {
  if (!events.length) {
    return (
      <EmptyState message="No recovery activity recorded yet for this case." />
    );
  }

  return (
    <ul className="space-y-2">
      {events.map((event) => (
        <li
          key={event.id}
          className="rounded-xl border border-ink/8 bg-mist-soft/60 px-4 py-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-mono text-[11px] text-ink-faint">
              {formatDateTime(event.timestamp)}
            </p>
          </div>
          <p className="mt-1 text-sm font-medium text-ink">{event.title}</p>
          <p className="mt-1 text-sm text-ink-mute">
            {formatActivityLine(event)}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default RecoveryActivityFeed;
