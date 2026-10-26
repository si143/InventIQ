import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useDataset } from "../context/DatasetContext";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import ErrorState from "../components/ui/ErrorState";

const userGuide = [
  { title: "Upload a dataset", detail: "Open Datasets and upload a CSV, XLSX, or XLS file. Inspect its preview and run validation before training.", page: "datasets", action: "Open Datasets" },
  { title: "Configure and train a model", detail: "Choose the dataset, numeric demand target, chronological date field, and optional product field. Select a model and train; at least 10 usable rows are required.", page: "model-training", action: "Configure model" },
  { title: "Generate a forecast", detail: "Open Forecasts, select a completed model run, choose 7, 14, 30, 60, or 90 days, and generate the forecast.", page: "forecasts", action: "Open Forecasts" },
  { title: "Review recommendations and risks", detail: "Use Alerts & Risks and Recommendations to inspect the evidence, then use Product Dependencies or Commercial Obsolescence for additional analysis.", page: "risk-alerts", action: "Review alerts" },
];

const faqs = [
  { question: "How do I generate a demand forecast?", answer: "Upload and validate a dataset, configure and train a model, then open Forecasts. Select a completed run and choose a 7, 14, 30, 60, or 90-day horizon." },
  { question: "How does Auto Select choose a model?", answer: "It attempts Linear Regression, Random Forest, XGBoost, and product-level ARIMA where the data supports them, then selects the successful candidate with the lowest MAE. A candidate can be skipped when its requirements are not met." },
  { question: "Which columns are required?", answer: "The exact fields depend on the workflow. Training needs a numeric target and at least 10 usable rows; temporal regression needs a usable date column with at least four unique dates. Product-level ARIMA also requires a product field and at least 12 chronological observations per product. Check the dataset column roles and validation results." },
  { question: "What does forecast confidence mean?", answer: "Forecast intervals show a range around predicted demand. Current training uses a 90% confidence level; intervals are estimates, not guarantees." },
  { question: "What are Product Dependencies?", answer: "They compare historical product-demand series and report correlations when enough observations are available. Correlation describes association and does not prove that one product causes another's demand to change." },
  { question: "How are inventory-risk alerts produced?", answer: "Alerts are generated from forecast ranges, observed demand patterns, and recognized stock columns. A stockout-risk alert requires stock data; other demand signals do not establish physical expiry or certain future loss." },
  { question: "Why is a forecast unavailable?", answer: "Forecast generation requires a completed model run for the selected dataset and a readable uploaded file. Verify the selected dataset and run status, then review the error returned by the API." },
];

const datasetTopics = [
  { title: "Supported files", detail: "CSV (.csv), Excel (.xlsx), and legacy Excel (.xls). The upload is parsed by the backend; malformed or empty files are rejected." },
  { title: "Missing and duplicate values", detail: "Dataset validation reports missing cells, duplicate rows, empty columns, and whether the file is readable. Missing values are not silently replaced by a Help-page preference." },
  { title: "Dates and demand columns", detail: "Use a parseable date/time field and a numeric demand or sales field. The application parses date values automatically; invalid dates are excluded from temporal training and can make the usable-row count too small." },
  { title: "Product-level analysis", detail: "Use a consistent product or SKU field. ARIMA and product-specific dependency, stock, and recommendation analyses need product identities that match across the dataset and saved forecasts." },
];

const troubleshooting = [
  { title: "Upload fails", detail: "Confirm the file is non-empty and CSV/XLSX/XLS, then preview it in Datasets. If it still fails, check that the API is running.", page: "datasets", action: "Open Datasets" },
  { title: "Model training fails", detail: "Confirm the target is numeric, the selected date field parses, and at least 10 usable rows remain. Temporal regression needs four unique dates; ARIMA needs a date, product, and 12 observations per product.", page: "model-training", action: "Review model setup" },
  { title: "No forecast appears", detail: "Select a completed run for the same dataset and a supported horizon. The uploaded file must still exist and be readable.", page: "forecasts", action: "Open Forecasts" },
  { title: "Backend connection error", detail: "Check the API health endpoint. If it is unavailable, start FastAPI from the project root with the backend virtual environment.", page: null, action: null },
];

const matches = (query, ...values) => !query || values.join(" ").toLocaleLowerCase().includes(query);

export default function Help({ onNavigatePage }) {
  const { apiFetch } = useAuth();
  const { datasets, selectedDatasetId } = useDataset();
  const [query, setQuery] = useState("");
  const [system, setSystem] = useState(null);
  const [systemError, setSystemError] = useState("");
  const [validation, setValidation] = useState(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const filteredGuide = useMemo(() => userGuide.filter((item) => matches(search, item.title, item.detail)), [search]);
  const filteredFaqs = useMemo(() => faqs.filter((item) => matches(search, item.question, item.answer)), [search]);
  const filteredDatasetTopics = useMemo(() => datasetTopics.filter((item) => matches(search, item.title, item.detail)), [search]);
  const filteredTroubleshooting = useMemo(() => troubleshooting.filter((item) => matches(search, item.title, item.detail)), [search]);
  const activeDataset = datasets.find((dataset) => String(dataset.dataset_id) === String(selectedDatasetId));

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health/system")
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "System information is unavailable.");
        if (!cancelled) setSystem(data);
      })
      .catch((error) => { if (!cancelled) setSystemError(error.message || "System information is unavailable."); });
    return () => { cancelled = true; };
  }, []);

  const validateDataset = async () => {
    if (!selectedDatasetId) return;
    setValidationLoading(true);
    setValidationError("");
    setValidation(null);
    try {
      const response = await apiFetch(`/api/datasets/${encodeURIComponent(selectedDatasetId)}/validation`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Dataset validation failed.");
      setValidation(data);
    } catch (error) {
      setValidationError(error.message || "Dataset validation failed.");
    } finally {
      setValidationLoading(false);
    }
  };

  const jumpTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        category="SYSTEM"
        title="Help & Support"
        subtitle="Find answers and learn how to use InventIQ."
      />

      <div className="max-w-3xl">
        <Input label="Search help" placeholder="Search datasets, forecasting, model errors, recommendations..." value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      <nav aria-label="Help topics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[["user-guide", "User Guide", "Learn the workflow"], ["faqs", "FAQs", "Common questions"], ["dataset-help", "Dataset Help", "Formats and validation"], ["troubleshooting", "Troubleshooting", "Fix common issues"]].map(([id, title, description]) => <button key={id} type="button" onClick={() => jumpTo(id)} className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:bg-slate-50 dark:border-[#2E2A4A] dark:bg-[#211E35] dark:hover:bg-[#27233D]"><span className="block text-sm font-semibold text-slate-900 dark:text-white">{title}</span><span className="mt-1 block text-xs text-slate-500">{description}</span></button>)}
      </nav>

      {search && !filteredGuide.length && !filteredFaqs.length && !filteredDatasetTopics.length && !filteredTroubleshooting.length && <p role="status" className="text-sm text-slate-500">No help topics match “{query}”. Try a different search.</p>}

      {filteredGuide.length > 0 && <section id="user-guide" className="scroll-mt-28 space-y-3">
        <div><h2 className="text-lg font-bold text-slate-900 dark:text-white">User Guide</h2><p className="text-xs text-slate-500">Learn the workflow</p></div>
        <Card padding="p-0"><ol className="divide-y divide-slate-100 dark:divide-[#2E2A4A]">
          {filteredGuide.map((step, index) => <li key={step.title} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700 dark:bg-[#2E2A4A] dark:text-slate-100">{index + 1}</span><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-slate-900 dark:text-white">{step.title}</h3><p className="mt-1 text-sm text-slate-500">{step.detail}</p></div><Button variant="secondary" size="sm" onClick={() => onNavigatePage?.(step.page)}>{step.action}</Button></li>)}
        </ol></Card>
      </section>}

      {filteredFaqs.length > 0 && <section id="faqs" className="scroll-mt-28 space-y-3">
        <div><h2 className="text-lg font-bold text-slate-900 dark:text-white">Frequently Asked Questions</h2><p className="text-xs text-slate-500">Common questions</p></div>
        <Card padding="p-0"><div className="divide-y divide-slate-100 dark:divide-[#2E2A4A]">{filteredFaqs.map((faq) => <details key={faq.question} className="group px-4 py-3"><summary className="cursor-pointer list-none pr-5 text-sm font-semibold text-slate-900 marker:hidden dark:text-white">{faq.question}<span className="float-right text-slate-400 group-open:rotate-45">＋</span></summary><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600 dark:text-slate-300">{faq.answer}</p></details>)}</div></Card>
      </section>}

      {filteredDatasetTopics.length > 0 && <section id="dataset-help" className="scroll-mt-28 space-y-3">
        <div><h2 className="text-lg font-bold text-slate-900 dark:text-white">Dataset Help</h2><p className="text-xs text-slate-500">Format and upload</p></div>
        <Card className="space-y-1">{filteredDatasetTopics.map((topic) => <div key={topic.title} className="border-b border-slate-100 py-3 last:border-0 dark:border-[#2E2A4A]"><h3 className="text-sm font-semibold">{topic.title}</h3><p className="mt-1 text-sm text-slate-500">{topic.detail}</p></div>)}
          <div className="flex flex-wrap items-center gap-3 pt-3"><Button variant="secondary" onClick={() => onNavigatePage?.("datasets")}>Open Datasets</Button><Button variant="outline" onClick={validateDataset} disabled={!selectedDatasetId || validationLoading} loading={validationLoading}>Validate selected dataset</Button><span className="text-xs text-slate-500">{activeDataset ? `Selected: ${activeDataset.filename || activeDataset.original_filename}` : "Select a dataset to validate."}</span></div>
          {validation && <p role="status" className="mt-3 text-sm">Validation: <b>{validation.overall_status}</b> · {validation.rows} rows · {validation.missing_values} missing values · {validation.duplicate_rows} duplicate rows</p>}
          {validationError && <ErrorState message={validationError} />}
        </Card>
      </section>}

      {filteredTroubleshooting.length > 0 && <section id="troubleshooting" className="scroll-mt-28 space-y-3">
        <div><h2 className="text-lg font-bold text-slate-900 dark:text-white">Troubleshooting</h2><p className="text-xs text-slate-500">Fix common issues</p></div>
        <Card padding="p-0"><div className="divide-y divide-slate-100 dark:divide-[#2E2A4A]">{filteredTroubleshooting.map((item) => <div key={item.title} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div className="flex-1"><h3 className="text-sm font-semibold">{item.title}</h3><p className="mt-1 text-sm text-slate-500">{item.detail}</p></div>{item.page && <Button variant="secondary" size="sm" onClick={() => onNavigatePage?.(item.page)}>{item.action}</Button>}</div>)}</div></Card>
      </section>}

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3"><div><h2 className="text-lg font-bold">System Information</h2><p className="text-xs text-slate-500">Live application diagnostics</p></div>
          {systemError && <ErrorState message={systemError} />}
          {!system && !systemError && <p className="text-sm text-slate-500">Loading system information…</p>}
          {system && <dl className="divide-y divide-slate-100 text-sm dark:divide-[#2E2A4A]">
            <div className="flex justify-between gap-3 py-2"><dt className="text-slate-500">Application</dt><dd className="text-right">{system.application?.name} {system.application?.version}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-slate-500">Frontend</dt><dd className="text-right">React {React.version}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-slate-500">Backend</dt><dd className="text-right">{system.backend?.framework} {system.backend?.version}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-slate-500">Backend status</dt><dd className={system.database?.status === "connected" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600"}>{system.database?.status === "connected" ? "Online" : "Database unavailable"}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-slate-500">Database</dt><dd className="text-right">{system.database?.engine} · {system.database?.status}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-slate-500">Model libraries</dt><dd className="text-right">{system.model_libraries?.filter((library) => library.version).map((library) => `${library.name} ${library.version}`).join(", ") || "Unavailable"}</dd></div>
          </dl>}
        </Card>
        <Card className="space-y-3"><div><h2 className="text-lg font-bold">Still need help?</h2><p className="text-sm text-slate-500">Contact the project support team for additional assistance.</p></div><p className="text-sm text-slate-600 dark:text-slate-300">No support email or ticket-submission service is configured in this project. Contact your project maintainer or use the support channel provided by your repository owner.</p></Card>
      </section>
    </div>
  );
}
