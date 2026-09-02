import { Link, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  CreditCard,
  BarChart3,
  Activity,
  Settings,
  Briefcase,
  Radio,
  Plug,
  Terminal,
  HeartPulse,
  X,
} from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, end: true },
  { name: "Recovery Cases", href: "/cases", icon: CreditCard, end: true },
  { name: "Create demo event", href: "/event-console", icon: Terminal },
  { name: "Live Activity", href: "/live-activity", icon: Radio },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Operations", href: "/operations", icon: Briefcase },
  { name: "Connect payments", href: "/integrations", icon: Plug },
  { name: "Demo health", href: "/demo-health", icon: HeartPulse },
  { name: "Activity", href: "/activity", icon: Activity },
  { name: "Settings", href: "/settings", icon: Settings, end: true },
];

function Sidebar({ open, onClose }) {
  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-[17.5rem] flex-col border-r border-ink/10 bg-white/85 backdrop-blur-xl transition-transform duration-300 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-[4.5rem] items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-ink text-white">
              <span className="font-display text-lg italic leading-none">R</span>
              <span className="absolute -bottom-3 -right-3 h-8 w-8 rounded-full bg-pine/40 blur-md" />
            </div>
            <div>
              <h1 className="font-display text-[1.35rem] font-medium leading-none tracking-tight text-ink">
                RecoverAI
              </h1>
              <p className="mt-1 text-[11px] font-medium tracking-wide text-ink-faint">
                Payment recovery desk
              </p>
            </div>
          </Link>

          <button
            type="button"
            className="rounded-lg p-2 text-ink-mute hover:bg-mist lg:hidden"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-6 pt-2">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-faint">
            Workspace
          </p>

          {navigation.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.name}
                to={item.href}
                end={item.end}
                onClick={onClose}
                className={({ isActive }) =>
                  `group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium outline-none ring-0 transition ${
                    isActive
                      ? "bg-ink text-white shadow-panel"
                      : "text-ink-soft hover:bg-mist hover:text-ink"
                  }`
                }
              >
                <Icon
                  size={17}
                  strokeWidth={1.75}
                  className="shrink-0 opacity-80"
                />
                <span>{item.name}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-ink/10 p-4">
          <div className="rounded-2xl bg-gradient-to-br from-pine-soft to-skyline-soft p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pine">
              Live desk
            </p>
            <p className="mt-2 text-sm font-medium text-ink">
              All recovery systems clear
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pine opacity-40" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-pine" />
              </span>
              <span className="text-xs text-ink-mute">Synced with API</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
