import { useMemo } from "react";
import {
  AlertTriangle,
  Loader2,
  Play,
  RotateCcw,
} from "lucide-react";
import StatusBadge from "./StatusBadge";
import RazorpayTestCheckout from "./RazorpayTestCheckout";
import RunAgentButton from "./RunAgentButton";
import { toLabel } from "../utils/labels";
import { isCaseEligibleForRunAgent } from "../utils/recoveryMode";
import { policyBannerFromCase } from "../utils/policyCopy";
import AgentRunningBanner from "./AgentRunningBanner";

function upper(value) {
  return String(value || "").toUpperCase();
}

function RecoveryOperationsPanel({
  recoveryCase,
  timeline,
  checkoutConfig,
  paymentDetails,
  operating,
  operationMessage,
  operationWarning,
  operationError,
  onExecutePending,
  onContinueRecovery,
  onCheckoutComplete,
  onRefresh,
  agentMode = false,
  onRunAgent,
}) {
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
  const paymentStatus = upper(paymentDetails?.payment?.status);
  const isTerminal =
    caseStatus === "RECOVERED" || caseStatus === "CLOSED";
  const isEscalated = caseStatus === "ESCALATED";
  const awaitingWebhook =
    paymentStatus !== "RECOVERED" &&
    (checkoutConfig?.awaiting_webhook === true ||
      paymentDetails?.gateway_summary?.awaiting_webhook === true ||
      (paymentDetails?.attempts || []).some((attempt) =>
        String(attempt.error_code || "")
          .toUpperCase()
          .includes("AWAITING")
      ));

  const availableOperations = useMemo(() => {
    const ops = [];
    const waitingOnMerchant = Boolean(
      pendingAction &&
        !isTerminal &&
        ["AWAITING_APPROVAL", "READY_TO_EXECUTE"].includes(
          upper(recoveryCase?.approval_state)
        )
    );

    if (pendingAction && !isTerminal && (!agentMode || waitingOnMerchant)) {
      ops.push({
        key: "execute",
        label: waitingOnMerchant
          ? upper(pendingAction.action_type) === "SEND_PAYMENT_LINK"
            ? "Send payment link"
            : "Approve & run"
          : "Run recommended action",
        description: "Runs the pending action through Safety Engine.",
        primary: true,
        onClick: onExecutePending,
      });
    }

    if (
      !agentMode &&
      !pendingAction &&
      !isTerminal &&
      !isEscalated &&
      !blockedAction &&
      !awaitingWebhook
    ) {
      ops.push({
        key: "continue",
        label: "Prepare next action",
        description: "Creates the next recommended recovery action.",
        primary: !latestExecuted,
        onClick: onContinueRecovery,
      });
    }

    return ops;
  }, [
    pendingAction,
    isTerminal,
    isEscalated,
    blockedAction,
    awaitingWebhook,
    latestExecuted,
    onExecutePending,
    onContinueRecovery,
    agentMode,
    recoveryCase?.approval_state,
  ]);

  const showRunAgent =
    agentMode &&
    isCaseEligibleForRunAgent(recoveryCase, {
      awaitingCustomerPayment: awaitingWebhook,
    });
  const policyBanner = policyBannerFromCase(recoveryCase);

  return (
    <div className="space-y-5">
      <AgentRunningBanner visible={operating && agentMode} />
      <div className="rounded-xl border border-skyline/20 bg-skyline-soft/30 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-skyline">
          Who does what
        </p>
        <ul className="mt-2 space-y-1 text-xs text-ink-mute">
          <li>
            <span className="font-semibold text-ink">You:</span>{" "}
            {agentMode
              ? "click Execute when the agent leaves a step for you. If the next step is allowed for the agent, it continues on its own until it needs you again or the customer pays."
              : "run the recommended action."}
          </li>
          <li>
            <span className="font-semibold text-ink">Customer:</span> pays
            with the payment link or checkout.
          </li>
          <li>
            <span className="font-semibold text-ink">RecoverAI:</span> marks
            recovered only after a verified webhook.
          </li>
        </ul>
      </div>

      {isEscalated && (
        <div className="rounded-xl border border-clay/25 bg-clay-soft/50 px-4 py-3">
          <p className="text-sm font-semibold text-clay">
            Needs Human Attention
          </p>
          <p className="mt-1 text-sm text-ink-mute">
            Reason:{" "}
            {recoveryCase?.current_step ||
              recoveryCase?.failure_reason ||
              recoveryCase?.root_cause ||
              "Not available"}
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            Recovery still needs a verified webhook if payment was started.
          </p>
        </div>
      )}

      {awaitingWebhook && !isTerminal && (
        <div className="rounded-xl border border-sand/30 bg-sand-soft/50 px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            Waiting for customer payment
          </p>
          <p className="mt-1 text-sm text-ink-mute">
            Customer can pay with the payment link. Status updates after a
            verified Razorpay webhook.
          </p>
        </div>
      )}

      {blockedAction && (
        <div className="rounded-xl border border-clay/25 bg-clay-soft/50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 text-clay" />
            <div>
              <p className="text-sm font-semibold text-clay">
                Blocked by safety rules
              </p>
              <p className="mt-1 text-sm text-ink-mute">
                {blockedAction.result_text ||
                  "Recovery limits or policy blocked this action."}
              </p>
            </div>
          </div>
        </div>
      )}

      {pendingAction && !isTerminal && (
        <div className="rounded-xl border border-ink/8 bg-mist-soft/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">
              Pending merchant action: {toLabel(pendingAction.action_type)}
            </p>
            <StatusBadge value={pendingAction.status} />
          </div>
          <p className="mt-2 text-xs text-ink-mute">
            Attempt #{pendingAction.attempt_number} · send this if the agent left it for you
          </p>
        </div>
      )}

      {latestExecuted && (
        <div className="rounded-xl border border-pine/15 bg-pine-soft/30 px-4 py-3 text-sm text-ink-mute">
          Last executed:{" "}
          <span className="font-medium text-ink">
            {toLabel(latestExecuted.action_type)}
          </span>
          {latestExecuted.result_text
            ? ` — ${latestExecuted.result_text}`
            : ""}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {showRunAgent && (
          <RunAgentButton
            running={operating}
            onClick={onRunAgent}
          />
        )}
        {availableOperations.map((op) => (
          <button
            key={op.key}
            type="button"
            disabled={operating}
            onClick={op.onClick}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${
              op.primary
                ? "bg-ink text-white hover:bg-ink-soft"
                : "border border-ink/10 bg-white text-ink hover:border-pine/30"
            }`}
          >
            {operating ? (
              <Loader2 size={15} className="animate-spin" />
            ) : op.key === "execute" ? (
              <Play size={15} />
            ) : (
              <RotateCcw size={15} />
            )}
            {op.label}
          </button>
        ))}

        <button
          type="button"
          onClick={onRefresh}
          disabled={operating}
          className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-pine/30 disabled:opacity-60"
        >
          Refresh case state
        </button>
      </div>

      {operationError && (
        <div className="rounded-xl border border-clay/20 bg-clay-soft/40 px-4 py-3 text-sm text-clay">
          {operationError}
        </div>
      )}

      {operationWarning && !operationError && (
        <div className="rounded-xl border border-sand/30 bg-sand-soft/50 px-4 py-3 text-sm text-ink">
          {operationWarning}
        </div>
      )}

      {!operationWarning && policyBanner && (
        <div className="rounded-xl border border-sand/30 bg-sand-soft/50 px-4 py-3 text-sm text-ink">
          {policyBanner}
        </div>
      )}

      {operationMessage && !operationError && !operationWarning && (
        <div className="rounded-xl border border-pine/20 bg-pine-soft/40 px-4 py-3 text-sm text-pine">
          {operationMessage}
        </div>
      )}

      {!isTerminal && (
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="text-sm font-semibold text-ink">Customer payment</p>
          <div className="mt-3">
            <RazorpayTestCheckout
              checkoutConfig={checkoutConfig}
              caseNumber={recoveryCase?.case_number}
              onComplete={(msg) => {
                onCheckoutComplete?.(msg);
                onRefresh?.();
              }}
            />
          </div>
        </div>
      )}

      {isTerminal && (
        <p className="text-sm text-ink-mute">
          Case is closed ({toLabel(caseStatus)}). No further actions are
          available.
        </p>
      )}

      <div className="text-xs text-ink-faint">
        <p className="font-semibold uppercase tracking-wide">
          Safety note
        </p>
        <p className="mt-1">
          After payment, wait for confirmation. Do not prepare the next action
          while the customer is paying.
        </p>
      </div>
    </div>
  );
}

export default RecoveryOperationsPanel;
