import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal } from "lucide-react";
import CaseTable from "../components/CaseTable";
import LoadingState, { ErrorState } from "../components/LoadingState";
import {
  getRecoveryCases,
  getMerchantSettings,
  runRecoveryAgent,
  parseApiError,
} from "../services/api";
import {
  CASE_STATUSES,
  FAILURE_CATEGORIES,
  RISK_LEVELS,
  toLabel,
} from "../utils/labels";
import { isAgentRecoveryMode } from "../utils/recoveryMode";
import {
  markAgentRunStarted,
  clearAgentRunStarted,
  shouldKeepAgentRunMark,
} from "../utils/agentRunState";

function RecoveryCases() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [status, setStatus] = useState(searchParams.get("status") || "ALL");
  const [category, setCategory] = useState(
    searchParams.get("category") || "ALL"
  );
  const [risk, setRisk] = useState(searchParams.get("risk") || "ALL");
  const [sortBy, setSortBy] = useState(searchParams.get("sort") || "newest");
  const [agentMode, setAgentMode] = useState(false);
  const [executingId, setExecutingId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const loadCases = useCallback(async () => {
    try {
      const [data, settings] = await Promise.all([
        getRecoveryCases(),
        getMerchantSettings().catch(() => null),
      ]);
      setCases(data || []);
      setAgentMode(isAgentRecoveryMode(settings?.recovery_mode));
    } catch (err) {
      console.error(err);
      setError("Unable to connect to RecoverAI API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  useEffect(() => {
    const urlQuery = searchParams.get("q") || "";
    if (urlQuery !== search) {
      setSearch(urlQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const params = {};
    if (search.trim()) params.q = search.trim();
    if (status !== "ALL") params.status = status;
    if (category !== "ALL") params.category = category;
    if (risk !== "ALL") params.risk = risk;
    if (sortBy !== "newest") params.sort = sortBy;

    const current = searchParams.toString();
    const next = new URLSearchParams(params).toString();
    if (current !== next) {
      setSearchParams(params, { replace: true });
    }
  }, [search, status, category, risk, sortBy, searchParams, setSearchParams]);

  const filteredCases = useMemo(() => {
    const query = search.trim().toLowerCase();
    let result = [...cases];

    if (query) {
      result = result.filter((item) => {
        const haystack = [
          item.case_number,
          item.failure_category,
          item.selected_strategy,
          item.status,
          item.current_step,
          item.risk_level,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });
    }

    if (status !== "ALL") {
      result = result.filter((item) => item.status === status);
    }
    if (category !== "ALL") {
      result = result.filter((item) => item.failure_category === category);
    }
    if (risk !== "ALL") {
      result = result.filter(
        (item) => String(item.risk_level).toUpperCase() === risk
      );
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case "amount_desc":
          return (b.amount_at_risk || 0) - (a.amount_at_risk || 0);
        case "amount_asc":
          return (a.amount_at_risk || 0) - (b.amount_at_risk || 0);
        case "probability_desc":
          return (b.recovery_probability || 0) - (a.recovery_probability || 0);
        case "oldest":
          return new Date(a.created_at) - new Date(b.created_at);
        case "newest":
        default:
          return new Date(b.created_at) - new Date(a.created_at);
      }
    });

    return result;
  }, [cases, search, status, category, risk, sortBy]);

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
      await loadCases();
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

  if (loading) return <LoadingState message="Loading recovery cases..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="page-enter space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Recovery Pipeline</p>
          <h2 className="page-title">Recovery Cases</h2>
          <p className="mt-2 text-sm text-ink-mute">
            A failed payment being recovered.{" "}
            <span className="font-mono text-ink">{filteredCases.length}</span> of{" "}
            <span className="font-mono">{cases.length}</span> cases in view
          </p>
        </div>
      </div>

      <div className="panel p-5">
        <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          <SlidersHorizontal size={13} />
          Refine
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative xl:col-span-2">
            <Search
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search case, strategy, status…"
              className="field pl-10"
            />
          </div>

          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="field"
          >
            <option value="ALL">All statuses</option>
            {CASE_STATUSES.map((item) => (
              <option key={item} value={item}>
                {toLabel(item)}
              </option>
            ))}
          </select>

          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="field"
          >
            <option value="ALL">All categories</option>
            {FAILURE_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {toLabel(item)}
              </option>
            ))}
          </select>

          <select
            value={risk}
            onChange={(event) => setRisk(event.target.value)}
            className="field"
          >
            <option value="ALL">All risk levels</option>
            {RISK_LEVELS.map((item) => (
              <option key={item} value={item}>
                {toLabel(item)}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-xs font-medium text-ink-faint">Sort</label>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
            className="field max-w-xs"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="amount_desc">Amount at risk (high → low)</option>
            <option value="amount_asc">Amount at risk (low → high)</option>
            <option value="probability_desc">Recovery probability</option>
          </select>
        </div>
      </div>

      {actionError && (
        <p className="rounded-xl border border-clay/20 bg-clay-soft/40 px-4 py-3 text-sm text-clay">
          {actionError}
        </p>
      )}

      <div className="panel p-3 sm:p-4">
        <CaseTable
          cases={filteredCases}
          agentMode={agentMode}
          executingId={executingId}
          onRunAgent={handleRunAgent}
        />
      </div>
    </div>
  );
}

export default RecoveryCases;
