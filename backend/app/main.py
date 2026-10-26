"""Main FastAPI application for InventIQ."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.db import engine, ensure_commercial_obsolescence_table, ensure_dataset_storage_column, ensure_forecasting_constraints, ensure_model_run_columns, ensure_product_dependencies_table, ensure_recommendations_table, ensure_recovery_plans_table, ensure_user_columns
from app.models import Base
from app.routers import alerts, auth, datasets, dependencies, forecasts, health, model_runs, recommendations, recovery, simulations
from app.routers import obsolescence

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

app = FastAPI(
    title="InventIQ API",
    description=(
        "InventIQ — Demand Forecasting and Zero Waste Inventory. "
        "AI/ML inventory intelligence backend."
    ),
    version="1.0.0",
    docs="/docs",
    redoc="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(datasets.router)
app.include_router(model_runs.router)
app.include_router(forecasts.router)
app.include_router(alerts.router)
app.include_router(dependencies.router)
app.include_router(recommendations.router)
app.include_router(obsolescence.router)
app.include_router(simulations.router)
app.include_router(recovery.router)

if (FRONTEND_DIST / "assets").is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIST / "assets"),
        name="frontend-assets",
    )


@app.on_event("startup")
def prepare_database() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_dataset_storage_column()
    ensure_model_run_columns()
    ensure_forecasting_constraints()
    ensure_recommendations_table()
    ensure_product_dependencies_table()
    ensure_commercial_obsolescence_table()
    ensure_recovery_plans_table()
    ensure_user_columns()


@app.get("/", include_in_schema=False)
async def frontend_root():
    index_file = FRONTEND_DIST / "index.html"
    if index_file.is_file():
        return FileResponse(index_file)
    return {
        "service": "InventIQ API",
        "version": app.version,
        "docs": "/docs",
        "detail": "Build the frontend with `npm run build` to serve it here.",
    }


@app.get("/favicon.svg", include_in_schema=False)
async def frontend_favicon():
    favicon_file = FRONTEND_DIST / "favicon.svg"
    if favicon_file.is_file():
        return FileResponse(favicon_file)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


@app.get("/{frontend_path:path}", include_in_schema=False)
async def frontend_fallback(frontend_path: str):
    if frontend_path == "api" or frontend_path.startswith("api/"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    index_file = FRONTEND_DIST / "index.html"
    if index_file.is_file():
        requested_file = (FRONTEND_DIST / frontend_path).resolve()
        if FRONTEND_DIST.resolve() in requested_file.parents and requested_file.is_file():
            return FileResponse(requested_file)
        return FileResponse(index_file)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )