import React, { useState, useEffect, useCallback, useRef } from "react";
import MainLayout from "./components/layout/MainLayout";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Register from "./pages/Register";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { DatasetProvider } from "./context/DatasetContext";
import { isNotificationEnabled, loadSettings } from "./utils/settings";

const API_BASE = "/api";
const ACTIVE_PAGE_KEY = "inventiq_active_page";
const PAGE_IDS = new Set(["dashboard", "datasets", "model-training", "forecasts", "risk-alerts", "recommendations", "dependencies", "obsolescence", "simulations", "recovery", "settings", "help"]);

export default function App() {
  return (
    <AuthProvider>
      <DatasetProvider>
        <InventIQApp />
      </DatasetProvider>
    </AuthProvider>
  );
}

function InventIQApp() {
  const { isAuthenticated, apiFetch, token } = useAuth();
  const [authChecked, setAuthChecked] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [activePage, setActivePageState] = useState(() => {
    const defaultPage = loadSettings().appearance.defaultLandingPage;
    const allowedLandingPages = new Set(["dashboard", "forecasts", "model-training"]);
    return allowedLandingPages.has(defaultPage) ? defaultPage : "dashboard";
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [alerts, setAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState("");
  const [alertsRefreshToken, setAlertsRefreshToken] = useState(0);
  const [notificationPreferences, setNotificationPreferences] = useState(() => loadSettings().notifications);
  const landingPageRef = useRef(loadSettings().appearance.defaultLandingPage);
  const isDemoSession = import.meta.env.DEV && token?.startsWith("demo-");
  const visibleAlerts = alerts.filter((alert) => isNotificationEnabled(alert, notificationPreferences));

  const setActivePage = useCallback((page) => {
    const nextPage = PAGE_IDS.has(page) ? page : "dashboard";
    localStorage.setItem(ACTIVE_PAGE_KEY, nextPage);
    setActivePageState(nextPage);
  }, []);

  useEffect(() => {
    setAuthChecked(true);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const defaultPage = loadSettings().appearance.defaultLandingPage;
    landingPageRef.current = defaultPage;
    const allowedLandingPages = new Set(["dashboard", "forecasts", "model-training"]);
    setActivePageState(allowedLandingPages.has(defaultPage) ? defaultPage : "dashboard");
  }, [isAuthenticated]);

  useEffect(() => {
    const refreshPreferences = () => {
      const settings = loadSettings();
      setNotificationPreferences(settings.notifications);
      const allowedLandingPages = new Set(["dashboard", "forecasts", "model-training"]);
      if (settings.appearance.defaultLandingPage !== landingPageRef.current
        && allowedLandingPages.has(settings.appearance.defaultLandingPage)) {
        landingPageRef.current = settings.appearance.defaultLandingPage;
        setActivePageState(settings.appearance.defaultLandingPage);
      }
    };
    window.addEventListener("inventiq-settings-updated", refreshPreferences);
    return () => window.removeEventListener("inventiq-settings-updated", refreshPreferences);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || isDemoSession) {
      setAlerts([]);
      setAlertsError("");
      setAlertsLoading(false);
      return;
    }
    let cancelled = false;
    setAlertsLoading(true);
    setAlertsError("");
    apiFetch(`${API_BASE}/alerts?is_resolved=false`)
      .then(async (response) => {
        const payload = await response.json().catch(() => []);
        if (!response.ok) throw new Error(payload.detail || `Unable to load notifications (HTTP ${response.status}).`);
        if (!Array.isArray(payload)) throw new Error("The notifications endpoint returned an invalid response.");
        if (!cancelled) setAlerts(payload);
      })
      .catch((error) => {
        if (!cancelled) {
          setAlerts([]);
          setAlertsError(error.message || "Unable to load notifications.");
        }
      })
      .finally(() => {
        if (!cancelled) setAlertsLoading(false);
      });
    return () => { cancelled = true; };
  }, [isAuthenticated, isDemoSession, apiFetch, alertsRefreshToken]);

  const handleLoginSuccess = useCallback(() => {
    setAuthChecked(true);
  }, []);

  if (!authChecked) {
    return null;
  }

  if (!isAuthenticated) {
    if (showRegister) {
      return <Register onSuccess={() => setShowRegister(false)} onShowLogin={() => setShowRegister(false)} />;
    }
    return <Login onSuccess={handleLoginSuccess} onShowRegister={() => setShowRegister(true)} />;
  }

  return (
    <MainLayout
      activePage={activePage}
      onSelectPage={setActivePage}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      alerts={visibleAlerts}
      alertsLoading={alertsLoading}
      alertsError={alertsError}
      onRefreshAlerts={() => setAlertsRefreshToken((current) => current + 1)}
    >
      <Dashboard
        activePage={activePage}
        onNavigatePage={setActivePage}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
      />
    </MainLayout>
  );
}
