from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class ForecastResponse(BaseModel):
    id: int
    model_run_id: int
    dataset_id: int
    dataset_name: str | None = None
    model_name: str
    product_id: str
    forecast_date: date
    predicted_demand: float
    lower_bound: float | None = None
    upper_bound: float | None = None
    confidence_level: float | None = None
    created_at: datetime


class HealthResponse(BaseModel):
    status: str = Field(..., description="Overall service status.")
    service: str = Field(..., description="Service name.")
    version: str = Field(..., description="API version.")


class ModelRunResponse(BaseModel):
    id: int
    dataset_id: int
    model_name: str
    model_type: str
    status: str
    mae: float | None = None
    rmse: float | None = None
    r2_score: float | None = None
    parameters: Any = None
    artifact_path: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime