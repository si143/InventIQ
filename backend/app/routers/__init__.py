"""API routers package."""

from app.routers import health
from app.routers import obsolescence
from app.routers import simulations

__all__ = ["health", "obsolescence", "simulations"]