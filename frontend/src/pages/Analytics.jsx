import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import StatCard from "../components/StatCard";
import StatusBadge from "../components/StatusBadge";
import RecoveryProgress from "../components/RecoveryProgress";
import FailureChart from "../components/FailureChart";
import LoadingState, {
  ErrorState,
  EmptyState,
} from "../components/LoadingState";
import {
  getDashboardOverview,
  getFailureCategories,
  getRecoveryCases,
  getCaseTimeline,
} from "../services/api";
import { formatINR, formatPercent, formatDateTime } from "../utils/format";
import { toLabel } from "../utils/labels";
import { computeAnalyticsMetrics } from "../utils/analyticsMetrics";

const POLL_INTERVAL_MS = 15000;

function Analytics() {
  const [overview, setOverview] = useState(null);
  const [failures, setFailures] = useState([]);
  const [cases, setCases] = useState([]);
  const [timelines, setTimelines] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadAnalytics = useCallback(async ({ soft = false } = {}) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [overviewData, failureData, casesData] = await Promise.all([
        getDashboardOverview(),
        getFailureCategories(),
        getRecoveryCases(),
      ]);

      const caseList = casesData || [];
      setOverview(overviewData);
      setFailures(failureData || []);
      setCases(caseList);

      // Timelines for funnel + recent recoveries (read-only).
      // Prefer recovered cases first; also load others when volume is modest.
      const recovered = caseList.filter(
        (item) => String(item.status || "").toUpperCase() === "RECOVERED"
      );
      const others = caseList.filter(
        (item) => String(item.status || "").toUpperCase() !== "RECOVERED"
      );
      const toFetch =
        caseList.length <= 40
          ? caseList
          : [...recovered, ...others.slice(0, Math.max(0, 40 - recovered.length))];

      const timelineMap = {};
      await Promise.all(
        toFetch.map(async (item) => {
          try {
            timelineMap[item.id] = await getCaseTimeline(item.id);
          } catch (err) {
            console.error(err);
          }
        })
      );
      setTimelines(timelineMap);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      console.error(err);
      setError("Unable to connect to RecoverAI API.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadAnalytics({ soft: true });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadAnalytics]);

  const metrics = useMemo(
    () =>
      computeAnalyticsMetrics({
        overview,
        cases,
        timelines,
        failureCategories: failures,
      }),
    [overview, cases, timelines, failures]
  );

  if (loading) return <LoadingState message="Loading recovery analytics..." />;
  if (error) return <ErrorState message={error} />;
  if (!overview) {
    return <ErrorState message="No analytics data available." detail="" />;
  }

  const statusMax = Math.max(
    ...metrics.statusBreakdown.map((row) => row.count),
    1
  );

  return (
    <div className="page-enter space-y-6">
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-5 border-b border-ink/10 bg-mist-soft/50 px-5 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <p className="eyebrow">Measured recovery</p>
            <h2 className="page-title">Analytics</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-mute">
              See how RecoverAI is performing.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lastUpdated && (
              <p className="text-xs text-ink-faint">
                Updated {formatDateTime(lastUpdated)}
              </p>
            )}
            <button
              type="button"
              onClick={() => loadAnalytics({ soft: true })}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink transition hover:border-pine/30 hover:text-pine disabled:opacity-60"
            >
              <RefreshCw
                size={15}
                className={refreshing ? "animate-spin" : ""}
              />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <Link
              to="/operations"
              className="inline-flex items-center gap-2 rounded-xl bg-ink px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-soft"
            >
              Open operations
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* Hero: money actually recovered */}
      <section className="panel border-pine/20 bg-pine-soft/25 p-6 sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pine">
          Revenue recovery
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Money actually recovered
            </p>
            <p className="mt-1 font-display text-4xl font-medium text-ink sm:text-5xl">
              {formatINR(metrics.amountRecovered)}
            </p>
            {metrics.amountRecovered === 0 && (
              <p className="mt-2 text-sm text-ink-mute">
                ₹0 recovered — no verified recoveries in the database yet.
              </p>
            )}
          </div>
          <div className="pb-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Recovered / At risk
            </p>
            <p className="mt-1 font-mono text-lg text-ink">
              {formatINR(metrics.amountRecovered)}
              <span className="text-ink-faint"> / </span>
              {formatINR(metrics.amountAtRisk)}
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold text-pine">
              {formatPercent(metrics.recoveryRate)}
            </p>
          </div>
        </div>
      </section>

      {/* KPI cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard title="Total Cases" value={metrics.totalCases} />
        <StatCard
          title="Revenue At Risk"
          value={formatINR(metrics.amountAtRisk)}
          tone="warning"
        />
        <StatCard
          title="Revenue Recovered"
          value={formatINR(metrics.amountRecovered)}
          tone="success"
          description="Sum of RecoveryResult.recovered_amount"
        />
        <StatCard
          title="Recovery Rate"
          value={formatPercent(metrics.recoveryRate)}
          tone="info"
          description="Recovered ÷ at risk (API)"
        />
        <StatCard
          title="Active Recovery"
          value={metrics.activeRecovery}
          description="ACTIVE + IN_PROGRESS"
        />
        <StatCard
          title="Escalated"
          value={metrics.escalatedCases}
          tone="danger"
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="panel p-5 sm:p-6">
          <div className="mb-5">
            <h3 className="font-display text-xl font-medium text-ink">
              Recovery performance
            </h3>
            <p className="mt-1 text-sm text-ink-mute">
              Same scope as Dashboard overview — recovered vs exposure
            </p>
          </div>
          <RecoveryProgress
            amountAtRisk={metrics.amountAtRisk}
            amountRecovered={metrics.amountRecovered}
            recoveryRate={metrics.recoveryRate}
          />
        </section>

        <section className="panel p-5 sm:p-6">
          <div className="mb-5">
            <h3 className="font-display text-xl font-medium text-ink">
              Recovery status breakdown
            </h3>
            <p className="mt-1 text-sm text-ink-mute">
              ACTIVE · IN_PROGRESS · RECOVERED · ESCALATED · CLOSED
            </p>
          </div>
          <div className="space-y-4">
            {metrics.statusBreakdown.map((row) => {
              const width = `${Math.max(
                (row.count / statusMax) * 100,
                row.count > 0 ? 6 : 0
              )}%`;
              return (
                <div key={row.status}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <StatusBadge value={row.status} />
                    <span className="font-mono text-xs text-ink-faint">
                      {row.count}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-mist-deep/70">
                    <div
                      className="h-full rounded-full bg-ink/70 transition-all duration-500"
                      style={{ width }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Funnel */}
      <section className="panel p-5 sm:p-6">
        <div className="mb-5">
          <h3 className="font-display text-xl font-medium text-ink">
            Recovery funnel
          </h3>
          <p className="mt-1 text-sm text-ink-mute">
            Stages derived from overview and timeline APIs only — omitted when
            not measurable
          </p>
        </div>
        <ol className="space-y-0">
          {metrics.funnel.map((stage, index) => {
            const isLast = index === metrics.funnel.length - 1;
            return (
              <li
                key={stage.key}
                className={`relative pl-8 ${isLast ? "" : "pb-5"}`}
              >
                {!isLast && (
                  <span
                    className="absolute bottom-0 left-[11px] top-6 w-px bg-ink/10"
                    aria-hidden
                  />
                )}
                <span className="absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-[10px] font-bold text-ink ring-1 ring-ink/10">
                  {index + 1}
                </span>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/8 bg-mist-soft/50 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {stage.name}
                    </p>
                    {stage.detail && (
                      <p className="mt-0.5 text-xs text-ink-faint">
                        {stage.detail}
                      </p>
                    )}
                  </div>
                  <p className="font-mono text-lg font-medium text-ink">
                    {stage.count}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Failure analysis */}
      <section className="panel p-5 sm:p-6">
        <div className="mb-5">
          <h3 className="font-display text-xl font-medium text-ink">
            Failure analysis
          </h3>
          <p className="mt-1 text-sm text-ink-mute">
            Case counts and exposure from APIs. Recovery rate by category uses
            case status RECOVERED ÷ cases in that category — not recovered
            amount attribution.
          </p>
        </div>
        {metrics.failureRows.length === 0 ? (
          <EmptyState message="No failure categories yet." />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <FailureChart
              data={metrics.failureRows.map((row) => ({
                category: row.category,
                count: row.count,
                amount_at_risk: row.amountAtRisk,
              }))}
            />
            <ul className="space-y-2">
              {metrics.failureRows.map((row) => (
                <li
                  key={row.category}
                  className="rounded-xl border border-ink/8 bg-mist-soft/60 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{row.label}</p>
                    <span className="font-mono text-xs text-ink-faint">
                      {row.count} cases
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-ink-mute">
                    At risk {formatINR(row.amountAtRisk)}
                    {row.recoveryRate != null
                      ? ` · Recovery rate ${formatPercent(row.recoveryRate)}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Strategy */}
      <section className="panel p-5 sm:p-6">
        <h3 className="font-display text-xl font-medium text-ink">
          Strategy analysis
        </h3>
        <p className="mt-3 rounded-xl border border-ink/8 bg-mist-soft/70 px-4 py-4 text-sm text-ink-mute">
          {metrics.strategyEffectivenessMessage}
        </p>
        {(metrics.strategyDistribution || []).length > 0 && (
          <ul className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Strategy distribution (counts only)
            </p>
            {metrics.strategyDistribution.map((row) => (
              <li
                key={row.strategy}
                className="flex items-center justify-between rounded-xl border border-ink/8 bg-white px-4 py-3 text-sm"
              >
                <span className="font-medium text-ink">{row.label}</span>
                <span className="font-mono text-xs text-ink-faint">
                  {row.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent recoveries */}
      <section className="panel p-5 sm:p-6">
        <div className="mb-5">
          <h3 className="font-display text-xl font-medium text-ink">
            Recent recoveries
          </h3>
          <p className="mt-1 text-sm text-ink-mute">
            Cases with status RECOVERED and a RecoveryResult from the timeline
            API
          </p>
        </div>
        {metrics.recentRecoveries.length === 0 ? (
          <EmptyState message="No verified recoveries with timeline result data yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  <th className="pb-3 pr-4">Case</th>
                  <th className="pb-3 pr-4">Amount recovered</th>
                  <th className="pb-3 pr-4">Method</th>
                  <th className="pb-3 pr-4">Recovered at</th>
                  <th className="pb-3">Open</th>
                </tr>
              </thead>
              <tbody>
                {metrics.recentRecoveries.map((item) => (
                  <tr key={item.id} className="border-b border-ink/5">
                    <td className="py-3 pr-4 font-mono text-ink">
                      {item.caseNumber}
                    </td>
                    <td className="py-3 pr-4 font-mono text-pine">
                      {item.amountRecovered != null
                        ? formatINR(item.amountRecovered)
                        : "Not available"}
                    </td>
                    <td className="py-3 pr-4 text-ink-mute">
                      {item.recoveryMethod
                        ? toLabel(item.recoveryMethod)
                        : "Not available"}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-ink-mute">
                      {item.recoveredAt
                        ? formatDateTime(item.recoveredAt)
                        : "Not available"}
                    </td>
                    <td className="py-3">
                      <Link
                        to={`/cases/${item.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-pine hover:underline"
                      >
                        View
                        <ArrowUpRight size={12} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(metrics.partiallyRecoveredCases != null ||
        metrics.unrecoveredResultCases != null ||
        metrics.actionCounts) && (
        <section className="panel p-5 sm:p-6">
          <h3 className="font-display text-xl font-medium text-ink">
            Timeline-derived counts
          </h3>
          <p className="mt-1 text-sm text-ink-mute">
            Based on loaded case timelines — not a substitute for overview KPIs
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.partiallyRecoveredCases != null && (
              <div className="rounded-xl border border-ink/8 bg-mist-soft/60 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  Partially recovered (result)
                </p>
                <p className="mt-1 font-mono text-lg text-ink">
                  {metrics.partiallyRecoveredCases}
                </p>
              </div>
            )}
            {metrics.unrecoveredResultCases != null && (
              <div className="rounded-xl border border-ink/8 bg-mist-soft/60 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  Not recovered (result)
                </p>
                <p className="mt-1 font-mono text-lg text-ink">
                  {metrics.unrecoveredResultCases}
                </p>
              </div>
            )}
            {metrics.actionCounts && (
              <>
                <div className="rounded-xl border border-ink/8 bg-mist-soft/60 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                    Actions created
                  </p>
                  <p className="mt-1 font-mono text-lg text-ink">
                    {metrics.actionCounts.actionsCreated}
                  </p>
                </div>
                <div className="rounded-xl border border-ink/8 bg-mist-soft/60 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                    Actions executed
                  </p>
                  <p className="mt-1 font-mono text-lg text-ink">
                    {metrics.actionCounts.actionsExecuted}
                  </p>
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default Analytics;
