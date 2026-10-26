from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ProductDependency(Base):
    __tablename__ = "product_dependencies"
    __table_args__ = (
        Index("ix_product_dependencies_dataset_pair", "dataset_id", "product_a", "product_b", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    product_a: Mapped[str] = mapped_column(String(255), nullable=False)
    product_b: Mapped[str] = mapped_column(String(255), nullable=False)
    correlation: Mapped[float] = mapped_column(Float, nullable=False)
    observation_count: Mapped[int] = mapped_column(Integer, nullable=False)
    relationship_strength: Mapped[str] = mapped_column(String(50), nullable=False)
    relationship_type: Mapped[str] = mapped_column(String(20), nullable=False)
    dependency_score: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
