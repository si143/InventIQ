from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.model_service import (  # type: ignore[reportMissingImports]
    _sklearn_result,
    _split,
    build_features,
    prepare_frame,
    train_and_evaluate,
)
DATASET_PATH = ROOT / "backend" / "uploads" / "3_b949f03a826b4895a4f01d7cb8d3731a_inventiq_demand_inventory_dataset.csv"
RESULTS_PATH = ROOT / "research_paper_preparation" / "results" / "model_benchmark.json"
FIGURE_PATH = ROOT / "research_paper_preparation" / "figures" / "model_holdout_comparison.png"


# Fair benchmark configuration: use one valid product family and a chronological split.
def evaluate_models():
    frame = pd.read_csv(DATASET_PATH)
    product_frame = frame[frame["product_id"] == "P2000"].copy().sort_values("date")
    product_frame["date"] = pd.to_datetime(product_frame["date"], errors="coerce")
    product_frame = product_frame.dropna(subset=["date", "units_sold"]).copy()

    results = []
    evaluated = []
    for model_name in ["Linear Regression", "Random Forest", "XGBoost", "ARIMA"]:
        result = train_and_evaluate(product_frame, "units_sold", "date", "product_id", model_name, 7, 999)
        evaluated.append({"model": model_name, **result["metrics"], "selected_model": result["selected_model"]})
        for item in result["evaluated_models"]:
            results.append({
                "model": item["model"],
                "mae": item["mae"],
                "rmse": item["rmse"],
                "r2_score": item.get("r2_score"),
            })

    best = min(results, key=lambda item: item["mae"])
    prepared_frame, prepared_target, prepared_dates = prepare_frame(product_frame, "units_sold", "date", "product_id")
    features = build_features(prepared_frame, "units_sold", "date", "product_id")
    _, test_x, _, test_y, _, cutoff, validation_start, validation_end = _split(features, prepared_target, prepared_dates)
    rf_result = _sklearn_result("Random Forest", features, prepared_target, prepared_dates, prepared_frame["product_id"])
    rf_actual = test_y.to_numpy(dtype=float)
    rf_predicted = rf_result["model"].predict(test_x)

    fig, ax = plt.subplots(figsize=(10, 5))
    validation_dates = prepared_dates.loc[test_y.index]
    ax.plot(validation_dates, rf_actual, label="Actual", color="#0f172a", linewidth=2)
    ax.plot(validation_dates, rf_predicted, label="Predicted (Random Forest)", color="#d97706", linewidth=2)
    ax.set_title("Holdout actual vs predicted demand for product P2000")
    ax.set_xlabel("Date")
    ax.set_ylabel("Units sold")
    ax.grid(True, alpha=0.2)
    ax.legend()
    fig.tight_layout()
    FIGURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIGURE_PATH, dpi=200)
    plt.close(fig)

    summary = {
        "dataset": str(DATASET_PATH.relative_to(ROOT)),
        "product_id": "P2000",
        "date_column": "date",
        "target_column": "units_sold",
        "train_end": cutoff.date().isoformat(),
        "validation_start": validation_start.date().isoformat(),
        "validation_end": validation_end.date().isoformat(),
        "selected_model": best["model"],
        "best_metrics": {"mae": best["mae"], "rmse": best["rmse"], "r2_score": best["r2_score"]},
        "results": results,
    }
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    evaluate_models()
