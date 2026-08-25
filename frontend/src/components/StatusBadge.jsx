import { toLabel } from "../utils/labels";

const TONE_CLASSES = {
  success: "bg-pine-soft text-pine ring-pine/15",
  warning: "bg-sand-soft text-sand ring-sand/20",
  danger: "bg-clay-soft text-clay ring-clay/15",
  info: "bg-skyline-soft text-skyline ring-skyline/15",
  neutral: "bg-mist text-ink-soft ring-ink/10",
  muted: "bg-mist-soft text-ink-mute ring-ink/5",
};

function resolveTone(value) {
  const key = String(value || "").toUpperCase();

  if (
    ["RECOVERED", "FULLY_RECOVERED", "EXECUTED", "ACTIVE", "LOW"].includes(key)
  ) {
    return "success";
  }

  if (
    [
      "IN_PROGRESS",
      "PROCESSING",
      "PENDING",
      "PARTIALLY_RECOVERED",
      "MEDIUM",
    ].includes(key)
  ) {
    return "warning";
  }

  if (
    [
      "ESCALATED",
      "FAILED",
      "NOT_RECOVERED",
      "BLOCKED",
      "HIGH",
      "CRITICAL",
    ].includes(key)
  ) {
    return "danger";
  }

  if (["CLOSED"].includes(key)) return "muted";
  return "neutral";
}

function StatusBadge({ value, label, tone }) {
  const resolvedTone = tone || resolveTone(value);
  const text = label || toLabel(value);

  return (
    <span
      className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset ${TONE_CLASSES[resolvedTone]}`}
    >
      {text}
    </span>
  );
}

export default StatusBadge;
