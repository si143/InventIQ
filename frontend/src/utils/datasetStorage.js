const DEMO_DATASETS_STORAGE_KEY = "inventiq_demo_datasets";

export function resolveSelectedDatasetId(currentValue, datasets) {
  if (!Array.isArray(datasets) || !datasets.length) {
    return currentValue && String(currentValue) ? "" : "";
  }

  const validIds = datasets.map((dataset) => String(dataset.dataset_id));
  if (currentValue && validIds.includes(String(currentValue))) {
    return String(currentValue);
  }

  return String(datasets[0].dataset_id);
}

export function getDemoDatasets() {
  try {
    const datasets = JSON.parse(localStorage.getItem(DEMO_DATASETS_STORAGE_KEY) || "[]");
    return Array.isArray(datasets) ? datasets : [];
  } catch {
    return [];
  }
}

export function saveDemoDataset(dataset) {
  const datasets = [
    dataset,
    ...getDemoDatasets().filter((item) => item.dataset_id !== dataset.dataset_id),
  ];
  localStorage.setItem(DEMO_DATASETS_STORAGE_KEY, JSON.stringify(datasets));
  return datasets;
}

export function deleteDemoDataset(datasetId) {
  const datasets = getDemoDatasets().filter((item) => item.dataset_id !== datasetId);
  localStorage.setItem(DEMO_DATASETS_STORAGE_KEY, JSON.stringify(datasets));
  return datasets;
}
