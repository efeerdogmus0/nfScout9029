#!/usr/bin/env python3
"""
NF Division Notifier

Runs in background and checks The Blue Alliance every N minutes to detect
when our team gets assigned to a championship division event.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


TBA_BASE = "https://www.thebluealliance.com/api/v3"
PROJECT_ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Config:
    tba_api_key: str
    my_team: str
    division_event_keys: list[str]
    poll_seconds: int
    state_file: Path
    alert_url: str
    open_url_on_alert: bool


def ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(msg: str) -> None:
    print(f"[{ts()}] {msg}", flush=True)


def env_bool(key: str, default: bool) -> bool:
    raw = os.getenv(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def normalize_team(raw: str) -> str:
    t = (raw or "").strip().lower().replace("frc", "")
    if not t.isdigit():
        raise ValueError(f"Invalid MY_TEAM value: {raw!r}")
    return f"frc{int(t)}"


def read_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    try:
        for ln in path.read_text(encoding="utf-8").splitlines():
            s = ln.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:  # noqa: BLE001
        return {}
    return out


def resolve_tba_key() -> str:
    # 1) explicit env still has top priority
    key = os.getenv("TBA_API_KEY", "").strip()
    if key:
        return key

    # 2) standard project env locations (normal app setup)
    candidates = [
        PROJECT_ROOT / "backend" / ".env",
        PROJECT_ROOT / ".env",
    ]
    for p in candidates:
        vals = read_env_file(p)
        k = vals.get("TBA_API_KEY", "").strip()
        if k:
            return k
    return ""


def load_config() -> Config:
    api_key = resolve_tba_key()
    if not api_key:
        raise RuntimeError("TBA_API_KEY is required (env or backend/.env)")

    my_team = normalize_team(os.getenv("MY_TEAM", "frc9029"))
    division_keys_raw = os.getenv("DIVISION_EVENT_KEYS", "").strip()
    division_event_keys = [x.strip() for x in division_keys_raw.split(",") if x.strip()]
    if not division_event_keys:
        raise RuntimeError("DIVISION_EVENT_KEYS is required (comma-separated TBA event keys)")

    poll_seconds = int(os.getenv("POLL_SECONDS", "600"))
    if poll_seconds < 60:
        poll_seconds = 60

    state_default = Path.home() / ".cache" / "nf-division-notifier" / "state.json"
    state_file = Path(os.getenv("STATE_FILE", str(state_default))).expanduser()
    alert_url = os.getenv("ALERT_URL", "http://localhost:5173").strip()
    open_url = env_bool("OPEN_URL_ON_ALERT", True)

    return Config(
        tba_api_key=api_key,
        my_team=my_team,
        division_event_keys=division_event_keys,
        poll_seconds=poll_seconds,
        state_file=state_file,
        alert_url=alert_url,
        open_url_on_alert=open_url,
    )


def fetch_json(url: str, api_key: str):
    req = Request(
        url,
        headers={
            "X-TBA-Auth-Key": api_key,
            "User-Agent": "nf-division-notifier/1.0",
            "Accept": "application/json",
        },
    )
    with urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def team_in_division(cfg: Config, event_key: str) -> bool:
    url = f"{TBA_BASE}/event/{event_key}/teams/keys"
    try:
        teams = fetch_json(url, cfg.tba_api_key)
        return cfg.my_team in teams
    except HTTPError as e:
        # 404/403/etc should not crash daemon; keep trying next cycle.
        log(f"TBA error for {event_key}: HTTP {e.code}")
        return False
    except URLError as e:
        log(f"Network error for {event_key}: {e.reason}")
        return False
    except Exception as e:  # noqa: BLE001
        log(f"Unexpected error for {event_key}: {e}")
        return False


def detect_division(cfg: Config) -> Optional[str]:
    for ek in cfg.division_event_keys:
        if team_in_division(cfg, ek):
            return ek
    return None


def read_state(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def write_state(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def run_cmd(cmd: list[str]) -> None:
    try:
        subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:  # noqa: BLE001
        pass


def play_sound() -> None:
    # Best effort: try common Linux sound players.
    run_cmd(["paplay", "/usr/share/sounds/freedesktop/stereo/complete.oga"])
    run_cmd(["canberra-gtk-play", "-i", "complete"])
    # Terminal bell fallback
    try:
        sys.stdout.write("\a")
        sys.stdout.flush()
    except Exception:  # noqa: BLE001
        pass


def notify_division(cfg: Config, division_key: str) -> None:
    msg = f"Divisionlar aciklandi! NF su divisionda: {division_key}"
    log(msg)
    run_cmd(
        [
            "notify-send",
            "-u",
            "critical",
            "-t",
            "20000",
            "NF Scout Division Alert",
            msg,
        ]
    )
    if cfg.open_url_on_alert and cfg.alert_url:
        run_cmd(["xdg-open", cfg.alert_url])
    for _ in range(3):
        play_sound()
        time.sleep(0.8)


def main() -> int:
    try:
        cfg = load_config()
    except Exception as e:  # noqa: BLE001
        log(f"Configuration error: {e}")
        return 2

    log(
        "Notifier started "
        f"(team={cfg.my_team}, poll={cfg.poll_seconds}s, divisions={len(cfg.division_event_keys)})"
    )

    state = read_state(cfg.state_file)
    last_division = state.get("last_division")

    while True:
        division = detect_division(cfg)
        if division:
            if division != last_division:
                notify_division(cfg, division)
                last_division = division
                write_state(
                    cfg.state_file,
                    {
                        "last_division": division,
                        "updated_at": ts(),
                        "team": cfg.my_team,
                    },
                )
            else:
                log(f"Division already known: {division}")
        else:
            log("No division assignment yet.")
        time.sleep(cfg.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
