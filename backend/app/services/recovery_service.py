from __future__ import annotations

from collections import defaultdict
from typing import Any

import numpy as np
import pandas as pd
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import CommercialObsolescence, Dataset, Forecast, ModelRun, ProductDependency, Recommendation
from app.services.dataset_service import read_dataset


def _find_column(columns: list[str], aliases: set[str], tokens: tuple[str, ...]) -> str | None:
    normalized = {" ".join(str(column).lower().replace("_", " ").split()): column for column in columns}
    for alias in aliases:
        if alias in normalized:
            return normalized[alias]
    return next((column for column in columns if any(token in str(column).lower() for token in tokens)), None)


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


def _latest_number(values: pd.Series) -> float | None:
    numeric = pd.to_numeric(values, errors="coerce").dropna()
    return _finite(numeric.iloc[-1]) if not numeric.empty else None


def build_recovery_plan(db: Session, dataset: Dataset) -> dict[str, Any]:
    dataframe = read_dataset(dataset)
    columns = [str(column) for column in dataframe.columns]
    date_column = _find_column(columns, {"date", "sales date", "transaction date", "order date", "timestamp"}, ("date", "time"))
    product_column = _find_column(columns, {"product", "product id", "sku", "item id"}, ("product id", "product", "sku", "item"))
    demand_column = _find_column(columns, {"sales", "units sold", "demand", "quantity", "units"}, ("sales", "units sold", "demand", "quantity"))
    name_column = _find_column(columns, {"product name", "item name"}, ("product name", "item name"))
    category_column = _find_column(columns, {"category", "product category"}, ("category",))
    stock_column = _find_column(columns, {"stock on hand", "inventory", "units in stock", "on hand", "available stock", "stock level", "inventory level", "current stock", "quantity on hand", "stock quantity", "inventory quantity"}, ("stock on hand", "available stock", "stock level", "inventory quantity", "inventory level", "on hand"))
    price_column = _find_column(columns, {"price", "unit price", "selling price", "retail price"}, ("selling price", "unit price", "price"))
    cost_column = _find_column(columns, {"unit cost", "cost", "purchase cost", "cost price", "landed cost"}, ("unit cost", "purchase cost", "cost price", "landed cost"))
    warehouse_column = _find_column(columns, {"warehouse", "warehouse id", "location", "location id"}, ("warehouse", "location"))
    supplier_column = _find_column(columns, {"supplier", "supplier id", "vendor", "vendor id"}, ("supplier", "vendor"))
    if not date_column or not product_column or not demand_column:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Recovery planning requires date, product, and demand columns.")

    frame = dataframe.copy()
    frame["_date"] = pd.to_datetime(frame[date_column], errors="coerce")
    frame["_product"] = frame[product_column].astype("string").str.strip()
    frame["_demand"] = pd.to_numeric(frame[demand_column], errors="coerce")
    frame = frame.dropna(subset=["_date", "_product", "_demand"])
    frame = frame[frame["_product"] != ""]
    if frame.empty:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No usable demand observations are available for recovery planning.")
    stock_data_available = bool(stock_column and pd.to_numeric(frame[stock_column], errors="coerce").notna().any())
    price_data_available = bool(price_column and pd.to_numeric(frame[price_column], errors="coerce").notna().any())
    cost_data_available = bool(cost_column and pd.to_numeric(frame[cost_column], errors="coerce").notna().any())

    daily = frame.groupby(["_product", "_date"], as_index=False)["_demand"].sum().sort_values(["_product", "_date"])
    latest_date = daily["_date"].max()
    cutoff = latest_date - pd.Timedelta(days=max(1, int((latest_date - daily["_date"].min()).days * 0.3)))
    forecast_run = db.query(ModelRun).filter(ModelRun.dataset_id == dataset.id, ModelRun.status == "completed").order_by(ModelRun.id.desc()).first()
    forecasts = db.query(Forecast).filter(Forecast.model_run_id == forecast_run.id).all() if forecast_run else []
    product_frames = {str(product): product_frame for product, product_frame in frame.groupby("_product", sort=True)}
    aliases: dict[str, set[str]] = defaultdict(set)
    for product, product_frame in product_frames.items():
        aliases[product.casefold()].add(product)
        for identity_column in (product_column, name_column):
            if identity_column and identity_column in product_frame.columns:
                for value in product_frame[identity_column].dropna().astype(str).str.strip().unique():
                    if value:
                        aliases[value.casefold()].add(product)
    forecast_by_product: dict[str, list[float]] = defaultdict(list)
    forecast_dates_by_product: dict[str, set[Any]] = defaultdict(set)
    for forecast in forecasts:
        matches = aliases.get(str(forecast.product_id).strip().casefold(), set())
        if len(matches) == 1:
            value = _finite(forecast.predicted_demand)
            if value is not None:
                product_key = next(iter(matches))
                forecast_by_product[product_key].append(max(value, 0.0))
                forecast_dates_by_product[product_key].add(forecast.forecast_date)

    obsolescence = {record.product_id: record for record in db.query(CommercialObsolescence).filter(CommercialObsolescence.dataset_id == dataset.id).all()}
    name_to_id = dict(zip(frame[name_column].astype(str), frame[product_column].astype(str))) if name_column else {}
    dependency_rows = db.query(ProductDependency).filter(ProductDependency.dataset_id == dataset.id).all()
    dependencies_by_product: dict[str, list[ProductDependency]] = {}
    for dependency in dependency_rows:
        left_id = name_to_id.get(dependency.product_a, dependency.product_a)
        right_id = name_to_id.get(dependency.product_b, dependency.product_b)
        dependencies_by_product.setdefault(left_id, []).append(dependency)
        dependencies_by_product.setdefault(right_id, []).append(dependency)
        dependencies_by_product.setdefault(dependency.product_a, []).append(dependency)
        dependencies_by_product.setdefault(dependency.product_b, []).append(dependency)
    recommendations = db.query(Recommendation).filter(Recommendation.dataset_id == dataset.id).all()
    recommendations_by_product: dict[str, list[Recommendation]] = {}
    for recommendation in recommendations:
        if recommendation.product_id:
            recommendations_by_product.setdefault(str(recommendation.product_id), []).append(recommendation)

    recent_by_product: dict[str, float] = {}
    historical_by_product: dict[str, float] = {}
    for product, product_daily in daily.groupby("_product", sort=True):
        historical = product_daily.loc[product_daily["_date"] < cutoff, "_demand"]
        recent = product_daily.loc[product_daily["_date"] >= cutoff, "_demand"]
        if len(historical):
            historical_by_product[str(product)] = float(historical.mean())
        if len(recent):
            recent_by_product[str(product)] = float(recent.mean())
    slow_cutoff = float(pd.Series(list(recent_by_product.values())).quantile(0.25)) if recent_by_product else None

    limitations = []
    if not stock_data_available:
        limitations.append("No usable numeric inventory or stock quantities were found; excess quantity is unavailable.")
    if not forecasts:
        limitations.append("No completed forecast exists for this dataset; excess quantity requires a forecast.")
    if not price_data_available:
        limitations.append("No usable numeric selling prices were found; recovery revenue is unavailable.")
    if not cost_data_available:
        limitations.append("No usable numeric unit costs were found; inventory cost exposure is unavailable.")
    if not warehouse_column:
        limitations.append("No warehouse or location column was found; transfer recommendations are unavailable.")
    if not supplier_column:
        limitations.append("No supplier or vendor column was found; supplier-return recommendations are unavailable.")
    if not any("expiry" in str(column).lower() or "expiration" in str(column).lower() for column in columns):
        limitations.append("No expiry-date column was found; expiry is not analyzed.")

    products = []
    for product, product_daily in daily.groupby("_product", sort=True):
        product = str(product)
        product_rows = product_frames[product].sort_values("_date")
        product_name = str(product_rows[name_column].dropna().iloc[0]) if name_column and product_rows[name_column].notna().any() else str(product)
        historical_demand = historical_by_product.get(product)
        recent_demand = recent_by_product.get(product)
        product_forecasts = forecast_by_product.get(product, [])
        forecast_demand = float(sum(product_forecasts)) if product_forecasts else None
        demand_change = (recent_demand - historical_demand) / abs(historical_demand) if historical_demand not in (None, 0) and recent_demand is not None else None
        decline_rate = max(0.0, -demand_change) if demand_change is not None else None
        forecast_decline = max(0.0, (recent_demand - forecast_demand / len(product_forecasts)) / max(recent_demand, 1.0)) if recent_demand and product_forecasts else None

        current_stock = None
        if stock_column:
            stock_rows = product_rows.dropna(subset=[stock_column]).copy()
            stock_rows["_stock"] = pd.to_numeric(stock_rows[stock_column], errors="coerce")
            stock_rows = stock_rows.dropna(subset=["_stock"])
            if not stock_rows.empty:
                if warehouse_column and warehouse_column in stock_rows.columns:
                    latest_by_warehouse = stock_rows.groupby(warehouse_column, dropna=False, sort=False).tail(1)
                    current_stock = max(0.0, float(latest_by_warehouse["_stock"].clip(lower=0).sum()))
                else:
                    current_stock = max(0.0, float(stock_rows.sort_values("_date").iloc[-1]["_stock"]))
        excess_quantity = max(0.0, current_stock - forecast_demand) if current_stock is not None and forecast_demand is not None else None
        unit_price = _latest_number(product_rows[price_column]) if price_column else None
        unit_cost = _latest_number(product_rows[cost_column]) if cost_column else None
        recovery_value = excess_quantity * unit_price if excess_quantity is not None and unit_price is not None else None
        cost_exposure = excess_quantity * unit_cost if excess_quantity is not None and unit_cost is not None else None
        declining = demand_change is not None and demand_change < 0
        slow_moving = bool(recent_demand is not None and historical_demand is not None and recent_demand < historical_demand and slow_cutoff is not None and recent_demand <= slow_cutoff)
        unusually_low = bool(recent_demand is not None and slow_cutoff is not None and recent_demand <= slow_cutoff)

        obs = obsolescence.get(str(product))
        risk_level = obs.risk_level if obs else None
        related_dependencies = sorted({item.id: item for item in dependencies_by_product.get(str(product), []) + dependencies_by_product.get(product_name, [])}.values(), key=lambda item: abs(item.correlation), reverse=True)[:3]
        related_recommendations = recommendations_by_product.get(str(product), [])
        evidence: list[str] = []
        score = 0
        if excess_quantity is not None and excess_quantity > 0:
            score += 2
            evidence.append(f"Current stock exceeds forecast demand by {excess_quantity:.1f} units.")
        if decline_rate is not None and decline_rate >= 0.15:
            score += 2
            evidence.append(f"Recent demand is {decline_rate:.1%} below the historical average.")
        if forecast_decline is not None and forecast_decline >= 0.10:
            score += 1
            evidence.append("Forecast demand remains below recent demand.")
        if risk_level in {"High", "Critical"}:
            score += 2
            evidence.append(f"Commercial obsolescence risk is {risk_level}.")
        elif risk_level == "Moderate":
            score += 1
            evidence.append("Commercial obsolescence risk is Moderate.")
        if related_dependencies and abs(float(related_dependencies[0].correlation)) >= 0.6:
            related = related_dependencies[0]
            evidence.append(f"Related products show historical correlation of {float(related.correlation):.2f}; this does not prove causation.")
        if related_recommendations:
            evidence.append(f"Existing recommendation: {related_recommendations[0].recommendation_type}.")
        if score >= 3:
            priority, action = "High", "Discount" if price_column else "Promote"
        elif score >= 2:
            priority, action = "Moderate", "Promote"
        else:
            priority, action = "Low", "Monitor"

        if excess_quantity is not None and excess_quantity > 0:
            action = "Review a 10–30% discount on surplus stock" if price_column else "Review surplus stock and confirm selling price before promotion"
        elif slow_moving:
            action = "Consider bundling with a faster-moving product"
        elif declining:
            action = "Review purchasing and promotion plans against the declining trend"

        recommendations_for_product = []
        if excess_quantity is not None and excess_quantity > 0:
            reference_impact = excess_quantity * unit_price * 0.8 if unit_price is not None else None
            recommendations_for_product.append({
                "reason": "Current stock is above the latest forecast horizon.",
                "suggested_action": action,
                "priority": priority,
                "estimated_impact": reference_impact,
                "impact_basis": "Gross revenue if all excess units sell at a reference 20% discount; not profit or a guaranteed result." if reference_impact is not None else None,
            })
            if warehouse_column and product_rows[warehouse_column].nunique(dropna=True) > 1:
                recommendations_for_product.append({"reason": "Multiple warehouse or location values exist in the dataset.", "suggested_action": "Review transfers against local demand and stock before moving inventory.", "priority": priority, "estimated_impact": None, "impact_basis": None})
            if supplier_column and product_rows[supplier_column].notna().any():
                recommendations_for_product.append({"reason": "Supplier or vendor data is available.", "suggested_action": "Check supplier terms to confirm whether surplus stock can be returned.", "priority": "Moderate", "estimated_impact": None, "impact_basis": None})
            recommendations_for_product.append({"reason": "Surplus stock is indicated, but resale suitability is a business decision.", "suggested_action": "Consider donation or recycling only after checking product condition and policy eligibility.", "priority": "Low", "estimated_impact": None, "impact_basis": None})
        elif declining or slow_moving:
            recommendations_for_product.append({"reason": "Recent sales are below this product's historical level." if declining else "Recent demand is in the lower quartile of this dataset.", "suggested_action": action, "priority": priority, "estimated_impact": None, "impact_basis": None})

        inventory_risk = risk_level or "Low"
        if excess_quantity is not None and excess_quantity > 0 and current_stock:
            inventory_risk = "High" if excess_quantity / current_stock >= 0.5 or risk_level in {"High", "Critical"} else "Moderate"
        elif risk_level in {"High", "Critical"}:
            inventory_risk = "High"
        elif declining or slow_moving:
            inventory_risk = "Moderate"

        products.append({
            "product_id": str(product),
            "product_name": product_name,
            "category": str(product_rows[category_column].dropna().iloc[0]) if category_column and product_rows[category_column].notna().any() else None,
            "units_sold": float(product_rows["_demand"].clip(lower=0).sum()),
            "historical_demand": historical_demand,
            "recent_demand": recent_demand,
            "forecast_demand": forecast_demand,
            "forecast_horizon_days": len(forecast_dates_by_product.get(product, set())),
            "current_stock": current_stock,
            "excess_quantity": excess_quantity,
            "unit_price": unit_price,
            "unit_cost": unit_cost,
            "estimated_recovery_value": recovery_value,
            "potential_inventory_loss": cost_exposure,
            "demand_change": demand_change,
            "declining_demand": declining,
            "slow_moving": slow_moving,
            "unusually_low_demand": unusually_low,
            "recovery_opportunity": score > 0,
            "risk_level": inventory_risk,
            "obsolescence_risk": risk_level or "Not analyzed",
            "obsolescence_score": obs.risk_score if obs else None,
            "obsolescence_trend": obs.trend if obs else None,
            "dependency_signal": [{"related_product": name_to_id.get(item.product_b if item.product_a == product_name else item.product_a, item.product_b if item.product_a == product_name else item.product_a), "related_product_name": item.product_b if item.product_a == product_name else item.product_a, "correlation": float(item.correlation), "dependency_score": float(item.dependency_score), "relationship_type": item.relationship_type} for item in related_dependencies],
            "existing_recommendations": [{"type": item.recommendation_type, "priority": item.priority, "suggested_action": item.suggested_action, "status": item.status} for item in related_recommendations],
            "recovery_priority": priority,
            "suggested_action": action,
            "reason": " ".join(evidence) if evidence else "Limited evidence; continue monitoring.",
            "recommendations": recommendations_for_product,
            "limitations": limitations,
            "inventory": current_stock,
            "estimated_excess": excess_quantity,
            "potential_recovery_quantity": excess_quantity,
        })

    opportunities = [product for product in products if product["recovery_opportunity"]]
    priority_counts = {priority: sum(row["recovery_priority"] == priority for row in opportunities) for priority in ("High", "Moderate", "Low")}
    recovery_values = [product["estimated_recovery_value"] for product in products if product["estimated_recovery_value"] is not None]
    cost_values = [product["potential_inventory_loss"] for product in products if product["potential_inventory_loss"] is not None]
    if not obsolescence:
        limitations.append("Commercial obsolescence analysis has not been run for this dataset; recovery assessment uses demand and forecast evidence only.")
    return {
        "dataset_id": dataset.id,
        "summary": {
            "products_evaluated": int(daily["_product"].nunique()),
            "recovery_opportunities": len(opportunities),
            "excess_inventory_opportunities": sum(product["excess_quantity"] is not None and product["excess_quantity"] > 0 for product in products),
            "slow_moving_products": sum(product["slow_moving"] for product in products),
            "declining_demand_products": sum(product["declining_demand"] for product in products),
            "high_priority": priority_counts["High"],
            "moderate_priority": priority_counts["Moderate"],
            "low_priority": priority_counts["Low"],
            "inventory_data_available": stock_data_available,
            "forecast_available": bool(forecasts),
            "estimated_recovery_value": float(sum(recovery_values)) if recovery_values else None,
            "potential_inventory_loss_avoided": float(sum(cost_values)) if cost_values else None,
            "recovery_value_products": len(recovery_values),
            "loss_value_products": len(cost_values),
            "unit_price_available": price_data_available,
            "unit_cost_available": cost_data_available,
            "forecast_horizon_days": len({row.forecast_date for row in forecasts}) if forecasts else 0,
        },
        "products": products,
        "data_limitations": limitations,
        "metadata": {
            "mode": "stock_and_demand_recovery" if stock_data_available and forecasts else "demand_recovery",
            "historical_period_end": latest_date.date().isoformat(),
            "recent_cutoff": cutoff.date().isoformat(),
            "forecast_model_run_id": forecast_run.id if forecast_run else None,
            "selling_price_column": price_column,
            "unit_cost_column": cost_column,
            "stock_column": stock_column,
            "rules": "Excess compares latest available stock with total predictions in the latest completed forecast horizon. Slow-moving is relative to the lower quartile of recent product demand and below that product's historical demand.",
        },
    }