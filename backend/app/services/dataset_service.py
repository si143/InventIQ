from __future__ import annotations

from pathlib import Path

import pandas as pd
from fastapi import HTTPException, status

from app.models import Dataset


def dataset_path(dataset: Dataset) -> Path:
    if not dataset.storage_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The uploaded dataset file is unavailable.")
    path = Path(dataset.storage_path)
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[2] / path
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The uploaded dataset file is unavailable.")
    return path


def read_dataset(dataset: Dataset) -> pd.DataFrame:
    path = dataset_path(dataset)
    try:
        if dataset.file_type == "csv":
            return pd.read_csv(path)
        if dataset.file_type in {"xlsx", "xls"}:
            return pd.read_excel(path)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The dataset file could not be read.") from exc
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This dataset file type is not supported.")


def infer_column_role(series: pd.Series, column_name: str, columns: list[str]) -> str:
    name = column_name.lower().strip()
    if pd.api.types.is_datetime64_any_dtype(series) or any(token in name for token in ("date", "time", "day", "month")):
        return "date"
    if any(token in name for token in ("product", "item", "sku", "part")) and not pd.api.types.is_numeric_dtype(series):
        return "product"
    if pd.api.types.is_numeric_dtype(series):
        if any(token in name for token in ("sales", "demand", "target", "quantity", "units", "revenue")):
            return "target"
        return "numeric"
    return "categorical"


def describe_columns(dataframe: pd.DataFrame) -> list[dict]:
    columns = [str(column) for column in dataframe.columns]
    descriptions = []
    for column in columns:
        series = dataframe[column]
        dtype = "datetime" if pd.api.types.is_datetime64_any_dtype(series) else "numeric" if pd.api.types.is_numeric_dtype(series) else "string"
        descriptions.append({"name": column, "dtype": dtype, "role": infer_column_role(series, column, columns)})
    numeric = [item for item in descriptions if item["dtype"] == "numeric"]
    if numeric and not any(item["role"] == "target" for item in descriptions):
        numeric[-1]["role"] = "target"
    return descriptions
