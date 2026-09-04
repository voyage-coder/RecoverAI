import StatusBadge from "./StatusBadge";
import { toLabel } from "../utils/labels";
import { planSafetyVerdict } from "../utils/safetyVerdict";

function AIRecoveryDecision({ decision, loading, error, timeline }) {
  if (loading) {
    return (
      <p className="text-sm text-ink-mute">Loading recovery decision…</p>
    );
  }

  if (error) {
    return (
      <p className="text-sm font-medium text-clay">{error}</p>
    );
  }

  if (!decision) {
    return null;
  }

  const explanation = decision.decision_explanation || {};
  const why =
    explanation.summary ||
    decision.root_cause ||
    decision.failure_reason ||
    null;
  const safety = planSafetyVerdict({ timeline, decision });
  const plan =
    toLabel(decision.selected_strategy) ||
    toLabel(timeline?.case?.selected_strategy) ||
    "—";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-medium text-ink">
            Why it failed
          </h3>
          <p className="mt-1 text-sm text-ink-mute">
            Predicted plan, then whether Safety allowed it.
          </p>
        </div>
        {decision.decision_state && (
          <StatusBadge value={decision.decision_state} />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-ink/8 bg-mist-soft/50 px-3.5 py-3 sm:col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Failure
          </p>
          <p className="mt-1.5 text-sm font-medium text-ink">
            {decision.failure_reason ||
              toLabel(decision.failure_category) ||
              "—"}
          </p>
        </div>
        <div className="rounded-xl border border-ink/8 bg-mist-soft/50 px-3.5 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Chance of recovery
          </p>
          <p className="mt-1.5 font-mono text-sm font-medium text-ink">
            {decision.recovery_probability != null
              ? `${decision.recovery_probability}%`
              : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-ink/8 bg-mist-soft/50 px-3.5 py-3 sm:col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Predicted plan
          </p>
          <p className="mt-1.5 text-sm font-medium text-ink">{plan}</p>
        </div>
        <div className="rounded-xl border border-ink/8 bg-mist-soft/50 px-3.5 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Risk
          </p>
          <p className="mt-1.5 text-sm font-medium text-ink">
            {toLabel(decision.risk_level) || "—"}
          </p>
        </div>
      </div>

      <div
        className={`mt-3 rounded-xl border px-3.5 py-3 ${
          safety.passed === true
            ? "border-pine/25 bg-pine-soft/40"
            : safety.passed === false
              ? "border-clay/25 bg-clay-soft/50"
              : "border-ink/10 bg-mist-soft/50"
        }`}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
          Safety check
        </p>
        <p
          className={`mt-1.5 text-sm font-semibold ${
            safety.passed === true
              ? "text-pine"
              : safety.passed === false
                ? "text-clay"
                : "text-ink"
          }`}
        >
          {safety.label}
        </p>
        <p className="mt-1 text-sm text-ink-mute">{safety.detail}</p>
      </div>

      {why && (
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">{why}</p>
      )}
    </div>
  );
}

export default AIRecoveryDecision;
