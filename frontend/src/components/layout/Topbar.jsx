import React, { useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import { useAuth } from "../../context/AuthContext";
import { loadReadNotificationIds, saveReadNotificationIds } from "../../utils/settings";

export default function Topbar({
  pageTitle = "Dashboard",
  onOpenUpload,
  searchTerm = "",
  onSearchChange,
  isDark = false,
  onToggleTheme,
  onToggleMobileSidebar,
  alerts = [],
  alertsLoading = false,
  alertsError = "",
  onRefreshAlerts,
  onSelectPage,
}) {
  const { user, logout, isAuthenticated } = useAuth();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState(() => loadReadNotificationIds(user?.id));
  const menuRoot = useRef(null);
  const menuButton = useRef(null);
  const notificationButton = useRef(null);
  const unreadAlerts = alerts.filter((alert) => !readNotificationIds.includes(String(alert.id)));
  const initials = displayInitials(user?.name || "User");

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const displayName = user?.name || "User";

  function displayInitials(name) {
    return String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "?";
  }

  const closeMenus = () => {
    setNotificationsOpen(false);
    setProfileOpen(false);
  };

  const openSettings = (section) => {
    localStorage.setItem("inventiq_pending_settings_section", section);
    window.dispatchEvent(new CustomEvent("inventiq-open-settings-section", { detail: { section } }));
    onSelectPage?.("settings");
    closeMenus();
  };

  const markRead = (alertId) => {
    setReadNotificationIds((current) => {
      return saveReadNotificationIds(user?.id, [...current, String(alertId)]);
    });
  };

  const markAllRead = () => {
    setReadNotificationIds(saveReadNotificationIds(user?.id, [...readNotificationIds, ...alerts.map((alert) => String(alert.id))]));
  };

  const confirmLogout = async () => {
    setLogoutLoading(true);
    try {
      await logout();
      setLogoutConfirmOpen(false);
      closeMenus();
      window.location.assign("/");
    } finally {
      setLogoutLoading(false);
    }
  };

  useEffect(() => {
    setReadNotificationIds(loadReadNotificationIds(user?.id));
  }, [user?.id]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const target = event.target;
      const insidePopoverOrTrigger = target.closest?.(
        '[role="menu"], [role="dialog"], [aria-haspopup="menu"], [aria-haspopup="dialog"]'
      );
      if (!menuRoot.current?.contains(target) || !insidePopoverOrTrigger) closeMenus();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeMenus();
        setLogoutConfirmOpen(false);
        (notificationsOpen ? notificationButton : menuButton).current?.focus();
      }
      if (event.key === "ArrowDown" && profileOpen) {
        event.preventDefault();
        menuRoot.current?.querySelector('[role="menu"] button')?.focus();
      }
      if (profileOpen && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && event.target.closest?.('[role="menu"]')) {
        const items = Array.from(menuRoot.current?.querySelectorAll('[role="menu"] button') || []);
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement);
        const next = event.key === "Home" ? 0
          : event.key === "End" ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileOpen, notificationsOpen]);

  return (
    <header className="sticky top-0 z-30 mb-6 bg-[#F7F7FA]/90 dark:bg-[#171525]/90 backdrop-blur-md pt-3 pb-2 transition-colors">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between px-1">
        {/* Left Side: Page Greeting & Title */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleMobileSidebar}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white dark:bg-[#211E35] border border-slate-200 dark:border-[#2E2A4A] text-slate-600 dark:text-slate-300 lg:hidden shadow-xs"
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          <div>
            <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {getGreeting()}, {displayName}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              AI-powered inventory intelligence for your business.
            </p>
          </div>
        </div>

        {/* Right Side Controls */}
        <div ref={menuRoot} className="relative flex flex-wrap items-center gap-2.5">
          {/* Quick Search */}
          <div className="relative min-w-[200px] md:min-w-[240px]">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
              placeholder="Search products, SKUs..."
              className="w-full rounded-xl border border-slate-200/80 dark:border-[#2E2A4A] bg-white dark:bg-[#211E35] px-3.5 py-2 pl-9 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#7C5CFC] focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 transition shadow-xs"
            />
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
              🔍
            </span>
          </div>

          {/* Upload Button */}
          {onOpenUpload && (
            <Button
              variant="gradient"
              size="sm"
              onClick={onOpenUpload}
              className="shadow-xs"
            >
              ☁ Upload Dataset
            </Button>
          )}

          {/* Notifications Dropdown */}
          <div className="relative">
            <button
              ref={notificationButton}
              type="button"
              onClick={() => {
                setProfileOpen(false);
                setNotificationsOpen((prev) => !prev);
              }}
              className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white dark:bg-[#211E35] border border-slate-200/80 dark:border-[#2E2A4A] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#27233D] transition shadow-xs"
              aria-label={unreadAlerts.length ? `Notifications, ${unreadAlerts.length} unread` : "Notifications"}
              title={unreadAlerts.length ? `${unreadAlerts.length} unread notifications` : "Notifications"}
              aria-haspopup="dialog"
              aria-expanded={notificationsOpen}
            >
              🔔
              {unreadAlerts.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#D946A8] text-[9px] font-bold text-white">
                  {unreadAlerts.length > 99 ? "99+" : unreadAlerts.length}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div role="dialog" aria-label="Notifications" className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-[20px] border border-slate-200 dark:border-[#2E2A4A] bg-white dark:bg-[#211E35] p-3 shadow-xl animate-fadeIn">
                <div className="flex items-center justify-between px-2 pb-2 border-b border-slate-100 dark:border-[#2E2A4A]">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Notifications
                  </p>
                  <div className="flex items-center gap-2">
                    <span aria-live="polite" className="text-[10px] font-semibold text-[#D946A8] dark:text-[#f472c1]">{unreadAlerts.length} unread</span>
                    <button type="button" onClick={onRefreshAlerts} disabled={alertsLoading} aria-label="Refresh notifications" className="rounded px-1.5 py-1 text-[10px] font-semibold text-violet-700 hover:bg-violet-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 dark:text-violet-300 dark:hover:bg-[#27233D]">
                      {alertsLoading ? "Refreshing…" : "Refresh"}
                    </button>
                    {unreadAlerts.length > 0 && <button type="button" onClick={markAllRead} className="rounded px-1.5 py-1 text-[10px] font-semibold text-violet-700 hover:bg-violet-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300 dark:hover:bg-[#27233D]">Mark all read</button>}
                  </div>
                </div>
                <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                  {alertsLoading ? (
                    <p role="status" className="p-3 text-xs text-slate-400 text-center">Loading notifications...</p>
                  ) : alertsError ? (
                    <div className="p-3 text-center">
                      <p role="alert" className="text-xs text-rose-600">{alertsError}</p>
                      <button type="button" onClick={onRefreshAlerts} className="mt-2 rounded px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300 dark:hover:bg-[#27233D]">Try again</button>
                    </div>
                  ) : alerts.length === 0 ? (
                    <p className="p-3 text-xs text-slate-400 text-center">
                      No unread or unresolved notifications.
                    </p>
                  ) : (
                    alerts.slice(0, 20).map((alert) => (
                      <button
                        key={alert.id}
                        type="button"
                        onClick={() => { markRead(alert.id); closeMenus(); onSelectPage?.("risk-alerts"); }}
                        className={`w-full rounded-xl p-2.5 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-[#27233D] ${readNotificationIds.includes(String(alert.id)) ? "opacity-70" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase text-[#7C5CFC]">
                            {alert.alert_type || "Risk Signal"}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {alert.severity}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {alert.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                          {alert.what}
                        </p>
                        {readNotificationIds.includes(String(alert.id)) && <span className="mt-1 block text-[10px] text-slate-400">Read</span>}
                      </button>
                    ))
                  )}
                </div>
                {alerts.length > 20 && <p className="px-2 pt-2 text-[10px] text-slate-400">Showing 20 of {alerts.length} alerts. Open Alerts & Risks to see all.</p>}
              </div>
            )}
          </div>

          {/* Theme Toggle Button */}
          <button
            type="button"
            onClick={onToggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white dark:bg-[#211E35] border border-slate-200/80 dark:border-[#2E2A4A] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#27233D] transition shadow-xs"
            aria-label="Toggle theme"
            title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {isDark ? "☀️" : "🌙"}
          </button>

          {/* User Profile Avatar Dropdown */}
          <div className="relative">
            <button
              ref={menuButton}
              type="button"
              onClick={() => {
                setNotificationsOpen(false);
                setProfileOpen((prev) => !prev);
              }}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              aria-label={`Account menu for ${displayName}`}
              className="flex items-center gap-2 rounded-xl bg-white dark:bg-[#211E35] border border-slate-200/80 dark:border-[#2E2A4A] p-1 pr-2.5 hover:bg-slate-50 dark:hover:bg-[#27233D] transition shadow-xs"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-[#D946A8] to-[#7C5CFC] text-white text-xs font-bold">
                {initials}
              </div>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 hidden sm:inline">
                {displayName}
              </span>
            </button>

            {profileOpen && (
              <div role="menu" aria-label="Account actions" className="absolute right-0 top-full z-50 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-[18px] border border-slate-200 dark:border-[#2E2A4A] bg-white dark:bg-[#211E35] p-1.5 shadow-xl animate-fadeIn">
                {isAuthenticated ? <>
                  <div className="border-b border-slate-100 px-3 py-2 dark:border-[#2E2A4A]">
                    <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">{displayName}</p>
                    <p className="truncate text-[11px] text-slate-500">{user?.email}</p>
                  </div>
                  {[
                    ["My Profile", () => openSettings("profile")],
                    ["Workspace Settings", () => openSettings("forecasting")],
                    ["Theme Settings", () => openSettings("appearance")],
                  ].map(([item, action]) => (
                    <button key={item} role="menuitem" type="button" onClick={action} className="w-full rounded-xl px-3 py-2.5 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-slate-300 dark:hover:bg-[#27233D]">
                      {item}
                    </button>
                  ))}
                  <button role="menuitem" type="button" onClick={() => { closeMenus(); setLogoutConfirmOpen(true); }} className="w-full rounded-xl px-3 py-2.5 text-left text-xs font-medium text-rose-600 transition hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-rose-400 dark:hover:bg-rose-950/30">
                    Logout
                  </button>
                </> : (
                  <button
                    type="button"
                    onClick={() => setProfileOpen(false)}
                    className="w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#27233D] transition"
                  >
                    Login
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {logoutConfirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setLogoutConfirmOpen(false); }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="logout-title" aria-describedby="logout-description" className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-[#2E2A4A] dark:bg-[#211E35]">
            <h2 id="logout-title" className="text-base font-bold text-slate-900 dark:text-white">Sign out of InventIQ?</h2>
            <p id="logout-description" className="mt-2 text-sm text-slate-600 dark:text-slate-300">Your current session will end on this device.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" autoFocus disabled={logoutLoading} onClick={() => setLogoutConfirmOpen(false)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 dark:border-[#2E2A4A] dark:text-slate-200 dark:hover:bg-[#27233D]">Cancel</button>
              <button type="button" disabled={logoutLoading} onClick={confirmLogout} className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-60">{logoutLoading ? "Signing out…" : "Sign out"}</button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
