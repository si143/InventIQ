import React, { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Card, { CardTitle } from "./ui/Card";
import Button from "./ui/Button";
import { formatDate } from "../utils/settings";

const COLORS = ["#7C5CFC", "#D946A8", "#A78BFA", "#EC8FC7", "#6875D9", "#E07A43", "#4B9A91", "#C47A9C"];
export const DEFAULT_FORECAST_CHART_IDS = ["historical-forecast", "horizon-trend"];
const CHART_OPTIONS = [
  { id: "historical-forecast", title: "Historical vs Forecast Demand", type: "Line Chart" },
  { id: "product-comparison", title: "Product-wise Forecast Comparison", type: "Bar Chart" },
  { id: "horizon-trend", title: "Forecast Horizon Trend", type: "Area Chart" },
  { id: "historical-distribution", title: "Historical Demand Distribution", type: "Histogram" },
  { id: "forecast-contribution", title: "Forecast Demand Contribution", type: "Donut Chart" },
  { id: "average-comparison", title: "Historical vs Forecast Average", type: "Grouped Bar Chart" },
  { id: "demand-change", title: "Demand Change by Product", type: "Diverging Bar Chart" },
  { id: "forecast-uncertainty", title: "Forecast Uncertainty", type: "Range Chart" },
  { id: "model-performance", title: "Model Performance Comparison", type: "Evaluation Metrics" },
];
const chartTooltipStyle = { border: "1px solid #e5e1ee", borderRadius: 8, fontSize: 12, boxShadow: "0 8px 24px rgba(35, 24, 61, 0.12)" };
const chartAxisProps = { tick: { fill: "#7b7887", fontSize: 11 }, axisLine: { stroke: "#e7e4ed" }, tickLine: false, tickMargin: 8 };
const chartLegendProps = { iconType: "circle", iconSize: 8, wrapperStyle: { fontSize: 11, color: "#686574", paddingTop: 4 } };
const dateLabel = (date) => formatDate(date);
const isNumber = (value) => value != null && Number.isFinite(Number(value));

function ChartPanel({ title, subtitle, children, className = "" }) {
  return (
    <Card className={`min-w-0 space-y-3 ${className}`}>
      <CardTitle subtitle={subtitle}>{title}</CardTitle>
      {children}
    </Card>
  );
}

function MissingData({ message }) {
  return <div className="flex h-64 items-center justify-center rounded border border-dashed border-slate-300 px-5 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">{message}</div>;
}

function ChartFrame({ children }) {
  return <div className="h-72 min-w-0 w-full">{children}</div>;
}

function mergeDaily(history, forecasts) {
  const daily = new Map();
  history.forEach((row) => {
    const item = daily.get(row.date) || { date: row.date };
    item.actual = (item.actual || 0) + Number(row.actual_demand);
    daily.set(row.date, item);
  });
  forecasts.forEach((row) => {
    const item = daily.get(row.forecast_date) || { date: row.forecast_date };
    item.predicted = (item.predicted || 0) + Number(row.predicted_demand);
    daily.set(row.forecast_date, item);
  });
  return Array.from(daily.values()).sort((left, right) => left.date.localeCompare(right.date));
}

function averageByProduct(rows, productKey, valueKey) {
  const grouped = new Map();
  rows.forEach((row) => {
    const productId = String(row[productKey] ?? "ALL");
    const value = Number(row[valueKey]);
    if (!Number.isFinite(value)) return;
    const item = grouped.get(productId) || { productId, total: 0, count: 0 };
    item.total += value;
    item.count += 1;
    grouped.set(productId, item);
  });
  return new Map(Array.from(grouped, ([productId, item]) => [productId, item.total / item.count]));
}

function makeHistogram(rows) {
  const values = rows.map((row) => Number(row.actual_demand)).filter(Number.isFinite);
  if (!values.length) return [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const binCount = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(values.length))));
  const width = (maximum - minimum) / binCount || 1;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    bin: `${(minimum + index * width).toFixed(1)}-${(minimum + (index + 1) * width).toFixed(1)}`,
    count: 0,
  }));
  values.forEach((value) => {
    const index = Math.min(binCount - 1, Math.floor((value - minimum) / width));
    bins[index].count += 1;
  });
  return bins;
}

function forecastByDate(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const item = groups.get(row.forecast_date) || { date: row.forecast_date, predicted: 0, lower: 0, upper: 0, bounded: true };
    const predicted = Number(row.predicted_demand);
    if (Number.isFinite(predicted)) item.predicted += predicted;
    if (isNumber(row.lower_bound) && isNumber(row.upper_bound)) {
      item.lower += Number(row.lower_bound);
      item.upper += Number(row.upper_bound);
    } else {
      item.bounded = false;
    }
    groups.set(row.forecast_date, item);
  });
  return Array.from(groups.values()).sort((left, right) => left.date.localeCompare(right.date));
}

function ChartSelector({ options, selectedChartIds, onSelectionChange }) {
  const selectedAvailableIds = selectedChartIds.filter((id) => options.some((option) => option.id === id));

  return (
    <div className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-sm dark:border-[#2E2A4A] dark:bg-[#211E35] md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Chart Selector</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Choose which forecast analytics to display below.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span aria-live="polite" className="mr-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
            {selectedAvailableIds.length} selected
          </span>
          <Button variant="secondary" size="sm" onClick={() => onSelectionChange(options.map((option) => option.id))}>
            Select All
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onSelectionChange([])}>
            Clear All
          </Button>
        </div>
      </div>

      <fieldset className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <legend className="sr-only">Select forecast analytics charts</legend>
        {options.map((option) => {
          const checked = selectedAvailableIds.includes(option.id);
          return (
            <label
              key={option.id}
              className={`flex min-h-[64px] cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-[#7C5CFC] ${
                checked
                  ? "border-[#7C5CFC]/50 bg-[#7C5CFC]/5 dark:bg-[#7C5CFC]/10"
                  : "border-slate-200 bg-slate-50/70 hover:border-slate-300 dark:border-[#2E2A4A] dark:bg-[#171525]/50 dark:hover:border-slate-600"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selectedAvailableIds, option.id]
                    : selectedAvailableIds.filter((id) => id !== option.id);
                  onSelectionChange(next);
                }}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[#7C5CFC] accent-[#7C5CFC] focus:ring-[#7C5CFC]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{option.title}</span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{option.type}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}

export default function ForecastCharts({
  history = [],
  forecastRows = [],
  historyLoading,
  historyError,
  selectedProductId = "All Products",
  modelRun,
  selectedChartIds = DEFAULT_FORECAST_CHART_IDS,
  onChartSelectionChange = () => {},
  showUncertaintyBands = true,
}) {
  const selectedHistory = useMemo(() => selectedProductId === "All Products" ? history : history.filter((row) => String(row.product_id) === String(selectedProductId)), [history, selectedProductId]);
  const selectedForecasts = useMemo(() => selectedProductId === "All Products" ? forecastRows : forecastRows.filter((row) => String(row.product_id) === String(selectedProductId)), [forecastRows, selectedProductId]);
  const dailySeries = useMemo(() => mergeDaily(selectedHistory, selectedForecasts), [selectedHistory, selectedForecasts]);
  const hasHistoricalValues = dailySeries.some((row) => isNumber(row.actual));
  const hasForecastValues = dailySeries.some((row) => isNumber(row.predicted));
  const horizonSeries = useMemo(() => forecastByDate(selectedForecasts), [selectedForecasts]);
  const forecastAverages = useMemo(() => averageByProduct(selectedForecasts, "product_id", "predicted_demand"), [selectedForecasts]);
  const historyAverages = useMemo(() => averageByProduct(selectedHistory, "product_id", "actual_demand"), [selectedHistory]);
  const productComparisons = useMemo(() => Array.from(forecastAverages, ([productId, forecastAverage]) => ({
    product: productId,
    history: historyAverages.get(productId),
    forecast: forecastAverage,
  })).map((row) => ({ ...row, change: isNumber(row.history) ? row.forecast - row.history : null })).filter((row) => isNumber(row.history)), [forecastAverages, historyAverages]);
  const productNames = useMemo(() => new Map(forecastRows.map((row) => [String(row.product_id), row.product_name]).filter(([, name]) => name && name !== "Name unavailable")), [forecastRows]);
  const labeledComparisons = useMemo(() => productComparisons.map((row) => ({ ...row, label: productNames.get(row.product) || row.product })), [productComparisons, productNames]);
  const histogram = useMemo(() => makeHistogram(selectedHistory), [selectedHistory]);
  const contributions = useMemo(() => {
    const totals = new Map();
    selectedForecasts.forEach((row) => {
      const productId = String(row.product_id ?? "ALL");
      totals.set(productId, (totals.get(productId) || 0) + Number(row.predicted_demand || 0));
    });
    return Array.from(totals, ([productId, value]) => ({ name: productNames.get(productId) || productId, value })).filter((row) => row.value > 0);
  }, [productNames, selectedForecasts]);
  const averageComparison = useMemo(() => {
    const actualValues = selectedHistory.map((row) => Number(row.actual_demand)).filter(Number.isFinite);
    const forecastValues = selectedForecasts.map((row) => Number(row.predicted_demand)).filter(Number.isFinite);
    if (!actualValues.length || !forecastValues.length) return [];
    return [{
      scope: selectedProductId === "All Products" ? "All products" : productNames.get(String(selectedProductId)) || selectedProductId,
      historical: actualValues.reduce((sum, value) => sum + value, 0) / actualValues.length,
      forecast: forecastValues.reduce((sum, value) => sum + value, 0) / forecastValues.length,
    }];
  }, [productNames, selectedForecasts, selectedHistory, selectedProductId]);
  const uncertaintySeries = useMemo(() => horizonSeries.filter((row) => row.bounded).map((row) => ({ ...row, range: row.upper - row.lower })), [horizonSeries]);
  const modelMetrics = useMemo(() => {
    const evaluated = modelRun?.parameters?.evaluated_models;
    if (!Array.isArray(evaluated)) return [];
    return evaluated.map((item) => ({
      model: item.model,
      mae: isNumber(item.mae) ? Number(item.mae) : null,
      rmse: isNumber(item.rmse) ? Number(item.rmse) : null,
    })).filter((item) => item.model && (item.mae != null || item.rmse != null));
  }, [modelRun]);
  const historyMissing = historyLoading ? "Loading actual demand from the selected dataset…" : historyError || "No usable historical date, product, and demand observations are available for this model run.";
  const forecastMissing = "Generate a forecast for this dataset to populate this chart with API results.";
  const scope = selectedProductId === "All Products" ? "All products" : productNames.get(String(selectedProductId)) || selectedProductId;
  const chartOptions = modelMetrics.length
    ? CHART_OPTIONS
    : CHART_OPTIONS.filter((option) => option.id !== "model-performance");
  const activeChartIds = selectedChartIds.filter((id) => chartOptions.some((option) => option.id === id));

  return (
    <section aria-label="Forecast charts" className="space-y-4">
      <ChartSelector options={chartOptions} selectedChartIds={selectedChartIds} onSelectionChange={onChartSelectionChange} />
      {activeChartIds.length ? (
      <div className="max-h-[72vh] min-w-0 overflow-y-auto overscroll-contain pr-1">
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {activeChartIds.includes("historical-forecast") && <ChartPanel title="Historical vs Forecast Demand" subtitle={`${scope} · actual and predicted demand by date`} className="xl:col-span-2">
          {hasHistoricalValues && hasForecastValues ? <ChartFrame><ResponsiveContainer width="100%" height="100%"><LineChart data={dailySeries} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}><CartesianGrid stroke="#ece9f2" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={24} {...chartAxisProps} /><YAxis {...chartAxisProps} /><Tooltip labelFormatter={dateLabel} contentStyle={chartTooltipStyle} labelStyle={{ color: "#302b3b", fontWeight: 700, marginBottom: 4 }} formatter={(value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} /><Legend {...chartLegendProps} /><Line type="monotone" dataKey="actual" name="Historical demand" stroke="#7C5CFC" strokeWidth={2.75} dot={{ r: 3, stroke: "#fff", strokeWidth: 1.5 }} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} connectNulls={false} animationDuration={450} /><Line type="monotone" dataKey="predicted" name="Forecast demand" stroke="#D946A8" strokeWidth={2.75} dot={{ r: 3, stroke: "#fff", strokeWidth: 1.5 }} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} connectNulls={false} animationDuration={450} /></LineChart></ResponsiveContainer></ChartFrame> : <MissingData message={!hasHistoricalValues ? historyMissing : forecastMissing} />}
        </ChartPanel>}

        {activeChartIds.includes("product-comparison") && <ChartPanel title="Product-wise Forecast Comparison" subtitle="Historical daily average vs forecast daily average, in units">
          {labeledComparisons.length ? <ChartFrame><ResponsiveContainer width="100%" height="100%"><BarChart data={labeledComparisons} margin={{ top: 10, right: 12, left: 4, bottom: 38 }} barCategoryGap="24%"><CartesianGrid stroke="#ece9f2" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" angle={-24} textAnchor="end" interval={0} height={60} {...chartAxisProps} /><YAxis {...chartAxisProps} /><Tooltip contentStyle={chartTooltipStyle} formatter={(value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} /><Legend {...chartLegendProps} /><Bar dataKey="history" name="Historical average" fill="#7C5CFC" radius={[4, 4, 0, 0]} animationDuration={450} /><Bar dataKey="forecast" name="Forecast average" fill="#D946A8" radius={[4, 4, 0, 0]} animationDuration={450} /></BarChart></ResponsiveContainer></ChartFrame> : <MissingData message={historyLoading ? historyMissing : !selectedHistory.length ? historyMissing : forecastMissing} />}
        </ChartPanel>}

        {activeChartIds.includes("horizon-trend") && <ChartPanel title="Forecast Horizon Trend" subtitle="Total forecast demand across products by forecast date">
          {horizonSeries.length ? <ChartFrame><ResponsiveContainer width="100%" height="100%"><AreaChart data={horizonSeries} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}><CartesianGrid stroke="#ece9f2" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={24} {...chartAxisProps} /><YAxis {...chartAxisProps} /><Tooltip labelFormatter={dateLabel} contentStyle={chartTooltipStyle} formatter={(value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} /><Area type="monotone" dataKey="predicted" name="Forecast demand" stroke="#D946A8" strokeWidth={2.5} fill="#D946A8" fillOpacity={0.14} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} animationDuration={450} /></AreaChart></ResponsiveContainer></ChartFrame> : <MissingData message={forecastMissing} />}
        </ChartPanel>}

        {activeChartIds.includes("historical-distribution") && <ChartPanel title="Historical Demand Distribution" subtitle="Frequency of actual daily product demand values">
          {histogram.length ? <ChartFrame><ResponsiveContainer width="100%" height="100%"><BarChart data={histogram} margin={{ top: 10, right: 8, left: 0, bottom: 4 }}><CartesianGrid stroke="#ece9f2" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="bin" interval="preserveStartEnd" {...chartAxisProps} /><YAxis allowDecimals={false} {...chartAxisProps} /><Tooltip contentStyle={chartTooltipStyle} formatter={(value) => Number(value).toLocaleString()} /><Bar dataKey="count" name="Observations" fill="#7C5CFC" radius={[4, 4, 0, 0]} animationDuration={450} /></BarChart></ResponsiveContainer></ChartFrame> : <MissingData message={historyLoading ? historyMissing : historyMissing} />}
        </ChartPanel>}

        {activeChartIds.includes("forecast-contribution") && <ChartPanel title="Forecast Demand Contribution" subtitle="Share of total forecast demand by product">
          {contributions.length ? <ChartFrame><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={contributions} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="76%" paddingAngle={2} label={false} stroke="#fff" strokeWidth={2} animationDuration={450}>{contributions.map((item, index) => <Cell key={item.name} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip contentStyle={chartTooltipStyle} formatter={(value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} /><Legend {...chartLegendProps} /></PieChart></ResponsiveContainer></ChartFrame> : <MissingData message={forecastMissing} />}
        </ChartPanel>}

        {activeChartIds.includes("average-comparison") && <ChartPanel title="Historical vs Forecast Average" subtitle="Mean daily demand for the selected product scope">
          {averageComparison.length ? <ChartFrame><ResponsiveContainer width="100%" height="100%"><BarChart data={averageComparison} margin={{ top: 10, right: 8, left: 4, bottom: 4 }} barCategoryGap="28%"><CartesianGrid stroke="#ece9f2" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="scope" {...chartAxisProps} /><YAxis {...chartAxisProps} /><Tooltip contentStyle={chartTooltipStyle} formatter={(value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} /><Legend {...chartLegendProps} /><Bar dataKey="historical" name="Historical average" fill="#7C5CFC" radius={[4, 4, 0, 0]} animationDuration={450} /><Bar dataKey="forecast" name="Forecast average" fill="#D946A8" radius={[4, 4, 0, 0]} animationDuration={450} /></BarChart></ResponsiveContainer></ChartFrame> : <MissingData message={historyLoading ? historyMissing : !selectedForecasts.length ? forecastMissing : historyMissing} />}
        </ChartPanel>}

        {activeChartIds.includes("demand-change") && <ChartPanel title="Demand Change by Product" subtitle="Forecast daily average minus historical daily average">
          {labeledComparisons.some((row) => isNumber(row.change)) ? <ChartFrame><ResponsiveContainer width="100%" height="100%"><BarChart data={labeledComparisons.filter((row) => isNumber(row.change))} layout="vertical" margin={{ top: 10, right: 12, left: 8, bottom: 4 }} barCategoryGap="24%"><CartesianGrid stroke="#ece9f2" strokeDasharray="3 5" vertical={false} /><XAxis type="number" {...chartAxisProps} /><YAxis type="category" dataKey="label" width={112} {...chartAxisProps} /><ReferenceLine x={0} stroke="#aaa5b5" strokeDasharray="3 3" /><Tooltip contentStyle={chartTooltipStyle} formatter={(value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} /><Bar dataKey="change" name="Demand change" radius={[0, 4, 4, 0]} animationDuration={450}>{labeledComparisons.filter((row) => isNumber(row.change)).map((row) => <Cell key={row.product} fill={row.change >= 0 ? "#D946A8" : "#7C5CFC"} />)}</Bar></BarChart></ResponsiveContainer></ChartFrame> : <MissingData message={historyLoading ? historyMissing : "A product needs both historical demand and forecast values to calculate change."} />}
        </ChartPanel>}

        {activeChartIds.includes("forecast-uncertainty") && <ChartPanel title="Forecast Uncertainty" subtitle="Predicted demand with summed lower and upper bounds by date">
          {!showUncertaintyBands ? <MissingData message="Uncertainty bands are disabled in Forecasting Preferences." /> : uncertaintySeries.length ? <ChartFrame><ResponsiveContainer width="100%" height="100%"><ComposedChart data={uncertaintySeries} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}><CartesianGrid stroke="#ece9f2" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={24} {...chartAxisProps} /><YAxis {...chartAxisProps} /><Tooltip labelFormatter={dateLabel} contentStyle={chartTooltipStyle} labelStyle={{ color: "#302b3b", fontWeight: 700, marginBottom: 4 }} formatter={(value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} /><Legend {...chartLegendProps} /><Area dataKey="lower" name="Lower bound baseline" stackId="range" stroke="transparent" fill="transparent" legendType="none" /><Area dataKey="range" name="Prediction range" stackId="range" stroke="#7C5CFC" fill="#7C5CFC" fillOpacity={0.16} animationDuration={450} /><Line dataKey="predicted" name="Predicted demand" stroke="#D946A8" strokeWidth={2.5} dot={{ r: 3, stroke: "#fff", strokeWidth: 1.5 }} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} animationDuration={450} /></ComposedChart></ResponsiveContainer></ChartFrame> : <MissingData message={forecastRows.length ? "The forecast API did not return usable lower and upper bounds." : forecastMissing} />}
        </ChartPanel>}

        {activeChartIds.includes("model-performance") && modelMetrics.length > 0 && <ChartPanel title="Model Performance Comparison" subtitle="Persisted evaluation metrics from the selected model run">
          <ChartFrame><ResponsiveContainer width="100%" height="100%"><BarChart data={modelMetrics} margin={{ top: 10, right: 8, left: 4, bottom: 4 }} barCategoryGap="28%"><CartesianGrid stroke="#ece9f2" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="model" {...chartAxisProps} /><YAxis {...chartAxisProps} /><Tooltip contentStyle={chartTooltipStyle} formatter={(value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 })} /><Legend {...chartLegendProps} /><Bar dataKey="mae" name="MAE" fill="#7C5CFC" radius={[4, 4, 0, 0]} animationDuration={450} /><Bar dataKey="rmse" name="RMSE" fill="#D946A8" radius={[4, 4, 0, 0]} animationDuration={450} /></BarChart></ResponsiveContainer></ChartFrame>
        </ChartPanel>}
      </div>
      </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No charts selected. Choose one or more charts above to display analytics for the selected dataset and filters.
        </div>
      )}
    </section>
  );
}