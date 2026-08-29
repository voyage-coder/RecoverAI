import { useMemo } from "react";
import {
  AlertTriangle,
  Loader2,
  Play,
  RotateCcw,
} from "lucide-react";
import StatusBadge from "./StatusBadge";
import RazorpayTestCheckout from "./RazorpayTestCheckout";
import { toLabel } from "../utils/labels";

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
  operationError,
  onExecutePending,
  onContinueRecovery,
  onCheckoutComplete,
  onRefresh,
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

    if (pendingAction && !isTerminal) {
      ops.push({
        key: "execute",
        label: `Execute ${toLabel(pendingAction.action_type)}`,
        description:
          "Runs the pending action through the existing executor and Safety Engine.",
        primary: true,
        onClick: onExecutePending,
      });
    }

    // While awaiting a Razorpay webhook, do not offer "prepare next"
    // — that caused confusing 400s after a successful TEST payment.
    if (
      !pendingAction &&
      !isTerminal &&
      !isEscalated &&
      !blockedAction &&
      !awaitingWebhook
    ) {
      ops.push({
        key: "continue",
        label: "Prepare next recovery action",
        description:
          "ML + Safety Engine selects the next strategy and creates an action.",
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
  ]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-skyline/20 bg-skyline-soft/30 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-skyline">
          Responsibility split
        </p>
        <ul className="mt-2 space-y-1 text-xs text-ink-mute">
          <li>
            <span className="font-semibold text-ink">Merchant:</span> approve /
            execute the recovery action and initiate the payment link or retry.
          </li>
          <li>
            <span className="font-semibold text-ink">Customer:</span> receives
            the link and completes payment — the merchant does not pay the bill.
          </li>
          <li>
            <span className="font-semibold text-ink">Razorpay:</span> processes
            payment and emits payment.captured.
          </li>
          <li>
            <span className="font-semibold text-ink">RecoverAI:</span> verifies
            the webhook, matches the case, and marks recovered only after
            verified capture.
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
            Only existing pending actions can be executed. There is no Force
            Recover or Mark Paid control.
          </p>
        </div>
      )}

      {awaitingWebhook && !isTerminal && (
        <div className="rounded-xl border border-sand/30 bg-sand-soft/50 px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            Awaiting customer payment
          </p>
          <p className="mt-1 text-sm text-ink-mute">
            Payment link ready / order created. Customer payment is required.
            Checkout success alone does not mark the case recovered — RecoverAI
            waits for a signature-verified{" "}
            <span className="font-mono text-xs">payment.captured</span> webhook
            at{" "}
            <span className="font-mono text-xs">
              POST /api/webhooks/razorpay
            </span>
            .
          </p>
        </div>
      )}

      {blockedAction && (
        <div className="rounded-xl border border-clay/25 bg-clay-soft/50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 text-clay" />
            <div>
              <p className="text-sm font-semibold text-clay">
                Action blocked by Safety Engine
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
            Attempt #{pendingAction.attempt_number} · created by AI recovery
            pipeline — execute only after confirmation
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

      {operationMessage && !operationError && (
        <div className="rounded-xl border border-pine/20 bg-pine-soft/40 px-4 py-3 text-sm text-pine">
          {operationMessage}
        </div>
      )}

      {!isTerminal && (
        <div className="rounded-xl border border-ink/10 bg-white p-4">
          <p className="text-sm font-semibold text-ink">
            Razorpay TEST recovery
          </p>
          <p className="mt-1 text-xs text-ink-mute">
            Complete TEST payment as the customer would. Secrets stay on the
            backend. Checkout success does not mark the case recovered.
          </p>
          <div className="mt-4">
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
          Case is in a terminal backend state ({toLabel(caseStatus)}). No
          further operator actions are available.
        </p>
      )}

      <div className="text-xs text-ink-faint">
        <p className="font-semibold uppercase tracking-wide">
          Safety note
        </p>
        <p className="mt-1">
          Retry, payment link, email, SMS, WhatsApp, and escalation are chosen
          by ML + Safety Engine. Use Execute pending action to run the selected
          strategy. After Razorpay TEST payment, wait for the webhook — do not
          click Prepare next while awaiting customer payment.
        </p>
      </div>
    </div>
  );
}

export default RecoveryOperationsPanel;
