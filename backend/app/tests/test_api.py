from fastapi.testclient import TestClient

import app.main as main_module
from app.db import init_db
from app.main import app

init_db()
client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_create_report() -> None:
    payload = {
        "event_key": "2026miket",
        "match_key": "2026miket_qm1",
        "team_key": "frc1234",
        "scout_device_id": "device-a",
        "auto_path_points": [{"t_ms": 1000, "x": 10, "y": 30}],
        "auto_fuel_scored": 3,
        "teleop_fuel_scored_active": 5,
        "teleop_fuel_scored_inactive": 2,
        "hub_state_samples": ["active", "inactive"],
        "tower_level": "level_2",
        "teleop_shoot_timestamps_ms": [5000, 13000],
        "location_pings": [{"t_ms": 10000, "x": 18, "y": 12, "near_bump": True, "near_trench": False}],
    }
    response = client.post("/reports", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] > 0
    assert body["tower_level"] == "level_2"


def test_schedule_uses_mocked_tba(monkeypatch) -> None:
    async def mock_fetch(*_args, **_kwargs):
        return [
            {
                "key": "2026miket_qm1",
                "alliances": {
                    "red": {"team_keys": ["frc1", "frc2", "frc3"]},
                    "blue": {"team_keys": ["frc4", "frc5", "frc6"]},
                },
            }
        ]

    monkeypatch.setattr(main_module, "fetch_tba_schedule", mock_fetch)
    response = client.get("/events/2026miket/schedule")
    assert response.status_code == 200
    assert response.json()[0]["match_key"] == "2026miket_qm1"


def test_epa_uses_mocked_statbotics(monkeypatch) -> None:
    async def mock_epa(*_args, **_kwargs):
        return {"epa": {"total_points": 27.5}}

    monkeypatch.setattr(main_module, "fetch_statbotics_epa", mock_epa)
    response = client.get("/teams/frc1234/epa")
    assert response.status_code == 200
    assert response.json()["epa"] == 27.5


def test_sync_upload_and_match_query() -> None:
    payload = {
        "device_id": "device-sync-1",
        "reports": [
            {
                "event_key": "2026miket",
                "match_key": "2026miket_qm9",
                "team_key": "frc9999",
                "scout_device_id": "device-sync-1",
                "teleop_fuel_scored_active": 6,
                "tower_level": "level_3",
            },
            {
                "event_key": "2026miket",
                "match_key": "2026miket_qm9",
                "team_key": "frc0001",
                "scout_device_id": "device-sync-1",
                "teleop_fuel_scored_inactive": 4,
                "tower_level": "level_1",
            },
        ],
    }
    sync_response = client.post("/sync/upload", json=payload)
    assert sync_response.status_code == 200
    assert sync_response.json()["device_upload_count"] == 2

    query_response = client.get("/matches/2026miket_qm9/reports")
    assert query_response.status_code == 200
    assert len(query_response.json()) >= 2


def test_win_predict_and_strategy_prompt() -> None:
    prediction = client.post(
        "/strategy/win-predict",
        json={
            "our_epa": 33.0,
            "opponent_epa": 29.5,
            "our_live_cycle_ms": [8500, 9000, 8700],
            "opponent_live_cycle_ms": [9700, 10100],
            "our_active_fuel": 10,
            "opponent_active_fuel": 8,
        },
    )
    assert prediction.status_code == 200
    assert 0 <= prediction.json()["win_probability"] <= 1

    prompt = client.post(
        "/strategy/prompt",
        json={
            "cycle_times": [9700, 10100],
            "hotspots": ["trench", "bump"],
            "hub_state": "inactive",
        },
    )
    assert prompt.status_code == 200
    assert "REBUILT" in prompt.json()["prompt"]


def test_live_hub_state_and_refinery() -> None:
    hub = client.get("/live/hub-state/current")
    assert hub.status_code == 200
    assert hub.json()["hub_state"] in ["active", "inactive"]

    rev = client.post(
        "/refinery/revise",
        json={
            "match_key": "2026miket_qm11",
            "team_key": "frc1111",
            "revised_events": [{"t_ms": 55000, "action": "score", "x": 111, "y": 44}],
            "foul_notes": ["g12 maybe"],
            "inventory_capacity": 6,
        },
    )
    assert rev.status_code == 200
    assert rev.json()["revised_count"] == 1


def test_warroom_overlay_and_tactical() -> None:
    overlay = client.post(
        "/warroom/multi-path-overlay",
        json={
            "match_key": "2026miket_qf1m1",
            "paths": [
                {"robot": "frc1", "points": [{"t_ms": 2000, "x": 100, "y": 100}]},
                {"robot": "frc2", "points": [{"t_ms": 2000, "x": 106, "y": 103}]},
                {"robot": "frc3", "points": [{"t_ms": 2000, "x": 220, "y": 140}]},
            ],
        },
    )
    assert overlay.status_code == 200
    assert len(overlay.json()["warnings"]) >= 1

    tactical = client.post(
        "/warroom/tactical-insight",
        json={
            "opponent_team": "frc9999",
            "last_three_match_hotspots": ["right_trench", "right_trench", "hub_front_right"],
            "cycle_times": [9800, 10100, 9600],
        },
    )
    assert tactical.status_code == 200
    assert "Rakip" in tactical.json()["insight"]


def test_active_qualification_uses_mocked_tba(monkeypatch) -> None:
    async def mock_schedule(*_args, **_kwargs):
        return [
            {
                "key": "2026miket_qm18",
                "comp_level": "qm",
                "actual_time": None,
                "predicted_time": 9999999999,
                "alliances": {
                    "red": {"team_keys": ["frc1", "frc2", "frc3"]},
                    "blue": {"team_keys": ["frc4", "frc5", "frc6"]},
                },
            }
        ]

    monkeypatch.setattr(main_module, "fetch_tba_schedule", mock_schedule)
    response = client.get("/events/2026miket/active-qual")
    assert response.status_code == 200
    assert response.json()["match_key"] == "2026miket_qm18"


def test_scout_login_assigns_fixed_seat() -> None:
    ok = client.post("/auth/scout-login", json={"username": "scout_red_1", "pin": "1111"})
    assert ok.status_code == 200
    assert ok.json()["seat"] == "red1"

    bad = client.post("/auth/scout-login", json={"username": "scout_red_1", "pin": "9999"})
    assert bad.status_code == 401


def test_pit_report_upsert_and_read() -> None:
    """Pit scouting verisi backend'e kaydedilip geri okunabilmeli."""
    event = "2026testpit"
    team = "frc9876"

    # POST — yeni rapor yaz
    r = client.post(
        f"/events/{event}/pit-reports/{team}",
        json={"report": {"drive": "Swerve", "completed": True, "notes": "test notu"}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["team_key"] == team

    # GET — geri oku, aynı veri gelmeli
    g = client.get(f"/events/{event}/pit-reports")
    assert g.status_code == 200
    data = g.json()
    assert team in data
    assert data[team]["drive"] == "Swerve"
    assert data[team]["completed"] is True

    # Upsert — üzerine yaz
    r2 = client.post(
        f"/events/{event}/pit-reports/{team}",
        json={"report": {"drive": "Tank/WCD", "completed": False}},
    )
    assert r2.status_code == 200
    g2 = client.get(f"/events/{event}/pit-reports")
    assert g2.json()[team]["drive"] == "Tank/WCD"

