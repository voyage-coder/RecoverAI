import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import StatCard from "../components/StatCard";
import RecoveryProgress from "../components/RecoveryProgress";
import FailureChart from "../components/FailureChart";
import ActivityFeed from "../components/ActivityFeed";
import LoadingState, { ErrorState } from "../components/LoadingState";
import {
  getDashboardOverview,
  getRecentActivity,
  getFailureCategories,
  getRecoveryCases,
} from "../services/api";
import { formatINR, formatPercent } from "../utils/format";

function Dashboard() {
  const [overview, setOverview] = useState(null);
  const [activity, setActivity] = useState([]);
  const [failures, setFailures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [overviewData, activityData, failureData, casesData] =
          await Promise.all([
            getDashboardOverview(),
            getRecentActivity(),
            getFailureCategories(),
            getRecoveryCases(),
          ]);

        setOverview(overviewData);
        setFailures(failureData || []);

        const lookup = {};
        (casesData || []).forEach((item) => {
          lookup[item.case_number] = item.id;
        });

        setActivity(
          (activityData || []).map((item) => ({
            ...item,
            case_id: lookup[item.case_number],
          }))
        );
      } catch (err) {
        console.error(err);
        setError("Unable to connect to RecoverAI API.");
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, []);

  if (loading) return <LoadingState message="Loading dashboard..." />;
  if (error) return <ErrorState message={error} />;
  if (!overview) {
    return <ErrorState message="No dashboard data available." detail="" />;
  }

  return (
    <div className="page-enter space-y-8">
      <section className="relative overflow-hidden rounded-[22px] border border-ink/10 bg-ink text-white shadow-lift">
        <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-pine/30 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-skyline/25 blur-3xl" />
        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.3fr_0.7fr] lg:p-10">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
              Recovery Operations
            </p>
            <h2 className="mt-3 max-w-xl font-display text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
              Quiet control over every failed payment.
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/60">
              Live exposure, recovery velocity, and pipeline health — drawn
              directly from your RecoverAI API.
            </p>
            <Link
              to="/cases"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-mist-soft"
            >
              Open recovery cases
              <ArrowUpRight size={15} />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 self-end">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                At risk
              </p>
              <p className="mt-2 font-mono text-xl font-medium">
                {formatINR(overview.amount_at_risk)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                Recovered
              </p>
              <p className="mt-2 font-mono text-xl font-medium text-emerald-300">
                {formatINR(overview.amount_recovered)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                Rate
              </p>
              <p className="mt-2 font-mono text-xl font-medium">
                {formatPercent(overview.recovery_rate)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                Cases
              </p>
              <p className="mt-2 font-mono text-xl font-medium">
                {overview.total_cases}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Recovery Cases"
          value={overview.total_cases}
          description="All cases in the recovery pipeline"
        />
        <StatCard
          title="Amount at Risk"
          value={formatINR(overview.amount_at_risk)}
          description="Total exposure across cases"
          tone="warning"
        />
        <StatCard
          title="Amount Recovered"
          value={formatINR(overview.amount_recovered)}
          description={`${overview.recovered_cases} cases recovered`}
          tone="success"
        />
        <StatCard
          title="Recovery Rate"
          value={formatPercent(overview.recovery_rate)}
          description="Recovered amount / amount at risk"
          tone="info"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Active Cases" value={overview.active_cases} />
        <StatCard
          title="In Progress"
          value={overview.in_progress_cases}
          tone="info"
        />
        <StatCard
          title="Recovered"
          value={overview.recovered_cases}
          tone="success"
        />
        <StatCard
          title="Escalated"
          value={overview.escalated_cases}
          tone="danger"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="panel p-6">
          <div className="mb-6">
            <h3 className="font-display text-xl font-medium text-ink">
              Recovery Performance
            </h3>
            <p className="mt-1 text-sm text-ink-mute">
              Exposure versus recovered value
            </p>
          </div>
          <RecoveryProgress
            amountAtRisk={overview.amount_at_risk}
            amountRecovered={overview.amount_recovered}
            recoveryRate={overview.recovery_rate}
          />
        </section>

        <section className="panel p-6">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-xl font-medium text-ink">
                Failure Analytics
              </h3>
              <p className="mt-1 text-sm text-ink-mute">
                Distribution by failure category
              </p>
            </div>
            <Link
              to="/analytics"
              className="text-xs font-semibold text-pine hover:underline"
            >
              Details
            </Link>
          </div>
          <FailureChart data={failures} />
        </section>
      </div>

      <section className="panel p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-medium text-ink">
              Recent Activity
            </h3>
            <p className="mt-1 text-sm text-ink-mute">
              Latest case updates across the pipeline
            </p>
          </div>
          <Link
            to="/activity"
            className="text-xs font-semibold text-pine hover:underline"
          >
            View all
          </Link>
        </div>
        <ActivityFeed items={activity.slice(0, 6)} />
      </section>
    </div>
  );
}

export default Dashboard;
