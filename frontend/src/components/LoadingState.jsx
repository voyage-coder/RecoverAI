import { Loader2, AlertTriangle, Inbox } from "lucide-react";

function LoadingState({ message = "Loading..." }) {
  return (
    <div className="panel flex min-h-[300px] flex-col items-center justify-center gap-4 p-8">
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-full bg-pine/20" />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-pine-soft">
          <Loader2 className="h-5 w-5 animate-spin text-pine" />
        </div>
      </div>
      <p className="text-sm font-medium text-ink-mute">{message}</p>
    </div>
  );
}

export function ErrorState({
  message = "Unable to connect to RecoverAI API.",
  detail = "Make sure the FastAPI backend is running on port 8000.",
}) {
  return (
    <div className="rounded-panel border border-clay/20 bg-clay-soft/60 p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-clay shadow-panel">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-clay">{message}</p>
          {detail && (
            <p className="mt-1.5 text-xs leading-relaxed text-ink-mute">{detail}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ message = "No data found." }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-panel border border-dashed border-ink/15 bg-mist-soft/60 px-6 py-10">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-ink-faint shadow-panel">
        <Inbox className="h-4 w-4" />
      </div>
      <p className="text-sm text-ink-mute">{message}</p>
    </div>
  );
}

export default LoadingState;
