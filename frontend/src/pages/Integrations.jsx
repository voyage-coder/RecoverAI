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
  saveRazorpayCredentials,
  testRazorpayConnection,
  parseApiError,
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
  "Configure Razorpay TEST credentials (stored on the backend only).",
  "Test the connection, then expose RecoverAI for webhook delivery.",
  "Configure Razorpay webhook: <public-backend-url>/api/webhooks/razorpay",
  "Subscribe to payment.failed and payment.captured.",
  "Live payment.failed creates a recovery case. Demo tools remain optional.",
  "Merchant recovery mode decides automatic / approval / manual execution.",
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
  const [credForm, setCredForm] = useState({
    key_id: "",
    key_secret: "",
    webhook_secret: "",
  });
  const [credMessage, setCredMessage] = useState(null);
  const [credError, setCredError] = useState(null);
  const [savingCreds, setSavingCreds] = useState(false);
  const [testing, setTesting] = useState(false);

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
            Connect Razorpay and configure recovery.
          </p>
        </div>
      </section>

      <div className="rounded-[18px] border border-sand/30 bg-sand-soft/45 px-5 py-4 sm:px-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sand">
          TEST MODE — not Razorpay LIVE production
        </p>
        <p className="mt-2 text-sm text-ink-mute">
          Razorpay TEST mode. Recovery is confirmed only after a verified
          webhook.
        </p>
      </div>

      {(() => {
        const settings = status?.merchant_settings || {};
        const checklist = [
          {
            id: "credentials",
            label: "Credentials",
            done: status?.credentials_configured === true,
            hint: status?.razorpay_key_id_hint || "Save TEST keys below",
          },
          {
            id: "connection",
            label: "Connection",
            done: settings.credentials_last_test_ok === true,
            hint: settings.credentials_last_test_detail || "Run Test connection",
          },
          {
            id: "webhook",
            label: "Webhook",
            done: status?.webhook_secret_configured === true,
            hint: status?.webhook_path || "/api/webhooks/razorpay",
          },
          {
            id: "policy",
            label: "Policy",
            done: Boolean(settings.recovery_mode),
            hint: `${settings.recovery_mode || "MANUAL"} · auto cap ${
              settings.max_automatic_recovery_amount != null
                ? settings.max_automatic_recovery_amount
                : "—"
            } paise`,
          },
        ];
        const ready = checklist.every((item) => item.done);
        return (
          <section className="panel p-5 sm:p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              Setup checklist
            </p>
            <h3 className="mt-2 font-display text-xl font-medium text-ink">
              Credentials → Connection → Webhook → Policy → Ready
            </h3>
            <ol className="mt-4 grid gap-2 sm:grid-cols-5">
              {checklist.map((item, index) => (
                <li
                  key={item.id}
                  className={`rounded-xl border px-3 py-3 ${
                    item.done
                      ? "border-pine/20 bg-pine-soft/40"
                      : "border-ink/10 bg-mist-soft/50"
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                    {index + 1}. {item.label}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {item.done ? "Done" : "Waiting"}
                  </p>
                  <p className="mt-1 break-all text-[11px] text-ink-mute">
                    {item.hint}
                  </p>
                </li>
              ))}
              <li
                className={`rounded-xl border px-3 py-3 ${
                  ready
                    ? "border-pine/20 bg-pine-soft/40"
                    : "border-ink/10 bg-mist-soft/50"
                }`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  5. Ready
                </p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {ready ? "Ready to recover" : "Complete steps 1–4"}
                </p>
                <Link
                  to="/demo-health"
                  className="mt-1 inline-block text-[11px] font-semibold text-pine hover:underline"
                >
                  Open demo health
                </Link>
              </li>
            </ol>
          </section>
        );
      })()}

      <div className="grid gap-4 xl:grid-cols-2">
        <PaymentProviderCard status={status} />
        <WebhookSetupCard status={status} />
      </div>

      <section className="panel p-5 sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Merchant onboarding
        </p>
        <h3 className="mt-2 font-display text-xl font-medium text-ink">
          Razorpay TEST credentials
        </h3>
        <p className="mt-2 text-sm text-ink-mute">
          Secrets are stored on the backend only and are never returned to this
          page. Live keys are rejected. Public key id hint:{" "}
          {status?.razorpay_key_id_hint || "not configured"}
        </p>
        <form
          className="mt-5 grid gap-3 sm:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setSavingCreds(true);
            setCredError(null);
            setCredMessage(null);
            try {
              const payload = {};
              if (credForm.key_id.trim()) payload.key_id = credForm.key_id.trim();
              if (credForm.key_secret.trim()) {
                payload.key_secret = credForm.key_secret.trim();
              }
              if (credForm.webhook_secret.trim()) {
                payload.webhook_secret = credForm.webhook_secret.trim();
              }
              await saveRazorpayCredentials(payload);
              setCredForm({ key_id: "", key_secret: "", webhook_secret: "" });
              setCredMessage("Credentials stored on the backend.");
              loadPage();
            } catch (err) {
              setCredError(parseApiError(err));
            } finally {
              setSavingCreds(false);
            }
          }}
        >
          <input
            className="field font-mono"
            placeholder="Key ID (rzp_test_…)"
            value={credForm.key_id}
            onChange={(e) =>
              setCredForm((prev) => ({ ...prev, key_id: e.target.value }))
            }
            autoComplete="off"
          />
          <input
            className="field font-mono"
            type="password"
            placeholder="Key secret (never shown again)"
            value={credForm.key_secret}
            onChange={(e) =>
              setCredForm((prev) => ({ ...prev, key_secret: e.target.value }))
            }
            autoComplete="new-password"
          />
          <input
            className="field font-mono sm:col-span-2"
            type="password"
            placeholder="Webhook secret (never shown again)"
            value={credForm.webhook_secret}
            onChange={(e) =>
              setCredForm((prev) => ({
                ...prev,
                webhook_secret: e.target.value,
              }))
            }
            autoComplete="new-password"
          />
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={savingCreds}
              className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {savingCreds ? "Saving…" : "Save credentials"}
            </button>
            <button
              type="button"
              disabled={testing}
              onClick={async () => {
                setTesting(true);
                setCredError(null);
                setCredMessage(null);
                try {
                  const result = await testRazorpayConnection();
                  setCredMessage(result.detail);
                  if (result.secrets_returned) {
                    setCredError("Connection test leaked secrets.");
                  }
                  loadPage();
                } catch (err) {
                  setCredError(parseApiError(err));
                } finally {
                  setTesting(false);
                }
              }}
              className="rounded-xl border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink"
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
          </div>
          {credMessage && (
            <p className="text-sm text-pine sm:col-span-2">{credMessage}</p>
          )}
          {credError && (
            <p className="text-sm text-clay sm:col-span-2">{credError}</p>
          )}
        </form>
      </section>

      <SupportedEvents />

      <section className="panel p-5 sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Test connection
        </p>
        <h3 className="mt-2 font-display text-xl font-medium text-ink">
          Create a demo failed payment
        </h3>
        <p className="mt-2 max-w-2xl text-sm text-ink-mute">
          Opens Create demo event. RecoverAI starts a recovery case. It does
          not mark the payment recovered by itself.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            to="/event-console"
            className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-soft"
          >
            <Zap size={15} />
            Create demo event
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
