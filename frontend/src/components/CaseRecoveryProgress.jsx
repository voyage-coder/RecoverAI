import { formatDateTime } from "../utils/format";
import { toLabel } from "../utils/labels";
import { STAGE_STATUS } from "../utils/recoveryStages";

const STATUS_STYLES = {
  COMPLETED: "bg-pine-soft text-pine ring-pine/20",
  IN_PROGRESS: "bg-sand-soft text-sand ring-sand/20",
  PENDING: "bg-mist text-ink-mute ring-ink/10",
  SKIPPED: "bg-mist-soft text-ink-faint ring-ink/5",
  FAILED: "bg-clay-soft text-clay ring-clay/15",
  NOT_AVAILABLE: "bg-mist-soft text-ink-faint ring-ink/5",
};

const STATUS_LABELS = {
  COMPLETED: "Completed",
  IN_PROGRESS: "In Progress",
  PENDING: "Pending",
  SKIPPED: "Skipped",
  FAILED: "Failed",
  NOT_AVAILABLE: "Not Available",
};

function StageStatusChip({ status }) {
  const key = status || STAGE_STATUS.NOT_AVAILABLE;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-lg px-2 py-0.5 text-[10px] font-semibold tracking-wide ring-1 ring-inset ${
        STATUS_STYLES[key] || STATUS_STYLES.NOT_AVAILABLE
      }`}
    >
      {STATUS_LABELS[key] || toLabel(key)}
    </span>
  );
}

function CaseRecoveryProgress({ stages = [] }) {
  if (!stages.length) {
    return null;
  }

  return (
    <div className="space-y-4">
      <ol className="relative space-y-0">
        {stages.map((stage, index) => {
          const isLast = index === stages.length - 1;
          const timestamp = stage.timestamp
            ? formatDateTime(stage.timestamp)
            : null;

          return (
            <li
              key={stage.key}
              className={`relative pl-9 ${isLast ? "" : "pb-4"}`}
            >
              {!isLast && (
                <span
                  className="absolute bottom-0 left-[11px] top-6 w-px bg-ink/10"
                  aria-hidden
                />
              )}
              <span
                className={`absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ring-1 ring-inset ${
                  stage.status === STAGE_STATUS.COMPLETED
                    ? "bg-pine text-white ring-pine/30"
                    : stage.status === STAGE_STATUS.IN_PROGRESS
                      ? "bg-sand text-white ring-sand/30"
                      : stage.status === STAGE_STATUS.FAILED
                        ? "bg-clay text-white ring-clay/30"
                        : "bg-white text-ink-faint ring-ink/10"
                }`}
              >
                {index + 1}
              </span>

              <div className="rounded-xl border border-ink/8 bg-mist-soft/50 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">
                    {stage.name}
                  </p>
                  <StageStatusChip status={stage.status} />
                </div>

                {stage.detail && (
                  <p className="mt-2 text-sm leading-relaxed text-ink-mute">
                    {stage.detail}
                  </p>
                )}

                {timestamp && timestamp !== "—" && (
                  <p className="mt-2 font-mono text-[11px] text-ink-faint">
                    {timestamp}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default CaseRecoveryProgress;
