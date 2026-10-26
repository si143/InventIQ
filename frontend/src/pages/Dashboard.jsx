import React, { useEffect, useMemo, useState, useRef } from "react";
import PageHeader from "../components/ui/PageHeader";
import Card, { CardTitle } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Table, { TableRow, TableCell } from "../components/ui/Table";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Modal from "../components/ui/Modal";
import AIInsightCard from "../components/ui/AIInsightCard";
import DatasetManagement from "../components/DatasetManagement";
import DashboardAnalytics from "../components/DashboardAnalytics";
import ModelConfiguration from "../components/ModelConfiguration";
import ForecastDashboard from "../components/ForecastDashboard";
import Alerts from "./Alerts";
import Recommendations from "./Recommendations";
import ProductDependencies from "./ProductDependencies";
import Obsolescence from "./Obsolescence";
import Simulations from "./Simulations";
import RecoveryPlanner from "./RecoveryPlannerView";
import Settings from "./Settings";
import Help from "./Help";
import { useAuth } from "../context/AuthContext";
import { useDataset } from "../context/DatasetContext";
import { deleteDemoDataset, getDemoDatasets, saveDemoDataset } from "../utils/datasetStorage";
import { analyzeDemoCsv } from "../utils/demoDatasetAnalytics";

const API_BASE = "/api";

const allowedUploadExtensions = ["csv", "xlsx", "xls"];

function formatMetricValue(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return Number(value).toFixed(digits);
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "Not available";
  }
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function smoothLinePath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M${points[0].x} ${points[0].y} L${points[1].x} ${points[1].y}`;

  return points.reduce((path, point, index) => {
    if (index === 0) return `M${point.x} ${point.y}`;
    const previous = points[index - 1];
    const beforePrevious = points[Math.max(0, index - 2)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const controlOne = { x: previous.x + (point.x - beforePrevious.x) / 6, y: previous.y + (point.y - beforePrevious.y) / 6 };
    const controlTwo = { x: point.x - (next.x - previous.x) / 6, y: point.y - (next.y - previous.y) / 6 };
    return `${path} C${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${point.x} ${point.y}`;
  }, "");
}

function getUploadFileKey(file) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function PersistentPageSlot({ active, children }) {
  const [hasBeenVisited, setHasBeenVisited] = useState(active);

  useEffect(() => {
    if (active) setHasBeenVisited(true);
  }, [active]);

  return (
    <div hidden={!active} aria-hidden={!active}>
      {active || hasBeenVisited ? children : null}
    </div>
  );
}

export default function Dashboard({ activePage = "dashboard", onNavigatePage, searchTerm = "", onSearchChange }) {
  const { datasets, selectedDatasetId, setSelectedDatasetId, refreshDatasets } = useDataset();
  const { apiFetch, token } = useAuth();
  const isDemoSession = import.meta.env.DEV && token?.startsWith("demo-");
  const [activePeriod, setActivePeriod] = useState("7D");
  const [selectedKpi, setSelectedKpi] = useState(null);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [modalType, setModalType] = useState(null);
  const [riskFilter, setRiskFilter] = useState("All");
  const [sortKey, setSortKey] = useState("name");
  const [hoverIndex, setHoverIndex] = useState(null);
  const [toast, setToast] = useState(null);

  // Upload modal state
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recentDatasets, setRecentDatasets] = useState([]);
  const [datasetRefreshToken, setDatasetRefreshToken] = useState(0);
  const fileInputRef = useRef(null);

  // API states
  const [riskAlerts, setRiskAlerts] = useState([]);
  const [alertSummary, setAlertSummary] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [datasetSummary, setDatasetSummary] = useState(null);
  const [forecastRows, setForecastRows] = useState([]);
  const [forecastSummary, setForecastSummary] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [dependencySummary, setDependencySummary] = useState(null);
  const [obsolescenceSummary, setObsolescenceSummary] = useState(null);
  const [obsolescenceRows, setObsolescenceRows] = useState([]);
  const [simulationHistory, setSimulationHistory] = useState([]);
  const [latestModelRun, setLatestModelRun] = useState(null);
  const [datasetPreview, setDatasetPreview] = useState(null);
  const [recoveryPlan, setRecoveryPlan] = useState(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const activeDatasetId = selectedDatasetId;
  const hasActiveDataset = Boolean(
    activeDatasetId && datasets.some((dataset) => String(dataset.dataset_id) === String(activeDatasetId))
  );
  const activeDemoDataset = isDemoSession
    ? datasets.find((dataset) => String(dataset.dataset_id) === String(activeDatasetId) && dataset.is_demo)
    : null;
  const hasDemoAnalytics = Boolean(activeDemoDataset?.analytics);

  const chartSeries = useMemo(() => {
    const labelCount = activePeriod === "7D" ? 7 : activePeriod === "30D" ? 6 : activePeriod === "90D" ? 6 : 6;
    const selectedForecastRows = forecastRows.slice(-labelCount);
    const forecastSeries = selectedForecastRows.map((row) => ({
      label: toDateLabel(row.forecast_date),
      value: safeNumber(row.predicted_demand),
    }));
    const lowerBounds = selectedForecastRows.map((row) => row.lower_bound == null ? null : safeNumber(row.lower_bound));
    const upperBounds = selectedForecastRows.map((row) => row.upper_bound == null ? null : safeNumber(row.upper_bound));

    const historySeries = datasetSummary?.demand_history?.length
      ? datasetSummary.demand_history
          .slice(-labelCount)
          .map((point) => ({ label: point.label, value: safeNumber(point.value) }))
      : datasetPreview && Array.isArray(datasetPreview.preview)
      ? Object.values(
          datasetPreview.preview.reduce((acc, row) => {
            const key = Object.keys(row).find((column) => /date|time|sales_date/i.test(column));
            const demandKey = Object.keys(row).find((column) => /^(units_sold|units|demand|quantity|sales)$/i.test(column));
            const date = row[key];
            const value = safeNumber(row[demandKey]);
            if (!key || !demandKey || !date || Number.isNaN(new Date(date).getTime())) return acc;
            const label = toDateLabel(date);
            acc[label] = (acc[label] || 0) + value;
            return acc;
          }, {})
        ).slice(-labelCount)
      : [];

    const labels = forecastSeries.length
      ? forecastSeries.map((row) => row.label)
      : historySeries.map((row) => row.label);
    const values = historySeries.slice(-labels.length).map((row) => safeNumber(row.value));
    const forecast = forecastSeries.map((row) => safeNumber(row.value));
    const allValues = [...values, ...forecast, ...lowerBounds, ...upperBounds].filter(Number.isFinite);
    const minimum = allValues.length ? Math.min(0, ...allValues) : 0;
    const maximum = allValues.length ? Math.max(...allValues, minimum + 1) : 1;
    const pointY = (value) => {
      const y = 165 - ((safeNumber(value) - minimum) / (maximum - minimum)) * 125;
      return Number.isFinite(y) ? y : 165;
    };

    return {
      labels,
      values,
      forecast,
      lowerBounds,
      upperBounds,
      minimum,
      maximum,
      historyY: values.map(pointY),
      forecastY: forecast.map(pointY),
      lowerY: lowerBounds.map((value) => value == null ? null : pointY(value)),
      upperY: upperBounds.map((value) => value == null ? null : pointY(value)),
    };
  }, [activePeriod, datasetPreview, datasetSummary, forecastRows]);

  const chartX = (index) => chartSeries.labels.length > 1
    ? 52 + index * (568 / (chartSeries.labels.length - 1))
    : 336;
  const historyPoints = chartSeries.values.map((value, index) => ({ x: chartX(index), y: chartSeries.historyY[index], value, index }));
  const forecastPoints = chartSeries.forecast.map((value, index) => ({ x: chartX(index), y: chartSeries.forecastY[index], value, index }));
  const bandPoints = chartSeries.forecast.map((_, index) => ({
    x: chartX(index),
    upper: chartSeries.upperY[index],
    lower: chartSeries.lowerY[index],
  })).filter((point) => point.upper != null && point.lower != null);
  const forecastBandPath = bandPoints.length
    ? `M${bandPoints.map((point) => `${point.x} ${point.upper}`).join(" L")} L${bandPoints.slice().reverse().map((point) => `${point.x} ${point.lower}`).join(" L")} Z`
    : "";
  const confidenceUpperPath = smoothLinePath(bandPoints.map((point) => ({ x: point.x, y: point.upper })));
  const confidenceLowerPath = smoothLinePath(bandPoints.map((point) => ({ x: point.x, y: point.lower })));
  const chartTicks = [0, 1, 2, 3].map((tick) => ({
    y: 24 + tick * 48,
    value: Math.round(chartSeries.maximum - ((chartSeries.maximum - chartSeries.minimum) * tick) / 3),
  }));

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timeout);
  }, [toast]);

  const showToast = (msg) => setToast(msg);

  const kpis = useMemo(() => {
    const productValue = hasActiveDataset && datasetSummary?.total_products_tracked != null ? Number(datasetSummary.total_products_tracked).toLocaleString() : "—";
    const forecastValue = !hasActiveDataset ? "—" : forecastSummary ? `${formatMetricValue(forecastSummary.total_predicted_demand)} units` : "Not analyzed";
    const healthValue = hasActiveDataset ? datasetSummary?.inventory_health || "Not available" : "—";
    const riskValue = !hasActiveDataset ? "—" : alertSummary ? `${alertSummary.unresolved} open` : "Not available";
    const recommendationValue = !hasActiveDataset ? "—" : recommendations.length ? `${recommendations.length} pending` : "No active actions";
    const obsolescenceValue = !hasActiveDataset ? "—" : obsolescenceSummary ? `${obsolescenceSummary.high_risk_count + obsolescenceSummary.critical_risk_count} high risk` : "Analysis not run";
    const dependencyValue = !hasActiveDataset ? "—" : dependencySummary ? `${dependencySummary.total_relationships} relationships` : "Analysis not run";
    const simulationValue = !hasActiveDataset ? "—" : simulationHistory.length ? `${simulationHistory.length} runs` : "No runs";

    return [
      {
        id: "products",
        label: "Total Products Tracked",
        value: productValue,
        change: !hasActiveDataset ? "Upload a dataset" : datasetSummary?.row_count ? `${datasetSummary.row_count.toLocaleString()} rows` : "No rows",
        isUp: true,
        tone: "purple",
        detail: "Active catalog items monitored",
        icon: "📦",
      },
      {
        id: "forecast-demand",
        label: "Forecasted Demand",
        value: forecastValue,
        change: !hasActiveDataset ? "Upload a dataset" : latestModelRun ? `Model: ${latestModelRun.model_name}` : activeDemoDataset ? "Demo trend estimate" : "Awaiting forecast",
        isUp: true,
        tone: "pink",
        detail: activeDemoDataset ? "Based on uploaded sales history" : "Selected dataset forecast total",
        icon: "📈",
      },
      {
        id: "health",
        label: "Inventory Health",
        value: healthValue,
        change: !hasActiveDataset ? "Upload a dataset" : datasetSummary?.has_inventory_columns ? "Stock data available" : "No stock data",
        isUp: true,
        tone: "emerald",
        detail: "Operational stock health",
        icon: "🛡️",
      },
      {
        id: "risk",
        label: "Active Risks",
        value: riskValue,
        change: !hasActiveDataset ? "Upload a dataset" : alertSummary ? `${alertSummary.high_severity} high severity` : "Not available",
        isUp: false,
        tone: "rose",
        detail: "Unresolved risk signals",
        icon: "🚨",
      },
      {
        id: "recommendations",
        label: "AI Recommendations",
        value: recommendationValue,
        change: !hasActiveDataset ? "Upload a dataset" : recommendations.length ? `${recommendations.length} actions ready` : "No pending actions",
        isUp: true,
        tone: "amber",
        detail: "Open operational actions",
        icon: "💡",
      },
      {
        id: "obsolescence",
        label: "Obsolescence Risk",
        value: obsolescenceValue,
        change: !hasActiveDataset ? "Upload a dataset" : obsolescenceSummary ? `${obsolescenceSummary.products_analyzed} analyzed` : "Analysis not run",
        isUp: false,
        tone: "rose",
        detail: "Commercial demand weakening signals",
        icon: "📉",
      },
      {
        id: "dependencies",
        label: "Dependency Insights",
        value: dependencyValue,
        change: !hasActiveDataset ? "Upload a dataset" : dependencySummary ? `${dependencySummary.strong_relationships} strong` : "Analysis not run",
        isUp: true,
        tone: "purple",
        detail: "Historical product relationships",
        icon: "🔗",
      },
      {
        id: "simulations",
        label: "Simulations",
        value: simulationValue,
        change: hasActiveDataset ? "Selected dataset history" : "Upload a dataset",
        isUp: true,
        tone: "amber",
        detail: "Saved what-if scenario runs",
        icon: "🧪",
      },
    ];
  }, [activeDemoDataset, alertSummary, datasetSummary, dependencySummary, forecastSummary, hasActiveDataset, latestModelRun, obsolescenceSummary, recommendations, simulationHistory]);

  useEffect(() => {
    setRecentDatasets(
      datasets.map((d) => ({
            id: d.dataset_id,
            name: d.filename,
            rows: d.row_count ?? 0,
            columns: d.column_count ?? 0,
            uploadedAt: d.created_at
              ? new Date(d.created_at).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "-",
            status: d.status ? d.status.charAt(0).toUpperCase() + d.status.slice(1) : "Unknown",
          }))
    );
    if (!selectedDatasetId && datasets.length) setSelectedDatasetId(datasets[0].dataset_id);
  }, [datasets, selectedDatasetId, setSelectedDatasetId]);

  useEffect(() => {
    if (activePage === "dashboard") return undefined;
    let cancelled = false;

    async function loadActiveDatasetData() {
      if (activePage !== "dashboard") return;

      if (!activeDatasetId) {
        setDatasetSummary(null);
        setDatasetPreview(null);
        setForecastRows([]);
        setForecastSummary(null);
        setLatestModelRun(null);
        setDependencySummary(null);
        setObsolescenceSummary(null);
        setObsolescenceRows([]);
        setSimulationHistory([]);
        setRiskAlerts([]);
        setAlertSummary(null);
        setRecommendations([]);
        setRecoveryPlan(null);
        setRecoveryError("");
        setDashboardError("");
        setDashboardLoading(false);
        setRecoveryLoading(false);
        return;
      }

      if (!hasActiveDataset) {
        setDatasetSummary(null);
        setDatasetPreview(null);
        setForecastRows([]);
        setForecastSummary(null);
        setLatestModelRun(null);
        setDependencySummary(null);
        setObsolescenceSummary(null);
        setObsolescenceRows([]);
        setSimulationHistory([]);
        setRiskAlerts([]);
        setAlertSummary(null);
        setRecommendations([]);
        setRecoveryPlan(null);
        setRecoveryError("");
        setDashboardError("");
        setDashboardLoading(false);
        setRecoveryLoading(false);
        return;
      }

      try {
        setDashboardLoading(true);
        setDashboardError("");
        setRecoveryLoading(true);

        if (isDemoSession) {
          const demoDataset = getDemoDatasets().find(
            (dataset) => String(dataset.dataset_id) === String(activeDatasetId)
          );
          if (!demoDataset?.analytics) {
            throw new Error("This demo dataset has no saved analysis. Upload it again to generate dashboard charts.");
          }

          const analytics = demoDataset.analytics;
          setDatasetSummary(analytics.summary);
          setDatasetPreview({
            ...analytics,
            file_size: demoDataset.file_size,
            file_type: demoDataset.file_type,
          });
          setForecastRows(analytics.forecast_rows);
          setForecastSummary({
            total_predicted_demand: analytics.forecast_rows.reduce(
              (sum, row) => sum + safeNumber(row.predicted_demand),
              0
            ),
            latest_date: analytics.forecast_rows.at(-1)?.forecast_date || null,
          });
          return;
        }

        const [summaryRes, previewRes, forecastRes, modelRunsRes, dependenciesRes, alertsRes, alertSummaryRes, recommendationsRes, obsolescenceRes, obsolescenceRowsRes, simulationsRes, recoveryRes] = await Promise.all([
          apiFetch(`${API_BASE}/datasets/${activeDatasetId}/summary`),
          apiFetch(`${API_BASE}/datasets/${activeDatasetId}/preview`),
          apiFetch(`${API_BASE}/forecasts?dataset_id=${activeDatasetId}`),
          apiFetch(`${API_BASE}/model-runs?dataset_id=${activeDatasetId}`),
          apiFetch(`${API_BASE}/dependencies/summary?dataset_id=${activeDatasetId}`),
          apiFetch(`${API_BASE}/alerts?dataset_id=${activeDatasetId}&is_resolved=false`),
          apiFetch(`${API_BASE}/alerts/summary?dataset_id=${activeDatasetId}`),
          apiFetch(`${API_BASE}/recommendations?dataset_id=${activeDatasetId}&recommendation_status=open`),
          apiFetch(`${API_BASE}/obsolescence/summary?dataset_id=${activeDatasetId}`),
          apiFetch(`${API_BASE}/obsolescence?dataset_id=${activeDatasetId}`),
          apiFetch(`${API_BASE}/simulations?dataset_id=${activeDatasetId}`),
          apiFetch(`${API_BASE}/recovery-planner?dataset_id=${activeDatasetId}`),
        ]);

        if ([summaryRes, previewRes, forecastRes, modelRunsRes, dependenciesRes, alertsRes, alertSummaryRes, recommendationsRes, obsolescenceRes, obsolescenceRowsRes, simulationsRes].some((response) => !response.ok)) {
          throw new Error("One or more dashboard data sources failed.");
        }
        const summaryData = summaryRes.ok ? await summaryRes.json() : null;
        const previewData = previewRes.ok ? await previewRes.json() : null;
        const forecastData = forecastRes.ok ? await forecastRes.json() : [];
        const modelRuns = modelRunsRes.ok ? await modelRunsRes.json() : [];
        const dependencyData = dependenciesRes.ok ? await dependenciesRes.json() : null;
        const alertsData = alertsRes.ok ? await alertsRes.json() : [];
        const alertSummaryData = alertSummaryRes.ok ? await alertSummaryRes.json() : null;
        const recommendationsData = recommendationsRes.ok ? await recommendationsRes.json() : [];
        const obsolescenceData = obsolescenceRes.ok ? await obsolescenceRes.json() : null;
        const obsolescenceRowsData = obsolescenceRowsRes.ok ? await obsolescenceRowsRes.json() : [];
        const simulationsData = simulationsRes.ok ? await simulationsRes.json() : [];
        const recoveryData = recoveryRes.ok ? await recoveryRes.json() : null;

        if (cancelled) return;

        const completedRuns = [...modelRuns].filter((run) => String(run.dataset_id) === String(activeDatasetId) && run.status === "completed").sort((a, b) => (b.id || 0) - (a.id || 0));
        setDatasetSummary(summaryData);
        setDatasetPreview(previewData);
        setForecastRows(Array.isArray(forecastData) ? forecastData : []);
        setForecastSummary(
          forecastData && forecastData.length ? {
            total_predicted_demand: forecastData.reduce((sum, row) => sum + safeNumber(row.predicted_demand), 0),
            latest_date: forecastData[forecastData.length - 1]?.forecast_date || null,
          } : null
        );
        setLatestModelRun(completedRuns[0] || null);
        setDependencySummary(dependencyData);
        setRiskAlerts(Array.isArray(alertsData) ? alertsData : []);
        setAlertSummary(alertSummaryData);
        setRecommendations(Array.isArray(recommendationsData) ? recommendationsData : []);
        setObsolescenceSummary(obsolescenceData);
        setObsolescenceRows(Array.isArray(obsolescenceRowsData) ? obsolescenceRowsData : []);
        setSimulationHistory(Array.isArray(simulationsData) ? simulationsData : []);
        setRecoveryPlan(recoveryData);
        setRecoveryError(recoveryRes.ok ? "" : "Unable to load recovery insight for this dataset.");
      } catch (error) {
        if (!cancelled) {
          setDashboardError("Unable to load dashboard data from the backend.");
        }
      } finally {
        if (!cancelled) {
          setDashboardLoading(false);
          setRecoveryLoading(false);
        }
      }
    }

    loadActiveDatasetData();
    return () => {
      cancelled = true;
    };
  }, [activeDatasetId, activePage, datasetRefreshToken, hasActiveDataset, isDemoSession]);

  // File Upload Handlers
  const openUploadModal = () => {
    setModalType("upload");
    setUploadError("");
    setUploadSuccess("");
    setIsDragActive(false);
  };

  const addFilesToUpload = (incomingFiles = []) => {
    if (!incomingFiles.length) return;
    setUploadSuccess("");
    const deduped = [];
    const seen = new Set();

    incomingFiles.forEach((file) => {
      if (!file || !file.name) return;
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!allowedUploadExtensions.includes(extension)) {
        setUploadError(`Unsupported file type: ${file.name}. Allowed: .csv, .xlsx, .xls`);
        return;
      }
      if (file.size === 0) {
        setUploadError(`Empty file detected: ${file.name}`);
        return;
      }
      const fileKey = getUploadFileKey(file);
      if (seen.has(fileKey)) return;
      seen.add(fileKey);
      deduped.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file,
        name: file.name,
        extension: extension.toUpperCase(),
        size: file.size,
        status: "Ready",
        error: "",
      });
    });

    if (!deduped.length) return;
    setSelectedFiles((curr) => [...curr, ...deduped]);
    setUploadError("");
  };

  const removeUploadFile = async (entry) => {
    setUploadError("");
    try {
      if (entry.status === "Uploaded" && entry.datasetId) {
        if (entry.demo) {
          deleteDemoDataset(entry.datasetId);
        } else {
          const response = await apiFetch(`${API_BASE}/datasets/${entry.datasetId}`, {
            method: "DELETE",
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.detail || payload.message || "Dataset deletion failed.");
          }
          refreshDatasets();
        }
        setDatasetRefreshToken((curr) => curr + 1);
      }

      setSelectedFiles((curr) => curr.filter((item) => item.id !== entry.id));
      setUploadSuccess("");
      showToast(entry.status === "Uploaded" ? "Dataset deleted successfully." : "File removed from upload list.");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Unable to remove this dataset.");
    }
  };

  const handleUploadAll = async () => {
    if (selectedFiles.length === 0) {
      setUploadError("Select at least one file to upload.");
      return;
    }

    setIsUploading(true);
    setUploadError("");
    const results = [];

    for (const entry of selectedFiles) {
      if (entry.status === "Uploaded") continue;

      setSelectedFiles((curr) =>
        curr.map((item) => (item.id === entry.id ? { ...item, status: "Uploading", error: "" } : item))
      );

      try {
        if (isDemoSession) {
          if (entry.extension !== "CSV") {
            throw new Error("Dashboard analysis for demo uploads currently requires CSV. Excel analysis needs the backend API.");
          }
          const analytics = analyzeDemoCsv(await entry.file.text());
          const datasetId = Date.now();
          const summary = {
            dataset_id: datasetId,
            filename: entry.name,
            file_type: "csv",
            file_size: entry.size,
            row_count: analytics.row_count,
            column_count: analytics.column_count,
            created_at: new Date().toISOString(),
            status: "uploaded",
            is_demo: true,
            analytics,
          };

          saveDemoDataset(summary);
          setSelectedDatasetId(datasetId);
          await refreshDatasets();
          setDatasetRefreshToken((curr) => curr + 1);
          setSelectedFiles((curr) =>
            curr.map((item) => (item.id === entry.id ? { ...item, datasetId, demo: true, status: "Uploaded", error: "" } : item))
          );
          results.push({ ok: true, name: entry.name, demo: true });
          continue;
        }

        const formData = new FormData();
        formData.append("file", entry.file);
        formData.append("user_id", "1");

      const response = await apiFetch(`${API_BASE}/datasets/upload`, {
        method: "POST",
        body: formData,
      });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const detail = payload && payload.detail ? payload.detail : "Upload failed.";
          throw new Error(typeof detail === "string" ? detail : "Upload failed.");
        }

        const summary = {
          id: payload.dataset_id || Date.now(),
          name: payload.filename || entry.name,
          fileType: payload.file_type || entry.extension,
          fileSize: payload.file_size ?? entry.size,
          rows: payload.row_count ?? 0,
          columns: payload.column_count ?? 0,
          status: "Uploaded",
        };

        setDatasetRefreshToken((curr) => curr + 1);
        refreshDatasets();

        setSelectedFiles((curr) =>
          curr.map((item) => (item.id === entry.id ? { ...item, datasetId: summary.id, demo: false, status: "Uploaded", error: "" } : item))
        );
        results.push({ ok: true, name: entry.name });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed.";
        setSelectedFiles((curr) =>
          curr.map((item) => (item.id === entry.id ? { ...item, status: "Failed", error: message } : item))
        );
        results.push({ ok: false, name: entry.name, message });
      }
    }

    const successCount = results.filter((r) => r.ok).length;
    if (successCount > 0) {
      const hasDemoUpload = results.some((result) => result.ok && result.demo);
      const successMessage = hasDemoUpload
        ? `${successCount} ${successCount === 1 ? "dataset" : "datasets"} uploaded in demo mode. Files are not saved to the server.`
        : `${successCount} ${successCount === 1 ? "dataset" : "datasets"} uploaded successfully.`;
      setUploadSuccess(successMessage);
      showToast(successMessage);
    }
    setIsUploading(false);
  };

  const filteredProducts = useMemo(() => {
    if (!datasetPreview || !Array.isArray(datasetPreview.preview) || !datasetPreview.preview.length) {
      return [];
    }

    const productKey = Object.keys(datasetPreview.preview[0]).find((key) => /product_id|product|sku|item/i.test(key)) || "product_id";
    const demandKey = Object.keys(datasetPreview.preview[0]).find((key) => /^(units_sold|units|demand|quantity|sales)$/i.test(key)) || "units_sold";
    const totals = {};
    const forecastTotals = {};
    const productNames = {};

    forecastRows.forEach((row) => {
      forecastTotals[row.product_id] = (forecastTotals[row.product_id] || 0) + safeNumber(row.predicted_demand);
    });

    (datasetPreview?.preview || []).forEach((row) => {
      const productId = String(row[productKey] ?? "unknown");
      if (!productId || productId === "undefined") return;
      productNames[productId] = row.product_name || row.product || productId;
      const demandValue = safeNumber(row[demandKey]);
      totals[productId] = {
        id: productId,
        name: row.product_name || row.product || productId,
        demand: (totals[productId]?.demand || 0) + demandValue,
      };
    });

    const normalized = searchTerm.trim().toLowerCase();
    const sourceProducts = Object.keys(forecastTotals).length
      ? Object.keys(forecastTotals).map((productId) => ({
          id: productId,
          name: productNames[productId] || productId,
          demand: forecastTotals[productId],
          risk: obsolescenceRows.find((row) => row.product_id === productId)?.risk_level || "N/A",
        }))
      : Object.values(totals).map((product) => ({
          ...product,
          risk: obsolescenceRows.find((row) => row.product_id === product.id)?.risk_level || "N/A",
        }));

    return sourceProducts
      .filter((product) => {
        const matchesRisk = riskFilter === "All" || riskFilter === "N/A" || product.risk === riskFilter;
        const matchesSearch =
          !normalized ||
          product.name.toLowerCase().includes(normalized) ||
          product.id.toLowerCase().includes(normalized);
        return matchesRisk && matchesSearch;
      })
      .sort((a, b) => {
        if (sortKey === "name") return a.name.localeCompare(b.name);
        if (sortKey === "stock") return 0;
        if (sortKey === "demand") return b.demand - a.demand;
        return a.id.localeCompare(b.id);
      })
      .map((product) => ({
        ...product,
        stock: datasetSummary?.has_inventory_columns ? "Available" : "Not available",
        status: product.risk === "N/A" ? "Not analyzed" : product.risk,
      }));
  }, [datasetPreview, datasetSummary, forecastRows, obsolescenceRows, riskFilter, searchTerm, sortKey]);

  if (activePage === "dashboard") {
    return (
      <>
        <DashboardAnalytics
          onNavigatePage={onNavigatePage}
          onOpenUpload={openUploadModal}
        />
        {modalType === "upload" && (
          <Modal
            isOpen
            onClose={() => setModalType(null)}
            category="DATASET MANAGEMENT"
            title="Upload Datasets"
            subtitle="Upload sales history or inventory files (.csv, .xlsx, .xls)"
            footer={
              <>
                <Button variant="secondary" onClick={() => setModalType(null)}>Cancel</Button>
                <Button
                  variant="gradient"
                  loading={isUploading}
                  disabled={!selectedFiles.length}
                  onClick={handleUploadAll}
                >
                  {isUploading ? "Uploading..." : "Upload All Files"}
                </Button>
              </>
            }
          >
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragActive(false);
                addFilesToUpload(Array.from(event.dataTransfer.files || []));
              }}
              className={`rounded-2xl border-2 border-dashed p-7 text-center ${
                isDragActive
                  ? "border-blue-400 bg-blue-50 dark:bg-blue-950/20"
                  : "border-slate-200 bg-slate-50/50 dark:border-[#2E2A4A] dark:bg-[#171525]/30"
              }`}
            >
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Drop files here or browse to upload</p>
              <p className="mt-1 text-xs text-slate-500">CSV, XLSX, or XLS</p>
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => fileInputRef.current?.click()}>
                Browse files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                multiple
                onChange={(event) => addFilesToUpload(Array.from(event.target.files || []))}
                className="hidden"
              />
            </div>
            {uploadError && <p role="alert" className="mt-3 text-sm text-rose-600">{uploadError}</p>}
            {uploadSuccess && <p role="status" className="mt-3 text-sm text-emerald-700">{uploadSuccess}</p>}
            {selectedFiles.length > 0 && (
              <div className="mt-4 max-h-56 space-y-2 overflow-y-auto">
                {selectedFiles.map((file) => (
                  <div key={file.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-[#2E2A4A]">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{file.name}</p>
                      <p className="text-xs text-slate-500">{file.extension} · {formatFileSize(file.size)} · {file.status}</p>
                    </div>
                    <Button
                      variant={file.status === "Uploaded" ? "danger" : "secondary"}
                      size="sm"
                      disabled={isUploading || file.status === "Uploading"}
                      onClick={() => removeUploadFile(file)}
                    >
                      {file.status === "Uploaded" ? "Delete" : "Remove"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Modal>
        )}
        {toast && <div role="status" className="fixed bottom-5 right-5 z-50 rounded-xl bg-slate-900 px-4 py-3 text-xs font-bold text-white shadow-2xl">{toast}</div>}
      </>
    );
  }

  // Keep visited routes mounted so page-local filters and results survive navigation.
  return (
    <>
      <PersistentPageSlot active={activePage === "datasets"}>
        <DatasetManagement
          refreshToken={datasetRefreshToken}
          onDatasetChange={() => {
            setDatasetRefreshToken((current) => current + 1);
            refreshDatasets();
          }}
          onOpenUploadModal={() => {
            onNavigatePage?.("dashboard");
            openUploadModal();
          }}
        />
      </PersistentPageSlot>
      <PersistentPageSlot active={activePage === "model-training"}>
        <ModelConfiguration onOpenForecast={() => onNavigatePage?.("forecasts")} />
      </PersistentPageSlot>
      <PersistentPageSlot active={activePage === "forecasts"}>
        <ForecastDashboard onOpenRecommendations={() => onNavigatePage?.("recommendations")} />
      </PersistentPageSlot>
      <PersistentPageSlot active={activePage === "risk-alerts"}><Alerts /></PersistentPageSlot>
      <PersistentPageSlot active={activePage === "recommendations"}><Recommendations /></PersistentPageSlot>
      <PersistentPageSlot active={activePage === "dependencies"}><ProductDependencies /></PersistentPageSlot>
      <PersistentPageSlot active={activePage === "obsolescence"}><Obsolescence /></PersistentPageSlot>
      <PersistentPageSlot active={activePage === "simulations"}><Simulations active={activePage === "simulations"} onNavigatePage={onNavigatePage} /></PersistentPageSlot>
      <PersistentPageSlot active={activePage === "recovery"}><RecoveryPlanner /></PersistentPageSlot>
      <PersistentPageSlot active={activePage === "settings"}><Settings /></PersistentPageSlot>
      <PersistentPageSlot active={activePage === "help"}><Help onNavigatePage={onNavigatePage} /></PersistentPageSlot>

      <div hidden={activePage !== "dashboard"} aria-hidden={activePage !== "dashboard"}>
        <div className="space-y-6 animate-fadeIn">
      {/* Top Page Header */}
      <PageHeader
        category="AI INVENTORY OVERVIEW"
        title="Demand Intelligence Dashboard"
        subtitle="Real-time ML demand projections, stockout risks, and automated inventory actions."
        actions={
          <Button variant="gradient" onClick={openUploadModal}>
            ☁ Upload Dataset
          </Button>
        }
      />

      {dashboardLoading && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading dashboard data...</p>
      )}
      {dashboardError && (
        <p className="text-sm text-rose-600 dark:text-rose-400">{dashboardError}</p>
      )}

      {/* KPI Cards Section */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((card) => (
          <Card
            key={card.id}
            hover
            onClick={() => setSelectedKpi(card)}
            className="group cursor-pointer relative overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {card.label}
              </span>
              <span className="text-lg opacity-80">{card.icon}</span>
            </div>

            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                {card.value}
              </span>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                  card.tone === "purple"
                    ? "bg-[#EDE9FE] text-[#7C5CFC] dark:bg-[#7C5CFC]/20 dark:text-[#a58efd]"
                    : card.tone === "pink"
                    ? "bg-[#FCE7F3] text-[#D946A8] dark:bg-[#D946A8]/20 dark:text-[#f472c1]"
                    : card.tone === "emerald"
                    ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400"
                    : card.tone === "rose"
                    ? "bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400"
                    : "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400"
                }`}
              >
                {card.change}
              </span>
            </div>

            <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500 truncate">
              {card.detail}
            </p>
          </Card>
        ))}
      </div>

      {/* Main Analytics Area: Demand Forecast & Risk Overview */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Demand Forecast Chart Card */}
        <Card className="lg:col-span-2 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                Demand Forecast Projection
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {hasDemoAnalytics
                  ? "Uploaded sales history and a 3-period moving-average estimate."
                  : "Historical load vs ML predicted demand curve"}
              </p>
            </div>

            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-[#171525]">
              {['7D', '30D', '90D', '6M'].map((period) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => setActivePeriod(period)}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                    activePeriod === period
                      ? "bg-white dark:bg-[#211E35] text-[#D946A8] dark:text-[#f472c1] shadow-xs"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 dark:border-[#2E2A4A] bg-white dark:bg-[#211E35] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-600 dark:text-slate-300 font-semibold">
              <span className="flex items-center gap-1.5">
                <span className="relative flex h-3 w-7 items-center justify-center" aria-hidden="true"><span className="h-[3px] w-full rounded-full bg-[#6845E8]" /><span className="absolute h-2 w-2 rounded-full border-2 border-white bg-[#6845E8] shadow-sm" /></span> Historical Demand
              </span>
              <span className="flex items-center gap-1.5">
                <span className="relative flex h-3 w-7 items-center justify-center" aria-hidden="true"><span className="w-full border-t-2 border-dashed border-[#E1279A]" /><span className="absolute h-2 w-2 rotate-45 border-2 border-white bg-[#E1279A] shadow-sm" /></span> {hasDemoAnalytics ? "Trend Estimate" : "Predicted Forecast"}
              </span>
              {forecastBandPath && <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm border border-[#D946A8]/40 bg-[#D946A8]/20" /> Prediction interval</span>}
            </div>

            {!hasActiveDataset || chartSeries.labels.length === 0 ? (
              <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-slate-200 text-center text-sm text-slate-500 dark:border-[#2E2A4A] dark:text-slate-400">
                {hasActiveDataset ? "No chart data available for the selected dataset." : "Upload a dataset to generate dashboard charts."}
              </div>
            ) : (
              <>
                <div className="relative h-56 min-w-0 w-full">
                  <svg viewBox="0 0 640 225" className="h-full w-full" role="img" aria-label="Historical demand and forecast projection">
                    <defs>
                      <linearGradient id="dashboardForecastBand" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#D946A8" stopOpacity="0.24" />
                        <stop offset="100%" stopColor="#7C5CFC" stopOpacity="0.07" />
                      </linearGradient>
                    </defs>

                    {chartTicks.map((tick) => (
                      <line
                        key={tick.y}
                        x1="48"
                        x2="626"
                        y1={tick.y}
                        y2={tick.y}
                        stroke="currentColor"
                        className="text-slate-200 dark:text-[#2E2A4A]"
                        strokeDasharray="3 5"
                        strokeOpacity="0.75"
                      />
                    ))}
                    {chartTicks.map((tick) => <text key={`y-${tick.y}`} x="42" y={tick.y + 4} textAnchor="end" className="fill-slate-500 text-[11px] dark:fill-slate-400">{tick.value.toLocaleString()}</text>)}

                    {forecastBandPath && <>
                      <path d={forecastBandPath} fill="url(#dashboardForecastBand)" />
                      <path d={confidenceUpperPath} fill="none" stroke="#D946A8" strokeWidth="1.5" strokeDasharray="4 4" strokeOpacity="0.7" />
                      <path d={confidenceLowerPath} fill="none" stroke="#7C5CFC" strokeWidth="1.5" strokeDasharray="4 4" strokeOpacity="0.6" />
                    </>}

                    <path
                      d={smoothLinePath(historyPoints)}
                      fill="none"
                      stroke="#6845E8"
                      strokeWidth="3.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    <path
                      d={smoothLinePath(forecastPoints)}
                      fill="none"
                      stroke="#E1279A"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="9 6"
                    />

                    {historyPoints.map((point) => <g key={`history-${point.index}`} onMouseEnter={() => setHoverIndex(point.index)} onMouseLeave={() => setHoverIndex(null)} className="cursor-pointer"><circle cx={point.x} cy={point.y} r="10" fill="transparent" /><circle cx={point.x} cy={point.y} r="7" fill="white" fillOpacity="0.9" /><circle cx={point.x} cy={point.y} r="4.5" fill="#6845E8" stroke="white" strokeWidth="1.5" /><title>{`${chartSeries.labels[point.index]} · Demand ${formatMetricValue(point.value)}`}</title></g>)}
                    {forecastPoints.map((point) => <g key={`forecast-${point.index}`} onMouseEnter={() => setHoverIndex(point.index)} onMouseLeave={() => setHoverIndex(null)} className="cursor-pointer"><circle cx={point.x} cy={point.y} r="10" fill="transparent" /><circle cx={point.x} cy={point.y} r="7" fill="white" fillOpacity="0.9" /><path d={`M${point.x} ${point.y - 5.5} L${point.x + 5.5} ${point.y} L${point.x} ${point.y + 5.5} L${point.x - 5.5} ${point.y} Z`} fill="#E1279A" stroke="white" strokeWidth="1.5" /><title>{`${chartSeries.labels[point.index]} · Forecast ${formatMetricValue(point.value)}`}</title></g>)}
                    {chartSeries.labels.map((label, index) => {
                      const tickStep = Math.max(1, Math.ceil(chartSeries.labels.length / 6));
                      return index % tickStep === 0 || index === chartSeries.labels.length - 1
                        ? <text key={`x-${index}`} x={chartX(index)} y="204" textAnchor="middle" className="fill-slate-600 text-[12px] dark:fill-slate-300">{label}</text>
                        : null;
                    })}
                  </svg>

                  {hoverIndex !== null && (
                    <div className="pointer-events-none absolute right-3 top-2 z-10 max-w-[calc(100%-1.5rem)] rounded-lg border border-slate-200 border-l-[3px] border-l-[#D946A8] dark:border-[#2E2A4A] dark:border-l-[#D946A8] bg-white/95 dark:bg-[#211E35]/95 p-3 text-xs shadow-xl backdrop-blur-sm">
                      <p className="font-bold text-slate-900 dark:text-white">
                        {chartSeries.labels[hoverIndex]}
                      </p>
                      <p className="text-[#6845E8] font-semibold">
                        Demand: {chartSeries.values[hoverIndex] == null ? "—" : formatMetricValue(chartSeries.values[hoverIndex])}
                      </p>
                      <p className="text-[#E1279A] font-bold">
                        Forecast: {chartSeries.forecast[hoverIndex] == null ? "—" : formatMetricValue(chartSeries.forecast[hoverIndex])}
                      </p>
                      {chartSeries.lowerBounds[hoverIndex] != null && chartSeries.upperBounds[hoverIndex] != null && <p className="text-slate-600 dark:text-slate-300">Range: {formatMetricValue(chartSeries.lowerBounds[hoverIndex])}–{formatMetricValue(chartSeries.upperBounds[hoverIndex])}</p>}
                    </div>
                  )}
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3 text-xs">
                  <div className="p-2.5 rounded-xl bg-white dark:bg-[#211E35] border border-slate-100 dark:border-[#2E2A4A]">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">AVG DEMAND</span>
                    <p className="mt-1 font-bold text-slate-900 dark:text-white text-sm">
                      {chartSeries.values.length ? `${Math.round(chartSeries.values.reduce((sum, value) => sum + value, 0) / chartSeries.values.length)} units` : '—'}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-[#211E35] border border-slate-100 dark:border-[#2E2A4A]">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">FORECAST RANGE</span>
                    <p className="mt-1 font-bold text-slate-900 dark:text-white text-sm">
                      {chartSeries.forecast.length ? `${Math.min(...chartSeries.forecast)} – ${Math.max(...chartSeries.forecast)}` : '—'}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-[#211E35] border border-slate-100 dark:border-[#2E2A4A]">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">CONFIDENCE</span>
                    <p className="mt-1 font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                      {forecastRows.some((row) => row.confidence_level != null)
                        ? formatPercent(forecastRows.reduce((sum, row) => sum + safeNumber(row.confidence_level), 0) / forecastRows.filter((row) => row.confidence_level != null).length)
                        : 'Not available'}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Right Side: Risk Overview & AI Insights Card */}
        <div className="space-y-6">
          <AIInsightCard
            title="INVENTORY AI INSIGHT"
            subtitle={dependencySummary?.top_positive_relationship ? "Strong Co-Demand Detected" : "Dependency Analysis"}
            onAction={() => onNavigatePage && onNavigatePage("dependencies")}
          >
            {dependencySummary?.top_positive_relationship ? (
              <>Historical correlation indicates demand for <b>{dependencySummary.top_positive_relationship.product_a_name || "Name unavailable"}</b> ({dependencySummary.top_positive_relationship.product_a_id || "Unknown Product"}) and <b>{dependencySummary.top_positive_relationship.product_b_name || "Name unavailable"}</b> ({dependencySummary.top_positive_relationship.product_b_id || "Unknown Product"}) moves together with +{dependencySummary.top_positive_relationship.correlation.toFixed(2)} correlation. This is an association signal, not causation.</>
            ) : (
              "Run Product Dependency Analysis for the selected dataset to generate relationship insights."
            )}
          </AIInsightCard>

          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">RECOVERY OPPORTUNITY</p>
                <h3 className="mt-1 text-base font-bold text-slate-900 dark:text-white">Recovery Insight</h3>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onNavigatePage && onNavigatePage("recovery")}>View Planner →</Button>
            </div>
            {recoveryLoading ? <p className="text-sm text-slate-500">Loading recovery insight...</p> : recoveryError ? <p className="text-sm text-rose-600">{recoveryError}</p> : !recoveryPlan?.summary ? <p className="text-sm text-slate-500">No recovery insight available for this dataset.</p> : recoveryPlan.summary.recovery_opportunities === 0 ? <p className="text-sm text-slate-500">No recovery opportunities identified for this dataset.</p> : (() => {
              const topOpportunity = recoveryPlan.products?.find((product) => product.recovery_opportunity) || recoveryPlan.products?.[0];
              return <div className="space-y-3">
                <div className="flex items-center justify-between"><span className="text-sm text-slate-500">Recovery opportunities</span><Badge variant="purple">{recoveryPlan.summary.recovery_opportunities}</Badge></div>
                <div className="rounded-xl border border-slate-200 p-3 dark:border-[#2E2A4A]">
                  <p className="text-xs font-bold text-slate-400">TOP OPPORTUNITY</p>
                  <p className="mt-1 font-bold text-slate-900 dark:text-white">{topOpportunity.product_id} — {topOpportunity.product_name}</p>
                  <p className="mt-2 text-xs text-slate-500">Priority: <b>{topOpportunity.recovery_priority}</b> · Suggested action: <b>{topOpportunity.suggested_action}</b></p>
                  <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{topOpportunity.reason}</p>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-300">{recoveryPlan.summary.inventory_data_available ? "Excess stock is compared with the latest completed forecast. Revenue and cost values are estimates, not guaranteed recovery." : "Demand Recovery Mode. Current stock is unavailable, so excess quantities cannot be calculated."}</p>
              </div>;
            })()}
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Active Risk Overview
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNavigatePage && onNavigatePage("risk-alerts")}
              >
                View All →
              </Button>
            </div>

            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                  <span className="text-xs font-bold text-rose-900 dark:text-rose-200">
                    High Stockout Risks
                  </span>
                </div>
                <Badge variant="high">{alertSummary ? `${alertSummary.high_severity} alerts` : "Not available"}</Badge>
              </div>

              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                  <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    Medium Demand Shifts
                  </span>
                </div>
                <Badge variant="medium">{alertSummary ? `${alertSummary.medium_severity} alerts` : "Not available"}</Badge>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                    Low / Healthy Stock
                  </span>
                </div>
                <Badge variant="low">{datasetSummary?.has_inventory_columns ? "Available" : "Not available"}</Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Recent Alerts & Recent Recommendations Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Alerts */}
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Recent Risk Signals
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigatePage && onNavigatePage("risk-alerts")}
            >
              Alerts Hub →
            </Button>
          </div>

          <div className="space-y-3">
            {riskAlerts.length === 0 ? (
              <p className="text-xs text-slate-400 p-4 text-center">
                No open risk alerts detected.
              </p>
            ) : (
              riskAlerts.slice(0, 3).map((alert) => (
                <div
                  key={alert.id}
                  className="p-3.5 rounded-xl border border-slate-100 dark:border-[#2E2A4A] bg-slate-50/50 dark:bg-[#171525]/30 flex items-center justify-between"
                >
                  <div className="min-w-0 pr-2">
                    <span className="text-[10px] font-bold text-[#7C5CFC] uppercase">
                      {alert.alert_type}
                    </span>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                      {alert.title}
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {alert.what}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectedAlert(alert)}
                  >
                    View
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Recent Recommendations */}
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Recommended Operational Actions
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigatePage && onNavigatePage("recommendations")}
            >
              Action Center →
            </Button>
          </div>

          <div className="space-y-3">
            {recommendations.length === 0 ? (
              <p className="text-xs text-slate-400 p-4 text-center">
                No active recommendations.
              </p>
            ) : (
              recommendations.slice(0, 3).map((rec) => (
                <div
                  key={rec.id}
                  className="p-3.5 rounded-xl border border-slate-100 dark:border-[#2E2A4A] bg-slate-50/50 dark:bg-[#171525]/30 flex items-center justify-between"
                >
                  <div className="min-w-0 pr-2">
                    <span className="text-[10px] font-bold text-[#D946A8] uppercase">
                      {rec.recommendation_type}
                    </span>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                      {rec.title}
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {rec.suggested_action}
                    </p>
                  </div>
                  <Badge variant={rec.priority === "HIGH" ? "high" : "purple"}>
                    {rec.priority}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Inventory Overview Table & Filters */}
      <Card className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Inventory Operating State
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live stock counts, predicted demand, and risk status per SKU
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="max-w-[140px]"
            >
              <option value="All">All Risks</option>
              <option value="Low">Low Risk</option>
              <option value="Medium">Medium Risk</option>
              <option value="High">High Risk</option>
              <option value="Critical">Critical Risk</option>
            </Select>

            <Select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              className="max-w-[140px]"
            >
              <option value="name">Sort by Name</option>
              <option value="stock">Sort by Stock</option>
              <option value="demand">Sort by Demand</option>
            </Select>
          </div>
        </div>

        <Table headers={["Product Name", "SKU ID", "Stock", "Predicted Demand", "Risk Status", "Action"]}>
          {filteredProducts.map((p) => (
            <TableRow key={p.id}>
              <TableCell bold>{p.name}</TableCell>
              <TableCell className="font-mono text-xs">{p.id}</TableCell>
              <TableCell>{p.stock} units</TableCell>
              <TableCell className="font-semibold text-[#D946A8]">{formatMetricValue(p.demand)} units</TableCell>
              <TableCell>
                <Badge
                  variant={
                    p.risk === "Low"
                      ? "low"
                      : p.risk === "Medium"
                      ? "medium"
                      : "high"
                  }
                >
                  {p.risk} Risk
                </Badge>
              </TableCell>
              <TableCell>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelectedProduct(p)}
                >
                  View SKU
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </Table>
      </Card>

      {/* KPI Details Modal */}
      {selectedKpi && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedKpi(null)}
          category="KPI METRIC BREAKDOWN"
          title={selectedKpi.label}
          subtitle={selectedKpi.detail}
          footer={
            <Button variant="secondary" onClick={() => setSelectedKpi(null)}>
              Close
            </Button>
          }
        >
          <div className="p-5 rounded-2xl bg-slate-50 dark:bg-[#171525] border border-slate-200 dark:border-[#2E2A4A] text-center">
            <span className="text-4xl font-extrabold text-slate-900 dark:text-white">
              {selectedKpi.value}
            </span>
            <p className="mt-2 text-xs font-bold text-[#D946A8]">
              {selectedKpi.change}
            </p>
          </div>
        </Modal>
      )}

      {/* Product SKU Modal */}
      {selectedProduct && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedProduct(null)}
          category="PRODUCT SKU DETAILS"
          title={selectedProduct.name}
          subtitle={`SKU Code: ${selectedProduct.id}`}
          footer={
            <Button variant="secondary" onClick={() => setSelectedProduct(null)}>
              Close
            </Button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#171525] border border-slate-200 dark:border-[#2E2A4A] text-xs">
              <span className="text-slate-400 font-bold uppercase">CURRENT STOCK</span>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{selectedProduct.stock} units</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#171525] border border-slate-200 dark:border-[#2E2A4A] text-xs">
              <span className="text-slate-400 font-bold uppercase">PREDICTED DEMAND</span>
              <p className="mt-1 text-lg font-bold text-[#D946A8]">{selectedProduct.demand} units</p>
            </div>
          </div>
        </Modal>
      )}

      {/* Upload Modal */}
      {modalType === "upload" && (
        <Modal
          isOpen={true}
          onClose={() => setModalType(null)}
          category="DATASET MANAGEMENT"
          title="Upload Datasets"
          subtitle="Upload multiple sales history or inventory files (.csv, .xlsx, .xls)"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalType(null)}>
                Cancel
              </Button>
              <Button
                variant="gradient"
                loading={isUploading}
                disabled={selectedFiles.length === 0}
                onClick={handleUploadAll}
              >
                {isUploading ? "Uploading..." : "Upload All Files"}
              </Button>
            </>
          }
        >
          {/* Drag and Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragActive(true);
            }}
            onDragLeave={() => setIsDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragActive(false);
              addFilesToUpload(Array.from(e.dataTransfer.files || []));
            }}
            className={`p-8 text-center rounded-[20px] border-2 border-dashed transition ${
              isDragActive
                ? "border-[#D946A8] bg-[#FCE7F3]/40 dark:bg-[#D946A8]/10"
                : "border-slate-200 dark:border-[#2E2A4A] bg-slate-50/50 dark:bg-[#171525]/30"
            }`}
          >
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-xl bg-gradient-to-tr from-[#D946A8]/20 to-[#7C5CFC]/20 text-[#D946A8] text-2xl mb-3">
              ☁
            </div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
              Drag & Drop your inventory dataset files here
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Supports CSV, XLSX, XLS • Multiple file batch upload supported
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => fileInputRef.current?.click()}
            >
              Browse Files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              multiple
              onChange={(e) => addFilesToUpload(Array.from(e.target.files || []))}
              className="hidden"
            />
          </div>

          {uploadError && (
            <p className="text-xs text-rose-500 font-semibold p-2 bg-rose-50 rounded-lg">
              {uploadError}
            </p>
          )}

          {uploadSuccess && (
            <p role="status" className="text-sm text-emerald-700 font-semibold p-3 bg-emerald-50 border border-emerald-200 rounded-lg dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800">
              {uploadSuccess}
            </p>
          )}

          {/* Selected File Cards List */}
          {selectedFiles.length > 0 && (
            <div className="space-y-2 mt-4">
              <p className="text-xs font-bold text-slate-500 uppercase">
                Selected Files ({selectedFiles.length})
              </p>
              {selectedFiles.map((f) => (
                <div
                  key={f.id}
                  className="p-3 rounded-xl border border-slate-200 dark:border-[#2E2A4A] bg-white dark:bg-[#211E35] flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 dark:text-slate-200 truncate">
                      {f.name}
                    </p>
                    <span className="text-[10px] text-slate-400">
                      {f.extension} • {formatFileSize(f.size)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={f.status === "Uploaded" ? "low" : f.status === "Failed" ? "high" : "purple"}>
                      {f.status}
                    </Badge>
                    <Button
                      variant={f.status === "Uploaded" ? "danger" : "secondary"}
                      size="sm"
                      disabled={isUploading || f.status === "Uploading"}
                      onClick={() => removeUploadFile(f)}
                      aria-label={`${f.status === "Uploaded" ? "Delete" : "Remove"} ${f.name}`}
                    >
                      {f.status === "Uploaded" ? "Delete" : "Remove"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-3 text-xs font-bold shadow-2xl animate-fadeIn">
          {toast}
        </div>
      )}
        </div>
      </div>
    </>
  );
}