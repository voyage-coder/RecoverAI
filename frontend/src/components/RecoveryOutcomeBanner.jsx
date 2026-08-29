import StatusBadge from "./StatusBadge";
import { EmptyState } from "./LoadingState";
import { formatINR, formatDateTime } from "../utils/format";
import { toLabel } from "../utils/labels";
import { isBackendRecovered } from "../utils/recoveryStages";

const NA = "Not available";

function RecoveryOutcomeBanner({ recoveryCase, result, payment }) {
  if (!recoveryCase) {
    return <EmptyState message="No recovery case data." />;
  }

  const caseStatus = String(recoveryCase.status || "").toUpperCase();
  const resultStatus = String(result?.status || "").toUpperCase();
  const atRisk = recoveryCase.amount_at_risk;
  const recovered = result?.recovered_amount ?? 0;
  const original =
    result?.original_amount != null
      ? result.original_amount
      : atRisk;

  const fullyRecovered = isBackendRecovered(
    recoveryCase,
    result,
    payment
  );

  let tone = "border-ink/10 bg-mist-soft/60";
  let headline = "Recovery In Progress";
  let subline = `${formatINR(atRisk)} currently at risk`;
  let badgeValue = caseStatus;

  if (fullyRecovered) {
    tone = "border-pine/25 bg-pine-soft/50";
    headline = "Recovered";
    subline = `${formatINR(recovered)} recovered`;
    badgeValue = "RECOVERED";
  } else if (resultStatus === "PARTIALLY_RECOVERED") {
    tone = "border-sand/25 bg-sand-soft/50";
    headline = "Partially Recovered";
    subline = `${formatINR(recovered)} of ${formatINR(original)} recovered`;
    badgeValue = "PARTIALLY_RECOVERED";
  } else if (
    resultStatus === "NOT_RECOVERED" &&
    caseStatus !== "IN_PROGRESS" &&
    caseStatus !== "ACTIVE"
  ) {
    tone = "border-clay/20 bg-clay-soft/40";
    headline = "Not Recovered";
    subline = `${formatINR(atRisk ?? original)} remains at risk`;
    badgeValue = "NOT_RECOVERED";
  } else if (
    caseStatus === "ACTIVE" ||
    caseStatus === "IN_PROGRESS" ||
    resultStatus === "PENDING" ||
    !result
  ) {
    tone = "border-skyline/20 bg-skyline-soft/40";
    headline = "Recovery In Progress";
    subline = `${formatINR(atRisk)} currently at risk`;
    badgeValue = caseStatus;
  } else if (caseStatus === "ESCALATED") {
    tone = "border-clay/20 bg-clay-soft/40";
    headline = "Escalated";
    subline = recoveryCase.current_step || "Human follow-up required";
    badgeValue = "ESCALATED";
  } else if (caseStatus === "CLOSED") {
    tone = "border-ink/10 bg-mist-soft/60";
    headline = "Case Closed";
    subline = recoveryCase.current_step || "Recovery desk closed this case";
    badgeValue = "CLOSED";
  }

  return (
    <div className={`rounded-[18px] border p-5 sm:p-6 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            Recovery Outcome
          </p>
          <h4 className="mt-2 font-display text-2xl font-medium text-ink">
            {headline}
          </h4>
          <p className="mt-2 text-sm text-ink-mute">{subline}</p>
        </div>
        <StatusBadge value={badgeValue} />
      </div>

      {fullyRecovered && result && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-ink/8 bg-white/70 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Recovery method
            </p>
            <p className="mt-1 text-sm font-medium text-ink">
              {result.recovery_method
                ? toLabel(result.recovery_method)
                : NA}
            </p>
          </div>
          <div className="rounded-xl border border-ink/8 bg-white/70 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Recovered at
            </p>
            <p className="mt-1 font-mono text-sm text-ink">
              {result.recovered_at
                ? formatDateTime(result.recovered_at)
                : NA}
            </p>
          </div>
          <div className="rounded-xl border border-ink/8 bg-white/70 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Recovered amount
            </p>
            <p className="mt-1 font-mono text-sm text-ink">
              {formatINR(result.recovered_amount)}
            </p>
          </div>
        </div>
      )}

      {resultStatus === "PARTIALLY_RECOVERED" && result && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-ink/8 bg-white/70 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Recovered
            </p>
            <p className="mt-1 font-mono text-sm text-ink">
              {formatINR(result.recovered_amount)}
            </p>
          </div>
          <div className="rounded-xl border border-ink/8 bg-white/70 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Remaining exposure
            </p>
            <p className="mt-1 font-mono text-sm text-ink">
              {formatINR(Math.max(original - recovered, 0))}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default RecoveryOutcomeBanner;
