import StatusBadge from "./StatusBadge";
import { formatINR } from "../utils/format";
import { toLabel } from "../utils/labels";

const NA = "—";

function SummaryCell({ label, value, mono = false, children }) {
  return (
    <div className="rounded-xl border border-ink/8 bg-mist-soft/70 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </p>
      <div
        className={`mt-1.5 text-sm font-medium text-ink ${
          mono ? "font-mono text-[13px]" : ""
        }`}
      >
        {children != null ? children : value ?? NA}
      </div>
    </div>
  );
}

function OperationsSummary({ recoveryCase, result }) {
  if (!recoveryCase) return null;

  const recoveredAmount =
    result?.recovered_amount != null ? result.recovered_amount : 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCell
        label="Amount at Risk"
        value={formatINR(recoveryCase.amount_at_risk)}
        mono
      />
      <SummaryCell
        label="Recovered Amount"
        value={formatINR(recoveredAmount)}
        mono
      />
      <SummaryCell
        label="Recovery Probability"
        value={
          recoveryCase.recovery_probability != null
            ? `${recoveryCase.recovery_probability}%`
            : NA
        }
        mono
      />
      <SummaryCell label="Current Strategy">
        {recoveryCase.selected_strategy ? (
          toLabel(recoveryCase.selected_strategy)
        ) : (
          NA
        )}
      </SummaryCell>
      <SummaryCell
        label="Retry Count"
        value={recoveryCase.retry_count ?? NA}
        mono
      />
      <SummaryCell
        label="Contact Count"
        value={recoveryCase.contact_count ?? NA}
        mono
      />
      <SummaryCell label="Current Step">
        {recoveryCase.current_step
          ? toLabel(recoveryCase.current_step)
          : NA}
      </SummaryCell>
      <SummaryCell label="Case Status">
        <StatusBadge value={recoveryCase.status} />
      </SummaryCell>
    </div>
  );
}

export default OperationsSummary;
