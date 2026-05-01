from enum import Enum
from typing import Any

from sqlalchemy import JSON, BigInteger, Boolean, Enum as SAEnum, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class HubState(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class TerrainZone(str, Enum):
    BUMP = "bump"
    TRENCH = "trench"


class TowerLevel(str, Enum):
    NONE = "none"
    LEVEL_1 = "level_1"
    LEVEL_2 = "level_2"
    LEVEL_3 = "level_3"


class MatchStrategyBoard(Base):
    __tablename__ = "match_strategy_boards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_key: Mapped[str] = mapped_column(String(32), index=True, unique=True)
    annotations: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)

class MatchScoutReport(Base):
    __tablename__ = "match_scout_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_key: Mapped[str] = mapped_column(String(32), index=True)
    match_key: Mapped[str] = mapped_column(String(32), index=True)
    team_key: Mapped[str] = mapped_column(String(16), index=True)
    scout_device_id: Mapped[str] = mapped_column(String(64), index=True)

    auto_path_points: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    auto_fuel_scored: Mapped[int] = mapped_column(Integer, default=0)
    teleop_fuel_scored_active: Mapped[int] = mapped_column(Integer, default=0)
    teleop_fuel_scored_inactive: Mapped[int] = mapped_column(Integer, default=0)

    bump_slow_or_stuck: Mapped[bool] = mapped_column(Boolean, default=False)
    trench_slow_or_stuck: Mapped[bool] = mapped_column(Boolean, default=False)
    tower_level: Mapped[TowerLevel] = mapped_column(SAEnum(TowerLevel), default=TowerLevel.NONE)

    teleop_shoot_timestamps_ms: Mapped[list[int]] = mapped_column(JSON, default=list)
    location_pings: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)


class SyncUploadReceipt(Base):
    __tablename__ = "sync_upload_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    device_id: Mapped[str] = mapped_column(String(64), index=True)
    match_key: Mapped[str] = mapped_column(String(32), index=True)
    team_key: Mapped[str] = mapped_column(String(16), index=True)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=0)
    report_row_id: Mapped[int] = mapped_column(Integer, index=True)


class PresenceFieldSeat(Base):
    __tablename__ = "presence_field_seats"

    seat: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    updated_at: Mapped[int] = mapped_column(BigInteger, index=True, default=0)


class PresenceRoleSession(Base):
    __tablename__ = "presence_role_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    role: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(128))
    seat: Mapped[str] = mapped_column(String(32))
    updated_at: Mapped[int] = mapped_column(BigInteger, index=True, default=0)


class AdminSharedConfig(Base):
    __tablename__ = "admin_shared_config"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(256), default="")


class PitScoutReport(Base):
    __tablename__ = "pit_scout_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_key: Mapped[str] = mapped_column(String(32), index=True)
    team_key: Mapped[str] = mapped_column(String(16), index=True)
    report: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    updated_at: Mapped[int] = mapped_column(BigInteger, index=True, default=0)


class VideoFuelSubmission(Base):
    __tablename__ = "video_fuel_submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_key: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    match_start_sec: Mapped[float | None] = mapped_column(nullable=True)
    entries: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    updated_at: Mapped[int] = mapped_column(BigInteger, index=True, default=0)
