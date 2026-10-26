import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "./ui/PageHeader";
import Card, { CardTitle } from "./ui/Card";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import Table, { TableRow, TableCell } from "./ui/Table";
import Input from "./ui/Input";
import Select from "./ui/Select";
import Modal from "./ui/Modal";
import EmptyState from "./ui/EmptyState";
import ErrorState from "./ui/ErrorState";
import { useAuth } from "../context/AuthContext";
import { deleteDemoDataset, getDemoDatasets } from "../utils/datasetStorage";

const API_BASE = "/api";

function formatFileSize(bytes) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(Number(bytes)) / Math.log(1024)), units.length - 1);
  const value = Number(bytes) / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function DatasetDetails({ dataset, onClose, onPreview, onValidation }) {
  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      category="DATASET METADATA"
      title={dataset.filename}
      subtitle={`Dataset ID #${dataset.dataset_id}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="outline" onClick={onValidation}>
            Validate Dataset
          </Button>
          <Button variant="gradient" onClick={onPreview}>
            Preview Data
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ["File type", dataset.file_type?.toUpperCase()],
          ["File size", formatFileSize(dataset.file_size)],
          ["Rows", dataset.row_count?.toLocaleString() ?? "-"],
          ["Columns", dataset.column_count?.toLocaleString() ?? "-"],
          ["Upload date", formatDate(dataset.created_at)],
          ["Status", dataset.status],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 dark:border-[#2E2A4A] bg-slate-50/70 dark:bg-[#171525]/60 p-3.5"
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {label}
            </div>
            <div className="mt-1 break-words text-sm font-semibold text-slate-900 dark:text-white">
              {value}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function DatasetPreview({ dataset, preview, onBack }) {
  if (!preview)
    return (
      <div className="p-12 text-center text-sm text-slate-500">
        Loading dataset preview...
      </div>
    );

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        category="DATASET PREVIEW"
        title={dataset.filename}
        subtitle={`Inspecting first 20 rows of dataset #${dataset.dataset_id}`}
        actions={
          <Button variant="secondary" onClick={onBack}>
            ← Back to Datasets
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Rows", preview.row_count?.toLocaleString()],
          ["Columns", preview.column_count?.toLocaleString()],
          ["File type", preview.file_type?.toUpperCase()],
          ["File size", formatFileSize(preview.file_size)],
        ].map(([label, value]) => (
          <Card key={label} padding="p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {label}
            </div>
            <div className="mt-1.5 text-xl font-bold text-slate-900 dark:text-white">
              {value ?? "-"}
            </div>
          </Card>
        ))}
      </div>

      <Card padding="p-5">
        <CardTitle subtitle="Detected fields and data types">
          Columns Schema
        </CardTitle>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {preview.column_names.map((column) => (
            <div
              key={column}
              className="rounded-xl bg-slate-50 dark:bg-[#171525] p-3 border border-slate-100 dark:border-[#2E2A4A]"
            >
              <div className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">
                {column}
              </div>
              <div className="mt-0.5 text-[11px] text-[#7C5CFC] font-medium">
                {preview.data_types[column]}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Table headers={preview.column_names}>
        {preview.preview.length ? (
          preview.preview.map((row, index) => (
            <TableRow key={index}>
              {preview.column_names.map((column) => (
                <TableCell key={column} className="max-w-48 truncate">
                  {row[column] == null ? "-" : String(row[column])}
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell
              colSpan={preview.column_names.length}
              className="text-center py-8 text-slate-400"
            >
              This dataset has no rows.
            </TableCell>
          </TableRow>
        )}
      </Table>
    </div>
  );
}

function ValidationPanel({ validation, onBack }) {
  if (!validation)
    return (
      <div className="p-12 text-center text-sm text-slate-500">
        Analyzing dataset health...
      </div>
    );

  const isHealthy = validation.overall_status === "Healthy";
  const isWarning = validation.overall_status === "Warning";

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        category="VALIDATION REPORT"
        title={validation.filename}
        subtitle="Data quality, missing values, and structure check"
        actions={
          <Button variant="secondary" onClick={onBack}>
            ← Back to Datasets
          </Button>
        }
      />

      <div
        className={`rounded-[20px] p-5 border ${
          isHealthy
            ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50"
            : isWarning
            ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50"
            : "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50"
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{isHealthy ? "✅" : isWarning ? "⚠️" : "❌"}</span>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Dataset Health: {validation.overall_status}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              {validation.file_readable
                ? "File is readable and parsed correctly."
                : "Errors encountered reading file structure."}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Rows", validation.rows],
          ["Columns", validation.columns],
          ["Missing values", validation.missing_values],
          ["Duplicate rows", validation.duplicate_rows],
          ["Empty columns", validation.empty_columns.length],
        ].map(([label, value]) => (
          <Card key={label} padding="p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {label}
            </div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">
              {Number(value).toLocaleString()}
            </div>
          </Card>
        ))}
      </div>

      <Card padding="p-5">
        <CardTitle subtitle="Quality checks and schema warnings">
          Validation Findings
        </CardTitle>
        {validation.findings.length ? (
          <div className="mt-4 space-y-2">
            {validation.findings.map((finding, idx) => (
              <div
                key={idx}
                className={`rounded-xl p-3 text-xs font-semibold flex items-center gap-2 ${
                  finding.severity === "error"
                    ? "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200"
                    : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200"
                }`}
              >
                <span>{finding.severity === "error" ? "❌" : "⚠️"}</span>
                <span>{finding.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            ✓ No dataset validation findings. Ready for ML model training.
          </p>
        )}
      </Card>
    </div>
  );
}

export default function DatasetManagement({
  refreshToken = 0,
  onOpenUploadModal,
  onDatasetChange,
}) {
  const [datasets, setDatasets] = useState([]);
  const [search, setSearch] = useState("");
  const [fileType, setFileType] = useState("All");
  const [status, setStatus] = useState("All");
  const [sort, setSort] = useState("newest");
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState(null);
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState(null);

  const { apiFetch, token } = useAuth();
  const isDemoSession = import.meta.env.DEV && token?.startsWith("demo-");

  const fetchDatasets = () => {
    setLoading(true);
    setError("");
    if (isDemoSession) {
      setDatasets(getDemoDatasets());
      setLoading(false);
      return;
    }
    apiFetch(`${API_BASE}/datasets`)
      .then((res) => (res.ok ? res.json() : Promise.reject("Unable to load datasets.")))
      .then((data) => {
        setDatasets(Array.isArray(data) ? data : []);
      })
      .catch(() => setError("Backend unavailable. Start InventIQ API server and try again."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDatasets();
  }, [refreshToken, isDemoSession]);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timeout);
  }, [toast]);

  const filteredDatasets = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return [...datasets]
      .filter(
        (dataset) =>
          (!normalized || dataset.filename.toLowerCase().includes(normalized)) &&
          (fileType === "All" || dataset.file_type.toUpperCase() === fileType) &&
          (status === "All" || dataset.status.toLowerCase() === status.toLowerCase())
      )
      .sort((a, b) =>
        sort === "name"
          ? a.filename.localeCompare(b.filename)
          : sort === "oldest"
          ? a.dataset_id - b.dataset_id
          : b.dataset_id - a.dataset_id
      );
  }, [datasets, search, fileType, status, sort]);

  const stats = useMemo(() => {
    const totalRecords = datasets.reduce((sum, d) => sum + (d.row_count || 0), 0);
    const validated = datasets.filter((d) => d.status === "uploaded").length;
    const failed = datasets.filter((d) => d.status === "failed").length;
    return { total: datasets.length, totalRecords, validated, failed };
  }, [datasets]);

  const openData = async (dataset, nextView) => {
    setSelected(dataset);
    setView(nextView);
    setPayload(null);
    setError("");
    try {
      const response = await apiFetch(`${API_BASE}/datasets/${dataset.dataset_id}/${nextView}`);
      if (!response.ok) throw new Error("Unable to load dataset details.");
      setPayload(await response.json());
    } catch (requestError) {
      setError(requestError.message || "Unable to load dataset data.");
    }
  };

  const handleDeleteDataset = async () => {
    if (!deleteTarget) return;

    setError("");
    if (isDemoSession && deleteTarget.is_demo) {
      const remainingDatasets = deleteDemoDataset(deleteTarget.dataset_id);
      setDatasets(remainingDatasets);
      setDeleteTarget(null);
      setSelected(null);
      setView(null);
      setToast("Demo dataset deleted.");
      if (onDatasetChange) onDatasetChange();
      return;
    }

    try {
      const response = await apiFetch(`${API_BASE}/datasets/${deleteTarget.dataset_id}`, {
        method: "DELETE",
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || payload.message || "Dataset deletion failed.");
      }

      setDeleteTarget(null);
      setSelected(null);
      setView(null);
      setToast(payload.message || "Dataset deleted successfully.");
      fetchDatasets();
      if (onDatasetChange) onDatasetChange();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Dataset deletion failed.";
      setError(message);
      setToast(null);
    }
  };

  if (view === "preview" && selected)
    return (
      <DatasetPreview
        dataset={selected}
        preview={payload}
        onBack={() => setView(null)}
      />
    );
  if (view === "validation" && selected)
    return (
      <ValidationPanel
        validation={payload}
        onBack={() => setView(null)}
      />
    );

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <PageHeader
        category="DATA LIBRARY"
        title="Dataset Management"
        subtitle="Manage, validate, and preview your uploaded sales and inventory datasets."
        actions={
          <Button variant="gradient" onClick={onOpenUploadModal}>
            ☁ Upload Dataset
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={fetchDatasets} />}

      {/* Dataset Statistics Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card hover>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>TOTAL DATASETS</span>
            <span className="text-sm">📂</span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-slate-900 dark:text-white">
            {stats.total}
          </p>
          <p className="mt-1 text-xs text-slate-500">Files available in catalog</p>
        </Card>

        <Card hover>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>TOTAL RECORDS</span>
            <span className="text-sm">📊</span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-[#7C5CFC] dark:text-[#a58efd]">
            {stats.totalRecords.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-500">Rows processed</p>
        </Card>

        <Card hover>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>VALIDATED & READY</span>
            <span className="text-sm">✅</span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
            {stats.validated}
          </p>
          <p className="mt-1 text-xs text-slate-500">Available for model training</p>
        </Card>

        <Card hover>
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span>NEEDS ATTENTION</span>
            <span className="text-sm">⚠️</span>
          </div>
          <p className="mt-3 text-3xl font-extrabold text-[#D946A8] dark:text-[#f472c1]">
            {stats.failed}
          </p>
          <p className="mt-1 text-xs text-slate-500">Failed or processing</p>
        </Card>
      </div>

      {/* Search and Filters Bar */}
      <Card padding="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            placeholder="Search datasets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <Select value={fileType} onChange={(e) => setFileType(e.target.value)}>
            <option value="All">All File Types</option>
            <option value="CSV">CSV</option>
            <option value="XLSX">XLSX</option>
            <option value="XLS">XLS</option>
          </Select>

          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="All">All Statuses</option>
            <option value="uploaded">Uploaded</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
          </Select>

          <Select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Sort by Newest</option>
            <option value="oldest">Sort by Oldest</option>
            <option value="name">Sort by Name</option>
          </Select>
        </div>
      </Card>

      {/* Datasets Table */}
      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          Loading datasets library...
        </Card>
      ) : filteredDatasets.length === 0 ? (
        <EmptyState
          icon="📁"
          title="No datasets found"
          description="Upload your inventory CSV or Excel datasets to begin demand forecasting."
          actionLabel="Upload Dataset"
          onAction={onOpenUploadModal}
        />
      ) : (
        <Table
          headers={[
            "Dataset",
            "Type",
            "Rows",
            "Columns",
            "Upload Date",
            "Status",
            "Actions",
          ]}
        >
          {filteredDatasets.map((dataset) => (
            <TableRow key={dataset.dataset_id}>
              <TableCell bold className="max-w-64 truncate">
                {dataset.filename}
              </TableCell>
              <TableCell className="uppercase font-mono text-xs">
                {dataset.file_type}
              </TableCell>
              <TableCell>{dataset.row_count?.toLocaleString() ?? "-"}</TableCell>
              <TableCell>{dataset.column_count?.toLocaleString() ?? "-"}</TableCell>
              <TableCell className="text-xs">
                {formatDate(dataset.created_at)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    dataset.status === "uploaded"
                      ? "low"
                      : dataset.status === "failed"
                      ? "high"
                      : "medium"
                  }
                >
                  {dataset.status}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelected(dataset)}
                  >
                    View Details
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteTarget(dataset)}
                  >
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </Table>
      )}

      {selected && !view && (
        <DatasetDetails
          dataset={selected}
          onClose={() => setSelected(null)}
          onPreview={() => openData(selected, "preview")}
          onValidation={() => openData(selected, "validation")}
        />
      )}

      {deleteTarget && (
        <Modal
          isOpen={true}
          onClose={() => setDeleteTarget(null)}
          category="DATASET DELETE"
          title="Remove dataset"
          subtitle={deleteTarget.is_demo
            ? `This will remove ${deleteTarget.filename} from this browser's demo dataset list.`
            : `This will permanently remove ${deleteTarget.filename} and its generated forecasts, alerts, recommendations, and dependencies.`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button variant="gradient" onClick={handleDeleteDataset}>
                Delete Dataset
              </Button>
            </>
          }
        >
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
            {deleteTarget.is_demo
              ? "This removes the demo dataset entry stored in this browser. It does not affect server data."
              : "This action deletes the uploaded file, associated model runs, generated forecasts, open or resolved alerts, recommendations, dependency analysis, and the dataset record itself."}
          </div>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-3 text-xs font-bold shadow-2xl animate-fadeIn">
          {toast}
        </div>
      )}
    </div>
  );
}
