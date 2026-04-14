const API_BASE = "http://localhost:8001";

// Backend expects tower_level as "none"|"level_1"|"level_2"|"level_3"
// Local storage uses short form "none"|"L1"|"L2"|"L3"
const TOWER_TO_BACKEND = { L1: "level_1", L2: "level_2", L3: "level_3" };

function toBackendReport(r) {
  return {
    ...r,
    tower_level: TOWER_TO_BACKEND[r.tower_level] ?? r.tower_level ?? "none",
  };
}

export async function syncReportsIfOnline(deviceId, reports) {
  if (!navigator.onLine || !reports.length) return { synced: 0 };
  try {
    const response = await fetch(`${API_BASE}/sync/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, reports: reports.map(toBackendReport) }),
    });
    if (!response.ok) throw new Error("sync failed");
    const body = await response.json();
    return { synced: body.device_upload_count || 0 };
  } catch {
    return { synced: 0 };
  }
}
