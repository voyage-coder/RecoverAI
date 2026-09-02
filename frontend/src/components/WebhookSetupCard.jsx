import { useState } from "react";
import { Check, Copy } from "lucide-react";

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="rounded-xl border border-ink/8 bg-mist-soft/60 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <code className="break-all font-mono text-xs text-ink">{value}</code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink/10 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-ink transition hover:border-pine/30 hover:text-pine"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function WebhookSetupCard({ status }) {
  const path = status?.webhook_path || "/api/webhooks/razorpay";
  const publicBase = status?.public_base_url;
  const fullUrl = publicBase
    ? `${publicBase.replace(/\/$/, "")}${path}`
    : null;

  return (
    <div className="rounded-[18px] border border-ink/10 bg-white p-5 sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Razorpay webhook
      </p>
      <h3 className="mt-2 font-display text-xl font-medium text-ink">
        Where to send events
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-mute">
        In Razorpay, subscribe to payment failed and payment captured, then
        paste this URL. Recovery is confirmed only after a verified capture.
      </p>

      <div className="mt-5">
        {fullUrl ? (
          <CopyField label="Webhook URL" value={fullUrl} />
        ) : (
          <p className="text-sm text-ink-mute">
            Set your public RecoverAI URL in configuration to show a
            copyable webhook address here.
          </p>
        )}
      </div>
    </div>
  );
}

export default WebhookSetupCard;
