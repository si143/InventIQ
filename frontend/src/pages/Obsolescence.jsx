import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "../components/ui/PageHeader";
import Card, { CardTitle } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Table, { TableRow, TableCell } from "../components/ui/Table";
import Modal from "../components/ui/Modal";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import { useAuth } from "../context/AuthContext";
import { useDataset } from "../context/DatasetContext";

const API_BASE = "/api";

function metric(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "-";
}

function percentage(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "-";
}

function badgeVariant(level) {
  return { Critical: "high", High: "high", Moderate: "medium", Low: "low" }[level] || "info";
}

function Details({ item, onClose }) {
  return (
    <Modal isOpen={true} onClose={onClose} category="COMMERCIAL DEMAND RISK" title={item.product_name || item.product_id} subtitle={item.category || "Uncategorized"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-[#2E2A4A] p-4"><div className="text-[10px] font-bold uppercase text-slate-400">Risk score</div><div className="mt-1 text-2xl font-black">{metric(item.risk_score)} / 100</div></div>
        <div className="rounded-xl border border-slate-200 dark:border-[#2E2A4A] p-4"><div className="text-[10px] font-bold uppercase text-slate-400">Risk level</div><div className="mt-2"><Badge variant={badgeVariant(item.risk_level)}>{item.risk_level}</Badge></div></div>
        {[['Recent demand', metric(item.recent_demand)], ['Historical demand', metric(item.historical_demand)], ['Decline', percentage(item.decline_rate)], ['Sales velocity', `${metric(item.recent_velocity)} units/day`], ['Trend', item.trend], ['Observations', item.observations]].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 dark:border-[#2E2A4A] p-4"><div className="text-[10px] font-bold uppercase text-slate-400">{label}</div><div className="mt-1 text-sm font-semibold">{value}</div></div>)}
      </div>
      {item.forecast_demand != null && <div className="rounded-xl border border-slate-200 dark:border-[#2E2A4A] p-4"><div className="text-[10px] font-bold uppercase text-slate-400">Forecast support</div><p className="mt-2 text-sm">{metric(item.forecast_demand)} units expected, range {metric(item.forecast_lower_bound)} - {metric(item.forecast_upper_bound)} units at {percentage(item.confidence_level)} confidence.</p></div>}
      <div className="rounded-xl border border-slate-200 dark:border-[#2E2A4A] p-4"><div className="text-[10px] font-bold uppercase text-slate-400">Explanation</div><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.explanation}</p><div className="mt-3 text-sm font-semibold">Suggested action: {item.suggested_action}</div></div>
    </Modal>
  );
}

export default function Obsolescence() {
  const { apiFetch } = useAuth();
  const { datasets, selectedDatasetId, setSelectedDatasetId } = useDataset();
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [risk, setRisk] = useState("All");
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const load = async (id = selectedDatasetId) => {
    if (!id) return;
    setLoading(true);
    setSummary(null);
    setItems([]);
    try {
      const params = new URLSearchParams({ dataset_id: id });
      const [summaryResponse, listResponse] = await Promise.all([apiFetch(`${API_BASE}/obsolescence/summary?${params}`), apiFetch(`${API_BASE}/obsolescence?${params}`)]);
      if (!summaryResponse.ok || !listResponse.ok) throw new Error("Unable to load commercial obsolescence results.");
      setSummary(await summaryResponse.json());
      setItems(await listResponse.json());
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (selectedDatasetId) load(selectedDatasetId); }, [selectedDatasetId]);

  const categories = useMemo(() => ["All", ...new Set(items.map((item) => item.category).filter(Boolean))], [items]);
  const visible = useMemo(() => items.filter((item) => (risk === "All" || item.risk_level === risk) && (category === "All" || item.category === category) && (!search.trim() || `${item.product_name} ${item.product_id}`.toLowerCase().includes(search.toLowerCase()))), [items, risk, category, search]);

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const response = await apiFetch(`${API_BASE}/obsolescence/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset_id: Number(selectedDatasetId) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Analysis failed.");
      await load(selectedDatasetId);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  return <div className="space-y-6 animate-fadeIn">
    <PageHeader category="INTELLIGENCE" title="Commercial Obsolescence" subtitle="Detect weakening commercial demand without treating product age as obsolescence." />
    {error && <ErrorState message={error} />}
    <Card className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div className="grid gap-4 sm:grid-cols-2"><Select label="Dataset" value={selectedDatasetId} onChange={(event) => setSelectedDatasetId(event.target.value)}><option value="">Select dataset</option>{datasets.map((dataset) => <option key={dataset.dataset_id} value={dataset.dataset_id}>{dataset.filename}</option>)}</Select><Input label="Search product" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Product name or ID" /></div><Button variant="gradient" onClick={analyze} loading={analyzing} disabled={!selectedDatasetId}>{analyzing ? "Analyzing..." : "Analyze demand risk"}</Button></Card>
    {summary && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[["Products analyzed", summary.products_analyzed, "purple"], ["Critical risk", summary.critical_risk_count, "high"], ["High risk", summary.high_risk_count, "high"], ["Moderate risk", summary.moderate_risk_count, "medium"], ["Low risk", summary.low_risk_count, "low"]].map(([label, value, color]) => <Card key={label} hover><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div><div className={`mt-2 text-3xl font-black ${color === "high" ? "text-rose-600" : color === "medium" ? "text-amber-600" : color === "low" ? "text-emerald-600" : "text-[#7C5CFC]"}`}>{value}</div></Card>)}</div>}
    <Card className="space-y-4"><div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><CardTitle subtitle="Scores are analytical demand-risk signals, not claims of physical product obsolescence.">Demand Risk Results</CardTitle><div className="grid gap-3 sm:grid-cols-2"><Select label="Risk level" value={risk} onChange={(event) => setRisk(event.target.value)}><option>All</option><option>Critical</option><option>High</option><option>Moderate</option><option>Low</option><option>Insufficient Data</option></Select><Select label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</Select></div></div>{loading ? <div className="py-12 text-center text-sm text-slate-400">Loading analysis...</div> : visible.length === 0 ? <EmptyState title="No obsolescence analysis found" description="Run the analysis for the selected dataset to create demand-risk results." /> : <Table headers={["Product", "Category", "Risk score", "Risk level", "Recent demand", "Historical demand", "Decline", "Trend", "Forecast", "Action"]}>{visible.map((item) => <TableRow key={item.id}><TableCell bold>{item.product_name || item.product_id}</TableCell><TableCell>{item.category || "-"}</TableCell><TableCell className="font-bold">{metric(item.risk_score)}</TableCell><TableCell><Badge variant={badgeVariant(item.risk_level)}>{item.risk_level}</Badge></TableCell><TableCell>{metric(item.recent_demand)}</TableCell><TableCell>{metric(item.historical_demand)}</TableCell><TableCell>{percentage(item.decline_rate)}</TableCell><TableCell>{item.trend}</TableCell><TableCell>{item.forecast_demand == null ? "-" : metric(item.forecast_demand)}</TableCell><TableCell><Button variant="secondary" size="sm" onClick={() => setSelected(item)}>Details</Button></TableCell></TableRow>)}</Table>}{selected && <Details item={selected} onClose={() => setSelected(null)} />}</Card>
  </div>;
}