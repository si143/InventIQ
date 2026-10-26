from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import CurrentUser, get_dataset_for_user
from app.models import Dataset, Simulation
from app.services.simulation_service import execute_counterfactual_inventory, execute_simulation

router = APIRouter(prefix="/api/simulations", tags=["simulations"])


class SimulationRequest(BaseModel):
    dataset_id: int = Field(gt=0)
    forecast_run_id: int = Field(gt=0)
    simulation_type: str = "demand_spike"
    demand_change: float = Field(default=15.0, ge=-100, le=1000)
    lead_time_delay: float = Field(default=0.0, ge=0, le=365)
    name: str | None = None


class CounterfactualRequest(BaseModel):
    dataset_id: int = Field(gt=0)
    forecast_run_id: int = Field(gt=0)
    scenario_type: str = "inventory_adjustment"
    adjustment_percent: float = Field(ge=-100, le=1000)
    name: str | None = None


def _json(value: str | None) -> dict:
    try:
        return json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}


def _serialize(record: Simulation) -> dict:
    return {
        "id": record.id,
        "user_id": record.user_id,
        "dataset_id": record.dataset_id,
        "simulation_type": record.simulation_type,
        "name": record.name,
        "parameters": _json(record.parameters),
        "results": _json(record.results),
        "status": record.status,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "completed_at": record.completed_at.isoformat() if record.completed_at else None,
    }


@router.post("")
def create_simulation(
    request: SimulationRequest,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    dataset = get_dataset_for_user(request.dataset_id, user, db)
    return _serialize(execute_simulation(
        db,
        dataset,
        request.forecast_run_id,
        request.simulation_type,
        request.demand_change,
        request.lead_time_delay,
        user.id,
        request.name,
    ))


@router.post("/counterfactual")
def create_counterfactual(
    request: CounterfactualRequest,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    if request.scenario_type != "inventory_adjustment":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported counterfactual scenario type.")
    dataset = get_dataset_for_user(request.dataset_id, user, db)
    return _serialize(execute_counterfactual_inventory(
        db,
        dataset,
        request.forecast_run_id,
        request.adjustment_percent,
        user.id,
        request.name,
    ))


@router.get("")
def list_simulations(
    user: CurrentUser,
    db: Session = Depends(get_db),
    dataset_id: int | None = None,
):
    query = db.query(Simulation).filter(Simulation.user_id == user.id).order_by(Simulation.created_at.desc())
    if dataset_id is not None:
        query = query.filter(Simulation.dataset_id == dataset_id)
    return [_serialize(record) for record in query.all()]


@router.get("/{simulation_id}")
def get_simulation(
    simulation_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    record = db.query(Simulation).join(Dataset, Simulation.dataset_id == Dataset.id).filter(Simulation.id == simulation_id, Dataset.user_id == user.id).first()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found.")
    return _serialize(record)
