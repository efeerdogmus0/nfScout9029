import os
from contextlib import asynccontextmanager
from statistics import mean
from time import time

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db, init_db
from app.models import (
    AdminSharedConfig,
    HubState,
    MatchScoutReport,
    MatchStrategyBoard,
    PitScoutReport,
    PresenceFieldSeat,
    PresenceRoleSession,
    SyncUploadReceipt,
    VideoFuelSubmission,
)
from app.schemas import (
    ActiveQualificationOut,
    CollisionWarning,
    HubStateResponse,
    MatchDetailItem,
    MatchScheduleItem,
    MatchScoutReportIn,
    MatchScoutReportOut,
    OpenRouterChatIn,
    OpenRouterChatOut,
    MultiPathOverlayIn,
    MultiPathOverlayOut,
    RefineryRevisionIn,
    RefineryRevisionOut,
    ScoutLoginIn,
    ScoutLoginOut,
    ScoutStatusIn,
    ScoutStatusOut,
    StrategyBoardIn,
    StrategyBoardOut,
    StatboticsEPA,
    VideoFuelSubmitIn,
    VideoFuelSubmitOut,
    StrategyPromptIn,
    SyncUploadIn,
    TacticalInsightIn,
    WinPredictIn,
    WinPredictOut,
)
from app.services import TBA_BASE, fetch_statbotics_epa, fetch_tba_matches_full, fetch_tba_schedule

@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="FRC REBUILT Scouting API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SEAT_ASSIGNMENTS = {
    # Primary seats (robot-tied)
    "scout_red_1":  {"pin": "1111", "seat": "red1",   "role": "live_scout"},
    "scout_red_2":  {"pin": "2222", "seat": "red2",   "role": "live_scout"},
    "scout_red_3":  {"pin": "3333", "seat": "red3",   "role": "live_scout"},
    "scout_blue_1": {"pin": "4444", "seat": "blue1",  "role": "live_scout"},
    "scout_blue_2": {"pin": "5555", "seat": "blue2",  "role": "live_scout"},
    "scout_blue_3": {"pin": "6666", "seat": "blue3",  "role": "live_scout"},
    # Rotation scouts (cover primary seats during breaks)
    "scout_7":      {"pin": "7777", "seat": "seat7",  "role": "live_scout"},
    "scout_8":      {"pin": "8888", "seat": "seat8",  "role": "live_scout"},
    "scout_9":      {"pin": "9999", "seat": "seat9",  "role": "live_scout"},
    "scout_10":     {"pin": "0000", "seat": "seat10", "role": "live_scout"},
}

ACTIVE_SCOUTS: dict[str, dict] = {}
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
PRESENCE_TTL_MS = 12 * 60 * 60 * 1000
FIELD_SEAT_ORDER = ["red1", "red2", "red3", "blue1", "blue2", "blue3"]


def _is_fresh_ts(ts: int | float | None) -> bool:
    if ts is None:
        return False
    return (time() * 1000 - float(ts)) < PRESENCE_TTL_MS


def _presence_cutoff_ms() -> int:
    return int(time() * 1000 - PRESENCE_TTL_MS)


def _cleanup_presence_db(db: Session) -> None:
    cutoff = _presence_cutoff_ms()
    db.query(PresenceFieldSeat).filter(PresenceFieldSeat.updated_at < cutoff).delete()
    db.query(PresenceRoleSession).filter(PresenceRoleSession.updated_at < cutoff).delete()
    db.commit()


def _sanitize_event_key(raw: str | None) -> str:
    key = (raw or "").strip().lower()
    return key or "2026new"


def _sanitize_team_key(raw: str | None) -> str:
    key = (raw or "").strip().lower()
    if not key:
        return ""
    return key if key.startswith("frc") else f"frc{key}"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/scout-login", response_model=ScoutLoginOut)
def scout_login(payload: ScoutLoginIn) -> ScoutLoginOut:
    entry = SEAT_ASSIGNMENTS.get(payload.username.strip().lower())
    if not entry or payload.pin != entry["pin"]:
        raise HTTPException(status_code=401, detail="invalid credentials")
    return ScoutLoginOut(username=payload.username.strip().lower(), seat=entry["seat"], role=entry["role"])


@app.post("/live/scout-status", response_model=list[ScoutStatusOut])
def heartbeat_scout_status(payload: ScoutStatusIn, device_id: str = Query(...)):
    now = time()
    ACTIVE_SCOUTS[device_id] = {
        "device_id": device_id,
        "scout_name": payload.scout_name,
        "match_key": payload.match_key,
        "seat": payload.seat,
        "last_seen": now
    }
    
    # Prune old scouts (e.g. not seen in last 15 seconds)
    stale = [k for k, v in ACTIVE_SCOUTS.items() if now - v["last_seen"] > 15.0]
    for k in stale:
        del ACTIVE_SCOUTS[k]
        
    return [ScoutStatusOut(**s) for s in ACTIVE_SCOUTS.values()]


@app.get("/presence/field-seats")
def presence_field_seats(db: Session = Depends(get_db)) -> dict[str, dict]:
    _cleanup_presence_db(db)
    rows = db.query(PresenceFieldSeat).all()
    return {r.seat: {"name": r.name, "ts": r.updated_at} for r in rows}


@app.post("/presence/field-seats/claim")
def presence_claim_field_seat(payload: dict, db: Session = Depends(get_db)) -> dict:
    seat = str(payload.get("seat") or "").strip().lower()
    name = str(payload.get("name") or "").strip()
    if seat not in FIELD_SEAT_ORDER:
        raise HTTPException(status_code=400, detail="INVALID_SEAT")
    if not name:
        raise HTTPException(status_code=400, detail="EMPTY_NAME")
    now_ms = int(time() * 1000)
    row = db.get(PresenceFieldSeat, seat)
    if row:
        row.name = name
        row.updated_at = now_ms
    else:
        db.add(PresenceFieldSeat(seat=seat, name=name, updated_at=now_ms))
    _cleanup_presence_db(db)
    db.commit()
    return {"ok": True}


@app.post("/presence/field-seats/release")
def presence_release_field_seat(payload: dict, db: Session = Depends(get_db)) -> dict:
    seat = str(payload.get("seat") or "").strip().lower()
    db.query(PresenceFieldSeat).filter(PresenceFieldSeat.seat == seat).delete()
    db.commit()
    return {"ok": True}


@app.get("/presence/role-sessions/{role}")
def presence_role_sessions(role: str, db: Session = Depends(get_db)) -> list[dict]:
    _cleanup_presence_db(db)
    rows = (
        db.query(PresenceRoleSession)
        .filter(PresenceRoleSession.role == role)
        .order_by(PresenceRoleSession.updated_at.asc())
        .all()
    )
    return [{"id": r.id, "name": r.name, "seat": r.seat, "ts": r.updated_at} for r in rows]


@app.post("/presence/role-sessions/{role}/join")
def presence_role_join(role: str, payload: dict, db: Session = Depends(get_db)) -> dict:
    name = str(payload.get("name") or "").strip()
    max_count = int(payload.get("maxCount") or 9999)
    seat_prefix = str(payload.get("seatPrefix") or "role").strip()
    if not name:
        raise HTTPException(status_code=400, detail="EMPTY_NAME")
    _cleanup_presence_db(db)
    sessions = (
        db.query(PresenceRoleSession)
        .filter(PresenceRoleSession.role == role)
        .order_by(PresenceRoleSession.updated_at.asc())
        .all()
    )
    if len(sessions) >= max_count:
        raise HTTPException(status_code=409, detail="FULL")
    used = {s.seat for s in sessions}
    idx = 1
    while f"{seat_prefix}{idx}" in used:
        idx += 1
    now_ms = int(time() * 1000)
    sess = {
        "id": f"{now_ms}-{os.urandom(3).hex()}",
        "name": name,
        "seat": f"{seat_prefix}{idx}",
        "ts": now_ms,
    }
    db.add(
        PresenceRoleSession(
            id=sess["id"],
            role=role,
            name=sess["name"],
            seat=sess["seat"],
            updated_at=sess["ts"],
        )
    )
    db.commit()
    return {"ok": True, "session": sess, "count": len(sessions) + 1}


@app.post("/presence/role-sessions/{role}/leave")
def presence_role_leave(role: str, payload: dict, db: Session = Depends(get_db)) -> dict:
    session_id = str(payload.get("sessionId") or "").strip()
    db.query(PresenceRoleSession).filter(
        PresenceRoleSession.role == role, PresenceRoleSession.id == session_id
    ).delete()
    db.commit()
    return {"ok": True}


@app.get("/config/admin")
def get_admin_shared_config(db: Session = Depends(get_db)) -> dict[str, str]:
    row = db.get(AdminSharedConfig, "event_key")
    if not row:
        row = AdminSharedConfig(key="event_key", value="2026new")
        db.add(row)
        db.commit()
    return {"event_key": _sanitize_event_key(row.value)}


@app.post("/config/admin/event-key")
def set_admin_shared_event_key(payload: dict, db: Session = Depends(get_db)) -> dict[str, str]:
    key = _sanitize_event_key(payload.get("event_key"))
    row = db.get(AdminSharedConfig, "event_key")
    if row:
        row.value = key
    else:
        db.add(AdminSharedConfig(key="event_key", value=key))
    db.commit()
    return {"event_key": key}


@app.get("/events/{event_key}/pit-reports")
def get_event_pit_reports(event_key: str, db: Session = Depends(get_db)) -> dict[str, dict]:
    key = _sanitize_event_key(event_key)
    rows = db.query(PitScoutReport).filter(PitScoutReport.event_key == key).all()
    return {r.team_key: (r.report or {}) for r in rows}


@app.post("/events/{event_key}/pit-reports/{team_key}")
def upsert_event_pit_report(event_key: str, team_key: str, payload: dict, db: Session = Depends(get_db)) -> dict:
    key = _sanitize_event_key(event_key)
    normalized_team = _sanitize_team_key(team_key)
    if not normalized_team:
        raise HTTPException(status_code=400, detail="INVALID_TEAM_KEY")
    report = payload.get("report")
    if not isinstance(report, dict):
        raise HTTPException(status_code=400, detail="INVALID_REPORT")

    row = db.scalar(
        select(PitScoutReport)
        .where(PitScoutReport.event_key == key)
        .where(PitScoutReport.team_key == normalized_team)
    )
    now_ms = int(time() * 1000)
    if row:
        row.report = report
        row.updated_at = now_ms
    else:
        db.add(
            PitScoutReport(
                event_key=key,
                team_key=normalized_team,
                report=report,
                updated_at=now_ms,
            )
        )
    db.commit()
    return {"ok": True, "event_key": key, "team_key": normalized_team, "updated_at": now_ms}


@app.get("/live/hub-state/current", response_model=HubStateResponse)
def live_hub_state() -> HubStateResponse:
    # Placeholder for TBA-driven active/inactive state feed.
    current = HubState.ACTIVE if (int(os.getenv("HUB_SIM_TICK", "0")) % 2 == 0) else HubState.INACTIVE
    return HubStateResponse(hub_state=current, source="simulated_tba")


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


@app.get("/matches/{match_key}/strategy-board", response_model=StrategyBoardOut)
def get_strategy_board(match_key: str, db: Session = Depends(get_db)):
    board = db.scalar(select(MatchStrategyBoard).where(MatchStrategyBoard.match_key == match_key))
    if not board:
        return StrategyBoardOut(match_key=match_key, annotations=[])
    return StrategyBoardOut(match_key=board.match_key, annotations=board.annotations)


@app.post("/matches/{match_key}/strategy-board", response_model=StrategyBoardOut)
def update_strategy_board(match_key: str, payload: StrategyBoardIn, db: Session = Depends(get_db)):
    board = db.scalar(select(MatchStrategyBoard).where(MatchStrategyBoard.match_key == match_key))
    if not board:
        board = MatchStrategyBoard(match_key=match_key, annotations=payload.annotations)
        db.add(board)
    else:
        board.annotations = payload.annotations
    db.commit()
    return StrategyBoardOut(match_key=board.match_key, annotations=board.annotations)


@app.post("/sync/upload")
def sync_upload(payload: SyncUploadIn, db: Session = Depends(get_db)) -> dict[str, int]:
    inserted = 0
    updated = 0
    conflicted = 0
    for report in payload.reports:
        report_id = (report.report_id or "").strip()
        if not report_id:
            # Legacy payloads without report_id: keep backward compatibility.
            # We do not force idempotency here to avoid deterministic collisions across test runs.
            create_report(report, db)
            inserted += 1
            continue
        incoming_updated_at = int(report.updated_at or 0)

        receipt = db.scalar(select(SyncUploadReceipt).where(SyncUploadReceipt.report_id == report_id))
        if receipt:
            # Idempotent re-upload: already have same report id.
            if incoming_updated_at <= receipt.updated_at:
                continue
            row = db.get(MatchScoutReport, receipt.report_row_id)
            if row is None:
                continue
            row.event_key = report.event_key
            row.match_key = report.match_key
            row.team_key = report.team_key
            row.scout_device_id = report.scout_device_id
            row.auto_path_points = [p.model_dump() for p in report.auto_path_points]
            row.auto_fuel_scored = report.auto_fuel_scored
            row.teleop_fuel_scored_active = report.teleop_fuel_scored_active
            row.teleop_fuel_scored_inactive = report.teleop_fuel_scored_inactive
            row.bump_slow_or_stuck = report.bump_slow_or_stuck
            row.trench_slow_or_stuck = report.trench_slow_or_stuck
            row.tower_level = report.tower_level
            row.teleop_shoot_timestamps_ms = report.teleop_shoot_timestamps_ms
            row.location_pings = [p.model_dump() for p in report.location_pings]
            row.notes = report.notes
            receipt.updated_at = incoming_updated_at
            updated += 1
            continue

        # Conflict strategy: latest updated_at wins for same match/team.
        existing_for_pair = db.scalar(
            select(SyncUploadReceipt)
            .where(SyncUploadReceipt.match_key == report.match_key)
            .where(SyncUploadReceipt.team_key == report.team_key)
            .order_by(SyncUploadReceipt.updated_at.desc())
        )
        if existing_for_pair and incoming_updated_at and incoming_updated_at < existing_for_pair.updated_at:
            conflicted += 1
            continue

        created = create_report(report, db)
        receipt_row = SyncUploadReceipt(
            report_id=report_id,
            device_id=payload.device_id,
            match_key=report.match_key,
            team_key=report.team_key,
            updated_at=incoming_updated_at,
            report_row_id=created.id,
        )
        db.add(receipt_row)
        db.commit()
        inserted += 1
    return {"device_upload_count": inserted + updated, "inserted_count": inserted, "updated_count": updated, "conflict_count": conflicted}


@app.get("/matches/{match_key}/reports", response_model=list[MatchScoutReportOut])
def reports_for_match(match_key: str, db: Session = Depends(get_db)) -> list[MatchScoutReportOut]:
    rows = db.query(MatchScoutReport).filter(MatchScoutReport.match_key == match_key).all()
    return [
        MatchScoutReportOut(
            id=row.id,
            event_key=row.event_key,
            match_key=row.match_key,
            team_key=row.team_key,
            scout_device_id=row.scout_device_id,
            auto_path_points=row.auto_path_points,
            auto_fuel_scored=row.auto_fuel_scored,
            teleop_fuel_scored_active=row.teleop_fuel_scored_active,
            teleop_fuel_scored_inactive=row.teleop_fuel_scored_inactive,
            hub_state_samples=[],
            bump_slow_or_stuck=row.bump_slow_or_stuck,
            trench_slow_or_stuck=row.trench_slow_or_stuck,
            tower_level=row.tower_level,
            teleop_shoot_timestamps_ms=row.teleop_shoot_timestamps_ms,
            location_pings=row.location_pings,
            notes=row.notes,
        )
        for row in rows
    ]


def _resolve_tba_key(tba_key: str | None) -> str | None:
    """Prefer query param, fall back to env var."""
    return tba_key or os.getenv("TBA_API_KEY") or None


def _resolve_openrouter_key(api_key_override: str | None = None) -> str | None:
    """Prefer request override, fall back to env var."""
    return (api_key_override or os.getenv("OPENROUTER_API_KEY") or "").strip() or None


def _resolve_openrouter_model(model: str | None = None) -> str:
    return (model or os.getenv("OPENROUTER_MODEL") or "x-ai/grok-4-fast").strip()


@app.get("/events/{event_key}/teams", response_model=list[str])
async def event_teams(event_key: str, tba_key: str | None = None) -> list[str]:
    """Return sorted list of team keys participating in the event."""
    import logging, httpx as _httpx
    api_key = _resolve_tba_key(tba_key)
    if not api_key:
        raise HTTPException(status_code=400, detail="TBA_KEY_MISSING")
    headers = {"X-TBA-Auth-Key": api_key}
    async with _httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(
                f"{TBA_BASE}/event/{event_key}/teams/simple", headers=headers
            )
            if r.status_code == 401:
                raise HTTPException(status_code=401, detail="TBA_KEY_INVALID")
            if r.status_code == 404:
                raise HTTPException(status_code=404, detail="EVENT_NOT_FOUND")
            r.raise_for_status()
            teams = [t["key"] for t in r.json()]
            teams.sort(key=lambda k: int(k.replace("frc", "")) if k.replace("frc", "").isdigit() else 0)
            return teams
        except HTTPException:
            raise
        except Exception as exc:
            logging.warning("TBA teams fetch failed: %s", exc)
            raise HTTPException(status_code=502, detail=f"TBA_FETCH_ERROR: {exc}")


@app.get("/events/{event_key}/rankings")
async def event_rankings(event_key: str, tba_key: str | None = None) -> dict:
    api_key = _resolve_tba_key(tba_key)
    if not api_key:
        raise HTTPException(status_code=400, detail="TBA_KEY_MISSING")
    headers = {"X-TBA-Auth-Key": api_key}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{TBA_BASE}/event/{event_key}/rankings", headers=headers)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="TBA_KEY_INVALID")
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="EVENT_NOT_FOUND")
    if not r.is_success:
        raise HTTPException(status_code=502, detail=f"TBA_FETCH_ERROR_{r.status_code}")
    return r.json()


@app.get("/matches/{match_key}/tba")
async def tba_match(match_key: str, tba_key: str | None = None) -> dict:
    api_key = _resolve_tba_key(tba_key)
    if not api_key:
        raise HTTPException(status_code=400, detail="TBA_KEY_MISSING")
    headers = {"X-TBA-Auth-Key": api_key}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{TBA_BASE}/match/{match_key}", headers=headers)
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="TBA_KEY_INVALID")
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="MATCH_NOT_FOUND")
    if not r.is_success:
        raise HTTPException(status_code=502, detail=f"TBA_FETCH_ERROR_{r.status_code}")
    return r.json()


def _build_schedule_item(match: dict) -> MatchScheduleItem:
    alliances = match.get("alliances", {})
    red_al  = alliances.get("red",  {})
    blue_al = alliances.get("blue", {})
    red_score  = red_al.get("score")
    blue_score = blue_al.get("score")
    # TBA returns -1 for unplayed matches
    if red_score is not None and red_score < 0:
        red_score = None
    if blue_score is not None and blue_score < 0:
        blue_score = None
    winning = match.get("winning_alliance") or None
    if winning == "":
        winning = None
    return MatchScheduleItem(
        match_key=match["key"],
        red=red_al.get("team_keys", []),
        blue=blue_al.get("team_keys", []),
        red_score=red_score,
        blue_score=blue_score,
        winning_alliance=winning,
        predicted_time=match.get("predicted_time"),
        actual_time=match.get("actual_time"),
        match_number=int(match.get("match_number") or 0),
    )


@app.get("/events/{event_key}/schedule", response_model=list[MatchScheduleItem])
async def event_schedule(event_key: str, tba_key: str | None = None) -> list[MatchScheduleItem]:
    schedule = await fetch_tba_schedule(event_key, api_key=_resolve_tba_key(tba_key))
    return [_build_schedule_item(m) for m in schedule]


@app.get("/events/{event_key}/played-quals", response_model=list[MatchScheduleItem])
async def played_qualifications(event_key: str, tba_key: str | None = None) -> list[MatchScheduleItem]:
    schedule = await fetch_tba_schedule(event_key, api_key=_resolve_tba_key(tba_key))
    played = [m for m in schedule if m.get("comp_level") == "qm" and m.get("actual_time") is not None]
    played.sort(key=lambda m: m.get("match_number", 0))
    return [_build_schedule_item(m) for m in played]


@app.get("/events/{event_key}/all-matches", response_model=list[MatchDetailItem])
async def all_matches(event_key: str, tba_key: str | None = None) -> list[MatchDetailItem]:
    # Use full /matches (not /simple) to get videos field
    schedule = await fetch_tba_matches_full(event_key, api_key=_resolve_tba_key(tba_key))
    level_order = {"qm": 0, "ef": 1, "qf": 2, "sf": 3, "f": 4}
    schedule.sort(key=lambda m: (
        level_order.get(m.get("comp_level", "qm"), 9),
        m.get("set_number", 1),
        m.get("match_number", 0),
    ))
    items = []
    for match in schedule:
        alliances  = match.get("alliances", {})
        red        = alliances.get("red",  {}).get("team_keys", [])
        blue       = alliances.get("blue", {}).get("team_keys", [])
        videos     = [v for v in match.get("videos", []) if v.get("type") == "youtube"]
        yt_key     = videos[0]["key"] if videos else None
        items.append(MatchDetailItem(
            match_key    = match["key"],
            comp_level   = match.get("comp_level", "qm"),
            match_number = match.get("match_number", 0),
            set_number   = match.get("set_number",   1),
            red          = red,
            blue         = blue,
            youtube_key  = yt_key,
            played       = match.get("actual_time") is not None,
        ))
    return items


@app.get("/events/{event_key}/active-qual", response_model=ActiveQualificationOut)
async def active_qualification(event_key: str, tba_key: str | None = None) -> ActiveQualificationOut:
    schedule = await fetch_tba_schedule(event_key, api_key=_resolve_tba_key(tba_key))
    quals = [m for m in schedule if m.get("comp_level") == "qm"]
    if not quals:
        return ActiveQualificationOut(match_key="unknown", red=[], blue=[], source="no_qualification_found")

    now = int(time())
    upcoming = [m for m in quals if m.get("actual_time") is None]
    target = None
    if upcoming:
        target = min(upcoming, key=lambda m: abs((m.get("predicted_time") or now) - now))
    else:
        target = max(quals, key=lambda m: m.get("actual_time") or 0)

    alliances = target.get("alliances", {})
    red = alliances.get("red", {}).get("team_keys", [])
    blue = alliances.get("blue", {}).get("team_keys", [])
    return ActiveQualificationOut(match_key=target.get("key", "unknown"), red=red, blue=blue, source="tba")


@app.get("/teams/{team_key}/epa", response_model=StatboticsEPA)
async def team_epa(team_key: str) -> StatboticsEPA:
    payload = await fetch_statbotics_epa(team_key)
    return StatboticsEPA(team_key=team_key, epa=payload.get("epa", {}).get("total_points", 0.0))


@app.post("/strategy/win-predict", response_model=WinPredictOut)
def win_predict(payload: WinPredictIn) -> WinPredictOut:
    epa_delta = payload.our_epa - payload.opponent_epa
    our_cycle = mean(payload.our_live_cycle_ms) if payload.our_live_cycle_ms else 0
    opp_cycle = mean(payload.opponent_live_cycle_ms) if payload.opponent_live_cycle_ms else 0
    cycle_delta = 0 if our_cycle == 0 or opp_cycle == 0 else (opp_cycle - our_cycle) / 1000
    fuel_delta = payload.our_active_fuel - payload.opponent_active_fuel

    raw = 0.5 + (epa_delta * 0.015) + (cycle_delta * 0.05) + (fuel_delta * 0.02)
    probability = max(0.01, min(0.99, raw))
    rationale = (
        f"EPA delta={epa_delta:.2f}, cycle delta(s)={cycle_delta:.2f}, "
        f"active FUEL delta={fuel_delta}"
    )
    return WinPredictOut(win_probability=probability, rationale=rationale)


@app.post("/strategy/prompt")
def strategy_prompt(payload: StrategyPromptIn) -> dict[str, str]:
    prompt = (
        "You are an FRC strategy analyst for 2026 REBUILT. "
        f"Observed opponent cycle times: {payload.cycle_times}. "
        f"Heatmap hotspots: {payload.hotspots}. "
        f"Current HUB state: {payload.hub_state.value}. "
        "Teleop is 140 seconds and autonomous is 20 seconds. "
        "Recommend defensive deployment and matchups."
    )
    return {"prompt": prompt}


@app.post("/refinery/revise", response_model=RefineryRevisionOut)
def refinery_revise(payload: RefineryRevisionIn) -> RefineryRevisionOut:
    return RefineryRevisionOut(
        match_key=payload.match_key,
        team_key=payload.team_key,
        revised_count=len(payload.revised_events),
        inventory_capacity=payload.inventory_capacity,
    )


@app.post("/warroom/multi-path-overlay", response_model=MultiPathOverlayOut)
def warroom_multi_path_overlay(payload: MultiPathOverlayIn) -> MultiPathOverlayOut:
    warnings: list[CollisionWarning] = []
    threshold = 12.0
    for i in range(len(payload.paths)):
        for j in range(i + 1, len(payload.paths)):
            a = payload.paths[i]
            b = payload.paths[j]
            pairs = zip(a.points, b.points)
            for pa, pb in pairs:
                dx = pa.x - pb.x
                dy = pa.y - pb.y
                if (dx * dx + dy * dy) ** 0.5 <= threshold:
                    warnings.append(
                        CollisionWarning(
                            robot_a=a.robot,
                            robot_b=b.robot,
                            t_ms=min(pa.t_ms, pb.t_ms),
                            x=(pa.x + pb.x) / 2,
                            y=(pa.y + pb.y) / 2,
                        )
                    )
    return MultiPathOverlayOut(match_key=payload.match_key, warnings=warnings)


@app.post("/video-scout/fuel-entry", response_model=VideoFuelSubmitOut)
def video_fuel_entry(payload: VideoFuelSubmitIn, db: Session = Depends(get_db)) -> VideoFuelSubmitOut:
    row = db.scalar(select(VideoFuelSubmission).where(VideoFuelSubmission.match_key == payload.match_key))
    now_ms = int(time() * 1000)
    entries = [entry.model_dump() for entry in payload.entries]
    if row:
        row.match_start_sec = payload.match_start_sec
        row.entries = entries
        row.updated_at = now_ms
    else:
        db.add(
            VideoFuelSubmission(
                match_key=payload.match_key,
                match_start_sec=payload.match_start_sec,
                entries=entries,
                updated_at=now_ms,
            )
        )
    db.commit()
    return VideoFuelSubmitOut(match_key=payload.match_key, saved=len(payload.entries))


@app.post("/warroom/tactical-insight")
def warroom_tactical_insight(payload: TacticalInsightIn) -> dict[str, str]:
    hotspot_txt = ", ".join(payload.last_three_match_hotspots) or "no hotspot"
    avg_cycle = mean(payload.cycle_times) if payload.cycle_times else 0
    return {
        "insight": (
            f"Rakip {payload.opponent_team} son 3 macinda {hotspot_txt} bolgesinde yogunlasiyor. "
            f"Ortalama cycle {avg_cycle:.0f}ms. Defense bu hatta konumlanirsa verim ciddi azalir."
        )
    }


@app.post("/ai/openrouter-chat", response_model=OpenRouterChatOut)
async def openrouter_chat(payload: OpenRouterChatIn) -> OpenRouterChatOut:
    api_key = _resolve_openrouter_key(payload.api_key_override)
    if not api_key:
        raise HTTPException(status_code=400, detail="OPENROUTER_KEY_MISSING")

    req_body = {
        "model": _resolve_openrouter_model(payload.model),
        "messages": [
            {"role": "system", "content": payload.system},
            {"role": "user", "content": payload.prompt},
        ],
        "temperature": payload.temperature,
        "max_tokens": payload.max_tokens,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": os.getenv("OPENROUTER_HTTP_REFERER", "http://localhost:5173"),
        "X-Title": os.getenv("OPENROUTER_APP_TITLE", "FRC REBUILT Scouting"),
    }
    async with httpx.AsyncClient(timeout=45) as client:
        r = await client.post(OPENROUTER_URL, json=req_body, headers=headers)

    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="OPENROUTER_INVALID_KEY")
    if r.status_code == 402:
        raise HTTPException(status_code=402, detail="OPENROUTER_NO_CREDITS")
    if r.status_code == 429:
        raise HTTPException(status_code=429, detail="OPENROUTER_RATE_LIMIT")
    if not r.is_success:
        raise HTTPException(status_code=502, detail=f"OPENROUTER_API_ERROR_{r.status_code}")

    data = r.json()
    text = data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
    return OpenRouterChatOut(text=text)
