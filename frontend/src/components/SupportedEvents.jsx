function SupportedEvents() {
  return (
    <div className="rounded-[18px] border border-ink/10 bg-white p-5 sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Supported events
      </p>
      <h3 className="mt-2 font-display text-xl font-medium text-ink">
        What RecoverAI handles
      </h3>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-sand/25 bg-sand-soft/35 px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-sand">
            Recovery trigger
          </p>
          <p className="mt-2 font-mono text-sm font-semibold text-ink">
            payment.failed
          </p>
          <p className="mt-2 text-sm text-ink-mute">
            Starts the revenue recovery workflow — diagnosis, strategy, Safety
            Engine, and a pending recovery action.
          </p>
          <p className="mt-3 text-xs font-medium text-ink">
            Does NOT mean recovered.
          </p>
        </div>

        <div className="rounded-xl border border-pine/20 bg-pine-soft/35 px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-pine">
            Recovery confirmation
          </p>
          <p className="mt-2 font-mono text-sm font-semibold text-ink">
            payment.captured
          </p>
          <p className="mt-2 text-sm text-ink-mute">
            Verified payment confirmation from Razorpay. RecoverAI marks the
            case recovered only after signature verification on the backend.
          </p>
          <p className="mt-3 text-xs font-medium text-ink">
            Does NOT come from the frontend checkout handler.
          </p>
        </div>
      </div>

      <p className="mt-4 text-sm text-ink-mute">
        <span className="font-semibold text-ink">RECOVERED</span> is only set by
        the verified backend webhook flow — never by Checkout.js success alone.
      </p>
    </div>
  );
}

export default SupportedEvents;
