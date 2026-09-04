import { useState } from "react";
import { AlertTriangle, Loader2, Play } from "lucide-react";
import StatusBadge from "./StatusBadge";
import RunAgentButton from "./RunAgentButton";
import { formatINR } from "../utils/format";
import { toLabel } from "../utils/labels";
import { resolveActionStateLabel } from "../utils/customerJourney";
import { isCaseEligibleForRunAgent } from "../utils/recoveryMode";
import { policyBannerFromCase } from "../utils/policyCopy";

function upper(value) {
  return String(value || "").toUpperCase();
}

function RecommendedActionCard({
  recoveryCase,
  timeline,
  paymentDetails,
  checkoutConfig,
  operating,
  onExecute,
  agentMode = false,
  onRunAgent,
}) {
  const [confirming, setConfirming] = useState(false);

  const actions = timeline?.actions || [];
  const pendingAction = actions.find((item) =>
    ["PENDING", "PROCESSING"].includes(upper(item.status))
  );
  const blockedAction = actions.find(
    (item) => upper(item.status) === "BLOCKED"
  );
  const latestExecuted = [...actions]
    .reverse()
    .find((item) => upper(item.status) === "EXECUTED");

  const caseStatus = upper(recoveryCase?.status);
  const isEscalated = caseStatus === "ESCALATED";
  const isTerminal =
    caseStatus === "RECOVERED" || caseStatus === "CLOSED";

  const awaitingCustomerPayment =
    upper(paymentDetails?.payment?.status) !== "RECOVERED" &&
    (checkoutConfig?.awaiting_webhook === true ||
      paymentDetails?.gateway_summary?.awaiting_webhook === true ||
      (paymentDetails?.attempts || []).some((attempt) =>
        String(attempt.error_code || "")
          .toUpperCase()
          .includes("AWAITING")
      ));

  const showRunAgent =
    agentMode &&
    isCaseEligibleForRunAgent(recoveryCase, { awaitingCustomerPayment });
  const policyBanner = policyBannerFromCase(recoveryCase);

  const strategy =
    pendingAction?.action_type ||
    recoveryCase?.selected_strategy ||
    null;

  const actionState = resolveActionStateLabel({
    action: pendingAction || blockedAction || latestExecuted,
    awaitingCustomerPayment,
  });

  const agentButton = showRunAgent ? (
    <RunAgentButton
      className="mt-5"
      running={operating}
      onClick={() => onRunAgent?.()}
    />
  ) : null;

  const policyNote = policyBanner ? (
    <p className="mt-4 rounded-xl border border-sand/30 bg-sand-soft/50 px-3 py-2 text-sm text-ink">
      {policyBanner}
    </p>
  ) : null;

  if (isTerminal) {
    return (
      <div className="rounded-[18px] border border-ink/10 bg-mist-soft/50 p-5 sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Recommended Action
        </p>
        <p className="mt-2 font-display text-xl text-ink">
          No merchant action required
        </p>
        <p className="mt-2 text-sm text-ink-mute">
          Case is {toLabel(caseStatus)}.
        </p>
      </div>
    );
  }

  if (isEscalated && !pendingAction) {
    return (
      <div className="rounded-[18px] border border-clay/25 bg-clay-soft/40 p-5 sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-clay">
          Needs Human Attention
        </p>
        <h4 className="mt-2 font-display text-2xl font-medium text-ink">
          Escalated
        </h4>
        <p className="mt-2 text-sm text-ink-mute">
          Reason:{" "}
          {recoveryCase?.current_step ||
            recoveryCase?.failure_reason ||
            recoveryCase?.root_cause ||
            "Not available"}
        </p>
        <p className="mt-3 text-xs text-ink-faint">
          There is no Force Recover control. Verified by Razorpay webhook if
          payment was started.
        </p>
        {awaitingCustomerPayment && (
          <p className="mt-3 text-sm font-medium text-sand">
            Waiting for customer payment.
          </p>
        )}
      </div>
    );
  }

  if (blockedAction && !pendingAction) {
    return (
      <div className="rounded-[18px] border border-clay/25 bg-clay-soft/50 p-5 sm:p-6">
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5 text-clay" />
          <div>
            <p className="text-sm font-semibold text-clay">
              Blocked by safety rules
            </p>
            <p className="mt-2 text-sm text-ink-mute">
              {blockedAction.result_text ||
                "Safety policy blocked this recovery action."}
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              Safety decisions cannot be bypassed here.
            </p>
            {agentButton}
          </div>
        </div>
      </div>
    );
  }

  if (!pendingAction && awaitingCustomerPayment) {
    return (
      <div className="rounded-[18px] border border-sand/30 bg-sand-soft/45 p-5 sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sand">
          Recommended Action
        </p>
        <h4 className="mt-2 font-display text-2xl font-medium text-ink">
          Waiting for customer payment
        </h4>
        <p className="mt-2 text-sm text-ink-mute">
          The customer must complete payment. Verified by Razorpay webhook.
        </p>
        {actionState && (
          <div className="mt-3">
            <StatusBadge value={actionState} label={actionState} />
          </div>
        )}
      </div>
    );
  }

  if (!pendingAction) {
    return (
      <div className="rounded-[18px] border border-ink/10 bg-mist-soft/50 p-5 sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Recommended Action
        </p>
        <p className="mt-2 text-sm text-ink-mute">
          {agentMode
            ? "No pending action yet. Run Agent to analyze this case and execute every action Safety and your Settings allow."
            : "No pending recovery action right now. Use Prepare next action if the customer is not already paying."}
        </p>
        {agentButton}
        {policyNote}
      </div>
    );
  }

  return (
    <div className="rounded-[18px] border border-pine/25 bg-pine-soft/35 p-5 sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pine">
        Recommended recovery method
      </p>
      <h4 className="mt-2 font-display text-2xl font-medium text-ink">
        {toLabel(strategy)}
      </h4>
      <p className="mt-2 text-sm text-ink-mute">
        {agentMode
          ? "Run Agent evaluates strategies, checks Safety, and executes every permitted action. It stops when it must wait for the customer, a Safety block, or a Settings limit."
          : "Confirm to run this action. Recovery is confirmed only after the customer pays."}
      </p>

      {agentMode ? (
        <>
          {agentButton}
          {policyNote}
        </>
      ) : !confirming ? (
        <button
          type="button"
          disabled={operating}
          onClick={() => setConfirming(true)}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-soft disabled:opacity-60"
        >
          <Play size={15} />
          Run recommended action
        </button>
      ) : (
        <div className="mt-5 rounded-xl border border-ink/10 bg-white p-4">
          <p className="text-sm font-semibold text-ink">
            You&apos;re about to execute:
          </p>
          <p className="mt-1 text-sm text-ink-mute">{toLabel(strategy)}</p>
          <p className="mt-3 text-sm text-ink-mute">
            Amount at risk:{" "}
            <span className="font-mono text-ink">
              {formatINR(recoveryCase?.amount_at_risk)}
            </span>
          </p>
          <p className="mt-3 text-xs text-ink-faint">
            This is recorded in the audit trail and must pass safety rules.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={operating}
              onClick={() => setConfirming(false)}
              className="rounded-xl border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={operating}
              onClick={async () => {
                await onExecute?.();
                setConfirming(false);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-pine px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {operating ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Play size={15} />
              )}
              Execute action
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default RecommendedActionCard;
