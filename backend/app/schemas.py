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
    report_id: str | None = None
    updated_at: int = 0
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
    red_score: int | None = None
    blue_score: int | None = None
    winning_alliance: str | None = None  # "red" | "blue" | "tie" | None
    # TBA Match_Simple: Unix seconds; used for "next match" countdown in War Room
    predicted_time: int | None = None
    actual_time: int | None = None
    match_number: int = 0


class MatchDetailItem(BaseModel):
    match_key: str
    comp_level: str
    match_number: int
    set_number: int
    red: list[str]
    blue: list[str]
    youtube_key: str | None = None
    played: bool = False


class StatboticsEPA(BaseModel):
    team_key: str
    epa: float


class SyncUploadIn(BaseModel):
    device_id: str
    reports: list[MatchScoutReportIn] = Field(default_factory=list)


class WinPredictIn(BaseModel):
    our_epa: float
    opponent_epa: float
    our_live_cycle_ms: list[float] = Field(default_factory=list)
    opponent_live_cycle_ms: list[float] = Field(default_factory=list)
    our_active_fuel: int = 0
    opponent_active_fuel: int = 0


class WinPredictOut(BaseModel):
    win_probability: float
    rationale: str


class StrategyPromptIn(BaseModel):
    cycle_times: list[float] = Field(default_factory=list)
    hotspots: list[str] = Field(default_factory=list)
    hub_state: HubState


class StrategyBoardIn(BaseModel):
    annotations: list[dict] = Field(default_factory=list)


class StrategyBoardOut(BaseModel):
    match_key: str
    annotations: list[dict] = Field(default_factory=list)


class OpenRouterChatIn(BaseModel):
    prompt: str
    system: str = "Sen FRC strateji asistanısın. Türkçe, net ve uygulanabilir yanıtlar ver."
    model: str | None = None
    temperature: float = 0.4
    max_tokens: int = 1200
    api_key_override: str | None = None


class OpenRouterChatOut(BaseModel):
    text: str


class TimelineEvent(BaseModel):
    t_ms: int = Field(ge=0)
    action: str
    x: float | None = None
    y: float | None = None
    value: float | int | str | None = None


class HubStateResponse(BaseModel):
    hub_state: HubState
    source: str


class RefineryRevisionIn(BaseModel):
    match_key: str
    team_key: str
    revised_events: list[TimelineEvent] = Field(default_factory=list)
    foul_notes: list[str] = Field(default_factory=list)
    inventory_capacity: int = Field(ge=0, le=30)


class RefineryRevisionOut(BaseModel):
    match_key: str
    team_key: str
    revised_count: int
    inventory_capacity: int


class OverlayPathIn(BaseModel):
    robot: str
    points: list[PathPoint] = Field(default_factory=list)


class MultiPathOverlayIn(BaseModel):
    match_key: str
    paths: list[OverlayPathIn] = Field(default_factory=list)


class CollisionWarning(BaseModel):
    robot_a: str
    robot_b: str
    t_ms: int
    x: float
    y: float


class MultiPathOverlayOut(BaseModel):
    match_key: str
    warnings: list[CollisionWarning] = Field(default_factory=list)


class TacticalInsightIn(BaseModel):
    opponent_team: str
    last_three_match_hotspots: list[str] = Field(default_factory=list)
    cycle_times: list[float] = Field(default_factory=list)


class ActiveQualificationOut(BaseModel):
    match_key: str
    red: list[str]
    blue: list[str]
    source: str


class ScoutLoginIn(BaseModel):
    username: str
    pin: str


class ScoutLoginOut(BaseModel):
    username: str
    seat: str
    role: str


class VideoFuelEntry(BaseModel):
    seat: str
    fuel_scored: int = Field(ge=0)
    max_carried: int = Field(ge=0)
    note: str = ""


class VideoFuelSubmitIn(BaseModel):
    match_key: str
    match_start_sec: float | None = None
    entries: list[VideoFuelEntry] = Field(default_factory=list)


class VideoFuelSubmitOut(BaseModel):
    match_key: str
    saved: int


class ScoutStatusIn(BaseModel):
    scout_name: str
    match_key: str
    seat: str


class ScoutStatusOut(BaseModel):
    device_id: str
    scout_name: str
    match_key: str
    seat: str
    last_seen: float
