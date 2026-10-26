import { useEffect, useMemo, useState } from "react";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import Modal from "../components/ui/Modal";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import { useAuth } from "../context/AuthContext";
import { useDataset } from "../context/DatasetContext";

const API_BASE = "/api";
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const formatValue = (value) => value == null || !Number.isFinite(Number(value)) ? "Not available" : numberFormat.format(Number(value));

function PriorityBadge({ value }) {
  const variant = value === "High" || value === "Critical" ? "high" : value === "Moderate" ? "medium" : value === "Low" ? "low" : "default";
  return <Badge variant={variant}>{value || "Unknown"}</Badge>;
}

export default function RecoveryPlannerView() {
  const { apiFetch } = useAuth();
  const { datasets, selectedDatasetId, setSelectedDatasetId } = useDataset();
  const [plan, setPlan] = useState(null);
  const [savedPlans, setSavedPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [productDetails, setProductDetails] = useState(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [signalFilter, setSignalFilter] = useState("all");
  const [sort, setSort] = useState({ key: "excess_quantity", direction: "desc" });
  const [calculatorProductId, setCalculatorProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [discount, setDiscount] = useState("20");
  const [expectedQuantity, setExpectedQuantity] = useState("");
  const [recoveryAction, setRecoveryAction] = useState("discount");

  useEffect(() => {
    let cancelled = false;
    if (!selectedDatasetId) {
      setPlan(null);
      setSavedPlans([]);
      setLoading(false);
      setError("");
      return () => { cancelled = true; };
    }

    async function loadRecoveryData() {
      setLoading(true);
      setError("");
      setPlan(null);
      setSavedPlans([]);
      try {
        const response = await apiFetch(`${API_BASE}/recovery-planner?dataset_id=${encodeURIComponent(selectedDatasetId)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Unable to analyze this dataset.");
        if (cancelled) return;
        setPlan(data);

        const savedResponse = await apiFetch(`${API_BASE}/recovery-planner/plans?dataset_id=${encodeURIComponent(selectedDatasetId)}`);
        if (savedResponse.ok) {
          const saved = await savedResponse.json();
          if (!cancelled) setSavedPlans(Array.isArray(saved) ? saved : []);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Unable to analyze this dataset.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadRecoveryData();
    return () => { cancelled = true; };
  }, [apiFetch, refreshCount, selectedDatasetId]);

  const products = Array.isArray(plan?.products) ? plan.products : [];
  const summary = plan?.summary || {};
  const activeDataset = datasets.find((dataset) => String(dataset.dataset_id) === String(selectedDatasetId));
  const productsAtRisk = products.filter((product) => ["High", "Moderate", "Critical"].includes(product.risk_level) || product.slow_moving || product.declining_demand).length;

  const recommendationGroups = useMemo(() => {
    const groups = new Map();
    for (const product of products) {
      for (const recommendation of product.recommendations || []) {
        const action = recommendation.suggested_action.toLocaleLowerCase();
        const key = action.includes("discount") || action.includes("bundl")
          ? "discount"
          : action.includes("transfer") || action.includes("supplier")
            ? "transfer"
            : action.includes("donat") || action.includes("recycl")
              ? "donate"
              : "review";
        if (!groups.has(key)) groups.set(key, { key, products: new Map(), priority: recommendation.priority, reason: recommendation.reason, action: recommendation.suggested_action });
        const group = groups.get(key);
        group.products.set(product.product_id, product);
        if (recommendation.priority === "High" || recommendation.priority === "Critical") group.priority = recommendation.priority;
      }
    }
    const order = { High: 0, Critical: 0, Moderate: 1, Low: 2 };
    return [...groups.values()].sort((left, right) => (order[left.priority] ?? 3) - (order[right.priority] ?? 3));
  }, [products]);

  useEffect(() => {
    if (!products.length) {
      setCalculatorProductId("");
      return;
    }
    setCalculatorProductId((current) => products.some((product) => product.product_id === current) ? current : products[0].product_id);
  }, [plan]);

  const calculatorProduct = products.find((product) => product.product_id === calculatorProductId);
  useEffect(() => {
    if (!calculatorProduct) return;
    const available = calculatorProduct.excess_quantity ?? calculatorProduct.current_stock;
    setQuantity(available == null ? "" : String(Math.max(0, available)));
    setExpectedQuantity(available == null ? "" : String(Math.max(0, available)));
    setUnitPrice(calculatorProduct.unit_price == null ? "" : String(calculatorProduct.unit_price));
    setUnitCost(calculatorProduct.unit_cost == null ? "" : String(calculatorProduct.unit_cost));
  }, [calculatorProductId, plan]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return products.filter((product) => {
      const matchesSearch = !query || [product.product_id, product.product_name, product.category].some((value) => String(value || "").toLocaleLowerCase().includes(query));
      const matchesRisk = riskFilter === "all" || product.risk_level === riskFilter;
      const matchesSignal = signalFilter === "all"
        || (signalFilter === "excess" && Number(product.excess_quantity) > 0)
        || (signalFilter === "slow" && product.slow_moving)
        || (signalFilter === "declining" && product.declining_demand)
        || (signalFilter === "low" && product.unusually_low_demand);
      return matchesSearch && matchesRisk && matchesSignal;
    }).sort((left, right) => {
      const leftValue = left[sort.key];
      const rightValue = right[sort.key];
      const comparison = typeof leftValue === "string"
        ? String(leftValue || "").localeCompare(String(rightValue || ""))
        : (Number(leftValue) || 0) - (Number(rightValue) || 0);
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [products, riskFilter, search, signalFilter, sort]);

  const calculation = useMemo(() => {
    const total = Number(quantity);
    const price = Number(unitPrice);
    const cost = unitCost === "" ? null : Number(unitCost);
    const rate = Number(discount);
    const sold = Number(expectedQuantity);
    const valid = quantity !== "" && Number.isFinite(total) && total >= 0
      && unitPrice !== "" && Number.isFinite(price) && price >= 0
      && (cost == null || Number.isFinite(cost) && cost >= 0)
      && Number.isFinite(rate) && rate >= 0 && rate <= 100
      && expectedQuantity !== "" && Number.isFinite(sold) && sold >= 0 && sold <= total;
    if (!valid) return { valid: false };
    const revenue = sold * price * (1 - rate / 100);
    return {
      valid: true,
      revenue,
      listRevenue: sold * price,
      discountImpact: sold * price - revenue,
      profit: cost == null ? null : revenue - sold * cost,
      remaining: Math.max(0, total - sold),
    };
  }, [discount, expectedQuantity, quantity, unitCost, unitPrice]);

  const scenarios = useMemo(() => {
    if (!calculation.valid) return [];
    const sold = Number(expectedQuantity);
    const price = Number(unitPrice);
    const quantities = [...new Set([sold * 0.25, sold * 0.5, sold])];
    return [
      ...[10, 20, 30].flatMap((rate) => quantities.map((quantityValue) => ({
        action: `Discounted sale · ${rate}% · ${sold ? Math.round(quantityValue / sold * 100) : 0}% quantity`,
        quantity: quantityValue,
        revenue: quantityValue * price * (1 - rate / 100),
        basis: "Gross revenue estimate; price units come from your dataset or input.",
      }))),
      { action: "Bundle sale", quantity: sold, revenue: sold * price * (1 - Number(discount) / 100), basis: `Uses your ${discount}% discount; bundle pricing is not modeled.` },
      { action: "Warehouse transfer", quantity: sold, revenue: null, basis: "Not monetized; destination demand and transfer costs are required." },
      { action: "Supplier return", quantity: sold, revenue: null, basis: "Not monetized; confirm supplier terms and return eligibility." },
      { action: "Donation / recycling", quantity: sold, revenue: null, basis: "No revenue assumed; confirm condition and policy eligibility." },
    ];
  }, [calculation.valid, discount, expectedQuantity, unitPrice]);

  const savePlan = async (product, recommendation = product?.recommendations?.[0]) => {
    if (!product || !selectedDatasetId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`${API_BASE}/recovery-planner/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: Number(selectedDatasetId),
          product_id: product.product_id,
          opportunity: recommendation?.reason || "Demand recovery opportunity",
          priority: recommendation?.priority || product.recovery_priority || "Low",
          evidence: product.reason || "Review the available dataset evidence.",
          suggested_action: recommendation?.suggested_action || product.suggested_action || "Review demand and stock before acting.",
        }),
      });
      const saved = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(saved.detail || "Unable to save the recovery plan.");
      setSavedPlans((current) => [saved, ...current.filter((item) => item.product_id !== product.product_id)]);
      setNotice(`Recovery plan saved for ${product.product_id}.`);
    } catch (saveError) {
      setError(saveError.message || "Unable to save the recovery plan.");
    } finally {
      setSaving(false);
    }
  };

  const sortBy = (key) => setSort((current) => current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: ["product_id", "category"].includes(key) ? "asc" : "desc" });
  const sortHeading = (label, key) => <button type="button" onClick={() => sortBy(key)} aria-label={`Sort by ${label}`} className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white">{label}<span aria-hidden="true">{sort.key === key ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button>;
  const savedProductIds = new Set(savedPlans.filter((saved) => saved.status === "open").map((saved) => saved.product_id));

  return <div className="space-y-6 animate-fadeIn">
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#2E2A4A] dark:bg-[#211E35] md:p-6">
      <header className="flex items-start justify-between gap-4">
        <div><h1 className="text-xl font-bold text-slate-900 dark:text-white">Waste Recovery Planner</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Inventory recovery and waste reduction</p></div>
        <Badge variant="low" size="md">Planner</Badge>
      </header>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Select label="Dataset" value={selectedDatasetId || ""} onChange={(event) => setSelectedDatasetId(event.target.value)}>
          <option value="">Select a dataset</option>
          {datasets.map((dataset) => <option key={dataset.dataset_id} value={dataset.dataset_id}>{dataset.filename || dataset.original_filename || `Dataset ${dataset.dataset_id}`}</option>)}
        </Select>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <p className="text-xs text-slate-500">{activeDataset ? `${formatValue(activeDataset.row_count)} rows · ${activeDataset.file_type?.toUpperCase() || "DATASET"}` : "Choose an uploaded dataset."}</p>
          <Button variant="secondary" size="sm" onClick={() => setRefreshCount((count) => count + 1)} disabled={!selectedDatasetId || loading}>Refresh</Button>
        </div>
      </div>

      {error && <ErrorState message={error} />}
      {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
      {loading && <p className="py-5 text-sm text-slate-500">Analyzing selected dataset…</p>}
      {!selectedDatasetId && !loading && <EmptyState icon="♻️" title="Select a dataset" description={datasets.length ? "Choose a dataset above to analyze demand and recovery opportunities." : "Upload a CSV or Excel dataset in Datasets, then return here."} />}

      {plan && !loading && <>
        <section aria-label="Recovery summary" className="grid gap-x-10 gap-y-6 sm:grid-cols-2 sm:py-2">
          <div className="space-y-1"><span aria-hidden="true" className="text-lg">📦</span><p className="text-sm text-slate-500">Excess products</p><p className="text-2xl font-semibold text-slate-900 dark:text-white">{formatValue(summary.excess_inventory_opportunities)}</p><p className="text-xs text-slate-500">Calculated from dataset</p></div>
          <div className="space-y-1"><span aria-hidden="true" className="text-lg">⚠</span><p className="text-sm text-slate-500">Products at risk</p><p className="text-2xl font-semibold text-slate-900 dark:text-white">{formatValue(productsAtRisk)}</p><p className="text-xs text-slate-500">Based on available data</p></div>
          <div className="space-y-1"><span aria-hidden="true" className="text-lg">₹</span><p className="text-sm text-slate-500">Potential recovery value</p><p className="text-2xl font-semibold text-slate-900 dark:text-white">{formatValue(summary.estimated_recovery_value)}</p><p className="text-xs text-slate-500">Estimated, not actual; price units follow dataset</p></div>
          <div className="space-y-1"><span aria-hidden="true" className="text-lg">♻</span><p className="text-sm text-slate-500">Recovery opportunities</p><p className="text-2xl font-semibold text-slate-900 dark:text-white">{formatValue(summary.recovery_opportunities)}</p><p className="text-xs text-slate-500">Suggested actions from current signals</p></div>
        </section>

        <div className="grid gap-2 border-y border-slate-100 py-3 text-xs dark:border-[#2E2A4A] sm:grid-cols-3">
          <p><span className="text-slate-500">Slow-moving:</span> <b>{formatValue(summary.slow_moving_products)}</b></p>
          <p><span className="text-slate-500">Declining demand:</span> <b>{formatValue(summary.declining_demand_products)}</b></p>
          <p><span className="text-slate-500">Potential cost exposure:</span> <b>{formatValue(summary.potential_inventory_loss_avoided)}</b> <span className="text-slate-500">(not guaranteed savings)</span></p>
        </div>

        <section aria-label="Recovery recommendations" className="rounded-xl border border-slate-200 p-4 dark:border-[#2E2A4A] md:p-5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Recovery recommendations</h2>
          {recommendationGroups.length ? <div className="mt-1 divide-y divide-slate-100 dark:divide-[#2E2A4A]">
            {recommendationGroups.slice(0, 3).map((group) => {
              const firstProduct = [...group.products.values()][0];
              const title = group.key === "discount" ? "Discount or bundle" : group.key === "transfer" ? "Transfer or return" : group.key === "donate" ? "Donate or recycle" : "Review recovery action";
              const description = group.key === "discount"
                ? "For excess stock or slow-moving products with a supported sales opportunity."
                : group.key === "transfer"
                  ? "Review reallocation or supplier-return eligibility using available location/vendor data."
                  : group.key === "donate"
                    ? "For eligible unsold products that cannot be recovered through sales."
                    : group.reason;
              return <div key={group.key} className="flex items-center gap-3 py-4 first:pt-3 last:pb-2">
                <span aria-hidden="true" className="w-5 shrink-0 text-lg text-emerald-600">{group.key === "discount" ? "◇" : group.key === "transfer" ? "↔" : group.key === "donate" ? "♻" : "›"}</span>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3><PriorityBadge value={group.priority} /></div><p className="mt-1 text-sm text-slate-500">{description}</p><p className="mt-1 text-xs text-slate-400">{group.products.size} product{group.products.size === 1 ? "" : "s"} · {group.action}</p></div>
                <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setProductDetails(firstProduct)}>Review</Button>
              </div>;
            })}
          </div> : <p className="py-4 text-sm text-slate-500">No recovery actions are supported by the available dataset and forecast evidence.</p>}
          <p className="mt-2 text-xs text-slate-500">Recommendations are estimates and require business approval. Transfer, return, donation, and recycling suitability must be confirmed.</p>
        </section>
      </>}
    </section>

    {plan?.data_limitations?.length > 0 && <Card className="border-l-4 border-l-amber-400 bg-amber-50/70 dark:bg-amber-950/20">
      <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200">Analysis coverage</h2>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Metrics requiring unavailable dataset fields or forecasts are left unavailable.</p>
      <ul className="mt-3 grid gap-1 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2">{plan.data_limitations.map((item) => <li key={item}>• {item}</li>)}</ul>
    </Card>}

    {plan && !loading && <>
      <section aria-label="Product analysis" className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div><h2 className="text-lg font-bold text-slate-900 dark:text-white">Product analysis</h2><p className="text-xs text-slate-500">{filteredProducts.length} of {products.length} products · forecast horizon {summary.forecast_horizon_days || 0} days</p></div>
          <div className="grid gap-2 sm:grid-cols-3 lg:w-[min(100%,48rem)]">
            <Input aria-label="Search products" placeholder="Search product or category" value={search} onChange={(event) => setSearch(event.target.value)} />
            <Select aria-label="Filter by risk" value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}><option value="all">All risk levels</option><option value="High">High risk</option><option value="Moderate">Moderate risk</option><option value="Low">Low risk</option></Select>
            <Select aria-label="Filter by signal" value={signalFilter} onChange={(event) => setSignalFilter(event.target.value)}><option value="all">All products</option><option value="excess">Excess stock</option><option value="slow">Slow-moving</option><option value="declining">Declining demand</option><option value="low">Unusually low demand</option></Select>
          </div>
        </div>
        {!products.length ? <EmptyState icon="♻️" title="No product rows to analyze" description="The selected file has no usable dated product and demand records." /> : !filteredProducts.length ? <EmptyState title="No matching products" description="Change the search or filters to see analyzed products." /> : <Card padding="p-0" className="overflow-hidden"><div className="overflow-x-auto"><table className="min-w-[1080px] w-full text-sm">
          <thead className="bg-slate-50 dark:bg-[#211E35]"><tr className="text-xs text-slate-500">
            <th scope="col" className="px-4 py-3 text-left">{sortHeading("Product", "product_id")}</th><th scope="col" className="px-4 py-3 text-left">{sortHeading("Category", "category")}</th>
            <th scope="col" className="px-4 py-3 text-right">{sortHeading("Units sold", "units_sold")}</th><th scope="col" className="px-4 py-3 text-right">{sortHeading("Forecast demand", "forecast_demand")}</th>
            <th scope="col" className="px-4 py-3 text-right">{sortHeading("Current stock", "current_stock")}</th><th scope="col" className="px-4 py-3 text-right">{sortHeading("Excess quantity", "excess_quantity")}</th>
            <th scope="col" className="px-4 py-3 text-left">Risk</th><th scope="col" className="px-4 py-3 text-left">Signals</th><th scope="col" className="px-4 py-3 text-right">Review</th>
          </tr></thead>
          <tbody>{filteredProducts.map((product) => <tr key={product.product_id} className="border-t border-slate-100 dark:border-[#2E2A4A]">
            <td className="px-4 py-3 font-semibold">{product.product_id}<span className="block text-xs font-normal text-slate-500">{product.product_name}</span></td><td className="px-4 py-3">{product.category || "Not available"}</td>
            <td className="px-4 py-3 text-right tabular-nums">{formatValue(product.units_sold)}</td><td className="px-4 py-3 text-right tabular-nums">{formatValue(product.forecast_demand)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{formatValue(product.current_stock)}</td><td className="px-4 py-3 text-right tabular-nums">{formatValue(product.excess_quantity)}</td>
            <td className="px-4 py-3"><PriorityBadge value={product.risk_level} /></td><td className="px-4 py-3"><div className="flex flex-wrap gap-1">{product.slow_moving && <Badge variant="medium" size="xs">Slow</Badge>}{product.declining_demand && <Badge variant="high" size="xs">Declining</Badge>}{product.unusually_low_demand && <Badge variant="info" size="xs">Low demand</Badge>}{!product.slow_moving && !product.declining_demand && !product.unusually_low_demand && <span className="text-slate-400">—</span>}</div></td>
            <td className="px-4 py-3 text-right"><Button variant="secondary" size="sm" onClick={() => setProductDetails(product)}>Review</Button></td>
          </tr>)}</tbody>
        </table></div></Card>}
        {!summary.inventory_data_available && <p className="text-xs text-amber-700 dark:text-amber-300">Current stock is unavailable. Add a stock/inventory column to compare stock with forecasts; no quantities are assumed.</p>}
        {summary.inventory_data_available && !summary.forecast_available && <p className="text-xs text-amber-700 dark:text-amber-300">Stock data is available, but excess cannot be calculated until this dataset has a completed forecast.</p>}
      </section>

      <section aria-label="Recovery value calculator" className="space-y-3">
        <div><h2 className="text-lg font-bold text-slate-900 dark:text-white">Recovery value calculator</h2><p className="text-xs text-slate-500">Calculations use your inputs and the dataset's price units. Revenue is not profit.</p></div>
        <Card>{!products.length ? <p className="text-sm text-slate-500">Calculator inputs are unavailable until this dataset has analyzable product rows.</p> : <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Select label="Product" value={calculatorProductId} onChange={(event) => setCalculatorProductId(event.target.value)}>{products.map((product) => <option key={product.product_id} value={product.product_id}>{product.product_id} · {product.product_name}</option>)}</Select>
            <Input label="Product quantity" type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} helper="Quantity considered in this scenario." />
            <Input label="Selling price per unit" type="number" min="0" step="any" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} helper="Pre-filled only when a dataset selling-price column exists." />
            <Input label="Unit cost (optional)" type="number" min="0" step="any" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} helper="Needed to estimate gross profit." />
            <Input label="Proposed discount (%)" type="number" min="0" max="100" step="1" value={discount} onChange={(event) => setDiscount(event.target.value)} />
            <Input label="Expected quantity recovered / sold" type="number" min="0" max={quantity || undefined} step="any" value={expectedQuantity} onChange={(event) => setExpectedQuantity(event.target.value)} helper="Cannot exceed the entered product quantity." />
            <Select label="Primary recovery action" value={recoveryAction} onChange={(event) => setRecoveryAction(event.target.value)}><option value="discount">Discounted sale</option><option value="bundle">Bundle sale</option><option value="transfer">Warehouse transfer</option><option value="return">Supplier return</option><option value="donate">Donation or recycling</option></Select>
          </div>
          {!calculation.valid && <p role="alert" className="mt-4 text-sm text-rose-600">Enter non-negative quantities and prices, a discount from 0 to 100%, and an expected quantity no greater than product quantity.</p>}
          <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 dark:border-[#2E2A4A] sm:grid-cols-2 xl:grid-cols-4">
            <div><p className="text-xs text-slate-500">Estimated recovery revenue</p><p className="mt-1 text-lg font-bold">{calculation.valid && !["transfer", "return", "donate"].includes(recoveryAction) ? formatValue(calculation.revenue) : "Not monetized"}</p></div>
            <div><p className="text-xs text-slate-500">Revenue at list price</p><p className="mt-1 text-lg font-bold">{calculation.valid ? formatValue(calculation.listRevenue) : "Not available"}</p></div>
            <div><p className="text-xs text-slate-500">Discount impact</p><p className="mt-1 text-lg font-bold">{calculation.valid ? `−${formatValue(calculation.discountImpact)}` : "Not available"}</p></div>
            <div><p className="text-xs text-slate-500">Estimated gross profit</p><p className="mt-1 text-lg font-bold">{calculation.valid ? formatValue(calculation.profit) : "Not available"}</p></div>
          </div>
          {calculation.valid && <p className="mt-3 text-xs text-slate-500">Expected remaining quantity: {formatValue(calculation.remaining)}. Gross profit excludes operating, handling, transfer, and tax costs.</p>}
        </>}</Card>
        <Card padding="p-0" className="overflow-hidden">
          <div className="border-b border-slate-100 p-5 dark:border-[#2E2A4A]"><h3 className="font-bold">What-if comparison</h3><p className="mt-1 text-xs text-slate-500">Discount cases use the entered quantity. Non-sale actions are not assigned invented monetary values.</p></div>
          {!calculation.valid ? <p className="p-5 text-sm text-slate-500">Complete valid calculator inputs to compare scenarios.</p> : <div className="overflow-x-auto"><table className="min-w-[620px] w-full text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-[#211E35]"><tr><th className="px-5 py-3">Strategy</th><th className="px-5 py-3 text-right">Expected quantity</th><th className="px-5 py-3 text-right">Gross revenue</th><th className="px-5 py-3">Basis</th></tr></thead><tbody>{scenarios.map((scenario) => <tr key={scenario.action} className="border-t border-slate-100 dark:border-[#2E2A4A]"><td className="px-5 py-3 font-medium">{scenario.action}</td><td className="px-5 py-3 text-right tabular-nums">{formatValue(scenario.quantity)}</td><td className="px-5 py-3 text-right tabular-nums">{formatValue(scenario.revenue)}</td><td className="px-5 py-3 text-xs text-slate-500">{scenario.basis}</td></tr>)}</tbody></table></div>}
        </Card>
      </section>
      <p className="text-xs text-slate-500">Recommendations are estimates, not guaranteed recovery or savings. Confirm product condition, customer demand, supplier terms, and policy eligibility, and obtain business approval before acting. Expiry is not inferred unless source data includes expiry dates.</p>
    </>}

    {productDetails && <Modal isOpen onClose={() => setProductDetails(null)} category="PRODUCT RECOVERY REVIEW" title={`${productDetails.product_id} · ${productDetails.product_name}`} subtitle={productDetails.category || "Category unavailable"} footer={<><Button variant="secondary" onClick={() => { setCalculatorProductId(productDetails.product_id); setProductDetails(null); }}>Use in calculator</Button><Button variant="gradient" loading={saving} disabled={savedProductIds.has(productDetails.product_id)} onClick={() => savePlan(productDetails)}>{savedProductIds.has(productDetails.product_id) ? "Plan saved" : "Save recovery plan"}</Button></>}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-semibold uppercase text-slate-500">Units sold</dt><dd className="mt-1">{formatValue(productDetails.units_sold)}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-slate-500">Forecast demand</dt><dd className="mt-1">{formatValue(productDetails.forecast_demand)} · {productDetails.forecast_horizon_days || 0} days</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-slate-500">Current stock</dt><dd className="mt-1">{formatValue(productDetails.current_stock)}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-slate-500">Excess quantity</dt><dd className="mt-1">{formatValue(productDetails.excess_quantity)}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-slate-500">Demand change</dt><dd className="mt-1">{productDetails.demand_change == null ? "Not available" : `${(productDetails.demand_change * 100).toFixed(1)}%`}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-slate-500">Obsolescence</dt><dd className="mt-1">{productDetails.obsolescence_risk}{productDetails.obsolescence_score == null ? "" : ` · ${formatValue(productDetails.obsolescence_score)}/100`}</dd></div>
      </dl>
      <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-[#171525]"><p className="font-semibold">Evidence</p><p className="mt-1 text-slate-600 dark:text-slate-300">{productDetails.reason}</p></div>
      <div className="space-y-3"><h3 className="font-semibold">Recovery recommendations</h3>{productDetails.recommendations?.length ? productDetails.recommendations.map((recommendation, index) => <div key={`${recommendation.suggested_action}-${index}`} className="rounded-xl border border-slate-200 p-4 dark:border-[#2E2A4A]"><div className="flex flex-wrap items-center justify-between gap-2"><PriorityBadge value={recommendation.priority} /><span className="text-xs text-slate-500">{recommendation.reason}</span></div><p className="mt-2 text-sm font-medium">{recommendation.suggested_action}</p><p className="mt-1 text-xs text-slate-500">Estimated impact: {formatValue(recommendation.estimated_impact)}{recommendation.impact_basis ? ` · ${recommendation.impact_basis}` : " · Monetary impact unavailable or not modeled."}</p></div>) : <p className="text-sm text-slate-500">No specific action is supported by available evidence.</p>}</div>
      {productDetails.dependency_signal?.length > 0 && <p className="text-xs text-slate-500">Related demand correlation: {Number(productDetails.dependency_signal[0].correlation).toFixed(3)}. Association does not establish causation.</p>}
      {productDetails.limitations?.length > 0 && <div><h3 className="text-sm font-semibold">Product data limitations</h3><ul className="mt-1 space-y-1 text-xs text-slate-500">{productDetails.limitations.map((item) => <li key={item}>• {item}</li>)}</ul></div>}
    </Modal>}
  </div>;
}