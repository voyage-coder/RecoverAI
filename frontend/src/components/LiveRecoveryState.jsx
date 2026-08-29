function LiveRecoveryState({ rows = [] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((row) => (
        <div
          key={row.key}
          className="rounded-xl border border-ink/8 bg-white px-4 py-3"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            {row.label}
          </p>
          <p className="mt-1.5 text-sm font-medium text-ink break-words">
            {row.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export default LiveRecoveryState;
