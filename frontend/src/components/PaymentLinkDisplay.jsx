import { ExternalLink } from "lucide-react";

function PaymentLinkDisplay({ url, compact = false }) {
  if (!url) return null;

  return (
    <div
      className={
        compact
          ? "mt-3"
          : "rounded-2xl border border-pine/20 bg-pine-soft/30 p-4"
      }
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-pine">
        Customer payment link
      </p>
      {!compact && (
        <p className="mt-1 text-sm text-ink-mute">
          Customer can use this link to complete payment.
        </p>
      )}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-2 rounded-xl border border-pine/30 bg-white px-3.5 py-2 text-sm font-semibold text-pine transition hover:bg-pine-soft/50"
      >
        Click here
        <ExternalLink size={14} />
      </a>
    </div>
  );
}

export default PaymentLinkDisplay;
