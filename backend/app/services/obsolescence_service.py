from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import CommercialObsolescence, Dataset, Forecast, ModelRun
from app.services.dataset_service import read_dataset

MIN_OBSERVATIONS = 10
RECENT_SHARE = 0.30
LOW_RISK_MAX = 29
MODERATE_RISK_MAX = 59
HIGH_RISK_MAX = 79


@dataclass
class ColumnSet:
    date: str
    product: str
    demand: str
    name: str | None
    category: str | None


def _column(columns: list[str], preferred: tuple[str, ...], tokens: tuple[str, ...]) -> str | None:
    lowered = {str(column).lower().strip(): column for column in columns}
    for name in preferred:
        if name in lowered:
            return lowered[name]
    return next((column for column in columns if any(token in str(column).lower() for token in tokens)), None)


def detect_columns(dataframe: pd.DataFrame) -> ColumnSet:
    columns = [str(column) for column in dataframe.columns]
    date_column = _column(columns, ("sales_date", "date", "transaction_date"), ("date", "time"))
    product_column = _column(columns, ("product_id", "sku", "item_id", "product"), ("product", "sku", "item"))
    demand_column = _column(columns, ("units_sold", "demand", "quantity", "units"), ("units", "demand", "quantity", "sales"))
    if not date_column or not product_column or not demand_column:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A date, product, and demand column are required for commercial obsolescence analysis.")
    return ColumnSet(
        date=date_column,
        product=product_column,
        demand=demand_column,
        name=_column(columns, ("product_name", "item_name"), ("product_name", "item_name")),
        category=_column(columns, ("category", "product_category"), ("category",)),
    )


def _finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if np.isfinite(number) else fallback


def _risk_level(score: float, sufficient: bool) -> str:
    if not sufficient:
        return "Insufficient Data"
    if score >= HIGH_RISK_MAX + 1:
        return "Critical"
    if score >= MODERATE_RISK_MAX + 1:
        return "High"
    if score >= LOW_RISK_MAX + 1:
        return "Moderate"
    return "Low"


def _action(level: str, has_inventory_data: bool) -> str:
    inventory_note = " Inventory quantity/cost data is not available in the uploaded dataset." if not has_inventory_data else ""
    actions = {
        "Low": "Continue normal monitoring.",
        "Moderate": "Monitor demand closely and review replenishment frequency.",
        "High": "Reduce replenishment and review existing inventory exposure.",
        "Critical": "Prioritize inventory review, reduce replenishment, and evaluate recovery or clearance actions.",
        "Insufficient Data": "Collect more observations before making an obsolescence decision.",
    }
    return actions[level] + inventory_note


def _forecast_context(db: Session, dataset_id: int, product_id: str) -> dict[str, float | None]:
    latest_run = db.query(ModelRun).filter(ModelRun.dataset_id == dataset_id, ModelRun.status == "completed").order_by(ModelRun.id.desc()).first()
    if latest_run is None:
        return {"forecast_demand": None, "forecast_lower_bound": None, "forecast_upper_bound": None, "confidence_level": None}
    row = (
        db.query(Forecast)
        .filter(Forecast.model_run_id == latest_run.id, Forecast.product_id == product_id)
        .order_by(Forecast.forecast_date.desc())
        .first()
    )
    if row is None:
        return {"forecast_demand": None, "forecast_lower_bound": None, "forecast_upper_bound": None, "confidence_level": None}
    related = db.query(Forecast).filter(Forecast.model_run_id == latest_run.id, Forecast.product_id == product_id).all()
    return {
        "forecast_demand": _finite(np.mean([item.predicted_demand for item in related]), 0.0),
        "forecast_lower_bound": _finite(np.mean([item.lower_bound for item in related if item.lower_bound is not None]), 0.0) if any(item.lower_bound is not None for item in related) else None,
        "forecast_upper_bound": _finite(np.mean([item.upper_bound for item in related if item.upper_bound is not None]), 0.0) if any(item.upper_bound is not None for item in related) else None,
        "confidence_level": _finite(np.mean([item.confidence_level for item in related if item.confidence_level is not None]), 0.0) if any(item.confidence_level is not None for item in related) else None,
    }


def analyze_obsolescence(db: Session, dataset: Dataset) -> list[CommercialObsolescence]:
    dataframe = read_dataset(dataset)
    columns = detect_columns(dataframe)
    frame = dataframe.copy()
    frame["_date"] = pd.to_datetime(frame[columns.date], errors="coerce")
    frame["_demand"] = pd.to_numeric(frame[columns.demand], errors="coerce")
    frame["_product"] = frame[columns.product].astype(str)
    frame = frame.dropna(subset=["_date", "_demand"])
    frame["_demand"] = frame["_demand"].clip(lower=0)
    if frame.empty:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No usable dated demand observations were found.")

    date_range = frame["_date"].max() - frame["_date"].min()
    has_inventory_data = any(token in " ".join(str(column).lower() for column in dataframe.columns) for token in ("inventory", "stock", "on_hand"))
    records: list[CommercialObsolescence] = []
    db.query(CommercialObsolescence).filter(CommercialObsolescence.dataset_id == dataset.id).delete(synchronize_session=False)

    for product_id, product_frame in frame.groupby("_product", sort=True):
        product_frame = product_frame.sort_values("_date")
        observations = len(product_frame)
        product_name = str(product_frame[columns.name].dropna().iloc[0]) if columns.name and product_frame[columns.name].notna().any() else product_id
        category = str(product_frame[columns.category].dropna().iloc[0]) if columns.category and product_frame[columns.category].notna().any() else None
        daily = product_frame.groupby("_date")["_demand"].sum().sort_index()
        split = max(1, int(len(daily) * (1 - RECENT_SHARE)))
        historical = daily.iloc[:split]
        recent = daily.iloc[split:]
        sufficient = observations >= MIN_OBSERVATIONS and len(historical) >= 3 and len(recent) >= 3
        historical_average = _finite(historical.mean()) if len(historical) else 0.0
        recent_average = _finite(recent.mean()) if len(recent) else 0.0
        decline_rate = max(0.0, min(1.0, (historical_average - recent_average) / max(historical_average, 1.0))) if historical_average > 0 else 0.0
        recent_velocity = _finite(recent.sum() / max((recent.index.max() - recent.index.min()).days + 1, 1)) if len(recent) else 0.0
        slope = float(np.polyfit(np.arange(len(daily)), daily.to_numpy(dtype=float), 1)[0]) if len(daily) >= 3 else 0.0
        trend = "Decreasing" if slope < -max(historical_average * 0.02, 0.01) else "Increasing" if slope > max(historical_average * 0.02, 0.01) else "Stable"
        persistence = float((recent <= historical_average).mean()) if len(recent) and historical_average > 0 else 0.0
        forecast = _forecast_context(db, dataset.id, product_id)
        forecast_demand = forecast["forecast_demand"]
        forecast_support = 0.0
        if forecast_demand is not None and recent_average > 0:
            forecast_support = 10.0 if forecast_demand < recent_average * 0.9 else -5.0 if forecast_demand > recent_average * 1.1 else 0.0
        seasonal_guard = False
        if len(daily) >= 56 and daily.index.dayofweek.nunique() >= 5 and len(historical) >= 14 and len(recent) >= 7:
            historical_weekdays = historical.groupby(historical.index.dayofweek).mean()
            recent_weekdays = recent.groupby(recent.index.dayofweek).mean()
            shared_weekdays = historical_weekdays.index.intersection(recent_weekdays.index)
            if len(shared_weekdays) >= 4:
                matched_historical = historical_weekdays.loc[shared_weekdays].mean()
                matched_recent = recent_weekdays.loc[shared_weekdays].mean()
                seasonal_guard = matched_historical > 0 and matched_recent / matched_historical >= 0.90
                if seasonal_guard:
                    decline_rate *= 0.5
                    persistence *= 0.5
        score = 0.0
        if sufficient:
            low_velocity = max(0.0, min(1.0, 1 - recent_average / max(historical_average, 1.0))) if historical_average > 0 else 0.0
            negative_trend = max(0.0, min(1.0, -slope / max(historical_average * 0.1, 1.0)))
            score = max(0.0, min(100.0, decline_rate * 45 + low_velocity * 20 + persistence * 20 + negative_trend * 15 + forecast_support))
        level = _risk_level(score, sufficient)
        explanation = (
            f"WHAT: Demand is {'weakening' if level not in {'Low', 'Insufficient Data'} else 'being monitored'}. "
            f"WHY: Recent demand is {decline_rate:.1%} below the historical average and the recent trend is {trend.lower()}. "
            f"WHEN: The analysis uses {observations} observations across {len(daily)} dated demand periods. "
            f"IMPACT: Continued replenishment may increase slow-moving inventory risk; this is a commercial demand signal, not a claim that the product is physically obsolete."
        )
        records.append(CommercialObsolescence(
            dataset_id=dataset.id,
            product_id=product_id,
            product_name=product_name,
            category=category,
            risk_score=round(score, 4),
            risk_level=level,
            recent_demand=recent_average,
            historical_demand=historical_average,
            decline_rate=decline_rate,
            recent_velocity=recent_velocity,
            trend=trend,
            observations=observations,
            explanation=explanation,
            suggested_action=_action(level, has_inventory_data),
            **forecast,
        ))
    db.add_all(records)
    db.commit()
    for record in records:
        db.refresh(record)
    return records