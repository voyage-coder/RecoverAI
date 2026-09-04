import { Loader2, Sparkles } from "lucide-react";
import { runAgentButtonLabel } from "../utils/recoveryMode";

function RunAgentButton({
  running = false,
  again = false,
  onClick,
  className = "",
}) {
  return (
    <button
      type="button"
      disabled={running}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!running) onClick?.(event);
      }}
      className={`inline-flex items-center gap-2 rounded-xl bg-pine px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-pine/90 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {running ? (
        <Loader2 size={15} className="animate-spin" />
      ) : (
        <Sparkles size={15} />
      )}
      {runAgentButtonLabel({ running, again })}
    </button>
  );
}

export default RunAgentButton;
