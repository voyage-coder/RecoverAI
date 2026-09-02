import StatusBadge from "./StatusBadge";
import { STAGE_STATUS } from "../utils/recoveryStages";

export function bulletClass(status) {
  const key = String(status || "").toUpperCase();
  if (
    key === STAGE_STATUS.COMPLETED ||
    key === "SUCCESS" ||
    key === "EXECUTED" ||
    key === "SELECTED" ||
    key === "RECOVERED" ||
    key === "FULLY_RECOVERED" ||
    key === "VERIFIED"
  ) {
    return "bg-pine text-white ring-pine/30";
  }
  if (
    key === STAGE_STATUS.IN_PROGRESS ||
    key === "PENDING" ||
    key === "PROCESSING" ||
    key === "CREATED" ||
    key === "WAITING"
  ) {
    return "bg-sand text-white ring-sand/30";
  }
  if (
    key === STAGE_STATUS.FAILED ||
    key === STAGE_STATUS.BLOCKED ||
    key === "FAILED" ||
    key === "BLOCKED"
  ) {
    return "bg-clay text-white ring-clay/30";
  }
  return "bg-white text-ink-faint ring-ink/10";
}

export function VerticalStepList({ children }) {
  return <ol className="space-y-0">{children}</ol>;
}

export function VerticalStepItem({
  index,
  isLast,
  status,
  title,
  detail,
  badge,
  badgeTone,
  right,
}) {
  return (
    <li className={`relative pl-8 ${isLast ? "" : "pb-3"}`}>
      {!isLast && (
        <span
          className="absolute bottom-0 left-[11px] top-6 w-px bg-ink/10"
          aria-hidden
        />
      )}
      <span
        className={`absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ring-1 ring-inset ${bulletClass(
          status
        )}`}
      >
        {index}
      </span>
      <div className="rounded-xl border border-ink/8 bg-mist-soft/40 px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <div className="flex flex-wrap items-center gap-2">
            {badge ? (
              <StatusBadge value={status} label={badge} tone={badgeTone} />
            ) : null}
            {right}
          </div>
        </div>
        {detail ? (
          <p className="mt-1 line-clamp-1 text-sm text-ink-mute">{detail}</p>
        ) : null}
      </div>
    </li>
  );
}
