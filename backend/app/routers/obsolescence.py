from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import CurrentUser, get_dataset_for_user
from app.models import CommercialObsolescence, Dataset
from app.services.obsolescence_service import analyze_obsolescence

router = APIRouter(prefix="/api/obsolescence", tags=["obsolescence"])


class ObsolescenceAnalyzeRequest(BaseModel):
    dataset_id: int


def _serialize(record: CommercialObsolescence) -> dict:
    return {column.name: getattr(record, column.name) for column in CommercialObsolescence.__table__.columns}


def _query(db: Session, user_id: int, dataset_id: int | None = None, risk_level: str | None = None, category: str | None = None, product: str | None = None):
    query = db.query(CommercialObsolescence).join(Dataset, CommercialObsolescence.dataset_id == Dataset.id).filter(Dataset.user_id == user_id)
    if dataset_id is not None:
        query = query.filter(CommercialObsolescence.dataset_id == dataset_id)
    if risk_level:
        query = query.filter(CommercialObsolescence.risk_level.ilike(risk_level))
    if category:
        query = query.filter(CommercialObsolescence.category.ilike(category))
    if product:
        query = query.filter((CommercialObsolescence.product_id.ilike(f"%{product}%")) | (CommercialObsolescence.product_name.ilike(f"%{product}%")))
    return query.order_by(CommercialObsolescence.risk_score.desc(), CommercialObsolescence.product_id.asc())


@router.post("/analyze")
def analyze(
    request: ObsolescenceAnalyzeRequest,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    dataset = get_dataset_for_user(request.dataset_id, user, db)
    records = analyze_obsolescence(db, dataset)
    counts = {level: sum(record.risk_level.lower() == level.lower() for record in records) for level in ("critical", "high", "moderate", "low")}
    return {"dataset_id": dataset.id, "products_analyzed": len(records), "critical_risk_count": counts["critical"], "high_risk_count": counts["high"], "moderate_risk_count": counts["moderate"], "low_risk_count": counts["low"], "insufficient_data_count": sum(record.risk_level == "Insufficient Data" for record in records), "results": [_serialize(record) for record in records]}


@router.get("")
def list_obsolescence(
    user: CurrentUser,
    db: Session = Depends(get_db),
    dataset_id: int | None = None,
    risk_level: str | None = None,
    category: str | None = None,
    search: str | None = Query(default=None),
):
    return [_serialize(record) for record in _query(db, user.id, dataset_id, risk_level, category, search).all()]


@router.get("/summary")
def summary(
    user: CurrentUser,
    db: Session = Depends(get_db),
    dataset_id: int | None = None,
):
    records = _query(db, user.id, dataset_id).all()
    return {"dataset_id": dataset_id, "products_analyzed": len(records), "critical_risk_count": sum(item.risk_level == "Critical" for item in records), "high_risk_count": sum(item.risk_level == "High" for item in records), "moderate_risk_count": sum(item.risk_level == "Moderate" for item in records), "low_risk_count": sum(item.risk_level == "Low" for item in records), "insufficient_data_count": sum(item.risk_level == "Insufficient Data" for item in records)}


@router.get("/products/{product_id}")
def product_obsolescence(
    product_id: str,
    user: CurrentUser,
    db: Session = Depends(get_db),
    dataset_id: int | None = None,
):
    record = _query(db, user.id, dataset_id, product=product_id).filter(CommercialObsolescence.product_id == product_id).first()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Obsolescence analysis not found for product.")
    return _serialize(record)


@router.get("/{obsolescence_id}")
def get_obsolescence(
    obsolescence_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    record = db.query(CommercialObsolescence).join(Dataset, CommercialObsolescence.dataset_id == Dataset.id).filter(CommercialObsolescence.id == obsolescence_id, Dataset.user_id == user.id).first()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Obsolescence analysis not found.")
    return _serialize(record)
