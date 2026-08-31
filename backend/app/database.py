import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL") or ""

# Render and Heroku often provide postgres:// which SQLAlchemy 2 rejects.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://") :]

# Render Postgres requires SSL. Fail fast instead of hanging.
if (
    DATABASE_URL.startswith("postgresql")
    and "sslmode=" not in DATABASE_URL
    and "render.com" in DATABASE_URL
):
    joiner = "&" if "?" in DATABASE_URL else "?"
    DATABASE_URL = f"{DATABASE_URL}{joiner}sslmode=require"

_engine_kwargs = {
    "echo": os.getenv("SQL_ECHO", "").lower() in {"1", "true", "yes"},
    "pool_pre_ping": True,
}
if DATABASE_URL.startswith("postgresql"):
    _engine_kwargs["connect_args"] = {"connect_timeout": 10}

engine = create_engine(DATABASE_URL, **_engine_kwargs)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False
)


def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()