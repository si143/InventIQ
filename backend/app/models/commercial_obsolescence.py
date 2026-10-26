from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class CommercialObsolescence(Base):
    __tablename__ = "commercial_obsolescence"
    __table_args__ = (
        Index("ix_commercial_obsolescence_dataset_product", "dataset_id", "product_id", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    product_id: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    product_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[str | None] = mapped_column(String(255), nullable=True)
    risk_score: Mapped[float] = mapped_column(Float, nullable=False)
    risk_level: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    recent_demand: Mapped[float | None] = mapped_column(Float, nullable=True)
    historical_demand: Mapped[float | None] = mapped_column(Float, nullable=True)
    decline_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    recent_velocity: Mapped[float | None] = mapped_column(Float, nullable=True)
    trend: Mapped[str] = mapped_column(String(50), nullable=False)
    forecast_demand: Mapped[float | None] = mapped_column(Float, nullable=True)
    forecast_lower_bound: Mapped[float | None] = mapped_column(Float, nullable=True)
    forecast_upper_bound: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence_level: Mapped[float | None] = mapped_column(Float, nullable=True)
    observations: Mapped[int] = mapped_column(Integer, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_action: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )