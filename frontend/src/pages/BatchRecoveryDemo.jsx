import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  AlertTriangle,
  Layers,
  Loader2,
  RefreshCw,
} from "lucide-react";
import StatusBadge from "../components/StatusBadge";
import {
  ingestPaymentEvent,
  getRecoveryCases,
  getCaseTimeline,
  parseApiError,
} from "../services/api";
import { formatINR, formatDateTime, formatPercent } from "../utils/format";
import { toLabel } from "../utils/labels";
import {
  FAILURE_SCENARIOS,
  pickScenario,
  pickCustomer,
  randomAmountPaise,
  batchCustomerEmail,
} from "../utils/demoScenarios";
import {
  batchHasActiveCases,
  computeBatchMetrics,
} from "../utils/batchMetrics";
import DemoFlowGuide from "../components/DemoFlowGuide";

const BATCH_SIZE_OPTIONS = [5, 10, 20];
const POLL_INTERVAL_MS = 8000;
const DEFAULT_MIN_RUPEES = 500;
const DEFAULT_MAX_RUPEES = 5000;

function MetricCell({ label, value, mono = false, large = false }) {
  return (
    <div className="rounded-xl border border-ink/8 bg-mist-soft/70 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </p>
      <p
        className={`mt-1.5 font-medium text-ink ${
          large ? "font-display text-2xl" : "text-sm"
        } ${mono ? "font-mono" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function BatchRecoveryDemo() {
  const [batchSize, setBatchSize] = useState(5);
  const [useAmountRange, setUseAmountRange] = useState(true);
  const [minRupees, setMinRupees] = useState(DEFAULT_MIN_RUPEES);
  const [maxRupees, setMaxRupees] = useState(DEFAULT_MAX_RUPEES);
  const [selectedScenarios, setSelectedScenarios] = useState(
    () => FAILURE_SCENARIOS.map((s) => s.code)
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState(null);
  const [error, setError] = useState(null);

  const [batch, setBatch] = useState(null);
  const [batchCases, setBatchCases] = useState([]);
  const [timelines, setTimelines] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const metrics = useMemo(
    () => computeBatchMetrics(batchCases, timelines),
    [batchCases, timelines]
  );

  const toggleScenario = (code) => {
    setSelectedScenarios((prev) => {
      if (prev.includes(code)) {
        const next = prev.filter((c) => c !== code);
        return next.length ? next : [code];
      }
      return [...prev, code];
    });
  };

  const refreshBatchData = useCallback(async () => {
    if (!batch?.caseIds?.length) return;

    setRefreshing(true);
    try {
      const allCases = await getRecoveryCases();
      const ids = new Set(batch.caseIds);
      const cases = allCases.filter((item) => ids.has(item.id));
      setBatchCases(cases);

      const timelineMap = {};
      await Promise.all(
        batch.caseIds.map(async (caseId) => {
          try {
            timelineMap[caseId] = await getCaseTimeline(caseId);
          } catch (err) {
            console.error(err);
            timelineMap[caseId] = null;
          }
        })
      );
      setTimelines(timelineMap);
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  }, [batch?.caseIds]);

  useEffect(() => {
    if (!batch?.caseIds?.length) return undefined;
    refreshBatchData();
    return undefined;
  }, [batch?.caseIds]);

  useEffect(() => {
    if (!batch?.caseIds?.length) return undefined;
    if (!batchHasActiveCases(batchCases)) return undefined;

    const intervalId = window.setInterval(() => {
      refreshBatchData();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [batch?.caseIds, batchCases, refreshBatchData]);

  const handleCreateBatch = async () => {
    setError(null);
    setSubmitting(true);
    setSubmitProgress(null);

    const scenarios = FAILURE_SCENARIOS.filter((s) =>
      selectedScenarios.includes(s.code)
    );
    const batchId = crypto.randomUUID();
    const items = [];
    const caseIds = [];

    try {
      for (let i = 0; i < batchSize; i += 1) {
        setSubmitProgress({ current: i + 1, total: batchSize });

        const scenario = pickScenario(scenarios, i);
        const customer = pickCustomer(i);
        const amountPaise = useAmountRange
          ? randomAmountPaise(minRupees, maxRupees)
          : randomAmountPaise(1000, 3000);

        const data = await ingestPaymentEvent({
          event: "payment.failed",
          amount: amountPaise,
          currency: "INR",
          customer: {
            name: customer.name,
            email: batchCustomerEmail(batchId, i),
          },
          failure: {
            code: scenario.code,
            reason: scenario.reason,
          },
          idempotency_key: `batch-${batchId}-${i}`,
        });

        if (data.case_id) {
          caseIds.push(data.case_id);
        }

        items.push({
          caseId: data.case_id,
          caseNumber: data.case_number,
          paymentId: data.payment_id,
          amountPaise,
          failureCode: scenario.code,
          failureReason: scenario.reason,
          status: data.case_status,
          paymentStatus: data.payment_status,
        });
      }

      setBatch({
        batchId,
        createdAt: new Date().toISOString(),
        caseIds,
        items,
      });
      setBatchCases([]);
      setTimelines({});
    } catch (err) {
      console.error(err);
      setError(parseApiError(err));
    } finally {
      setSubmitting(false);
      setSubmitProgress(null);
    }
  };

  const pollingActive = batchHasActiveCases(batchCases);

  return (
    <div className="page-enter space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Demo tools</p>
          <h2 className="page-title">Batch Recovery Demo</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-mute">
            Generate a batch of simulated payment failures through{" "}
            <span className="font-mono text-xs text-ink-soft">
              POST /api/events/payment
            </span>
            . Each event runs the full RecoverAI recovery pipeline — no
            direct database writes, no fabricated recovery.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink transition hover:border-pine/30 hover:text-pine"
        >
          <ArrowLeft size={15} />
          Back to dashboard
        </Link>
      </div>

      <DemoFlowGuide title="Batch demo — complete payment per case in TEST MODE" />

      <section className="panel p-5 sm:p-6">
        <h3 className="font-display text-xl font-medium text-ink">
          Batch configuration
        </h3>
        <p className="mt-1 text-sm text-ink-mute">
          Choose batch size, optional amount range, and failure scenarios
        </p>

        <div className="mt-6 space-y-6">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Batch size
            </p>
            <div className="flex flex-wrap gap-2">
              {BATCH_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  type="button"
                  disabled={submitting}
                  onClick={() => setBatchSize(size)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    batchSize === size
                      ? "bg-ink text-white"
                      : "border border-ink/10 bg-white text-ink hover:border-pine/30"
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={useAmountRange}
                onChange={(e) => setUseAmountRange(e.target.checked)}
                className="rounded border-ink/20"
              />
              Random amount range (₹)
            </label>
            {useAmountRange && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input
                  type="number"
                  min="1"
                  className="field w-28 font-mono"
                  value={minRupees}
                  onChange={(e) => setMinRupees(Number(e.target.value))}
                />
                <span className="text-sm text-ink-mute">to</span>
                <input
                  type="number"
                  min="1"
                  className="field w-28 font-mono"
                  value={maxRupees}
                  onChange={(e) => setMaxRupees(Number(e.target.value))}
                />
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Failure scenarios (rotated across batch)
            </p>
            <div className="flex flex-wrap gap-2">
              {FAILURE_SCENARIOS.map((scenario) => {
                const active = selectedScenarios.includes(scenario.code);
                return (
                  <button
                    key={scenario.code}
                    type="button"
                    disabled={submitting}
                    onClick={() => toggleScenario(scenario.code)}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                      active
                        ? "border border-pine/30 bg-pine-soft text-pine"
                        : "border border-ink/10 bg-white text-ink-mute"
                    }`}
                  >
                    {toLabel(scenario.code)}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-clay/20 bg-clay-soft/50 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle
                  size={16}
                  className="mt-0.5 shrink-0 text-clay"
                />
                <p className="text-sm font-medium text-clay">{error}</p>
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={submitting}
            onClick={handleCreateBatch}
            className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Submitting{" "}
                {submitProgress
                  ? `${submitProgress.current}/${submitProgress.total}`
                  : "…"}
              </>
            ) : (
              <>
                <Layers size={16} />
                Create batch ({batchSize} payments)
              </>
            )}
          </button>
        </div>
      </section>

      {batch && (
        <>
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pine">
                  Batch created
                </p>
                <p className="mt-1 font-mono text-sm text-ink">
                  Batch ID: {batch.batchId}
                </p>
                <p className="mt-2 text-sm text-ink-mute">
                  Payments submitted: {batch.items.length} · Cases created:{" "}
                  {batch.caseIds.length}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {lastUpdated && (
                  <p className="text-xs text-ink-faint">
                    Last updated: {formatDateTime(lastUpdated)}
                    {pollingActive ? " · monitoring active" : ""}
                  </p>
                )}
                <button
                  type="button"
                  onClick={refreshBatchData}
                  disabled={refreshing}
                  className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:border-pine/30 hover:text-pine disabled:opacity-60"
                >
                  <RefreshCw
                    size={14}
                    className={refreshing ? "animate-spin" : ""}
                  />
                  Refresh batch
                </button>
              </div>
            </div>
          </section>

          <section className="panel border-pine/20 bg-pine-soft/25 p-6 sm:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pine">
              Batch recovery report
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              Metrics scoped only to case IDs returned by this batch — not
              global dashboard totals
            </p>

            <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-3">
              <div>
                <p className="font-mono text-2xl font-medium text-ink">
                  {metrics.totalCases} Payments
                </p>
                <p className="mt-1 font-mono text-sm text-ink-mute">
                  {formatINR(metrics.amountAtRisk)} At Risk
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <div>
                <p className="font-display text-4xl font-medium text-ink sm:text-5xl">
                  {formatINR(metrics.recoveredAmount)}
                </p>
                <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-pine">
                  Recovered
                </p>
              </div>
              <div>
                <p className="font-display text-4xl font-medium text-ink sm:text-5xl">
                  {formatPercent(metrics.recoveryRate)}
                </p>
                <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-ink-faint">
                  Recovery Rate
                </p>
              </div>
            </div>

            {metrics.recoveredAmount === 0 && (
              <p className="mt-4 text-sm text-ink-mute">
                ₹0 recovered until verified Razorpay webhooks update
                RecoveryResult for cases in this batch.
              </p>
            )}

            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-pine/20 bg-white/70 px-4 py-4">
                <p className="font-mono text-3xl font-medium text-ink">
                  {metrics.recoveredCases}
                </p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-pine">
                  Recovered
                </p>
              </div>
              <div className="rounded-xl border border-sand/25 bg-white/70 px-4 py-4">
                <p className="font-mono text-3xl font-medium text-ink">
                  {metrics.pendingCases}
                </p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-sand">
                  Pending
                </p>
              </div>
              <div className="rounded-xl border border-clay/20 bg-white/70 px-4 py-4">
                <p className="font-mono text-3xl font-medium text-ink">
                  {metrics.escalatedCases}
                </p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-clay">
                  Escalated
                </p>
              </div>
              <div className="rounded-xl border border-ink/10 bg-white/70 px-4 py-4">
                <p className="font-mono text-3xl font-medium text-ink">
                  {metrics.unrecoveredCases}
                </p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Unrecovered
                </p>
              </div>
            </div>
          </section>

          <section className="panel p-5 sm:p-6">
            <h3 className="font-display text-xl font-medium text-ink">
              Batch metrics detail
            </h3>
            <p className="mt-1 text-sm text-ink-mute">
              Derived from recovery case and timeline APIs for this batch only
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCell
                label="Payments / Cases"
                value={metrics.totalCases}
                mono
              />
              <MetricCell
                label="Amount at risk"
                value={formatINR(metrics.amountAtRisk)}
                mono
              />
              <MetricCell
                label="Amount recovered"
                value={formatINR(metrics.recoveredAmount)}
                mono
              />
              <MetricCell
                label="Still at risk"
                value={formatINR(metrics.stillAtRisk)}
                mono
              />
              <MetricCell
                label="Recovery rate"
                value={formatPercent(metrics.recoveryRate)}
                mono
              />
              <MetricCell
                label="Pending"
                value={metrics.pendingCases}
                mono
              />
              <MetricCell
                label="Escalated"
                value={metrics.escalatedCases}
                mono
              />
              <MetricCell
                label="Stopped / blocked"
                value={metrics.compliance.stoppedCases}
                mono
              />
              <MetricCell
                label="Closed"
                value={metrics.closedCases}
                mono
              />
              <MetricCell
                label="Not recovered (result)"
                value={metrics.notRecoveredCases}
                mono
              />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="panel p-5 sm:p-6">
              <h3 className="font-display text-xl font-medium text-ink">
                AI Recovery Mix
              </h3>
              <p className="mt-1 text-sm text-ink-mute">
                Failure categories in this batch — from live case data only
              </p>
              {metrics.failureRows.length === 0 ? (
                <p className="mt-4 text-sm text-ink-mute">No cases yet.</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {metrics.failureRows.map((row) => (
                    <li
                      key={row.category}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/8 bg-mist-soft/60 px-4 py-3"
                    >
                      <span className="text-sm font-medium text-ink">
                        {row.label}
                      </span>
                      <span className="font-mono text-xs text-ink-mute">
                        {row.count} cases · {formatINR(row.amountAtRisk)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {(metrics.strategyMix || []).length > 0 && (
                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    Strategy distribution
                  </p>
                  <ul className="mt-2 space-y-2">
                    {metrics.strategyMix.map((row) => (
                      <li
                        key={row.strategy}
                        className="flex items-center justify-between rounded-xl border border-ink/8 bg-white px-4 py-2.5 text-sm"
                      >
                        <span>{row.label}</span>
                        <span className="font-mono text-xs text-ink-faint">
                          {row.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="panel p-5 sm:p-6">
              <h3 className="font-display text-xl font-medium text-ink">
                Compliance & audit trail
              </h3>
              <p className="mt-1 text-sm text-ink-mute">
                Evidence from timeline actions and audit logs — not simulated
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <MetricCell
                  label="Cases escalated"
                  value={metrics.compliance.escalatedCases}
                />
                <MetricCell
                  label="Cases stopped / blocked"
                  value={metrics.compliance.stoppedCases}
                />
                <MetricCell
                  label="Recovery actions"
                  value={metrics.compliance.totalActions}
                />
                <MetricCell
                  label="Communication actions"
                  value={metrics.compliance.communicationActions}
                />
                <MetricCell
                  label="Audit / timeline events"
                  value={
                    metrics.compliance.auditEventCount > 0
                      ? metrics.compliance.auditEventCount
                      : "Not available"
                  }
                />
                <MetricCell
                  label="Stopping rules"
                  value={
                    metrics.compliance.stoppedCases > 0
                      ? `${metrics.compliance.stoppedCases} case(s) with stop/block signals`
                      : "Not available"
                  }
                />
              </div>
            </section>
          </div>

          <section className="panel p-5 sm:p-6">
            <h3 className="font-display text-xl font-medium text-ink">
              Batch cases
            </h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    <th className="pb-3 pr-4">Case</th>
                    <th className="pb-3 pr-4">Amount</th>
                    <th className="pb-3 pr-4">Failure</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.items.map((item) => {
                    const live =
                      batchCases.find((c) => c.id === item.caseId) || null;
                    const status = live?.status || item.status;
                    const amount =
                      live?.amount_at_risk ?? item.amountPaise;

                    return (
                      <tr
                        key={item.caseId || item.caseNumber}
                        className="border-b border-ink/5"
                      >
                        <td className="py-3 pr-4 font-mono text-ink">
                          {item.caseNumber || "—"}
                        </td>
                        <td className="py-3 pr-4 font-mono text-ink-mute">
                          {formatINR(amount)}
                        </td>
                        <td className="py-3 pr-4 text-ink-mute">
                          {toLabel(item.failureCode)}
                        </td>
                        <td className="py-3 pr-4">
                          {status ? (
                            <StatusBadge value={status} />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-3">
                          {item.caseId ? (
                            <Link
                              to={`/cases/${item.caseId}`}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-pine hover:underline"
                            >
                              View case
                              <ArrowUpRight size={12} />
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default BatchRecoveryDemo;
