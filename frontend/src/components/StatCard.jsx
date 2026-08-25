function StatCard({ title, value, description, tone = "default" }) {
  const tones = {
    default: "from-white to-mist-soft",
    success: "from-white to-pine-soft/60",
    warning: "from-white to-sand-soft/70",
    danger: "from-white to-clay-soft/70",
    info: "from-white to-skyline-soft/70",
  };

  return (
    <div
      className={`group relative overflow-hidden rounded-panel border border-ink/10 bg-gradient-to-br ${tones[tone] || tones.default} p-5 shadow-panel transition duration-300 hover:-translate-y-0.5 hover:shadow-lift`}
    >
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/50 blur-2xl transition group-hover:bg-white/80" />
      <p className="relative text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {title}
      </p>
      <p className="relative mt-3 font-mono text-[1.55rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">
        {value}
      </p>
      {description && (
        <p className="relative mt-2 text-xs leading-relaxed text-ink-mute">
          {description}
        </p>
      )}
    </div>
  );
}

export default StatCard;
