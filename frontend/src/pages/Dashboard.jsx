import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import StatCard from "../components/StatCard";
import StatusBadge from "../components/StatusBadge";
import RecoveryProgress from "../components/RecoveryProgress";
import FailureChart from "../components/FailureChart";
import ActivityFeed from "../components/ActivityFeed";
import LoadingState, {
  ErrorState,
  EmptyState,
} from "../components/LoadingState";
import {
  getDashboardOverview,
  getRecentActivity,
  getFailureCategories,
  getRecoveryCases,
} from "../services/api";
import { formatINR, formatPercent, formatDateTime } from "../utils/format";
import { toLabel } from "../utils/labels";

const STATUS_ROWS = [
  { key: "active_cases", status: "ACTIVE", tone: "bg-pine" },
  { key: "in_progress_cases", status: "IN_PROGRESS", tone: "bg-sand" },
  { key: "recovered_cases", status: "RECOVERED", tone: "bg-pine-mid" },
  { key: "escalated_cases", status: "ESCALATED", tone: "bg-clay" },
  { key: "closed_cases", status: "CLOSED", tone: "bg-ink-soft" },
];

function CaseStatusDistribution({ overview }) {
  const rows = STATUS_ROWS.map((row) => ({
    ...row,
    count: Number(overview?.[row.key] || 0),
  }));
  const max = Math.max(...rows.map((row) => row.count), 1);
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  if (total === 0) {
    return <EmptyState message="No cases yet — status distribution is empty." />;
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const width = `${Math.max((row.count / max) * 100, row.count > 0 ? 6 : 0)}%`;
        const share = total > 0 ? Math.round((row.count / total) * 100) : 0;

        return (
          <div key={row.status}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <StatusBadge value={row.status} />
                <span className="text-sm text-ink-soft">
                  {toLabel(row.status)}
                </span>
              </div>
              <span className="font-mono text-xs text-ink-faint">
                {row.count}
                <span className="mx-1 text-ink/20">·</span>
                {share}%
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-mist-deep/70">
              <div
                className={`h-full rounded-full ${row.tone} transition-all duration-700`}
                style={{ width }}
              />
            </div>
          </div>
        );
      })}
      <p className="text-xs text-ink-mute">
        These counts come from live case statuses in the RecoverAI database.
      </p>
    </div>
  );
}

function LatestRecoveryHighlight({ caseItem }) {
  if (!caseItem) {
    return (
      <EmptyState message="No recovered cases yet. Successes will appear here." />
    );
  }

  return (
    <div className="rounded-[18px] border border-pine/20 bg-pine-soft/40 p-5 sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pine">
        Latest recovery success
      </p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          {caseItem.id ? (
            <Link
              to={`/cases/${caseItem.id}`}
              className="font-display text-2xl font-medium text-ink hover:text-pine"
            >
              {caseItem.case_number}
            </Link>
          ) : (
            <p className="font-display text-2xl font-medium text-ink">
              {caseItem.case_number}
            </p>
          )}
          <p className="mt-2 font-mono text-xl font-medium text-pine">
            {formatINR(caseItem.amount_at_risk)} recovered exposure
          </p>
          <p className="mt-2 text-sm text-ink-mute">
            {toLabel(caseItem.current_step)}
            {caseItem.updated_at
              ? ` · Updated ${formatDateTime(caseItem.updated_at)}`
              : ""}
          </p>
        </div>
        <StatusBadge value={caseItem.status} label="RECOVERED" />
      </div>
      {caseItem.id && (
        <Link
          to={`/cases/${caseItem.id}`}
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-pine hover:underline"
        >
          Open case details
          <ArrowUpRight size={14} />
        </Link>
      )}
    </div>
  );
}

function Dashboard() {
  const [overview, setOverview] = useState(null);
  const [activity, setActivity] = useState([]);
  const [failures, setFailures] = useState([]);
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadDashboard = useCallback(async ({ soft = false } = {}) => {
    if (soft) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [overviewData, activityData, failureData, casesData] =
        await Promise.all([
          getDashboardOverview(),
          getRecentActivity(),
          getFailureCategories(),
          getRecoveryCases(),
        ]);

      const caseList = casesData || [];
      setOverview(overviewData);
      setFailures(failureData || []);
      setCases(caseList);

      const lookup = {};
      caseList.forEach((item) => {
        lookup[item.case_number] = item;
      });

      setActivity(
        (activityData || []).map((item) => {
          const match = lookup[item.case_number];
          return {
            ...item,
            case_id: match?.id,
            amount_at_risk: match?.amount_at_risk,
          };
        })
      );
    } catch (err) {
      console.error(err);
      setError("Unable to connect to RecoverAI API.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const failureChartData = useMemo(() => {
    if (!failures.length) return [];

    const amountByCategory = {};
    cases.forEach((item) => {
      const key = item.failure_category;
      if (!key) return;
      amountByCategory[key] =
        (amountByCategory[key] || 0) + (Number(item.amount_at_risk) || 0);
    });

    return failures.map((item) => ({
      ...item,
      amount_at_risk: amountByCategory[item.category] || 0,
    }));
  }, [failures, cases]);

  const latestRecovered = useMemo(() => {
    const recovered = cases.filter(
      (item) => String(item.status).toUpperCase() === "RECOVERED"
    );
    if (!recovered.length) return null;

    return [...recovered].sort((a, b) => {
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      return bTime - aTime;
    })[0];
  }, [cases]);

  if (loading) return <LoadingState message="Loading dashboard..." />;
  if (error) return <ErrorState message={error} />;
  if (!overview) {
    return <ErrorState message="No dashboard data available." detail="" />;
  }

  const hasCases = Number(overview.total_cases || 0) > 0;

  return (
    <div className="page-enter space-y-8">
      {/* Intro */}
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-5 border-b border-ink/10 bg-mist-soft/50 px-5 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <p className="eyebrow">Recovery Operations</p>
            <h2 className="page-title">Dashboard</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-mute">
              A live snapshot of failed payments RecoverAI is working on —
              how much money is exposed, how much came back, and what happened
              recently. All numbers come from your real backend data.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => loadDashboard({ soft: true })}
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
              to="/cases"
              className="inline-flex items-center gap-2 rounded-xl bg-ink px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-soft"
            >
              Open cases
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {!hasCases ? (
        <EmptyState message="No recovery cases yet. When payments fail and enter recovery, KPIs will appear here." />
      ) : (
        <>
          {/* 1. KPI cards */}
          <section>
            <div className="mb-4">
              <h3 className="font-display text-xl font-medium text-ink">
                Key numbers
              </h3>
              <p className="mt-1 text-sm text-ink-mute">
                The six metrics most useful when presenting RecoverAI
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard
                title="Total Recovery Cases"
                value={overview.total_cases}
                description="Every case RecoverAI has opened"
              />
              <StatCard
                title="Total Amount At Risk"
                value={formatINR(overview.amount_at_risk)}
                description="Sum of failed-payment exposure"
                tone="warning"
              />
              <StatCard
                title="Total Amount Recovered"
                value={formatINR(overview.amount_recovered)}
                description={`${overview.recovered_cases} case(s) marked recovered`}
                tone="success"
              />
              <StatCard
                title="Recovery Rate"
                value={formatPercent(overview.recovery_rate)}
                description="Recovered amount ÷ amount at risk (live API)"
                tone="info"
              />
              <StatCard
                title="Active Cases"
                value={overview.active_cases}
                description="Cases waiting to move forward"
              />
              <StatCard
                title="Escalated Cases"
                value={overview.escalated_cases}
                description="Cases sent for human follow-up"
                tone="danger"
              />
            </div>
          </section>

          {/* 6. Success highlight */}
          <section className="panel p-5 sm:p-6">
            <div className="mb-5">
              <h3 className="font-display text-xl font-medium text-ink">
                Recovery success highlight
              </h3>
              <p className="mt-1 text-sm text-ink-mute">
                Most recently updated case with status RECOVERED (not hard-coded)
              </p>
            </div>
            <LatestRecoveryHighlight caseItem={latestRecovered} />
          </section>

          {/* 2 + 3 */}
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="panel p-5 sm:p-6">
              <div className="mb-6">
                <h3 className="font-display text-xl font-medium text-ink">
                  Recovery performance
                </h3>
                <p className="mt-1 text-sm text-ink-mute">
                  Recovered money vs remaining exposure, from dashboard overview
                </p>
              </div>
              <RecoveryProgress
                amountAtRisk={overview.amount_at_risk}
                amountRecovered={overview.amount_recovered}
                recoveryRate={overview.recovery_rate}
              />
            </section>

            <section className="panel p-5 sm:p-6">
              <div className="mb-6">
                <h3 className="font-display text-xl font-medium text-ink">
                  Case status distribution
                </h3>
                <p className="mt-1 text-sm text-ink-mute">
                  ACTIVE · IN_PROGRESS · RECOVERED · ESCALATED · CLOSED
                </p>
              </div>
              <CaseStatusDistribution overview={overview} />
            </section>
          </div>

          {/* 4. Failure categories */}
          <section className="panel p-5 sm:p-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-xl font-medium text-ink">
                  Failure category analytics
                </h3>
                <p className="mt-1 text-sm text-ink-mute">
                  Why payments failed — counts from the API, amounts from cases
                </p>
              </div>
              <Link
                to="/analytics"
                className="text-xs font-semibold text-pine hover:underline"
              >
                Open analytics
              </Link>
            </div>
            {!failureChartData.length ? (
              <EmptyState message="No failure category data available." />
            ) : (
              <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                <FailureChart data={failureChartData} />
                <div className="space-y-3">
                  {[...failureChartData]
                    .sort((a, b) => (b.count || 0) - (a.count || 0))
                    .slice(0, 5)
                    .map((item) => (
                      <div
                        key={item.category}
                        className="rounded-2xl border border-ink/8 bg-mist-soft/70 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-ink">
                            {toLabel(item.category)}
                          </p>
                          <span className="font-mono text-xs text-ink-faint">
                            {item.count} cases
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-xs text-ink-mute">
                          Exposure {formatINR(item.amount_at_risk || 0)}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </section>

          {/* 5. Recent activity */}
          <section className="panel p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-xl font-medium text-ink">
                  Recent recovery activity
                </h3>
                <p className="mt-1 text-sm text-ink-mute">
                  Latest case updates — case number, step, status, time, amount
                </p>
              </div>
              <Link
                to="/activity"
                className="text-xs font-semibold text-pine hover:underline"
              >
                View all activity
              </Link>
            </div>
            <ActivityFeed items={activity.slice(0, 8)} />
          </section>
        </>
      )}
    </div>
  );
}

export default Dashboard;
