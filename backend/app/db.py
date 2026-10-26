"""SQLAlchemy database engine and session factory.

This module contains the core database connection configuration plus the
safe initialization routines that were previously split across `db_init.py`.
Credentials are read from environment variables and a local `.env` file.
"""

from __future__ import annotations

from urllib.parse import quote_plus

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import (
    DB_HOST,
    DB_MAX_OVERFLOW,
    DB_NAME,
    DB_POOL_PRE_PING,
    DB_POOL_RECYCLE,
    DB_POOL_SIZE,
    DB_POOL_TIMEOUT,
    DB_PORT,
    DB_USER,
    DB_PASSWORD,
    DATABASE_URL,
)

engine_options = {
    "echo": False,
    "pool_pre_ping": DB_POOL_PRE_PING,
}
if DATABASE_URL.startswith("sqlite:"):
    engine_options["connect_args"] = {"check_same_thread": False}
else:
    engine_options.update({
        "pool_size": DB_POOL_SIZE,
        "max_overflow": DB_MAX_OVERFLOW,
        "pool_timeout": DB_POOL_TIMEOUT,
        "pool_recycle": DB_POOL_RECYCLE,
    })

engine: Engine = create_engine(DATABASE_URL, **engine_options)

if engine.dialect.name == "sqlite":
    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


def ensure_dataset_storage_column() -> None:
    """Add the optional file reference for existing installations."""
    columns = {column["name"] for column in inspect(engine).get_columns("datasets")}
    if "storage_path" in columns:
        return

    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE datasets ADD COLUMN storage_path VARCHAR(500) NULL"))


def ensure_model_run_columns() -> None:
    """Add optional training artifact fields for existing installations."""
    columns = {column["name"] for column in inspect(engine).get_columns("model_runs")}
    with engine.begin() as conn:
        if "artifact_path" not in columns:
            conn.execute(text("ALTER TABLE model_runs ADD COLUMN artifact_path VARCHAR(500) NULL"))
        if "error_message" not in columns:
            conn.execute(text("ALTER TABLE model_runs ADD COLUMN error_message TEXT NULL"))


def ensure_forecasting_constraints() -> None:
    """Add forecasting foreign keys and logical forecast uniqueness safely."""
    if engine.dialect.name == "sqlite":
        return

    inspector = inspect(engine)
    model_run_foreign_keys = inspector.get_foreign_keys("model_runs")
    forecast_foreign_keys = inspector.get_foreign_keys("forecasts")
    forecast_indexes = inspector.get_indexes("forecasts")

    with engine.begin() as conn:
        if not any(
            key.get("constrained_columns") == ["dataset_id"]
            and key.get("referred_table") == "datasets"
            for key in model_run_foreign_keys
        ):
            conn.execute(text(
                "ALTER TABLE model_runs ADD CONSTRAINT fk_model_runs_dataset_id "
                "FOREIGN KEY (dataset_id) REFERENCES datasets (id) ON DELETE CASCADE"
            ))

        if not any(
            key.get("constrained_columns") == ["model_run_id"]
            and key.get("referred_table") == "model_runs"
            for key in forecast_foreign_keys
        ):
            conn.execute(text(
                "ALTER TABLE forecasts ADD CONSTRAINT fk_forecasts_model_run_id "
                "FOREIGN KEY (model_run_id) REFERENCES model_runs (id) ON DELETE CASCADE"
            ))

        has_unique_forecast_key = any(
            index.get("unique")
            and index.get("column_names") == ["model_run_id", "product_id", "forecast_date"]
            for index in forecast_indexes
        )
        if not has_unique_forecast_key:
            conn.execute(text(
                "ALTER TABLE forecasts ADD CONSTRAINT uq_forecasts_run_product_date "
                "UNIQUE (model_run_id, product_id, forecast_date)"
            ))


def ensure_recommendations_table() -> None:
    """Create the recommendation table without changing existing tables."""
    from app.models import Recommendation

    Recommendation.__table__.create(bind=engine, checkfirst=True)


def ensure_product_dependencies_table() -> None:
    """Create the normalized product relationship table safely."""
    from app.models import ProductDependency

    ProductDependency.__table__.create(bind=engine, checkfirst=True)


def ensure_commercial_obsolescence_table() -> None:
    """Create the commercial obsolescence table safely."""
    from app.models import CommercialObsolescence

    CommercialObsolescence.__table__.create(bind=engine, checkfirst=True)


def ensure_recovery_plans_table() -> None:
    """Create the explicitly saved recovery-plan table safely."""
    from app.models import RecoveryPlan

    RecoveryPlan.__table__.create(bind=engine, checkfirst=True)


def ensure_user_columns() -> None:
    """Add the is_active column for existing installations."""
    columns = {column["name"] for column in inspect(engine).get_columns("users")}
    if "is_active" in columns:
        return

    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE NOT NULL"))


def ensure_database() -> bool:
    """Create the configured database when using a server-backed database."""
    if not DATABASE_URL.startswith("mysql"):
        return True

    db_user = quote_plus(DB_USER, safe="")
    db_password = quote_plus(DB_PASSWORD, safe="")
    server_url = f"mysql+pymysql://{db_user}:{db_password}@{DB_HOST}:{DB_PORT}/"
    server_engine = create_engine(server_url, pool_pre_ping=True)
    with server_engine.connect() as conn:
        result = conn.execute(text("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = :name"), {"name": DB_NAME})
        if result.scalar() is not None:
            return True
        conn.execute(text(f"CREATE DATABASE `{DB_NAME}`"))
        conn.commit()
    return True


def initialize_tables() -> None:
    """Create tables and apply safe migration checks."""
    ensure_database()
    from app.models import Base

    Base.metadata.create_all(bind=engine)
    ensure_dataset_storage_column()
    ensure_model_run_columns()
    ensure_forecasting_constraints()
    ensure_recommendations_table()
    ensure_product_dependencies_table()
    ensure_commercial_obsolescence_table()
    ensure_recovery_plans_table()
    ensure_user_columns()


def get_db():
    """Yield a transactional database session for a single request."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_connection() -> bool:
    """Return True if the engine can execute a trivial query."""
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return True


__all__ = [
    "engine",
    "SessionLocal",
    "ensure_dataset_storage_column",
    "ensure_model_run_columns",
    "ensure_forecasting_constraints",
    "ensure_recommendations_table",
    "ensure_product_dependencies_table",
    "ensure_commercial_obsolescence_table",
    "ensure_recovery_plans_table",
    "ensure_user_columns",
    "ensure_database",
    "initialize_tables",
    "get_db",
    "check_connection",
]