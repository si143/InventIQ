from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Alert, Dataset, Forecast, ModelRun, Recommendation
from app.services.dataset_service import read_dataset

UNCERTAINTY_WARNING_RATIO = 0.45
UNCERTAINTY_HIGH_RATIO = 1.0
DECLINE_WARNING_RATIO = 0.80
DECLINE_HIGH_RATIO = 0.60
SHOCK_WARNING_Z = 2.5
SHOCK_HIGH_Z = 3.5
RECOVERY_WARNING_RATIO = 1.20
DEPENDENCY_CORRELATION = 0.85
MIN_TREND_POINTS = 6
INVENTORY_HIGH_RATIO = 2.0

ALERT_INVENTORY_NAMES = {
    "inventory", "stock", "current stock", "available stock", "quantity",
    "inventory level", "stock level", "on hand", "on_hand", "stock qty",
}
RECOMMENDATION_INVENTORY_NAMES = {
    "inventory", "stock", "current stock", "available stock", "quantity",
    "inventory level", "stock level", "on hand", "stock qty",
}


@dataclass
class AlertCandidate:
    alert_type: str
    severity: str
    title: str
    what: str
    why: str
    when_text: str
    impact: str
    suggested_action: str
    forecast_id: int | None = None


@dataclass
class RecommendationCandidate:
    recommendation_type: str
    priority: str
    title: str
    product_id: str | None
    what: str
    why: str
    when_text: str
    impact: str
    suggested_action: str
    estimated_quantity: float | None = None
    forecast_id: int | None = None
    alert_id: int | None = None


def _normalise(value: str) -> str:
    return " ".join(str(value).strip().lower().replace("_", " ").split())


def _parameters(run: ModelRun) -> dict[str, Any]:
    try:
        return json.loads(run.parameters or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The model configuration is invalid.") from exc


def _product_name(value: Any) -> str:
    return str(value) if value is not None and not pd.isna(value) else "ALL"


def _add_candidate(candidates: list[AlertCandidate], candidate: AlertCandidate) -> None:
    if not any(item.alert_type == candidate.alert_type and item.title == candidate.title for item in candidates):
        candidates.append(candidate)


def _historical_frame(dataframe: pd.DataFrame, parameters: dict[str, Any]) -> tuple[pd.DataFrame, str, str | None, str | None]:
    target = parameters.get("target_column")
    date_column = parameters.get("date_column")
    product_column = parameters.get("product_column")
    if not target or target not in dataframe.columns:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The configured target column is unavailable for alert analysis.")
    frame = dataframe.copy()
    frame["_alert_target"] = pd.to_numeric(frame[target], errors="coerce")
    if date_column and date_column in frame.columns:
        frame["_alert_date"] = pd.to_datetime(frame[date_column], errors="coerce")
    else:
        frame["_alert_date"] = pd.NaT
    frame = frame.dropna(subset=["_alert_target"]).sort_values("_alert_date")
    if frame.empty:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No usable historical demand values were found for alert analysis.")
    return frame, target, date_column, product_column if product_column in frame.columns else None


def _group_values(frame: pd.DataFrame, product_column: str | None) -> dict[str, pd.Series]:
    if product_column:
        return {_product_name(product): group["_alert_target"] for product, group in frame.groupby(product_column, dropna=False)}
    return {"ALL": frame["_alert_target"]}


def _generate_candidates(frame: pd.DataFrame, forecasts: list[Forecast], run: ModelRun, parameters: dict[str, Any]) -> list[AlertCandidate]:
    candidates: list[AlertCandidate] = []
    product_column = parameters.get("product_column") if parameters.get("product_column") in frame.columns else None
    groups = _group_values(frame, product_column)
    forecast_groups: dict[str, list[Forecast]] = {}
    for record in forecasts:
        forecast_groups.setdefault(record.product_id or "ALL", []).append(record)

    inventory_column = next((column for column in frame.columns if _normalise(column) in ALERT_INVENTORY_NAMES), None)
    if inventory_column and product_column:
        latest_inventory = frame.sort_values("_alert_date").groupby(product_column, dropna=False)[inventory_column].last()
        for product, product_forecasts in forecast_groups.items():
            if product == "ALL" or product not in latest_inventory.index:
                continue
            available = pd.to_numeric(latest_inventory.loc[product], errors="coerce")
            demand = sum(max(float(item.predicted_demand), 0.0) for item in product_forecasts)
            if pd.notna(available) and available >= 0 and demand > float(available):
                ratio = demand / max(float(available), 1.0)
                severity = "HIGH" if ratio >= 1.5 else "MEDIUM"
                first_forecast = min(product_forecasts, key=lambda item: item.forecast_date)
                _add_candidate(candidates, AlertCandidate(
                    "STOCKOUT RISK", severity, f"{product} may face stockout risk",
                    f"Forecasted demand may exceed available stock for {product}.",
                    f"Forecasted demand is {demand:.1f} units versus {float(available):.1f} units available.",
                    f"Within the next {len(product_forecasts)} days.",
                    "Potential inventory shortage and lost sales if demand follows the forecast.",
                    "Review replenishment quantity and supplier lead time.", first_forecast.id,
                ))

    for product, product_forecasts in forecast_groups.items():
        if not product_forecasts:
            continue
        predicted = np.array([max(float(item.predicted_demand), 0.0) for item in product_forecasts])
        widths = np.array([max(float(item.upper_bound or 0) - float(item.lower_bound or 0), 0.0) for item in product_forecasts])
        ratio = float(np.mean(widths) / max(np.mean(predicted), 1.0))
        if ratio >= UNCERTAINTY_WARNING_RATIO:
            severity = "HIGH" if ratio >= UNCERTAINTY_HIGH_RATIO else "MEDIUM"
            _add_candidate(candidates, AlertCandidate(
                "DEMAND UNCERTAINTY", severity, f"Forecast uncertainty is high for {product}",
                f"The forecast range is wide relative to expected demand for {product}.",
                f"The average uncertainty width is {ratio:.1%} of predicted demand.",
                "Upcoming forecast period.",
                "Inventory planning may have higher-than-normal demand uncertainty.",
                "Consider safety stock and monitor demand closely.", product_forecasts[0].id,
            ))

    for product, values in groups.items():
        values = values.dropna().astype(float)
        if len(values) < MIN_TREND_POINTS:
            continue
        window = max(3, len(values) // 3)
        previous = float(values.iloc[-2 * window:-window].mean())
        recent = float(values.iloc[-window:].mean())
        if previous > 0 and recent < previous * DECLINE_WARNING_RATIO:
            decline = 1 - recent / previous
            severity = "HIGH" if decline >= 1 - DECLINE_HIGH_RATIO else "MEDIUM"
            _add_candidate(candidates, AlertCandidate(
                "OBSOLESCENCE RISK", severity, f"Potential obsolescence risk for {product}",
                f"{product} demand is showing signs of commercial decline.",
                f"Recent average demand ({recent:.1f}) is {decline:.1%} lower than the previous period ({previous:.1f}).",
                "Current trend and upcoming forecast period.",
                "Potential excess inventory and reduced inventory turnover.",
                "Review replenishment plans and consider reducing future purchasing.",
            ))

        if len(values) >= MIN_TREND_POINTS * 2:
            older = float(values.iloc[-3 * window:-2 * window].mean())
            if older > 0 and recent > previous * RECOVERY_WARNING_RATIO and previous < older * DECLINE_WARNING_RATIO:
                _add_candidate(candidates, AlertCandidate(
                    "RECOVERY OPPORTUNITY", "MEDIUM", f"Potential demand recovery for {product}",
                    f"A demand recovery signal has appeared for {product}.",
                    f"Recent demand increased {recent / max(previous, 1):.1f}x after a prior decline.",
                    "Current and recent historical period.",
                    "Inventory requirements may change if the recovery continues.",
                    "Review replenishment plans and monitor whether the recovery continues.",
                ))

        if len(values) >= MIN_TREND_POINTS * 2:
            baseline = values.iloc[:-3]
            recent_window = values.iloc[-3:]
            mean = float(baseline.mean())
            std = float(baseline.std(ddof=0))
            recent_mean = float(recent_window.mean())
            z_score = abs(recent_mean - mean) / std if std > 0 else 0
            percentage_change = abs(recent_mean - mean) / max(abs(mean), 1.0)
            if z_score >= SHOCK_WARNING_Z and percentage_change >= 0.30:
                severity = "HIGH" if z_score >= SHOCK_HIGH_Z else "MEDIUM"
                _add_candidate(candidates, AlertCandidate(
                    "SHOCK RISK", severity, f"Unusual demand movement detected for {product}",
                    f"Recent demand differs significantly from the historical pattern for {product}.",
                    f"The recent average is {percentage_change:.1%} from baseline with a z-score of {z_score:.1f}.",
                    "Recent historical period and upcoming planning period.",
                    "Forecast accuracy and inventory planning may be affected.",
                    "Review recent demand drivers and monitor upcoming sales closely.",
                ))

    if product_column and len(groups) >= 2:
        pivot = frame.assign(_product=frame[product_column].map(_product_name)).pivot_table(index="_alert_date", columns="_product", values="_alert_target", aggfunc="mean").dropna(axis=1, thresh=MIN_TREND_POINTS)
        if len(pivot) >= MIN_TREND_POINTS:
            correlation = pivot.corr()
            for left_index, left in enumerate(correlation.columns):
                for right in correlation.columns[left_index + 1:]:
                    value = correlation.loc[left, right]
                    if pd.notna(value) and abs(float(value)) >= DEPENDENCY_CORRELATION:
                        severity = "MEDIUM" if abs(float(value)) >= 0.93 else "LOW"
                        _add_candidate(candidates, AlertCandidate(
                            "DEPENDENCY RISK", severity, f"Strong historical relationship: {left} and {right}",
                            f"{left} shows a strong historical demand relationship with {right}.",
                            f"Historical demand movements have a correlation of {float(value):.2f}; this indicates association, not causation.",
                            "Based on the available historical data.",
                            "Changes in one product may be useful as an indicator when monitoring the related product.",
                            "Monitor related product demand when planning inventory.",
                        ))
    return candidates


def generate_alerts(db: Session, run: ModelRun, dataset: Dataset, forecasts: list[Forecast]) -> list[Alert]:
    if not forecasts:
        return []
    parameters = _parameters(run)
    frame, _, _, _ = _historical_frame(read_dataset(dataset), parameters)
    candidates = _generate_candidates(frame, forecasts, run, parameters)
    existing = {(item.alert_type, item.title): item for item in db.query(Alert).filter(Alert.dataset_id == dataset.id).all()}
    records = []
    for candidate in candidates:
        key = (candidate.alert_type, candidate.title)
        record = existing.get(key)
        if record is None:
            record = Alert(
                forecast_id=candidate.forecast_id,
                dataset_id=dataset.id,
                alert_type=candidate.alert_type,
                severity=candidate.severity,
                title=candidate.title,
                what=candidate.what,
                why=candidate.why,
                when_text=candidate.when_text,
                impact=candidate.impact,
                suggested_action=candidate.suggested_action,
            )
            db.add(record)
        else:
            record.forecast_id = candidate.forecast_id
            record.severity = candidate.severity
            record.what = candidate.what
            record.why = candidate.why
            record.when_text = candidate.when_text
            record.impact = candidate.impact
            record.suggested_action = candidate.suggested_action
        records.append(record)
    db.commit()
    for record in records:
        db.refresh(record)
    return records


def _product_from_alert(alert: Alert, forecasts_by_id: dict[int, Forecast]) -> str | None:
    if alert.forecast_id and alert.forecast_id in forecasts_by_id:
        return forecasts_by_id[alert.forecast_id].product_id
    title = alert.title
    prefixes = (
        "Potential obsolescence risk for ", "Potential demand recovery for ",
        "Forecast uncertainty is high for ", "Unusual demand movement detected for ",
        "Strong historical relationship: ",
    )
    for prefix in prefixes:
        if title.startswith(prefix):
            return title.removeprefix(prefix).split(" and ")[0]
    if " may face stockout risk" in title:
        return title.removesuffix(" may face stockout risk")
    return None


def _add_recommendation(candidates: list[RecommendationCandidate], candidate: RecommendationCandidate) -> None:
    if not any(item.recommendation_type == candidate.recommendation_type and item.product_id == candidate.product_id for item in candidates):
        candidates.append(candidate)


def _build_recommendation_candidates(dataframe: pd.DataFrame, forecasts: list[Forecast], alerts: list[Alert], run: ModelRun) -> list[RecommendationCandidate]:
    parameters = _parameters(run)
    target_column = parameters.get("target_column")
    product_column = parameters.get("product_column")
    if not target_column or target_column not in dataframe.columns:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The configured target column is unavailable for recommendations.")
    frame = dataframe.copy()
    frame["_recommendation_demand"] = pd.to_numeric(frame[target_column], errors="coerce")
    frame["_recommendation_date"] = pd.to_datetime(frame[parameters.get("date_column")], errors="coerce") if parameters.get("date_column") in frame.columns else pd.NaT
    frame = frame.dropna(subset=["_recommendation_demand"])
    if frame.empty:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No usable demand history is available for recommendations.")

    inventory_column = next((column for column in frame.columns if _normalise(column) in RECOMMENDATION_INVENTORY_NAMES), None)
    inventory_by_product: dict[str, float] = {}
    if inventory_column and product_column and product_column in frame.columns:
        latest = frame.sort_values("_recommendation_date").groupby(product_column, dropna=False)[inventory_column].last()
        inventory_by_product = {str(product): float(value) for product, value in latest.items() if pd.notna(pd.to_numeric(value, errors="coerce"))}

    forecasts_by_product: dict[str, list[Forecast]] = {}
    forecasts_by_id = {forecast.id: forecast for forecast in forecasts}
    for forecast in forecasts:
        forecasts_by_product.setdefault(forecast.product_id or "ALL", []).append(forecast)
    candidates: list[RecommendationCandidate] = []
    inventory_note = "Inventory quantity is unavailable. Recommendation is based on forecast and demand trends only."

    for product, product_forecasts in forecasts_by_product.items():
        if not product_forecasts:
            continue
        demand = sum(max(float(forecast.predicted_demand), 0.0) for forecast in product_forecasts)
        widths = [max(float(forecast.upper_bound or 0) - float(forecast.lower_bound or 0), 0.0) for forecast in product_forecasts]
        uncertainty_width = float(np.mean(widths)) if widths else 0.0
        uncertainty_ratio = uncertainty_width / max(demand / len(product_forecasts), 1.0)
        available = inventory_by_product.get(product)
        first_forecast = min(product_forecasts, key=lambda item: item.forecast_date)

        if available is not None and product != "ALL" and demand > available:
            shortfall = demand - available
            priority = "HIGH" if demand / max(available, 1.0) >= 1.5 else "MEDIUM"
            _add_recommendation(candidates, RecommendationCandidate(
                "REORDER RECOMMENDATION", priority, f"Review replenishment for {product}", product,
                "Forecast demand may exceed available inventory.",
                f"Forecast demand is {demand:.1f} units versus current inventory of {available:.1f} units.",
                f"Across the next {len(product_forecasts)} forecast days.",
                "Potential inventory shortage if demand follows the forecast.",
                f"Review replenishment for approximately {shortfall:.1f} units. This is an estimate, not an exact optimal order quantity.",
                shortfall, first_forecast.id,
            ))

        if uncertainty_ratio >= UNCERTAINTY_WARNING_RATIO:
            priority = "HIGH" if uncertainty_ratio >= UNCERTAINTY_HIGH_RATIO else "MEDIUM"
            if available is not None and product != "ALL":
                estimated = uncertainty_width / 2
                _add_recommendation(candidates, RecommendationCandidate(
                    "SAFETY STOCK RECOMMENDATION", priority, f"Consider safety-stock protection for {product}", product,
                    "Forecast uncertainty indicates additional inventory protection may be useful.",
                    f"The average forecast interval width is {uncertainty_ratio:.1%} of average predicted demand.",
                    f"Across the next {len(product_forecasts)} forecast days.",
                    "Demand variability may increase the chance of service-level pressure.",
                    f"Consider an estimated {estimated:.1f} units of safety-stock protection. This is not an optimized safety-stock quantity.",
                    estimated, first_forecast.id,
                ))
            _add_recommendation(candidates, RecommendationCandidate(
                "MONITOR DEMAND", priority, f"Monitor demand closely for {product}", product,
                "Forecast uncertainty is high relative to expected demand.",
                f"The average uncertainty width is {uncertainty_ratio:.1%} of average predicted demand. {inventory_note if available is None else ''}".strip(),
                "Upcoming forecast period.",
                "Planning decisions may be more sensitive to new demand observations.",
                "Monitor demand closely and update inventory plans as new sales arrive.",
                forecast_id=first_forecast.id,
            ))

    alerts_by_type = {}
    for alert in alerts:
        alerts_by_type.setdefault(alert.alert_type, []).append(alert)
    for alert_type, alert_items in alerts_by_type.items():
        for alert in alert_items:
            product = _product_from_alert(alert, forecasts_by_id)
            linked_forecast = forecasts_by_id.get(alert.forecast_id) if alert.forecast_id else None
            priority = alert.severity if alert.severity in {"HIGH", "MEDIUM", "LOW"} else "MEDIUM"
            common = {
                "alert_id": alert.id,
                "forecast_id": linked_forecast.id if linked_forecast else None,
            }
            if alert_type == "OBSOLESCENCE RISK":
                _add_recommendation(candidates, RecommendationCandidate("SLOW MOVING PRODUCT", priority, f"Review slow-moving product {product or 'ALL'}", product, "Demand is showing a persistent decline signal.", alert.why, alert.when_text, "Potential excess inventory and reduced inventory turnover.", "Review replenishment frequency and inventory holding strategy.", **common))
                _add_recommendation(candidates, RecommendationCandidate("REDUCE REPLENISHMENT", priority, f"Consider reducing replenishment for {product or 'ALL'}", product, "Recent demand has declined compared with the previous period.", alert.why, alert.when_text, "Continuing prior replenishment levels may increase excess inventory risk.", "Consider reducing future replenishment while monitoring the demand trend.", **common))
            elif alert_type == "RECOVERY OPPORTUNITY":
                _add_recommendation(candidates, RecommendationCandidate("DEMAND RECOVERY", priority, f"Monitor demand recovery for {product or 'ALL'}", product, "A demand recovery signal has appeared after a previous decline.", alert.why, alert.when_text, "Inventory requirements may change if the recovery continues.", "Monitor whether the recovery continues before making major replenishment changes.", **common))
            elif alert_type == "DEPENDENCY RISK":
                _add_recommendation(candidates, RecommendationCandidate("SUPPLIER / DEPENDENCY REVIEW", priority, alert.title, product, "A strong historical relationship was detected between products.", alert.why, alert.when_text, "Related product movement may affect inventory planning signals.", "Monitor related product demand when planning inventory; this relationship does not prove causation.", **common))
            elif alert_type == "SHOCK RISK":
                _add_recommendation(candidates, RecommendationCandidate("SHOCK RESPONSE", priority, f"Review demand shock for {product or 'ALL'}", product, "An unusual demand movement was detected.", alert.why, alert.when_text, "Forecast accuracy and inventory planning may be affected.", "Review recent demand changes and temporarily monitor inventory requirements.", **common))
            elif alert_type == "DEMAND UNCERTAINTY" and not any(item.recommendation_type == "MONITOR DEMAND" and item.product_id == product for item in candidates):
                _add_recommendation(candidates, RecommendationCandidate("MONITOR DEMAND", priority, f"Monitor demand closely for {product or 'ALL'}", product, "Forecast uncertainty is high.", alert.why, alert.when_text, alert.impact, "Monitor demand closely and update plans as new sales arrive.", **common))
    return candidates


def generate_recommendations(db: Session, run: ModelRun, dataset: Dataset, forecasts: list[Forecast], alerts: list[Alert] | None = None) -> list[Recommendation]:
    if not forecasts:
        return []
    dataframe = read_dataset(dataset)
    if alerts is None:
        alerts = db.query(Alert).filter(Alert.dataset_id == dataset.id).all()
    candidates = _build_recommendation_candidates(dataframe, forecasts, alerts, run)
    existing = {(item.recommendation_type, item.product_id): item for item in db.query(Recommendation).filter(Recommendation.dataset_id == dataset.id).all()}
    records = []
    for candidate in candidates:
        key = (candidate.recommendation_type, candidate.product_id)
        record = existing.get(key)
        if record is None:
            record = Recommendation(dataset_id=dataset.id, recommendation_type=candidate.recommendation_type, priority=candidate.priority, title=candidate.title, product_id=candidate.product_id, what=candidate.what, why=candidate.why, when_text=candidate.when_text, impact=candidate.impact, suggested_action=candidate.suggested_action, estimated_quantity=candidate.estimated_quantity, forecast_id=candidate.forecast_id, alert_id=candidate.alert_id)
            db.add(record)
        elif record.status == "open":
            record.priority = candidate.priority
            record.what = candidate.what
            record.why = candidate.why
            record.when_text = candidate.when_text
            record.impact = candidate.impact
            record.suggested_action = candidate.suggested_action
            record.estimated_quantity = candidate.estimated_quantity
            record.forecast_id = candidate.forecast_id
            record.alert_id = candidate.alert_id
        records.append(record)
    db.commit()
    for record in records:
        db.refresh(record)
    return records