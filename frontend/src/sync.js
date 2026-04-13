const API_BASE = "http://localhost:8001";

export async function syncReportsIfOnline(deviceId, reports) {
  if (!navigator.onLine || !reports.length) return { synced: 0 };
  try {
    const response = await fetch(`${API_BASE}/sync/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, reports }),
    });
    if (!response.ok) throw new Error("sync failed");
    const body = await response.json();
    return { synced: body.device_upload_count || 0 };
  } catch {
    return { synced: 0 };
  }
}
