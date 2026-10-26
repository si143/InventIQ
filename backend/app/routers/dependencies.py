from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import CurrentUser, get_dataset_for_user
from app.models import Dataset, ProductDependency
from app.schemas.requests import DependencyAnalyzeRequest
from app.services.dataset_service import read_dataset
from app.services.dependency_service import analyze_dependencies, dependency_matrix, detect_columns, product_identity_map

router = APIRouter(prefix="/api/dependencies", tags=["dependencies"])


def _identity_maps(db: Session, user_id: int, dataset_ids: set[int]) -> dict[int, dict[str, dict[str, str]]]:
    if not dataset_ids:
        return {}

    datasets = db.query(Dataset).filter(Dataset.user_id == user_id, Dataset.id.in_(dataset_ids)).all()
    identities_by_dataset = {}
    for dataset in datasets:
        try:
            dataframe = read_dataset(dataset)
            product_column = detect_columns(dataframe)["product"]
            identities_by_dataset[dataset.id] = product_identity_map(dataframe, product_column)
        except HTTPException:
            identities_by_dataset[dataset.id] = {}
    return identities_by_dataset


def _with_product_names(payload: dict, identities: dict[str, dict[str, str]]) -> dict:
    product_a = identities.get(str(payload.get("product_a", "")), {})
    product_b = identities.get(str(payload.get("product_b", "")), {})
    return {
        **payload,
        "product_a_id": product_a.get("product_id", "Unknown Product"),
        "product_a_name": product_a.get("product_name", "Name unavailable"),
        "product_b_id": product_b.get("product_id", "Unknown Product"),
        "product_b_name": product_b.get("product_name", "Name unavailable"),
    }


def _serialize(
    dependency: ProductDependency,
    identities_by_dataset: dict[int, dict[str, dict[str, str]]] | None = None,
) -> dict:
    payload = {
        "id": dependency.id,
        "dataset_id": dependency.dataset_id,
        "product_a": dependency.product_a,
        "product_b": dependency.product_b,
        "correlation": dependency.correlation,
        "observation_count": dependency.observation_count,
        "relationship_strength": dependency.relationship_strength,
        "relationship_type": dependency.relationship_type,
        "dependency_score": dependency.dependency_score,
        "created_at": dependency.created_at.isoformat() if dependency.created_at else None,
    }
    identities = (identities_by_dataset or {}).get(dependency.dataset_id, {})
    return _with_product_names(payload, identities)


def _query(
    db: Session,
    user_id: int,
    dataset_id: int | None = None,
    product: str | None = None,
    relationship_type: str | None = None,
    minimum_correlation: float | None = None,
    search: str | None = None,
    matching_product_keys_by_dataset: dict[int, set[str]] | None = None,
):
    query = db.query(ProductDependency).filter(Dataset.id == ProductDependency.dataset_id, Dataset.user_id == user_id)
    if dataset_id is not None:
        query = query.filter(ProductDependency.dataset_id == dataset_id)
    if product:
        query = query.filter((ProductDependency.product_a == product) | (ProductDependency.product_b == product))
    if relationship_type:
        query = query.filter(ProductDependency.relationship_type == relationship_type.title())
    if minimum_correlation is not None:
        query = query.filter(func.abs(ProductDependency.correlation) >= minimum_correlation)
    if search:
        needle = f"%{search}%"
        search_filters = [ProductDependency.product_a.like(needle), ProductDependency.product_b.like(needle)]
        for scoped_dataset_id, matching_keys in (matching_product_keys_by_dataset or {}).items():
            if matching_keys:
                search_filters.append(and_(
                    ProductDependency.dataset_id == scoped_dataset_id,
                    or_(ProductDependency.product_a.in_(matching_keys), ProductDependency.product_b.in_(matching_keys)),
                ))
        query = query.filter(or_(*search_filters))
    return query.order_by(ProductDependency.dependency_score.desc(), ProductDependency.id.asc())


@router.post("/analyze")
def analyze(
    request: DependencyAnalyzeRequest,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    dataset = get_dataset_for_user(request.dataset_id, user, db)
    result = analyze_dependencies(db, dataset)
    identities = _identity_maps(db, user.id, {dataset.id}).get(dataset.id, {})
    for key in ("top_positive_relationships", "top_negative_relationships"):
        result[key] = [_with_product_names(item, identities) for item in result[key]]
    return result


@router.get("/summary")
def summary(
    user: CurrentUser,
    db: Session = Depends(get_db),
    dataset_id: int | None = None,
):
    dependencies = _query(db, user.id, dataset_id).all()
    positive = [dependency for dependency in dependencies if dependency.relationship_type == "Positive"]
    negative = [dependency for dependency in dependencies if dependency.relationship_type == "Negative"]
    identities_by_dataset = _identity_maps(db, user.id, {dependency.dataset_id for dependency in dependencies})
    products = {dependency.product_a for dependency in dependencies} | {dependency.product_b for dependency in dependencies}
    return {
        "products_analyzed": len(products),
        "total_relationships": len(dependencies),
        "strong_relationships": sum(dependency.relationship_strength in {"Strong", "Very Strong"} for dependency in dependencies),
        "positive_relationships": len(positive),
        "negative_relationships": len(negative),
        "average_absolute_correlation": round(sum(abs(dependency.correlation) for dependency in dependencies) / len(dependencies), 4) if dependencies else 0,
        "top_positive_relationship": _serialize(max(positive, key=lambda dependency: dependency.correlation), identities_by_dataset) if positive else None,
        "top_negative_relationship": _serialize(min(negative, key=lambda dependency: dependency.correlation), identities_by_dataset) if negative else None,
    }


@router.get("/matrix")
def matrix(
    dataset_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    dataset = get_dataset_for_user(dataset_id, user, db)
    result = dependency_matrix(db, dataset)
    dataframe = read_dataset(dataset)
    identities = product_identity_map(dataframe, detect_columns(dataframe)["product"])
    result["product_names"] = {
        product: identities.get(str(product), {}).get("product_name", "Name unavailable")
        for product in result["products"]
    }
    result["product_ids"] = {
        product: identities.get(str(product), {}).get("product_id", "Unknown Product")
        for product in result["products"]
    }
    return result


@router.get("")
def list_dependencies(
    user: CurrentUser,
    db: Session = Depends(get_db),
    dataset_id: int | None = None,
    product: str | None = None,
    relationship_type: str | None = None,
    minimum_correlation: float | None = Query(default=None, ge=-1, le=1),
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    identity_dataset_ids = {
        row[0]
        for row in db.query(Dataset.id).filter(
            Dataset.user_id == user.id,
            *([Dataset.id == dataset_id] if dataset_id is not None else []),
        ).all()
    } if search else set()
    identities_by_dataset = _identity_maps(db, user.id, identity_dataset_ids)
    matching_product_keys_by_dataset = None
    if search:
        needle = search.casefold()
        matching_product_keys_by_dataset = {
            scoped_dataset_id: {
                key
                for key, identity in identities.items()
                if needle in key.casefold()
                or needle in identity["product_id"].casefold()
                or needle in identity["product_name"].casefold()
            }
            for scoped_dataset_id, identities in identities_by_dataset.items()
        }
    query = _query(db, user.id, dataset_id, product, relationship_type, minimum_correlation, search, matching_product_keys_by_dataset)
    total = query.count()
    dependencies = query.offset((page - 1) * page_size).limit(page_size).all()
    if not identities_by_dataset:
        identities_by_dataset = _identity_maps(db, user.id, {dependency.dataset_id for dependency in dependencies})
    return {"items": [_serialize(dependency, identities_by_dataset) for dependency in dependencies], "total": total, "page": page, "page_size": page_size}


@router.get("/products/{product_id}")
def product_dependencies(
    product_id: str,
    user: CurrentUser,
    db: Session = Depends(get_db),
    dataset_id: int | None = None,
):
    dependencies = _query(db, user.id, dataset_id, product=product_id).all()
    identities_by_dataset = _identity_maps(db, user.id, {dependency.dataset_id for dependency in dependencies})
    return {"product_id": product_id, "relationships": [_serialize(dependency, identities_by_dataset) for dependency in dependencies]}


@router.get("/{dependency_id}")
def get_dependency(
    dependency_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
    dataset_id: int | None = None,
):
    query = db.query(ProductDependency).filter(ProductDependency.id == dependency_id).join(Dataset, ProductDependency.dataset_id == Dataset.id).filter(Dataset.user_id == user.id)
    if dataset_id is not None:
        query = query.filter(ProductDependency.dataset_id == dataset_id)
    dependency = query.first()
    if dependency is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product dependency not found.")
    identities_by_dataset = _identity_maps(db, user.id, {dependency.dataset_id})
    return _serialize(dependency, identities_by_dataset)
