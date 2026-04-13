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
