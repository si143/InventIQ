from __future__ import annotations

import json
from pathlib import Path
from datetime import date
from statistics import NormalDist
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import HTTPException, status
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sqlalchemy.orm import Session

from app.models import Dataset, Forecast, ModelRun
from app.services.dataset_service import read_dataset

MODEL_NAMES = {"Auto Select", "Linear Regression", "Random Forest", "XGBoost", "ARIMA"}
ARTIFACT_DIR = Path(__file__).resolve().parents[2] / "model_artifacts"


def _metrics(actual: np.ndarray, predicted: np.ndarray, include_r2: bool = True) -> dict[str, float | None]:
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    if len(actual) == 0 or len(actual) != len(predicted) or not np.isfinite(actual).all() or not np.isfinite(predicted).all():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Model evaluation produced invalid metric values.")
    score = None
    if include_r2 and len(actual) > 1 and np.unique(actual).size > 1:
        try:
            score = float(r2_score(actual, predicted))
        except ValueError:
            score = None
        if score is not None and not np.isfinite(score):
            score = None
    mae = float(mean_absolute_error(actual, predicted))
    rmse = float(np.sqrt(mean_squared_error(actual, predicted)))
    if not np.isfinite(mae) or not np.isfinite(rmse):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Model evaluation produced invalid error metrics.")
    return {
        "mae": mae,
        "rmse": rmse,
        "r2_score": score,
    }


def _series_status(frame: pd.DataFrame, target_column: str, product_column: str | None) -> dict[str, str]:
    target = pd.to_numeric(frame[target_column], errors="coerce")
    if product_column and product_column in frame.columns:
        products = frame[product_column].astype("string").str.strip()
        statuses: dict[str, str] = {}
        for product, values in target.groupby(products):
            valid = values.dropna()
            if len(valid) < 2:
                statuses[str(product)] = "insufficient_data"
            else:
                statuses[str(product)] = "constant_demand" if valid.nunique() == 1 else "varying_demand"
        return statuses
    valid = target.dropna()
    if len(valid) < 2:
        return {"ALL": "insufficient_data"}
    return {"ALL": "constant_demand" if valid.nunique() == 1 else "varying_demand"}


def _residual_std(actual: np.ndarray, predicted: np.ndarray) -> float:
    residuals = np.asarray(actual, dtype=float) - np.asarray(predicted, dtype=float)
    residuals = residuals[np.isfinite(residuals)]
    if len(residuals) >= 2:
        value = float(np.std(residuals, ddof=1))
    elif len(residuals) == 1:
        value = float(abs(residuals[0]))
    else:
        value = 0.0
    return value if np.isfinite(value) and value >= 0 else 0.0


def _split(
    features: pd.DataFrame,
    target: pd.Series,
    dates: pd.Series | None,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series, pd.Timestamp, pd.Timestamp, pd.Timestamp, pd.Timestamp]:
    if dates is None or dates.empty:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Temporal validation requires a usable date column.")

    normalized_dates = pd.to_datetime(dates, errors="coerce").dt.normalize()
    unique_dates = pd.Index(normalized_dates.dropna().unique()).sort_values()
    if len(unique_dates) < 4:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="At least 4 unique dates are required for temporal validation.")

    train_date_count = min(max(int(len(unique_dates) * 0.8), 2), len(unique_dates) - 2)
    cutoff = pd.Timestamp(unique_dates[train_date_count - 1])
    validation_start = pd.Timestamp(unique_dates[train_date_count])
    training_mask = normalized_dates <= cutoff
    validation_mask = normalized_dates >= validation_start
    if not training_mask.any() or not validation_mask.any():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unable to create non-overlapping temporal training and validation periods.")

    return (
        features.loc[training_mask],
        features.loc[validation_mask],
        target.loc[training_mask],
        target.loc[validation_mask],
        pd.Timestamp(unique_dates[0]),
        cutoff,
        validation_start,
        pd.Timestamp(unique_dates[-1]),
    )


def _sklearn_result(
    model_name: str,
    features: pd.DataFrame,
    target: pd.Series,
    dates: pd.Series | None,
    products: pd.Series | None,
) -> dict[str, Any]:
    train_x, test_x, train_y, test_y, training_start, cutoff, validation_start, validation_end = _split(features, target, dates)
    if model_name == "Linear Regression":
        model = LinearRegression()
        parameters = {"fit_intercept": True}
    elif model_name == "Random Forest":
        model = RandomForestRegressor(n_estimators=150, random_state=42, n_jobs=-1, min_samples_leaf=2)
        parameters = {"n_estimators": 150, "random_state": 42, "min_samples_leaf": 2}
    elif model_name == "XGBoost":
        try:
            from xgboost import XGBRegressor
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="XGBoost is not available in this environment.") from exc
        model = XGBRegressor(n_estimators=150, max_depth=4, learning_rate=0.05, subsample=0.9, colsample_bytree=0.9, objective="reg:squarederror", random_state=42, n_jobs=1)
        parameters = {"n_estimators": 150, "max_depth": 4, "learning_rate": 0.05, "random_state": 42}
    else:
        raise ValueError(f"Unsupported sklearn model: {model_name}")
    model.fit(train_x, train_y)
    predicted = model.predict(test_x)
    actual = test_y.to_numpy(dtype=float)
    residuals = actual - predicted
    global_error_std = _residual_std(actual, predicted)
    per_product_error_std: dict[str, float] = {}
    per_product_residual_count: dict[str, int] = {}
    fallback_products: list[str] = []
    if products is not None:
        validation_products = products.loc[test_y.index].astype("string").str.strip()
        for product, product_residuals in pd.Series(residuals, index=validation_products.index).groupby(validation_products):
            finite_residuals = np.asarray(product_residuals, dtype=float)
            finite_residuals = finite_residuals[np.isfinite(finite_residuals)]
            product_name = str(product)
            per_product_residual_count[product_name] = int(len(finite_residuals))
            if len(finite_residuals) >= 2:
                per_product_error_std[product_name] = _residual_std(finite_residuals, np.zeros(len(finite_residuals)))
            else:
                fallback_products.append(product_name)
    uncertainty = {
        "method": "product_validation_residual_std_sqrt_horizon",
        "error_std": global_error_std,
        "per_product_error_std": per_product_error_std,
        "per_product_residual_count": per_product_residual_count,
        "fallback_products": fallback_products,
        "horizon_scaling": {"method": "sqrt_forecast_step", "reference_step": 1},
    }
    return {
        "model": model,
        "metrics": _metrics(actual, predicted),
        "uncertainty": uncertainty,
        "parameters": parameters,
        "validation": {
            "method": "chronological_date_boundary",
            "training_start": training_start.date().isoformat(),
            "training_end": cutoff.date().isoformat(),
            "validation_start": validation_start.date().isoformat(),
            "validation_end": validation_end.date().isoformat(),
        },
    }


def _arima_result(frame: pd.DataFrame, target_column: str, date_column: str | None, product_column: str | None) -> dict[str, Any]:
    if not date_column or date_column not in frame.columns:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="ARIMA requires a valid date column.")
    if not product_column or product_column not in frame.columns:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Product-level ARIMA requires a product column.")

    from statsmodels.tsa.arima.model import ARIMA

    series_frame = frame[[product_column, date_column, target_column]].copy()
    series_frame["_product"] = series_frame[product_column].astype("string").str.strip()
    series_frame["_date"] = pd.to_datetime(series_frame[date_column], errors="coerce")
    series_frame["_target"] = pd.to_numeric(series_frame[target_column], errors="coerce")
    series_frame = series_frame.dropna(subset=["_product", "_date", "_target"])
    series_frame = series_frame[series_frame["_product"] != ""]
    if series_frame.empty:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="ARIMA requires valid product, date, and demand records.")
    series_frame = series_frame.groupby(["_product", "_date"], as_index=False)["_target"].sum().sort_values(["_product", "_date"])

    evaluated_actual: list[float] = []
    evaluated_predicted: list[float] = []
    evaluated_residuals: list[float] = []
    fitted_models: dict[str, Any] = {}
    skipped_products: list[str] = []
    constant_products: list[str] = []
    product_observations: dict[str, int] = {}
    series_status: dict[str, str] = {}

    for product, product_frame in series_frame.groupby("_product", sort=True):
        values = product_frame["_target"].to_numpy(dtype=float)
        product_observations[str(product)] = int(len(values))
        if len(values) < 12:
            skipped_products.append(f"{product}: requires at least 12 chronological observations")
            series_status[str(product)] = "insufficient_data"
            continue
        if np.unique(values).size <= 1:
            constant_value = float(values[0])
            fitted_models[str(product)] = {"kind": "constant_demand", "value": constant_value}
            constant_products.append(str(product))
            series_status[str(product)] = "constant_demand"
            holdout = max(2, min(7, len(values) // 5))
            evaluated_actual.extend(values[-holdout:].tolist())
            evaluated_predicted.extend([constant_value] * holdout)
            continue

        holdout = max(2, min(7, len(values) // 5))
        train_values = values[:-holdout]
        test_values = values[-holdout:]
        try:
            validation_model = ARIMA(train_values, order=(1, 1, 1)).fit()
            predicted = np.asarray(validation_model.forecast(steps=holdout), dtype=float)
            final_model = ARIMA(values, order=(1, 1, 1)).fit()
        except Exception:
            skipped_products.append(f"{product}: ARIMA could not fit this time series")
            series_status[str(product)] = "insufficient_data"
            continue

        if len(predicted) != len(test_values) or not np.isfinite(predicted).all():
            skipped_products.append(f"{product}: ARIMA produced invalid validation values")
            series_status[str(product)] = "insufficient_data"
            continue
        evaluated_actual.extend(test_values.tolist())
        evaluated_predicted.extend(predicted.tolist())
        evaluated_residuals.extend((test_values - predicted).tolist())
        fitted_models[str(product)] = final_model
        series_status[str(product)] = "varying_demand"

    if not fitted_models:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No product has enough valid history for product-level ARIMA.")

    actual = np.asarray(evaluated_actual, dtype=float)
    predicted = np.asarray(evaluated_predicted, dtype=float)
    error_std = _residual_std(actual, predicted)
    return {
        "model": {
            "artifact_type": "product_arima",
            "models": fitted_models,
            "products": sorted(fitted_models),
            "product_observations": product_observations,
        },
        "metrics": _metrics(actual, predicted, include_r2=False),
        "uncertainty": {
            "method": "product_prediction_intervals_with_constant_series" if constant_products else "statsmodels_prediction_interval",
            "error_std": error_std,
        },
        "parameters": {
            "order": [1, 1, 1],
            "minimum_observations": 12,
            "products_processed": len(fitted_models),
            "constant_products": constant_products,
            "products_skipped": skipped_products,
            "series_status": series_status,
        },
    }


def train_and_evaluate(dataframe: pd.DataFrame, target_column: str, date_column: str | None, product_column: str | None, model_name: str, forecast_horizon: int, run_id: int) -> dict[str, Any]:
    if model_name not in MODEL_NAMES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported model selection.")
    if forecast_horizon <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Forecast horizon must be positive.")
    frame, target, dates = prepare_frame(dataframe, target_column, date_column, product_column)
    series_status = _series_status(frame, target_column, product_column)
    features = build_features(frame, target_column, date_column, product_column)
    results: list[dict[str, Any]] = []
    requested = ["Linear Regression", "Random Forest", "XGBoost", "ARIMA"] if model_name == "Auto Select" else [model_name]
    for candidate in requested:
        try:
            result = _arima_result(frame, target_column, date_column, product_column) if candidate == "ARIMA" else _sklearn_result(candidate, features, target, dates, frame[product_column] if product_column else None)
            results.append({"model": candidate, "metrics": result["metrics"], "uncertainty": result["uncertainty"], "parameters": result["parameters"], "validation": result.get("validation"), "series_status": result.get("series_status", series_status), "fitted": result["model"]})
        except HTTPException:
            if model_name != "Auto Select":
                raise
        except Exception as exc:
            if model_name != "Auto Select":
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{candidate} could not train on this dataset.") from exc
    if not results:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No selected model could be trained on this dataset.")
    selected = min(results, key=lambda item: item["metrics"]["mae"])
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    artifact_path = ARTIFACT_DIR / f"model_run_{run_id}.joblib"
    joblib.dump(selected["fitted"], artifact_path)
    comparison = [{"model": item["model"], **item["metrics"]} for item in results]
    return {
        "selected_model": selected["model"],
        "metrics": selected["metrics"],
        "parameters": {
            "target_column": target_column,
            "date_column": date_column,
            "product_column": product_column,
            "forecast_horizon": forecast_horizon,
            "model_parameters": selected["parameters"],
            "validation": selected.get("validation"),
            "series_status": selected.get("series_status", series_status),
            "uncertainty": {
                **selected["uncertainty"],
                "confidence_level": 0.90,
            },
            "evaluated_models": comparison,
        },
        "artifact_path": str(artifact_path.relative_to(ARTIFACT_DIR.parent)),
        "evaluated_models": comparison,
    }


SUPPORTED_HORIZONS = {7, 14, 30, 60, 90}
ARTIFACT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIDENCE_LEVEL = 0.90


def prepare_frame(dataframe: pd.DataFrame, target_column: str, date_column: str | None, product_column: str | None) -> tuple[pd.DataFrame, pd.Series, pd.Series | None]:
    if target_column not in dataframe.columns:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Target column '{target_column}' was not found.")
    if date_column and date_column not in dataframe.columns:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Date column '{date_column}' was not found.")
    if product_column and product_column not in dataframe.columns:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Product column '{product_column}' was not found.")

    frame = dataframe.dropna(how="all").copy()
    target = pd.to_numeric(frame[target_column], errors="coerce")
    valid = target.notna()
    dates = None
    if date_column:
        dates = pd.to_datetime(frame[date_column], errors="coerce")
        valid &= dates.notna()
    frame = frame.loc[valid].copy()
    target = target.loc[valid].astype(float)
    if dates is not None:
        dates = dates.loc[valid]
        frame = frame.assign(_date=dates).sort_values("_date")
        target = target.loc[frame.index]
        dates = frame["_date"]
    if len(frame) < 10:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="At least 10 usable rows are required for training.")
    return frame, target, dates


def build_features(frame: pd.DataFrame, target_column: str, date_column: str | None, product_column: str | None) -> pd.DataFrame:
    features = pd.DataFrame(index=frame.index)
    if date_column and "_date" in frame:
        dates = frame["_date"]
        features["year"] = dates.dt.year
        features["month"] = dates.dt.month
        features["day"] = dates.dt.day
        features["day_of_week"] = dates.dt.dayofweek
        features["week_of_year"] = dates.dt.isocalendar().week.astype(float)
    for column in frame.columns:
        if column in {target_column, date_column, "_date"}:
            continue
        if product_column and column == product_column:
            encoded = pd.get_dummies(frame[column].fillna("Unknown").astype(str), prefix="product", dtype=float)
            features = pd.concat([features, encoded], axis=1)
        elif pd.api.types.is_numeric_dtype(frame[column]):
            features[column] = pd.to_numeric(frame[column], errors="coerce")
    features = features.replace([float("inf"), float("-inf")], pd.NA).fillna(0)
    if features.empty:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No usable model features were found in the selected dataset.")
    return features.astype(float)


def _forecast_parameters(run: ModelRun) -> dict[str, Any]:
    try:
        parameters = json.loads(run.parameters or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The model configuration is invalid.") from exc
    return parameters


def _load_artifact(run: ModelRun):
    if not run.artifact_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The trained model artifact is unavailable.")
    path = Path(run.artifact_path)
    if not path.is_absolute():
        path = ARTIFACT_ROOT / path
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The trained model artifact is unavailable.")
    try:
        return joblib.load(path)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The trained model artifact could not be loaded.") from exc


def _confidence_level(parameters: dict[str, Any]) -> float:
    configured = parameters.get("uncertainty", {}).get("confidence_level", DEFAULT_CONFIDENCE_LEVEL)
    try:
        confidence = float(configured)
        if confidence > 1:
            confidence /= 100
    except (TypeError, ValueError):
        confidence = DEFAULT_CONFIDENCE_LEVEL
    return confidence if 0 < confidence < 1 and np.isfinite(confidence) else DEFAULT_CONFIDENCE_LEVEL


def _finite_nonnegative(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = fallback
    return number if np.isfinite(number) and number >= 0 else max(fallback, 0.0)


def _future_frame(dataframe: pd.DataFrame, target_column: str, date_column: str, product_column: str | None, horizon: int) -> tuple[pd.DataFrame, list[str], list[date]]:
    historical, _, dates = prepare_frame(dataframe, target_column, date_column, product_column)
    if dates is None or dates.empty:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A usable date column is required to generate forecasts.")
    latest = dates.max()
    future_dates = [latest + pd.Timedelta(days=offset) for offset in range(1, horizon + 1)]
    products = ["ALL"]
    if product_column and product_column in historical.columns:
        values = historical[product_column].dropna().astype(str).unique().tolist()
        if values:
            products = values
    rows = []
    last_row = historical.iloc[-1]
    for product in products:
        for future_date in future_dates:
            row = {column: last_row[column] for column in historical.columns if column not in {target_column, date_column, "_date"}}
            row[target_column] = np.nan
            row[date_column] = future_date
            if product_column and product != "ALL":
                row[product_column] = product
            rows.append(row)
    future = pd.DataFrame(rows)
    combined = pd.concat([historical.drop(columns=["_date"], errors="ignore"), future], ignore_index=True)
    combined["_date"] = pd.to_datetime(combined[date_column], errors="coerce")
    feature_frame = build_features(combined, target_column, date_column, product_column)
    future_features = feature_frame.iloc[-len(future):].copy()
    return future_features, products, [item.date() for item in future_dates]


def _product_arima_forecast(artifact: dict[str, Any], dataframe: pd.DataFrame, target_column: str, date_column: str, confidence_level: float, horizon: int) -> list[dict[str, Any]]:
    models = artifact.get("models") if isinstance(artifact, dict) else None
    products = artifact.get("products") if isinstance(artifact, dict) else None
    if not isinstance(models, dict) or not isinstance(products, list) or not products:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The product-level ARIMA artifact is invalid.")

    dates = pd.to_datetime(dataframe[date_column], errors="coerce").dropna()
    if dates.empty:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A usable date column is required to generate forecasts.")
    forecast_dates = [(dates.max() + pd.Timedelta(days=offset)).date() for offset in range(1, horizon + 1)]
    output: list[dict[str, Any]] = []
    for product in products:
        model_entry = models.get(product)
        if model_entry is None:
            continue
        if isinstance(model_entry, dict) and model_entry.get("kind") == "constant_demand":
            predicted = _finite_nonnegative(model_entry.get("value"))
            for forecast_date in forecast_dates:
                output.append({"product_id": str(product), "forecast_date": forecast_date, "predicted_demand": predicted, "lower_bound": predicted, "upper_bound": predicted, "confidence_level": confidence_level})
            continue
        try:
            forecast_result = model_entry.get_forecast(steps=horizon)
            predictions = np.asarray(forecast_result.predicted_mean, dtype=float)
            intervals = np.asarray(forecast_result.conf_int(alpha=1 - confidence_level), dtype=float)
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"ARIMA could not generate a forecast for product '{product}'.") from exc
        if predictions.shape[0] != horizon or intervals.ndim != 2 or intervals.shape[0] != horizon or intervals.shape[1] < 2:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"ARIMA produced invalid forecast intervals for product '{product}'.")
        for index, forecast_date in enumerate(forecast_dates):
            predicted = _finite_nonnegative(predictions[index])
            lower = min(_finite_nonnegative(intervals[index, 0], predicted), predicted)
            upper = max(_finite_nonnegative(intervals[index, 1], predicted), predicted)
            output.append({"product_id": str(product), "forecast_date": forecast_date, "predicted_demand": predicted, "lower_bound": lower, "upper_bound": upper, "confidence_level": confidence_level})
    if not output:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No product-level ARIMA forecasts were generated.")
    return output


def _predict(run: ModelRun, dataframe: pd.DataFrame, horizon: int) -> list[dict[str, Any]]:
    parameters = _forecast_parameters(run)
    target_column = parameters.get("target_column")
    date_column = parameters.get("date_column")
    product_column = parameters.get("product_column")
    if not target_column or not date_column:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This model run does not contain the date configuration required for forecasting.")
    if date_column not in dataframe.columns or target_column not in dataframe.columns:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The configured target or date column is missing from the dataset.")

    confidence_level = _confidence_level(parameters)
    model = _load_artifact(run)
    if run.model_name == "ARIMA":
        if not product_column:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Product-level ARIMA requires a product column.")
        return _product_arima_forecast(model, dataframe, target_column, date_column, confidence_level, horizon)

    features, products, forecast_dates = _future_frame(dataframe, target_column, date_column, product_column, horizon)
    if hasattr(model, "feature_names_in_"):
        features = features.reindex(columns=list(model.feature_names_in_), fill_value=0)
    try:
        predictions = np.asarray(model.predict(features), dtype=float)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The trained model could not generate a forecast for this dataset.") from exc

    uncertainty = parameters.get("uncertainty", {})
    global_error_std = _finite_nonnegative(uncertainty.get("error_std"), _finite_nonnegative(run.rmse or run.mae))
    per_product_error_std = uncertainty.get("per_product_error_std", {})
    if not isinstance(per_product_error_std, dict):
        per_product_error_std = {}
    z_value = NormalDist().inv_cdf((1 + confidence_level) / 2)
    output = []
    index = 0
    for product in products:
        for forecast_date in forecast_dates:
            predicted = _finite_nonnegative(predictions[index])
            product_error_std = _finite_nonnegative(per_product_error_std.get(str(product)), global_error_std)
            horizon_scale = float(np.sqrt(index % horizon + 1))
            interval_width = max(z_value * product_error_std * horizon_scale, 0.0)
            lower = min(_finite_nonnegative(predicted - interval_width, predicted), predicted)
            upper = max(_finite_nonnegative(predicted + interval_width, predicted), predicted)
            output.append({"product_id": product, "forecast_date": forecast_date, "predicted_demand": predicted, "lower_bound": lower, "upper_bound": upper, "confidence_level": confidence_level})
            index += 1
    return output


def generate_forecasts(db: Session, run: ModelRun, dataset: Dataset, horizon: int) -> list[Forecast]:
    if horizon not in SUPPORTED_HORIZONS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Forecast horizon must be 7, 14, 30, 60, or 90 days.")
    dataframe = read_dataset(dataset)
    values = _predict(run, dataframe, horizon)
    existing = {(item.product_id, item.forecast_date): item for item in db.query(Forecast).filter(Forecast.model_run_id == run.id).all()}
    records = []
    for value in values:
        key = (value["product_id"], value["forecast_date"])
        record = existing.get(key)
        if record is None:
            record = Forecast(model_run_id=run.id, **value)
            db.add(record)
        else:
            for field, field_value in value.items():
                setattr(record, field, field_value)
        records.append(record)
    db.commit()
    for record in records:
        db.refresh(record)
    return records
