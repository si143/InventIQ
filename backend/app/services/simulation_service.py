from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Dataset, Forecast, ModelRun, Simulation
from app.services.dataset_service import read_dataset


SUPPORTED_TYPES = {"demand_spike", "supplier_delay", "promo_impact"}
COUNTERFACTUAL_TYPE = "counterfactual_inventory"
INVENTORY_ALIASES = {"inventory", "stock", "stock quantity", "available stock", "opening stock", "closing stock", "inventory level"}
COST_ALIASES = {"unit cost", "cost", "unit price", "price"}
PRODUCT_ALIASES = {"product", "product id", "product name", "sku", "item", "item id"}


def _finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if np.isfinite(number) else fallback


def _forecast_baseline(
    db: Session,
    dataset_id: int,
    forecast_run_id: int,
    user_id: int,
) -> dict[str, float]:
    rows = (
        db.query(Forecast, ModelRun)
        .join(ModelRun, Forecast.model_run_id == ModelRun.id)
        .join(Dataset, ModelRun.dataset_id == Dataset.id)
        .filter(
            ModelRun.id == forecast_run_id,
            ModelRun.dataset_id == dataset_id,
            ModelRun.status == "completed",
            Dataset.user_id == user_id,
        )
        .all()
    )
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No saved forecasts were found for the selected completed model run and dataset. Generate a forecast on the Demand Forecasts page first.",
        )
    grouped: dict[str, list[float]] = {}
    for row, _ in rows:
        grouped.setdefault(row.product_id, []).append(max(_finite(row.predicted_demand), 0.0))
    return {product: float(sum(values)) for product, values in grouped.items()}


def _column_by_alias(dataframe, aliases: set[str]) -> str | None:
    normalized = {" ".join(str(column).strip().lower().replace("_", " ").split()): column for column in dataframe.columns}
    return next((normalized[alias] for alias in aliases if alias in normalized), None)


def _counterfactual_inventory_results(
    db: Session,
    dataset: Dataset,
    forecast_run_id: int,
    adjustment_percent: float,
    user_id: int,
) -> dict[str, Any]:
    if not np.isfinite(adjustment_percent) or adjustment_percent < -100 or adjustment_percent > 1000:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Inventory adjustment must be between -100% and 1000%.")
    dataframe = read_dataset(dataset)
    baseline_by_product = _forecast_baseline(db, dataset.id, forecast_run_id, user_id)
    product_column = _column_by_alias(dataframe, PRODUCT_ALIASES)
    inventory_column = _column_by_alias(dataframe, INVENTORY_ALIASES)
    cost_column = _column_by_alias(dataframe, COST_ALIASES)
    inventory_by_product: dict[str, float] = {}
    cost_by_product: dict[str, float] = {}
    if product_column and inventory_column:
        inventory_rows = dataframe[[product_column, inventory_column]].copy()
        inventory_rows[inventory_column] = np.asarray(inventory_rows[inventory_column], dtype="object")
        inventory_rows["_inventory"] = pd.to_numeric(inventory_rows[inventory_column], errors="coerce")
        inventory_rows = inventory_rows.dropna(subset=[product_column, "_inventory"])
        inventory_by_product = inventory_rows.groupby(product_column)["_inventory"].last().astype(float).to_dict()
        if cost_column:
            cost_rows = dataframe[[product_column, cost_column]].copy()
            cost_rows["_cost"] = pd.to_numeric(cost_rows[cost_column], errors="coerce")
            cost_by_product = cost_rows.dropna(subset=[product_column, "_cost"]).groupby(product_column)["_cost"].last().astype(float).to_dict()

    has_inventory = bool(inventory_by_product)
    multiplier = 1.0 + adjustment_percent / 100.0
    products = []
    for product, demand in sorted(baseline_by_product.items()):
        baseline_inventory = inventory_by_product.get(product) if has_inventory else None
        counterfactual_inventory = baseline_inventory * multiplier if baseline_inventory is not None else None
        baseline_shortage = max(demand - baseline_inventory, 0.0) if baseline_inventory is not None else None
        counterfactual_shortage = max(demand - counterfactual_inventory, 0.0) if counterfactual_inventory is not None else None
        unit_cost = cost_by_product.get(product)
        products.append({
            "product_id": product,
            "baseline_inventory": baseline_inventory,
            "counterfactual_inventory": counterfactual_inventory,
            "forecast_demand": round(demand, 4),
            "baseline_shortage": baseline_shortage,
            "counterfactual_shortage": counterfactual_shortage,
            "shortage_difference": (counterfactual_shortage - baseline_shortage) if baseline_shortage is not None and counterfactual_shortage is not None else None,
            "baseline_inventory_cost": baseline_inventory * unit_cost if baseline_inventory is not None and unit_cost is not None else None,
            "counterfactual_inventory_cost": counterfactual_inventory * unit_cost if counterfactual_inventory is not None and unit_cost is not None else None,
        })

    baseline_inventory_total = sum(item["baseline_inventory"] for item in products if item["baseline_inventory"] is not None) if has_inventory else None
    counterfactual_inventory_total = sum(item["counterfactual_inventory"] for item in products if item["counterfactual_inventory"] is not None) if has_inventory else None
    baseline_shortage_total = sum(item["baseline_shortage"] for item in products if item["baseline_shortage"] is not None) if has_inventory else None
    counterfactual_shortage_total = sum(item["counterfactual_shortage"] for item in products if item["counterfactual_shortage"] is not None) if has_inventory else None
    limitations = [] if has_inventory else ["Inventory metrics are unavailable: the selected dataset has no recognized inventory or stock quantity column."]
    if not has_inventory:
        limitations.append("Forecast demand remains available for comparison, but inventory change, shortage, stockout risk, and inventory cost are N/A.")
    return {
        "dataset_id": dataset.id,
        "scenario_type": COUNTERFACTUAL_TYPE,
        "forecast_run_id": forecast_run_id,
        "adjustment_percent": adjustment_percent,
        "scenario_label": f"{adjustment_percent:+.1f}% inventory adjustment",
        "baseline": {"products_evaluated": len(products), "inventory_quantity": baseline_inventory_total, "forecast_demand": round(sum(baseline_by_product.values()), 4), "expected_shortage": baseline_shortage_total, "stockout_risk": None, "inventory_cost": None},
        "counterfactual": {"products_evaluated": len(products), "inventory_quantity": counterfactual_inventory_total, "forecast_demand": round(sum(baseline_by_product.values()), 4), "expected_shortage": counterfactual_shortage_total, "stockout_risk": None, "inventory_cost": None},
        "differences": {"inventory_change": counterfactual_inventory_total - baseline_inventory_total if has_inventory else None, "demand_coverage_change": None, "shortage_change": counterfactual_shortage_total - baseline_shortage_total if has_inventory else None, "stockout_risk_change": None, "cost_change": None},
        "products": products,
        "data_limitations": limitations,
        "metadata": {"forecast_source": "completed forecasts", "inventory_column": inventory_column, "cost_column": cost_column, "product_column": product_column, "inventory_metrics_available": has_inventory},
    }


def execute_counterfactual_inventory(
    db: Session,
    dataset: Dataset,
    forecast_run_id: int,
    adjustment_percent: float,
    user_id: int,
    name: str | None = None,
) -> Simulation:
    results = _counterfactual_inventory_results(db, dataset, forecast_run_id, adjustment_percent, user_id)
    simulation = Simulation(
        user_id=user_id,
        dataset_id=dataset.id,
        simulation_type=COUNTERFACTUAL_TYPE,
        name=name or results["scenario_label"],
        parameters=json.dumps({"simulation_type": COUNTERFACTUAL_TYPE, "adjustment_percent": adjustment_percent, "dataset_id": dataset.id, "forecast_run_id": forecast_run_id}),
        results=json.dumps(results),
        status="completed",
        completed_at=datetime.now(timezone.utc),
    )
    db.add(simulation)
    db.commit()
    db.refresh(simulation)
    return simulation


def execute_simulation(
    db: Session,
    dataset: Dataset,
    forecast_run_id: int,
    simulation_type: str,
    demand_change: float = 0.0,
    lead_time_delay: float = 0.0,
    user_id: int = 1,
    name: str | None = None,
) -> Simulation:
    if simulation_type not in SUPPORTED_TYPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported simulation type.")
    if not np.isfinite(demand_change) or demand_change < -100 or demand_change > 1000:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Demand change must be between -100% and 1000%.")
    if not np.isfinite(lead_time_delay) or lead_time_delay < 0 or lead_time_delay > 365:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Lead-time delay must be between 0 and 365 days.")
    baseline_by_product = _forecast_baseline(db, dataset.id, forecast_run_id, user_id)
    baseline_demand = sum(baseline_by_product.values())

    if simulation_type == "supplier_delay":
        multiplier = 1.0
        scenario_label = f"{lead_time_delay:.1f}-day lead-time delay"
        limitations = ["Lead-time context was recorded, but stockout timing cannot be calculated without inventory and supplier lead-time data."]
    else:
        multiplier = 1.0 + demand_change / 100.0
        scenario_label = f"{demand_change:.1f}% demand change"
        limitations = []
    simulated_by_product = {product: demand * multiplier for product, demand in baseline_by_product.items()}
    simulated_demand = sum(simulated_by_product.values())
    demand_impact = simulated_demand - baseline_demand
    impacted_products = sum(
        1 for product, demand in simulated_by_product.items()
        if abs(demand - baseline_by_product[product]) > 0.000001
    )
    results = {
        "baseline_demand": round(baseline_demand, 4),
        "simulated_demand": round(simulated_demand, 4),
        "demand_impact": round(demand_impact, 4),
        "demand_impact_percent": round((demand_impact / baseline_demand * 100) if baseline_demand else 0.0, 4),
        "impacted_products": impacted_products,
        "impacted_skus": impacted_products,
        "stockout_exposure": "Unavailable: dataset has no inventory or stock quantity column.",
        "working_capital": "Unavailable: dataset has no inventory quantity/cost inputs.",
        "inventory_impact": "Unavailable: dataset has no inventory quantity column.",
        "scenario_label": scenario_label,
        "forecast_products": len(baseline_by_product),
        "forecast_run_id": forecast_run_id,
        "source": "completed forecasts",
        "limitations": limitations,
    }
    parameters = {
        "simulation_type": simulation_type,
        "demand_change": demand_change,
        "lead_time_delay": lead_time_delay,
        "dataset_id": dataset.id,
        "forecast_run_id": forecast_run_id,
    }
    simulation = Simulation(
        user_id=user_id,
        dataset_id=dataset.id,
        simulation_type=simulation_type,
        name=name or scenario_label,
        parameters=json.dumps(parameters),
        results=json.dumps(results),
        status="completed",
        completed_at=datetime.now(timezone.utc),
    )
    db.add(simulation)
    db.commit()
    db.refresh(simulation)
    return simulation