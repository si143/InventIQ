from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import CurrentUser, get_dataset_for_user
from app.models import Dataset, RecoveryPlan
from app.services.recovery_service import build_recovery_plan

router = APIRouter(prefix="/api/recovery-planner", tags=["recovery-planner"])


class RecoveryPlanRequest(BaseModel):
    dataset_id: int
    product_id: str
    opportunity: str
    priority: str
    evidence: str
    suggested_action: str


@router.get("")
def recovery_planner(
    dataset_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    dataset = get_dataset_for_user(dataset_id, user, db)
    return build_recovery_plan(db, dataset)


@router.post("/plans")
def save_recovery_plan(
    request: RecoveryPlanRequest,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    if request.priority not in {"High", "Moderate", "Low"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Recovery priority must be High, Moderate, or Low.")
    dataset = get_dataset_for_user(request.dataset_id, user, db)
    existing = db.query(RecoveryPlan).filter(
        RecoveryPlan.dataset_id == request.dataset_id,
        RecoveryPlan.product_id == request.product_id,
        RecoveryPlan.status == "open",
    ).first()
    if existing:
        existing.opportunity = request.opportunity
        existing.priority = request.priority
        existing.evidence = request.evidence
        existing.suggested_action = request.suggested_action
        db.commit()
        db.refresh(existing)
        return _serialize_plan(existing)
    plan = RecoveryPlan(**request.model_dump())
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return _serialize_plan(plan)


@router.get("/plans")
def list_recovery_plans(
    dataset_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
):
    return [_serialize_plan(plan) for plan in db.query(RecoveryPlan).filter(RecoveryPlan.dataset_id == dataset_id, Dataset.user_id == user.id).join(Dataset, RecoveryPlan.dataset_id == Dataset.id).order_by(RecoveryPlan.created_at.desc()).all()]


def _serialize_plan(plan: RecoveryPlan) -> dict:
    return {
        "id": plan.id,
        "dataset_id": plan.dataset_id,
        "product_id": plan.product_id,
        "opportunity": plan.opportunity,
        "priority": plan.priority,
        "evidence": plan.evidence,
        "suggested_action": plan.suggested_action,
        "status": plan.status,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
    }
