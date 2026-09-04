import { Loader2 } from "lucide-react";

function AgentRunningBanner({ visible, compact = false }) {
  if (!visible) return null;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-sand/35 bg-sand-soft/60 ${
        compact ? "px-3 py-2" : "px-4 py-3"
      }`}
      role="status"
      aria-live="polite"
    >
      <Loader2
        size={compact ? 16 : 18}
        className="shrink-0 animate-spin text-sand"
      />
      <div>
        <p className="text-sm font-semibold text-ink">Agent is running</p>
        {!compact && (
          <p className="mt-0.5 text-xs text-ink-mute">
            Analyzing this case and sending every allowed action. This can
            take a couple of minutes. Do not click Run Agent again — refresh
            if you need an update.
          </p>
        )}
      </div>
    </div>
  );
}

export default AgentRunningBanner;
