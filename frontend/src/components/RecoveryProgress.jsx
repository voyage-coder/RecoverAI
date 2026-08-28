import { formatINR, formatPercent } from "../utils/format";
import { EmptyState } from "./LoadingState";

/**
 * Shows how much money was recovered vs how much was still exposed.
 * All values come from the API (paise → ₹ via formatINR).
 */
function RecoveryProgress({
  amountAtRisk = 0,
  amountRecovered = 0,
  recoveryRate = 0,
}) {
  const atRisk = Number(amountAtRisk) || 0;
  const recovered = Number(amountRecovered) || 0;
  const stillAtRisk = Math.max(atRisk - recovered, 0);
  const rate = Number(recoveryRate) || 0;
  const clamped = Math.min(Math.max(rate, 0), 100);

  if (atRisk === 0 && recovered === 0) {
    return (
      <EmptyState message="No recovery amounts to display yet." />
    );
  }

  return (
    <div className="space-y-7">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-pine-soft/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pine">
            Amount Recovered
          </p>
          <p className="mt-2 font-mono text-lg font-medium text-pine">
            {formatINR(recovered)}
          </p>
          <p className="mt-1 text-[11px] text-ink-mute">
            Money successfully brought back
          </p>
        </div>
        <div className="rounded-2xl bg-mist-soft p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Still At Risk
          </p>
          <p className="mt-2 font-mono text-lg font-medium text-ink">
            {formatINR(stillAtRisk)}
          </p>
          <p className="mt-1 text-[11px] text-ink-mute">
            Exposure not yet recovered
          </p>
        </div>
        <div className="rounded-2xl bg-skyline-soft/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-skyline">
            Recovery Rate
          </p>
          <p className="mt-2 font-mono text-lg font-medium text-ink">
            {formatPercent(rate)}
          </p>
          <p className="mt-1 text-[11px] text-ink-mute">
            Recovered ÷ total at risk
          </p>
        </div>
      </div>

      <div>
        <div className="mb-2.5 flex items-center justify-between text-xs">
          <span className="font-medium text-ink-mute">
            Share of exposure recovered
          </span>
          <span className="font-mono text-ink">{formatPercent(rate)}</span>
        </div>
        <div className="relative h-3.5 overflow-hidden rounded-full bg-mist-deep/80">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-pine transition-all duration-700"
            style={{ width: `${clamped}%` }}
          />
        </div>
        <div className="mt-2.5 flex justify-between font-mono text-[10px] text-ink-faint">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-mute">
          Total at risk in pipeline:{" "}
          <span className="font-mono text-ink">{formatINR(atRisk)}</span>
        </p>
      </div>
    </div>
  );
}

export default RecoveryProgress;
