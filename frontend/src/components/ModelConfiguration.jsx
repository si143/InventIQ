import React, { useEffect, useState } from "react";
import PageHeader from "./ui/PageHeader";
import Card, { CardTitle } from "./ui/Card";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import Select from "./ui/Select";
import Table, { TableRow, TableCell } from "./ui/Table";
import ErrorState from "./ui/ErrorState";
import { useAuth } from "../context/AuthContext";
import { useDataset } from "../context/DatasetContext";
import { getDemoDatasets } from "../utils/datasetStorage";
import { loadSettings } from "../utils/settings";

const API_BASE = "/api";

const modelCardsInfo = [
  {
    name: "Auto Select",
    icon: "✨",
    desc: "Evaluates all models and selects the lowest MAE.",
    useCase: "Recommended default for optimal accuracy",
  },
  {
    name: "Linear Regression",
    icon: "📐",
    desc: "Fast baseline linear demand modeling.",
    useCase: "Steady demand trends with low variance",
  },
  {
    name: "Random Forest",
    icon: "🌲",
    desc: "Ensemble decision trees for complex nonlinear patterns.",
    useCase: "Multi-product features and seasonal demand",
  },
  {
    name: "XGBoost",
    icon: "⚡",
    desc: "Gradient boosted trees with high precision.",
    useCase: "Large datasets and competitive forecasting",
  },
  {
    name: "ARIMA",
    icon: "📈",
    desc: "Autoregressive integrated moving average for time-series.",
    useCase: "Pure chronological sequential data",
  },
];

function formatMetric(value) {
  return value == null ? "-" : Number(value).toFixed(3);
}

function inferDemoColumns(columns = []) {
  return columns.map((name) => {
    const lowered = String(name).toLowerCase();
    let role = "categorical";
    if (/(date|time|day|month|week)/.test(lowered)) role = "date";
    else if (/(product|sku|item|brand|category)/.test(lowered)) role = "product";
    else if (/(demand|sales|units|quantity|revenue|orders)/.test(lowered)) role = "target";
    else if (/(stock|inventory|on_hand|current_stock)/.test(lowered)) role = "numeric";

    return {
      name,
      dtype: /(date|time)/.test(lowered) ? "datetime" : /(int|qty|units|stock|sales|demand|quantity|revenue|price|cost)/.test(lowered) ? "numeric" : "string",
      role,
    };
  });
}

export default function ModelConfiguration({ onOpenForecast }) {
  const { datasets, selectedDatasetId, setSelectedDatasetId } = useDataset();
  const { apiFetch, token } = useAuth();
  const isDemoSession = import.meta.env.DEV && token?.startsWith("demo-");
  const [settings, setSettings] = useState(loadSettings);
  const [columns, setColumns] = useState([]);
  const [targetColumn, setTargetColumn] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  const [productColumn, setProductColumn] = useState("");
  const [horizon, setHorizon] = useState(() => loadSettings().forecasting.defaultHorizon);
  const [modelName, setModelName] = useState(() => loadSettings().forecasting.defaultModel);
  const [training, setTraining] = useState(false);
  const [result, setResult] = useState(null);
  const [runs, setRuns] = useState([]);
  const [error, setError] = useState("");
  const visibleMetrics = [
    ["mae", "MAE", "Mean Absolute Error"],
    ["rmse", "RMSE", "Root Mean Square Error"],
    ["r2_score", "R² Score", "Coefficient of determination"],
  ].filter(([key]) => settings.forecasting.evaluationMetrics.includes(key));

  useEffect(() => {
    const syncSettings = () => {
      const next = loadSettings();
      setSettings(next);
      setModelName(next.forecasting.defaultModel);
      setHorizon(next.forecasting.defaultHorizon);
    };
    window.addEventListener("inventiq-settings-updated", syncSettings);
    return () => window.removeEventListener("inventiq-settings-updated", syncSettings);
  }, []);

  useEffect(() => {
    if (!selectedDatasetId) {
      setRuns([]);
      return undefined;
    }
    apiFetch(`${API_BASE}/model-runs?dataset_id=${selectedDatasetId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setRuns(data))
      .catch(() => setRuns([]));
  }, [selectedDatasetId]);

  useEffect(() => {
    if (!selectedDatasetId) {
      setColumns([]);
      setTargetColumn("");
      setDateColumn("");
      setProductColumn("");
      setError("");
      return;
    }

    if (isDemoSession) {
      const demoDataset = getDemoDatasets().find((dataset) => String(dataset.dataset_id) === String(selectedDatasetId));
      const nextColumns = demoDataset?.analytics?.column_names ? inferDemoColumns(demoDataset.analytics.column_names) : [];
      setColumns(nextColumns);
      setTargetColumn(nextColumns.find((c) => c.role === "target")?.name || "");
      setDateColumn(nextColumns.find((c) => c.role === "date")?.name || "");
      setProductColumn(nextColumns.find((c) => c.role === "product")?.name || "");
      setResult(null);
      setError("");
      return;
    }

    let isMounted = true;
    setError("");
    apiFetch(`${API_BASE}/datasets/${selectedDatasetId}/columns`)
      .then((res) =>
        res.ok
          ? res.json()
          : Promise.reject(new Error("Unable to load dataset columns.")),
      )
      .then((data) => {
        if (!isMounted) return;
        const nextColumns = Array.isArray(data?.columns) ? data.columns : [];
        setColumns(nextColumns);
        setTargetColumn(nextColumns.find((c) => c.role === "target")?.name || "");
        setDateColumn(nextColumns.find((c) => c.role === "date")?.name || "");
        setProductColumn(nextColumns.find((c) => c.role === "product")?.name || "");
        setResult(null);
      })
      .catch((err) => {
        if (!isMounted) return;
        setColumns([]);
        setError(err.message || "Unable to load dataset columns.");
      });

    return () => {
      isMounted = false;
    };
  }, [selectedDatasetId, isDemoSession, apiFetch]);

  const handleTrain = async (e) => {
    e.preventDefault();
    if (!selectedDatasetId || !targetColumn) {
      setError("Select a dataset and target column before training.");
      return;
    }
    setTraining(true);
    setError("");
    setResult(null);

    try {
      const response = await apiFetch(`${API_BASE}/model-runs/train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: Number(selectedDatasetId),
          target_column: targetColumn,
          date_column: dateColumn || null,
          product_column: productColumn || null,
          forecast_horizon: Number(horizon),
          model_name: modelName,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Model training failed.");

      setResult(payload);
      setRuns((prev) => [payload, ...prev]);
    } catch (err) {
      setError(err.message || "Model training failed.");
    } finally {
      setTraining(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <PageHeader
        category="ML WORKSPACE"
        title="Model Configuration"
        subtitle="Configure your dataset fields, select an ML algorithm, and train demand forecasting models."
      />

      {error && !selectedDatasetId && <ErrorState message="No dataset is selected. Upload a dataset to begin forecasting." />}
      {error && selectedDatasetId && <ErrorState message={error} />}

      {/* Model Selection Cards */}
      <div className="space-y-3">
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Select Forecasting Model
        </label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {modelCardsInfo.map((card) => {
            const isSelected = modelName === card.name;
            return (
              <div
                key={card.name}
                onClick={() => setModelName(card.name)}
                className={`p-4 rounded-[20px] border transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? "bg-gradient-to-br from-[#FCE7F3] to-[#EDE9FE] dark:from-[#D946A8]/20 dark:to-[#7C5CFC]/20 border-[#D946A8] dark:border-[#f472c1] shadow-md ring-2 ring-[#D946A8]/30"
                    : "bg-white dark:bg-[#211E35] border-slate-200/80 dark:border-[#2E2A4A] hover:border-slate-300 dark:hover:border-slate-600"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xl">{card.icon}</span>
                  {isSelected && <Badge variant="pink">Selected</Badge>}
                </div>
                <h4 className="mt-3 font-bold text-sm text-slate-900 dark:text-white">
                  {card.name}
                </h4>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                  {card.desc}
                </p>
                <div className="mt-3 pt-2 border-t border-slate-100 dark:border-[#2E2A4A]/60 text-[10px] text-[#7C5CFC] font-semibold truncate">
                  {card.useCase}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Training Configuration Form */}
      <form onSubmit={handleTrain}>
        <Card className="space-y-5">
          <CardTitle subtitle="Map fields and forecast horizon">
            Training Parameters
          </CardTitle>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label="Dataset"
              value={selectedDatasetId}
              onChange={(e) => setSelectedDatasetId(e.target.value)}
              helper="Select uploaded dataset to train on"
              required
            >
              <option value="">Select dataset</option>
              {datasets.map((d) => (
                <option key={d.dataset_id} value={d.dataset_id}>
                  {d.filename}
                </option>
              ))}
            </Select>

            <Select
              label="Target Column (Demand)"
              value={targetColumn}
              onChange={(e) => setTargetColumn(e.target.value)}
              disabled={!columns.length}
              helper="Numeric column to learn and predict"
              required
            >
              <option value="">Select target column</option>
              {columns
                .filter((c) => c.dtype === "numeric")
                .map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.dtype})
                  </option>
                ))}
            </Select>

            <Select
              label="Date Column"
              value={dateColumn}
              onChange={(e) => setDateColumn(e.target.value)}
              disabled={!columns.length}
              helper="Optional chronological field"
            >
              <option value="">No date column</option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.dtype})
                </option>
              ))}
            </Select>

            <Select
              label="Product / SKU Column"
              value={productColumn}
              onChange={(e) => setProductColumn(e.target.value)}
              disabled={!columns.length}
              helper="Optional item identifier"
            >
              <option value="">No product column</option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.dtype})
                </option>
              ))}
            </Select>

            <Select
              label="Forecast Horizon"
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
              helper="Future periods to project"
            >
              <option value="7">7 Days</option>
              <option value="14">14 Days</option>
              <option value="30">30 Days</option>
              <option value="60">60 Days</option>
              <option value="90">90 Days</option>
            </Select>

            <div className="flex items-end">
              <Button
                variant="gradient"
                type="submit"
                loading={training}
                disabled={!selectedDatasetId || !targetColumn}
                className="w-full py-3"
              >
                {training ? "Training ML Model..." : "⚡ Train Model"}
              </Button>
            </div>
          </div>
        </Card>
      </form>

      {/* Training Results Section */}
      {result && (
        <Card className="bg-gradient-to-br from-emerald-500/5 to-emerald-500/10 border-emerald-500/20 space-y-5 animate-fadeIn">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                MODEL TRAINING COMPLETE
              </p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
                {result.selected_model || result.model_name}
              </h3>
            </div>
            {onOpenForecast && (
              <Button variant="gradient" onClick={onOpenForecast}>
                Generate Forecast →
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ...visibleMetrics.map(([key, label, description]) => [key, `${label} (${description})`, result[key]]),
              ["status", "Training Status", result.status],
            ].map(([key, label, val]) => (
              <Card key={label} padding="p-4" glass>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {label}
                </div>
                <div className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">
                  {key === "status" ? val : formatMetric(val)}
                </div>
              </Card>
            ))}
          </div>

          {result.evaluated_models?.length > 1 && (
            <Table headers={["Model", ...visibleMetrics.map(([, label]) => label)]}>
              {result.evaluated_models.map((item) => (
                <TableRow key={item.model}>
                  <TableCell bold>
                    {item.model}
                    {item.model === result.selected_model ? (
                      <span className="ml-2 text-xs text-[#D946A8] font-bold">
                        (Selected Best Model)
                      </span>
                    ) : (
                      ""
                    )}
                  </TableCell>
                  {visibleMetrics.map(([key]) => <TableCell key={key}>{formatMetric(item[key])}</TableCell>)}
                </TableRow>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* Previous Runs Table */}
      {runs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Previous Model Runs History
          </h3>
          <Table headers={["Model Name", "Dataset", "MAE", "Status", "Trained At"]}>
            {runs.filter((run) => String(run.dataset_id) === String(selectedDatasetId)).slice(0, 6).map((run) => (
              <TableRow key={run.id}>
                <TableCell bold>{run.model_name}</TableCell>
                <TableCell>{run.dataset_name || run.dataset_id}</TableCell>
                <TableCell>{formatMetric(run.mae)}</TableCell>
                <TableCell>
                  <Badge variant={run.status === "completed" ? "low" : "medium"}>
                    {run.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {run.created_at ? new Date(run.created_at).toLocaleString() : "-"}
                </TableCell>
              </TableRow>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}
