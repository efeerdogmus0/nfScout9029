import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import text

from app.models import Base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+pysqlite:///./rebuilt.db")

engine = create_engine(DATABASE_URL, future=True)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, class_=Session)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _run_postgres_migrations()


def _run_postgres_migrations() -> None:
    if engine.dialect.name != "postgresql":
        return
    statements = [
        "ALTER TABLE sync_upload_receipts ALTER COLUMN updated_at TYPE BIGINT USING updated_at::bigint",
        "ALTER TABLE presence_field_seats ALTER COLUMN updated_at TYPE BIGINT USING updated_at::bigint",
        "ALTER TABLE presence_role_sessions ALTER COLUMN updated_at TYPE BIGINT USING updated_at::bigint",
        "ALTER TABLE pit_scout_reports ALTER COLUMN updated_at TYPE BIGINT USING updated_at::bigint",
        "ALTER TABLE video_fuel_submissions ALTER COLUMN updated_at TYPE BIGINT USING updated_at::bigint",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
            except Exception:
                # Table may not exist yet on fresh installs; create_all handles it.
                pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
