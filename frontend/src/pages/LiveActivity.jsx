import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Pause, Play, RefreshCw } from "lucide-react";
import LiveEventFeed from "../components/LiveEventFeed";
import StatusBadge from "../components/StatusBadge";
import LoadingState, {
  ErrorState,
  EmptyState,
} from "../components/LoadingState";
import {
  getRecoveryCases,
  getCaseTimeline,
  getCasePaymentDetails,
} from "../services/api";
import { formatDateTime, formatINR } from "../utils/format";
import { toLabel } from "../utils/labels";
import {
  LIVE_FILTERS,
  LIVE_POLL_INTERVAL_MS,
  selectCasesForDetailFetch,
  buildLiveEvents,
  filterLiveEvents,
  buildAttentionItems,
} from "../utils/liveEvents";

function LiveActivity() {
  const [cases, setCases] = useState([]);
  const [timelines, setTimelines] = useState({});
  const [paymentDetailsByCase, setPaymentDetailsByCase] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("all");

  const loadLiveData = useCallback(async ({ soft = false } = {}) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const caseList = (await getRecoveryCases()) || [];
      setCases(caseList);

      const detailCases = selectCasesForDetailFetch(caseList, 35);
      const timelineMap = {};
      const paymentMap = {};

      await Promise.all(
        detailCases.map(async (item) => {
          try {
            const [timeline, paymentDetails] = await Promise.all([
              getCaseTimeline(item.id),
              getCasePaymentDetails(item.id),
            ]);
            timelineMap[item.id] = timeline;
            paymentMap[item.id] = paymentDetails;
          } catch (err) {
            console.error(err);
          }
        })
      );

      setTimelines(timelineMap);
      setPaymentDetailsByCase(paymentMap);
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
    loadLiveData();
  }, [loadLiveData]);

  useEffect(() => {
    if (paused) return undefined;
    const intervalId = window.setInterval(() => {
      loadLiveData({ soft: true });
    }, LIVE_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadLiveData, paused]);

  const allEvents = useMemo(
    () =>
      buildLiveEvents({
        cases,
        timelines,
        paymentDetailsByCase,
      }),
    [cases, timelines, paymentDetailsByCase]
  );

  const visibleEvents = useMemo(
    () => filterLiveEvents(allEvents, filter),
    [allEvents, filter]
  );

  const attentionItems = useMemo(
    () =>
      buildAttentionItems({
        cases,
        timelines,
        paymentDetailsByCase,
      }),
    [cases, timelines, paymentDetailsByCase]
  );

  const filterCounts = useMemo(() => {
    const counts = { all: allEvents.length };
    LIVE_FILTERS.forEach((item) => {
      if (item.key === "all") return;
      counts[item.key] = filterLiveEvents(allEvents, item.key).length;
    });
    return counts;
  }, [allEvents]);

  if (loading) {
    return <LoadingState message="Loading live recovery activity..." />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="page-enter space-y-6">
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-5 border-b border-ink/10 bg-mist-soft/50 px-5 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="eyebrow">Event activity center</p>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                  paused
                    ? "bg-mist-deep text-ink-mute"
                    : "bg-pine-soft text-pine"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    paused ? "bg-ink-faint" : "bg-pine"
                  }`}
                />
                {paused ? "Paused" : "Live"}
              </span>
            </div>
            <h2 className="page-title">Live Activity</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-mute">
              Recovery events derived from live case, timeline, and payment
              APIs — polled every {LIVE_POLL_INTERVAL_MS / 1000}s. No fabricated
              stream.
            </p>
            {lastUpdated && (
              <p className="mt-2 text-xs text-ink-faint">
                Last updated: {formatDateTime(lastUpdated)}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => loadLiveData({ soft: true })}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink transition hover:border-pine/30 hover:text-pine disabled:opacity-60"
            >
              <RefreshCw
                size={15}
                className={refreshing ? "animate-spin" : ""}
              />
              Refresh now
            </button>
            <button
              type="button"
              onClick={() => setPaused((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink transition hover:border-pine/30"
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}
              {paused ? "Resume live updates" : "Pause live updates"}
            </button>
          </div>
        </div>
      </section>

      {/* What needs attention */}
      <section className="panel p-5 sm:p-6">
        <div className="mb-5">
          <h3 className="font-display text-xl font-medium text-ink">
            What needs attention now
          </h3>
          <p className="mt-1 text-sm text-ink-mute">
            ESCALATED · ACTIVE · IN_PROGRESS · awaiting customer payment —
            from real case and payment API state
          </p>
        </div>

        {attentionItems.length === 0 ? (
          <EmptyState message="Nothing needs attention right now." />
        ) : (
          <div className="space-y-3">
            {attentionItems.slice(0, 12).map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-ink/8 bg-mist-soft/50 px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm font-semibold text-ink">
                        {item.caseNumber}
                      </p>
                      <StatusBadge value={item.status} />
                      {item.awaiting && (
                        <StatusBadge
                          value="AWAITING"
                          label="Awaiting payment"
                          tone="warning"
                        />
                      )}
                    </div>
                    <p className="mt-2 font-mono text-lg text-ink">
                      {formatINR(item.amountAtRisk)}
                    </p>
                    <p className="mt-1 text-sm text-ink-mute">
                      {item.failureReason ||
                        toLabel(item.failureCategory) ||
                        "Failure reason not available"}
                    </p>
                    <p className="mt-1 text-xs text-ink-faint">
                      Current step:{" "}
                      {item.currentStep
                        ? toLabel(item.currentStep)
                        : "Not available"}
                    </p>
                    {item.recommended && (
                      <p className="mt-2 text-sm font-medium text-ink">
                        Recommended: {item.recommended}
                      </p>
                    )}
                  </div>
                  <Link
                    to={`/cases/${item.id}?from=live`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink transition hover:border-pine/30 hover:text-pine"
                  >
                    Review case
                    <ArrowUpRight size={12} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Filters */}
      <section className="panel p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          {LIVE_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                filter === item.key
                  ? "bg-ink text-white"
                  : "border border-ink/10 bg-white text-ink-soft hover:border-pine/30"
              }`}
            >
              {item.label}
              <span className="ml-1.5 font-mono text-[10px] opacity-70">
                {filterCounts[item.key] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-medium text-ink">
              Live event stream
            </h3>
            <p className="mt-1 text-sm text-ink-mute">
              Newest first · {visibleEvents.length} event
              {visibleEvents.length === 1 ? "" : "s"} in view
            </p>
          </div>
          <Link
            to="/operations"
            className="text-xs font-semibold text-pine hover:underline"
          >
            Open operations
          </Link>
        </div>
        <LiveEventFeed
          events={visibleEvents}
          emptyMessage="No events match this filter for the loaded cases."
        />
      </section>
    </div>
  );
}

export default LiveActivity;
