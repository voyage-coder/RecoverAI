import { Link } from "react-router-dom";
import {
  ArrowRight,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  Zap,
  BarChart3,
  Settings2,
  SlidersHorizontal,
  Plug,
  Briefcase,
  Brain,
  MessageSquare,
  Webhook,
  Lock,
} from "lucide-react";
import { WORKSPACE_SHORTCUTS } from "../utils/workspaceShortcuts";

function BrandMark({ size = "md" }) {
  const box = size === "lg" ? "h-12 w-12 text-xl" : "h-10 w-10 text-lg";
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-2xl bg-ink text-white ${box}`}
    >
      <span className="font-display italic leading-none">R</span>
      <span className="absolute -bottom-3 -right-3 h-8 w-8 rounded-full bg-pine/40 blur-md" />
    </div>
  );
}

const NAV = [
  { href: "#product", label: "Product" },
  { href: "#settings", label: "Settings" },
  { href: "#analytics", label: "Analytics" },
  { href: "#how", label: "How it works" },
];

const CAPABILITIES = [
  {
    to: "/settings",
    title: "Choose how recovery runs",
    blurb:
      "Manual, or run the agent on every allowed case — with a rupee cap so high-value stays with you.",
    icon: SlidersHorizontal,
    tone: "bg-sand-soft text-sand",
  },
  {
    to: "/analytics",
    title: "See what actually recovered",
    blurb:
      "Funnel, failure mix, and recovery rate. Charts show share of failures — not a fake 100% win rate.",
    icon: BarChart3,
    tone: "bg-skyline-soft text-skyline",
  },
  {
    to: "/operations",
    title: "Run the recovery desk",
    blurb:
      "In recovery, recovered, escalated, and stopped — plus approve or execute the next safe action.",
    icon: Briefcase,
    tone: "bg-pine-soft text-pine",
  },
  {
    to: "/integrations",
    title: "Connect Razorpay Test",
    blurb:
      "Keys and webhook URL in one place. Failed payments become cases; captures become recovered rupees.",
    icon: Plug,
    tone: "bg-ink text-white",
  },
];

function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden text-ink">
      <div className="pointer-events-none absolute -left-24 top-0 h-80 w-80 rounded-full bg-pine/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-24 h-72 w-72 rounded-full bg-skyline/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-56 w-56 rounded-full bg-sand/10 blur-3xl" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
        <Link to="/" className="flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="font-display text-[1.35rem] font-medium leading-none tracking-tight">
              RecoverAI
            </p>
            <p className="mt-1 text-[11px] font-medium tracking-wide text-ink-faint">
              Payment recovery desk
            </p>
          </div>
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-ink-mute md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="transition hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <Link
          to="/dashboard"
          className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-soft"
        >
          Open desk
        </Link>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-8 sm:pt-14">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          <div className="page-enter">
            <p className="eyebrow">AI payment recovery</p>
            <h1 className="mt-4 max-w-xl font-display text-4xl font-medium leading-[1.12] tracking-tight sm:text-5xl lg:text-[3.35rem]">
              Bring failed revenue back — safely, and only when it is real.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-ink-mute">
              RecoverAI finds failed Razorpay payments, ranks the next recovery
              move with ML, lets you choose Manual or Run agent on every case
              in Settings, and counts rupees only after a verified capture.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink-soft"
              >
                Go to dashboard
                <ArrowRight size={16} />
              </Link>
              <Link
                to="/analytics"
                className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink shadow-panel transition hover:border-skyline/40 hover:text-skyline"
              >
                <BarChart3 size={16} />
                View analytics
              </Link>
              <Link
                to="/settings"
                className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink shadow-panel transition hover:border-sand/40 hover:text-sand"
              >
                <Settings2 size={16} />
                Recovery settings
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap gap-6 text-sm">
              <p className="flex items-center gap-2 text-ink-soft">
                <ShieldCheck size={16} className="text-pine" />
                Safety rules before every action
              </p>
              <p className="flex items-center gap-2 text-ink-soft">
                <CheckCircle2 size={16} className="text-pine" />
                Recovered only after verified capture
              </p>
            </div>
          </div>

          <div className="page-enter">
            <div className="relative">
              <div className="absolute -inset-3 rounded-[28px] bg-gradient-to-br from-pine/15 via-skyline/10 to-sand/15 blur-xl" />
              <div className="relative overflow-hidden rounded-[22px] border border-ink/10 bg-white/90 shadow-lift backdrop-blur-xl">
                <div className="flex items-center justify-between border-b border-ink/8 bg-mist-soft/70 px-5 py-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                      Recovery Operations
                    </p>
                    <p className="mt-1 font-display text-xl font-medium">
                      Dashboard
                    </p>
                  </div>
                  <span className="rounded-full bg-pine-soft px-3 py-1 text-[11px] font-semibold text-pine">
                    Live desk
                  </span>
                </div>
                <div className="grid gap-2 p-4 sm:grid-cols-2">
                  {WORKSPACE_SHORTCUTS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className="flex items-center gap-3 rounded-xl border border-ink/8 bg-white px-3 py-2.5 transition hover:-translate-y-0.5 hover:border-ink/15 hover:shadow-panel"
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.tone}`}
                        >
                          <Icon size={16} />
                        </span>
                        <span>
                          <span className="block text-sm font-semibold text-ink">
                            {item.title}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-ink-mute">
                            {item.blurb}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <section id="product" className="mt-24 scroll-mt-24">
          <p className="eyebrow">What you can do</p>
          <h2 className="page-title">A full recovery desk — not a chatbot</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-mute">
            Connect payments, tune policy, watch cases, and prove recovered
            rupees. ML ranks strategies. Gemini only writes the customer
            message.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {CAPABILITIES.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="group flex h-full items-start gap-4 rounded-panel border border-ink/10 bg-gradient-to-br from-white to-mist-soft p-5 shadow-panel transition duration-300 hover:-translate-y-0.5 hover:shadow-lift"
                  >
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${item.tone}`}
                    >
                      <Icon size={18} />
                    </span>
                    <span>
                      <span className="flex items-center gap-2 font-display text-lg font-medium text-ink">
                        {item.title}
                        <ArrowRight
                          size={14}
                          className="text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-pine"
                        />
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-ink-mute">
                        {item.blurb}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section
          id="settings"
          className="mt-20 grid scroll-mt-24 items-stretch gap-6 lg:grid-cols-2"
        >
          <div className="flex flex-col justify-center">
            <p className="eyebrow">Settings</p>
            <h2 className="page-title">Pick Manual or run the agent</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-mute">
              Two modes. Safety Engine still blocks unsafe actions. The agent
              never marks recovered — only Razorpay can.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              <li className="rounded-xl border border-ink/10 bg-white px-4 py-3 shadow-panel">
                <span className="font-semibold text-ink">Manual</span>
                <span className="mt-0.5 block text-ink-mute">
                  You Execute each action from the case or Operations. Timeline
                  tags it Manual.
                </span>
              </li>
              <li className="rounded-xl border border-pine/20 bg-pine-soft/40 px-4 py-3">
                <span className="font-semibold text-pine">
                  Run agent on every case
                </span>
                <span className="mt-0.5 block text-ink-mute">
                  After save, the agent processes every open case still allowed
                  (under cap, not escalated, Safety allows). Tagged Agent.
                  Default cap ₹5,000. High-value (₹10,000) still needs you.
                </span>
              </li>
            </ul>
            <Link
              to="/settings"
              className="mt-6 inline-flex w-fit items-center gap-2 text-sm font-semibold text-pine hover:underline"
            >
              Open Settings
              <ArrowRight size={14} />
            </Link>
          </div>

          <div className="rounded-[22px] border border-ink/10 bg-white p-5 shadow-lift">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                Policy preview
              </p>
              <span className="rounded-full bg-mist px-2.5 py-0.5 text-[10px] font-semibold text-ink-mute">
                Same as /settings
              </span>
            </div>
            <p className="mt-2 font-display text-xl font-medium">
              Recovery mode
            </p>
            <div className="mt-4 grid gap-2">
              {["Manual", "Run agent on every case"].map(
                (mode, index) => (
                  <div
                    key={mode}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
                      index === 0
                        ? "border-ink bg-ink text-white"
                        : "border-ink/10 text-ink-mute"
                    }`}
                  >
                    <span className="font-semibold">{mode}</span>
                    {index === 0 ? (
                      <span className="text-[11px] opacity-80">Default</span>
                    ) : null}
                  </div>
                )
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-mist-soft px-3 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  Agent cap
                </p>
                <p className="mt-1 font-display text-lg">₹5,000</p>
              </div>
              <div className="rounded-xl bg-mist-soft px-3 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  High-value
                </p>
                <p className="mt-1 font-display text-lg">₹10,000</p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="analytics"
          className="mt-20 grid scroll-mt-24 items-stretch gap-6 lg:grid-cols-2"
        >
          <div className="order-2 rounded-[22px] border border-ink/10 bg-white p-5 shadow-lift lg:order-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                Analytics preview
              </p>
              <span className="rounded-full bg-skyline-soft px-2.5 py-0.5 text-[10px] font-semibold text-skyline">
                Live numbers on /analytics
              </span>
            </div>
            <p className="mt-2 font-display text-xl font-medium">
              Verified recovery, not a vanity chart
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { label: "At risk", hint: "Open failed amount" },
                { label: "In recovery", hint: "Active cases" },
                { label: "Recovered", hint: "Webhook-only" },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border border-ink/8 bg-mist-soft/80 px-2 py-3 text-center"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                    {card.label}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-mute">{card.hint}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {[
                { name: "Technical failure", width: "w-[72%]" },
                { name: "Insufficient funds", width: "w-[48%]" },
                { name: "Card declined", width: "w-[31%]" },
              ].map((row) => (
                <div key={row.name}>
                  <div className="mb-1 flex justify-between text-[11px] text-ink-mute">
                    <span>{row.name}</span>
                    <span>% of failures</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-mist">
                    <div
                      className={`h-full rounded-full bg-skyline ${row.width}`}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
              Illustrative bars. Real recovery rate is recovered cases ÷ all
              cases — never the share of one failure type.
            </p>
          </div>

          <div className="order-1 flex flex-col justify-center lg:order-2">
            <p className="eyebrow">Analytics</p>
            <h2 className="page-title">Know what came back</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-mute">
              The analytics page is built for operators: amount at risk,
              recovery funnel, failure categories, and a rate that only moves
              when Razorpay confirms a capture.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-ink-soft">
              <li className="flex gap-2">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-pine" />
                Failure mix labeled as % of failures — not recovery rate
              </li>
              <li className="flex gap-2">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-pine" />
                Batch demo measures recovered rupees through the same pipeline
              </li>
              <li className="flex gap-2">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-pine" />
                Case audit export (CSV + PDF) when you need a paper trail
              </li>
            </ul>
            <Link
              to="/analytics"
              className="mt-6 inline-flex w-fit items-center gap-2 text-sm font-semibold text-skyline hover:underline"
            >
              Open Analytics
              <ArrowRight size={14} />
            </Link>
          </div>
        </section>

        <section id="how" className="mt-20 scroll-mt-24">
          <p className="eyebrow">How it works</p>
          <h2 className="page-title">From failed charge to verified rupee</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              {
                step: "01",
                title: "Detect",
                body: "Ingest payment.failed or a demo event.",
                icon: Zap,
                tone: "bg-sand-soft text-sand",
              },
              {
                step: "02",
                title: "Rank",
                body: "Logistic Regression scores each strategy.",
                icon: Brain,
                tone: "bg-pine-soft text-pine",
              },
              {
                step: "03",
                title: "Gate",
                body: "Safety Engine + Manual or Run agent on every case.",
                icon: Lock,
                tone: "bg-ink text-white",
              },
              {
                step: "04",
                title: "Message",
                body: "Gemini 2.0 Flash writes copy around a real link.",
                icon: MessageSquare,
                tone: "bg-sand-soft text-sand",
              },
              {
                step: "05",
                title: "Prove",
                body: "Recovered only after signed payment.captured.",
                icon: Webhook,
                tone: "bg-skyline-soft text-skyline",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.step}
                  className="rounded-panel border border-ink/10 bg-white p-5 shadow-panel"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-2xl ${item.tone}`}
                    >
                      <Icon size={18} />
                    </span>
                    <span className="font-mono text-xs text-ink-faint">
                      {item.step}
                    </span>
                  </div>
                  <h3 className="mt-4 font-display text-lg font-medium text-ink">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-mute">
                    {item.body}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-20">
          <p className="eyebrow">Same workspace as the desk</p>
          <h2 className="page-title">Open any surface from here</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-mute">
            Icons and colors match the dashboard shortcuts, so the landing page
            and the recovery desk feel like one product.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {WORKSPACE_SHORTCUTS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="group flex h-full items-start gap-4 rounded-panel border border-ink/10 bg-gradient-to-br from-white to-mist-soft p-5 shadow-panel transition duration-300 hover:-translate-y-0.5 hover:shadow-lift"
                  >
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${item.tone}`}
                    >
                      <Icon size={18} />
                    </span>
                    <span>
                      <span className="flex items-center gap-2 font-display text-lg font-medium text-ink">
                        {item.title}
                        <ArrowRight
                          size={14}
                          className="text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-pine"
                        />
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-ink-mute">
                        {item.blurb}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
            <li>
              <Link
                to="/settings"
                className="group flex h-full items-start gap-4 rounded-panel border border-ink/10 bg-gradient-to-br from-white to-mist-soft p-5 shadow-panel transition duration-300 hover:-translate-y-0.5 hover:shadow-lift"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sand-soft text-sand">
                  <Settings2 size={18} />
                </span>
                <span>
                  <span className="flex items-center gap-2 font-display text-lg font-medium text-ink">
                    Settings
                    <ArrowRight
                      size={14}
                      className="text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-pine"
                    />
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-ink-mute">
                    Choose Manual or Run agent on every case. Set the rupee cap.
                  </span>
                </span>
              </Link>
            </li>
          </ul>
        </section>

        <section className="mt-16 overflow-hidden rounded-[22px] border border-ink/10 bg-ink px-8 py-10 text-white shadow-lift">
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
                Ready when you are
              </p>
              <h2 className="mt-2 font-display text-3xl font-medium tracking-tight">
                Open the desk. Recover what failed.
              </h2>
              <p className="mt-2 max-w-lg text-sm text-white/70">
                Create a demo failure, connect Razorpay Test, or jump straight
                to analytics.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-ink"
              >
                Open dashboard
                <ArrowRight size={16} />
              </Link>
              <Link
                to="/event-console"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white"
              >
                <Sparkles size={16} />
                Create demo event
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Landing;
