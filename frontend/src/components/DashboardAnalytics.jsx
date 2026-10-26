import React, { useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import PageHeader from "./ui/PageHeader";
import Card, { CardTitle } from "./ui/Card";
import Button from "./ui/Button";
import { useAuth } from "../context/AuthContext";
import { useDataset } from "../context/DatasetContext";
import { getDemoDatasets } from "../utils/datasetStorage";
import { formatDate, loadSettings } from "../utils/settings";

const API_BASE = "/api";
const COLORS = {
  blue: "#3B82F6",
  teal: "#14B8A6",
  purple: "#8B5CF6",
  grid: "#E7EAF0",
  axis: "#748094",
};
const axisProps = {
  tick: { fill: COLORS.axis, fontSize: 11 },
  axisLine: false,
  tickLine: false,
  tickMargin: 8,
};
const tooltipStyle = {
  border: "1px solid #E2E8F0",
  borderRadius: 10,
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.10)",
};
const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function formatMetric(value, suffix = "") {
  return value == null || !Number.isFinite(Number(value))
    ? "Unavailable"
    : `${numberFormatter.format(Number(value))}${suffix}`;
}

function ChartCard({ title, subtitle, children, className = "", compact = false }) {
  return (
    <Card padding={compact ? "p-3" : "p-4 md:p-5"} className={`min-w-0 shadow-sm ${className}`}>
      <CardTitle className="text-base" subtitle={subtitle}>{title}</CardTitle>
      {children}
    </Card>
  );
}

function ChartEmpty({ children }) {
  return (
    <div className="flex h-[230px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-5 text-center text-sm text-slate-500 dark:border-[#2E2A4A] dark:text-slate-400">
      {children}
    </div>
  );
}

function MetricCard({ label, value, note, accent }) {
  return (
    <Card padding="p-4" className="min-w-0 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</p>
        <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${accent}`} aria-hidden="true" />
      </div>
      <p className="mt-2 truncate text-xl font-bold tracking-tight text-slate-900 dark:text-white" title={String(value)}>
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-slate-400 dark:text-slate-500">{note}</p>
    </Card>
  );
}

async function getJson(apiFetch, url, fallback) {
  const response = await apiFetch(url);
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(typeof payload?.detail === "string" ? payload.detail : `${fallback} (HTTP ${response.status}).`);
  }
  return payload;
}

export default function DashboardAnalytics({ onNavigatePage, onOpenUpload }) {
  const { datasets, selectedDatasetId, setSelectedDatasetId } = useDataset();
  const { apiFetch, token } = useAuth();
  const isDemoSession = import.meta.env.DEV && token?.startsWith("demo-");
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");
  const [runs, setRuns] = useState([]);
  const [runsError, setRunsError] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [forecastRows, setForecastRows] = useState([]);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState("");
  const [settings, setSettings] = useState(loadSettings);
  const dashboardCharts = settings.appearance.dashboardCharts;
  const compact = settings.appearance.compactDashboard;

  useEffect(() => {
    const syncSettings = () => setSettings(loadSettings());
    window.addEventListener("inventiq-settings-updated", syncSettings);
    return () => window.removeEventListener("inventiq-settings-updated", syncSettings);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAnalytics(null);
    setRuns([]);
    setRunsError("");
    setSelectedRunId("");
    setForecastRows([]);
    setForecastError("");

    if (!selectedDatasetId) {
      setAnalyticsLoading(false);
      return () => { cancelled = true; };
    }

    if (isDemoSession) {
      const demoDataset = getDemoDatasets().find(
        (dataset) => String(dataset.dataset_id) === String(selectedDatasetId) && dataset.is_demo,
      );
      const savedAnalytics = demoDataset?.analytics;
      const actualTrend = (savedAnalytics?.summary?.demand_history || [])
        .filter((point) => point.date && Number.isFinite(Number(point.value)))
        .map((point) => ({ date: point.date, units_sold: Number(point.value) }));
      if (savedAnalytics) {
        setAnalytics({
          total_units_sold: savedAnalytics.summary.total_units_sold ?? savedAnalytics.summary.total_demand ?? null,
          total_sales: savedAnalytics.summary.total_sales ?? null,
          product_count: savedAnalytics.summary.total_products_tracked ?? null,
          average_daily_sales: savedAnalytics.summary.average_daily_sales ?? null,
          trend: actualTrend,
          trend_granularity: savedAnalytics.trend_granularity,
          top_products: savedAnalytics.top_products || [],
          categories: savedAnalytics.categories || [],
        });
        setAnalyticsError("");
      } else {
        setAnalyticsError("Analytics for this demo dataset are unavailable. Upload it again to recalculate its summary.");
      }
      setRuns([]);
      setRunsError("");
      setSelectedRunId("");
      setAnalyticsLoading(false);
      return () => { cancelled = true; };
    }

    setAnalyticsLoading(true);
    Promise.allSettled([
      getJson(apiFetch, `${API_BASE}/datasets/${encodeURIComponent(selectedDatasetId)}/dashboard-analytics`, "Unable to load dataset analytics"),
      getJson(apiFetch, `${API_BASE}/model-runs?dataset_id=${encodeURIComponent(selectedDatasetId)}`, "Unable to load completed model runs"),
    ]).then(([analyticsResult, runsResult]) => {
      if (cancelled) return;
      if (analyticsResult.status === "fulfilled") {
        setAnalytics(analyticsResult.value);
        setAnalyticsError("");
      } else {
        setAnalyticsError(analyticsResult.reason.message || "Unable to load dataset analytics.");
        console.error("Unable to load dashboard dataset analytics.", {
          datasetId: selectedDatasetId,
          message: analyticsResult.reason.message,
        });
      }
      if (runsResult.status === "fulfilled" && Array.isArray(runsResult.value)) {
        const completedRuns = runsResult.value
          .filter((run) => String(run.status || "").toLowerCase() === "completed"
            && String(run.dataset_id) === String(selectedDatasetId))
          .sort((left, right) => Number(right.id) - Number(left.id));
        setRuns(completedRuns);
        setSelectedRunId(completedRuns.length ? String(completedRuns[0].id) : "");
        setRunsError("");
      } else {
        const message = runsResult.status === "rejected"
          ? runsResult.reason.message || "Unable to load completed model runs."
          : "The model-runs endpoint returned an invalid response.";
        setRuns([]);
        setSelectedRunId("");
        setRunsError(message);
        console.error("Unable to load dashboard model runs.", { datasetId: selectedDatasetId, message });
      }
      setAnalyticsLoading(false);
    });
    return () => { cancelled = true; };
  }, [apiFetch, isDemoSession, selectedDatasetId]);

  useEffect(() => {
    let cancelled = false;
    setForecastRows([]);
    setForecastError("");
    if (!selectedDatasetId || !selectedRunId) {
      setForecastLoading(false);
      return () => { cancelled = true; };
    }

    setForecastLoading(true);
    getJson(
      apiFetch,
      `${API_BASE}/forecasts?dataset_id=${encodeURIComponent(selectedDatasetId)}&model_run_id=${encodeURIComponent(selectedRunId)}`,
      "Unable to load saved forecast results",
    ).then((data) => {
      if (cancelled) return;
      if (!Array.isArray(data)) throw new Error("The forecast endpoint returned an invalid response.");
      setForecastRows(data.filter((row) => String(row.dataset_id) === String(selectedDatasetId)
        && String(row.model_run_id) === String(selectedRunId)));
    }).catch((error) => {
      if (!cancelled) {
        setForecastError(error.message || "Unable to load saved forecast results.");
        console.error("Unable to load dashboard forecast results.", {
          datasetId: selectedDatasetId,
          modelRunId: selectedRunId,
          message: error.message,
        });
      }
    }).finally(() => {
      if (!cancelled) setForecastLoading(false);
    });
    return () => { cancelled = true; };
  }, [apiFetch, selectedDatasetId, selectedRunId]);

  const forecastByProduct = useMemo(() => {
    const totals = new Map();
    forecastRows.forEach((row) => {
      const productId = String(row.product_id ?? "ALL");
      const value = Number(row.predicted_demand);
      if (!Number.isFinite(value)) return;
      totals.set(productId, (totals.get(productId) || 0) + value);
    });
    return totals;
  }, [forecastRows]);

  const forecastSeries = useMemo(() => {
    const byDate = new Map();
    forecastRows.forEach((row) => {
      const date = String(row.forecast_date || "").slice(0, 10);
      const predicted = Number(row.predicted_demand);
      if (!date || !Number.isFinite(predicted)) return;
      const item = byDate.get(date) || { date, predicted: 0, lower: 0, upper: 0, hasBounds: true };
      item.predicted += predicted;
      const lower = Number(row.lower_bound);
      const upper = Number(row.upper_bound);
      if (row.lower_bound == null || row.upper_bound == null
        || !Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
        item.hasBounds = false;
      } else {
        item.lower += lower;
        item.upper += upper;
      }
      byDate.set(date, item);
    });
    return Array.from(byDate.values())
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((item) => ({
        ...item,
        band: item.hasBounds ? Math.max(0, item.upper - item.lower) : null,
        lower: item.hasBounds ? item.lower : null,
      }));
  }, [forecastRows]);

  const historicalForecast = useMemo(() => {
    const history = (analytics?.trend || []).map((point) => ({
      date: point.date,
      historical: Number(point.units_sold),
      forecast: null,
      lower: null,
      band: null,
    }));
    const predictions = forecastSeries.map((point) => ({
      date: point.date,
      historical: null,
      forecast: point.predicted,
      lower: point.lower,
      band: point.band,
    }));
    return [...history, ...predictions].sort((left, right) => left.date.localeCompare(right.date));
  }, [analytics, forecastSeries]);

  const comparisonProducts = useMemo(() => {
    if (forecastRows.length) {
      const namesById = new Map((analytics?.top_products || []).map((item) => [String(item.product_id), item.product_name]));
      return Array.from(forecastByProduct, ([productId, forecast]) => ({
        name: namesById.get(productId) || productId,
        demand: forecast,
      })).sort((left, right) => right.demand - left.demand).slice(0, 5);
    }
    return (analytics?.top_products || []).slice(0, 5).map((product) => ({
      name: product.product_name || product.product_id,
      demand: Number(product.units_sold),
    }));
  }, [analytics, forecastByProduct, forecastRows.length]);

  const forecastTotal = forecastSeries.reduce((sum, item) => sum + item.predicted, 0);
  const forecastDayCount = forecastSeries.length;
  const forecastAverage = forecastDayCount ? forecastTotal / forecastDayCount : null;
  const historicalAverage = analytics?.average_daily_sales;
  const forecastChange = forecastAverage != null && historicalAverage != null && historicalAverage > 0
    ? ((forecastAverage - historicalAverage) / historicalAverage) * 100
    : null;
  const kpis = [
    ...(analytics?.total_sales != null
      ? [{ label: "Total Sales", value: formatMetric(analytics.total_sales), note: "Units sold × unit price", accent: "bg-blue-500" }]
      : []),
    { label: "Total Units Sold", value: formatMetric(analytics?.total_units_sold), note: "From the selected dataset", accent: "bg-teal-500" },
    { label: "Products", value: formatMetric(analytics?.product_count), note: "Distinct dataset products", accent: "bg-violet-500" },
    { label: "Average Daily Sales", value: formatMetric(analytics?.average_daily_sales, " units"), note: "Per date with valid sales", accent: "bg-sky-500" },
    { label: "Forecasted Demand", value: forecastRows.length ? formatMetric(forecastTotal, " units") : "Unavailable", note: forecastRows.length ? `${forecastDayCount} forecast dates` : "No saved forecast for this run", accent: "bg-purple-500" },
    { label: "Forecast Change", value: forecastChange == null ? "Unavailable" : `${forecastChange > 0 ? "+" : ""}${forecastChange.toFixed(1)}%`, note: forecastChange == null ? "Needs a forecast and valid historical average" : "Forecast daily average vs. historical", accent: "bg-indigo-500" },
  ];

  const topProducts = analytics?.top_products || [];
  const distributionData = analytics?.categories?.length
    ? analytics.categories.map((item) => ({ name: item.category, units: Number(item.units_sold) }))
    : topProducts.map((item) => ({ name: item.product_name || item.product_id, units: Number(item.units_sold) }));
  const chosenDataset = datasets.find((dataset) => String(dataset.dataset_id) === String(selectedDatasetId));

  return (
    <div className="space-y-5 animate-fadeIn">
      <PageHeader
        category="INVENTORY ANALYTICS"
        title="Demand Intelligence Dashboard"
        subtitle="Sales and demand trends calculated from your selected dataset and saved forecasts."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Dashboard dataset"
              value={selectedDatasetId || ""}
              onChange={(event) => setSelectedDatasetId(event.target.value)}
              className="max-w-[240px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-[#2E2A4A] dark:bg-[#211E35] dark:text-slate-100"
            >
              <option value="">Select dataset</option>
              {datasets.map((dataset) => (
                <option key={dataset.dataset_id} value={dataset.dataset_id}>{dataset.filename}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={onOpenUpload}>Upload dataset</Button>
            <Button variant="ghost" onClick={() => onNavigatePage?.("datasets")}>Manage datasets</Button>
          </div>
        }
      />

      {analyticsError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{analyticsError}</p>}
      {runsError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">{runsError}</p>}

      {analyticsLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-[#2E2A4A] dark:bg-[#211E35]" />)}
        </div>
      ) : analytics ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {kpis.map((item) => <MetricCard key={item.label} {...item} />)}
        </div>
      ) : (
        <Card padding="p-8" className="text-center text-sm text-slate-500">
          {selectedDatasetId ? "Dataset analytics are not available." : "Select or upload a dataset to see its sales analytics."}
        </Card>
      )}

      <section aria-label="Sales and demand charts" className="grid min-w-0 gap-4 lg:grid-cols-2 2xl:grid-cols-6">
        {dashboardCharts.historicalForecast && <ChartCard
          title="Historical Sales and Forecast"
          subtitle="Actual dataset history and saved model predictions"
          className="2xl:col-span-2"
          compact={compact}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {chosenDataset?.filename || "No dataset selected"}
            </span>
            <select
              aria-label="Forecast model run"
              value={selectedRunId}
              onChange={(event) => setSelectedRunId(event.target.value)}
              disabled={!runs.length}
              className="max-w-[210px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-[#2E2A4A] dark:bg-[#211E35] dark:text-slate-100"
            >
              {runs.length
                ? runs.map((run) => <option key={run.id} value={run.id}>{run.model_name} · Run #{run.id}</option>)
                : <option value="">No completed model runs</option>}
            </select>
          </div>
          {analyticsLoading ? <ChartEmpty>Loading dataset history…</ChartEmpty>
            : historicalForecast.length ? (
              <ResponsiveContainer width="100%" height={compact ? 190 : 230}>
                <ComposedChart data={historicalForecast} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
                  <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={formatDate} {...axisProps} minTickGap={28} />
                  <YAxis {...axisProps} width={48} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={formatDate} formatter={(value, name) => [formatMetric(value), name]} />
                  {settings.forecasting.uncertaintyBands && forecastSeries.some((item) => item.band != null) && <>
                    <Area dataKey="lower" stackId="range" stroke="transparent" fill="transparent" legendType="none" tooltipType="none" />
                    <Area dataKey="band" stackId="range" stroke="none" fill={COLORS.purple} fillOpacity={0.16} name="Forecast uncertainty" />
                  </>}
                  <Line type="monotone" dataKey="historical" name="Historical units" stroke={COLORS.blue} strokeWidth={2.5} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="forecast" name="Forecast units" stroke={COLORS.purple} strokeWidth={2.5} strokeDasharray="6 4" dot={false} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty>{analyticsError || "No valid dated demand values were found in this dataset."}</ChartEmpty>
            )}
          {forecastLoading && <p className="mt-1 text-xs text-slate-400">Loading saved forecast…</p>}
          {forecastError && <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-400">{forecastError}</p>}
          {!forecastLoading && !forecastError && runs.length > 0 && !forecastRows.length && (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>No saved forecast for this model run.</span>
              <Button variant="ghost" size="sm" onClick={() => onNavigatePage?.("forecasts")}>Generate forecast</Button>
            </div>
          )}
          {!runs.length && !runsError && (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>No completed model run is available yet.</span>
              <Button variant="ghost" size="sm" onClick={() => onNavigatePage?.("model-training")}>Train a model</Button>
            </div>
          )}
        </ChartCard>}

        {dashboardCharts.topProducts && <ChartCard title="Top 5 Products by Units Sold" subtitle="Highest historical demand" className="2xl:col-span-2" compact={compact}>
          {topProducts.length ? (
            <ResponsiveContainer width="100%" height={compact ? 225 : 270}>
              <BarChart data={topProducts.slice(0, 5)} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="product_name" {...axisProps} interval={0} tickFormatter={(label) => String(label).length > 12 ? `${String(label).slice(0, 11)}…` : label} />
                <YAxis {...axisProps} width={48} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatMetric(value, " units"), "Units sold"]} />
                <Bar dataKey="units_sold" name="Units sold" fill={COLORS.teal} radius={[5, 5, 0, 0]} maxBarSize={42} />
              </BarChart>
            </ResponsiveContainer>
          ) : <ChartEmpty>{analyticsLoading ? "Loading product totals…" : "Product totals are unavailable for this dataset."}</ChartEmpty>}
        </ChartCard>}

        {dashboardCharts.productComparison && <ChartCard
          title="Product-wise Demand Comparison"
          subtitle={forecastRows.length ? `Forecast totals · run #${selectedRunId}` : "Historical totals · no saved forecast"}
          className="2xl:col-span-2"
          compact={compact}
        >
          {comparisonProducts.length ? (
            <ResponsiveContainer width="100%" height={compact ? 225 : 270}>
              <BarChart data={comparisonProducts} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="name" {...axisProps} interval={0} tickFormatter={(label) => String(label).length > 12 ? `${String(label).slice(0, 11)}…` : label} />
                <YAxis {...axisProps} width={48} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatMetric(value, " units"), forecastRows.length ? "Forecast demand" : "Historical demand"]} />
                <Bar dataKey="demand" name={forecastRows.length ? "Forecast demand" : "Historical demand"} fill={COLORS.blue} radius={[5, 5, 0, 0]} maxBarSize={42} />
              </BarChart>
            </ResponsiveContainer>
          ) : <ChartEmpty>{analyticsLoading ? "Loading product demand…" : "Product-wise demand is unavailable."}</ChartEmpty>}
        </ChartCard>}

        {dashboardCharts.salesTrend && <ChartCard title="Daily or Monthly Sales Trend" subtitle={`Historical units · ${analytics?.trend_granularity || "period"} aggregation`} className="2xl:col-span-3" compact={compact}>
          {analytics?.trend?.length ? (
            <ResponsiveContainer width="100%" height={compact ? 225 : 270}>
              <LineChart data={analytics.trend} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
                <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatDate} {...axisProps} minTickGap={32} />
                <YAxis {...axisProps} width={48} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={formatDate} formatter={(value) => [formatMetric(value, " units"), "Units sold"]} />
                <Line type="monotone" dataKey="units_sold" name="Units sold" stroke={COLORS.teal} strokeWidth={2.5} dot={analytics.trend.length < 18} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <ChartEmpty>{analyticsLoading ? "Loading sales trend…" : "A usable date and units-sold field are needed for a trend."}</ChartEmpty>}
        </ChartCard>}

        {dashboardCharts.productDistribution && <ChartCard
          title={analytics?.categories?.length ? "Category Demand Distribution" : "Product Demand Distribution"}
          subtitle={analytics?.categories?.length ? "Top categories, sorted by units sold" : "Top 10 products, sorted by units sold"}
          className="2xl:col-span-3"
          compact={compact}
        >
          {distributionData.length ? (
            <ResponsiveContainer width="100%" height={compact ? 225 : 270}>
              <BarChart data={distributionData.slice(0, 10).slice().reverse()} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 5" horizontal={false} />
                <XAxis type="number" {...axisProps} />
                <YAxis type="category" dataKey="name" {...axisProps} width={112} tickFormatter={(label) => String(label).length > 18 ? `${String(label).slice(0, 17)}…` : label} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatMetric(value, " units"), "Units sold"]} />
                <Bar dataKey="units" name="Units sold" fill={COLORS.purple} radius={[0, 5, 5, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          ) : <ChartEmpty>{analyticsLoading ? "Loading product distribution…" : "Product or category totals are unavailable."}</ChartEmpty>}
        </ChartCard>}
        {!Object.values(dashboardCharts).some(Boolean) && (
          <p className="2xl:col-span-6 rounded-xl border border-dashed border-slate-300 px-5 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            All dashboard charts are hidden. Enable one or more in Settings → Appearance.
          </p>
        )}
      </section>
    </div>
  );
}
