from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Annotated
from io import BytesIO
from uuid import uuid4

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import CurrentUser, get_dataset_for_user
from app.models import Alert, CommercialObsolescence, Dataset, Forecast, ModelRun, ProductDependency, Recommendation, RecoveryPlan, Simulation
from app.services.dataset_service import describe_columns, read_dataset

router = APIRouter(prefix="/api/datasets", tags=["datasets"])

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls"}
UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"


def _get_dataset_or_404(dataset_id: int, db: Session, user: CurrentUser) -> Dataset:
    return get_dataset_for_user(dataset_id, user, db)


def _read_dataset(dataset: Dataset) -> pd.DataFrame:
    if not dataset.storage_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The uploaded file is no longer available.")

    path = Path(dataset.storage_path)
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[2] / path
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The uploaded file is no longer available.")

    try:
        if dataset.file_type == "csv":
            return pd.read_csv(path)
        if dataset.file_type in {"xlsx", "xls"}:
            return pd.read_excel(path)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The dataset file could not be read.") from exc

    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This dataset file type is not supported.")


def _metadata(dataset: Dataset) -> dict:
    return {
        "dataset_id": dataset.id,
        "filename": dataset.original_filename,
        "file_type": dataset.file_type,
        "file_size": dataset.file_size,
        "row_count": dataset.row_count,
        "column_count": dataset.column_count,
        "status": dataset.status,
        "created_at": dataset.created_at.isoformat() if dataset.created_at else None,
    }


def _column_analysis(df: pd.DataFrame) -> list[dict]:
    return [
        {
            "name": str(column),
            "data_type": str(df[column].dtype),
            "missing_values": int(df[column].isna().sum()),
            "unique_values": int(df[column].nunique(dropna=True)),
        }
        for column in df.columns
    ]


@router.post("/upload")
def upload_dataset(
    file: Annotated[UploadFile, File(...)],
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No file uploaded.")

    if file.file is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file upload.")

    suffix = file.filename.lower().rsplit(".", 1)
    if len(suffix) != 2 or suffix[1] not in {"csv", "xlsx", "xls"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type. Allowed types: .csv, .xlsx, .xls",
        )

    content = file.file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")

    file_type = suffix[1].lower()
    file_name = file.filename
    file_size = len(content)

    try:
        if file_type == "csv":
            df = pd.read_csv(BytesIO(content))
        else:
            df = pd.read_excel(BytesIO(content))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unable to parse uploaded file: {exc}",
        ) from exc

    row_count = int(len(df))
    column_count = int(len(df.columns))

    dataset = Dataset(
        user_id=user.id,
        filename=file_name,
        original_filename=file_name,
        storage_path=None,
        file_type=file_type,
        file_size=file_size,
        row_count=row_count,
        column_count=column_count,
        status="uploaded",
    )

    db.add(dataset)
    db.commit()
    db.refresh(dataset)

    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", file_name)
    stored_name = f"{dataset.id}_{uuid4().hex}_{safe_name}"
    stored_path = UPLOAD_DIR / stored_name
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_path.write_bytes(content)
    dataset.storage_path = str(stored_path.relative_to(UPLOAD_DIR.parent))
    db.commit()
    db.refresh(dataset)

    return {
        "dataset_id": dataset.id,
        "filename": dataset.filename,
        "file_type": dataset.file_type,
        "file_size": dataset.file_size,
        "row_count": dataset.row_count,
        "column_count": dataset.column_count,
        "status": dataset.status,
    }


@router.get("")
def list_datasets(user: CurrentUser, db: Session = Depends(get_db)):
    datasets = db.query(Dataset).filter(Dataset.user_id == user.id).order_by(Dataset.id.desc()).all()
    return [_metadata(dataset) for dataset in datasets]


@router.get("/{dataset_id}")
def get_dataset(dataset_id: int, user: CurrentUser, db: Session = Depends(get_db)):
    return _metadata(_get_dataset_or_404(dataset_id, db, user))


@router.get("/{dataset_id}/preview")
def preview_dataset(dataset_id: int, user: CurrentUser, db: Session = Depends(get_db)):
    dataset = _get_dataset_or_404(dataset_id, db, user)
    dataframe = _read_dataset(dataset)
    preview = json.loads(dataframe.head(20).to_json(orient="records", date_format="iso"))
    return {
        **_metadata(dataset),
        "column_names": [str(column) for column in dataframe.columns],
        "data_types": {str(column): str(dataframe[column].dtype) for column in dataframe.columns},
        "preview": preview,
    }


def _build_demand_history(dataframe: pd.DataFrame, parameters: dict) -> dict:
    date_column = parameters.get("date_column")
    demand_column = parameters.get("target_column")
    product_column = parameters.get("product_column")
    if not date_column or not demand_column or date_column not in dataframe.columns or demand_column not in dataframe.columns:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This model run does not have usable date and demand columns.")
    if product_column and product_column not in dataframe.columns:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The model run's configured product column is missing from the dataset.")

    history = pd.DataFrame({
        "_date": pd.to_datetime(dataframe[date_column], errors="coerce"),
        "_demand": pd.to_numeric(dataframe[demand_column], errors="coerce"),
        "_product_id": dataframe[product_column].astype("string") if product_column else "ALL",
    }).dropna(subset=["_date", "_demand", "_product_id"])
    history = history.groupby(["_date", "_product_id"], as_index=False)["_demand"].sum().sort_values(["_date", "_product_id"])
    return {
        "date_column": date_column,
        "demand_column": demand_column,
        "product_column": product_column,
        "rows": [
            {"date": row["_date"].date().isoformat(), "product_id": str(row["_product_id"]), "actual_demand": float(row["_demand"])}
            for row in history.to_dict(orient="records")
        ],
    }


@router.get("/{dataset_id}/demand-history")
def dataset_demand_history(
    dataset_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
    model_run_id: int = Query(...),
):
    dataset = _get_dataset_or_404(dataset_id, db, user)
    run = db.query(ModelRun).filter(ModelRun.id == model_run_id, ModelRun.dataset_id == dataset_id).first()
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model run not found for this dataset.")
    try:
        parameters = json.loads(run.parameters or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The model configuration is invalid.") from exc
    return _build_demand_history(read_dataset(dataset), parameters)


@router.get("/{dataset_id}/validation")
def validate_dataset(dataset_id: int, user: CurrentUser, db: Session = Depends(get_db)):
    dataset = _get_dataset_or_404(dataset_id, db, user)
    dataframe = _read_dataset(dataset)
    missing_values = int(dataframe.isna().sum().sum())
    duplicate_rows = int(dataframe.duplicated().sum())
    empty_columns = [str(column) for column in dataframe.columns if dataframe[column].isna().all()]
    findings = []
    if missing_values:
        findings.append({"severity": "warning", "message": f"{missing_values} missing values detected."})
    if duplicate_rows:
        findings.append({"severity": "warning", "message": f"{duplicate_rows} duplicate rows detected."})
    if empty_columns:
        findings.append({"severity": "error", "message": f"Empty columns: {', '.join(empty_columns)}."})
    overall_status = "Error" if empty_columns else "Warning" if findings else "Healthy"
    return {
        **_metadata(dataset),
        "file_readable": True,
        "rows": int(len(dataframe)),
        "columns": int(len(dataframe.columns)),
        "missing_values": missing_values,
        "duplicate_rows": duplicate_rows,
        "empty_columns": empty_columns,
        "overall_status": overall_status,
        "findings": findings,
        "column_analysis": _column_analysis(dataframe),
    }


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: int, user: CurrentUser, db: Session = Depends(get_db)):
    dataset = _get_dataset_or_404(dataset_id, db, user)

    model_runs = db.query(ModelRun).filter(ModelRun.dataset_id == dataset_id).all()
    model_run_ids = [run.id for run in model_runs]
    forecast_ids = [forecast.id for forecast in db.query(Forecast).filter(Forecast.model_run_id.in_(model_run_ids)).all()]
    related_alert_ids = [
        alert.id for alert in db.query(Alert).filter((Alert.dataset_id == dataset_id) | (Alert.forecast_id.in_(forecast_ids))).all()
    ]

    db.query(Recommendation).filter(
        (Recommendation.dataset_id == dataset_id)
        | (Recommendation.forecast_id.in_(forecast_ids))
        | (Recommendation.alert_id.in_(related_alert_ids))
    ).delete(synchronize_session=False)
    db.query(Alert).filter((Alert.dataset_id == dataset_id) | (Alert.forecast_id.in_(forecast_ids))).delete(synchronize_session=False)
    db.query(Forecast).filter(Forecast.model_run_id.in_(model_run_ids)).delete(synchronize_session=False)
    db.query(ModelRun).filter(ModelRun.dataset_id == dataset_id).delete(synchronize_session=False)
    db.query(ProductDependency).filter(ProductDependency.dataset_id == dataset_id).delete(synchronize_session=False)
    db.query(Simulation).filter(Simulation.dataset_id == dataset_id).delete(synchronize_session=False)
    db.query(CommercialObsolescence).filter(CommercialObsolescence.dataset_id == dataset_id).delete(synchronize_session=False)
    db.query(RecoveryPlan).filter(RecoveryPlan.dataset_id == dataset_id).delete(synchronize_session=False)

    if dataset.storage_path:
        storage_file = Path(dataset.storage_path)
        if not storage_file.is_absolute():
            storage_file = UPLOAD_DIR.parent / storage_file
        try:
            storage_file.unlink(missing_ok=True)
        except OSError:
            pass

    db.delete(dataset)
    db.commit()

    return {
        "dataset_id": dataset_id,
        "deleted": True,
        "message": "Dataset and related records were deleted successfully.",
    }


@router.get("/{dataset_id}/summary")
def dataset_summary(dataset_id: int, user: CurrentUser, db: Session = Depends(get_db)):
    dataset = _get_dataset_or_404(dataset_id, db, user)
    dataframe = _read_dataset(dataset)

    product_column = next(
        (
            column
            for column in ["product_id", "sku", "product", "item_id", "item", "product_name"]
            if column in dataframe.columns
        ),
        None,
    )
    unique_products = int(dataframe[product_column].nunique(dropna=True)) if product_column else 0

    inventory_columns = {"stock_on_hand", "inventory", "units_in_stock", "on_hand", "available_stock", "stock_level", "inventory_level"}
    has_inventory_columns = any(str(column).lower() in inventory_columns for column in dataframe.columns)
    inventory_health = None if not has_inventory_columns else "Available"

    return {
        "dataset_id": dataset.id,
        "filename": dataset.original_filename,
        "row_count": int(len(dataframe)),
        "column_count": int(len(dataframe.columns)),
        "total_products_tracked": unique_products,
        "product_column": product_column,
        "inventory_health": inventory_health,
        "has_inventory_columns": has_inventory_columns,
    }


def _build_dashboard_analytics(dataframe: pd.DataFrame) -> dict:
    columns = {
        str(column).strip().lower().replace(" ", "_"): column
        for column in dataframe.columns
    }

    def find_column(candidates: tuple[str, ...]):
        return next((columns[name] for name in candidates if name in columns), None)

    date_column = find_column(("sales_date", "date", "order_date", "transaction_date", "sold_on"))
    product_id_column = find_column(("product_id", "sku", "item_id", "product", "item"))
    product_name_column = find_column(("product_name", "item_name", "name"))
    category_column = find_column(("category", "product_category"))
    demand_column = find_column(("units_sold", "units", "demand", "quantity", "qty", "quantity_sold"))
    price_column = find_column(("price", "unit_price", "selling_price"))

    demand = pd.to_numeric(dataframe[demand_column], errors="coerce") if demand_column else None
    units_valid = demand.notna() if demand is not None else pd.Series(False, index=dataframe.index)
    total_units = float(demand[units_valid].sum()) if demand is not None and units_valid.any() else None

    products = None
    if product_id_column:
        products = dataframe[product_id_column].astype("string").str.strip()
    elif product_name_column:
        products = dataframe[product_name_column].astype("string").str.strip()

    product_stats = []
    category_totals = []
    product_count = None
    if demand is not None and products is not None:
        product_frame = pd.DataFrame({"product_id": products, "units_sold": demand})
        product_frame = product_frame.dropna(subset=["product_id", "units_sold"])
        if product_name_column:
            product_frame["product_name"] = dataframe[product_name_column].astype("string")
        if category_column:
            product_frame["category"] = dataframe[category_column].astype("string")
        aggregates = {"units_sold": ("units_sold", "sum")}
        if "product_name" in product_frame.columns:
            aggregates["product_name"] = ("product_name", "first")
        if "category" in product_frame.columns:
            aggregates["category"] = ("category", "first")
        grouped = product_frame.groupby("product_id", as_index=False).agg(**aggregates)
        product_count = int(grouped["product_id"].nunique())
        product_stats = [
            {
                "product_id": str(row["product_id"]),
                "product_name": (
                    str(row["product_name"])
                    if pd.notna(row.get("product_name")) and str(row["product_name"]).strip()
                    else str(row["product_id"])
                ),
                "units_sold": float(row["units_sold"]),
                "category": str(row["category"]) if pd.notna(row.get("category")) else None,
            }
            for row in grouped.sort_values("units_sold", ascending=False).head(10).to_dict(orient="records")
        ]
    if demand is not None and category_column:
        category_frame = pd.DataFrame({
            "category": dataframe[category_column].astype("string").str.strip(),
            "units_sold": demand,
        }).dropna(subset=["category", "units_sold"])
        categories = category_frame.groupby("category", as_index=False)["units_sold"].sum()
        category_totals = [
            {"category": str(row["category"]), "units_sold": float(row["units_sold"])}
            for row in categories.sort_values("units_sold", ascending=False).head(10).to_dict(orient="records")
        ]

    total_sales = None
    if demand_column and price_column:
        prices = pd.to_numeric(dataframe[price_column], errors="coerce")
        valid_sales = demand.notna() & prices.notna()
        if valid_sales.any():
            total_sales = float((demand[valid_sales] * prices[valid_sales]).sum())

    trend = []
    granularity = None
    valid_date_count = 0
    dated_units_sold = None
    if date_column and demand is not None:
        dates = pd.to_datetime(dataframe[date_column], errors="coerce")
        history = pd.DataFrame({"date": dates, "units_sold": demand}).dropna()
        if not history.empty:
            valid_date_count = int(history["date"].dt.normalize().nunique())
            dated_units_sold = float(history["units_sold"].sum())
            if valid_date_count > 45:
                history["period"] = history["date"].dt.to_period("M").astype(str)
                granularity = "monthly"
            else:
                history["period"] = history["date"].dt.strftime("%Y-%m-%d")
                granularity = "daily"
            totals = history.groupby("period", as_index=False)["units_sold"].sum()
            trend = [
                {"date": str(row["period"]), "units_sold": float(row["units_sold"])}
                for row in totals.to_dict(orient="records")
            ]

    return {
        "row_count": int(len(dataframe)),
        "date_column": str(date_column) if date_column is not None else None,
        "demand_column": str(demand_column) if demand_column is not None else None,
        "total_units_sold": total_units,
        "total_sales": total_sales,
        "product_count": product_count,
        "average_daily_sales": dated_units_sold / valid_date_count if dated_units_sold is not None and valid_date_count else None,
        "trend_granularity": granularity,
        "trend": trend,
        "top_products": product_stats,
        "categories": category_totals,
    }


@router.get("/{dataset_id}/dashboard-analytics")
def dataset_dashboard_analytics(dataset_id: int, user: CurrentUser, db: Session = Depends(get_db)):
    dataset = _get_dataset_or_404(dataset_id, db, user)
    return {
        "dataset_id": dataset.id,
        "filename": dataset.original_filename,
        **_build_dashboard_analytics(_read_dataset(dataset)),
    }


@router.get("/{dataset_id}/columns")
def dataset_columns(dataset_id: int, user: CurrentUser, db: Session = Depends(get_db)):
    dataset = _get_dataset_or_404(dataset_id, db, user)
    return {"dataset_id": dataset_id, "columns": describe_columns(read_dataset(dataset))}
