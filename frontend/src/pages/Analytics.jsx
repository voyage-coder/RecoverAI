import { useEffect, useState } from "react";
import StatCard from "../components/StatCard";
import FailureChart from "../components/FailureChart";
import RecoveryProgress from "../components/RecoveryProgress";
import LoadingState, { ErrorState } from "../components/LoadingState";
import {
  getDashboardOverview,
  getFailureCategories,
} from "../services/api";
import { formatINR, formatPercent } from "../utils/format";
import { toLabel } from "../utils/labels";

function Analytics() {
  const [overview, setOverview] = useState(null);
  const [failures, setFailures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadAnalytics = async () => {
      try {
        const [overviewData, failureData] = await Promise.all([
          getDashboardOverview(),
          getFailureCategories(),
        ]);
        setOverview(overviewData);
        setFailures(failureData || []);
      } catch (err) {
        console.error(err);
        setError("Unable to connect to RecoverAI API.");
      } finally {
        setLoading(false);
      }
    };

    loadAnalytics();
  }, []);

  if (loading) return <LoadingState message="Loading analytics..." />;
  if (error) return <ErrorState message={error} />;

  const totalFailures = failures.reduce(
    (sum, item) => sum + (item.count || 0),
    0
  );

  return (
    <div className="page-enter space-y-6">
      <div>
        <p className="eyebrow">Insights</p>
        <h2 className="page-title">Analytics</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total Cases" value={overview?.total_cases ?? 0} />
        <StatCard
          title="Amount at Risk"
          value={formatINR(overview?.amount_at_risk)}
          tone="warning"
        />
        <StatCard
          title="Amount Recovered"
          value={formatINR(overview?.amount_recovered)}
          tone="success"
        />
        <StatCard
          title="Recovery Rate"
          value={formatPercent(overview?.recovery_rate)}
          tone="info"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="panel p-6">
          <div className="mb-5">
            <h3 className="font-display text-xl font-medium text-ink">
              Recovery Performance
            </h3>
            <p className="mt-1 text-sm text-ink-mute">
              Recovered value against total exposure
            </p>
          </div>
          <RecoveryProgress
            amountAtRisk={overview?.amount_at_risk}
            amountRecovered={overview?.amount_recovered}
            recoveryRate={overview?.recovery_rate}
          />
        </section>

        <section className="panel p-6">
          <div className="mb-5">
            <h3 className="font-display text-xl font-medium text-ink">
              Case Status Mix
            </h3>
            <p className="mt-1 text-sm text-ink-mute">
              Current distribution across pipeline states
            </p>
          </div>

          <div className="space-y-4">
            {[
              ["Active", overview?.active_cases, "bg-pine"],
              ["In Progress", overview?.in_progress_cases, "bg-skyline"],
              ["Recovered", overview?.recovered_cases, "bg-pine-mid"],
              ["Escalated", overview?.escalated_cases, "bg-clay"],
              ["Closed", overview?.closed_cases, "bg-ink-faint"],
            ].map(([label, value, color]) => {
              const total = overview?.total_cases || 1;
              const width = `${Math.max(((value || 0) / total) * 100, 3)}%`;

              return (
                <div key={label}>
                  <div className="mb-1.5 flex justify-between text-xs">
                    <span className="font-medium text-ink-soft">{label}</span>
                    <span className="font-mono text-ink-faint">{value ?? 0}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-mist-deep/70">
                    <div
                      className={`h-full rounded-full ${color}`}
                      style={{ width }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="panel p-6">
        <div className="mb-5">
          <h3 className="font-display text-xl font-medium text-ink">
            Failure Category Distribution
          </h3>
          <p className="mt-1 text-sm text-ink-mute">
            {totalFailures} categorized failure
            {totalFailures === 1 ? "" : "s"} across recovery cases
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <FailureChart data={failures} />
          <div className="space-y-2">
            {failures.length === 0 ? (
              <p className="text-sm text-ink-mute">No categories available.</p>
            ) : (
              failures.map((item) => (
                <div
                  key={item.category}
                  className="flex items-center justify-between rounded-2xl border border-ink/8 bg-mist-soft/70 px-4 py-3"
                >
                  <span className="text-sm font-medium text-ink-soft">
                    {toLabel(item.category)}
                  </span>
                  <span className="font-mono text-sm font-medium text-ink">
                    {item.count}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default Analytics;
