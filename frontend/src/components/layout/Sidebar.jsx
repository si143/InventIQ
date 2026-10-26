import React from "react";
import { useAuth } from "../../context/AuthContext";

const navigationGroups = [
  {
    group: "OVERVIEW",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "📊" },
    ],
  },
  {
    group: "DATA",
    items: [
      { id: "datasets", label: "Datasets", icon: "📁" },
    ],
  },
  {
    group: "AI FORECASTING",
    items: [
      { id: "model-training", label: "Model Configuration", icon: "🧠" },
      { id: "forecasts", label: "Forecasts", icon: "📈" },
    ],
  },
  {
    group: "INTELLIGENCE",
    items: [
      { id: "risk-alerts", label: "Alerts & Risks", icon: "⚡" },
      { id: "recommendations", label: "Recommendations", icon: "💡" },
      { id: "dependencies", label: "Product Dependencies", icon: "🔗" },
      { id: "obsolescence", label: "Commercial Obsolescence", icon: "📉" },
      { id: "simulations", label: "Simulations", icon: "🧪" },
      { id: "recovery", label: "Waste Recovery Planner", icon: "♻️" },
    ],
  },
  {
    group: "SYSTEM",
    items: [
      { id: "settings", label: "Settings", icon: "⚙️" },
      { id: "help", label: "Help & Support", icon: "❓" },
    ],
  },
];

export default function Sidebar({
  activePage = "dashboard",
  onSelectPage,
  mobileOpen = false,
  onCloseMobile,
}) {
  const { user, logout, isAuthenticated } = useAuth();

  const handleLogout = () => {
    logout();
    window.location.href = "/";
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed lg:static top-0 left-0 z-50 h-screen lg:h-auto w-[250px] shrink-0 bg-white dark:bg-[#211E35] border-r border-slate-200/80 dark:border-[#2E2A4A] flex flex-col justify-between transition-transform duration-300 ease-in-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } lg:rounded-[24px] lg:my-3 lg:ml-3 lg:border shadow-sm dark:shadow-none`}
      >
        <div className="p-5 overflow-y-auto flex-1 custom-scrollbar">
          {/* Brand Header */}
          <div className="flex items-center gap-3 pb-6 border-b border-slate-100 dark:border-[#2E2A4A]/80">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-[#D946A8] to-[#7C5CFC] text-white font-extrabold text-xl shadow-md shadow-[#D946A8]/20">
              I
            </div>
            <div>
              <div className="text-lg font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5">
                InventIQ
                <span className="h-1.5 w-1.5 rounded-full bg-[#D946A8] animate-pulse" />
              </div>
              <div className="text-[11px] font-medium text-slate-400 dark:text-slate-400 tracking-wide">
                AI Inventory Intelligence
              </div>
            </div>
          </div>

          {/* Navigation Groups */}
          <nav className="mt-5 space-y-5">
            {navigationGroups.map((group) => (
              <div key={group.group}>
                <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                  {group.group}
                </div>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const isActive = activePage === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onSelectPage(item.id);
                          if (onCloseMobile) onCloseMobile();
                        }}
                        className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                          isActive
                            ? "bg-gradient-to-r from-[#FCE7F3] to-[#EDE9FE] dark:from-[#D946A8]/20 dark:to-[#7C5CFC]/20 text-[#D946A8] dark:text-[#f472c1] shadow-xs"
                            : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-[#27233D] hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <span className="text-sm opacity-80">{item.icon}</span>
                          <span className="truncate">{item.label}</span>
                        </div>
                        {isActive && (
                          <span className="h-2 w-2 rounded-full bg-[#D946A8] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {/* Bottom User Card */}
        <div className="p-4 border-t border-slate-100 dark:border-[#2E2A4A]/80 bg-slate-50/50 dark:bg-[#171525]/30 lg:rounded-b-[24px]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-[#7C5CFC] to-[#D946A8] text-white text-xs font-bold">
                {user?.name?.charAt(0)?.toUpperCase() || "G"}
              </div>
              <div className="truncate">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                  {user?.name || "Guest"}
                </p>
                <p className="text-[10px] text-slate-400 dark:text-slate-400 truncate">
                  {user?.email || ""}
                </p>
              </div>
            </div>
            {isAuthenticated && (
              <button
                type="button"
                onClick={handleLogout}
                className="text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-semibold"
              >
                Logout
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
