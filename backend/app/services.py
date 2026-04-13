import httpx

TBA_BASE = "https://www.thebluealliance.com/api/v3"
STATBOTICS_BASE = "https://api.statbotics.io/v3"


async def fetch_tba_schedule(event_key: str, api_key: str | None = None) -> list[dict]:
    headers = {"X-TBA-Auth-Key": api_key} if api_key else {}
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(f"{TBA_BASE}/event/{event_key}/matches/simple", headers=headers)
        response.raise_for_status()
        return response.json()


async def fetch_statbotics_epa(team: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(f"{STATBOTICS_BASE}/team/{team}")
        response.raise_for_status()
        return response.json()
