from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import CurrentUser, get_dataset_for_user
from app.models import Dataset, Forecast, ModelRun
from app.schemas.requests import ForecastGenerateRequest
from app.services.dataset_service import read_dataset
from app.services.model_service import generate_forecasts
from app.services.analytics_service import generate_alerts, generate_recommendations
from app.services.dependency_service import detect_columns, product_identity_map

router = APIRouter(prefix="/api/forecasts", tags=["forecasts"])


def _serialize(
    record: Forecast,
    run: ModelRun | None = None,
    dataset: Dataset | None = None,
    product_names: dict[str, str] | None = None,
) -> dict:
    return {
        "id": record.id,
        "model_run_id": record.model_run_id,
        "dataset_id": run.dataset_id if run else None,
        "dataset_name": dataset.original_filename if dataset else None,
        "model_name": run.model_name if run else None,
        "product_id": record.product_id,
        "product_name": (product_names or {}).get(record.product_id, "Name unavailable"),
        "forecast_date": record.forecast_date.isoformat(),
        "predicted_demand": record.predicted_demand,
        "lower_bound": record.lower_bound,
        "upper_bound": record.upper_bound,
        "confidence_level": record.confidence_level,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


def _product_names(dataset: Dataset) -> dict[str, str]:
    dataframe = read_dataset(dataset)
    identities = product_identity_map(dataframe, detect_columns(dataframe)["product"])
    return {
        key: identity.get("product_name", "Name unavailable")
        for key, identity in identities.items()
        if identity.get("product_name") not in {None, "Name unavailable"}
    }


def _filtered_query(
    db: Session,
    user_id: int,
    model_run_id: int | None = None,
    dataset_id: int | None = None,
    product_id: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
):
    query = (
        db.query(Forecast, ModelRun, Dataset)
        .join(ModelRun, Forecast.model_run_id == ModelRun.id)
        .join(Dataset, ModelRun.dataset_id == Dataset.id)
        .filter(Dataset.user_id == user_id)
    )
    if model_run_id is not None:
        query = query.filter(Forecast.model_run_id == model_run_id)
    if dataset_id is not None:
        query = query.filter(ModelRun.dataset_id == dataset_id)
    if product_id is not None:
        query = query.filter(Forecast.product_id == product_id)
    if start_date is not None:
        query = query.filter(Forecast.forecast_date >= start_date)
    if end_date is not None:
        query = query.filter(Forecast.forecast_date <= end_date)
    return query.order_by(Forecast.forecast_date.asc(), Forecast.product_id.asc())


@router.get("/summary")
def forecast_summary(
    user: CurrentUser,
    db: Session = Depends(get_db),
    model_run_id: int | None = None,
    dataset_id: int | None = None,
    product_id: str | None = None,
):
    records = _filtered_query(db, user.id, model_run_id, dataset_id, product_id).all()
    if not records:
        return {"forecast_horizon": 0, "total_predicted_demand": 0, "average_predicted_demand": 0, "minimum_predicted_demand": 0, "maximum_predicted_demand": 0, "latest_forecast_date": None, "model_used": None, "dataset_name": None}
    values = [record.predicted_demand for record, _, _ in records]
    first_run = records[0][1]
    return {
        "forecast_horizon": len({record.forecast_date for record, _, _ in records}),
        "total_predicted_demand": sum(values),
        "average_predicted_demand": sum(values) / len(values),
        "minimum_predicted_demand": min(values),
        "maximum_predicted_demand": max(values),
        "latest_forecast_date": max(record.forecast_date for record, _, _ in records).isoformat(),
        "model_used": first_run.model_name,
        "dataset_name": records[0][2].original_filename,
    }


@router.get("/history")
def forecast_history(
    user: CurrentUser,
    db: Session = Depends(get_db),
    dataset_id: int | None = None,
):
    query = (
        db.query(Forecast, ModelRun, Dataset)
        .join(ModelRun, Forecast.model_run_id == ModelRun.id)
        .join(Dataset, ModelRun.dataset_id == Dataset.id)
        .filter(Dataset.user_id == user.id, ModelRun.status == "completed")
    )
    if dataset_id is not None:
        query = query.filter(ModelRun.dataset_id == dataset_id)
    rows = query.all()
    grouped = {}
    for record, run, dataset in rows:
        item = grouped.setdefault(run.id, {"model_run_id": run.id, "dataset_id": dataset.id, "dataset_name": dataset.original_filename, "model_name": run.model_name, "generation_date": record.created_at.isoformat() if record.created_at else None, "horizon": 0, "forecast_count": 0, "forecast_dates": set(), "status": "completed"})
        item["forecast_count"] += 1
        item["forecast_dates"].add(record.forecast_date)
    for item in grouped.values():
        item["horizon"] = len(item.pop("forecast_dates"))
    return list(grouped.values())


@router.get("")
def list_forecasts(
    user: CurrentUser,
    db: Session = Depends(get_db),
    model_run_id: int | None = None,
    dataset_id: int | None = None,
    product_id: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
):
    records = _filtered_query(db, user.id, model_run_id, dataset_id, product_id, start_date, end_date).all()
    names_by_dataset = {dataset.id: _product_names(dataset) for _, _, dataset in records}
    return [_serialize(record, run, dataset, names_by_dataset.get(dataset.id)) for record, run, dataset in records]


@router.post("/generate")
def create_forecast(
    request: ForecastGenerateRequest,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    run = db.get(ModelRun, request.model_run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model run not found.")
    if run.status != "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Forecasts require a completed model run.")
    if request.dataset_id is not None and request.dataset_id != run.dataset_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The selected dataset does not match the selected model run.")
    dataset = db.get(Dataset, run.dataset_id)
    if dataset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The model dataset was not found.")
    if dataset.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The model dataset was not found.")
    records = generate_forecasts(db, run, dataset, request.forecast_horizon)
    generate_alerts(db, run, dataset, records)
    generate_recommendations(db, run, dataset, records)
    product_names = _product_names(dataset)
    return {"model_run_id": run.id, "dataset_id": dataset.id, "model_name": run.model_name, "forecast_horizon": request.forecast_horizon, "forecasts": [_serialize(record, run, dataset, product_names) for record in records]}


@router.get("/{forecast_id}")
def get_forecast(
    forecast_id: int,
    dataset_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    row = (
        db.query(Forecast, ModelRun, Dataset)
        .join(ModelRun, Forecast.model_run_id == ModelRun.id)
        .join(Dataset, ModelRun.dataset_id == Dataset.id)
        .filter(Forecast.id == forecast_id, ModelRun.dataset_id == dataset_id, Dataset.user_id == user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Forecast not found.")
    return _serialize(*row)
