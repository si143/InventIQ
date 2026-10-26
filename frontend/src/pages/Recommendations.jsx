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

const recommendationTypes = [
  "All",
  "REORDER RECOMMENDATION",
  "REDUCE REPLENISHMENT",
  "SAFETY STOCK RECOMMENDATION",
  "MONITOR DEMAND",
  "SLOW MOVING PRODUCT",
  "DEMAND RECOVERY",
  "SUPPLIER / DEPENDENCY REVIEW",
  "SHOCK RESPONSE",
];

function RecommendationModal({ recommendation, onClose, onComplete }) {
  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      category={recommendation.recommendation_type}
      title={recommendation.title}
      subtitle={`Product: ${recommendation.product_id || "General Inventory"}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {recommendation.status === "open" && (
            <Button variant="gradient" onClick={() => onComplete(recommendation.id)}>
              ✓ Mark Complete
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Badge variant={recommendation.priority === "HIGH" ? "high" : recommendation.priority === "MEDIUM" ? "medium" : "low"}>
          {recommendation.priority} PRIORITY
        </Badge>
        {recommendation.status === "completed" && <Badge variant="low">COMPLETED</Badge>}
        <span className="text-xs text-slate-400">
          Created {recommendation.created_at ? new Date(recommendation.created_at).toLocaleString() : "-"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#171525] border border-slate-200 dark:border-[#2E2A4A] text-xs">
          <b className="text-slate-900 dark:text-white uppercase tracking-wider text-[10px]">WHAT:</b>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{recommendation.what}</p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#171525] border border-slate-200 dark:border-[#2E2A4A] text-xs">
          <b className="text-slate-900 dark:text-white uppercase tracking-wider text-[10px]">WHY:</b>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{recommendation.why}</p>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#171525] border border-slate-200 dark:border-[#2E2A4A] text-xs sm:col-span-2">
          <b className="text-[#D946A8] uppercase tracking-wider text-[10px]">SUGGESTED ACTION:</b>
          <p className="mt-1 font-semibold text-slate-800 dark:text-slate-200">{recommendation.suggested_action}</p>
        </div>
      </div>

      {recommendation.estimated_quantity != null && (
        <div className="mt-4 p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/60 text-xs text-indigo-800 dark:text-indigo-300">
          <b>Estimated Reorder Quantity: {Number(recommendation.estimated_quantity).toFixed(1)} units</b>
          <p className="mt-0.5 text-indigo-600 dark:text-indigo-400">
            Based on forecasted consumption rate and lead time safety buffer.
          </p>
        </div>
      )}
    </Modal>
  );
}

export default function Recommendations() {
  const { apiFetch } = useAuth();
  const { selectedDatasetId } = useDataset();
  const [recommendations, setRecommendations] = useState([]);
  const [summary, setSummary] = useState(null);
  const [runs, setRuns] = useState([]);
  const [runId, setRunId] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("All");
  const [priority, setPriority] = useState("All");
  const [status, setStatus] = useState("All");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const loadData = () => {
    setLoading(true);
    setRecommendations([]);
    setSummary(null);
    Promise.all([
      apiFetch(`${API_BASE}/recommendations?dataset_id=${selectedDatasetId}`).then((res) => (res.ok ? res.json() : [])),
      apiFetch(`${API_BASE}/recommendations/summary?dataset_id=${selectedDatasetId}`).then((res) => (res.ok ? res.json() : {})),
      apiFetch(`${API_BASE}/model-runs?dataset_id=${selectedDatasetId}`).then((res) => (res.ok ? res.json() : [])),
    ])
      .then(([recData, summaryData, runData]) => {
        setRecommendations(recData);
        setSummary(summaryData);
        const completedRuns = runData.filter((r) => r.status === "completed" && String(r.dataset_id) === String(selectedDatasetId));
        setRuns(completedRuns);
        if (!runId && completedRuns.length > 0) {
          setRunId(String(completedRuns[0].id));
        }
      })
      .catch(() => setError("Unable to load recommendations. Check backend API connection."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setRunId("");
    if (selectedDatasetId) loadData();
  }, [selectedDatasetId]);

  const filtered = useMemo(
    () =>
      recommendations.filter((item) => {
        const needle = search.trim().toLowerCase();
        const matchesSearch =
          !needle ||
          `${item.title} ${item.what} ${item.why} ${item.product_id || ""}`
            .toLowerCase()
            .includes(needle);
        const matchesType = type === "All" || item.recommendation_type === type;
        const matchesPriority = priority === "All" || item.priority === priority;
        const matchesStatus =
          status === "All" || (status === "Open" ? item.status === "open" : item.status === "completed");
        return matchesSearch && matchesType && matchesPriority && matchesStatus;
      }),
    [recommendations, search, type, priority, status]
  );

  const handleGenerate = async () => {
    if (!runId) {
      setError("Select a completed model run before generating recommendations.");
      return;
    }
    setGenerating(true);
    setError("");

    try {
      const response = await apiFetch(`${API_BASE}/recommendations/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_run_id: Number(runId) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Unable to generate recommendations.");
      loadData();
    } catch (err) {
      setError(err.message || "Unable to generate recommendations.");
    } finally {
      setGenerating(false);
    }
  };

  const handleComplete = async (id) => {
    try {
      const response = await apiFetch(`${API_BASE}/recommendations/${id}/complete`, {
        method: "PATCH",
      });
      if (!response.ok) throw new Error();
      setSelected(null);
      loadData();
    } catch {
      setError("Unable to complete recommendation.");
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <PageHeader
        category="INVENTORY INTELLIGENCE"
        title="Inventory Recommendations"
        subtitle="AI-assisted action plans based on demand projections and inventory risk signals."
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
              ⚡ Generate Action Recommendations
            </Button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={loadData} />}

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card hover>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>TOTAL RECOMMENDATIONS</span>
            <span className="text-sm">💡</span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-slate-900 dark:text-white">
            {summary ? summary.total_recommendations : "Not available"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Action items identified</p>
        </Card>

        <Card hover>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>HIGH PRIORITY</span>
            <span className="text-sm">🔥</span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-[#D946A8]">
            {summary ? summary.high_priority : "Not available"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Urgent operational moves</p>
        </Card>

        <Card hover>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>PENDING ACTION</span>
            <span className="text-sm">⏳</span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-[#7C5CFC]">
            {summary ? summary.open : "Not available"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Open recommendations</p>
        </Card>

        <Card hover>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>COMPLETED ACTIONS</span>
            <span className="text-sm">✅</span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
            {summary ? summary.total_recommendations - summary.open : "Not available"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Executed by operations</p>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card padding="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            placeholder="Search recommendations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {recommendationTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>

          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="All">All Priorities</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </Select>

          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="All">All Statuses</option>
            <option value="Open">Open</option>
            <option value="Completed">Completed</option>
          </Select>
        </div>
      </Card>

      {/* Recommendations Cards Grid */}
      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          Generating AI recommendation cards...
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="💡"
          title="No recommendations found"
          description="Select a completed model run and click 'Generate Action Recommendations'."
          actionLabel="Generate Recommendations"
          onAction={handleGenerate}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((item) => (
            <Card key={item.id} className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#7C5CFC]">
                    {item.recommendation_type}
                  </span>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                    {item.title}
                  </h3>
                </div>
                <Badge
                  variant={
                    item.priority === "HIGH"
                      ? "high"
                      : item.priority === "MEDIUM"
                      ? "medium"
                      : "low"
                  }
                >
                  {item.priority}
                </Badge>
              </div>

              {item.product_id && (
                <p className="text-xs font-bold text-[#D946A8]">
                  SKU: {item.product_id}
                </p>
              )}

              <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                <p>
                  <b className="text-slate-800 dark:text-slate-100">ACTION:</b>{" "}
                  <span className="text-slate-900 dark:text-white font-semibold">
                    {item.suggested_action}
                  </span>
                </p>
                <p>
                  <b className="text-slate-800 dark:text-slate-100">REASON:</b> {item.why}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-[#2E2A4A]/60 flex items-center justify-between">
                <span className="text-[10px] text-slate-400">
                  {item.status === "completed" ? "✓ Completed" : "Action Pending"}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelected(item)}
                  >
                    View Details
                  </Button>
                  {item.status === "open" && (
                    <Button
                      variant="gradient"
                      size="sm"
                      onClick={() => handleComplete(item.id)}
                    >
                      Mark Done
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <RecommendationModal
          recommendation={selected}
          onClose={() => setSelected(null)}
          onComplete={handleComplete}
        />
      )}
    </div>
  );
}
