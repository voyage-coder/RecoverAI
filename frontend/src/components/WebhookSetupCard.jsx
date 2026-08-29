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
    : `<YOUR_PUBLIC_BACKEND_URL>${path}`;
  const failurePath =
    status?.failure_ingestion_path || "/api/events/payment";

  return (
    <div className="rounded-[18px] border border-ink/10 bg-white p-5 sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Webhook configuration
      </p>
      <h3 className="mt-2 font-display text-xl font-medium text-ink">
        How RecoverAI receives events
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-mute">
        RecoverAI receives payment lifecycle events from the payment provider.
        The verified Razorpay webhook confirms capture. Failure ingestion for
        demos uses a provider-neutral event API.
      </p>

      <div className="mt-5 space-y-3">
        <div className="rounded-xl border border-pine/15 bg-pine-soft/30 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-pine">
            Recovery confirmation
          </p>
          <p className="mt-1 text-sm text-ink">
            Supported webhook event:{" "}
            <span className="font-mono text-xs">payment.captured</span>
          </p>
        </div>
        <div className="rounded-xl border border-sand/25 bg-sand-soft/40 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-sand">
            Recovery trigger (demo / provider-neutral)
          </p>
          <p className="mt-1 text-sm text-ink">
            <span className="font-mono text-xs">POST {failurePath}</span>
            {" — "}
            simulated payment failure ingestion (not a Razorpay webhook)
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <CopyField label="Webhook path" value={path} />
        <CopyField label="Webhook URL to configure" value={fullUrl} />
        <CopyField label="Failure event ingestion" value={failurePath} />
      </div>

      {!publicBase && (
        <p className="mt-3 text-xs text-ink-faint">
          No public backend URL is configured in RecoverAI. Replace the
          placeholder with your tunnel (e.g. ngrok) when setting the Razorpay
          Dashboard webhook. Do not invent a public URL.
        </p>
      )}

      <p className="mt-3 text-xs text-ink-faint">
        Webhook secrets stay in backend environment variables and are never
        shown here.
      </p>
    </div>
  );
}

export default WebhookSetupCard;
