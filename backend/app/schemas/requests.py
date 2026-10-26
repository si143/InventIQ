from __future__ import annotations

from pydantic import BaseModel, Field


class DependencyAnalyzeRequest(BaseModel):
    dataset_id: int


class ForecastGenerateRequest(BaseModel):
    model_run_id: int
    dataset_id: int | None = None
    forecast_horizon: int = Field(gt=0, le=90)


class AlertGenerateRequest(BaseModel):
    model_run_id: int


class ModelRunTrainRequest(BaseModel):
    dataset_id: int
    target_column: str
    date_column: str | None = None
    product_column: str | None = None
    forecast_horizon: int = Field(default=7, gt=0)
    model_name: str = "Auto Select"


class RecommendationGenerateRequest(BaseModel):
    model_run_id: int