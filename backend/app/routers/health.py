"""Health-check router."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

from fastapi import APIRouter
from sqlalchemy import text

from app.db import engine
from app.schemas.responses import HealthResponse

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Confirm the InventIQ backend is running."""
    return HealthResponse(status="ok", service="InventIQ API", version="1.0.0")


def _package_version(package: str) -> str | None:
    try:
        return version(package)
    except PackageNotFoundError:
        return None


@router.get("/health/system")
def system_information() -> dict:
    """Expose non-sensitive runtime information for the Help page."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        database_status = "connected"
    except Exception:
        database_status = "unavailable"

    model_libraries = [
        {"name": "scikit-learn", "version": _package_version("scikit-learn")},
        {"name": "statsmodels", "version": _package_version("statsmodels")},
        {"name": "XGBoost", "version": _package_version("xgboost")},
    ]
    return {
        "application": {"name": "InventIQ API", "version": "1.0.0"},
        "backend": {"framework": "FastAPI", "version": _package_version("fastapi")},
        "database": {"engine": engine.dialect.name, "status": database_status},
        "model_libraries": model_libraries,
    }