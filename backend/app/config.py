"""Application configuration.

Database credentials are read from environment variables, with a local
`.env` file loaded automatically by `python-dotenv` during development.

The real `.env` file is git-ignored; only `.env.example` is committed.
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv

# Load variables from a local .env file if present (development only).
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

DB_HOST: str = os.getenv("DB_HOST", "localhost")
DB_PORT: int = int(os.getenv("DB_PORT", "3306"))
DB_USER: str = os.getenv("DB_USER", "inventiq_app")
DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
DB_NAME: str = os.getenv("DB_NAME", "inventiq")

# URL-encode the username and password so special characters (e.g. '@', '#',
# spaces) in the credential do not break SQLAlchemy's URL parser. Without
# this, a password containing '@' is misparsed as the host portion of the URL.
DB_USER_ENCODED: str = quote_plus(DB_USER, safe="")
DB_PASSWORD_ENCODED: str = quote_plus(DB_PASSWORD, safe="")

DEFAULT_SQLITE_PATH = Path(__file__).resolve().parents[1] / "inventiq.db"
DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{DEFAULT_SQLITE_PATH.as_posix()}",
)

# Optional pool tuning.
DB_POOL_SIZE: int = int(os.getenv("DB_POOL_SIZE", "5"))
DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "10"))
DB_POOL_TIMEOUT: int = int(os.getenv("DB_POOL_TIMEOUT", "30"))
DB_POOL_RECYCLE: int = int(os.getenv("DB_POOL_RECYCLE", "3600"))
DB_POOL_PRE_PING: bool = os.getenv("DB_POOL_PRE_PING", "true").lower() in {
    "1",
    "true",
    "yes",
}

JWT_SECRET_KEY: str = os.getenv(
    "JWT_SECRET_KEY",
    "inventiq-local-development-secret-change-before-deployment",
)
JWT_ALGORITHM: str = "HS256"
JWT_EXPIRY_MINUTES: int = int(os.getenv("JWT_EXPIRY_MINUTES", "30"))