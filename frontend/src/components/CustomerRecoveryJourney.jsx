import { VerticalStepItem, VerticalStepList } from "./VerticalStepList";
import { STAGE_STATUS } from "../utils/recoveryStages";

const STATUS_LABELS = {
  COMPLETED: "Completed",
  IN_PROGRESS: "In Progress",
  PENDING: "Pending",
  FAILED: "Failed",
  BLOCKED: "Blocked",
  NOT_AVAILABLE: "Pending",
  SKIPPED: "Skipped",
};

function badgeTone(status) {
  if (status === STAGE_STATUS.COMPLETED) return "success";
  if (status === STAGE_STATUS.IN_PROGRESS) return "warning";
  if (status === STAGE_STATUS.FAILED || status === STAGE_STATUS.BLOCKED) {
    return "danger";
  }
  return "neutral";
}

function CustomerRecoveryJourney({ stages = [] }) {
  if (!stages.length) return null;

  return (
    <VerticalStepList>
      {stages.map((stage, index) => {
        const status = stage.status || STAGE_STATUS.NOT_AVAILABLE;
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
          />
        );
      })}
    </VerticalStepList>
  );
}

export default CustomerRecoveryJourney;
