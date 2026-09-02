import { formatDateTime } from "../utils/format";
import { VerticalStepItem, VerticalStepList } from "./VerticalStepList";
import { STAGE_STATUS } from "../utils/recoveryStages";

const STATUS_LABELS = {
  COMPLETED: "Completed",
  IN_PROGRESS: "In Progress",
  PENDING: "Pending",
  SKIPPED: "Skipped",
  FAILED: "Failed",
  BLOCKED: "Blocked",
  NOT_AVAILABLE: "Pending",
};

function badgeTone(status) {
  if (status === STAGE_STATUS.COMPLETED) return "success";
  if (status === STAGE_STATUS.IN_PROGRESS) return "warning";
  if (status === STAGE_STATUS.FAILED || status === STAGE_STATUS.BLOCKED) {
    return "danger";
  }
  return "neutral";
}

function CaseRecoveryProgress({ stages = [] }) {
  if (!stages.length) return null;

  return (
    <VerticalStepList>
      {stages.map((stage, index) => {
        const status = stage.status || STAGE_STATUS.NOT_AVAILABLE;
        const time = stage.timestamp ? formatDateTime(stage.timestamp) : null;
        return (
          <VerticalStepItem
            key={stage.key}
            index={index + 1}
            isLast={index === stages.length - 1}
            status={status}
            title={stage.name}
            detail={stage.detail}
            badge={STATUS_LABELS[status] || status}
            badgeTone={badgeTone(status)}
            right={
              time && time !== "—" ? (
                <span className="font-mono text-[11px] text-ink-faint">
                  {time}
                </span>
              ) : null
            }
          />
        );
      })}
    </VerticalStepList>
  );
}

export default CaseRecoveryProgress;
