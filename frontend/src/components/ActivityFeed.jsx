import { Link } from "react-router-dom";
import StatusBadge from "./StatusBadge";
import { EmptyState } from "./LoadingState";
import {
  formatRelativeTime,
  formatDateTime,
  formatINR,
} from "../utils/format";
import { toLabel } from "../utils/labels";

function ActivityFeed({ items = [], showEmpty = true }) {
  if (!items.length) {
    return showEmpty ? (
      <EmptyState message="No recent activity found." />
    ) : null;
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => {
        const key = `${item.case_number || "case"}-${item.updated_at || index}`;

        return (
          <li
            key={key}
            className="flex flex-col gap-3 rounded-2xl border border-ink/5 bg-mist-soft/70 px-4 py-3.5 transition hover:border-ink/10 hover:bg-white sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {item.case_id ? (
                  <Link
                    to={`/cases/${item.case_id}`}
                    className="font-mono text-sm font-medium text-ink hover:text-pine"
                  >
                    {item.case_number}
                  </Link>
                ) : (
                  <span className="font-mono text-sm font-medium text-ink">
                    {item.case_number}
                  </span>
                )}
                <StatusBadge value={item.status} />
              </div>
              <p className="mt-1.5 text-xs text-ink-mute">
                {toLabel(item.current_step)}
              </p>
              {item.amount_at_risk != null && (
                <p className="mt-1 font-mono text-[11px] text-ink-faint">
                  At risk {formatINR(item.amount_at_risk)}
                </p>
              )}
            </div>

            <div className="shrink-0 text-left sm:text-right">
              <p className="text-xs font-medium text-ink-soft">
                {formatRelativeTime(item.updated_at)}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                {formatDateTime(item.updated_at)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default ActivityFeed;
