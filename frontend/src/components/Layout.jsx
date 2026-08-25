import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen text-ink">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <Topbar onMenuClick={() => setSidebarOpen(true)} />

      <main className="pt-[4.5rem] lg:ml-[17.5rem]">
        <div className="mx-auto max-w-[1380px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default Layout;
