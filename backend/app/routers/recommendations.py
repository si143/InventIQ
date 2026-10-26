from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import CurrentUser, get_dataset_for_user
from app.models import Alert, Dataset, Forecast, ModelRun, Recommendation
from app.schemas.requests import RecommendationGenerateRequest
from app.services.analytics_service import generate_recommendations

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


def _serialize(recommendation: Recommendation, dataset: Dataset | None = None, forecast: Forecast | None = None, alert: Alert | None = None, run: ModelRun | None = None) -> dict:
    return {
        "id": recommendation.id,
        "dataset_id": recommendation.dataset_id,
        "dataset_name": dataset.original_filename if dataset else None,
        "forecast_id": recommendation.forecast_id,
        "alert_id": recommendation.alert_id,
        "model_run_id": run.id if run else None,
        "model_name": run.model_name if run else None,
        "product_id": recommendation.product_id,
        "recommendation_type": recommendation.recommendation_type,
        "priority": recommendation.priority,
        "title": recommendation.title,
        "what": recommendation.what,
        "why": recommendation.why,
        "when_text": recommendation.when_text,
        "impact": recommendation.impact,
        "suggested_action": recommendation.suggested_action,
        "estimated_quantity": recommendation.estimated_quantity,
        "estimated_quantity_note": "Estimated — not an exact optimal order quantity" if recommendation.estimated_quantity is not None else None,
        "status": recommendation.status,
        "created_at": recommendation.created_at.isoformat() if recommendation.created_at else None,
        "completed_at": recommendation.completed_at.isoformat() if recommendation.completed_at else None,
        "forecast": {
            "forecast_date": forecast.forecast_date.isoformat(),
            "predicted_demand": forecast.predicted_demand,
            "lower_bound": forecast.lower_bound,
            "upper_bound": forecast.upper_bound,
        } if forecast else None,
        "alert": {"id": alert.id, "alert_type": alert.alert_type, "title": alert.title, "severity": alert.severity} if alert else None,
    }


def _rows(db: Session, user_id: int, dataset_id: int | None = None, product_id: str | None = None, recommendation_type: str | None = None, priority: str | None = None, recommendation_status: str | None = None, alert_id: int | None = None):
    query = (
        db.query(Recommendation, Dataset, Forecast, Alert, ModelRun)
        .join(Dataset, Recommendation.dataset_id == Dataset.id)
        .outerjoin(Forecast, Recommendation.forecast_id == Forecast.id)
        .outerjoin(Alert, Recommendation.alert_id == Alert.id)
        .outerjoin(ModelRun, Forecast.model_run_id == ModelRun.id)
        .filter(Dataset.user_id == user_id)
    )
    if dataset_id is not None:
        query = query.filter(Recommendation.dataset_id == dataset_id)
    if product_id:
        query = query.filter(Recommendation.product_id == product_id)
    if recommendation_type:
        query = query.filter(Recommendation.recommendation_type == recommendation_type)
    if priority:
        query = query.filter(Recommendation.priority == priority.upper())
    if recommendation_status:
        query = query.filter(Recommendation.status == recommendation_status.lower())
    if alert_id is not None:
        query = query.filter(Recommendation.alert_id == alert_id)
    return query.order_by(Recommendation.created_at.desc()).all()


@router.get("/summary")
def recommendation_summary(
    user: CurrentUser,
    db: Session = Depends(get_db),
    dataset_id: int | None = None,
):
    records = [row[0] for row in _rows(db, user.id, dataset_id=dataset_id)]
    return {
        "total_recommendations": len(records),
        "high_priority": sum(record.priority == "HIGH" for record in records),
        "medium_priority": sum(record.priority == "MEDIUM" for record in records),
        "low_priority": sum(record.priority == "LOW" for record in records),
        "open": sum(record.status == "open" for record in records),
        "completed": sum(record.status == "completed" for record in records),
    }


@router.get("")
def list_recommendations(
    user: CurrentUser,
    db: Session = Depends(get_db),
    dataset_id: int | None = None,
    product_id: str | None = None,
    recommendation_type: str | None = None,
    priority: str | None = None,
    recommendation_status: str | None = None,
    alert_id: int | None = None,
):
    return [_serialize(recommendation, dataset, forecast, alert, run) for recommendation, dataset, forecast, alert, run in _rows(db, user.id, dataset_id, product_id, recommendation_type, priority, recommendation_status, alert_id)]


@router.post("/generate")
def create_recommendations(
    request: RecommendationGenerateRequest,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    run = db.get(ModelRun, request.model_run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model run not found.")
    if run.status != "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Recommendations require a completed model run.")
    dataset = db.get(Dataset, run.dataset_id)
    forecasts = db.query(Forecast).filter(Forecast.model_run_id == run.id).order_by(Forecast.forecast_date.asc()).all()
    if dataset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The model dataset was not found.")
    if dataset.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The model dataset was not found.")
    if not forecasts:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Generate forecasts before generating recommendations.")
    records = generate_recommendations(db, run, dataset, forecasts)
    return {"model_run_id": run.id, "dataset_id": dataset.id, "generated_count": len(records), "recommendations": [_serialize(record, dataset) for record in records]}


@router.get("/{recommendation_id}")
def get_recommendation(
    recommendation_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    row = (
        db.query(Recommendation, Dataset, Forecast, Alert, ModelRun)
        .join(Dataset, Recommendation.dataset_id == Dataset.id)
        .outerjoin(Forecast, Recommendation.forecast_id == Forecast.id)
        .outerjoin(Alert, Recommendation.alert_id == Alert.id)
        .outerjoin(ModelRun, Forecast.model_run_id == ModelRun.id)
        .filter(Recommendation.id == recommendation_id, Dataset.user_id == user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recommendation not found.")
    return _serialize(*row)


@router.patch("/{recommendation_id}/complete")
def complete_recommendation(
    recommendation_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    recommendation = db.query(Recommendation).join(Dataset, Recommendation.dataset_id == Dataset.id).filter(Recommendation.id == recommendation_id, Dataset.user_id == user.id).first()
    if recommendation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recommendation not found.")
    recommendation.status = "completed"
    recommendation.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(recommendation)
    return {"id": recommendation.id, "status": recommendation.status, "completed_at": recommendation.completed_at.isoformat()}
