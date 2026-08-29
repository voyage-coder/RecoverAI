import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Zap } from "lucide-react";
import PaymentProviderCard from "../components/PaymentProviderCard";
import WebhookSetupCard from "../components/WebhookSetupCard";
import SupportedEvents from "../components/SupportedEvents";
import IntegrationHealth from "../components/IntegrationHealth";
import LiveEventFeed from "../components/LiveEventFeed";
import LoadingState, { ErrorState } from "../components/LoadingState";
import {
  getIntegrationStatus,
  getDashboardOverview,
  getRecentActivity,
  getRecoveryCases,
  getCaseTimeline,
  getCasePaymentDetails,
} from "../services/api";
import {
  selectCasesForDetailFetch,
  buildLiveEvents,
} from "../utils/liveEvents";

const WORKFLOW_STEPS = [
  "PAYMENT FAILURE",
  "RecoverAI receives event",
  "AI diagnoses failure",
  "Safety Engine evaluates action",
  "Recovery action",
  "Customer completes payment",
  "Verified payment.captured",
  "REVENUE RECOVERED",
];

const CONNECT_STEPS = [
  "Configure Razorpay TEST credentials in backend environment.",
  "Expose RecoverAI backend publicly when required for webhook delivery.",
  "Configure Razorpay webhook: <public-backend-url>/api/webhooks/razorpay",
  "Subscribe to payment.captured.",
  "Send a TEST payment failure through the simulator or provider event.",
  "RecoverAI creates the recovery case.",
  "Merchant executes the approved recovery action.",
  "Customer completes TEST payment.",
  "Razorpay sends payment.captured.",
  "RecoverAI verifies webhook and marks the case RECOVERED.",
];

function Integrations() {
  const [status, setStatus] = useState(null);
  const [overview, setOverview] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const [lastActivityAt, setLastActivityAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [statusData, overviewData, activityData, casesData] =
        await Promise.all([
          getIntegrationStatus(),
          getDashboardOverview(),
          getRecentActivity(),
          getRecoveryCases(),
        ]);

      setStatus(statusData);
      setOverview(overviewData);

      const activity = activityData || [];
      setLastActivityAt(activity[0]?.updated_at || null);

      const caseList = casesData || [];
      const detailCases = selectCasesForDetailFetch(caseList, 12);
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

      setRecentEvents(
        buildLiveEvents({
          cases: detailCases,
          timelines: timelineMap,
          paymentDetailsByCase: paymentMap,
        }).slice(0, 5)
      );
    } catch (err) {
      console.error(err);
      setError("Unable to load integration center from RecoverAI API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  const workflow = useMemo(() => WORKFLOW_STEPS, []);

  if (loading) {
    return <LoadingState message="Loading payment integration..." />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="page-enter space-y-6">
      <section className="panel overflow-hidden">
        <div className="border-b border-ink/10 bg-mist-soft/50 px-5 py-6 sm:px-6">
          <p className="eyebrow">Merchant platform</p>
          <h2 className="page-title">Integrations</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-mute">
            Connect your payments to RecoverAI. See what provider is linked,
            how failure and capture events arrive, and how to test recovery
            safely in TEST MODE.
          </p>
        </div>
      </section>

      <div className="rounded-[18px] border border-sand/30 bg-sand-soft/45 px-5 py-4 sm:px-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sand">
          Demo environment — Razorpay TEST MODE
        </p>
        <p className="mt-2 text-sm text-ink-mute">
          No real customer money is processed. The payment event simulator
          creates realistic failure events. Razorpay TEST Checkout demonstrates
          the actual payment confirmation flow. This is measured TEST recovery —
          not fabricated recovery.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <PaymentProviderCard status={status} />
        <WebhookSetupCard status={status} />
      </div>

      <SupportedEvents />

      <section className="panel p-5 sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Test connection
        </p>
        <h3 className="mt-2 font-display text-xl font-medium text-ink">
          Send a TEST payment failure
        </h3>
        <p className="mt-2 max-w-2xl text-sm text-ink-mute">
          Uses the existing{" "}
          <span className="font-mono text-xs">POST /api/events/payment</span>{" "}
          simulator. RecoverAI receives the failure, creates a case, runs AI
          diagnosis, and selects a recovery strategy. It does{" "}
          <span className="font-semibold text-ink">not</span> mark the case
          recovered automatically.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            to="/event-console"
            className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-soft"
          >
            <Zap size={15} />
            Open Provider Event Console
          </Link>
          <Link
            to="/batch-demo"
            className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-pine/30"
          >
            Open batch recovery demo
            <ArrowUpRight size={14} />
          </Link>
        </div>
        <ol className="mt-5 space-y-1 text-sm text-ink-mute">
          <li>1. TEST EVENT → RecoverAI receives failure</li>
          <li>2. Case created → AI diagnosis → Recovery strategy</li>
          <li>3. Merchant executes action → Customer pays in TEST Checkout</li>
          <li>4. Verified payment.captured → RECOVERED</li>
        </ol>
      </section>

      <IntegrationHealth
        overview={overview}
        lastActivityAt={lastActivityAt}
      />

      <section className="panel p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-medium text-ink">
              Recent incoming events
            </h3>
            <p className="mt-1 text-sm text-ink-mute">
              Newest 5 events from the same Live Activity derivation
            </p>
          </div>
          <Link
            to="/live-activity"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-pine hover:underline"
          >
            View live activity
            <ArrowUpRight size={12} />
          </Link>
        </div>
        <LiveEventFeed
          events={recentEvents}
          emptyMessage="No recent recovery events yet. Send a TEST payment failure to start."
        />
      </section>

      <section className="panel p-5 sm:p-6">
        <h3 className="font-display text-xl font-medium text-ink">
          How it works
        </h3>
        <p className="mt-1 text-sm text-ink-mute">
          Merchant workflow from failure to verified revenue recovery
        </p>
        <ol className="mt-5 space-y-0">
          {workflow.map((step, index) => {
            const isLast = index === workflow.length - 1;
            return (
              <li
                key={step}
                className={`relative pl-8 ${isLast ? "" : "pb-4"}`}
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
                <p className="rounded-xl border border-ink/8 bg-mist-soft/50 px-4 py-3 text-sm font-medium text-ink">
                  {step}
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="panel p-5 sm:p-6">
        <h3 className="font-display text-xl font-medium text-ink">
          How to connect
        </h3>
        <p className="mt-1 text-sm text-ink-mute">
          Compact setup checklist — webhook is not configured automatically
        </p>
        <ol className="mt-5 space-y-3">
          {CONNECT_STEPS.map((step, index) => (
            <li
              key={step}
              className="flex gap-3 rounded-xl border border-ink/8 bg-mist-soft/50 px-4 py-3"
            >
              <span className="font-mono text-xs font-semibold text-ink-faint">
                {index + 1}
              </span>
              <p className="text-sm text-ink-mute">{step}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default Integrations;
