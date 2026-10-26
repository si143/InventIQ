import React, { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Table, { TableRow, TableCell } from "../components/ui/Table";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import Modal from "../components/ui/Modal";
import AIInsightCard from "../components/ui/AIInsightCard";
import { useAuth } from "../context/AuthContext";
import { useDataset } from "../context/DatasetContext";

const API_BASE = "/api";

export default function ProductDependencies() {
  const { apiFetch } = useAuth();
  const { datasets, selectedDatasetId, setSelectedDatasetId } = useDataset();
  const [summary, setSummary] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState(false);
  const [dependencies, setDependencies] = useState([]);
  const [search, setSearch] = useState("");
  const [relationshipType, setRelationshipType] = useState("All");
  const [minCorrelation, setMinCorrelation] = useState("0");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [selectedDependency, setSelectedDependency] = useState(null);
  const [selectedMatrixCell, setSelectedMatrixCell] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const loadRequestId = useRef(0);

  const productIdentity = (dependency, side) => ({
    id: dependency?.[`product_${side}_id`] || "Unknown Product",
    name: dependency?.[`product_${side}_name`] || "Name unavailable",
  });
  const matrixProductIdentity = (product) => {
    const name = matrix.product_names?.[product] || "Name unavailable";
    const id = matrix.product_ids?.[product] || (name === product ? "Unknown Product" : product || "Unknown Product");
    return { id, name };
  };
  const matrixCellInterpretation = (value) => {
    const numeric = Number(value);
    if (numeric >= 0.6) return "Strong positive association in historical demand patterns.";
    if (numeric >= 0.4) return "Moderate positive association in historical demand patterns.";
    if (numeric <= -0.6) return "Strong negative association in historical demand patterns.";
    if (numeric <= -0.4) return "Moderate negative association in historical demand patterns.";
    return "Weak or neutral linear association in historical demand patterns.";
  };
  const renderProductIdentity = (identity) => (
    <span className="inline-flex flex-col items-start leading-tight">
      <span className="text-xs font-semibold text-slate-400">{identity.id}</span>
      <span className="text-sm font-bold text-slate-900 dark:text-white">{identity.name}</span>
    </span>
  );
  const dependencyGroups = useMemo(() => {
    const groups = new Map();
    dependencies.forEach((dependency) => {
      const productAId = dependency.product_a_id;
      const groupKey = productAId && productAId !== "Unknown Product"
        ? String(productAId)
        : String(dependency.product_a || "Unknown Product");
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(dependency);
    });
    return Array.from(groups, ([key, relationships]) => ({ key, relationships }));
  }, [dependencies]);

  const loadData = () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError("");
    setSummary(null);
    setDependencies([]);
    setMatrix(null);
    setMatrixLoading(true);
    setMatrixError(false);
    setSelectedDependency(null);
    const summaryParams = new URLSearchParams();
    const listParams = new URLSearchParams();
    if (selectedDatasetId) {
      summaryParams.append("dataset_id", selectedDatasetId);
      listParams.append("dataset_id", selectedDatasetId);
    }
    if (search.trim()) listParams.append("search", search.trim());
    if (relationshipType !== "All") listParams.append("relationship_type", relationshipType);
    if (minCorrelation !== "0") listParams.append("minimum_correlation", minCorrelation);
    listParams.append("page", String(page));
    listParams.append("page_size", "15");

    Promise.all([
      apiFetch(`${API_BASE}/dependencies/summary?${summaryParams}`).then((res) => (res.ok ? res.json() : null)),
      apiFetch(`${API_BASE}/dependencies?${listParams}`).then((res) => (res.ok ? res.json() : { items: [], total: 0 })),
      apiFetch(`${API_BASE}/dependencies/matrix?dataset_id=${selectedDatasetId}`).then((res) => {
        if (res.status === 422) return null;
        return res.ok ? res.json() : Promise.reject(new Error("Matrix unavailable"));
      }),
    ])
      .then(([summaryData, listData, matrixData]) => {
        if (requestId !== loadRequestId.current) return;
        setSummary(summaryData);
        setDependencies(listData.items || []);
        setTotal(listData.total || 0);
        setMatrix(matrixData);
      })
      .catch((error) => {
        if (requestId !== loadRequestId.current) return;
        if (error.message === "Matrix unavailable") setMatrixError(true);
        else setError("Unable to load product dependencies. Check backend API connection.");
      })
      .finally(() => {
        if (requestId !== loadRequestId.current) return;
        setLoading(false);
        setMatrixLoading(false);
      });
  };

  useEffect(() => {
    if (selectedDatasetId) loadData();
    else {
      loadRequestId.current += 1;
      setSummary(null);
      setDependencies([]);
      setMatrix(null);
      setSelectedDependency(null);
      setMatrixLoading(false);
      setMatrixError(false);
      setLoading(false);
    }
  }, [selectedDatasetId, relationshipType, minCorrelation, page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (selectedDatasetId) loadData();
    }, 300);
    return () => clearTimeout(timer);
  }, [search, selectedDatasetId]);

  const handleAnalyze = async () => {
    if (!selectedDatasetId) {
      setError("Please select or upload a dataset before running dependency analysis.");
      return;
    }
    setAnalyzing(true);
    setError("");
    try {
      const response = await apiFetch(`${API_BASE}/dependencies/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset_id: Number(selectedDatasetId) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Dependency analysis failed.");
      loadData();
    } catch (err) {
      setError(err.message || "Failed to execute dependency analysis.");
    } finally {
      setAnalyzing(false);
    }
  };

  const strengthBadge = (strength) => {
    if (strength === "Very Strong" || strength === "Strong") return <Badge variant="pink">{strength}</Badge>;
    if (strength === "Moderate") return <Badge variant="purple">{strength}</Badge>;
    return <Badge variant="default">{strength || "Weak"}</Badge>;
  };

  const hasFilters = Boolean(search.trim()) || relationshipType !== "All" || minCorrelation !== "0";

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        category="INTELLIGENCE"
        subtitle="Explore historical product demand relationships and correlations."
        actions={
          <>
            <Select value={selectedDatasetId} onChange={(e) => { setSelectedDatasetId(e.target.value); setPage(1); }} className="min-w-[180px]">
              <option value="">Select Dataset</option>
              {datasets.map((dataset) => <option key={dataset.dataset_id} value={dataset.dataset_id}>{dataset.filename}</option>)}
            </Select>
            <Button variant="gradient" loading={analyzing} onClick={handleAnalyze}>⚡ Analyze Dependencies</Button>
          </>
        }
      />
      {error && <ErrorState message={error} onRetry={loadData} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["PRODUCTS ANALYZED", summary?.products_analyzed ?? "Not analyzed", "text-slate-900 dark:text-white"],
          ["RELATIONSHIPS FOUND", summary?.total_relationships ?? "Not analyzed", "text-[#7C5CFC]"],
          ["STRONG RELATIONSHIPS", summary?.strong_relationships ?? "Not analyzed", "text-[#D946A8]"],
          ["AVG CORRELATION", summary ? summary.average_absolute_correlation.toFixed(2) : "Not analyzed", "text-slate-900 dark:text-white"],
        ].map(([label, value, color]) => (
          <Card key={label} hover>
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400"><span>{label}</span><span>📈</span></div>
            <p className={`mt-3 text-3xl font-extrabold ${color}`}>{value}</p>
            <p className="mt-1 text-xs text-slate-500">Selected dataset analysis</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <AIInsightCard
          title="TOP POSITIVE DEPENDENCY (CO-DEMAND)"
          subtitle={summary?.top_positive_relationship ? <span className="inline-flex items-center gap-2">{renderProductIdentity(productIdentity(summary.top_positive_relationship, "a"))}<span>↔</span>{renderProductIdentity(productIdentity(summary.top_positive_relationship, "b"))}</span> : "No positive correlation detected yet"}
          onAction={summary?.top_positive_relationship ? () => setSelectedDependency(summary.top_positive_relationship) : null}
        >
          {summary?.top_positive_relationship ? <p>These products show similar historical demand movement with a positive correlation of <b className="text-[#D946A8]">+{summary.top_positive_relationship.correlation.toFixed(3)}</b>. This is an observed association, not evidence that one product causes changes in the other.</p> : <p>Run dependency analysis to discover product relationships.</p>}
        </AIInsightCard>
        <AIInsightCard
          title="TOP NEGATIVE RELATIONSHIP"
          subtitle={summary?.top_negative_relationship ? <span className="inline-flex items-center gap-2">{renderProductIdentity(productIdentity(summary.top_negative_relationship, "a"))}<span>↔</span>{renderProductIdentity(productIdentity(summary.top_negative_relationship, "b"))}</span> : "No inverse relationship detected yet"}
          onAction={summary?.top_negative_relationship ? () => setSelectedDependency(summary.top_negative_relationship) : null}
        >
          {summary?.top_negative_relationship ? <p>These products show opposite historical demand movement with a correlation of <b className="text-[#7C5CFC]">{summary.top_negative_relationship.correlation.toFixed(3)}</b>. This is an observed association, not evidence of substitution or causation.</p> : <p>No meaningful inverse relationship is present in the analyzed dataset.</p>}
        </AIInsightCard>
      </div>

      <Card padding="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="Search product name or SKU..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select value={relationshipType} onChange={(e) => { setRelationshipType(e.target.value); setPage(1); }}><option>All</option><option>Positive</option><option>Negative</option></Select>
          <Select value={minCorrelation} onChange={(e) => { setMinCorrelation(e.target.value); setPage(1); }}><option value="0">Min Correlation (All)</option><option value="0.3">Min 0.30</option><option value="0.6">Min 0.60</option><option value="0.8">Min 0.80</option></Select>
          <Button variant="secondary" onClick={loadData}>↻ Refresh Matrix</Button>
        </div>
      </Card>

      {loading ? <Card className="p-8 text-center text-sm text-slate-500">Loading selected dataset dependencies...</Card> : dependencies.length === 0 ? <EmptyState icon="🔗" title={hasFilters ? "No matching relationships" : "No product dependencies found"} description={hasFilters ? "Try a broader search or lower the correlation threshold." : "Run dependency analysis for the selected dataset to calculate historical relationships."} actionLabel={hasFilters ? undefined : "Analyze Dependencies"} onAction={hasFilters ? undefined : handleAnalyze} /> : (
        <Table headers={["Product A", "Product B", "Correlation (r)", "Relationship Type", "Strength", "Dependency Score", "Action"]}>
          {dependencyGroups.flatMap((group) => group.relationships.map((dep, relationshipIndex) => (
            <TableRow key={dep.id}>
              {relationshipIndex === 0 && (
                <td
                  rowSpan={group.relationships.length}
                  className="px-5 py-3.5 align-middle text-slate-700 dark:text-slate-300 whitespace-nowrap"
                >
                  {renderProductIdentity(productIdentity(dep, "a"))}
                </td>
              )}
              <TableCell>{renderProductIdentity(productIdentity(dep, "b"))}</TableCell>
              <TableCell><span className={dep.correlation > 0 ? "text-emerald-600" : "text-rose-600"}>{dep.correlation > 0 ? `+${dep.correlation.toFixed(3)}` : dep.correlation.toFixed(3)}</span></TableCell>
              <TableCell><Badge variant={dep.relationship_type === "Positive" ? "pink" : dep.relationship_type === "Negative" ? "purple" : "default"}>{dep.relationship_type === "Positive" ? "Co-demand" : dep.relationship_type === "Negative" ? "Inverse movement" : "Neutral"}</Badge></TableCell>
              <TableCell>{strengthBadge(dep.relationship_strength)}</TableCell><TableCell className="font-semibold">{Number(dep.dependency_score).toFixed(1)}%</TableCell>
              <TableCell><Button variant="secondary" size="sm" onClick={() => setSelectedDependency(dep)}>View Details</Button></TableCell>
            </TableRow>
          )))}
        </Table>
      )}

      <Card padding="p-4" className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Dependency Matrix</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">A product-to-product Pearson correlation matrix built from historical daily demand.</p>
        </div>
        <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/60 p-4 dark:border-fuchsia-900/60 dark:bg-fuchsia-950/20">
          <h3 className="text-sm font-bold uppercase tracking-wider text-fuchsia-700 dark:text-fuchsia-300">Matrix Methodology</h3>
          <div className="mt-3 grid gap-3 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
            <div><p className="font-semibold text-slate-900 dark:text-white">Method</p><p>Pearson Correlation Coefficient</p></div>
            <div><p className="font-semibold text-slate-900 dark:text-white">Input Data</p><p>Historical daily product demand / units sold</p></div>
            <div><p className="font-semibold text-slate-900 dark:text-white">Matrix</p><p>Product x product correlation, ranging from -1 to +1</p></div>
            <div><p className="font-semibold text-slate-900 dark:text-white">Analysis Type</p><p>Statistical association, not a machine-learning model</p></div>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-600 dark:text-slate-300">The system aligns each pair of products by date, creates a product x date demand matrix, and calculates Pearson correlation for every valid pair. The formula is <span className="font-mono font-semibold">r = cov(X,Y) / (sigmaX x sigmaY)</span>, where X and Y are the products' daily demand values.</p>
          <div className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-5">
            {['Historical dataset', 'Select product demand', 'Align by date', 'Build product x date matrix', 'Calculate Pearson r'].map((step, index) => <div key={step} className="rounded-lg bg-white/70 px-3 py-2 text-center dark:bg-slate-900/30"><span className="block text-[10px] font-bold text-fuchsia-600">{index + 1}</span>{step}</div>)}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">This is different from InventIQ forecasting models such as Linear Regression, Random Forest, XGBoost, and ARIMA. Correlation indicates similar or opposite historical demand movement; it does not prove causation or that products were purchased together.</p>
        </div>
        {matrixLoading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading dependency matrix...</div>
        ) : matrixError ? (
          <div className="p-8 text-center text-sm text-rose-600">Unable to load dependency matrix. Please try again.</div>
        ) : !matrix?.products?.length ? (
          <div className="p-8 text-center text-sm text-slate-500">No dependency matrix available for this dataset.</div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-[#2E2A4A]">
              <table className="min-w-[760px] w-full text-xs">
                <thead className="bg-slate-50 dark:bg-[#211E35]">
                  <tr>
                    <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-500 dark:border-[#2E2A4A] dark:bg-[#211E35]">Product</th>
                    {matrix.products.map((product) => <th key={product} className="border-b border-slate-200 px-3 py-2 text-center dark:border-[#2E2A4A]">{renderProductIdentity(matrixProductIdentity(product))}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {matrix.products.map((product, rowIndex) => <tr key={product}>
                    <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 text-left dark:border-[#2E2A4A] dark:bg-[#171525]">{renderProductIdentity(matrixProductIdentity(product))}</th>
                    {matrix.matrix[rowIndex].map((value, columnIndex) => {
                      const isDiagonal = rowIndex === columnIndex;
                      const numeric = Number(value);
                      const strength = isDiagonal ? "" : Math.abs(numeric) >= 0.6 ? "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : Math.abs(numeric) >= 0.4 ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300" : "text-slate-500 dark:text-slate-400";
                      const matrixCell = { productA: matrixProductIdentity(product), productB: matrixProductIdentity(matrix.products[columnIndex]), correlation: numeric, isDiagonal };
                      return <td key={`${product}-${matrix.products[columnIndex]}`} title={isDiagonal ? "Self-correlation: a product is perfectly correlated with itself." : `${matrixCellInterpretation(numeric)} Click for details.`} onClick={() => Number.isFinite(numeric) && setSelectedMatrixCell(matrixCell)} className={`cursor-pointer border-b border-slate-200 px-3 py-2 text-center font-medium dark:border-[#2E2A4A] ${strength}`}>{Number.isFinite(numeric) ? (isDiagonal ? "1.00" : `${numeric > 0 ? "+" : numeric < 0 ? "−" : ""}${Math.abs(numeric).toFixed(2)}`) : "—"}</td>;
                    })}
                  </tr>)}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 dark:text-slate-400">
              <span><b className="text-slate-700 dark:text-slate-200">Weak:</b> |r| &lt; 0.40</span>
              <span><b className="text-amber-700">Moderate:</b> 0.40–0.59</span>
              <span><b className="text-rose-700">Strong:</b> |r| ≥ 0.60</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Correlation represents statistical association between historical demand patterns. It does not establish causation or prove that products were purchased together. Product Association Analysis is the separate market-basket feature for co-purchase behavior.</p>
          </>
        )}
      </Card>

      {selectedMatrixCell && <Modal isOpen={true} onClose={() => setSelectedMatrixCell(null)} category="MATRIX DETAIL" title="Pearson Correlation" subtitle="Historical daily demand association" footer={<Button variant="secondary" onClick={() => setSelectedMatrixCell(null)}>Close</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {[['PRODUCT A', selectedMatrixCell.productA], ['PRODUCT B', selectedMatrixCell.productB]].map(([label, identity]) => <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-[#2E2A4A] dark:bg-[#171525]"><p className="text-[10px] font-bold text-slate-400">{label}</p>{renderProductIdentity(identity)}</div>)}
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-[#2E2A4A]"><p className="text-xs font-semibold text-slate-400">PEARSON CORRELATION</p><p className="mt-1 text-2xl font-bold">{selectedMatrixCell.isDiagonal ? "1.000" : `${selectedMatrixCell.correlation > 0 ? "+" : selectedMatrixCell.correlation < 0 ? "−" : ""}${Math.abs(selectedMatrixCell.correlation).toFixed(3)}`}</p><p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{selectedMatrixCell.isDiagonal ? "The diagonal is 1.00 because each product is perfectly correlated with itself." : matrixCellInterpretation(selectedMatrixCell.correlation)}</p></div>
        <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">The coefficient is calculated from actual aligned daily demand values. It measures how similarly demand changes over time; it does not prove that customers purchased these products together.</p>
      </Modal>}

      {selectedDependency && <Modal isOpen={true} onClose={() => setSelectedDependency(null)} category="DEPENDENCY DETAIL" title="Relationship Details" subtitle={`Dataset #${selectedDependency.dataset_id} Correlation Analysis`} footer={<Button variant="secondary" onClick={() => setSelectedDependency(null)}>Close</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {[["PRODUCT A", productIdentity(selectedDependency, "a")], ["PRODUCT B", productIdentity(selectedDependency, "b")]].map(([label, identity]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-[#2E2A4A] dark:bg-[#171525]">
              <p className="text-[10px] font-bold text-slate-400">{label}</p>
              {renderProductIdentity(identity)}
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="p-4 rounded-xl border border-slate-200"><p className="text-xs font-semibold text-slate-400">CORRELATION COEFFICIENT</p><p className="mt-1 text-2xl font-bold">{selectedDependency.correlation.toFixed(4)}</p></div>
          <div className="p-4 rounded-xl border border-slate-200"><p className="text-xs font-semibold text-slate-400">RELATIONSHIP STRENGTH</p><p className="mt-1 text-2xl font-bold">{selectedDependency.relationship_strength}</p></div>
          <div className="p-4 rounded-xl border border-slate-200"><p className="text-xs font-semibold text-slate-400">OBSERVATION COUNT</p><p className="mt-1 text-base font-bold">{selectedDependency.observation_count} time periods</p></div>
          <div className="p-4 rounded-xl border border-slate-200"><p className="text-xs font-semibold text-slate-400">DEPENDENCY SCORE</p><p className="mt-1 text-base font-bold text-[#7C5CFC]">{Number(selectedDependency.dependency_score).toFixed(1)}% relationship score</p></div>
        </div>
        <div className="mt-4 p-4 rounded-xl bg-[#EDE9FE]/50 text-xs"><b className="text-[#7C5CFC]">Inventory Strategy Recommendation: </b>{selectedDependency.relationship_type === "Positive" ? "These products show associated historical demand movement; monitor them together." : "These products show an inverse historical relationship; monitor combined demand."}</div>
      </Modal>}
    </div>
  );
}
