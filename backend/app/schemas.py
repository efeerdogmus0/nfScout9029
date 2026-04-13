from pydantic import BaseModel, Field

from app.models import HubState, TowerLevel


class PathPoint(BaseModel):
    t_ms: int = Field(ge=0)
    x: float
    y: float


class LocationPing(BaseModel):
    t_ms: int = Field(ge=0)
    x: float
    y: float
    near_bump: bool = False
    near_trench: bool = False


class MatchScoutReportIn(BaseModel):
    event_key: str
    match_key: str
    team_key: str
    scout_device_id: str
    auto_path_points: list[PathPoint] = Field(default_factory=list)
    auto_fuel_scored: int = 0
    teleop_fuel_scored_active: int = 0
    teleop_fuel_scored_inactive: int = 0
    hub_state_samples: list[HubState] = Field(default_factory=list)
    bump_slow_or_stuck: bool = False
    trench_slow_or_stuck: bool = False
    tower_level: TowerLevel = TowerLevel.NONE
    teleop_shoot_timestamps_ms: list[int] = Field(default_factory=list)
    location_pings: list[LocationPing] = Field(default_factory=list)
    notes: str | None = None


class MatchScoutReportOut(MatchScoutReportIn):
    id: int


class MatchScheduleItem(BaseModel):
    match_key: str
    red: list[str]
    blue: list[str]


class StatboticsEPA(BaseModel):
    team_key: str
    epa: float
