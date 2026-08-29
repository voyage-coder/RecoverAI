import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Sparkles } from "lucide-react";
import StatusBadge from "../components/StatusBadge";
import RecoveryTimeline from "../components/RecoveryTimeline";
import CaseRecoveryProgress from "../components/CaseRecoveryProgress";
import RecoveryOutcomeBanner from "../components/RecoveryOutcomeBanner";
import OperationsSummary from "../components/OperationsSummary";
import RecoveryOperationsPanel from "../components/RecoveryOperationsPanel";
import CustomerRecoveryPanel from "../components/CustomerRecoveryPanel";
import RecommendedActionCard from "../components/RecommendedActionCard";
import AIRecoveryDecision from "../components/AIRecoveryDecision";
import CustomerRecoveryJourney from "../components/CustomerRecoveryJourney";
import LiveRecoveryState from "../components/LiveRecoveryState";
import RecoveryActivityFeed from "../components/RecoveryActivityFeed";
import DemoFlowGuide from "../components/DemoFlowGuide";
import LoadingState, {
  ErrorState,
  EmptyState,
} from "../components/LoadingState";
import {
  getRecoveryCase,
  getCaseTimeline,
  getCaseDecision,
  getCasePaymentDetails,
  getCheckoutConfig,
  executePendingRecoveryAction,
  continueRecovery,
  parseApiError,
} from "../services/api";
import { formatINR, formatDateTime } from "../utils/format";
import { toLabel } from "../utils/labels";
import {
  deriveRecoveryStages,
  shouldPollRecoveryCase,
} from "../utils/recoveryStages";
import { deriveLiveRecoveryState } from "../utils/liveRecoveryState";
import { buildRecoveryActivityEvents } from "../utils/recoveryActivity";
import { deriveCustomerRecoveryJourney } from "../utils/customerJourney";

const POLL_INTERVAL_MS = 8000;
const NA = "Not available";

function displayText(value) {
  if (value == null || value === "") return NA;
  return value;
}

function displayLabel(value) {
  if (value == null || value === "") return NA;
  const labeled = toLabel(value);
  return labeled === "—" ? NA : labeled;
}

function displayMoney(paise) {
  if (paise == null || Number.isNaN(Number(paise))) return NA;
  return formatINR(paise);
}

function displayWhen(value) {
  if (!value) return NA;
  const formatted = formatDateTime(value);
  return formatted === "—" ? NA : formatted;
}

function SectionHeading({ title, subtitle }) {
  return (
    <div className="mb-5">
      <h3 className="font-display text-xl font-medium text-ink">{title}</h3>
      {subtitle && (
        <p className="mt-1 text-sm text-ink-mute">{subtitle}</p>
      )}
    </div>
  );
}

function DetailItem({ label, value, children, mono = false }) {
  return (
    <div className="rounded-2xl border border-ink/8 bg-mist-soft/80 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </p>
      <div
        className={`mt-2 text-sm font-medium text-ink break-words ${
          mono ? "font-mono text-[13px]" : ""
        }`}
      >
        {children != null ? children : displayText(value)}
      </div>
    </div>
  );
}

function attemptTone(attempt) {
  const status = String(attempt?.status || "").toUpperCase();
  const code = String(attempt?.error_code || "").toUpperCase();
  if (status === "SUCCESS") return "success";
  if (
    code.includes("AWAITING") ||
    attempt?.gateway?.awaiting_webhook === true ||
    status === "PENDING"
  ) {
    return "warning";
  }
  return "danger";
}

function attemptLabel(attempt) {
  const status = String(attempt?.status || "").toUpperCase();
  const code = String(attempt?.error_code || "").toUpperCase();
  if (status === "SUCCESS") return "SUCCESS";
  if (
    code.includes("AWAITING") ||
    attempt?.gateway?.awaiting_webhook === true
  ) {
    return "AWAITING";
  }
  if (status === "PENDING") return "PENDING";
  return status || "FAILED";
}

function CaseDetails() {
  const { caseId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const fromSimulate = searchParams.get("from") === "simulate";
  const fromLive = searchParams.get("from") === "live";

  const [recoveryCase, setRecoveryCase] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [decision, setDecision] = useState(null);
  const [decisionError, setDecisionError] = useState(null);
  const [paymentDetails, setPaymentDetails] = useState(null);
  const [paymentDetailsError, setPaymentDetailsError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [checkoutConfig, setCheckoutConfig] = useState(null);
  const [operating, setOperating] = useState(false);
  const [operationMessage, setOperationMessage] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [postCheckoutPolling, setPostCheckoutPolling] = useState(false);

  const loadCaseData = useCallback(
    async ({ soft = false } = {}) => {
      if (soft) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const [caseData, timelineData] = await Promise.all([
          getRecoveryCase(caseId),
          getCaseTimeline(caseId),
        ]);
        setRecoveryCase(caseData);
        setTimeline(timelineData);
        setLastUpdated(new Date());

        try {
          const decisionData = await getCaseDecision(caseId);
          setDecision(decisionData);
          setDecisionError(null);
        } catch (decisionErr) {
          console.error(decisionErr);
          setDecision(null);
          setDecisionError(parseApiError(decisionErr));
        }

        try {
          const paymentData = await getCasePaymentDetails(caseId);
          setPaymentDetails(paymentData);
          setPaymentDetailsError(null);
        } catch (paymentErr) {
          console.error(paymentErr);
          setPaymentDetails(null);
          setPaymentDetailsError(
            "Payment and gateway details are not available for this case."
          );
        }

        try {
          const checkout = await getCheckoutConfig(caseId);
          setCheckoutConfig(checkout);
        } catch (checkoutErr) {
          console.error(checkoutErr);
          setCheckoutConfig(null);
        }
      } catch (err) {
        console.error(err);
        setError("Unable to connect to RecoverAI API.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [caseId]
  );

  useEffect(() => {
    loadCaseData();
  }, [loadCaseData]);

  useEffect(() => {
    if (!shouldPollRecoveryCase(recoveryCase) && !postCheckoutPolling) {
      return undefined;
    }

    const intervalMs = postCheckoutPolling ? 3000 : POLL_INTERVAL_MS;
    const intervalId = window.setInterval(() => {
      loadCaseData({ soft: true });
    }, intervalMs);

    return () => window.clearInterval(intervalId);
  }, [
    recoveryCase?.status,
    recoveryCase?.id,
    loadCaseData,
    postCheckoutPolling,
  ]);

  useEffect(() => {
    if (
      postCheckoutPolling &&
      String(recoveryCase?.status || "").toUpperCase() === "RECOVERED"
    ) {
      setPostCheckoutPolling(false);
      setOperationMessage(
        "Verified webhook applied — case is RECOVERED."
      );
    }
  }, [postCheckoutPolling, recoveryCase?.status]);

  useEffect(() => {
    if (!postCheckoutPolling) return undefined;
    const timeoutId = window.setTimeout(() => {
      setPostCheckoutPolling(false);
    }, 90000);
    return () => window.clearTimeout(timeoutId);
  }, [postCheckoutPolling]);

  const strategies = timeline?.strategies || [];
  const actions = timeline?.actions || [];
  const communications = timeline?.communications || [];
  const result = timeline?.result;

  const selectedStrategies = useMemo(
    () => strategies.filter((item) => item.is_selected),
    [strategies]
  );
  const alternativeStrategies = useMemo(
    () => strategies.filter((item) => !item.is_selected),
    [strategies]
  );

  const payment = paymentDetails?.payment;
  const gatewaySummary = paymentDetails?.gateway_summary;
  const attempts = paymentDetails?.attempts || [];

  const recoveryStages = useMemo(
    () =>
      deriveRecoveryStages({
        recoveryCase,
        timeline,
        paymentDetails,
      }),
    [recoveryCase, timeline, paymentDetails]
  );

  const paymentAmount =
    payment?.amount != null
      ? payment.amount
      : recoveryCase?.amount_at_risk != null
        ? recoveryCase.amount_at_risk
        : result?.original_amount;

  const liveStateRows = useMemo(
    () =>
      deriveLiveRecoveryState({
        recoveryCase,
        timeline,
        paymentDetails,
        checkoutConfig,
      }),
    [recoveryCase, timeline, paymentDetails, checkoutConfig]
  );

  const activityEvents = useMemo(
    () => buildRecoveryActivityEvents(timeline, paymentDetails),
    [timeline, paymentDetails]
  );

  const customerJourney = useMemo(
    () =>
      deriveCustomerRecoveryJourney({
        recoveryCase,
        timeline,
        paymentDetails,
        checkoutConfig,
      }),
    [recoveryCase, timeline, paymentDetails, checkoutConfig]
  );

  const runOperatorAction = async (actionFn) => {
    setOperating(true);
    setOperationError(null);
    setOperationMessage(null);
    try {
      const data = await actionFn();
      if (data.blocked) {
        setOperationError(
          data.result_text || "Action blocked by Safety Engine."
        );
      } else {
        setOperationMessage(data.message || "Operation completed.");
      }
      await loadCaseData({ soft: true });
    } catch (err) {
      console.error(err);
      setOperationError(parseApiError(err));
    } finally {
      setOperating(false);
    }
  };

  const dismissSimulateBanner = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("from");
    setSearchParams(next, { replace: true });
  };

  const dismissLiveBanner = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("from");
    setSearchParams(next, { replace: true });
  };

  if (loading) return <LoadingState message="Loading case details..." />;
  if (error) return <ErrorState message={error} />;
  if (!recoveryCase) return <EmptyState message="Recovery case not found." />;

  const pollingActive = shouldPollRecoveryCase(recoveryCase);

  return (
    <div className="page-enter space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/cases"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-mute transition hover:text-ink"
        >
          <ArrowLeft size={14} />
          Back to cases
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/live-activity"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-pine hover:underline"
          >
            View live activity
          </Link>
          {lastUpdated && (
            <p className="text-xs text-ink-faint">
              Last updated: {formatDateTime(lastUpdated)}
              {pollingActive ? " · auto-refresh active" : ""}
            </p>
          )}
          <button
            type="button"
            onClick={() => loadCaseData({ soft: true })}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3.5 py-2 text-sm font-semibold text-ink transition hover:border-pine/30 hover:text-pine disabled:opacity-60"
          >
            <RefreshCw
              size={15}
              className={refreshing ? "animate-spin" : ""}
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {fromLive && (
        <div className="rounded-[18px] border border-pine/20 bg-pine-soft/40 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pine">
                Live recovery event
              </p>
              <p className="mt-1 text-sm text-ink-mute">
                Opened from the Live Activity feed for{" "}
                <span className="font-mono text-ink">
                  {recoveryCase.case_number}
                </span>
                .
              </p>
            </div>
            <button
              type="button"
              onClick={dismissLiveBanner}
              className="text-xs font-semibold text-ink-mute hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {fromSimulate && (
        <div className="space-y-4">
          <div className="rounded-[18px] border border-sand/25 bg-sand-soft/50 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-sand shadow-panel">
                  <Sparkles size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">
                    New recovery case created
                  </p>
                  <p className="mt-1 text-sm text-ink-mute">
                    Simulated payment failure ingested for{" "}
                    <span className="font-mono text-ink">
                      {recoveryCase.case_number}
                    </span>
                    . Execute the pending recovery action below, then complete
                    Razorpay TEST payment as the operator.
                  </p>
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-sand">
                    DEMO / SIMULATED EVENT — not live Razorpay production
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={dismissSimulateBanner}
                className="text-xs font-semibold text-ink-mute hover:text-ink"
              >
                Dismiss
              </button>
            </div>
          </div>
          <DemoFlowGuide title="Judge demo: complete recovery in TEST MODE" />
        </div>
      )}

      {/* Recovery outcome */}
      <section className="overflow-hidden rounded-[22px] border border-ink/10 bg-white shadow-panel">
        <div className="relative border-b border-ink/10 bg-ink px-6 py-8 text-white sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Recovery Case
              </p>
              <h2 className="mt-3 font-display text-3xl font-medium tracking-tight sm:text-4xl">
                {recoveryCase.case_number}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/55">
                {displayText(recoveryCase.failure_reason)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={recoveryCase.status} />
              <StatusBadge value={recoveryCase.risk_level} />
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                Amount at Risk
              </p>
              <p className="mt-2 font-mono text-xl font-medium">
                {displayMoney(recoveryCase.amount_at_risk)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                Failure Category
              </p>
              <p className="mt-2 text-lg font-medium">
                {displayLabel(recoveryCase.failure_category)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:col-span-2 lg:col-span-1">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                Case Status
              </p>
              <p className="mt-2 text-lg font-medium">
                {displayLabel(recoveryCase.status)}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Recovery outcome */}
      <section className="panel p-5 sm:p-6">
        <RecoveryOutcomeBanner
          recoveryCase={recoveryCase}
          result={result}
          payment={payment}
        />
      </section>

      <section className="panel p-5 sm:p-6">
        <AIRecoveryDecision
          decision={decision}
          loading={false}
          error={decisionError}
        />
      </section>

      <section className="panel p-5 sm:p-6">
        <RecommendedActionCard
          recoveryCase={recoveryCase}
          timeline={timeline}
          paymentDetails={paymentDetails}
          checkoutConfig={checkoutConfig}
          operating={operating}
          onExecute={() =>
            runOperatorAction(() => executePendingRecoveryAction(caseId))
          }
        />
      </section>

      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Customer Recovery Journey"
          subtitle="Compact path from failure to verified recovery — derived from backend state only"
        />
        <CustomerRecoveryJourney stages={customerJourney} />
      </section>

      {/* Recovery progress stages */}
      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Recovery Progress"
          subtitle="Pipeline stages derived from live case, timeline, and payment APIs — not simulated"
        />
        <CaseRecoveryProgress stages={recoveryStages} />
      </section>

      {/* Operations summary */}
      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Operations Summary"
          subtitle="Live recovery desk metrics for this case"
        />
        <OperationsSummary recoveryCase={recoveryCase} result={result} />
      </section>

      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Current State"
          subtitle="Live backend snapshot — refreshes with case polling"
        />
        <LiveRecoveryState rows={liveStateRows} />
      </section>

      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Recovery Operations"
          subtitle="Operator controls — merchant initiates; customer pays; webhook verifies"
        />
        <RecoveryOperationsPanel
          recoveryCase={recoveryCase}
          timeline={timeline}
          checkoutConfig={checkoutConfig}
          paymentDetails={paymentDetails}
          operating={operating}
          operationMessage={operationMessage}
          operationError={operationError}
          onExecutePending={() =>
            runOperatorAction(() => executePendingRecoveryAction(caseId))
          }
          onContinueRecovery={() =>
            runOperatorAction(() => continueRecovery(caseId))
          }
          onCheckoutComplete={(msg) => {
            setOperationMessage(msg);
            setPostCheckoutPolling(true);
          }}
          onRefresh={() => loadCaseData({ soft: true })}
        />
      </section>

      <section id="customer-recovery" className="panel scroll-mt-24 p-5 sm:p-6">
        <CustomerRecoveryPanel
          caseId={caseId}
          caseStatus={recoveryCase.status}
        />
      </section>

      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Recovery Activity"
          subtitle="Events built from timeline and payment APIs only"
        />
        <RecoveryActivityFeed events={activityEvents} />
      </section>

      {/* AI diagnosis detail */}
      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="AI Recovery Summary"
          subtitle="Diagnosis and strategy signals from the backend"
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DetailItem
            label="Root Cause"
            value={displayText(recoveryCase.root_cause)}
          />
          <DetailItem
            label="AI Confidence"
            value={
              recoveryCase.ai_confidence != null
                ? `${recoveryCase.ai_confidence}%`
                : NA
            }
            mono
          />
          <DetailItem
            label="Failure Category"
            value={displayLabel(recoveryCase.failure_category)}
          />
        </div>
      </section>

      {/* Payment & Gateway */}
      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Payment & Gateway"
          subtitle="Sanitized payment record and gateway attempt history"
        />

        {paymentDetailsError && !paymentDetails ? (
          <ErrorState
            message={paymentDetailsError}
            detail="The case loaded successfully, but payment-details could not be fetched."
          />
        ) : !paymentDetails ? (
          <EmptyState message="No payment details available." />
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  Payment
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailItem
                    label="Amount"
                    value={displayMoney(payment?.amount)}
                    mono
                  />
                  <DetailItem
                    label="Currency"
                    value={displayText(payment?.currency)}
                    mono
                  />
                  <DetailItem label="Payment Status">
                    {payment?.status ? (
                      <StatusBadge value={payment.status} />
                    ) : (
                      NA
                    )}
                  </DetailItem>
                  <DetailItem
                    label="Payment ID"
                    value={displayText(payment?.payment_id)}
                    mono
                  />
                  <DetailItem
                    label="Failure Reason"
                    value={displayText(payment?.failure_reason)}
                  />
                  <DetailItem
                    label="Failure Code"
                    value={displayText(payment?.failure_code)}
                    mono
                  />
                </div>
              </div>

              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  Gateway
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailItem
                    label="Gateway Mode"
                    value={displayText(gatewaySummary?.mode)}
                    mono
                  />
                  <DetailItem
                    label="Razorpay Order ID"
                    value={displayText(gatewaySummary?.order_id)}
                    mono
                  />
                  <DetailItem
                    label="Razorpay Payment ID"
                    value={displayText(gatewaySummary?.razorpay_payment_id)}
                    mono
                  />
                  <DetailItem
                    label="Gateway Status"
                    value={displayText(gatewaySummary?.status)}
                  />
                  <DetailItem
                    label="Attempt Number"
                    value={
                      gatewaySummary?.attempt_number != null
                        ? String(gatewaySummary.attempt_number)
                        : NA
                    }
                    mono
                  />
                  <DetailItem
                    label="Webhook State"
                    value={
                      gatewaySummary?.awaiting_webhook == null
                        ? NA
                        : gatewaySummary.awaiting_webhook
                          ? "Awaiting webhook"
                          : "Not awaiting webhook"
                    }
                  />
                </div>
              </div>
            </div>

            <div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                Attempt History
              </p>
              {attempts.length === 0 ? (
                <EmptyState message="No payment attempts recorded." />
              ) : (
                <div className="space-y-3">
                  {attempts.map((attempt) => (
                    <div
                      key={attempt.id}
                      className="rounded-2xl border border-ink/8 bg-mist-soft/70 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">
                          Attempt #{attempt.attempt_number}
                        </p>
                        <StatusBadge
                          value={attempt.status}
                          label={attemptLabel(attempt)}
                          tone={attemptTone(attempt)}
                        />
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-ink-mute sm:grid-cols-2 lg:grid-cols-3">
                        <p>
                          Status:{" "}
                          <span className="font-mono text-ink">
                            {displayText(attempt.status)}
                          </span>
                        </p>
                        <p>
                          Error code:{" "}
                          <span className="font-mono text-ink">
                            {displayText(attempt.error_code)}
                          </span>
                        </p>
                        <p>
                          Source:{" "}
                          <span className="font-mono text-ink">
                            {displayText(attempt.error_source)}
                          </span>
                        </p>
                        <p>
                          Mode:{" "}
                          <span className="font-mono text-ink">
                            {displayText(attempt.gateway?.mode)}
                          </span>
                        </p>
                        <p>
                          Order ID:{" "}
                          <span className="font-mono text-ink">
                            {displayText(attempt.gateway?.order_id)}
                          </span>
                        </p>
                        <p>
                          Razorpay payment:{" "}
                          <span className="font-mono text-ink">
                            {displayText(
                              attempt.gateway?.razorpay_payment_id ||
                                attempt.gateway?.payment_id
                            )}
                          </span>
                        </p>
                        <p className="sm:col-span-2 lg:col-span-3">
                          Created:{" "}
                          <span className="font-mono text-ink">
                            {displayWhen(attempt.created_at)}
                          </span>
                        </p>
                      </div>
                      <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                        {displayText(attempt.error_description)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Timeline */}
      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Recovery Timeline"
          subtitle="Chronological events from timeline API"
        />
        <RecoveryTimeline timeline={timeline} />
      </section>

      {/* Strategies + Actions */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-5 sm:p-6">
          <SectionHeading
            title="Strategies"
            subtitle="Selected strategy and ranked alternatives"
          />

          {strategies.length === 0 ? (
            <EmptyState message="No strategies recorded." />
          ) : (
            <div className="space-y-5">
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-pine">
                  Selected
                </p>
                {selectedStrategies.length === 0 ? (
                  <p className="text-sm text-ink-mute">
                    No strategy marked as selected.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {selectedStrategies.map((strategy) => (
                      <div
                        key={strategy.id}
                        className="rounded-2xl border border-pine/20 bg-pine-soft/40 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-ink">
                            {displayLabel(strategy.strategy_type)}
                          </p>
                          <StatusBadge value="EXECUTED" label="Selected" />
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-ink-mute">
                          {displayText(strategy.rationale)}
                        </p>
                        <p className="mt-2 font-mono text-[11px] text-ink-faint">
                          Expected probability:{" "}
                          {strategy.expected_probability != null
                            ? `${strategy.expected_probability}%`
                            : NA}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  Alternatives
                </p>
                {alternativeStrategies.length === 0 ? (
                  <p className="text-sm text-ink-mute">
                    No alternative strategies recorded.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {alternativeStrategies.map((strategy) => (
                      <div
                        key={strategy.id}
                        className="rounded-2xl border border-ink/8 bg-mist-soft/70 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-ink">
                            {displayLabel(strategy.strategy_type)}
                          </p>
                          <StatusBadge
                            value="PENDING"
                            label="Alternative"
                            tone="neutral"
                          />
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-ink-mute">
                          {displayText(strategy.rationale)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="panel p-5 sm:p-6">
          <SectionHeading
            title="Actions"
            subtitle="Recovery actions and execution outcomes"
          />
          {actions.length === 0 ? (
            <EmptyState message="No actions recorded." />
          ) : (
            <div className="space-y-3">
              {actions.map((action) => (
                <div
                  key={action.id}
                  className="rounded-2xl border border-ink/8 bg-mist-soft/70 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {displayLabel(action.action_type)}
                    </p>
                    <StatusBadge value={action.status} />
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-ink-mute sm:grid-cols-2">
                    <p>
                      Attempt:{" "}
                      <span className="font-mono text-ink">
                        {action.attempt_number ?? NA}
                      </span>
                    </p>
                    <p>
                      Scheduled:{" "}
                      <span className="font-mono text-ink">
                        {displayWhen(action.scheduled_at)}
                      </span>
                    </p>
                    <p>
                      Executed:{" "}
                      <span className="font-mono text-ink">
                        {displayWhen(action.executed_at)}
                      </span>
                    </p>
                    <p>
                      Created:{" "}
                      <span className="font-mono text-ink">
                        {displayWhen(action.created_at)}
                      </span>
                    </p>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                    Result: {displayText(action.result_text)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Communications */}
      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Communications"
          subtitle="Customer-facing messages recorded for this case"
        />
        {communications.length === 0 ? (
          <EmptyState message="No communications recorded." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {communications.map((comm) => (
              <div
                key={comm.id}
                className="rounded-2xl border border-ink/8 bg-mist-soft/70 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge value={comm.channel} tone="info" />
                    <StatusBadge
                      value={comm.direction}
                      label={toLabel(comm.direction)}
                      tone="neutral"
                    />
                  </div>
                  <StatusBadge value={comm.status} />
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {displayText(comm.content)}
                </p>
                <p className="mt-3 font-mono text-[11px] text-ink-faint">
                  Sent {displayWhen(comm.sent_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Payment summary footer */}
      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Payment / Recovery Summary"
          subtitle="Cross-reference values from case and result APIs"
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DetailItem
            label="Payment ID"
            value={displayText(payment?.payment_id || recoveryCase.payment_id)}
            mono
          />
          <DetailItem
            label="Amount"
            value={displayMoney(paymentAmount)}
            mono
          />
          <DetailItem label="Payment Status">
            {payment?.status ? (
              <StatusBadge value={payment.status} />
            ) : (
              NA
            )}
          </DetailItem>
          <DetailItem label="Recovery Result">
            {result?.status ? (
              <StatusBadge value={result.status} />
            ) : (
              NA
            )}
          </DetailItem>
        </div>
      </section>
    </div>
  );
}

export default CaseDetails;
