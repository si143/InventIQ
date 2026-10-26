import { useEffect, useState } from "react";
import PageHeader from "../components/ui/PageHeader";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import { useAuth } from "../context/AuthContext";
import { useDataset } from "../context/DatasetContext";
import { DEFAULT_SETTINGS, formatDate, loadSettings, saveSettings } from "../utils/settings";

const sections = [
  { id: "profile", label: "Profile" },
  { id: "forecasting", label: "Forecasting" },
  { id: "notifications", label: "Notifications" },
  { id: "data", label: "Data Management" },
  { id: "appearance", label: "Appearance" },
  { id: "security", label: "Security" },
];

const metricOptions = [
  ["mae", "MAE", "Mean Absolute Error"],
  ["rmse", "RMSE", "Root Mean Square Error"],
  ["r2_score", "R²", "Coefficient of determination"],
];

function Toggle({ label, description, checked, onChange, disabled = false }) {
  return <label className={`flex items-center justify-between gap-4 border-b border-slate-100 py-4 last:border-0 dark:border-[#2E2A4A] ${disabled ? "opacity-60" : "cursor-pointer"}`}>
    <span><span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{label}</span><span className="mt-0.5 block text-xs text-slate-500">{description}</span></span>
    <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} className="h-4 w-4 accent-[#7C5CFC]" />
  </label>;
}

function ReadOnlyRow({ label, value }) {
  return <div className="flex flex-col gap-1 border-b border-slate-100 py-3 last:border-0 dark:border-[#2E2A4A] sm:flex-row sm:items-center sm:justify-between"><span className="text-xs font-semibold uppercase text-slate-500">{label}</span><span className="text-sm text-slate-800 dark:text-slate-100">{value || "Not available"}</span></div>;
}

export default function Settings() {
  const { user, apiFetch, logout, updateUser } = useAuth();
  const { datasets, selectedDatasetId, setSelectedDatasetId } = useDataset();
  const [activeSection, setActiveSection] = useState("profile");
  const [preferences, setPreferences] = useState(loadSettings);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [profile, setProfile] = useState({ name: user?.name || "", email: user?.email || "" });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    setProfile({ name: user?.name || "", email: user?.email || "" });
  }, [user?.email, user?.name]);

  useEffect(() => {
    const openSection = (event) => {
      const section = event.detail?.section || localStorage.getItem("inventiq_pending_settings_section");
      if (sections.some((item) => item.id === section)) {
        setActiveSection(section);
        localStorage.removeItem("inventiq_pending_settings_section");
      }
    };
    window.addEventListener("inventiq-open-settings-section", openSection);
    openSection({ detail: {} });
    return () => window.removeEventListener("inventiq-open-settings-section", openSection);
  }, []);

  const updateSection = (section, key, value) => {
    setSaved(false);
    setPreferences((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));
  };

  const toggleMetric = (metric) => {
    const current = preferences.forecasting.evaluationMetrics;
    updateSection("forecasting", "evaluationMetrics", current.includes(metric)
      ? current.filter((item) => item !== metric)
      : [...current, metric]);
  };

  const handleSave = (event) => {
    event.preventDefault();
    setSaving(true);
    const savedPreferences = saveSettings(preferences);
    setPreferences(savedPreferences);
    setSaved(true);
    setSaving(false);
  };

  const handleReset = () => {
    const resetPreferences = structuredClone(DEFAULT_SETTINGS);
    setPreferences(saveSettings(resetPreferences));
    setSelectedDatasetId(datasets[0]?.dataset_id || "");
    setValidation(null);
    setValidationError("");
    setSaved(false);
  };

  const handleProfileSave = async () => {
    setProfileMessage("");
    setProfileError("");
    if (!currentPassword) {
      setProfileError("Enter your current password to save profile changes.");
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      setProfileError("New password and confirmation do not match.");
      return;
    }
    setProfileSaving(true);
    try {
      const response = await apiFetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...profile,
          current_password: currentPassword,
          new_password: newPassword || null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "Unable to update your profile.");
      updateUser(payload.user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setProfileMessage("Profile changes saved.");
    } catch (error) {
      setProfileError(error.message || "Unable to update your profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  const cancelProfileEdit = () => {
    setProfile({ name: user?.name || "", email: user?.email || "" });
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setProfileMessage("");
    setProfileError("");
  };

  const validateSelectedDataset = async () => {
    if (!selectedDatasetId) return;
    setValidationLoading(true);
    setValidationError("");
    setValidation(null);
    try {
      const response = await apiFetch(`/api/datasets/${encodeURIComponent(selectedDatasetId)}/validation`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Dataset validation failed.");
      setValidation(data);
    } catch (error) {
      setValidationError(error.message || "Dataset validation failed.");
    } finally {
      setValidationLoading(false);
    }
  };

  const selectedSection = sections.find((section) => section.id === activeSection);
  const selectedDataset = datasets.find((dataset) => String(dataset.dataset_id) === String(selectedDatasetId));
  const initials = (user?.name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";

  return <div className="space-y-6 animate-fadeIn">
    <PageHeader category="SYSTEM" title="Settings" subtitle="Manage forecasting defaults, notifications, data preferences, and appearance." />

    <form onSubmit={handleSave} className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-2 lg:block lg:space-y-1 lg:overflow-visible lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4 dark:border-[#2E2A4A]">
          {sections.map((section) => <button key={section.id} type="button" onClick={() => setActiveSection(section.id)} aria-current={activeSection === section.id ? "page" : undefined} className={`shrink-0 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition lg:w-full ${activeSection === section.id ? "bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#211E35]"}`}>{section.label}</button>)}
        </nav>

        <section aria-labelledby="settings-section-title" className="min-w-0">
          <div className="mb-5 border-b border-slate-100 pb-4 dark:border-[#2E2A4A]"><h2 id="settings-section-title" className="text-lg font-bold text-slate-900 dark:text-white">{selectedSection?.label}</h2></div>

          {activeSection === "profile" && <div className="max-w-2xl space-y-5">
            <div className="mt-3 flex items-center gap-3 border-b border-slate-100 pb-4 dark:border-[#2E2A4A]"><div aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-lg font-bold text-slate-600 dark:bg-[#2E2A4A] dark:text-slate-200">{initials}</div><div><p className="text-sm font-semibold">{user?.name || "Name unavailable"}</p><p className="text-xs text-slate-500">Your initials are used as the account avatar.</p></div></div>
            <label className="block space-y-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">Name
              <input value={profile.name} onChange={(event) => setProfile((value) => ({ ...value, name: event.target.value }))} maxLength={100} required className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-normal normal-case text-slate-800 focus:border-[#7C5CFC] focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 dark:border-[#2E2A4A] dark:bg-[#171525] dark:text-slate-100" />
            </label>
            <label className="block space-y-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">Email
              <input type="email" value={profile.email} onChange={(event) => setProfile((value) => ({ ...value, email: event.target.value }))} required className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-normal normal-case text-slate-800 focus:border-[#7C5CFC] focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 dark:border-[#2E2A4A] dark:bg-[#171525] dark:text-slate-100" />
            </label>
            <ReadOnlyRow label="Role" value={user?.role} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input containerClassName="sm:col-span-2" label="Current password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} helper="Required to confirm profile or password changes." />
              <Input label="New password (optional)" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} helper="Use at least 8 characters to change it." />
              <Input label="Confirm new password" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
            {profileError && <p role="alert" className="text-sm text-rose-600">{profileError}</p>}
            {profileMessage && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{profileMessage}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={cancelProfileEdit}>Cancel</Button>
              <Button type="button" variant="gradient" loading={profileSaving} onClick={handleProfileSave}>Save Changes</Button>
            </div>
          </div>}

          {activeSection === "forecasting" && <div className="max-w-2xl space-y-5">
            <Select label="Default forecasting model" value={preferences.forecasting.defaultModel} onChange={(event) => updateSection("forecasting", "defaultModel", event.target.value)}>
              {["Auto Select", "Linear Regression", "Random Forest", "XGBoost", "ARIMA"].map((model) => <option key={model} value={model}>{model}</option>)}
            </Select>
            <Select label="Default forecast horizon" value={String(preferences.forecasting.defaultHorizon)} onChange={(event) => updateSection("forecasting", "defaultHorizon", Number(event.target.value))}>
              {[7, 14, 30, 60, 90].map((days) => <option key={days} value={days}>{days} days</option>)}
            </Select>
            <fieldset><legend className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Evaluation metrics shown after training</legend><div className="mt-2">{metricOptions.map(([key, label, description]) => <Toggle key={key} label={label} description={description} checked={preferences.forecasting.evaluationMetrics.includes(key)} onChange={() => toggleMetric(key)} />)}</div></fieldset>
            <p className="text-xs text-slate-500">All supported metrics are still calculated and stored by the API; this preference controls which metric cards are displayed.</p>
            <Toggle label="Show forecast uncertainty bands" description="Display API-provided prediction bounds where available." checked={preferences.forecasting.uncertaintyBands} onChange={(event) => updateSection("forecasting", "uncertaintyBands", event.target.checked)} />
          </div>}

          {activeSection === "notifications" && <div className="max-w-2xl">
            <Toggle label="Low-stock alerts" description="Show stockout-risk alerts in the notification menu." checked={preferences.notifications.lowStock} onChange={(event) => updateSection("notifications", "lowStock", event.target.checked)} />
            <Toggle label="Demand-change alerts" description="Show uncertainty, shock, commercial decline, and recovery alerts." checked={preferences.notifications.demandChange} onChange={(event) => updateSection("notifications", "demandChange", event.target.checked)} />
            <Toggle label="High-risk notifications" description="Show alerts marked HIGH or CRITICAL." checked={preferences.notifications.highRisk} onChange={(event) => updateSection("notifications", "highRisk", event.target.checked)} />
            <p className="mt-4 text-xs text-slate-500">Training and forecast completion notifications are not currently provided by the application.</p>
          </div>}

          {activeSection === "data" && <div className="max-w-2xl space-y-5">
            <Select label="Default dataset" value={selectedDatasetId || ""} onChange={(event) => { setSelectedDatasetId(event.target.value); setValidation(null); }}>
              {datasets.map((dataset) => <option key={dataset.dataset_id} value={dataset.dataset_id}>{dataset.filename || dataset.original_filename || `Dataset ${dataset.dataset_id}`}</option>)}
            </Select>
            {selectedDataset && <div className="divide-y divide-slate-100 border-y border-slate-100 dark:divide-[#2E2A4A] dark:border-[#2E2A4A]">
              <ReadOnlyRow label="Selected dataset" value={selectedDataset.filename || selectedDataset.original_filename} />
              <ReadOnlyRow label="Rows" value={selectedDataset.row_count?.toLocaleString?.() || "Not available"} />
              <ReadOnlyRow label="Last uploaded" value={formatDate(selectedDataset.created_at?.slice(0, 10), preferences.data.dateFormat)} />
            </div>}
            <div className="divide-y divide-slate-100 border-y border-slate-100 dark:divide-[#2E2A4A] dark:border-[#2E2A4A]">
              <ReadOnlyRow label="Import formats" value="CSV, XLSX, XLS" />
            </div>
            <Select label="Date display format" value={preferences.data.dateFormat} onChange={(event) => updateSection("data", "dateFormat", event.target.value)}>
              <option value="locale">Readable date (Oct 11, 2026)</option><option value="iso">ISO date (2026-10-11)</option>
            </Select>
            <Toggle label="Report missing values" description="Include missing-value counts in validation results." checked={preferences.data.validateMissingValues} onChange={(event) => updateSection("data", "validateMissingValues", event.target.checked)} />
            <Toggle label="Report duplicate records" description="Include duplicate-row counts in validation results." checked={preferences.data.validateDuplicates} onChange={(event) => updateSection("data", "validateDuplicates", event.target.checked)} />
            <p className="text-xs text-slate-500">Validation is read-only. InventIQ does not automatically clean or rewrite uploaded data.</p>
            <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" type="button" onClick={validateSelectedDataset} disabled={!selectedDatasetId || validationLoading} loading={validationLoading}>Validate selected dataset</Button>{validation && <span role="status" className="text-sm">{validation.overall_status}: {validation.rows} rows{preferences.data.validateMissingValues ? `, ${validation.missing_values} missing values` : ""}{preferences.data.validateDuplicates ? `, ${validation.duplicate_rows} duplicate rows` : ""}</span>}</div>
            {validationError && <p role="alert" className="text-sm text-rose-600">{validationError}</p>}
            {validation?.empty_columns?.length > 0 && <p className="text-xs text-amber-700">Empty columns: {validation.empty_columns.join(", ")}</p>}
          </div>}

          {activeSection === "appearance" && <div className="max-w-2xl space-y-5">
            <Select label="Color theme" value={preferences.appearance.theme} onChange={(event) => updateSection("appearance", "theme", event.target.value)}>
              <option value="system">System preference</option><option value="light">Light</option><option value="dark">Dark</option>
            </Select>
            <Toggle label="Compact dashboard spacing" description="Reduce page padding and chart-card spacing." checked={preferences.appearance.compactDashboard} onChange={(event) => updateSection("appearance", "compactDashboard", event.target.checked)} />
            <Select label="Default landing page" value={preferences.appearance.defaultLandingPage} onChange={(event) => updateSection("appearance", "defaultLandingPage", event.target.value)}>
              <option value="dashboard">Dashboard</option><option value="forecasts">Demand Forecasts</option><option value="model-training">Model Training</option>
            </Select>
            <p className="text-xs text-slate-500">The selected landing page is used the next time InventIQ loads.</p>
            <fieldset><legend className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Dashboard charts</legend><div className="mt-2">{[
              ["historicalForecast", "Historical sales and forecast"],
              ["topProducts", "Top products by units sold"],
              ["productComparison", "Product-wise demand comparison"],
              ["salesTrend", "Daily or monthly sales trend"],
              ["productDistribution", "Product or category distribution"],
            ].map(([key, label]) => <Toggle key={key} label={label} description={`Show the ${label.toLowerCase()} chart on the dashboard.`} checked={preferences.appearance.dashboardCharts[key]} onChange={(event) => updateSection("appearance", "dashboardCharts", { ...preferences.appearance.dashboardCharts, [key]: event.target.checked })} />)}</div></fieldset>
          </div>}

          {activeSection === "security" && <div className="max-w-2xl space-y-5">
            <div className="divide-y divide-slate-100 border-y border-slate-100 dark:divide-[#2E2A4A] dark:border-[#2E2A4A]">
              <ReadOnlyRow label="Authentication" value="JWT bearer token" />
              <ReadOnlyRow label="Password changes" value="Update your password in Profile settings; your current password is required." />
              <ReadOnlyRow label="Session information" value="This authenticated browser session is active. Other sessions cannot be viewed or revoked here." />
              <ReadOnlyRow label="Data privacy" value="Datasets and account data are available only to the authenticated account through protected API routes" />
            </div>
            <Button variant="danger" type="button" onClick={logout}>Sign out this session</Button>
          </div>}
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-[#2E2A4A]">
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{saved ? "Settings saved on this device." : "Preferences apply to this browser and account session."}</p>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" type="button" onClick={handleReset}>Reset to defaults</Button><Button variant="gradient" type="submit" loading={saving}>Save Changes</Button></div>
      </footer>
    </form>
  </div>;
}