import { tbaParams, getTbaKey } from "./adminConfig";

const API_BASE = "http://localhost:8001";

export async function fetchHubState() {
  const response = await fetch(`${API_BASE}/live/hub-state/current`);
  if (!response.ok) throw new Error("hub state fetch failed");
  return response.json();
}

export async function fetchActiveQualification(eventKey) {
  const response = await fetch(`${API_BASE}/events/${eventKey}/active-qual${tbaParams()}`);
  if (!response.ok) throw new Error("active qual fetch failed");
  return response.json();
}

export async function fetchSchedule(eventKey) {
  const response = await fetch(`${API_BASE}/events/${eventKey}/schedule${tbaParams()}`);
  if (!response.ok) throw new Error("schedule fetch failed");
  return response.json();
}

/**
 * Fetches event teams directly from TBA (no backend hop needed).
 * Returns { teams: string[], error: string|null }
 * error values: "NO_KEY" | "INVALID_KEY" | "NOT_FOUND" | "NETWORK" | null
 */
export async function fetchEventTeams(eventKey) {
  const key = getTbaKey();
  if (!key) return { teams: [], error: "NO_KEY" };

  try {
    const response = await fetch(
      `https://www.thebluealliance.com/api/v3/event/${eventKey}/teams/simple`,
      { headers: { "X-TBA-Auth-Key": key } }
    );
    if (response.status === 401) return { teams: [], error: "INVALID_KEY" };
    if (response.status === 404) return { teams: [], error: "NOT_FOUND" };
    if (!response.ok)            return { teams: [], error: "NETWORK" };
    const data = await response.json();
    const teams = data.map((t) => t.key).sort(
      (a, b) => (parseInt(a.replace("frc","")) || 0) - (parseInt(b.replace("frc","")) || 0)
    );
    return { teams, error: null };
  } catch {
    return { teams: [], error: "NETWORK" };
  }
}

export async function scoutLogin(payload) {
  const response = await fetch(`${API_BASE}/auth/scout-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("login failed");
  return response.json();
}

export async function runWinPredict(payload) {
  const response = await fetch(`${API_BASE}/strategy/win-predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("win predict failed");
  return response.json();
}

export async function runTacticalInsight(payload) {
  const response = await fetch(`${API_BASE}/warroom/tactical-insight`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("tactical insight failed");
  return response.json();
}

export async function runOverlay(payload) {
  const response = await fetch(`${API_BASE}/warroom/multi-path-overlay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("overlay failed");
  return response.json();
}

export async function submitRefineryRevision(payload) {
  const response = await fetch(`${API_BASE}/refinery/revise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("refinery submit failed");
  return response.json();
}
