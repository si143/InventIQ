const SETTINGS_KEY = "inventiq_workspace_settings";

function settingsStorageKey() {
  try {
    const user = JSON.parse(localStorage.getItem("inventiq_user") || "null");
    return `${SETTINGS_KEY}_${user?.id ?? "anonymous"}`;
  } catch {
    return `${SETTINGS_KEY}_anonymous`;
  }
}

export const DEFAULT_SETTINGS = {
  forecasting: {
    defaultModel: "Auto Select",
    defaultHorizon: 7,
    evaluationMetrics: ["mae", "rmse", "r2_score"],
    uncertaintyBands: true,
  },
  notifications: {
    lowStock: true,
    demandChange: true,
    highRisk: true,
  },
  appearance: {
    theme: "system",
    compactDashboard: false,
    defaultLandingPage: "dashboard",
    dashboardCharts: {
      historicalForecast: true,
      topProducts: true,
      productComparison: true,
      salesTrend: true,
      productDistribution: true,
    },
  },
  data: {
    dateFormat: "locale",
    validateMissingValues: true,
    validateDuplicates: true,
  },
};

export function loadSettings() {
  try {
    const scopedKey = settingsStorageKey();
    const raw = localStorage.getItem(scopedKey)
      ?? localStorage.getItem(SETTINGS_KEY)
      ?? "{}";
    const stored = JSON.parse(raw);
    const appearance = { ...DEFAULT_SETTINGS.appearance, ...stored.appearance };
    if (!stored.appearance?.theme) {
      const legacyTheme = localStorage.getItem("inventiq_theme");
      if (legacyTheme === "light" || legacyTheme === "dark") appearance.theme = legacyTheme;
    }
    return {
      forecasting: { ...DEFAULT_SETTINGS.forecasting, ...stored.forecasting },
      notifications: { ...DEFAULT_SETTINGS.notifications, ...stored.notifications },
      appearance: {
        ...DEFAULT_SETTINGS.appearance,
        ...appearance,
        dashboardCharts: {
          ...DEFAULT_SETTINGS.appearance.dashboardCharts,
          ...stored.appearance?.dashboardCharts,
        },
      },
      data: { ...DEFAULT_SETTINGS.data, ...stored.data },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings) {
  const merged = {
    forecasting: { ...DEFAULT_SETTINGS.forecasting, ...settings.forecasting },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...settings.notifications },
    appearance: {
      ...DEFAULT_SETTINGS.appearance,
      ...settings.appearance,
      dashboardCharts: {
        ...DEFAULT_SETTINGS.appearance.dashboardCharts,
        ...settings.appearance?.dashboardCharts,
      },
    },
    data: { ...DEFAULT_SETTINGS.data, ...settings.data },
  };
  localStorage.setItem(settingsStorageKey(), JSON.stringify(merged));
  window.dispatchEvent(new Event("inventiq-settings-updated"));
  return merged;
}

export function isNotificationEnabled(alert, preferences) {
  const type = String(alert.alert_type || "").toUpperCase();
  const severity = String(alert.severity || "").toUpperCase();
  if (type === "STOCKOUT RISK" && !preferences.lowStock) return false;
  if (["DEMAND UNCERTAINTY", "SHOCK RISK", "OBSOLESCENCE RISK", "RECOVERY OPPORTUNITY"].includes(type) && !preferences.demandChange) return false;
  if (["HIGH", "CRITICAL"].includes(severity) && !preferences.highRisk) return false;
  return true;
}

export function resolveTheme(theme) {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function formatDate(value, format = loadSettings().data.dateFormat) {
  if (!value) return "-";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  if (format === "iso") {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function loadReadNotificationIds(userId) {
  try {
    const stored = JSON.parse(localStorage.getItem(`inventiq_read_notifications_${userId || "anonymous"}`) || "[]");
    return Array.isArray(stored) ? stored.map(String) : [];
  } catch {
    return [];
  }
}

export function saveReadNotificationIds(userId, ids) {
  const uniqueIds = Array.from(new Set(ids.map(String)));
  localStorage.setItem(`inventiq_read_notifications_${userId || "anonymous"}`, JSON.stringify(uniqueIds));
  return uniqueIds;
}