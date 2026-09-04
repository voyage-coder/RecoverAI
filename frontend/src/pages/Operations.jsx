import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import StatusBadge from "../components/StatusBadge";
import LoadingState, {
  ErrorState,
  EmptyState,
} from "../components/LoadingState";
import { getRecoveryCases, executePendingRecoveryAction, getMerchantSettings, runRecoveryAgent, parseApiError } from "../services/api";
import { formatINR } from "../utils/format";
import { toLabel } from "../utils/labels";
import OriginBadges from "../components/OriginBadges";
import RunAgentButton from "../components/RunAgentButton";
import AgentRunningBanner from "../components/AgentRunningBanner";
import {
  isAgentRecoveryMode,
  isCaseEligibleForRunAgent,
} from "../utils/recoveryMode";
import {
  markAgentRunStarted,
  clearAgentRunStarted,
  shouldKeepAgentRunMark,
  isCaseRowBusy,
} from "../utils/agentRunState";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "awaiting_approval", label: "Awaiting approval" },
  { key: "needs_attention", label: "Needs Attention" },
  { key: "in_recovery", label: "In Recovery" },
  { key: "recovered", label: "Recovered" },
  { key: "stopped", label: "Stopped" },
];

const SORTS = [
  { key: "amount_desc", label: "Highest amount at risk" },
  { key: "probability_desc", label: "Highest recovery probability" },
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
];

function upper(value) {
  return String(value || "").toUpperCase();
}

function queueForStatus(item) {
  if (item.approval_state === "AWAITING_APPROVAL") return "awaiting_approval";
  const key = upper(item.status);
  if (key === "ESCALATED") return "needs_attention";
  if (key === "ACTIVE" || key === "IN_PROGRESS") return "in_recovery";
  if (key === "RECOVERED") return "recovered";
  if (key === "CLOSED") return "stopped";
  return "other";
}

function priorityFromRisk(riskLevel) {
  const risk = upper(riskLevel);
  if (risk === "HIGH" || risk === "CRITICAL") return "HIGH";
  if (risk === "MEDIUM") return "MEDIUM";
  if (risk === "LOW") return "LOW";
  return risk || "Not available";
}

function OperationsCaseCard({
  item,
  onExecute,
  onRunAgent,
  executingId,
  agentMode,
}) {
  const priority = priorityFromRisk(item.risk_level);
  const canExecute =
    item.approval_state === "AWAITING_APPROVAL" ||
    item.approval_state === "READY_TO_EXECUTE";
  const isRecovered = upper(item.status) === "RECOVERED";

  return (
    <div className="rounded-xl border border-ink/8 bg-mist-soft/50 px-4 py-4 transition hover:border-ink/15 hover:bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-sm font-semibold text-ink">
              {item.case_number}
            </p>
            <StatusBadge value={item.status} />
            <StatusBadge
              value={priority}
              label={priority}
              tone={
                priority === "HIGH"
                  ? "danger"
                  : priority === "MEDIUM"
                    ? "warning"
                    : "success"
              }
            />
            {item.event_source_label && (
              <OriginBadges
                eventSource={item.event_source}
                eventSourceLabel={item.event_source_label}
                outcomeKind={item.outcome_kind}
                webhookAuthorityLabel={item.webhook_authority_label}
                recovered={upper(item.status) === "RECOVERED"}
              />
            )}
          </div>
          <p className="mt-2 text-sm text-ink-mute">
            {toLabel(item.failure_category)}
            {item.failure_reason ? ` — ${item.failure_reason}` : ""}
          </p>
        </div>
        <p className="font-mono text-lg font-medium text-ink">
          {formatINR(item.amount_at_risk)}
        </p>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-ink-mute sm:grid-cols-2 lg:grid-cols-3">
        <p>
          Recommended:{" "}
          <span className="text-ink">
            {item.recommended_action
              ? toLabel(item.recommended_action)
              : item.selected_strategy
                ? toLabel(item.selected_strategy)
                : "Not available"}
          </span>
        </p>
        <p>
          Risk:{" "}
          <span className="text-ink">{toLabel(item.risk_level)}</span>
        </p>
        <p>
          Safety:{" "}
          <span className="text-ink">{item.safety_decision || "—"}</span>
        </p>
        <p>
          Approval:{" "}
          <span className="text-ink">
            {toLabel(item.approval_state) || "—"}
          </span>
        </p>
        <p>
          Recovery probability:{" "}
          <span className="font-mono text-ink">
            {item.recovery_probability != null
              ? `${item.recovery_probability}%`
              : "Not available"}
          </span>
        </p>
        <p>
          Strategy:{" "}
          <span className="text-ink">
            {item.selected_strategy
              ? toLabel(item.selected_strategy)
              : "Not available"}
          </span>
        </p>
        <p>
          Retries:{" "}
          <span className="font-mono text-ink">
            {item.retry_count != null ? item.retry_count : "Not available"}
          </span>
        </p>
        <p>
          Contacts:{" "}
          <span className="font-mono text-ink">
            {item.contact_count != null
              ? item.contact_count
              : "Not available"}
          </span>
        </p>
        <p>
          Current step:{" "}
          <span className="text-ink">
            {item.current_step
              ? toLabel(item.current_step)
              : "Not available"}
          </span>
        </p>
      </div>

      {item.next_step_detail && (
        <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs text-ink-mute">
          Next: {item.next_step_label || "Review"} — {item.next_step_detail}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          to={`/cases/${item.id}`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-pine hover:underline"
        >
          Review case
          <ArrowUpRight size={12} />
        </Link>
        {agentMode && isCaseEligibleForRunAgent(item) ? (
          <div className="space-y-2">
            <AgentRunningBanner
              compact
              visible={isCaseRowBusy(item, executingId)}
            />
            <RunAgentButton
              className="px-3 py-1.5 text-xs"
              running={isCaseRowBusy(item, executingId)}
              onClick={() => onRunAgent(item.id)}
            />
          </div>
        ) : (
          canExecute &&
          !isRecovered && (
            <button
              type="button"
              disabled={executingId === item.id}
              onClick={() => onExecute(item.id)}
              className="inline-flex items-center rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {item.approval_state === "AWAITING_APPROVAL"
                ? "Approve & run"
                : "Run recommended action"}
            </button>
          )
        )}
      </div>
    </div>
  );
}

function Operations() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [executingId, setExecutingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [agentMode, setAgentMode] = useState(false);

  const loadCases = useCallback(async ({ soft = false } = {}) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [data, settings] = await Promise.all([
        getRecoveryCases(),
        getMerchantSettings().catch(() => null),
      ]);
      setCases(data || []);
      setAgentMode(isAgentRecoveryMode(settings?.recovery_mode));
    } catch (err) {
      console.error(err);
      setError(parseApiError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  const counts = useMemo(() => {
    const next = {
      all: cases.length,
      awaiting_approval: 0,
      needs_attention: 0,
      in_recovery: 0,
      recovered: 0,
      stopped: 0,
    };
    cases.forEach((item) => {
      const q = queueForStatus(item);
      if (next[q] != null) next[q] += 1;
    });
    return next;
  }, [cases]);

  const visibleCases = useMemo(() => {
    let list = [...cases];
    if (filter !== "all") {
      list = list.filter((item) => queueForStatus(item) === filter);
    }

    list.sort((a, b) => {
      switch (sortBy) {
        case "amount_desc":
          return (b.amount_at_risk || 0) - (a.amount_at_risk || 0);
        case "probability_desc":
          return (
            (b.recovery_probability || 0) - (a.recovery_probability || 0)
          );
        case "oldest":
          return new Date(a.created_at || 0) - new Date(b.created_at || 0);
        case "newest":
        default:
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
    });

    return list;
  }, [cases, filter, sortBy]);

  const handleRunAgent = async (caseId) => {
    if (executingId) return;
    setExecutingId(caseId);
    setActionError(null);
    markAgentRunStarted(caseId);
    try {
      const result = await runRecoveryAgent(caseId);
      clearAgentRunStarted(caseId);
      if (result?.blocked) {
        setActionError(result.result_text || "Safety blocked this plan.");
      } else if (result?.agent_skipped) {
        setActionError(result.message);
      }
      await loadCases({ soft: true });
    } catch (err) {
      console.error(err);
      if (!shouldKeepAgentRunMark(err)) {
        clearAgentRunStarted(caseId);
      }
      setActionError(parseApiError(err));
    } finally {
      setExecutingId(null);
    }
  };

  const handleExecute = async (caseId) => {
    if (executingId) return;
    setExecutingId(caseId);
    setActionError(null);
    try {
      const result = await executePendingRecoveryAction(caseId);
      if (result?.blocked) {
        setActionError(result.result_text || "Action blocked by Safety Engine.");
      }
      await loadCases({ soft: true });
    } catch (err) {
      console.error(err);
      setActionError(parseApiError(err));
    } finally {
      setExecutingId(null);
    }
  };

  const exposure = useMemo(
    () =>
      visibleCases.reduce(
        (sum, item) => sum + (Number(item.amount_at_risk) || 0),
        0
      ),
    [visibleCases]
  );

  if (loading) {
    return <LoadingState message="Loading merchant action center..." />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="page-enter space-y-6">
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-5 border-b border-ink/10 bg-mist-soft/50 px-5 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <p className="eyebrow">Merchant desk</p>
            <h2 className="page-title">Action Center</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-mute">
              Review failed payments and take action.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/analytics"
              className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink transition hover:border-pine/30 hover:text-pine"
            >
              View analytics
              <ArrowUpRight size={15} />
            </Link>
            <button
              type="button"
              onClick={() => loadCases({ soft: true })}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink transition hover:border-pine/30 hover:text-pine disabled:opacity-60"
            >
              <RefreshCw
                size={15}
                className={refreshing ? "animate-spin" : ""}
              />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-ink/8 bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Visible cases
          </p>
          <p className="mt-1 font-mono text-xl text-ink">
            {visibleCases.length}
          </p>
        </div>
        <div className="rounded-xl border border-clay/15 bg-clay-soft/30 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-clay">
            Needs attention
          </p>
          <p className="mt-1 font-mono text-xl text-ink">
            {counts.needs_attention}
          </p>
        </div>
        <div className="rounded-xl border border-sand/20 bg-sand-soft/40 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-sand">
            In recovery
          </p>
          <p className="mt-1 font-mono text-xl text-ink">{counts.in_recovery}</p>
        </div>
        <div className="rounded-xl border border-pine/15 bg-pine-soft/40 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-pine">
            Recovered
          </p>
          <p className="mt-1 font-mono text-xl text-ink">{counts.recovered}</p>
        </div>
        <div className="rounded-xl border border-ink/8 bg-mist-soft/70 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Exposure in view
          </p>
          <p className="mt-1 font-mono text-xl text-ink">
            {formatINR(exposure)}
          </p>
        </div>
      </section>

      <section className="panel p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((item) => (
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
                  {counts[item.key] ?? 0}
                </span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-mute">
            Sort
            <select
              className="field w-auto min-w-[12rem] py-2 text-xs"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              {SORTS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {actionError && (
        <p className="text-sm font-medium text-clay">{actionError}</p>
      )}

      {cases.length === 0 ? (
        <EmptyState message="No recovery cases yet. Simulate a payment failure or wait for inbound events." />
      ) : visibleCases.length === 0 ? (
        <EmptyState message="No cases match this filter." />
      ) : (
        <section className="space-y-3">
          {visibleCases.map((item) => (
            <OperationsCaseCard
              key={item.id}
              item={item}
              onExecute={handleExecute}
              onRunAgent={handleRunAgent}
              executingId={executingId}
              agentMode={agentMode}
            />
          ))}
        </section>
      )}
    </div>
  );
}

export default Operations;
