import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import StatusBadge from "../components/StatusBadge";
import RecoveryTimeline from "../components/RecoveryTimeline";
import LoadingState, {
  ErrorState,
  EmptyState,
} from "../components/LoadingState";
import { getRecoveryCase, getCaseTimeline } from "../services/api";
import { formatINR, formatDateTime } from "../utils/format";
import { toLabel } from "../utils/labels";

function DetailItem({ label, value, children }) {
  return (
    <div className="rounded-2xl border border-ink/8 bg-mist-soft/80 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </p>
      <div className="mt-2 text-sm font-medium text-ink">
        {children || value || "—"}
      </div>
    </div>
  );
}

function CaseDetails() {
  const { caseId } = useParams();
  const [recoveryCase, setRecoveryCase] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadCase = async () => {
      setLoading(true);
      setError(null);

      try {
        const [caseData, timelineData] = await Promise.all([
          getRecoveryCase(caseId),
          getCaseTimeline(caseId),
        ]);
        setRecoveryCase(caseData);
        setTimeline(timelineData);
      } catch (err) {
        console.error(err);
        setError("Unable to connect to RecoverAI API.");
      } finally {
        setLoading(false);
      }
    };

    loadCase();
  }, [caseId]);

  if (loading) return <LoadingState message="Loading case details..." />;
  if (error) return <ErrorState message={error} />;
  if (!recoveryCase) return <EmptyState message="Recovery case not found." />;

  const result = timeline?.result;

  return (
    <div className="page-enter space-y-6">
      <Link
        to="/cases"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-mute transition hover:text-ink"
      >
        <ArrowLeft size={14} />
        Back to cases
      </Link>

      <section className="overflow-hidden rounded-[22px] border border-ink/10 bg-white shadow-panel">
        <div className="relative border-b border-ink/10 bg-gradient-to-br from-ink via-ink to-[#1c2430] px-6 py-8 text-white sm:px-8">
          <div className="absolute -right-10 top-0 h-40 w-40 rounded-full bg-pine/25 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Recovery Case
              </p>
              <h2 className="mt-3 font-display text-3xl font-medium tracking-tight sm:text-4xl">
                {recoveryCase.case_number}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/55">
                {recoveryCase.failure_reason || "No failure reason provided."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={recoveryCase.status} />
              <StatusBadge value={recoveryCase.risk_level} />
            </div>
          </div>

          <div className="relative mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Amount at Risk", formatINR(recoveryCase.amount_at_risk)],
              [
                "Recovery Probability",
                recoveryCase.recovery_probability != null
                  ? `${recoveryCase.recovery_probability}%`
                  : "—",
              ],
              [
                "AI Confidence",
                recoveryCase.ai_confidence != null
                  ? `${recoveryCase.ai_confidence}%`
                  : "—",
              ],
              ["Current Step", toLabel(recoveryCase.current_step)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur"
              >
                <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                  {label}
                </p>
                <p className="mt-2 font-mono text-lg font-medium">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3 sm:p-6">
          <DetailItem
            label="Failure Category"
            value={toLabel(recoveryCase.failure_category)}
          />
          <DetailItem
            label="Root Cause"
            value={recoveryCase.root_cause || "—"}
          />
          <DetailItem
            label="Selected Strategy"
            value={toLabel(recoveryCase.selected_strategy)}
          />
          <DetailItem label="Retry Count" value={recoveryCase.retry_count} />
          <DetailItem
            label="Contact Count"
            value={recoveryCase.contact_count}
          />
          <DetailItem
            label="Created At"
            value={formatDateTime(recoveryCase.created_at)}
          />
          <DetailItem
            label="Updated At"
            value={formatDateTime(recoveryCase.updated_at)}
          />
          <DetailItem label="Payment ID" value={recoveryCase.payment_id} />
          <DetailItem label="Customer ID" value={recoveryCase.customer_id} />
        </div>
      </section>

      <section className="panel p-6">
        <div className="mb-5">
          <h3 className="font-display text-xl font-medium text-ink">
            Recovery Result
          </h3>
          <p className="mt-1 text-sm text-ink-mute">
            Outcome recorded for this recovery case
          </p>
        </div>

        {!result ? (
          <EmptyState message="No recovery result recorded yet." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <DetailItem
              label="Original Amount"
              value={formatINR(result.original_amount)}
            />
            <DetailItem
              label="Recovered Amount"
              value={formatINR(result.recovered_amount)}
            />
            <DetailItem label="Recovery Status">
              <StatusBadge value={result.status} />
            </DetailItem>
            <DetailItem
              label="Recovery Method"
              value={toLabel(result.recovery_method)}
            />
            <DetailItem
              label="Recovered At"
              value={formatDateTime(result.recovered_at)}
            />
          </div>
        )}
      </section>

      <section className="panel p-6">
        <div className="mb-6">
          <h3 className="font-display text-xl font-medium text-ink">
            Recovery Timeline
          </h3>
          <p className="mt-1 text-sm text-ink-mute">
            Strategies, actions, communications, results, and audit logs
          </p>
        </div>
        <RecoveryTimeline timeline={timeline} />
      </section>

      {timeline && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="panel p-6">
            <h3 className="font-display text-xl font-medium text-ink">
              Strategies
            </h3>
            <div className="mt-4 space-y-3">
              {(timeline.strategies || []).length === 0 ? (
                <p className="text-sm text-ink-mute">No strategies recorded.</p>
              ) : (
                timeline.strategies.map((strategy) => (
                  <div
                    key={strategy.id}
                    className="rounded-2xl border border-ink/8 bg-mist-soft/70 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {toLabel(strategy.strategy_type)}
                      </p>
                      {strategy.is_selected && (
                        <StatusBadge value="EXECUTED" label="Selected" />
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-ink-mute">
                      {strategy.rationale}
                    </p>
                    <p className="mt-2 font-mono text-[11px] text-ink-faint">
                      Expected probability: {strategy.expected_probability}%
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="panel p-6">
            <h3 className="font-display text-xl font-medium text-ink">
              Actions
            </h3>
            <div className="mt-4 space-y-3">
              {(timeline.actions || []).length === 0 ? (
                <p className="text-sm text-ink-mute">No actions recorded.</p>
              ) : (
                timeline.actions.map((action) => (
                  <div
                    key={action.id}
                    className="rounded-2xl border border-ink/8 bg-mist-soft/70 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {toLabel(action.action_type)}
                      </p>
                      <StatusBadge value={action.status} />
                    </div>
                    <p className="mt-2 text-xs text-ink-mute">
                      Attempt {action.attempt_number}
                      {action.result_text ? ` · ${action.result_text}` : ""}
                    </p>
                    <p className="mt-2 font-mono text-[11px] text-ink-faint">
                      {formatDateTime(action.executed_at || action.created_at)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default CaseDetails;
