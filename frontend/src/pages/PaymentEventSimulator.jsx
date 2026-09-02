import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  AlertTriangle,
  Loader2,
  Zap,
} from "lucide-react";
import StatusBadge from "../components/StatusBadge";
import DemoFlowGuide from "../components/DemoFlowGuide";
import { ingestPaymentEvent, parseApiError } from "../services/api";
import { formatINR } from "../utils/format";
import { toLabel } from "../utils/labels";

const FAILURE_SCENARIOS = [
  {
    code: "GATEWAY_TIMEOUT",
    reason: "Gateway timeout",
  },
  {
    code: "INSUFFICIENT_FUNDS",
    reason: "Insufficient funds",
  },
  {
    code: "CARD_DECLINED",
    reason: "Card declined",
  },
  {
    code: "NETWORK_ERROR",
    reason: "Network error",
  },
  {
    code: "BANK_SERVER_ERROR",
    reason: "Bank server unavailable",
  },
];

const DEFAULT_FORM = {
  customerName: "Asha Verma",
  customerEmail: "asha@example.com",
  amountRupees: "2499",
  currency: "INR",
  failureCode: "GATEWAY_TIMEOUT",
  failureReason: "Gateway timeout",
};

function PaymentEventSimulator() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [submittedAmountPaise, setSubmittedAmountPaise] = useState(null);

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  const handleFailureCodeChange = (code) => {
    const scenario = FAILURE_SCENARIOS.find((item) => item.code === code);
    setForm((prev) => ({
      ...prev,
      failureCode: code,
      failureReason: scenario?.reason || prev.failureReason,
    }));
    setError(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    const amountRupees = Number(form.amountRupees);
    if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
      setError("Amount must be a positive number in rupees.");
      return;
    }

    const amountPaise = Math.round(amountRupees * 100);
    const idempotencyKey = `ui-sim-${crypto.randomUUID()}`;

    setSubmitting(true);

    try {
      const data = await ingestPaymentEvent({
        event: "payment.failed",
        amount: amountPaise,
        currency: form.currency,
        customer: {
          name: form.customerName.trim(),
          email: form.customerEmail.trim(),
        },
        failure: {
          code: form.failureCode.trim(),
          reason: form.failureReason.trim(),
        },
        idempotency_key: idempotencyKey,
      });

      setSubmittedAmountPaise(amountPaise);
      setResult(data);
    } catch (err) {
      console.error(err);
      setError(parseApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const displayFailure =
    result?.failure_reason ||
    form.failureReason ||
    toLabel(result?.failure_code || form.failureCode);

  return (
    <div className="page-enter space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Demo tools</p>
          <h2 className="page-title">Payment Event Simulator</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-mute">
            Send a test payment.failed event into RecoverAI.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/event-console"
            className="inline-flex items-center gap-2 rounded-xl border border-pine/25 bg-pine-soft/40 px-3.5 py-2.5 text-sm font-semibold text-ink transition hover:border-pine/40"
          >
            Create demo event
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink transition hover:border-pine/30 hover:text-pine"
          >
            <ArrowLeft size={15} />
            Back to dashboard
          </Link>
        </div>
      </div>

      <DemoFlowGuide title="Create a demo event" />

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="panel p-5 sm:p-6">
          <div className="mb-6 border-b border-ink/8 pb-5">
            <h3 className="font-display text-xl font-medium text-ink">
              Event payload
            </h3>
            <p className="mt-1 text-sm text-ink-mute">
              Fill in the customer and payment details, then send.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="customerName"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint"
                >
                  Customer name
                </label>
                <input
                  id="customerName"
                  type="text"
                  className="field"
                  value={form.customerName}
                  onChange={(e) => updateField("customerName", e.target.value)}
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="customerEmail"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint"
                >
                  Customer email
                </label>
                <input
                  id="customerEmail"
                  type="email"
                  className="field"
                  value={form.customerEmail}
                  onChange={(e) =>
                    updateField("customerEmail", e.target.value)
                  }
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="amountRupees"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint"
                >
                  Amount (₹)
                </label>
                <input
                  id="amountRupees"
                  type="number"
                  min="1"
                  step="1"
                  className="field font-mono"
                  value={form.amountRupees}
                  onChange={(e) => updateField("amountRupees", e.target.value)}
                  required
                />
                <p className="mt-1.5 text-xs text-ink-faint">
                  Converted to paise before sending (e.g. ₹2,499 → 249900).
                </p>
              </div>
              <div>
                <label
                  htmlFor="currency"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint"
                >
                  Currency
                </label>
                <select
                  id="currency"
                  className="field"
                  value={form.currency}
                  onChange={(e) => updateField("currency", e.target.value)}
                >
                  <option value="INR">INR</option>
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="failureCode"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint"
              >
                Failure scenario
              </label>
              <select
                id="failureCode"
                className="field"
                value={form.failureCode}
                onChange={(e) => handleFailureCodeChange(e.target.value)}
              >
                {FAILURE_SCENARIOS.map((scenario) => (
                  <option key={scenario.code} value={scenario.code}>
                    {toLabel(scenario.code)} — {scenario.reason}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="failureReason"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint"
              >
                Failure reason
              </label>
              <input
                id="failureReason"
                type="text"
                className="field"
                value={form.failureReason}
                onChange={(e) => updateField("failureReason", e.target.value)}
                required
              />
              <p className="mt-1.5 text-xs text-ink-faint">
                Updates when you pick a scenario; you can edit before sending.
              </p>
            </div>

            {error && (
              <div className="rounded-xl border border-clay/20 bg-clay-soft/50 px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle
                    size={16}
                    className="mt-0.5 shrink-0 text-clay"
                  />
                  <p className="text-sm font-medium text-clay">{error}</p>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Processing event…
                </>
              ) : (
                <>
                  <Zap size={16} />
                  Trigger Payment Failure
                </>
              )}
            </button>
          </form>
        </section>

        <section className="space-y-4">
          <div className="panel p-5 sm:p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              Simulation notice
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-mute">
              Events posted here are labeled{" "}
              <span className="font-mono text-xs text-ink-soft">simulated</span>{" "}
              by the backend. RecoverAI runs the real orchestrator — ML
              diagnosis, Safety Engine, and actions — but no payment is
              recovered unless the pipeline legitimately succeeds.
            </p>
          </div>

          {submitting && (
            <div className="panel flex min-h-[220px] flex-col items-center justify-center gap-3 p-6">
              <Loader2 className="h-6 w-6 animate-spin text-pine" />
              <p className="text-sm font-medium text-ink-mute">
                RecoverAI is ingesting the event and starting recovery…
              </p>
            </div>
          )}

          {!submitting && result && (
            <div className="panel overflow-hidden">
              <div className="border-b border-clay/15 bg-clay-soft/35 px-5 py-4 sm:px-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-clay">
                  Payment failure detected
                </p>
                <p className="mt-1 text-xs text-ink-mute">
                  {result.simulated
                    ? "Simulated provider event accepted"
                    : "Event accepted"}
                  {result.idempotent ? " · idempotent replay" : ""}
                </p>
              </div>

              <div className="space-y-4 p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                      Case
                    </p>
                    <p className="mt-1 font-display text-2xl font-medium text-ink">
                      {result.case_number || "—"}
                    </p>
                  </div>
                  {result.case_status && (
                    <StatusBadge value={result.case_status} />
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-ink/8 bg-mist-soft/60 px-4 py-3">
                    <p className="text-xs text-ink-faint">Amount at risk</p>
                    <p className="mt-1 font-mono text-lg font-medium text-ink">
                      {formatINR(submittedAmountPaise)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-ink/8 bg-mist-soft/60 px-4 py-3">
                    <p className="text-xs text-ink-faint">Failure</p>
                    <p className="mt-1 text-sm font-medium text-ink">
                      {displayFailure}
                    </p>
                    {result.failure_code && (
                      <p className="mt-1 font-mono text-xs text-ink-faint">
                        {result.failure_code}
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-ink/8 bg-white px-4 py-3">
                  <p className="text-xs text-ink-faint">Status</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {result.case_status && (
                      <StatusBadge
                        value={result.case_status}
                        label={toLabel(result.case_status)}
                      />
                    )}
                    {result.payment_status && (
                      <span className="text-xs text-ink-mute">
                        Payment:{" "}
                        <span className="font-mono">
                          {result.payment_status}
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-dashed border-ink/12 bg-mist-soft/40 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                    Record IDs
                  </p>
                  <dl className="mt-2 space-y-1.5 font-mono text-xs text-ink-soft">
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-faint">case_id</dt>
                      <dd className="truncate">{result.case_id || "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-faint">payment_id</dt>
                      <dd className="truncate">{result.payment_id || "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-faint">order_id</dt>
                      <dd className="truncate">{result.order_id || "—"}</dd>
                    </div>
                  </dl>
                </div>

                {result.case_id && (
                  <Link
                    to={`/cases/${result.case_id}?from=simulate`}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-pine px-4 py-3 text-sm font-semibold text-white transition hover:bg-pine-mid sm:w-auto"
                  >
                    View recovery case
                    <ArrowUpRight size={16} />
                  </Link>
                )}

                <p className="text-xs leading-relaxed text-ink-faint">
                  {result.message}
                </p>
              </div>
            </div>
          )}

          {!submitting && !result && (
            <div className="panel flex min-h-[220px] flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-sm font-medium text-ink-soft">
                No event submitted yet
              </p>
              <p className="max-w-xs text-xs text-ink-faint">
                Fill the form and trigger a failure to see the live ingestion
                result and open the new recovery case.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default PaymentEventSimulator;
