"""
Database engine and session configuration.
Currently using SQLite for development. To switch to PostgreSQL,
change SQLALCHEMY_DATABASE_URL to: "postgresql://user:password@localhost/prescriptoai"
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# Database URL — configurable via environment variable
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "sqlite:///./prescripto.db"
)

# SQLite requires check_same_thread=False for FastAPI's async usage
connect_args = {"check_same_thread": False} if "sqlite" in DATABASE_URL else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


def get_db():
    """Dependency that provides a database session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables in the database."""
    from database import models  # noqa: F401 — import so models are registered
    Base.metadata.create_all(bind=engine)
