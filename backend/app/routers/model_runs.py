from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import CurrentUser, get_dataset_for_user
from app.models import Dataset, ModelRun
from app.schemas.requests import ModelRunTrainRequest
from app.services.dataset_service import read_dataset
from app.services.model_service import MODEL_NAMES, train_and_evaluate

router = APIRouter(prefix="/api/model-runs", tags=["model-runs"])
logger = logging.getLogger(__name__)


def _serialize(run: ModelRun, dataset: Dataset | None = None) -> dict:
    try:
        parameters = json.loads(run.parameters) if run.parameters else None
    except json.JSONDecodeError:
        parameters = run.parameters
    return {
        "id": run.id,
        "dataset_id": run.dataset_id,
        "dataset_name": dataset.original_filename if dataset else None,
        "model_name": run.model_name,
        "model_type": run.model_type,
        "status": run.status,
        "mae": run.mae,
        "rmse": run.rmse,
        "r2_score": run.r2_score,
        "parameters": parameters,
        "artifact_path": run.artifact_path,
        "error_message": run.error_message,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "created_at": run.created_at.isoformat() if run.created_at else None,
    }


@router.get("")
def list_model_runs(
    user: CurrentUser,
    db: Session = Depends(get_db),
    dataset_id: int | None = None,
):
    query = db.query(ModelRun).join(Dataset, ModelRun.dataset_id == Dataset.id).filter(Dataset.user_id == user.id).order_by(ModelRun.id.desc())
    if dataset_id is not None:
        query = query.filter(ModelRun.dataset_id == dataset_id)
    runs = query.all()
    datasets = {dataset.id: dataset for dataset in db.query(Dataset).filter(Dataset.id.in_({run.dataset_id for run in runs})).all()} if runs else {}
    return [_serialize(run, datasets.get(run.dataset_id)) for run in runs]


@router.get("/{model_run_id}")
def get_model_run(
    model_run_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    run = db.query(ModelRun).join(Dataset, ModelRun.dataset_id == Dataset.id).filter(ModelRun.id == model_run_id, Dataset.user_id == user.id).first()
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model run not found.")
    return _serialize(run, db.get(Dataset, run.dataset_id))


@router.post("/train")
def train_model(
    request: ModelRunTrainRequest,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    if request.model_name not in MODEL_NAMES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported model selection.")
    dataset = db.get(Dataset, request.dataset_id)
    if dataset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found.")
    if dataset.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found.")

    started_at = datetime.now(timezone.utc)
    run = ModelRun(
        dataset_id=dataset.id,
        model_name=request.model_name,
        model_type="time_series" if request.model_name == "ARIMA" else "regression",
        status="training",
        started_at=started_at,
        parameters=json.dumps(request.model_dump()),
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        dataframe = read_dataset(dataset)
        result = train_and_evaluate(
            dataframe=dataframe,
            target_column=request.target_column,
            date_column=request.date_column,
            product_column=request.product_column,
            model_name=request.model_name,
            forecast_horizon=request.forecast_horizon,
            run_id=run.id,
        )
        run.model_name = result["selected_model"]
        run.model_type = "time_series" if run.model_name == "ARIMA" else "regression"
        run.status = "completed"
        run.mae = result["metrics"]["mae"]
        run.rmse = result["metrics"]["rmse"]
        run.r2_score = result["metrics"]["r2_score"]
        run.parameters = json.dumps(result["parameters"])
        run.artifact_path = result["artifact_path"]
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(run)
        return {**_serialize(run, dataset), "selected_model": result["selected_model"], "evaluated_models": result["evaluated_models"]}
    except HTTPException as exc:
        run.status = "failed"
        run.error_message = str(exc.detail)
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
        logger.warning(
            "Model training failed: run_id=%s dataset_id=%s model=%s detail=%s",
            run.id,
            dataset.id,
            request.model_name,
            exc.detail,
        )
        raise
    except Exception as exc:
        run.status = "failed"
        run.error_message = "Model training failed. Check the dataset configuration and try again."
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
        logger.exception(
            "Unexpected model training failure: run_id=%s dataset_id=%s model=%s",
            run.id,
            dataset.id,
            request.model_name,
        )
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=run.error_message) from exc
