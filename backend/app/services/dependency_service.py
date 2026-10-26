from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations
from typing import Any

import numpy as np
import pandas as pd
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Alert, Dataset, ProductDependency, Recommendation
from app.services.dataset_service import read_dataset

# Relationship thresholds are centralized so the analysis can be tuned later.
MIN_OBSERVATIONS = 5
VERY_STRONG_CORRELATION = 0.80
STRONG_CORRELATION = 0.60
MODERATE_CORRELATION = 0.40
WEAK_CORRELATION = 0.20
DEPENDENCY_ALERT_CORRELATION = VERY_STRONG_CORRELATION

DATE_ALIASES = {"date", "order date", "sales date", "transaction date", "timestamp"}
PRODUCT_ALIASES = {"product", "product id", "product name", "sku", "item", "item id"}
DEMAND_ALIASES = {"sales", "demand", "quantity", "units sold", "orders"}
PRODUCT_ID_ALIASES = {"product id", "sku", "item id", "part id"}
PRODUCT_NAME_ALIASES = {"product name", "item name", "sku name", "name of product", "product description", "item description", "name"}


@dataclass
class DependencyPair:
    product_a: str
    product_b: str
    correlation: float
    observation_count: int
    relationship_strength: str
    relationship_type: str
    dependency_score: float


def _normalise(value: Any) -> str:
    return " ".join(str(value).strip().lower().replace("_", " ").split())


def _find_column(columns: list[str], aliases: set[str], tokens: tuple[str, ...]) -> str | None:
    normalised = {_normalise(column): column for column in columns}
    for alias in aliases:
        if alias in normalised:
            return normalised[alias]
    for column in columns:
        if any(token in _normalise(column) for token in tokens):
            return column
    return None


def detect_columns(dataframe: pd.DataFrame) -> dict[str, str]:
    columns = [str(column) for column in dataframe.columns]
    date_column = _find_column(columns, DATE_ALIASES, ("date", "time", "timestamp"))
    product_column = _find_column(columns, PRODUCT_ALIASES, ("product", "sku", "item"))
    demand_column = _find_column(columns, DEMAND_ALIASES, ("sales", "demand", "quantity", "units", "orders"))
    missing = [label for label, value in (("date", date_column), ("product", product_column), ("demand", demand_column)) if value is None]
    if missing:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Dependency analysis requires compatible date, product, and demand columns. Missing: {', '.join(missing)}.")
    return {"date": date_column, "product": product_column, "demand": demand_column}


def product_identity_map(dataframe: pd.DataFrame, dependency_product_column: str) -> dict[str, dict[str, str]]:
    """Map dependency product keys to dataset-scoped IDs and names without guessing."""
    columns = [str(column) for column in dataframe.columns]
    product_id_column = _find_column(columns, PRODUCT_ID_ALIASES, ())
    product_name_column = _find_column(columns, PRODUCT_NAME_ALIASES, ())
    if product_name_column is None and _normalise(dependency_product_column) in PRODUCT_NAME_ALIASES:
        product_name_column = dependency_product_column

    selected_columns = [dependency_product_column]
    for column in (product_id_column, product_name_column):
        if column and column not in selected_columns:
            selected_columns.append(column)

    identities: dict[str, dict[str, str]] = {}
    for record in dataframe[selected_columns].to_dict(orient="records"):
        key_value = record.get(dependency_product_column)
        if pd.isna(key_value) or not str(key_value).strip():
            continue
        key = str(key_value).strip()

        id_value = record.get(product_id_column) if product_id_column else None
        product_id = "Unknown Product" if id_value is None or pd.isna(id_value) or not str(id_value).strip() else str(id_value).strip()

        name_value = record.get(product_name_column) if product_name_column else None
        product_name = "Name unavailable" if name_value is None or pd.isna(name_value) or not str(name_value).strip() else str(name_value).strip()

        identity = {"product_id": product_id, "product_name": product_name}
        lookup_values = {key}
        if product_id != "Unknown Product":
            lookup_values.add(product_id)
        if product_name != "Name unavailable":
            lookup_values.add(product_name)

        for lookup_value in lookup_values:
            current = identities.get(lookup_value)
            if current is None or current["product_name"] == "Name unavailable" and product_name != "Name unavailable":
                identities[lookup_value] = identity
    return identities


def _relationship_strength(value: float) -> str:
    absolute = abs(value)
    if absolute >= VERY_STRONG_CORRELATION:
        return "Very Strong"
    if absolute >= STRONG_CORRELATION:
        return "Strong"
    if absolute >= MODERATE_CORRELATION:
        return "Moderate"
    if absolute >= WEAK_CORRELATION:
        return "Weak"
    return "Very Weak"


def _relationship_type(value: float) -> str:
    if value >= MODERATE_CORRELATION:
        return "Positive"
    if value <= -MODERATE_CORRELATION:
        return "Negative"
    return "Neutral"


def _dependency_score(correlation: float, observation_count: int) -> float:
    # Confidence grows with observations but never exceeds the absolute
    # historical correlation; this is a relationship-strength score, not a probability.
    confidence_factor = min(1.0, observation_count / (observation_count + MIN_OBSERVATIONS))
    return round(abs(correlation) * confidence_factor * 100, 2)


def _build_matrix(dataframe: pd.DataFrame, columns: dict[str, str]) -> tuple[pd.DataFrame, list[str], list[str]]:
    frame = dataframe[[columns["date"], columns["product"], columns["demand"]]].copy()
    frame["_date"] = pd.to_datetime(frame[columns["date"]], errors="coerce")
    frame["_demand"] = pd.to_numeric(frame[columns["demand"]], errors="coerce")
    frame["_product"] = frame[columns["product"]].astype("string").str.strip()
    frame = frame.dropna(subset=["_date", "_product", "_demand"])
    if frame.empty:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No valid date, product, and demand records were found.")
    matrix = frame.pivot_table(index="_date", columns="_product", values="_demand", aggfunc="sum").sort_index()
    ignored: list[str] = []
    valid: list[str] = []
    for product in matrix.columns:
        observations = int(matrix[product].notna().sum())
        if observations < MIN_OBSERVATIONS:
            ignored.append(f"{product}: insufficient observations ({observations})")
        elif matrix[product].dropna().nunique() <= 1:
            ignored.append(f"{product}: constant demand series")
        else:
            valid.append(str(product))
    if not valid:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Insufficient data for reliable product dependency analysis.")
    return matrix[valid], valid, ignored


def _pairs(matrix: pd.DataFrame) -> list[DependencyPair]:
    pairs: list[DependencyPair] = []
    for product_a, product_b in combinations(matrix.columns, 2):
        pair_frame = matrix[[product_a, product_b]].dropna()
        if len(pair_frame) < MIN_OBSERVATIONS:
            continue
        correlation = pair_frame[product_a].corr(pair_frame[product_b])
        if pd.isna(correlation) or not np.isfinite(correlation):
            continue
        value = float(correlation)
        pairs.append(DependencyPair(
            product_a=str(product_a),
            product_b=str(product_b),
            correlation=round(value, 6),
            observation_count=int(len(pair_frame)),
            relationship_strength=_relationship_strength(value),
            relationship_type=_relationship_type(value),
            dependency_score=_dependency_score(value, len(pair_frame)),
        ))
    return pairs


def dependency_matrix(db: Session, dataset: Dataset) -> dict[str, Any]:
    dataframe = read_dataset(dataset)
    columns = detect_columns(dataframe)
    matrix, products, ignored = _build_matrix(dataframe, columns)
    correlations = matrix.corr().reindex(index=products, columns=products)
    return {
        "dataset_id": dataset.id,
        "products": products,
        "matrix": [
            [None if pd.isna(value) else round(float(value), 6) for value in row]
            for row in correlations.to_numpy()
        ],
        "data_quality": {
            "ignored_products": ignored,
            "minimum_observations": MIN_OBSERVATIONS,
        },
    }


def _pair_payload(pair: DependencyPair) -> dict[str, Any]:
    return {
        "product_a": pair.product_a,
        "product_b": pair.product_b,
        "correlation": pair.correlation,
        "observation_count": pair.observation_count,
        "relationship_strength": pair.relationship_strength,
        "relationship_type": pair.relationship_type,
        "dependency_score": pair.dependency_score,
    }


def _clusters(matrix: pd.DataFrame, pairs: list[DependencyPair]) -> tuple[list[dict[str, Any]], str | None]:
    edges = [(pair.product_a, pair.product_b) for pair in pairs if pair.relationship_type == "Positive" and abs(pair.correlation) >= STRONG_CORRELATION]
    if not edges:
        return [], "Insufficient data for reliable product clustering."
    graph: dict[str, set[str]] = {str(product): set() for product in matrix.columns}
    for left, right in edges:
        graph[left].add(right)
        graph[right].add(left)
    clusters = []
    visited: set[str] = set()
    for product in graph:
        if product in visited or not graph[product]:
            continue
        stack = [product]
        members: list[str] = []
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            members.append(current)
            stack.extend(graph[current] - visited)
        internal = [pair.correlation for pair in pairs if pair.product_a in members and pair.product_b in members and pair.relationship_type == "Positive"]
        clusters.append({"cluster_id": len(clusters) + 1, "products": sorted(members), "average_internal_correlation": round(float(np.mean(internal)), 4) if internal else None})
    return clusters, None if clusters else "Insufficient data for reliable product clustering."


def _persist_dependency_alerts(db: Session, dataset: Dataset, pairs: list[DependencyPair]) -> tuple[int, int]:
    alert_count = 0
    recommendation_count = 0
    for pair in pairs:
        if abs(pair.correlation) < DEPENDENCY_ALERT_CORRELATION:
            continue
        title = f"Strong historical relationship: {pair.product_a} and {pair.product_b}"
        alert = db.query(Alert).filter(Alert.dataset_id == dataset.id, Alert.alert_type == "DEPENDENCY RISK", Alert.title == title).first()
        if alert is None:
            severity = "MEDIUM" if abs(pair.correlation) >= 0.93 else "LOW"
            alert = Alert(
                dataset_id=dataset.id,
                alert_type="DEPENDENCY RISK",
                severity=severity,
                title=title,
                what=f"{pair.product_a} and {pair.product_b} show a strong historical demand relationship.",
                why=f"Historical demand correlation is {pair.correlation:.2f} across {pair.observation_count} observations; this indicates association, not causation.",
                when_text="Observed consistently across the analyzed historical period.",
                impact="Changes in one product's demand may coincide with changes in the other.",
                suggested_action="Monitor both products together during demand changes.",
            )
            db.add(alert)
            db.flush()
            alert_count += 1
        product_key = f"{pair.product_a} <-> {pair.product_b}"
        recommendation = db.query(Recommendation).filter(Recommendation.dataset_id == dataset.id, Recommendation.recommendation_type == "SUPPLIER / DEPENDENCY REVIEW", Recommendation.product_id == product_key).first()
        if recommendation is None:
            db.add(Recommendation(
                dataset_id=dataset.id,
                alert_id=alert.id,
                product_id=product_key,
                recommendation_type="SUPPLIER / DEPENDENCY REVIEW",
                priority="MEDIUM" if abs(pair.correlation) >= 0.93 else "LOW",
                title=f"Review dependency between {pair.product_a} and {pair.product_b}",
                what="These products show similar historical demand patterns.",
                why=f"Correlation is {pair.correlation:.2f} across {pair.observation_count} observations. This is an association signal, not causation.",
                when_text="During future demand changes and replenishment reviews.",
                impact="Monitoring both products together may provide additional context for planning.",
                suggested_action="Monitor related product demand when planning inventory; do not assume one product causes the other.",
                status="open",
            ))
            recommendation_count += 1
    return alert_count, recommendation_count


def analyze_dependencies(db: Session, dataset: Dataset) -> dict[str, Any]:
    dataframe = read_dataset(dataset)
    columns = detect_columns(dataframe)
    matrix, products, ignored = _build_matrix(dataframe, columns)
    pairs = _pairs(matrix)
    positive = sorted([pair for pair in pairs if pair.relationship_type == "Positive"], key=lambda pair: pair.correlation, reverse=True)
    negative = sorted([pair for pair in pairs if pair.relationship_type == "Negative"], key=lambda pair: pair.correlation)
    clusters, cluster_message = _clusters(matrix, pairs)

    db.query(ProductDependency).filter(ProductDependency.dataset_id == dataset.id).delete(synchronize_session=False)
    for pair in pairs:
        db.add(ProductDependency(dataset_id=dataset.id, **_pair_payload(pair)))
    alert_count, recommendation_count = _persist_dependency_alerts(db, dataset, pairs)
    db.commit()

    matrix_payload = {
        "products": products,
        "values": [[None if pd.isna(value) else round(float(value), 4) for value in row] for row in matrix.corr().reindex(index=products, columns=products).to_numpy()],
    }
    return {
        "dataset_id": dataset.id,
        "columns": columns,
        "products_analyzed": len(products),
        "relationships_found": len(pairs),
        "top_positive_relationships": [_pair_payload(pair) for pair in positive[:10]],
        "top_negative_relationships": [_pair_payload(pair) for pair in negative[:10]],
        "clusters": clusters,
        "cluster_message": cluster_message,
        "matrix": matrix_payload,
        "data_quality": {"ignored_products": ignored, "minimum_observations": MIN_OBSERVATIONS, "valid_observations": int(matrix.notna().sum().sum())},
        "alerts_generated": alert_count,
        "recommendations_generated": recommendation_count,
    }
