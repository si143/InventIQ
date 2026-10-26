import React, { useState, useEffect } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { loadSettings, resolveTheme, saveSettings } from "../../utils/settings";

export default function MainLayout({
  children,
  activePage = "dashboard",
  onSelectPage,
  onOpenUpload,
  searchTerm = "",
  onSearchChange,
  alerts = [],
  alertsLoading = false,
  alertsError = "",
  onRefreshAlerts,
}) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isDark, setIsDark] = useState(() => resolveTheme(loadSettings().appearance.theme));
  const [compact, setCompact] = useState(() => loadSettings().appearance.compactDashboard);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      localStorage.setItem("inventiq_theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("inventiq_theme", "light");
    }
  }, [isDark]);

  useEffect(() => {
    const syncTheme = () => {
      const settings = loadSettings();
      setIsDark(resolveTheme(settings.appearance.theme));
      setCompact(settings.appearance.compactDashboard);
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = (event) => {
      if (loadSettings().appearance.theme === "system") setIsDark(event.matches);
    };
    window.addEventListener("inventiq-settings-updated", syncTheme);
    media.addEventListener?.("change", syncSystemTheme);
    return () => {
      window.removeEventListener("inventiq-settings-updated", syncTheme);
      media.removeEventListener?.("change", syncSystemTheme);
    };
  }, []);

  const toggleTheme = () => {
    const settings = loadSettings();
    saveSettings({ ...settings, appearance: { ...settings.appearance, theme: isDark ? "light" : "dark" } });
  };

  return (
    <div className="min-h-screen bg-[#F7F7FA] dark:bg-[#171525] text-slate-900 dark:text-slate-100 flex flex-col lg:flex-row transition-colors duration-200">
      {/* Sidebar */}
      <Sidebar
        activePage={activePage}
        onSelectPage={onSelectPage}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      {/* Main View Container */}
      <div className={`flex-1 flex flex-col min-w-0 ${compact ? "p-3 md:p-4 lg:p-4 lg:pl-3" : "p-4 md:p-6 lg:p-6 lg:pl-4"} max-w-[1600px] mx-auto w-full`}>
        <Topbar
          pageTitle={activePage}
          onOpenUpload={onOpenUpload}
          searchTerm={searchTerm}
          onSearchChange={onSearchChange}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onToggleMobileSidebar={() => setMobileSidebarOpen((prev) => !prev)}
          alerts={alerts}
          alertsLoading={alertsLoading}
          alertsError={alertsError}
          onRefreshAlerts={onRefreshAlerts}
          onSelectPage={onSelectPage}
        />

        {/* View Content */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
