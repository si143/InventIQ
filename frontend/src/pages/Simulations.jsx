import React, { useEffect, useRef, useState } from "react";
import PageHeader from "../components/ui/PageHeader";
import Card, { CardTitle } from "../components/ui/Card";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Badge from "../components/ui/Badge";
import AIInsightCard from "../components/ui/AIInsightCard";
import { useAuth } from "../context/AuthContext";
import { useDataset } from "../context/DatasetContext";

const API_BASE = "/api";

function metric(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "-";
}

const savedScenarios = [
  {
    id: "black_friday",
    name: "Black Friday Demand Surge (+35%)",
    tag: "High Impact",
    time: "30-day window",
    simulationType: "demand_spike",
    demandChange: 35,
    supported: true,
  },
  {
    id: "port_delay",
    name: "Port Delay Emergency (+10 Days)",
    tag: "Supply Chain",
    time: "60-day window",
    simulationType: "supplier_delay",
    leadTimeDelay: 10,
    supported: true,
    limitation: "Lead-time context is recorded, but stockout timing cannot be calculated without inventory and supplier lead-time data.",
  },
  {
    id: "supplier_price",
    name: "Supplier Price Increase (+8%)",
    tag: "Financial",
    time: "Quarterly",
    supported: false,
    limitation: "Price impact is not supported by the current simulation API because supplier cost and margin inputs are unavailable.",
  },
  {
    id: "warehouse",
    name: "New Regional Warehouse Launch",
    tag: "Logistics",
    time: "Immediate",
    supported: false,
    limitation: "Warehouse impact is not supported because the dataset has no location, capacity, or fulfillment inputs.",
  },
];

export default function Simulations({ active = true, onNavigatePage }) {
  const { apiFetch } = useAuth();
  const { datasets, selectedDatasetId, setSelectedDatasetId } = useDataset();
  const [simulationType, setSimulationType] = useState("demand_spike");
  const [demandSpike, setDemandSpike] = useState("15");
  const [leadTimeDelay, setLeadTimeDelay] = useState("5");
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState(null);
  const [error, setError] = useState("");
  const [counterfactualAdjustment, setCounterfactualAdjustment] = useState("10");
  const [counterfactualLoading, setCounterfactualLoading] = useState(false);
  const [counterfactualResult, setCounterfactualResult] = useState(null);
  const [counterfactualError, setCounterfactualError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [forecastRuns, setForecastRuns] = useState([]);
  const [forecastRunsLoading, setForecastRunsLoading] = useState(false);
  const [forecastRunsError, setForecastRunsError] = useState("");
  const [forecastRunId, setForecastRunId] = useState("");
  const lastDatasetId = useRef(selectedDatasetId);

  useEffect(() => {
    let cancelled = false;
    const datasetChanged = String(lastDatasetId.current || "") !== String(selectedDatasetId || "");
    lastDatasetId.current = selectedDatasetId;

    if (datasetChanged) {
      setSimulationResult(null);
      setError("");
      setCounterfactualResult(null);
      setCounterfactualError("");
      setForecastRunId("");
      setForecastRuns([]);
      setForecastRunsError("");
    }

    if (!active || !selectedDatasetId) {
      setRestoring(false);
      setForecastRunsLoading(false);
      setSimulationResult(null);
      setCounterfactualResult(null);
      return () => { cancelled = true; };
    }

    async function restoreSavedSimulations() {
      setRestoring(true);
      setForecastRunsLoading(true);
      try {
        const [response, forecastResponse] = await Promise.all([
          apiFetch(`${API_BASE}/simulations?dataset_id=${encodeURIComponent(selectedDatasetId)}`),
          apiFetch(`${API_BASE}/forecasts/history?dataset_id=${encodeURIComponent(selectedDatasetId)}`),
        ]);
        const records = await response.json().catch(() => []);
        const forecastHistory = await forecastResponse.json().catch(() => []);
        if (!response.ok) throw new Error(records.detail || "Unable to load saved simulations.");
        if (cancelled) return;

        const completed = (Array.isArray(records) ? records : []).filter((record) => record.status === "completed");
        const latestCounterfactual = completed.find((record) => record.simulation_type === "counterfactual_inventory");
        const latestScenario = completed.find((record) => record.simulation_type !== "counterfactual_inventory");
        setCounterfactualResult(latestCounterfactual?.results || null);
        setSimulationResult(latestScenario?.results || null);
        if (!forecastResponse.ok) {
          setForecastRuns([]);
          setForecastRunsError(forecastHistory.detail || "Unable to load saved forecasts.");
        } else if (!Array.isArray(forecastHistory)) {
          setForecastRuns([]);
          setForecastRunsError("The forecast-history endpoint returned an invalid response.");
        } else {
          const matchingRuns = forecastHistory
            .filter((run) => String(run.dataset_id) === String(selectedDatasetId) && Number(run.forecast_count) > 0)
            .sort((left, right) => {
              const dateOrder = new Date(right.generation_date || 0).getTime() - new Date(left.generation_date || 0).getTime();
              return dateOrder || Number(right.model_run_id) - Number(left.model_run_id);
            });
          setForecastRuns(matchingRuns);
          setForecastRunId((current) => matchingRuns.some((run) => String(run.model_run_id) === String(current))
            ? current
            : String(matchingRuns[0]?.model_run_id || ""));
          setForecastRunsError("");
        }

        if (latestScenario?.parameters) {
          setSimulationType(latestScenario.parameters.simulation_type || latestScenario.simulation_type || "demand_spike");
          if (latestScenario.parameters.demand_change != null) setDemandSpike(String(latestScenario.parameters.demand_change));
          if (latestScenario.parameters.lead_time_delay != null) setLeadTimeDelay(String(latestScenario.parameters.lead_time_delay));
        }
        if (latestCounterfactual?.parameters?.adjustment_percent != null) {
          setCounterfactualAdjustment(String(latestCounterfactual.parameters.adjustment_percent));
        }
        setError("");
        setCounterfactualError("");
      } catch (restoreError) {
        if (!cancelled) setError(restoreError.message || "Unable to load saved simulations.");
      } finally {
        if (!cancelled) {
          setRestoring(false);
          setForecastRunsLoading(false);
        }
      }
    }

    restoreSavedSimulations();
    return () => { cancelled = true; };
  }, [active, apiFetch, selectedDatasetId]);

  const handleRunSimulation = async () => {
    if (!selectedDatasetId || !forecastRunId) {
      setError("Select a dataset with a saved forecast before running a simulation.");
      return;
    }
    setSimulating(true);
    setError("");
    if (selectedScenario && !selectedScenario.supported) {
      setError(selectedScenario.limitation);
      setSimulating(false);
      return;
    }
    try {
      const response = await apiFetch(`${API_BASE}/simulations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: Number(selectedDatasetId),
          forecast_run_id: Number(forecastRunId),
          simulation_type: simulationType,
          demand_change: Number(demandSpike),
          lead_time_delay: Number(leadTimeDelay),
          name: selectedScenario?.name || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Simulation failed.");
      setSimulationResult(payload.results);
    } catch (err) {
      setError(err.message || "Simulation failed.");
    } finally {
      setSimulating(false);
    }
  };

  const handleScenarioSelect = (scenario) => {
    setSelectedScenario(scenario);
    setError(scenario.supported ? "" : scenario.limitation);
    if (!scenario.supported) return;
    setSimulationType(scenario.simulationType);
    if (scenario.demandChange !== undefined) setDemandSpike(String(scenario.demandChange));
    if (scenario.leadTimeDelay !== undefined) setLeadTimeDelay(String(scenario.leadTimeDelay));
  };

  const handleCounterfactual = async () => {
    if (!selectedDatasetId || !forecastRunId) {
      setCounterfactualError("Select a dataset with a saved forecast before running a counterfactual simulation.");
      return;
    }
    const adjustment = Number(counterfactualAdjustment);
    if (!Number.isFinite(adjustment) || adjustment < -100 || adjustment > 1000) {
      setCounterfactualError("Inventory adjustment must be a valid percentage between -100% and 1000%.");
      return;
    }
    setCounterfactualLoading(true);
    setCounterfactualError("");
    try {
      const response = await apiFetch(`${API_BASE}/simulations/counterfactual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset_id: Number(selectedDatasetId), forecast_run_id: Number(forecastRunId), scenario_type: "inventory_adjustment", adjustment_percent: adjustment }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Unable to run counterfactual simulation.");
      setCounterfactualResult(payload.results);
    } catch (err) {
      setCounterfactualError(err.message || "Unable to run counterfactual simulation.");
    } finally {
      setCounterfactualLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        category="INTELLIGENCE"
        title="Inventory What-If Simulations"
        subtitle="Simulate demand surges and supplier delays to evaluate operating resilience."
      />

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      {restoring && <p className="text-sm text-slate-500">Loading saved simulation results...</p>}
      {forecastRunsError && <p className="text-sm text-rose-600 dark:text-rose-400">{forecastRunsError}</p>}
      {!forecastRunsLoading && selectedDatasetId && !forecastRunsError && forecastRuns.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          <span>No saved forecast exists for this dataset. Generate one before running a simulation.</span>
          <Button variant="secondary" size="sm" onClick={() => onNavigatePage?.("forecasts")}>Open Demand Forecasts</Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1 space-y-4">
          <CardTitle subtitle="Set scenario parameters">Simulation Config</CardTitle>

          <Select label="Dataset" value={selectedDatasetId} onChange={(e) => setSelectedDatasetId(e.target.value)} required>
            <option value="">Select dataset</option>
            {datasets.map((dataset) => (
              <option key={dataset.dataset_id} value={dataset.dataset_id}>
                {dataset.filename}
              </option>
            ))}
          </Select>

          {forecastRuns.length > 0 && (
            <Select
              label="Completed Forecast Run"
              value={forecastRunId}
              onChange={(event) => setForecastRunId(event.target.value)}
              helper={`${forecastRuns.length} saved forecast run${forecastRuns.length === 1 ? "" : "s"} for this dataset`}
            >
              {forecastRuns.map((run) => (
                <option key={run.model_run_id} value={run.model_run_id}>
                  {run.model_name || "Forecast"} · Run #{run.model_run_id} · {run.forecast_count} predictions
                </option>
              ))}
            </Select>
          )}
          {forecastRunsLoading && <p className="text-xs text-slate-500">Loading saved forecasts...</p>}

          <Select
            label="Scenario Type"
            value={simulationType}
            onChange={(e) => setSimulationType(e.target.value)}
          >
            <option value="demand_spike">Surge in Market Demand (%)</option>
            <option value="supplier_delay">Supplier Lead Time Delay (Days)</option>
            <option value="promo_impact">Marketing Campaign Spike</option>
          </Select>

          {simulationType === "demand_spike" && (
            <Input
              label="Demand Surge (%)"
              type="number"
              min="-100"
              max="1000"
              step="1"
              value={demandSpike}
              onChange={(e) => setDemandSpike(e.target.value)}
              helper="Demand change from -100% to 1000%"
            />
          )}

          {simulationType === "supplier_delay" && (
            <Input
              label="Lead Time Delay (Days)"
              type="number"
              min="0"
              max="365"
              step="1"
              value={leadTimeDelay}
              onChange={(e) => setLeadTimeDelay(e.target.value)}
              helper="Supplier delay from 0 to 365 days"
            />
          )}

          <Button
            variant="gradient"
            className="w-full"
            loading={simulating}
              onClick={handleRunSimulation}
              disabled={!forecastRunId || Boolean(selectedScenario && !selectedScenario.supported)}
          >
            🧪 Execute Simulation
          </Button>
        </Card>

        <div className="lg:col-span-2 space-y-6">
          <AIInsightCard
            title="SIMULATION INTELLIGENCE"
            subtitle={
              simulationResult
                ? `Simulation Results: ${simulationType.replace("_", " ").toUpperCase()}`
                : "Select parameters and run a scenario"
            }
          >
            {simulationResult ? (
              <div className="space-y-3 mt-2">
                <p>
                  Running <b>{simulationResult.scenario_label}</b> from {simulationResult.source} for {simulationResult.forecast_products} products.
                </p>
                {simulationResult.limitations?.map((limitation) => (
                  <p key={limitation} className="text-sm text-amber-700 dark:text-amber-300">{limitation}</p>
                ))}
                <div className="grid gap-3 sm:grid-cols-3 mt-4">
                  <div className="p-3 rounded-xl bg-white/70 dark:bg-[#171525]/60 border border-slate-200 dark:border-[#2E2A4A]">
                    <span className="text-[11px] font-bold text-slate-400">IMPACTED SKUS</span>
                    <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                      {simulationResult.impacted_skus} SKUs
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/70 dark:bg-[#171525]/60 border border-slate-200 dark:border-[#2E2A4A]">
                    <span className="text-[11px] font-bold text-slate-400">STOCKOUT RISK</span>
                    <p className="text-xl font-bold text-rose-600 dark:text-rose-400 mt-1">
                      {simulationResult.stockout_exposure}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/70 dark:bg-[#171525]/60 border border-slate-200 dark:border-[#2E2A4A]">
                    <span className="text-[11px] font-bold text-slate-400">WORKING CAPITAL NEEDED</span>
                    <p className="text-xl font-bold text-[#7C5CFC] mt-1">
                      {simulationResult.working_capital}
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3 text-sm">
                  <div><span className="font-bold text-slate-400">BASELINE DEMAND</span><p>{metric(simulationResult.baseline_demand)} units</p></div>
                  <div><span className="font-bold text-slate-400">SIMULATED DEMAND</span><p>{metric(simulationResult.simulated_demand)} units</p></div>
                  <div><span className="font-bold text-slate-400">DEMAND IMPACT</span><p>{metric(simulationResult.demand_impact)} units ({metric(simulationResult.demand_impact_percent)}%)</p></div>
                </div>
              </div>
            ) : (
              <p>
                What-if simulations allow you to test inventory vulnerability before demand shocks occur.
                Adjust the scenario parameters on the left and click Execute.
              </p>
            )}
          </AIInsightCard>

          {/* Prebuilt Scenarios */}
          <Card>
            <CardTitle subtitle="Quick run pre-configured scenarios">
              Saved Simulation Scenarios
            </CardTitle>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {savedScenarios.map((sc) => (
                <div
                  key={sc.id}
                  className={`p-4 rounded-xl bg-slate-50/70 dark:bg-[#171525]/40 border border-slate-200 dark:border-[#2E2A4A] transition ${sc.supported ? "hover:border-[#7C5CFC] cursor-pointer" : "opacity-70 cursor-not-allowed"}`}
                  onClick={() => handleScenarioSelect(sc)}
                >
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      {sc.name}
                    </span>
                    <Badge variant="purple">{sc.tag}</Badge>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">{sc.time}</p>
                  <p className="mt-2 text-[11px] text-slate-500">{sc.supported ? "Select to load parameters" : sc.limitation}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card className="space-y-4">
        <CardTitle subtitle="What would happen if inventory policy changed?">Counterfactual Inventory Simulation</CardTitle>
        <div className="grid gap-4 md:grid-cols-[1fr_180px_auto] md:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Scenario</label>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Inventory adjustment</p>
            <p className="mt-1 text-xs text-slate-500">Forecast demand stays at the selected dataset baseline.</p>
          </div>
          <Input label="Adjustment (%)" type="number" min="-100" max="1000" step="1" value={counterfactualAdjustment} onChange={(event) => setCounterfactualAdjustment(event.target.value)} />
          <Button variant="gradient" loading={counterfactualLoading} onClick={handleCounterfactual} disabled={!forecastRunId}>Run Counterfactual Simulation</Button>
        </div>
        {counterfactualError && <p className="text-sm text-rose-600 dark:text-rose-400">{counterfactualError}</p>}
        {counterfactualResult && (
          <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-[#2E2A4A]">
            <div className="grid gap-3 md:grid-cols-3">
              {[['BASELINE', counterfactualResult.baseline], ['COUNTERFACTUAL', counterfactualResult.counterfactual], ['DIFFERENCE', counterfactualResult.differences]].map(([label, values]) => (
                <div key={label} className="rounded-xl border border-slate-200 p-3 dark:border-[#2E2A4A]">
                  <p className="text-[11px] font-bold text-slate-400">{label}</p>
                  <p className="mt-2 text-sm">Forecast demand: <b>{metric(values.forecast_demand)} units</b></p>
                  <p className="text-sm">Inventory: <b>{values.inventory_quantity == null ? "N/A — inventory data unavailable" : metric(values.inventory_quantity)}</b></p>
                  <p className="text-sm">Shortage: <b>{values.expected_shortage == null ? "N/A — inventory data unavailable" : metric(values.expected_shortage)}</b></p>
                </div>
              ))}
            </div>
            {counterfactualResult.data_limitations?.map((limitation) => <p key={limitation} className="text-sm text-amber-700 dark:text-amber-300">{limitation}</p>)}
            <p className="text-xs text-slate-500">This comparison uses completed forecast demand and does not prove future inventory outcomes. Inventory, shortage, risk, and cost changes are shown only when the selected dataset contains the required fields.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
