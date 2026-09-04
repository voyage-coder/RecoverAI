import { Link } from "react-router-dom";
import StatusBadge from "./StatusBadge";
import { EmptyState } from "./LoadingState";
import { formatINR, formatDate } from "../utils/format";
import { toLabel } from "../utils/labels";
import OriginBadges from "./OriginBadges";
import RunAgentButton from "./RunAgentButton";
import { isCaseEligibleForRunAgent } from "../utils/recoveryMode";
import { isCaseRowBusy } from "../utils/agentRunState";
import AgentRunningBanner from "./AgentRunningBanner";

function CaseTable({
  cases = [],
  agentMode = false,
  executingId = null,
  onRunAgent,
}) {
  if (!cases.length) {
    return <EmptyState message="No recovery cases found." />;
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-ink/10 md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="bg-mist-soft/90 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                <th className="px-4 py-3.5 font-semibold">Case</th>
                <th className="px-4 py-3.5 font-semibold">Failure</th>
                <th className="px-4 py-3.5 font-semibold">Amount</th>
                <th className="px-4 py-3.5 font-semibold">Risk</th>
                <th className="px-4 py-3.5 font-semibold">Prob.</th>
                <th className="px-4 py-3.5 font-semibold">Strategy</th>
                <th className="px-4 py-3.5 font-semibold">Status</th>
                <th className="px-4 py-3.5 font-semibold">Created</th>
                {agentMode && (
                  <th className="px-4 py-3.5 font-semibold">Agent</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5 bg-white">
              {cases.map((item) => (
                <tr
                  key={item.id}
                  className="transition hover:bg-pine-soft/20"
                >
                  <td className="px-4 py-4">
                    <Link
                      to={`/cases/${item.id}`}
                      className="font-mono text-sm font-medium text-ink hover:text-pine"
                    >
                      {item.case_number}
                    </Link>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {toLabel(item.current_step)}
                    </p>
                    <div className="mt-1.5">
                      <OriginBadges
                        eventSource={item.event_source}
                        eventSourceLabel={item.event_source_label}
                        outcomeKind={item.outcome_kind}
                        webhookAuthorityLabel={item.webhook_authority_label}
                        recovered={
                          String(item.status || "").toUpperCase() ===
                          "RECOVERED"
                        }
                      />
                    </div>
                  </td>
                  <td className="px-4 py-4 text-ink-soft">
                    {toLabel(item.failure_category)}
                  </td>
                  <td className="px-4 py-4 font-mono tabular-nums text-ink">
                    {formatINR(item.amount_at_risk)}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge value={item.risk_level} />
                  </td>
                  <td className="px-4 py-4 font-mono text-ink-soft">
                    {item.recovery_probability != null
                      ? `${item.recovery_probability}%`
                      : "—"}
                  </td>
                  <td className="px-4 py-4 text-ink-soft">
                    {toLabel(item.selected_strategy)}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge value={item.status} />
                  </td>
                  <td className="px-4 py-4 text-ink-mute">
                    {formatDate(item.created_at)}
                  </td>
                  {agentMode && (
                    <td className="px-4 py-4">
                      {isCaseEligibleForRunAgent(item) ? (
                        <div className="space-y-2">
                          <AgentRunningBanner
                            compact
                            visible={isCaseRowBusy(item, executingId)}
                          />
                          <RunAgentButton
                            className="px-3 py-1.5 text-xs"
                            running={isCaseRowBusy(item, executingId)}
                            onClick={() => onRunAgent?.(item.id)}
                          />
                        </div>
                      ) : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {cases.map((item) => (
          <div
            key={item.id}
            className="rounded-2xl border border-ink/10 bg-white p-4 shadow-panel"
          >
            <Link
              to={`/cases/${item.id}`}
              className="block transition hover:border-pine/20"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-medium text-ink">
                    {item.case_number}
                  </p>
                  <p className="mt-1 text-xs text-ink-mute">
                    {toLabel(item.failure_category)}
                  </p>
                </div>
                <StatusBadge value={item.status} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-ink-faint">Amount</p>
                  <p className="mt-1 font-mono text-ink">
                    {formatINR(item.amount_at_risk)}
                  </p>
                </div>
                <div>
                  <p className="text-ink-faint">Risk</p>
                  <p className="mt-1">
                    <StatusBadge value={item.risk_level} />
                  </p>
                </div>
                <div>
                  <p className="text-ink-faint">Probability</p>
                  <p className="mt-1 font-mono text-ink">
                    {item.recovery_probability != null
                      ? `${item.recovery_probability}%`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-ink-faint">Created</p>
                  <p className="mt-1 text-ink">{formatDate(item.created_at)}</p>
                </div>
              </div>
            </Link>
            {agentMode && isCaseEligibleForRunAgent(item) && (
              <div className="mt-3 space-y-2">
                <AgentRunningBanner
                  compact
                  visible={isCaseRowBusy(item, executingId)}
                />
                <RunAgentButton
                  className="px-3 py-1.5 text-xs"
                  running={isCaseRowBusy(item, executingId)}
                  onClick={() => onRunAgent?.(item.id)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export default CaseTable;
