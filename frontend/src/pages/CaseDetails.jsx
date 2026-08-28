import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import StatusBadge from "../components/StatusBadge";
import RecoveryTimeline from "../components/RecoveryTimeline";
import LoadingState, {
  ErrorState,
  EmptyState,
} from "../components/LoadingState";
import { getRecoveryCase, getCaseTimeline, getCasePaymentDetails } from "../services/api";
import { formatINR, formatDateTime } from "../utils/format";
import { toLabel } from "../utils/labels";

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

function displayPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return NA;
  return `${value}%`;
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

function RecoveryResultBanner({ result, amountAtRisk }) {
  if (!result) {
    return <EmptyState message="No recovery result recorded yet." />;
  }

  const status = String(result.status || "").toUpperCase();
  const original =
    result.original_amount != null
      ? Number(result.original_amount)
      : amountAtRisk != null
        ? Number(amountAtRisk)
        : null;
  const recovered = Number(result.recovered_amount || 0);
  const remaining =
    original != null ? Math.max(original - recovered, 0) : null;

  let tone = "bg-mist-soft border-ink/10";
  let headline = "Recovery status";
  let body = displayLabel(result.status);

  if (status === "FULLY_RECOVERED") {
    tone = "border-pine/20 bg-gradient-to-br from-pine-soft to-white";
    headline = "Payment Recovered";
    body = `Recovered ${displayMoney(recovered)}`;
  } else if (status === "PARTIALLY_RECOVERED") {
    tone = "border-sand/25 bg-gradient-to-br from-sand-soft to-white";
    headline = "Partial Recovery";
    body = `Recovered ${displayMoney(recovered)}${
      remaining != null ? ` · Remaining ${displayMoney(remaining)}` : ""
    }`;
  } else if (status === "NOT_RECOVERED") {
    tone = "border-clay/20 bg-gradient-to-br from-clay-soft/80 to-white";
    headline = "Recovery Unsuccessful";
    body = "No amount was recovered for this case.";
  } else if (status === "PENDING") {
    tone = "border-skyline/20 bg-gradient-to-br from-skyline-soft to-white";
    headline = "Recovery In Progress";
    body = "Recovery is still running for this case.";
  }

  return (
    <div className={`rounded-[18px] border p-5 sm:p-6 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            Recovery Result
          </p>
          <h4 className="mt-2 font-display text-2xl font-medium text-ink">
            {headline}
          </h4>
          <p className="mt-2 text-sm text-ink-mute">{body}</p>
        </div>
        <StatusBadge value={result.status} />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DetailItem
          label="Original Amount"
          value={displayMoney(result.original_amount)}
          mono
        />
        <DetailItem
          label="Recovered Amount"
          value={displayMoney(result.recovered_amount)}
          mono
        />
        <DetailItem
          label="Recovery Method"
          value={displayLabel(result.recovery_method)}
        />
        <DetailItem
          label="Recovered At"
          value={displayWhen(result.recovered_at)}
          mono
        />
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
  const [recoveryCase, setRecoveryCase] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [paymentDetails, setPaymentDetails] = useState(null);
  const [paymentDetailsError, setPaymentDetailsError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadCase = async () => {
      setLoading(true);
      setError(null);
      setPaymentDetailsError(null);

      try {
        const [caseData, timelineData] = await Promise.all([
          getRecoveryCase(caseId),
          getCaseTimeline(caseId),
        ]);
        setRecoveryCase(caseData);
        setTimeline(timelineData);

        try {
          const paymentData = await getCasePaymentDetails(caseId);
          setPaymentDetails(paymentData);
        } catch (paymentErr) {
          console.error(paymentErr);
          setPaymentDetails(null);
          setPaymentDetailsError(
            "Payment and gateway details are not available for this case."
          );
        }
      } catch (err) {
        console.error(err);
        setError("Unable to connect to RecoverAI API.");
      } finally {
        setLoading(false);
      }
    };

    loadCase();
  }, [caseId]);

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

  const paymentAmount =
    payment?.amount != null
      ? payment.amount
      : recoveryCase?.amount_at_risk != null
        ? recoveryCase.amount_at_risk
        : result?.original_amount;

  if (loading) return <LoadingState message="Loading case details..." />;
  if (error) return <ErrorState message={error} />;
  if (!recoveryCase) return <EmptyState message="Recovery case not found." />;

  return (
    <div className="page-enter space-y-6">
      <Link
        to="/cases"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-mute transition hover:text-ink"
      >
        <ArrowLeft size={14} />
        Back to cases
      </Link>

      {/* 1. CASE HEADER */}
      <section className="overflow-hidden rounded-[22px] border border-ink/10 bg-white shadow-panel">
        <div className="relative border-b border-ink/10 bg-gradient-to-br from-ink via-ink to-[#1c2430] px-6 py-8 text-white sm:px-8">
          <div className="absolute -right-10 top-0 h-40 w-40 rounded-full bg-pine/25 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
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

          <div className="relative mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                Amount at Risk
              </p>
              <p className="mt-2 font-mono text-xl font-medium">
                {displayMoney(recoveryCase.amount_at_risk)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                Failure Category
              </p>
              <p className="mt-2 text-lg font-medium">
                {displayLabel(recoveryCase.failure_category)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur sm:col-span-2 lg:col-span-1">
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

      {/* 8. RECOVERY RESULT — prominent */}
      <section className="panel p-5 sm:p-6">
        <RecoveryResultBanner
          result={result}
          amountAtRisk={recoveryCase.amount_at_risk}
        />
      </section>

      {/* 2 + 3: AI summary + Payment/Recovery summary */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-5 sm:p-6">
          <SectionHeading
            title="AI Recovery Summary"
            subtitle="Model-assisted diagnosis and strategy selection"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailItem
              label="Recovery Probability"
              value={displayPercent(recoveryCase.recovery_probability)}
              mono
            />
            <DetailItem
              label="AI Confidence"
              value={displayPercent(recoveryCase.ai_confidence)}
              mono
            />
            <DetailItem
              label="Root Cause"
              value={displayText(recoveryCase.root_cause)}
            />
            <DetailItem
              label="Selected Strategy"
              value={displayLabel(recoveryCase.selected_strategy)}
            />
            <DetailItem
              label="Current Step"
              value={displayLabel(recoveryCase.current_step)}
            />
            <DetailItem
              label="Retry / Contact Counts"
              value={`${recoveryCase.retry_count ?? NA} retries · ${
                recoveryCase.contact_count ?? NA
              } contacts`}
            />
          </div>
        </section>

        <section className="panel p-5 sm:p-6">
          <SectionHeading
            title="Payment / Recovery Summary"
            subtitle="Values from case and recovery result APIs only"
          />
          <div className="grid gap-3 sm:grid-cols-2">
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
            <DetailItem label="Recovery Status">
              {result?.status ? (
                <StatusBadge value={result.status} />
              ) : (
                NA
              )}
            </DetailItem>
            <DetailItem
              label="Recovered Amount"
              value={
                result ? displayMoney(result.recovered_amount) : NA
              }
              mono
            />
            <DetailItem
              label="Recovery Method"
              value={
                result ? displayLabel(result.recovery_method) : NA
              }
            />
            <DetailItem
              label="Recovered Timestamp"
              value={result ? displayWhen(result.recovered_at) : NA}
              mono
            />
            <DetailItem
              label="Customer ID"
              value={displayText(recoveryCase.customer_id)}
              mono
            />
          </div>
        </section>
      </div>

      {/* Payment & Gateway */}
      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Payment & Gateway"
          subtitle="Read-only payment record and sanitized gateway attempt history"
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
                    label="Awaiting Webhook"
                    value={
                      gatewaySummary?.awaiting_webhook == null
                        ? NA
                        : gatewaySummary.awaiting_webhook
                          ? "Yes"
                          : "No"
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

      {/* 4. RECOVERY TIMELINE */}
      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Recovery Timeline"
          subtitle="Payment Failed → Diagnosis → Strategy → Safety → Action → Communication → Payment Recovery → Final Result"
        />
        <RecoveryTimeline timeline={timeline} />
      </section>

      {/* 5 + 6: Strategies + Actions */}
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
                          {displayPercent(strategy.expected_probability)}
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
                        <p className="mt-2 font-mono text-[11px] text-ink-faint">
                          Expected probability:{" "}
                          {displayPercent(strategy.expected_probability)}
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
            subtitle="Approved recovery actions and execution outcomes"
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

      {/* 7. COMMUNICATIONS */}
      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Communications"
          subtitle="Customer-facing messages generated for this case"
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
    </div>
  );
}

export default CaseDetails;
