import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "../components/ui/PageHeader";
import Card, { CardTitle } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Modal from "../components/ui/Modal";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import { useAuth } from "../context/AuthContext";
import { useDataset } from "../context/DatasetContext";

const API_BASE = "/api";

const alertTypes = [
  "All",
  "STOCKOUT RISK",
  "OBSOLESCENCE RISK",
  "DEMAND UNCERTAINTY",
  "DEPENDENCY RISK",
  "SHOCK RISK",
  "RECOVERY OPPORTUNITY",
];

function AlertModal({ alert, onClose, onResolve, datasetId }) {
  const [recommendations, setRecommendations] = useState([]);

  useEffect(() => {
    apiFetch(`${API_BASE}/recommendations?dataset_id=${datasetId}&alert_id=${alert.id}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setRecommendations(data))
      .catch(() => setRecommendations([]));
  }, [alert.id]);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      category={alert.alert_type}
      title={alert.title}
      subtitle={`Product: ${alert.product_id || "Catalog Wide"}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {!alert.is_resolved && (
            <Button variant="gradient" onClick={() => onResolve(alert.id)}>
              ✓ Resolve Alert
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Badge variant={alert.severity === "HIGH" ? "high" : alert.severity === "MEDIUM" ? "medium" : "low"}>
          {alert.severity} SEVERITY
        </Badge>
        {alert.is_resolved && <Badge variant="low">RESOLVED</Badge>}
        <span className="text-xs text-slate-400">
          Triggered {alert.created_at ? new Date(alert.created_at).toLocaleString() : "-"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#171525] border border-slate-200 dark:border-[#2E2A4A] text-xs">
          <b className="text-slate-900 dark:text-white uppercase tracking-wider text-[10px]">WHAT:</b>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{alert.what}</p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#171525] border border-slate-200 dark:border-[#2E2A4A] text-xs">
          <b className="text-slate-900 dark:text-white uppercase tracking-wider text-[10px]">WHY:</b>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{alert.why}</p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#171525] border border-slate-200 dark:border-[#2E2A4A] text-xs">
          <b className="text-slate-900 dark:text-white uppercase tracking-wider text-[10px]">WHEN:</b>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{alert.when_text}</p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#171525] border border-slate-200 dark:border-[#2E2A4A] text-xs">
          <b className="text-slate-900 dark:text-white uppercase tracking-wider text-[10px]">IMPACT:</b>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{alert.impact}</p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#171525] border border-slate-200 dark:border-[#2E2A4A] text-xs sm:col-span-2">
          <b className="text-[#D946A8] uppercase tracking-wider text-[10px]">SUGGESTED ACTION:</b>
          <p className="mt-1 font-semibold text-slate-800 dark:text-slate-200">{alert.suggested_action}</p>
        </div>
      </div>

      {recommendations.length > 0 && (
        <div className="mt-4 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-xs">
          <b className="text-emerald-700 dark:text-emerald-400">Associated Recommendation:</b>
          {recommendations.map((rec) => (
            <p key={rec.id} className="mt-1 font-semibold text-slate-800 dark:text-slate-200">
              • {rec.suggested_action}
            </p>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function Alerts() {
  const { apiFetch } = useAuth();
  const { selectedDatasetId } = useDataset();
  const [alerts, setAlerts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [runs, setRuns] = useState([]);
  const [runId, setRunId] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("All");
  const [severity, setSeverity] = useState("All");
  const [status, setStatus] = useState("All");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const loadAlertsData = () => {
    setLoading(true);
    setAlerts([]);
    setSummary(null);
    Promise.all([
      apiFetch(`${API_BASE}/alerts?dataset_id=${selectedDatasetId}`).then((res) => (res.ok ? res.json() : [])),
      apiFetch(`${API_BASE}/alerts/summary?dataset_id=${selectedDatasetId}`).then((res) => (res.ok ? res.json() : {})),
      apiFetch(`${API_BASE}/model-runs?dataset_id=${selectedDatasetId}`).then((res) => (res.ok ? res.json() : [])),
    ])
      .then(([alertData, summaryData, runData]) => {
        setAlerts(alertData);
        setSummary(summaryData);
        const completedRuns = runData.filter((r) => r.status === "completed" && String(r.dataset_id) === String(selectedDatasetId));
        setRuns(completedRuns);
        if (!runId && completedRuns.length > 0) {
          setRunId(String(completedRuns[0].id));
        }
      })
      .catch(() => setError("Unable to load risk alerts. Please check backend API connection."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setRunId("");
    if (selectedDatasetId) loadAlertsData();
  }, [selectedDatasetId]);

  const filtered = useMemo(
    () =>
      alerts.filter((alert) => {
        const needle = search.trim().toLowerCase();
        const matchesSearch =
          !needle ||
          `${alert.title} ${alert.what} ${alert.product_id || ""}`
            .toLowerCase()
            .includes(needle);
        const matchesType = type === "All" || alert.alert_type === type;
        const matchesSeverity = severity === "All" || alert.severity === severity;
        const matchesStatus =
          status === "All" || (status === "Resolved" ? alert.is_resolved : !alert.is_resolved);
        return matchesSearch && matchesType && matchesSeverity && matchesStatus;
      }),
    [alerts, search, type, severity, status]
  );

  const handleGenerate = async () => {
    if (!runId) {
      setError("Select a completed model run before generating alerts.");
      return;
    }
    setGenerating(true);
    setError("");

    try {
      const response = await apiFetch(`${API_BASE}/alerts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_run_id: Number(runId) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Unable to generate alerts.");
      loadAlertsData();
    } catch (err) {
      setError(err.message || "Unable to generate alerts.");
    } finally {
      setGenerating(false);
    }
  };

  const handleResolve = async (alertId) => {
    try {
      const response = await apiFetch(`${API_BASE}/alerts/${alertId}/resolve`, {
        method: "PATCH",
      });
      if (!response.ok) throw new Error();
      setSelected(null);
      loadAlertsData();
    } catch {
      setError("Unable to resolve this alert.");
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <PageHeader
        category="RISK MANAGEMENT"
        title="Inventory Risks & Alerts"
        subtitle="Monitor real-time risk signals, stockout threats, and supplier delays."
        actions={
          <>
            <Select
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
              className="min-w-[200px]"
            >
              <option value="">Select model run</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.model_name} · {r.dataset_name || r.dataset_id}
                </option>
              ))}
            </Select>

            <Button
              variant="gradient"
              loading={generating}
              onClick={handleGenerate}
            >
              ⚡ Generate Risk Alerts
            </Button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={loadAlertsData} />}

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card hover>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>HIGH RISK ALERTS</span>
            <span className="text-sm">🚨</span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-rose-600 dark:text-rose-400">
            {summary ? summary.high_severity : "Not available"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Requires immediate replenishment</p>
        </Card>

        <Card hover>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>MEDIUM RISK ALERTS</span>
            <span className="text-sm">⚠️</span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-amber-600 dark:text-amber-400">
            {summary ? summary.medium_severity : "Not available"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Inventory pressure watching</p>
        </Card>

        <Card hover>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>LOW RISK ALERTS</span>
            <span className="text-sm">ℹ️</span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
            {summary ? summary.low_severity : "Not available"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Minor stock level shifts</p>
        </Card>

        <Card hover>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>UNRESOLVED TOTAL</span>
            <span className="text-sm">📌</span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-[#7C5CFC]">
            {summary ? summary.unresolved : "Not available"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Open risk tickets</p>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card padding="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            placeholder="Search risk alerts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {alertTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>

          <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="All">All Severities</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </Select>

          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="All">All Statuses</option>
            <option value="Unresolved">Unresolved</option>
            <option value="Resolved">Resolved</option>
          </Select>
        </div>
      </Card>

      {/* Alert Cards Grid */}
      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          Evaluating inventory risk signals...
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🛡️"
          title="No inventory risks detected"
          description="Select a completed model run and click 'Generate Risk Alerts' to analyze demand anomaly signals."
          actionLabel="Generate Alerts"
          onAction={handleGenerate}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((alert) => (
            <Card
              key={alert.id}
              className={`space-y-4 border ${
                alert.severity === "HIGH"
                  ? "border-rose-200 dark:border-rose-900/60"
                  : alert.severity === "MEDIUM"
                  ? "border-amber-200 dark:border-amber-900/60"
                  : "border-emerald-200 dark:border-emerald-900/60"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {alert.alert_type}
                  </span>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                    {alert.title}
                  </h3>
                </div>
                <Badge
                  variant={
                    alert.severity === "HIGH"
                      ? "high"
                      : alert.severity === "MEDIUM"
                      ? "medium"
                      : "low"
                  }
                >
                  {alert.severity}
                </Badge>
              </div>

              {alert.product_id && (
                <p className="text-xs font-bold text-[#7C5CFC]">
                  SKU: {alert.product_id}
                </p>
              )}

              <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                <p>
                  <b className="text-slate-800 dark:text-slate-100">WHAT:</b> {alert.what}
                </p>
                <p>
                  <b className="text-slate-800 dark:text-slate-100">WHY:</b> {alert.why}
                </p>
                <p>
                  <b className="text-slate-800 dark:text-slate-100">SUGGESTED ACTION:</b>{" "}
                  <span className="text-[#D946A8] font-semibold">{alert.suggested_action}</span>
                </p>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-[#2E2A4A]/60 flex items-center justify-between">
                <span className="text-[10px] text-slate-400">
                  {alert.is_resolved ? "✓ Resolved" : "Open Alert"}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelected(alert)}
                  >
                    View Details
                  </Button>
                  {!alert.is_resolved && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleResolve(alert.id)}
                    >
                      Resolve
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <AlertModal
          alert={selected}
          datasetId={selectedDatasetId}
          onClose={() => setSelected(null)}
          onResolve={handleResolve}
        />
      )}
    </div>
  );
}
