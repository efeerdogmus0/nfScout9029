import httpx

TBA_BASE = "https://www.thebluealliance.com/api/v3"
STATBOTICS_BASE = "https://api.statbotics.io/v3"


async def fetch_tba_schedule(event_key: str, api_key: str | None = None) -> list[dict]:
    """Fetch matches/simple — used for active-qual and schedule endpoints."""
    headers = {"X-TBA-Auth-Key": api_key} if api_key else {}
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            response = await client.get(
                f"{TBA_BASE}/event/{event_key}/matches/simple",
                headers=headers,
            )
            response.raise_for_status()
            return response.json()
        except Exception:
            return []


async def fetch_tba_matches_full(event_key: str, api_key: str | None = None) -> list[dict]:
    """Fetch full match data (includes videos field)."""
    headers = {"X-TBA-Auth-Key": api_key} if api_key else {}
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            response = await client.get(
                f"{TBA_BASE}/event/{event_key}/matches",
                headers=headers,
            )
            response.raise_for_status()
            return response.json()
        except Exception:
            return []


async def fetch_statbotics_epa(team: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(f"{STATBOTICS_BASE}/team/{team}")
        response.raise_for_status()
        return response.json()
