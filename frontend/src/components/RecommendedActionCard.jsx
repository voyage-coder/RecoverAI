import { useState } from "react";
import { AlertTriangle, Loader2, Play } from "lucide-react";
import StatusBadge from "./StatusBadge";
import { formatINR } from "../utils/format";
import { toLabel } from "../utils/labels";
import { resolveActionStateLabel } from "../utils/customerJourney";

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

  const strategy =
    pendingAction?.action_type ||
    recoveryCase?.selected_strategy ||
    null;

  const actionState = resolveActionStateLabel({
    action: pendingAction || blockedAction || latestExecuted,
    awaitingCustomerPayment,
  });

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
          Case is {toLabel(caseStatus)}. Recovery state comes from the backend
          only.
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
          There is no Force Recover / Mark Paid control. Recovery still requires
          a verified Razorpay webhook if a TEST order is awaiting payment.
        </p>
        {awaitingCustomerPayment && (
          <p className="mt-3 text-sm font-medium text-sand">
            Customer payment required — awaiting verified webhook.
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
              Action blocked by Safety Engine
            </p>
            <p className="mt-2 text-sm text-ink-mute">
              {blockedAction.result_text ||
                "Safety policy blocked this recovery action."}
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              The frontend cannot bypass Safety Engine decisions.
            </p>
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
          Awaiting customer payment
        </h4>
        <p className="mt-2 text-sm text-ink-mute">
          Merchant already initiated recovery. The customer must complete
          payment. Razorpay sends payment.captured; RecoverAI marks recovered
          only after signature verification.
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
          No pending recovery action right now. Use Prepare next recovery action
          only when the case is not awaiting customer payment.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[18px] border border-pine/25 bg-pine-soft/35 p-5 sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pine">
        Recommended Action
      </p>
      <h4 className="mt-2 font-display text-2xl font-medium text-ink">
        {toLabel(strategy)}
      </h4>
      <p className="mt-2 text-sm text-ink-mute">
        RecoverAI recommends this action based on the current diagnosis and
        recovery strategy. Nothing runs until you execute it.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-ink/8 bg-white/70 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Amount at risk
          </p>
          <p className="mt-1 font-mono text-sm text-ink">
            {formatINR(recoveryCase?.amount_at_risk)}
          </p>
        </div>
        <div className="rounded-xl border border-ink/8 bg-white/70 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Strategy
          </p>
          <p className="mt-1 text-sm text-ink">{toLabel(strategy)}</p>
        </div>
        <div className="rounded-xl border border-ink/8 bg-white/70 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Risk
          </p>
          <p className="mt-1">
            <StatusBadge value={recoveryCase?.risk_level} />
          </p>
        </div>
      </div>

      {actionState && (
        <div className="mt-3">
          <StatusBadge value={actionState} label={actionState} />
        </div>
      )}

      {!confirming ? (
        <button
          type="button"
          disabled={operating}
          onClick={() => setConfirming(true)}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-soft disabled:opacity-60"
        >
          <Play size={15} />
          Execute recommended action
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
            This action will be recorded in the recovery audit trail and must
            pass the Safety Engine. Customer details are shown only when the
            backend provides them.
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
