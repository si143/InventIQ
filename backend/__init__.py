"""InventIQ backend entry point.

Run with::

    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

or via the project script::

    python -m app.main
"""

from app.main import app

__all__ = ["app"]