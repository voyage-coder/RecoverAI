function OriginBadges({
  eventSource,
  eventSourceLabel,
  outcomeKind,
  webhookAuthorityLabel,
  recovered,
}) {
  const source = String(eventSource || "").toUpperCase();
  const live = source === "LIVE_PROVIDER";
  const confirmed =
    recovered ||
    String(outcomeKind || "").toUpperCase() === "CONFIRMED_RECOVERY";

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
          live
            ? "bg-pine-soft text-pine"
            : "bg-sand-soft text-sand"
        }`}
      >
        {live
          ? eventSourceLabel || "LIVE_PROVIDER"
          : eventSourceLabel || "DEMO / SIMULATED"}
      </span>
      {confirmed ? (
        <span className="rounded-lg bg-pine-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pine">
          {webhookAuthorityLabel || "Verified by Razorpay webhook"}
        </span>
      ) : null}
      <span
        className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
          confirmed
            ? "bg-pine-soft text-pine"
            : "bg-skyline-soft text-skyline"
        }`}
      >
        {confirmed ? "Payment successfully recovered" : "AI prediction"}
      </span>
    </span>
  );
}

export default OriginBadges;
