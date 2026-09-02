import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  Copy,
  Layers,
  Loader2,
  Radio,
  RefreshCw,
  Repeat,
  Terminal,
  Zap,
} from "lucide-react";
import StatusBadge from "../components/StatusBadge";
import LoadingState, { EmptyState } from "../components/LoadingState";
import {
  acknowledgeProviderEvent,
  getProviderEventCapabilities,
  getRecentProviderEvents,
  ingestPaymentEvent,
  parseApiError,
  simulateNotification,
} from "../services/api";
import { formatINR, formatDateTime } from "../utils/format";
import { toLabel } from "../utils/labels";
import { FAILURE_SCENARIOS } from "../utils/demoScenarios";

const EVENT_TYPES = [
  "payment.failed",
  "payment.captured",
  "payment.authorized",
  "payment.expired",
  "payment.refunded",
];

const DEFAULT_FORM = {
  eventType: "payment.failed",
  customerName: "Asha Verma",
  customerEmail: "asha@example.com",
  amountRupees: "2499",
  currency: "INR",
  failureCode: "GATEWAY_TIMEOUT",
  failureReason: "Gateway timeout",
};

const SESSION_HISTORY_KEY = "recoverai.eventConsole.session";

function loadSessionHistory() {
  try {
    const raw = sessionStorage.getItem(SESSION_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSessionHistory(rows) {
  try {
    sessionStorage.setItem(
      SESSION_HISTORY_KEY,
      JSON.stringify(rows.slice(0, 25))
    );
  } catch {
    /* ignore quota */
  }
}

function EventConsole() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [error, setError] = useState(null);
  const [latest, setLatest] = useState(null);
  const [lastPayload, setLastPayload] = useState(null);
  const [sessionRows, setSessionRows] = useState(loadSessionHistory);
  const [selectedId, setSelectedId] = useState(null);

  const [notifyBusy, setNotifyBusy] = useState(null);
  const [notifyMessage, setNotifyMessage] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [recent, setRecent] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);

  const capabilityByEvent = useMemo(() => {
    const map = {};
    for (const item of capabilities?.capabilities || []) {
      map[item.event] = item;
    }
    return map;
  }, [capabilities]);

  const selectedCapability = capabilityByEvent[form.eventType];
  const isFailedEvent = form.eventType === "payment.failed";

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const [caps, events] = await Promise.all([
        getProviderEventCapabilities(),
        getRecentProviderEvents(40),
      ]);
      setCapabilities(caps);
      setRecent(events);
    } catch (err) {
      console.error(err);
      setHistoryError(parseApiError(err));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

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

  const pushSessionRow = (row) => {
    setSessionRows((prev) => {
      const next = [row, ...prev].slice(0, 25);
      saveSessionHistory(next);
      return next;
    });
    setSelectedId(row.id);
  };

  const sendFailedEvent = async ({ replay = false } = {}) => {
    setError(null);

    let payload = lastPayload;
    if (!replay) {
      const amountRupees = Number(form.amountRupees);
      if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
        setError("Amount must be a positive number in rupees.");
        return;
      }
      payload = {
        event: "payment.failed",
        amount: Math.round(amountRupees * 100),
        currency: form.currency,
        customer: {
          name: form.customerName.trim(),
          email: form.customerEmail.trim(),
        },
        failure: {
          code: form.failureCode.trim(),
          reason: form.failureReason.trim(),
        },
        idempotency_key: `evt-console-${crypto.randomUUID()}`,
      };
    }

    if (!payload) {
      setError("Nothing to replay yet — send an event first.");
      return;
    }

    if (replay) setReplaying(true);
    else setSubmitting(true);

    try {
      const data = await ingestPaymentEvent(payload);
      setLastPayload(payload);
      const row = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        source: "session",
        at: new Date().toISOString(),
        amount: payload.amount,
        currency: payload.currency,
        event: data.event || "payment.failed",
        customer_ref: payload.customer?.email
          ? `${payload.customer.email.slice(0, 1)}***@${payload.customer.email.split("@")[1] || "…"}`
          : "—",
        payment_id: data.payment_id,
        case_id: data.case_id,
        case_number: data.case_number,
        case_status: data.case_status,
        payment_status: data.payment_status,
        failure_code: data.failure_code || payload.failure?.code,
        failure_reason: data.failure_reason || payload.failure?.reason,
        idempotent: Boolean(data.idempotent),
        message: data.message,
        raw: data,
      };
      setLatest(row);
      pushSessionRow(row);
      await refreshHistory();
    } catch (err) {
      console.error(err);
      setError(parseApiError(err));
    } finally {
      setSubmitting(false);
      setReplaying(false);
    }
  };

  const sendUnsupportedEvent = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const amountRupees = Number(form.amountRupees);
      const amountPaise =
        Number.isFinite(amountRupees) && amountRupees > 0
          ? Math.round(amountRupees * 100)
          : undefined;

      const data = await acknowledgeProviderEvent({
        event: form.eventType,
        amount: amountPaise,
        currency: form.currency,
      });

      const row = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        source: "session",
        at: new Date().toISOString(),
        amount: amountPaise,
        currency: form.currency,
        event: data.event,
        customer_ref: "—",
        payment_id: null,
        case_id: null,
        case_number: null,
        case_status: null,
        payment_status: null,
        failure_code: null,
        failure_reason: null,
        idempotent: null,
        simulation_only: true,
        message: data.message,
        required: data.required,
        raw: data,
      };
      setLatest(row);
      pushSessionRow(row);
    } catch (err) {
      console.error(err);
      setError(parseApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isFailedEvent) {
      await sendFailedEvent({ replay: false });
    } else {
      await sendUnsupportedEvent();
    }
  };

  const sendSimulatedNotification = async (channel) => {
    const caseId = latest?.case_id;
    if (!caseId) {
      setNotifyMessage("Create a demo event first so there is a case to notify.");
      return;
    }
    setNotifyBusy(channel);
    setNotifyMessage(null);
    setError(null);
    try {
      const result = await simulateNotification(caseId, channel);
      setNotifyMessage(
        `${result.channel} recorded as sent. Open the case Communications tab to see it.`
      );
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setNotifyBusy(null);
    }
  };

  const selected =
    sessionRows.find((row) => row.id === selectedId) ||
    (selectedId &&
      (recent?.events || []).find(
        (row) => `backend-${row.payment_id}` === selectedId
      )) ||
    latest;

  const historyRows = useMemo(() => {
    const backend = (recent?.events || []).map((row) => ({
      id: `backend-${row.payment_id}`,
      source: "backend",
      at: row.timestamp,
      amount: row.amount,
      currency: row.currency,
      event: row.event,
      customer_ref: row.customer_ref,
      payment_id: row.payment_id,
      case_id: row.case_id,
      case_number: row.case_number,
      case_status: row.case_status,
      payment_status: row.payment_status,
      failure_code: row.failure_code,
      failure_reason: row.failure_reason,
      event_source: row.event_source,
      event_source_label: row.event_source_label,
      idempotent: null,
      idempotency_state: row.idempotency_state,
      message: null,
    }));
    return backend;
  }, [recent]);

  return (
    <div className="page-enter space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Demo tools</p>
          <h2 className="page-title">Create demo event</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-mute">
            Create a demo failed payment here to start recovery.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/batch-demo"
            className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink transition hover:border-pine/30 hover:text-pine"
          >
            <Layers size={15} />
            Batch demo
          </Link>
          <Link
            to="/live-activity"
            className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink transition hover:border-pine/30 hover:text-pine"
          >
            <Radio size={15} />
            Live Activity
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-ink/8 bg-white px-4 py-3 text-sm text-ink-mute">
        Same event replayed with the same key will not create a duplicate case.
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="panel p-5 sm:p-6">
          <div className="mb-5 border-b border-ink/8 pb-4">
            <div className="flex items-center gap-2">
              <Terminal size={16} className="text-ink-mute" />
              <h3 className="font-display text-xl font-medium text-ink">
                Create a demo event
              </h3>
            </div>
            <p className="mt-1 text-sm text-ink-mute">
              Choose payment.failed to create a demo recovery case.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="eventType"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint"
              >
                Event type
              </label>
              <select
                id="eventType"
                className="field font-mono text-sm"
                value={form.eventType}
                onChange={(e) => updateField("eventType", e.target.value)}
              >
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                    {capabilityByEvent[type]?.supported === false
                      ? " — not state-mutating"
                      : ""}
                  </option>
                ))}
              </select>
              {selectedCapability && (
                <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                  {selectedCapability.supported
                    ? selectedCapability.note
                    : (
                      <>
                        <span className="font-semibold text-ink">
                          Simulation only — does not change recovery.
                        </span>{" "}
                        {selectedCapability.note}
                      </>
                    )}
                </p>
              )}
            </div>

            {isFailedEvent && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="customerName"
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint"
                    >
                      Customer
                    </label>
                    <input
                      id="customerName"
                      type="text"
                      className="field"
                      value={form.customerName}
                      onChange={(e) =>
                        updateField("customerName", e.target.value)
                      }
                      required
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="customerEmail"
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint"
                    >
                      Email
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
                      onChange={(e) =>
                        updateField("amountRupees", e.target.value)
                      }
                      required
                    />
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
                      <option value="USD">USD (rejected)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="failureCode"
                    className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint"
                  >
                    Failure
                  </label>
                  <select
                    id="failureCode"
                    className="field"
                    value={form.failureCode}
                    onChange={(e) => handleFailureCodeChange(e.target.value)}
                  >
                    {FAILURE_SCENARIOS.map((scenario) => (
                      <option key={scenario.code} value={scenario.code}>
                        {scenario.code} — {scenario.reason}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="field mt-2"
                    value={form.failureReason}
                    onChange={(e) =>
                      updateField("failureReason", e.target.value)
                    }
                    aria-label="Failure reason"
                    required
                  />
                </div>
              </>
            )}

            {!isFailedEvent && (
              <div className="rounded-xl border border-dashed border-ink/15 bg-mist-soft/50 px-4 py-3 text-sm text-ink-mute">
                Sending this event only acknowledges the limitation. It will{" "}
                <span className="font-semibold text-ink">not</span> create a
                case, change payment status, or mark revenue recovered.
              </div>
            )}

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

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={submitting || replaying}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Zap size={16} />
                    {isFailedEvent
                      ? "Create demo event"
                      : "Acknowledge (no mutation)"}
                  </>
                )}
              </button>

              {isFailedEvent && lastPayload && (
                <button
                  type="button"
                  disabled={submitting || replaying}
                  onClick={() => sendFailedEvent({ replay: true })}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:border-pine/30 hover:text-pine disabled:opacity-60"
                >
                  {replaying ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Replaying…
                    </>
                  ) : (
                    <>
                      <Repeat size={16} />
                      Replay event
                    </>
                  )}
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="space-y-4">
          <div className="panel p-5 sm:p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              Latest Event
            </p>
            {!latest ? (
              <EmptyState message="Create a demo event to see the response." />
            ) : (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-ink">
                      {latest.event}
                    </p>
                    <p className="mt-1 text-xs text-ink-mute">
                      {formatDateTime(latest.at)}
                      {latest.idempotent === true && " · idempotent = true"}
                      {latest.idempotent === false && " · idempotent = false"}
                      {latest.simulation_only && " · simulation only"}
                    </p>
                  </div>
                  {latest.case_status && (
                    <StatusBadge value={latest.case_status} />
                  )}
                </div>

                {latest.amount != null && (
                  <p className="font-mono text-2xl font-medium text-ink">
                    {formatINR(latest.amount)}
                  </p>
                )}

                {latest.failure_code && (
                  <p className="text-sm text-ink-soft">
                    {latest.failure_code}
                    {latest.failure_reason ? ` — ${latest.failure_reason}` : ""}
                  </p>
                )}

                {latest.case_number && (
                  <p className="text-sm text-ink-mute">
                    Case:{" "}
                    <span className="font-semibold text-ink">
                      {latest.case_number}
                    </span>
                  </p>
                )}

                <p className="text-xs leading-relaxed text-ink-faint">
                  {latest.message}
                </p>

                <div className="flex flex-wrap gap-2">
                  {latest.case_id && (
                    <Link
                      to={`/cases/${latest.case_id}?from=event-console`}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-pine px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-pine-mid"
                    >
                      View recovery case
                      <ArrowUpRight size={14} />
                    </Link>
                  )}
                  {latest.case_id && (
                    <Link
                      to="/operations"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink hover:border-pine/30"
                    >
                      Open operations
                    </Link>
                  )}
                  {latest.case_id && (
                    <Link
                      to={`/cases/${latest.case_id}?from=event-console#customer-recovery`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink hover:border-pine/30"
                    >
                      Open customer recovery
                    </Link>
                  )}
                </div>

                {latest.case_id && (
                  <div className="rounded-xl border border-ink/8 bg-mist-soft/60 px-3 py-3">
                    <p className="text-xs font-semibold text-ink">
                      Simulate customer notification
                    </p>
                    <p className="mt-1 text-xs text-ink-mute">
                      Records a demo email, SMS, or WhatsApp. Nothing is sent
                      for real. Recovery status does not change.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["EMAIL", "SMS", "WHATSAPP"].map((channel) => (
                        <button
                          key={channel}
                          type="button"
                          disabled={Boolean(notifyBusy)}
                          onClick={() => sendSimulatedNotification(channel)}
                          className="rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-60"
                        >
                          {notifyBusy === channel
                            ? "Sending…"
                            : `Simulate ${channel.toLowerCase()}`}
                        </button>
                      ))}
                    </div>
                    {notifyMessage && (
                      <p className="mt-2 text-xs text-pine">{notifyMessage}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-pine/15 bg-pine-soft/25 px-4 py-3 text-sm text-ink-soft">
            <p className="font-semibold text-ink">Recovery journey</p>
            <p className="mt-1 text-xs leading-relaxed">
              Create demo event → open case → run recommended action → customer pays
              → verified webhook → recovered.
            </p>
          </div>
        </section>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/8 px-5 py-4 sm:px-6">
          <div>
            <h3 className="font-display text-xl font-medium text-ink">
              Recent demo events
            </h3>
            <p className="mt-1 text-xs text-ink-mute">
              {recent?.note ||
                "Recent failed payments created from this demo tool."}
            </p>
          </div>
          <button
            type="button"
            onClick={refreshHistory}
            className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-pine/30"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {historyLoading ? (
          <LoadingState message="Loading recent demo events…" />
        ) : historyError ? (
          <div className="px-5 py-6 text-sm text-clay">{historyError}</div>
        ) : historyRows.length === 0 && sessionRows.length === 0 ? (
          <EmptyState message="No demo events recorded yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-mist-soft/80 text-[11px] uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-5 py-3 font-semibold">Event</th>
                  <th className="px-3 py-3 font-semibold">Time</th>
                  <th className="px-3 py-3 font-semibold">Amount</th>
                  <th className="px-3 py-3 font-semibold">Customer</th>
                  <th className="px-3 py-3 font-semibold">Case</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Idempotency</th>
                  <th className="px-5 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessionRows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-ink/6 hover:bg-mist-soft/40"
                  >
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        className="font-mono text-xs font-semibold text-pine hover:underline"
                        onClick={() => {
                          setSelectedId(row.id);
                          setLatest(row);
                        }}
                      >
                        {row.event}
                      </button>
                      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-faint">
                        Session · Demo Event
                      </p>
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-mute">
                      {formatDateTime(row.at)}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {row.amount != null ? formatINR(row.amount) : "—"}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-ink-soft">
                      {row.customer_ref || "—"}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {row.case_number || "—"}
                    </td>
                    <td className="px-3 py-3">
                      {row.case_status ? (
                        <StatusBadge value={row.case_status} />
                      ) : row.simulation_only ? (
                        <span className="text-xs text-sand">Simulation</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {row.idempotent === true
                        ? "true"
                        : row.idempotent === false
                          ? "false"
                          : "—"}
                    </td>
                    <td className="px-5 py-3">
                      {row.case_id ? (
                        <Link
                          to={`/cases/${row.case_id}?from=event-console`}
                          className="text-xs font-semibold text-pine hover:underline"
                        >
                          View case
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {historyRows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-ink/6 hover:bg-mist-soft/40"
                  >
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        className="font-mono text-xs font-semibold text-ink hover:underline"
                        onClick={() => {
                          setSelectedId(row.id);
                          setLatest({
                            ...row,
                            message: null,
                            raw: row,
                          });
                        }}
                      >
                        {row.event}
                      </button>
                      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-faint">
                        {row.event_source_label ||
                          (row.event_source === "LIVE_PROVIDER"
                            ? "Live Provider Event"
                            : "Demo Event")}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-mute">
                      {formatDateTime(row.at)}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {formatINR(row.amount)}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-ink-soft">
                      {row.customer_ref}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {row.case_number || "—"}
                    </td>
                    <td className="px-3 py-3">
                      {row.case_status ? (
                        <StatusBadge value={row.case_status} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3 text-[10px] leading-snug text-ink-faint">
                      At ingest
                    </td>
                    <td className="px-5 py-3">
                      {row.case_id ? (
                        <Link
                          to={`/cases/${row.case_id}?from=event-console`}
                          className="text-xs font-semibold text-pine hover:underline"
                        >
                          View case
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <section className="panel p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-xl font-medium text-ink">
              Event detail
            </h3>
            {selected.payment_id && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-mute hover:text-pine"
                onClick={() =>
                  navigator.clipboard?.writeText(selected.payment_id)
                }
              >
                <Copy size={12} />
                Copy payment id
              </button>
            )}
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Event type", selected.event],
              ["Event time", formatDateTime(selected.at)],
              [
                "Amount",
                selected.amount != null ? formatINR(selected.amount) : "—",
              ],
              ["Currency", selected.currency || "—"],
              ["Payment ID", selected.payment_id || "—"],
              ["Case number", selected.case_number || "—"],
              [
                "Failure",
                selected.failure_code
                  ? `${selected.failure_code}${
                      selected.failure_reason
                        ? ` — ${selected.failure_reason}`
                        : ""
                    }`
                  : "—",
              ],
              [
                "Idempotency",
                selected.idempotent === true
                  ? "true (replay)"
                  : selected.idempotent === false
                    ? "false (first)"
                    : selected.idempotency_state || "evaluated at ingest",
              ],
              [
                "Resulting state",
                selected.case_status
                  ? toLabel(selected.case_status)
                  : selected.simulation_only
                    ? "Unchanged (simulation only)"
                    : "—",
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-ink/8 bg-mist-soft/50 px-3.5 py-3"
              >
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  {label}
                </dt>
                <dd className="mt-1 break-all text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

export default EventConsole;
