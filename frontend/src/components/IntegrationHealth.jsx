import { formatDateTime, formatINR, formatPercent } from "../utils/format";

function HealthItem({ label, value }) {
  return (
    <div className="rounded-xl border border-ink/8 bg-mist-soft/60 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      <p className="mt-1.5 font-mono text-lg font-medium text-ink">{value}</p>
    </div>
  );
}

function IntegrationHealth({ overview, lastActivityAt }) {
  const activeRecovery =
    overview == null
      ? null
      : (Number(overview.active_cases) || 0) +
        (Number(overview.in_progress_cases) || 0);

  return (
    <div className="rounded-[18px] border border-ink/10 bg-white p-5 sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Integration health
      </p>
      <h3 className="mt-2 font-display text-xl font-medium text-ink">
        Live recovery signals
      </h3>
      <p className="mt-1 text-sm text-ink-mute">
        Values from dashboard overview and recent activity — not estimated.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <HealthItem
          label="Last activity"
          value={
            lastActivityAt ? formatDateTime(lastActivityAt) : "Not available"
          }
        />
        <HealthItem
          label="Cases received"
          value={
            overview?.total_cases != null
              ? overview.total_cases
              : "Not available"
          }
        />
        <HealthItem
          label="Recoveries"
          value={
            overview?.recovered_cases != null
              ? overview.recovered_cases
              : "Not available"
          }
        />
        <HealthItem
          label="Currently recovering"
          value={
            activeRecovery != null ? activeRecovery : "Not available"
          }
        />
        <HealthItem
          label="Escalated"
          value={
            overview?.escalated_cases != null
              ? overview.escalated_cases
              : "Not available"
          }
        />
        <HealthItem
          label="Revenue recovered"
          value={
            overview?.amount_recovered != null
              ? formatINR(overview.amount_recovered)
              : "Not available"
          }
        />
        <HealthItem
          label="Recovery rate"
          value={
            overview?.recovery_rate != null
              ? formatPercent(overview.recovery_rate)
              : "Not available"
          }
        />
      </div>
    </div>
  );
}

export default IntegrationHealth;
