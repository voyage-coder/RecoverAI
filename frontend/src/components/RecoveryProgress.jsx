import { formatINR, formatPercent } from "../utils/format";

function RecoveryProgress({
  amountAtRisk = 0,
  amountRecovered = 0,
  recoveryRate = 0,
}) {
  const rate = Number(recoveryRate) || 0;
  const clamped = Math.min(Math.max(rate, 0), 100);

  return (
    <div className="space-y-7">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-mist-soft p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Amount at Risk
          </p>
          <p className="mt-2 font-mono text-lg font-medium text-ink">
            {formatINR(amountAtRisk)}
          </p>
        </div>
        <div className="rounded-2xl bg-pine-soft/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pine">
            Amount Recovered
          </p>
          <p className="mt-2 font-mono text-lg font-medium text-pine">
            {formatINR(amountRecovered)}
          </p>
        </div>
        <div className="rounded-2xl bg-skyline-soft/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-skyline">
            Recovery Rate
          </p>
          <p className="mt-2 font-mono text-lg font-medium text-ink">
            {formatPercent(recoveryRate)}
          </p>
        </div>
      </div>

      <div>
        <div className="mb-2.5 flex items-center justify-between text-xs">
          <span className="font-medium text-ink-mute">Recovery performance</span>
          <span className="font-mono text-ink">{formatPercent(recoveryRate)}</span>
        </div>
        <div className="relative h-3.5 overflow-hidden rounded-full bg-mist-deep/80">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-pine to-pine-mid transition-all duration-700"
            style={{ width: `${clamped}%` }}
          />
        </div>
        <div className="mt-2.5 flex justify-between font-mono text-[10px] text-ink-faint">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
    </div>
  );
}

export default RecoveryProgress;
