from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import CurrentUser, get_dataset_for_user
from app.models import Alert, Dataset, Forecast, ModelRun
from app.schemas.requests import AlertGenerateRequest
from app.services.analytics_service import generate_alerts

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


def _serialize(alert: Alert, dataset: Dataset | None = None, forecast: Forecast | None = None, run: ModelRun | None = None) -> dict:
    return {
        "id": alert.id,
        "forecast_id": alert.forecast_id,
        "dataset_id": alert.dataset_id,
        "dataset_name": dataset.original_filename if dataset else None,
        "model_run_id": run.id if run else None,
        "model_name": run.model_name if run else None,
        "product_id": _product_from_alert(alert),
        "alert_type": alert.alert_type,
        "severity": alert.severity,
        "title": alert.title,
        "what": alert.what,
        "why": alert.why,
        "when_text": alert.when_text,
        "impact": alert.impact,
        "suggested_action": alert.suggested_action,
        "is_resolved": alert.is_resolved,
        "created_at": alert.created_at.isoformat() if alert.created_at else None,
        "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
        "forecast": {
            "forecast_date": forecast.forecast_date.isoformat(),
            "predicted_demand": forecast.predicted_demand,
            "lower_bound": forecast.lower_bound,
            "upper_bound": forecast.upper_bound,
            "confidence_level": forecast.confidence_level,
        } if forecast else None,
    }


def _product_from_alert(alert: Alert) -> str | None:
    title = alert.title
    prefixes = ("Potential obsolescence risk for ", "Potential demand recovery for ", "Forecast uncertainty is high for ", "Unusual demand movement detected for ", "Strong historical relationship: ")
    for prefix in prefixes:
        if title.startswith(prefix):
            return title.removeprefix(prefix).split(" and ")[0]
    if " may face stockout risk" in title:
        return title.removesuffix(" may face stockout risk")
    return None


def _rows(db: Session, user_id: int, alert_type: str | None, severity: str | None, is_resolved: bool | None, dataset_id: int | None):
    query = (
        db.query(Alert, Dataset, Forecast, ModelRun)
        .outerjoin(Dataset, Alert.dataset_id == Dataset.id)
        .outerjoin(Forecast, Alert.forecast_id == Forecast.id)
        .outerjoin(ModelRun, Forecast.model_run_id == ModelRun.id)
        .filter(Dataset.user_id == user_id)
    )
    if alert_type:
        query = query.filter(Alert.alert_type == alert_type)
    if severity:
        query = query.filter(Alert.severity == severity.upper())
    if is_resolved is not None:
        query = query.filter(Alert.is_resolved == is_resolved)
    if dataset_id is not None:
        query = query.filter(Alert.dataset_id == dataset_id)
    return query.order_by(Alert.created_at.desc()).all()


@router.get("/summary")
def alert_summary(
    user: CurrentUser,
    db: Session = Depends(get_db),
    dataset_id: int | None = None,
):
    alerts = [row[0] for row in _rows(db, user.id, None, None, None, dataset_id)]
    return {
        "total_alerts": len(alerts),
        "high_severity": sum(alert.severity == "HIGH" for alert in alerts),
        "medium_severity": sum(alert.severity == "MEDIUM" for alert in alerts),
        "low_severity": sum(alert.severity == "LOW" for alert in alerts),
        "unresolved": sum(not alert.is_resolved for alert in alerts),
        "resolved": sum(alert.is_resolved for alert in alerts),
    }


@router.get("")
def list_alerts(
    user: CurrentUser,
    db: Session = Depends(get_db),
    alert_type: str | None = None,
    severity: str | None = None,
    is_resolved: bool | None = None,
    dataset_id: int | None = None,
):
    return [_serialize(alert, dataset, forecast, run) for alert, dataset, forecast, run in _rows(db, user.id, alert_type, severity, is_resolved, dataset_id)]


@router.post("/generate")
def create_alerts(
    request: AlertGenerateRequest,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    run = db.get(ModelRun, request.model_run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model run not found.")
    if run.status != "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Alerts require a completed model run.")
    dataset = db.get(Dataset, run.dataset_id)
    forecasts = db.query(Forecast).filter(Forecast.model_run_id == run.id).order_by(Forecast.forecast_date.asc()).all()
    if dataset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The model dataset was not found.")
    if dataset.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The model dataset was not found.")
    if not forecasts:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Generate forecasts before generating alerts.")
    alerts = generate_alerts(db, run, dataset, forecasts)
    return {"model_run_id": run.id, "dataset_id": dataset.id, "generated_count": len(alerts), "alerts": [_serialize(alert, dataset) for alert in alerts]}


@router.get("/{alert_id}")
def get_alert(
    alert_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    row = (
        db.query(Alert, Dataset, Forecast, ModelRun)
        .outerjoin(Dataset, Alert.dataset_id == Dataset.id)
        .outerjoin(Forecast, Alert.forecast_id == Forecast.id)
        .outerjoin(ModelRun, Forecast.model_run_id == ModelRun.id)
        .filter(Alert.id == alert_id, Dataset.user_id == user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found.")
    return _serialize(*row)


@router.patch("/{alert_id}/resolve")
def resolve_alert(
    alert_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    alert = db.query(Alert).join(Dataset, Alert.dataset_id == Dataset.id).filter(Alert.id == alert_id, Dataset.user_id == user.id).first()
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found.")
    alert.is_resolved = True
    alert.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(alert)
    return {"id": alert.id, "is_resolved": alert.is_resolved, "resolved_at": alert.resolved_at.isoformat()}
