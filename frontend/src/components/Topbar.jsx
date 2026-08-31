import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Menu } from "lucide-react";
import NotificationBell from "./NotificationBell";

function Topbar({ onMenuClick }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const handleSearch = (event) => {
    event.preventDefault();
    const trimmed = query.trim();
    navigate(trimmed ? `/cases?q=${encodeURIComponent(trimmed)}` : "/cases");
  };

  return (
    <header className="fixed left-0 right-0 top-0 z-30 flex h-[4.5rem] items-center justify-between border-b border-ink/10 bg-white/70 px-4 backdrop-blur-xl lg:left-[17.5rem] lg:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          className="rounded-xl p-2 text-ink-mute hover:bg-mist hover:text-ink lg:hidden"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>

        <form
          onSubmit={handleSearch}
          className="flex w-full max-w-lg items-center gap-2.5 rounded-2xl border border-ink/10 bg-mist-soft px-3.5 py-2.5 transition focus-within:border-pine/30 focus-within:bg-white focus-within:ring-4 focus-within:ring-pine/10"
        >
          <Search size={16} className="shrink-0 text-ink-faint" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search recovery cases…"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <kbd className="hidden rounded-md border border-ink/10 bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-faint sm:inline">
            /
          </kbd>
        </form>
      </div>

      <div className="ml-4 flex items-center gap-3 sm:gap-4">
        <NotificationBell />

        <div className="hidden h-8 w-px bg-ink/10 sm:block" />

        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-ink to-ink-soft font-medium text-sm text-white">
            N
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-semibold text-ink">Navya</p>
            <p className="text-[11px] text-ink-faint">Recovery Admin</p>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Topbar;
