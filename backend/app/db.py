import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.models import Base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+pysqlite:///./rebuilt.db")

engine = create_engine(DATABASE_URL, future=True)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, class_=Session)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
