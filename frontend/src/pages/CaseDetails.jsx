import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Sparkles, FileDown, FileSpreadsheet } from "lucide-react";
import StatusBadge from "../components/StatusBadge";
import RecoveryTimeline from "../components/RecoveryTimeline";
import CaseRecoveryProgress from "../components/CaseRecoveryProgress";
import RecoveryOutcomeBanner from "../components/RecoveryOutcomeBanner";
import RecoveryOperationsPanel from "../components/RecoveryOperationsPanel";
import CustomerRecoveryPanel from "../components/CustomerRecoveryPanel";
import RecommendedActionCard from "../components/RecommendedActionCard";
import AIRecoveryDecision from "../components/AIRecoveryDecision";
import CustomerRecoveryJourney from "../components/CustomerRecoveryJourney";
import { VerticalStepItem, VerticalStepList } from "../components/VerticalStepList";
import OriginBadges from "../components/OriginBadges";
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
  createCustomerRecoveryLink,
  parseApiError,
} from "../services/api";
import { formatINR, formatDateTime, extractPaymentLink } from "../utils/format";
import { toLabel } from "../utils/labels";
import { shouldPollRecoveryCase, deriveRecoveryStages } from "../utils/recoveryStages";
import { deriveCustomerRecoveryJourney } from "../utils/customerJourney";
import {
  downloadAuditExcel,
  downloadAuditPdf,
} from "../utils/auditExport";

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

function isRazorpayHostedLink(url) {
  const value = String(url || "").toLowerCase();
  return value.includes("rzp.io") || value.includes("razorpay.com");
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
  const [openingPayLink, setOpeningPayLink] = useState(false);

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
        "Verified webhook applied — payment recovered."
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

  const actions = timeline?.actions || [];
  const communications = timeline?.communications || [];
  const result = timeline?.result;

  const payment = paymentDetails?.payment;
  const gatewaySummary = paymentDetails?.gateway_summary;

  const paymentAmount =
    payment?.amount != null
      ? payment.amount
      : recoveryCase?.amount_at_risk != null
        ? recoveryCase.amount_at_risk
        : result?.original_amount;

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

  const recoveryStages = useMemo(
    () =>
      deriveRecoveryStages({
        recoveryCase,
        timeline,
        paymentDetails,
      }),
    [recoveryCase, timeline, paymentDetails]
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

  const openLiveCustomerPay = async (fallbackUrl) => {
    if (!caseId) return;
    setOpeningPayLink(true);
    try {
      const data = await createCustomerRecoveryLink(caseId);
      const path = data?.recovery_path;
      if (path) {
        window.open(`${window.location.origin}${path}`, "_blank", "noopener,noreferrer");
        return;
      }
      if (fallbackUrl && !isRazorpayHostedLink(fallbackUrl)) {
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.error(err);
      if (fallbackUrl && !isRazorpayHostedLink(fallbackUrl)) {
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
      } else {
        setOperationError(
          parseApiError(err) ||
            "Could not open a live payment link. Generate Pay as customer on this case."
        );
      }
    } finally {
      setOpeningPayLink(false);
    }
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
            onClick={() =>
              downloadAuditExcel({ recoveryCase, timeline })
            }
            className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3.5 py-2 text-sm font-semibold text-ink transition hover:border-pine/30 hover:text-pine"
          >
            <FileSpreadsheet size={15} />
            Excel
          </button>
          <button
            type="button"
            onClick={() => downloadAuditPdf({ recoveryCase, timeline })}
            className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3.5 py-2 text-sm font-semibold text-ink transition hover:border-pine/30 hover:text-pine"
          >
            <FileDown size={15} />
            PDF
          </button>
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
          <div className="rounded-[18px] border border-ink/10 bg-white px-5 py-4 sm:px-6">
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
                    . Execute the recommended action, then complete payment as
                    the customer.
                  </p>
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                    Demo event
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
          <DemoFlowGuide title="Complete this recovery" />
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
                See why this payment failed and how RecoverAI is recovering it.
              </p>
              <p className="mt-2 max-w-2xl text-sm text-white/70">
                {displayText(recoveryCase.failure_reason)}
              </p>
              <div className="mt-3">
                <OriginBadges
                  eventSource={recoveryCase.event_source}
                  eventSourceLabel={recoveryCase.event_source_label}
                  outcomeKind={recoveryCase.outcome_kind}
                  webhookAuthorityLabel={
                    recoveryCase.webhook_authority_label
                  }
                  recovered={
                    String(recoveryCase.status || "").toUpperCase() ===
                    "RECOVERED"
                  }
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={recoveryCase.status} />
              <StatusBadge value={recoveryCase.risk_level} />
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                Amount at risk
              </p>
              <p className="mt-2 font-mono text-xl font-medium">
                {displayMoney(recoveryCase.amount_at_risk)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                Why it failed
              </p>
              <p className="mt-2 text-lg font-medium">
                {displayLabel(recoveryCase.failure_category)}
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
        {recoveryCase.next_step_label &&
          String(recoveryCase.status || "").toUpperCase() !== "RECOVERED" &&
          String(recoveryCase.status || "").toUpperCase() !== "CLOSED" && (
            <p className="mt-4 text-sm text-ink">
              <span className="font-semibold">Next: </span>
              {recoveryCase.next_step_label}
            </p>
          )}
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
        <SectionHeading title="Customer recovery journey" />
        <CustomerRecoveryJourney stages={customerJourney} />
      </section>

      <section className="panel p-5 sm:p-6">
        <SectionHeading title="Recovery progress" />
        <CaseRecoveryProgress stages={recoveryStages} />
      </section>

      <section className="panel p-5 sm:p-6">
        <SectionHeading title="Recovery timeline" />
        <RecoveryTimeline timeline={timeline} />
      </section>

      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Recovery Operations"
          subtitle="Run the recommended action or send the customer to pay."
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
          title="Payment"
          subtitle="Amount, status, and why it failed."
        />

        {paymentDetailsError && !paymentDetails ? (
          <ErrorState
            message={paymentDetailsError}
            detail="The case loaded successfully, but payment-details could not be fetched."
          />
        ) : !paymentDetails ? (
          <EmptyState message="No payment details available." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DetailItem
              label="Amount"
              value={displayMoney(payment?.amount ?? paymentAmount)}
              mono
            />
            <DetailItem label="Payment status">
              {payment?.status ? (
                <StatusBadge value={payment.status} />
              ) : (
                NA
              )}
            </DetailItem>
            <DetailItem
              label="Failure"
              value={displayText(
                payment?.failure_reason || recoveryCase.failure_reason
              )}
            />
            <DetailItem
              label="Waiting for payment"
              value={
                gatewaySummary?.awaiting_webhook
                  ? "Yes — customer still paying"
                  : "No"
              }
            />
          </div>
        )}
      </section>

      <section className="panel p-5 sm:p-6">
        <SectionHeading title="Actions" />
        {actions.length === 0 ? (
          <EmptyState message="No actions recorded." />
        ) : (
          <VerticalStepList>
            {actions.map((action, index) => {
              const status = String(action.status || "").toUpperCase();
              const succeeded = status === "EXECUTED";
              const failed = status === "FAILED" || status === "BLOCKED";
              const badge = succeeded
                ? "Succeeded"
                : failed
                  ? "Failed"
                  : status === "PENDING"
                    ? "Waiting"
                    : displayLabel(action.status);
              const tone = succeeded
                ? "success"
                : failed
                  ? "danger"
                  : "warning";
              const resultLine = action.result_text
                ? String(action.result_text).replace(/\s+/g, " ").trim()
                : null;
              const runner = resultLine?.startsWith("[Automatic agent]")
                ? "Agent"
                : resultLine?.startsWith("[Merchant]")
                  ? "Manual"
                  : null;
              const shownResult = resultLine
                ?.replace(/^\[Automatic agent\]\s*/i, "")
                .replace(/^\[Merchant\]\s*/i, "")
                .trim();
              return (
                <VerticalStepItem
                  key={action.id}
                  index={index + 1}
                  isLast={index === actions.length - 1}
                  status={
                    succeeded ? "SUCCESS" : failed ? "FAILED" : "PENDING"
                  }
                  title={displayLabel(action.action_type)}
                  detail={
                    shownResult && shownResult.length > 72
                      ? `${shownResult.slice(0, 72).trim()}…`
                      : shownResult
                  }
                  badge={runner ? `${badge} · ${runner}` : badge}
                  badgeTone={tone}
                  right={
                    <span className="font-mono text-[11px] text-ink-faint">
                      {displayWhen(action.executed_at || action.created_at)}
                    </span>
                  }
                />
              );
            })}
          </VerticalStepList>
        )}
      </section>

      {/* Communications */}
      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Communications"
          subtitle="Messages sent for this case, including any payment link."
        />
        {communications.length === 0 ? (
          <EmptyState message="No communications recorded." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {communications.map((comm) => {
              const commLink = extractPaymentLink(comm.content);
              return (
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
                  {displayText(
                    commLink
                      ? String(comm.content || "")
                          .replace(commLink, "")
                          .replace(/Click here to complete payment:\s*/gi, "")
                          .replace(/Payment link:\s*/gi, "")
                          .trim() || "Payment reminder sent."
                      : comm.content
                  )}
                </p>
                {commLink ? (
                  <p className="mt-2 text-sm text-ink">
                    <button
                      type="button"
                      disabled={openingPayLink}
                      onClick={() => openLiveCustomerPay(commLink)}
                      className="font-semibold text-pine underline disabled:opacity-60"
                    >
                      {openingPayLink ? "Opening…" : "Click here"}
                    </button>
                    {" "}to complete payment.
                  </p>
                ) : null}
                <p className="mt-3 font-mono text-[11px] text-ink-faint">
                  Sent {displayWhen(comm.sent_at)}
                </p>
              </div>
            );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default CaseDetails;
