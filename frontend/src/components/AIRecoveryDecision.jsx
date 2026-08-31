import StatusBadge from "./StatusBadge";
import { formatINR } from "../utils/format";
import { toLabel } from "../utils/labels";

function Field({ label, value, mono = false }) {
  return (
    <div className="rounded-xl border border-ink/8 bg-mist-soft/50 px-3.5 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      <p
        className={`mt-1.5 text-sm text-ink ${mono ? "font-mono" : "font-medium"}`}
      >
        {value}
      </p>
    </div>
  );
}

function AIRecoveryDecision({ decision, loading, error }) {
  if (loading) {
    return (
      <div className="rounded-[18px] border border-ink/10 bg-white p-5 sm:p-6">
        <p className="text-sm text-ink-mute">Loading recovery decision…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[18px] border border-clay/20 bg-clay-soft/40 p-5 sm:p-6">
        <p className="text-sm font-medium text-clay">{error}</p>
      </div>
    );
  }

  if (!decision) {
    return null;
  }

  const explanation = decision.decision_explanation || {};
  const prediction = decision.prediction || {};
  const comparison = decision.strategy_comparison || {};
  const safety = decision.safety || {};
  const outcome = decision.outcome || {};
  const strategies = comparison.strategies || [];

  const recommended = strategies.find((item) => item.selected);
  const alternatives = strategies.filter((item) => !item.selected);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            Recovery Decision
          </p>
          <h3 className="mt-1 font-display text-2xl font-medium text-ink">
            AI Recovery Decision
          </h3>
          <p className="mt-1 text-sm text-ink-mute">
            Why the payment failed and what RecoverAI recommends.
          </p>
        </div>
        {decision.decision_state && (
          <StatusBadge value={decision.decision_state} />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Failure"
          value={
            decision.failure_reason ||
            toLabel(decision.failure_category) ||
            "—"
          }
        />
        <Field
          label="Root cause"
          value={decision.root_cause || "—"}
        />
        <Field
          label="AI prediction"
          mono
          value={
            decision.recovery_probability != null
              ? `${decision.recovery_probability}%`
              : "Prediction unavailable"
          }
        />
        <Field
          label="AI confidence"
          mono
          value={
            decision.ai_confidence != null
              ? `${decision.ai_confidence}%`
              : "—"
          }
        />
        <Field
          label="Risk"
          value={toLabel(decision.risk_level) || "—"}
        />
        <Field
          label="Recommended recovery method"
          value={toLabel(decision.selected_strategy) || "—"}
        />
        <Field
          label="Current step"
          value={decision.current_step || "—"}
        />
        <Field
          label="Decision state"
          value={decision.decision_state || "—"}
        />
      </div>

      <div className="rounded-xl border border-ink/10 bg-white px-4 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Why RecoverAI chose this
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {explanation.summary || "Explanation unavailable for this case."}
        </p>
        {explanation.strategy_reason && (
          <p className="mt-3 text-sm text-ink-mute">
            {explanation.strategy_reason}
          </p>
        )}
        {(explanation.factors || []).length > 0 && (
          <ul className="mt-3 space-y-1.5 text-xs text-ink-faint">
            {explanation.factors.map((factor) => (
              <li key={factor}>• {factor}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-skyline/20 bg-skyline-soft/25 px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-skyline">
            Model Prediction
          </p>
          <p className="mt-2 font-mono text-3xl font-medium text-ink">
            {prediction.recovery_probability != null
              ? `${prediction.recovery_probability}%`
              : "—"}
          </p>
          <p className="mt-2 text-sm font-medium text-ink">
            {prediction.label || "Prediction unavailable"}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {prediction.disclaimer || "Prediction, not a guarantee"}
          </p>
        </div>

        <div className="rounded-xl border border-pine/20 bg-pine-soft/30 px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pine">
            Actual Outcome
          </p>
          <p className="mt-2 text-sm text-ink-mute">
            Status:{" "}
            <span className="font-semibold text-ink">
              {outcome.result_status
                ? toLabel(outcome.result_status)
                : toLabel(outcome.case_status) || "Pending"}
            </span>
          </p>
          <p className="mt-3 font-mono text-3xl font-medium text-ink">
            {outcome.recovered_amount != null
              ? formatINR(outcome.recovered_amount)
              : formatINR(0)}
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            From RecoveryResult / verified payment state — not the prediction.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-ink/10 bg-mist-soft/40 px-4 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Strategy comparison
        </p>
        <p className="mt-1 text-xs text-ink-mute">{comparison.note}</p>

        {recommended && (
          <div className="mt-4 rounded-xl border border-pine/20 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-ink">
                {toLabel(recommended.strategy)}
              </p>
              <span className="text-xs font-semibold text-pine">
                Recommended
              </span>
            </div>
            {recommended.expected_probability != null && (
              <p className="mt-1 font-mono text-xs text-ink-faint">
                Model estimate for this strategy:{" "}
                {recommended.expected_probability}%
              </p>
            )}
            {recommended.reason && (
              <p className="mt-2 text-sm text-ink-mute">{recommended.reason}</p>
            )}
          </div>
        )}

        <div className="mt-3 space-y-2">
          {alternatives.length === 0 ? (
            <p className="text-sm text-ink-faint">
              No persisted alternative evaluations for this case yet.
            </p>
          ) : (
            alternatives.map((item) => (
              <div
                key={`${item.strategy}-${item.reason}`}
                className="rounded-xl border border-ink/8 bg-white px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-ink">
                    {toLabel(item.strategy)}
                  </p>
                  <span className="text-xs font-semibold text-ink-mute">
                    Not selected
                  </span>
                </div>
                {item.expected_probability != null && (
                  <p className="mt-1 font-mono text-xs text-ink-faint">
                    Evaluated model estimate: {item.expected_probability}%
                  </p>
                )}
                {item.reason && (
                  <p className="mt-2 text-sm text-ink-mute">{item.reason}</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-ink/10 bg-white px-4 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Safety & Compliance
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Safety decision" value={safety.decision || "—"} />
          <Field
            label="Execution status"
            value={safety.execution_status || "—"}
          />
          <Field
            label="Escalation"
            value={
              safety.escalation_required ? "Required" : "Not required"
            }
          />
          <Field
            label="Stopping rules"
            value={
              safety.stopping_rules_applied ? "Applied" : "Not applicable"
            }
          />
        </div>
        {safety.decision === "Blocked" && (
          <p className="mt-3 text-sm font-medium text-clay">
            Action blocked by Safety Engine
            {safety.blocked_result_text
              ? ` — ${safety.blocked_result_text}`
              : ""}
          </p>
        )}
        {safety.reason && safety.decision !== "Blocked" && (
          <p className="mt-3 text-sm text-ink-mute">{safety.reason}</p>
        )}
        {safety.stopping_rules_text && (
          <p className="mt-2 text-xs text-ink-faint">
            {safety.stopping_rules_text}
          </p>
        )}
      </div>
    </div>
  );
}

export default AIRecoveryDecision;
