import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  formatDate,
  loadReadNotificationIds,
  loadSettings,
  saveReadNotificationIds,
  saveSettings,
} from "./settings.js";

function setupStorage() {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = { dispatchEvent: () => true };
  return values;
}

test("settings merge stored partial preferences with safe defaults", () => {
  const values = setupStorage();
  values.set("inventiq_workspace_settings_anonymous", JSON.stringify({
    appearance: { dashboardCharts: { salesTrend: false } },
    data: { dateFormat: "iso" },
  }));

  const settings = loadSettings();

  assert.equal(settings.appearance.dashboardCharts.salesTrend, false);
  assert.equal(settings.appearance.dashboardCharts.topProducts, true);
  assert.equal(settings.data.dateFormat, "iso");
  assert.equal(settings.forecasting.defaultHorizon, DEFAULT_SETTINGS.forecasting.defaultHorizon);
});

test("save preserves default settings and emits settings-updated", () => {
  const values = setupStorage();
  let dispatched = false;
  globalThis.window.dispatchEvent = (event) => {
    dispatched = event.type === "inventiq-settings-updated";
    return true;
  };

  const saved = saveSettings({
    appearance: { compactDashboard: true },
    forecasting: { defaultHorizon: 30 },
  });

  assert.equal(saved.appearance.compactDashboard, true);
  assert.equal(saved.appearance.dashboardCharts.topProducts, true);
  assert.equal(saved.forecasting.defaultHorizon, 30);
  assert.equal(dispatched, true);
  assert.ok(values.has("inventiq_workspace_settings_anonymous"));
});

test("settings are isolated per authenticated account", () => {
  const values = setupStorage();
  values.set("inventiq_user", JSON.stringify({ id: 12 }));
  saveSettings({ appearance: { compactDashboard: true } });
  assert.ok(values.has("inventiq_workspace_settings_12"));
  assert.equal(loadSettings().appearance.compactDashboard, true);
  values.set("inventiq_user", JSON.stringify({ id: 13 }));
  assert.equal(loadSettings().appearance.compactDashboard, false);
});

test("date format supports ISO and readable labels", () => {
  assert.equal(formatDate("2026-10-11", "iso"), "2026-10-11");
  assert.notEqual(formatDate("2026-10-11", "locale"), "2026-10-11");
});

test("read notifications persist uniquely per account", () => {
  const values = setupStorage();
  assert.deepEqual(saveReadNotificationIds(12, [1, "1", 2]), ["1", "2"]);
  assert.deepEqual(loadReadNotificationIds(12), ["1", "2"]);
  assert.deepEqual(loadReadNotificationIds(13), []);
  values.set("inventiq_read_notifications_14", "bad-json");
  assert.deepEqual(loadReadNotificationIds(14), []);
});
