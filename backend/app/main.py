import os

from fastapi import Depends, FastAPI
from sqlalchemy.orm import Session

from app.db import get_db, init_db
from app.models import HubState, MatchScoutReport
from app.schemas import MatchScheduleItem, MatchScoutReportIn, MatchScoutReportOut, StatboticsEPA
from app.services import fetch_statbotics_epa, fetch_tba_schedule

app = FastAPI(title="FRC REBUILT Scouting API", version="0.1.0")


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/reports", response_model=MatchScoutReportOut)
def create_report(payload: MatchScoutReportIn, db: Session = Depends(get_db)) -> MatchScoutReportOut:
    report = MatchScoutReport(
        event_key=payload.event_key,
        match_key=payload.match_key,
        team_key=payload.team_key,
        scout_device_id=payload.scout_device_id,
        auto_path_points=[p.model_dump() for p in payload.auto_path_points],
        auto_fuel_scored=payload.auto_fuel_scored,
        teleop_fuel_scored_active=payload.teleop_fuel_scored_active,
        teleop_fuel_scored_inactive=payload.teleop_fuel_scored_inactive,
        bump_slow_or_stuck=payload.bump_slow_or_stuck,
        trench_slow_or_stuck=payload.trench_slow_or_stuck,
        tower_level=payload.tower_level,
        teleop_shoot_timestamps_ms=payload.teleop_shoot_timestamps_ms,
        location_pings=[p.model_dump() for p in payload.location_pings],
        notes=payload.notes,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return MatchScoutReportOut(
        id=report.id,
        event_key=report.event_key,
        match_key=report.match_key,
        team_key=report.team_key,
        scout_device_id=report.scout_device_id,
        auto_path_points=report.auto_path_points,
        auto_fuel_scored=report.auto_fuel_scored,
        teleop_fuel_scored_active=report.teleop_fuel_scored_active,
        teleop_fuel_scored_inactive=report.teleop_fuel_scored_inactive,
        hub_state_samples=[],
        bump_slow_or_stuck=report.bump_slow_or_stuck,
        trench_slow_or_stuck=report.trench_slow_or_stuck,
        tower_level=report.tower_level,
        teleop_shoot_timestamps_ms=report.teleop_shoot_timestamps_ms,
        location_pings=report.location_pings,
        notes=report.notes,
    )


@app.get("/events/{event_key}/schedule", response_model=list[MatchScheduleItem])
async def event_schedule(event_key: str) -> list[MatchScheduleItem]:
    schedule = await fetch_tba_schedule(event_key, api_key=os.getenv("TBA_API_KEY"))
    items: list[MatchScheduleItem] = []
    for match in schedule:
        alliances = match.get("alliances", {})
        red = alliances.get("red", {}).get("team_keys", [])
        blue = alliances.get("blue", {}).get("team_keys", [])
        items.append(MatchScheduleItem(match_key=match["key"], red=red, blue=blue))
    return items


@app.get("/teams/{team_key}/epa", response_model=StatboticsEPA)
async def team_epa(team_key: str) -> StatboticsEPA:
    payload = await fetch_statbotics_epa(team_key)
    return StatboticsEPA(team_key=team_key, epa=payload.get("epa", {}).get("total_points", 0.0))


@app.post("/strategy/prompt")
def strategy_prompt(cycle_times: list[float], hotspots: list[str], hub_state: HubState) -> dict[str, str]:
    prompt = (
        "You are an FRC strategy analyst for 2026 REBUILT. "
        f"Observed opponent cycle times: {cycle_times}. "
        f"Heatmap hotspots: {hotspots}. "
        f"Current HUB state: {hub_state.value}. "
        "Recommend defensive deployment and matchups."
    )
    return {"prompt": prompt}
