import { toLabel } from "../utils/labels";
import { EmptyState } from "./LoadingState";

const BAR_COLORS = [
  "bg-pine",
  "bg-skyline",
  "bg-sand",
  "bg-ink-soft",
  "bg-clay",
  "bg-pine-mid",
];

function FailureChart({ data = [] }) {
  if (!data.length) {
    return <EmptyState message="No failure category data available." />;
  }

  const maxCount = Math.max(...data.map((item) => item.count || 0), 1);
  const total = data.reduce((sum, item) => sum + (item.count || 0), 0);

  return (
    <div className="space-y-5">
      {data.map((item, index) => {
        const count = item.count || 0;
        const width = `${Math.max((count / maxCount) * 100, 6)}%`;
        const share = total > 0 ? Math.round((count / total) * 100) : 0;

        return (
          <div key={item.category || index} className="group">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink">
                {toLabel(item.category)}
              </span>
              <span className="font-mono text-xs text-ink-faint">
                {count}
                <span className="mx-1 text-ink/20">·</span>
                {share}% of failures
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-mist-deep/70">
              <div
                className={`h-full rounded-full ${BAR_COLORS[index % BAR_COLORS.length]} transition-all duration-700 group-hover:brightness-110`}
                style={{ width }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default FailureChart;
