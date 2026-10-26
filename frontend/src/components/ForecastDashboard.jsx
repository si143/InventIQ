import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "./ui/PageHeader";
import Card, { CardTitle } from "./ui/Card";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import Select from "./ui/Select";
import Table, { TableRow, TableCell } from "./ui/Table";
import Modal from "./ui/Modal";
import ErrorState from "./ui/ErrorState";
import EmptyState from "./ui/EmptyState";
import ForecastCharts, { DEFAULT_FORECAST_CHART_IDS } from "./ForecastCharts";
import { useAuth } from "../context/AuthContext";
import { useDataset } from "../context/DatasetContext";
import { formatDate, loadSettings } from "../utils/settings";

const API_BASE = "/api";
const horizons = [7, 14, 30, 60, 90];

function metric(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "-";
}

function confidenceLabel(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return "-";
  return `${(confidence <= 1 ? confidence * 100 : confidence).toFixed(0)}%`;
}

function dateLabel(value) {
  return formatDate(value);
}

function productName(row) {
  return row?.product_name || "Name unavailable";
}

function ForecastDetails({ row, onClose }) {
  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      category="FORECAST DATAIL"
      title={dateLabel(row.forecast_date)}
      subtitle={`${row.product_id} · ${productName(row)}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ["Product SKU", row.product_id],
          ["Product name", productName(row)],
          ["Predicted demand", metric(row.predicted_demand)],
          ["Expected range", `${metric(row.lower_bound)} - ${metric(row.upper_bound)}`],
          ["Confidence level", confidenceLabel(row.confidence_level)],
          ["Model used", row.model_name],
          ["Dataset", row.dataset_name],
        ].map(([label, val]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 dark:border-[#2E2A4A] bg-slate-50/70 dark:bg-[#171525]/60 p-3.5"
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {label}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
              {val}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default function ForecastDashboard({ onOpenRecommendations }) {
  const { datasets, selectedDatasetId, setSelectedDatasetId } = useDataset();
  const { apiFetch, user } = useAuth();
  const [runs, setRuns] = useState([]);
  const [modelRunsLoading, setModelRunsLoading] = useState(false);
  const [modelRunsError, setModelRunsError] = useState("");
  const [modelRunsReloadKey, setModelRunsReloadKey] = useState(0);
  const [runId, setRunId] = useState("");
  const [horizon, setHorizon] = useState(() => loadSettings().forecasting.defaultHorizon);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [demandHistory, setDemandHistory] = useState([]);
  const [demandHistoryLoading, setDemandHistoryLoading] = useState(false);
  const [demandHistoryError, setDemandHistoryError] = useState("");
  const [selectedChartIds, setSelectedChartIds] = useState(DEFAULT_FORECAST_CHART_IDS);
  const [showUncertaintyBands, setShowUncertaintyBands] = useState(() => loadSettings().forecasting.uncertaintyBands);
  const [product, setProduct] = useState("All Products");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoredForDataset, setRestoredForDataset] = useState("");
  const [error, setError] = useState("");
  const selectionKey = selectedDatasetId ? `inventiq_forecast_view_${user?.id || "account"}_${selectedDatasetId}` : "";

  useEffect(() => {
    const syncSettings = () => {
      const settings = loadSettings();
      setShowUncertaintyBands(settings.forecasting.uncertaintyBands);
      setHorizon(settings.forecasting.defaultHorizon);
    };
    window.addEventListener("inventiq-settings-updated", syncSettings);
    return () => window.removeEventListener("inventiq-settings-updated", syncSettings);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreForecastView() {
      setRestoredForDataset("");
      setError("");
      setRows([]);
      setSummary(null);
      setRunId("");
      setRuns([]);
      setModelRunsError("");
      setProduct("All Products");
      setPage(1);
      setSelectedChartIds(DEFAULT_FORECAST_CHART_IDS);

      if (!selectedDatasetId) {
        setHistory([]);
        setModelRunsLoading(false);
        setRestoring(false);
        return;
      }

      setRestoring(true);
      setModelRunsLoading(true);
      try {
        const readResponse = async (response, fallback) => {
          let payload = null;
          try {
            payload = await response.json();
          } catch {
            payload = null;
          }
          if (!response.ok) {
            const detail = typeof payload?.detail === "string" ? payload.detail : "";
            throw new Error(detail || `${fallback} (HTTP ${response.status}).`);
          }
          return payload;
        };
        const loadCompletedRuns = async () => {
          try {
            const runData = await readResponse(
              await apiFetch(`${API_BASE}/model-runs?dataset_id=${encodeURIComponent(selectedDatasetId)}`),
              "Unable to load completed model runs",
            );
            if (!Array.isArray(runData)) throw new Error("The model-runs endpoint returned an invalid response.");
            const completedRuns = runData.filter((run) =>
              String(run.status || "").toLowerCase() === "completed"
              && String(run.dataset_id) === String(selectedDatasetId)
            );
            if (!cancelled) {
              setRuns(completedRuns);
              setModelRunsError("");
              setModelRunsLoading(false);
            }
            return completedRuns;
          } catch (runError) {
            const message = runError.message || "Unable to load completed model runs.";
            if (!cancelled) {
              setRuns([]);
              setModelRunsError(message);
              setModelRunsLoading(false);
              console.error("Unable to load completed model runs.", {
                endpoint: `${API_BASE}/model-runs`,
                datasetId: selectedDatasetId,
                message,
              });
            }
            return [];
          }
        };
        const loadForecastHistory = async () => {
          try {
            const historyData = await readResponse(
              await apiFetch(`${API_BASE}/forecasts/history?dataset_id=${encodeURIComponent(selectedDatasetId)}`),
              "Unable to load saved forecasts",
            );
            if (!Array.isArray(historyData)) throw new Error("The forecast-history endpoint returned an invalid response.");
            return historyData;
          } catch (historyError) {
            const message = historyError.message || "Unable to load saved forecasts.";
            if (!cancelled) {
              setError(message);
              console.error("Unable to load saved forecasts.", {
                endpoint: `${API_BASE}/forecasts/history`,
                datasetId: selectedDatasetId,
                message,
              });
            }
            return null;
          }
        };
        const [completedRuns, historyData] = await Promise.all([
          loadCompletedRuns(),
          loadForecastHistory(),
        ]);
        if (cancelled) return;
        const datasetHistory = (historyData || [])
          .filter((item) => String(item.dataset_id) === String(selectedDatasetId))
          .sort((left, right) => {
            const dateOrder = new Date(right.generation_date || 0).getTime() - new Date(left.generation_date || 0).getTime();
            return dateOrder || Number(right.model_run_id) - Number(left.model_run_id);
          });
        setHistory(datasetHistory);

        let savedSelection = {};
        try {
          savedSelection = JSON.parse(localStorage.getItem(selectionKey) || "{}");
        } catch {
          savedSelection = {};
        }
        const savedChartIds = Array.isArray(savedSelection.chartIds)
          ? savedSelection.chartIds.filter((id) => typeof id === "string")
          : DEFAULT_FORECAST_CHART_IDS;
        setSelectedChartIds(savedChartIds);

        const savedRun = completedRuns.find((run) => String(run.id) === String(savedSelection.modelRunId));
        const validHistory = datasetHistory.filter((item) =>
          completedRuns.some((run) => String(run.id) === String(item.model_run_id))
        );
        const savedHistory = validHistory.find((item) => String(item.model_run_id) === String(savedSelection.modelRunId));
        const latestHistory = savedHistory || validHistory[0];
        const restoredRunId = savedRun?.id ?? latestHistory?.model_run_id ?? "";
        const allowedHorizons = [7, 14, 30, 60, 90];
        const storedHorizon = Number(savedSelection.horizon);
        const restoredHorizon = allowedHorizons.includes(storedHorizon)
          ? storedHorizon
          : latestHistory?.horizon || loadSettings().forecasting.defaultHorizon;
        setRunId(String(restoredRunId || ""));
        setHorizon(restoredHorizon);

        if (historyData && latestHistory?.model_run_id) {
          const query = `model_run_id=${encodeURIComponent(latestHistory.model_run_id)}&dataset_id=${encodeURIComponent(selectedDatasetId)}`;
          const [forecastsResponse, summaryResponse] = await Promise.all([
            apiFetch(`${API_BASE}/forecasts?${query}`),
            apiFetch(`${API_BASE}/forecasts/summary?${query}`),
          ]);
          if (!forecastsResponse.ok || !summaryResponse.ok) throw new Error("Saved forecast history was found, but its result rows could not be restored.");
          const [forecastData, summaryData] = await Promise.all([forecastsResponse.json(), summaryResponse.json()]);
          if (cancelled) return;
          const restoredRows = Array.isArray(forecastData) ? forecastData : [];
          setRows(restoredRows);
          setSummary(restoredRows.length ? summaryData : null);
          setProduct(restoredRows.some((row) => row.product_id === savedSelection.productId) ? savedSelection.productId : "All Products");
        }

        setRestoredForDataset(String(selectedDatasetId));
      } catch (restoreError) {
        if (!cancelled) {
          setError(restoreError.message || "Unable to restore saved forecasts.");
          console.error("Unable to restore saved forecast results.", {
            datasetId: selectedDatasetId,
            message: restoreError.message || "Unable to restore saved forecasts.",
          });
        }
      } finally {
        if (!cancelled) {
          setModelRunsLoading(false);
          setRestoring(false);
        }
      }
    }

    restoreForecastView();
    return () => { cancelled = true; };
  }, [apiFetch, modelRunsReloadKey, selectedDatasetId, selectionKey]);

  useEffect(() => {
    if (!selectionKey || restoredForDataset !== String(selectedDatasetId)) return;
    localStorage.setItem(selectionKey, JSON.stringify({
      modelRunId: runId || null,
      horizon: Number(horizon),
      productId: product === "All Products" ? null : product,
      chartIds: selectedChartIds,
    }));
  }, [horizon, product, restoredForDataset, runId, selectedChartIds, selectedDatasetId, selectionKey]);

  const availableRuns = useMemo(
    () => runs.filter((r) => String(r.dataset_id) === String(selectedDatasetId)),
    [runs, selectedDatasetId]
  );
  const selectedRun = availableRuns.find((run) => String(run.id) === String(runId)) || null;

  useEffect(() => {
    if (!selectedDatasetId || !runId) {
      setDemandHistory([]);
      setDemandHistoryError("");
      setDemandHistoryLoading(false);
      return undefined;
    }

    let cancelled = false;
    setDemandHistory([]);
    setDemandHistoryError("");
    setDemandHistoryLoading(true);
    apiFetch(`${API_BASE}/datasets/${encodeURIComponent(selectedDatasetId)}/demand-history?model_run_id=${encodeURIComponent(runId)}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Unable to load historical demand.");
        if (!cancelled) setDemandHistory(Array.isArray(payload.rows) ? payload.rows : []);
      })
      .catch((historyError) => {
        if (!cancelled) setDemandHistoryError(historyError.message || "Unable to load historical demand.");
      })
      .finally(() => {
        if (!cancelled) setDemandHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, [apiFetch, runId, selectedDatasetId]);
  const productGroups = useMemo(() => {
    const groups = new Map();
    rows.forEach((row) => {
      if (!groups.has(row.product_id)) {
        groups.set(row.product_id, {
          productId: row.product_id,
          productName: productName(row),
          rows: [],
        });
      }
      groups.get(row.product_id).rows.push(row);
    });
    return Array.from(groups.values()).map((group) => ({
      ...group,
      rows: group.rows.slice().sort((left, right) => left.forecast_date.localeCompare(right.forecast_date)),
    }));
  }, [rows]);
  const products = useMemo(() => ["All Products", ...productGroups.map((group) => group.productId)], [productGroups]);
  const selectedGroup = productGroups.find((group) => group.productId === product) || null;
  const visibleRows = selectedGroup?.rows || [];
  const pageRows = visibleRows.slice((page - 1) * 10, page * 10);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / 10));
  const selectedProductSummary = useMemo(() => {
    if (!selectedGroup) return null;
    const values = selectedGroup.rows.map((row) => Number(row.predicted_demand)).filter(Number.isFinite);
    const firstRow = selectedGroup.rows[0];
    return {
      average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      peak: values.length ? Math.max(...values) : null,
      minimum: values.length ? Math.min(...values) : null,
      horizon: selectedGroup.rows.length,
      confidence: firstRow?.confidence_level,
      model: firstRow?.model_name || summary?.model_used,
    };
  }, [selectedGroup, summary]);
  const productCards = useMemo(() => productGroups.map((group) => {
    const values = group.rows.map((row) => Number(row.predicted_demand)).filter(Number.isFinite);
    return {
      ...group,
      average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      peak: values.length ? Math.max(...values) : null,
    };
  }), [productGroups]);

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!selectedRun || !selectedDatasetId) {
      setError("Select a completed model run before generating a forecast.");
      return;
    }
    setLoading(true);
    setError("");
    setPage(1);

    try {
      const response = await apiFetch(`${API_BASE}/forecasts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_run_id: Number(runId),
          dataset_id: Number(selectedDatasetId),
          forecast_horizon: Number(horizon),
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Unable to generate forecast.");

      const [summaryResponse, historyResponse] = await Promise.all([
        apiFetch(`${API_BASE}/forecasts/summary?model_run_id=${runId}&dataset_id=${selectedDatasetId}`),
        apiFetch(`${API_BASE}/forecasts/history?dataset_id=${selectedDatasetId}`),
      ]);
      if (!summaryResponse.ok || !historyResponse.ok) throw new Error("Forecast was generated, but its summary or history could not be refreshed.");
      const [nextSummary, historyData] = await Promise.all([summaryResponse.json(), historyResponse.json()]);
      setRows(Array.isArray(payload.forecasts) ? payload.forecasts : []);
      setSummary(nextSummary);
      setHistory((Array.isArray(historyData) ? historyData : []).filter((item) => String(item.dataset_id) === String(selectedDatasetId)));
      setProduct("All Products");
    } catch (err) {
      setError(err.message || "Unable to generate forecast.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <PageHeader
        category="AI FORECASTING"
        title="Demand Forecasts"
        subtitle="Projected demand curves and uncertainty bounds from trained machine learning models."
      />

      {error && <ErrorState message={error} />}
      {restoring && <Card className="p-5 text-center text-sm text-slate-500">Restoring the latest saved forecast…</Card>}

      {/* Forecast Configuration Controls */}
      <form onSubmit={handleGenerate}>
        <Card className="space-y-4">
          <CardTitle subtitle="Select trained model and forecast horizon">
            Generate New Forecast
          </CardTitle>
          <div className="grid gap-4 md:grid-cols-4">
            <Select
              label="Dataset"
              value={selectedDatasetId}
              onChange={(e) => setSelectedDatasetId(e.target.value)}
            >
              <option value="">All Datasets</option>
              {datasets.map((d) => (
                <option key={d.dataset_id} value={d.dataset_id}>
                  {d.filename}
                </option>
              ))}
            </Select>

            <Select
              label="Trained Model Run"
              value={runId}
              onChange={(e) => {
                setRunId(e.target.value);
                setRows([]);
                setSummary(null);
                setProduct("All Products");
                setPage(1);
              }}
              disabled={!selectedDatasetId || modelRunsLoading}
              error={modelRunsError}
              helper={
                modelRunsLoading
                  ? "Loading completed models…"
                  : !selectedDatasetId
                    ? "Select a dataset to load its completed models."
                    : availableRuns.length === 0
                      ? "No completed models found. Train a model first."
                      : `${availableRuns.length} completed ${availableRuns.length === 1 ? "model" : "models"} available.`
              }
            >
              <option value="">
                {modelRunsLoading
                  ? "Loading completed models…"
                  : availableRuns.length
                    ? "Select completed model"
                    : "No completed models found"}
              </option>
              {availableRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.model_name || "Unnamed model"}
                  {r.model_type ? ` · ${r.model_type}` : ""}
                  {` · Run #${r.id}`}
                </option>
              ))}
            </Select>
            {modelRunsError && (
              <div className="md:col-span-4 -mt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setModelRunsReloadKey((key) => key + 1)}
                  disabled={modelRunsLoading}
                >
                  {modelRunsLoading ? "Retrying…" : "Retry loading models"}
                </Button>
              </div>
            )}

            <Select
              label="Horizon"
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
            >
              {horizons.map((h) => (
                <option key={h} value={h}>
                  {h} Days
                </option>
              ))}
            </Select>

            <div className="flex items-end">
              <Button
                variant="gradient"
                type="submit"
                loading={loading}
                disabled={!selectedRun || modelRunsLoading || restoring}
                className="w-full py-2.5"
              >
                {loading ? "Generating..." : "📈 Run Forecast"}
              </Button>
            </div>
          </div>
        </Card>
      </form>

      {selectedDatasetId && !restoring && !loading && !summary && !history.length && !error && <EmptyState
        title="No forecasts generated for this dataset"
        description="Select a completed model run and horizon above, then run a forecast to view its summary and product results here."
      />}

      {/* Top KPI Cards (when summary available) */}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card hover>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              FORECAST HORIZON
            </div>
            <p className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-white">
              {summary.forecast_horizon} Days
            </p>
            <p className="mt-1 text-xs text-slate-500">{summary.model_used}</p>
          </Card>

          <Card hover>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              PRODUCTS FORECASTED
            </div>
            <p className="mt-2 text-3xl font-extrabold text-[#7C5CFC]">
              {products.length - 1 || 1} SKUs
            </p>
            <p className="mt-1 text-xs text-slate-500">Active catalog items</p>
          </Card>

          <Card hover>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              AVERAGE DAILY DEMAND
            </div>
            <p className="mt-2 text-3xl font-extrabold text-[#D946A8]">
              {metric(summary.average_predicted_demand)} units
            </p>
            <p className="mt-1 text-xs text-slate-500">Per forecast period</p>
          </Card>

          <Card hover>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              FORECAST CONFIDENCE
            </div>
            <p className="mt-2 text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {rows.length ? confidenceLabel(rows[0].confidence_level) : "-"}
            </p>
            <p className="mt-1 text-xs text-slate-500">Stored model interval</p>
          </Card>
        </div>
      )}

      <ForecastCharts
        history={demandHistory}
        forecastRows={rows}
        historyLoading={demandHistoryLoading}
        historyError={demandHistoryError}
        selectedProductId={product}
        modelRun={selectedRun}
        selectedChartIds={selectedChartIds}
        onChartSelectionChange={setSelectedChartIds}
        showUncertaintyBands={showUncertaintyBands}
      />

      {summary && product === "All Products" && (
        <Card className="space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <CardTitle subtitle="One summary card per forecasted product. Select a product to inspect its daily values.">Product Forecast Overview</CardTitle>
            <div className="flex flex-col items-stretch gap-2 sm:items-end"><span className="text-xs font-semibold text-slate-400">{summary.model_used} · {summary.forecast_horizon} days</span><Select value={product} onChange={(e) => { setProduct(e.target.value); setPage(1); }} className="min-w-[220px]"><option value="All Products">All Products</option>{productGroups.map((group) => <option key={group.productId} value={group.productId}>{group.productId} · {group.productName}</option>)}</Select></div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {productCards.map((card) => (
              <div key={card.productId} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-[#2E2A4A] dark:bg-[#211E35]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-400">{card.productId}</p>
                    <h3 className="mt-1 text-base font-bold text-slate-900 dark:text-white">{card.productName}</h3>
                  </div>
                  <Badge variant="purple">{card.rows.length} days</Badge>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
                  <div><p className="text-slate-400">Average forecast</p><p className="mt-1 font-bold text-slate-900 dark:text-white">{metric(card.average)} units/day</p></div>
                  <div><p className="text-slate-400">Peak forecast</p><p className="mt-1 font-bold text-[#D946A8]">{metric(card.peak)} units/day</p></div>
                </div>
                <Button variant="secondary" size="sm" className="mt-5 w-full" onClick={() => { setProduct(card.productId); setPage(1); }}>View Forecast</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {summary && product !== "All Products" && selectedGroup && (
        <>
          <Card className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Selected Product</p>
                <h2 className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">{selectedGroup.productId}</h2>
                <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{selectedGroup.productName}</p>
                <p className="mt-2 text-xs text-slate-400">{selectedProductSummary.model} · {selectedProductSummary.horizon}-day forecast</p>
              </div>
              <Select value={product} onChange={(e) => { setProduct(e.target.value); setPage(1); }} className="max-w-[220px]">
                {products.map((item) => <option key={item} value={item}>{item === "All Products" ? item : `${item} · ${productGroups.find((group) => group.productId === item)?.productName || "Name unavailable"}`}</option>)}
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[["Average demand", selectedProductSummary.average], ["Peak demand", selectedProductSummary.peak], ["Minimum demand", selectedProductSummary.minimum]].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-[#2E2A4A] dark:bg-[#171525]/60"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">{metric(value)} <span className="text-xs font-semibold text-slate-400">units/day</span></p></div>)}
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-[#2E2A4A] dark:bg-[#171525]/60"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Forecast horizon</p><p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">{selectedProductSummary.horizon} <span className="text-xs font-semibold text-slate-400">days</span></p></div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-[#2E2A4A] dark:bg-[#171525]/60"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Confidence</p><p className="mt-1 text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{confidenceLabel(selectedProductSummary.confidence)}</p></div>
            </div>
          </Card>

          <Table headers={["Forecast Date", "Predicted Demand", "Lower Bound", "Upper Bound", "Confidence", "Actions"]}>
            {pageRows.map((row) => <TableRow key={row.id}>
              <TableCell className="text-xs font-semibold">{dateLabel(row.forecast_date)}</TableCell>
              <TableCell className="font-bold text-[#D946A8]">{metric(row.predicted_demand)} units</TableCell>
              <TableCell>{metric(row.lower_bound)}</TableCell>
              <TableCell>{metric(row.upper_bound)}</TableCell>
              <TableCell><Badge variant="purple">{confidenceLabel(row.confidence_level)}</Badge></TableCell>
              <TableCell><Button variant="secondary" size="sm" onClick={() => setSelected(row)}>View</Button></TableCell>
            </TableRow>)}
          </Table>
          {pageCount > 1 && <div className="flex items-center justify-between text-xs text-slate-500"><span>Showing {(page - 1) * 10 + 1}-{Math.min(page * 10, visibleRows.length)} of {visibleRows.length} forecast days</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div>}
        </>
      )}

      {/* Forecast History */}
      {history.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Forecast Generation History
          </h3>
          <Table headers={["Generation Date", "Dataset", "Model", "Horizon", "Forecast Count"]}>
            {history.filter((item) => String(item.dataset_id) === String(selectedDatasetId)).slice(0, 6).map((item) => (
              <TableRow key={item.model_run_id}>
                <TableCell className="text-xs">
                  {item.generation_date ? new Date(item.generation_date).toLocaleString() : "-"}
                </TableCell>
                <TableCell>{item.dataset_name}</TableCell>
                <TableCell bold>{item.model_name}</TableCell>
                <TableCell>{item.horizon} Days</TableCell>
                <TableCell>{item.forecast_count}</TableCell>
              </TableRow>
            ))}
          </Table>
        </div>
      )}

      {selected && <ForecastDetails row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
