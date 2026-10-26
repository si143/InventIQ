import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext";
import { getDemoDatasets, resolveSelectedDatasetId } from "../utils/datasetStorage";

const API_BASE = "/api";
const STORAGE_KEY = "inventiq_selected_dataset_id";

const DatasetContext = createContext(null);

export function DatasetProvider({ children }) {
  const { getAuthHeaders, token, user } = useAuth();
  const isDemoSession = import.meta.env.DEV && token?.startsWith("demo-");
  const scopedStorageKey = `${STORAGE_KEY}_${user?.id || "anonymous"}`;
  const [datasets, setDatasets] = useState([]);
  const [selectedDatasetId, setSelectedDatasetIdState] = useState(() => localStorage.getItem(scopedStorageKey) || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshDatasets = useCallback(async () => {
    setLoading(true);
    try {
      let available;
      if (isDemoSession) {
        available = getDemoDatasets();
      } else {
        const headers = getAuthHeaders();
        const response = await fetch(`${API_BASE}/datasets`, { headers });
        if (!response.ok) throw new Error("Unable to load datasets.");
        const data = await response.json();
        available = Array.isArray(data) ? data : [];
      }
      setDatasets(available);
      setSelectedDatasetIdState(() => {
        const storedSelection = localStorage.getItem(scopedStorageKey);
        const next = resolveSelectedDatasetId(storedSelection, available);
        if (next) localStorage.setItem(scopedStorageKey, next);
        else localStorage.removeItem(scopedStorageKey);
        return next;
      });
      setError("");
    } catch (err) {
      setError(err.message || "Unable to load datasets.");
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, isDemoSession, scopedStorageKey]);

  useEffect(() => {
    refreshDatasets();
  }, [refreshDatasets]);

  const setSelectedDatasetId = useCallback((value) => {
    const next = value ? String(value) : "";
    setSelectedDatasetIdState(next);
    if (next) localStorage.setItem(scopedStorageKey, next);
    else localStorage.removeItem(scopedStorageKey);
  }, [scopedStorageKey]);

  const value = useMemo(() => ({
    datasets,
    selectedDatasetId,
    setSelectedDatasetId,
    refreshDatasets,
    loading,
    error,
  }), [datasets, selectedDatasetId, loading, error, refreshDatasets, setSelectedDatasetId]);

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

export function useDataset() {
  const context = useContext(DatasetContext);
  if (!context) throw new Error("useDataset must be used inside DatasetProvider");
  return context;
}
