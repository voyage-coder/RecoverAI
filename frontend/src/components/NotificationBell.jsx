import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { getRecentActivity, getRecoveryCases } from "../services/api";
import { formatRelativeTime } from "../utils/format";
import { toLabel } from "../utils/labels";

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [activity, cases] = await Promise.all([
          getRecentActivity(),
          getRecoveryCases(),
        ]);
        const lookup = {};
        (cases || []).forEach((item) => {
          lookup[item.case_number] = item.id;
        });
        if (!cancelled) {
          setItems(
            (activity || []).slice(0, 8).map((row) => ({
              ...row,
              case_id: lookup[row.case_number],
            }))
          );
        }
      } catch {
        if (!cancelled) setItems([]);
      }
    };

    load();
    const id = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        className="relative rounded-xl p-2 text-ink-mute transition hover:bg-mist hover:text-ink"
        aria-label="Notifications"
        onClick={() => setOpen((prev) => !prev)}
      >
        <Bell size={17} />
        {items.length > 0 && (
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-clay" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-2xl border border-ink/10 bg-white p-3 shadow-panel">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Recovery notifications
          </p>
          {items.length === 0 ? (
            <p className="mt-3 px-1 text-sm text-ink-mute">
              No recent case updates.
            </p>
          ) : (
            <ul className="mt-2 max-h-80 space-y-1 overflow-auto">
              {items.map((item) => (
                <li key={`${item.case_number}-${item.updated_at}`}>
                  {item.case_id ? (
                    <Link
                      to={`/cases/${item.case_id}`}
                      onClick={() => setOpen(false)}
                      className="block rounded-xl px-2 py-2 hover:bg-mist-soft"
                    >
                      <p className="font-mono text-xs font-semibold text-ink">
                        {item.case_number}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-mute">
                        {toLabel(item.current_step)} · {toLabel(item.status)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        {formatRelativeTime(item.updated_at)}
                      </p>
                    </Link>
                  ) : (
                    <div className="rounded-xl px-2 py-2">
                      <p className="font-mono text-xs font-semibold text-ink">
                        {item.case_number}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-mute">
                        {toLabel(item.current_step)}
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
