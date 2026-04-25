import { tbaParams } from "./adminConfig";
import { API_BASE } from "./config";

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

/**
 * Fetch official rankings from TBA for an event.
 */
export async function fetchRankings(eventKey) {
  try {
    const res = await fetch(`${API_BASE}/events/${eventKey}/rankings${tbaParams()}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

/**
 * Fetch EPA data from Statbotics for all teams at an event.
 * Returns { [teamKey]: { epa, epaSd, rank, wins, losses, winrate } } or {}.
 *
 * Statbotics REST API v3:
 *   GET https://api.statbotics.io/v3/team_events?event={key}&limit=100
 *   Response fields we use:
 *     team                        → integer team number
 *     epa.total_points.mean       → mean EPA (used as primary strength metric)
 *     epa.total_points.sd         → standard deviation
 *     epa.stats.max               → season-best EPA at this event
 *     record.qual.rank            → qualification ranking
 *     record.qual.wins/losses     → qual record
 *     record.qual.winrate         → win rate
 */
export async function fetchEPA(eventKey) {
  try {
    const res = await fetch(
      `https://api.statbotics.io/v3/team_events?event=${eventKey}&limit=100`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return {};
    const data = await res.json();
    const out = {};
    for (const te of (data || [])) {
      if (!te.team || te.epa?.total_points?.mean == null) continue;
      out[`frc${te.team}`] = {
        epa:     +te.epa.total_points.mean.toFixed(1),
        epaSd:   te.epa.total_points.sd != null ? +te.epa.total_points.sd.toFixed(1) : null,
        epaMax:  te.epa.stats?.max != null ? +te.epa.stats.max.toFixed(1) : null,
        rank:    te.record?.qual?.rank  ?? null,
        numTeams: te.record?.qual?.num_teams ?? null,
        wins:    te.record?.qual?.wins   ?? null,
        losses:  te.record?.qual?.losses ?? null,
        winrate: te.record?.qual?.winrate != null
          ? +(te.record.qual.winrate * 100).toFixed(0)
          : null,
      };
    }
    return out;
  } catch { return {}; }
}

export async function fetchSchedule(eventKey) {
  // Allow locally-generated test schedules to bypass the backend
  const mock = localStorage.getItem(`mockSchedule_${eventKey}`);
  if (mock) {
    try { return JSON.parse(mock); } catch { /* fall through */ }
  }
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
  try {
    const response = await fetch(`${API_BASE}/events/${eventKey}/teams${tbaParams()}`);
    if (response.status === 400) return { teams: [], error: "NO_KEY" };
    if (response.status === 401) return { teams: [], error: "INVALID_KEY" };
    if (response.status === 404) return { teams: [], error: "NOT_FOUND" };
    if (!response.ok)            return { teams: [], error: "NETWORK" };
    const data = await response.json();
    const teams = data.sort(
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

/**
 * Fetch full match data (including score_breakdown) from TBA.
 * Returns the raw TBA match object, or null on failure.
 *
 * 2026 REBUILT score_breakdown fuel fields (1 ball = 1 point):
 *   autoFuelPoints             — auto phase (both hubs active)
 *   transitionShiftFuelPoints  — 10s transition both hubs
 *   shift1FuelPoints … shift4FuelPoints  — alternating hub shifts
 *   endGameFuelPoints          — last 30s both hubs
 */
export async function fetchMatchData(matchKey) {
  try {
    const res = await fetch(`${API_BASE}/matches/${matchKey}/tba${tbaParams()}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
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

export async function postScoutHeartbeat(deviceId, payload) {
  try {
    const res = await fetch(`${API_BASE}/live/scout-status?device_id=${encodeURIComponent(deviceId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return [];
  }
}

export async function getStrategyBoard(matchKey) {
  try {
    const res = await fetch(`${API_BASE}/matches/${matchKey}/strategy-board`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) { return null; }
}

export async function postStrategyBoard(matchKey, annotations) {
  try {
    const res = await fetch(`${API_BASE}/matches/${matchKey}/strategy-board`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match_key: matchKey, annotations }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) { return null; }
}
