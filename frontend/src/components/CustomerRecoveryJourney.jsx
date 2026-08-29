import StatusBadge from "./StatusBadge";
import { STAGE_STATUS } from "../utils/recoveryStages";

const STATUS_LABELS = {
  COMPLETED: "Completed",
  IN_PROGRESS: "In Progress",
  PENDING: "Pending",
  FAILED: "Failed",
  BLOCKED: "Blocked",
  NOT_AVAILABLE: "Not Available",
  SKIPPED: "Skipped",
};

function CustomerRecoveryJourney({ stages = [] }) {
  if (!stages.length) return null;

  return (
    <ol className="space-y-0">
      {stages.map((stage, index) => {
        const isLast = index === stages.length - 1;
        const status = stage.status || STAGE_STATUS.NOT_AVAILABLE;

        return (
          <li key={stage.key} className={`relative pl-8 ${isLast ? "" : "pb-4"}`}>
            {!isLast && (
              <span
                className="absolute bottom-0 left-[11px] top-6 w-px bg-ink/10"
                aria-hidden
              />
            )}
            <span
              className={`absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ring-1 ring-inset ${
                status === STAGE_STATUS.COMPLETED
                  ? "bg-pine text-white ring-pine/30"
                  : status === STAGE_STATUS.IN_PROGRESS
                    ? "bg-sand text-white ring-sand/30"
                    : status === STAGE_STATUS.BLOCKED ||
                        status === STAGE_STATUS.FAILED
                      ? "bg-clay text-white ring-clay/30"
                      : "bg-white text-ink-faint ring-ink/10"
              }`}
            >
              {index + 1}
            </span>
            <div className="rounded-xl border border-ink/8 bg-mist-soft/40 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink">{stage.name}</p>
                <StatusBadge
                  value={status}
                  label={STATUS_LABELS[status] || status}
                  tone={
                    status === STAGE_STATUS.COMPLETED
                      ? "success"
                      : status === STAGE_STATUS.IN_PROGRESS
                        ? "warning"
                        : status === STAGE_STATUS.FAILED ||
                            status === STAGE_STATUS.BLOCKED
                          ? "danger"
                          : "neutral"
                  }
                />
              </div>
              {stage.detail && (
                <p className="mt-1.5 text-sm text-ink-mute">{stage.detail}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default CustomerRecoveryJourney;
