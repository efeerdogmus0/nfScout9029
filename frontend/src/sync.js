import { API_BASE } from "./config";
import { getOfflineReports, getOutboxMeta, setOutboxMeta } from "./storage";

// Backend expects tower_level as "none"|"level_1"|"level_2"|"level_3"
// Local storage uses short form "none"|"L1"|"L2"|"L3"
const TOWER_TO_BACKEND = { L1: "level_1", L2: "level_2", L3: "level_3" };
const SYNC_TELEMETRY_KEY = "syncTelemetry";
const BATCH_SIZE_DEFAULT = 15;
const MAX_RETRY_MS = 60_000;

function toBackendReport(r) {
  return {
    ...r,
    tower_level: TOWER_TO_BACKEND[r.tower_level] ?? r.tower_level ?? "none",
  };
}

function setTelemetry(patch) {
  let base = {};
  try { base = JSON.parse(localStorage.getItem(SYNC_TELEMETRY_KEY)) || {}; } catch {}
  const next = { ...base, ...patch, ts: Date.now() };
  localStorage.setItem(SYNC_TELEMETRY_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("syncTelemetryChanged"));
}

export function getSyncTelemetry() {
  try { return JSON.parse(localStorage.getItem(SYNC_TELEMETRY_KEY)) || {}; } catch { return {}; }
}

function classifyFetchError(status) {
  if (status >= 500) return "TRANSIENT";
  if (status === 409) return "CONFLICT";
  if (status >= 400) return "PERMANENT";
  return "UNKNOWN";
}

function expBackoffWithJitter(retryCount) {
  const base = Math.min(MAX_RETRY_MS, 2000 * (2 ** Math.max(0, retryCount - 1)));
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

async function isBackendHealthy() {
  if (!navigator.onLine) return false;
  try {
    const r = await fetch(`${API_BASE}/live/hub-state/current`, { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}

function withOutboxState(reports, meta) {
  return reports.map((r) => {
    const m = meta[r.report_id || ""] || {};
    return { ...r, _sync: { state: m.state || "pending", next_retry_at: m.next_retry_at || 0, retry_count: m.retry_count || 0 } };
  });
}

function resolveConflicts(reports, meta) {
  const byMatchTeam = {};
  for (const r of reports) {
    const key = `${r.match_key}__${r.team_key}`;
    if (!byMatchTeam[key]) byMatchTeam[key] = [];
    byMatchTeam[key].push(r);
  }
  for (const arr of Object.values(byMatchTeam)) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    const winner = arr[0];
    for (let i = 1; i < arr.length; i++) {
      const loser = arr[i];
      if (!loser.report_id) continue;
      meta[loser.report_id] = {
        ...(meta[loser.report_id] || {}),
        state: "conflicted",
        conflict_with: winner.report_id,
        last_error: "local_conflict_loser",
        updated_at: loser.updated_at || Date.now(),
      };
    }
  }
}

async function uploadBatch(deviceId, batch) {
  const slow = navigator.connection?.effectiveType?.includes("2g");
  const timeoutMs = slow ? 20_000 : 9_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE}/sync/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, reports: batch.map(toBackendReport) }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Sync from outbox only. Optional reportsFromCaller kept for backward compatibility.
export async function syncReportsIfOnline(deviceId, reportsFromCaller) {
  const healthy = await isBackendHealthy();
  if (!healthy) {
    setTelemetry({ online: navigator.onLine, backendHealthy: false, lastError: "backend_unreachable" });
    return { synced: 0, pending: 0 };
  }
  const reports = reportsFromCaller?.length ? reportsFromCaller : await getOfflineReports();
  if (!reports.length) {
    setTelemetry({ online: true, backendHealthy: true, pending: 0, lastSyncAt: Date.now(), lastError: null });
    return { synced: 0, pending: 0 };
  }

  const meta = getOutboxMeta();
  for (const r of reports) {
    if (!r.report_id) continue;
    if (!meta[r.report_id]) {
      meta[r.report_id] = {
        state: "pending",
        retry_count: 0,
        next_retry_at: 0,
        last_error: null,
        updated_at: r.updated_at || Date.now(),
      };
    }
  }
  resolveConflicts(reports, meta);
  setOutboxMeta(meta);

  const now = Date.now();
  const outbox = withOutboxState(reports, meta)
    .filter((r) => r.report_id)
    .filter((r) => ["pending", "failed", "sending"].includes(r._sync.state))
    .filter((r) => (r._sync.next_retry_at || 0) <= now)
    .sort((a, b) => (a.updated_at || 0) - (b.updated_at || 0));

  if (!outbox.length) {
    const pending = Object.values(meta).filter((m) => ["pending", "failed", "sending"].includes(m.state)).length;
    const retryEta = Object.values(meta).map((m) => m.next_retry_at || Infinity).reduce((a, b) => Math.min(a, b), Infinity);
    setTelemetry({ online: true, backendHealthy: true, pending, retryEta: Number.isFinite(retryEta) ? retryEta : null, lastError: null });
    return { synced: 0, pending };
  }

  let synced = 0;
  let idx = 0;
  const dynamicBatchSize = navigator.connection?.effectiveType?.includes("2g") ? 8 : BATCH_SIZE_DEFAULT;
  while (idx < outbox.length) {
    const batch = outbox.slice(idx, idx + dynamicBatchSize);
    batch.forEach((r) => {
      meta[r.report_id].state = "sending";
      meta[r.report_id].last_attempt_at = Date.now();
    });
    setOutboxMeta(meta);

    try {
      const response = await uploadBatch(deviceId, batch);
      if (!response.ok) {
        const errClass = classifyFetchError(response.status);
        if (errClass === "CONFLICT") {
          batch.forEach((r) => { meta[r.report_id] = { ...meta[r.report_id], state: "conflicted", last_error: "server_conflict" }; });
        } else if (errClass === "PERMANENT") {
          batch.forEach((r) => { meta[r.report_id] = { ...meta[r.report_id], state: "failed", last_error: `http_${response.status}`, next_retry_at: 0 }; });
        } else {
          batch.forEach((r) => {
            const retryCount = (meta[r.report_id]?.retry_count || 0) + 1;
            meta[r.report_id] = {
              ...meta[r.report_id],
              state: "failed",
              retry_count: retryCount,
              next_retry_at: Date.now() + expBackoffWithJitter(retryCount),
              last_error: `http_${response.status}`,
            };
          });
        }
        setOutboxMeta(meta);
        setTelemetry({ online: true, backendHealthy: true, lastError: `upload_${response.status}` });
        break;
      }
      const body = await response.json().catch(() => ({}));
      synced += body.device_upload_count || batch.length;
      batch.forEach((r) => {
        meta[r.report_id] = {
          ...meta[r.report_id],
          state: "sent",
          retry_count: 0,
          next_retry_at: 0,
          last_error: null,
          last_success_at: Date.now(),
        };
      });
      setOutboxMeta(meta);
      idx += dynamicBatchSize;
    } catch {
      batch.forEach((r) => {
        const retryCount = (meta[r.report_id]?.retry_count || 0) + 1;
        meta[r.report_id] = {
          ...meta[r.report_id],
          state: "failed",
          retry_count: retryCount,
          next_retry_at: Date.now() + expBackoffWithJitter(retryCount),
          last_error: "network_error",
        };
      });
      setOutboxMeta(meta);
      setTelemetry({ online: navigator.onLine, backendHealthy: false, lastError: "network_error" });
      break;
    }
  }

  const pending = Object.values(meta).filter((m) => ["pending", "failed", "sending"].includes(m.state)).length;
  const retryEta = Object.values(meta).map((m) => m.next_retry_at || Infinity).reduce((a, b) => Math.min(a, b), Infinity);
  setTelemetry({
    online: true,
    backendHealthy: true,
    pending,
    lastSyncAt: Date.now(),
    lastSyncedCount: synced,
    retryEta: Number.isFinite(retryEta) ? retryEta : null,
    lastError: pending ? "pending_remaining" : null,
  });
  try { window.dispatchEvent(new Event("offlineReportsChanged")); } catch {}
  return { synced, pending };
}

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}
function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export async function syncPitOutboxIfOnline() {
  if (!navigator.onLine) return { synced: 0, pending: 0 };
  const pitOutbox = loadJson("pitReportsOutbox", {});
  const pitReports = loadJson("pitReports", {});
  let synced = 0;
  for (const [id, meta] of Object.entries(pitOutbox)) {
    if (!["pending", "failed", "sending"].includes(meta?.state)) continue;
    const eventKey = meta?.event_key;
    const teamKey = meta?.team_key;
    const report = pitReports?.[teamKey];
    if (!eventKey || !teamKey || !report || typeof report !== "object") continue;
    pitOutbox[id] = { ...meta, state: "sending", last_error: null };
    saveJson("pitReportsOutbox", pitOutbox);
    try {
      const r = await fetch(`${API_BASE}/events/${eventKey}/pit-reports/${teamKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report }),
      });
      pitOutbox[id] = {
        ...pitOutbox[id],
        state: r.ok ? "sent" : "failed",
        last_error: r.ok ? null : `http_${r.status}`,
        last_success_at: r.ok ? Date.now() : (pitOutbox[id]?.last_success_at || null),
      };
      if (r.ok) synced += 1;
    } catch {
      pitOutbox[id] = { ...pitOutbox[id], state: "failed", last_error: "network_error" };
    }
    saveJson("pitReportsOutbox", pitOutbox);
    window.dispatchEvent(new Event("pitOutboxChanged"));
  }
  const pending = Object.values(pitOutbox).filter((m) => ["pending", "failed", "sending"].includes(m.state)).length;
  return { synced, pending };
}

export async function syncVideoOutboxIfOnline() {
  if (!navigator.onLine) return { synced: 0, pending: 0 };
  const outbox = loadJson("videoFuelOutbox", {});
  let synced = 0;
  for (const [id, meta] of Object.entries(outbox)) {
    if (!["pending", "failed", "sending"].includes(meta?.state)) continue;
    const payload = meta?.payload;
    if (!payload?.match_key) continue;
    outbox[id] = { ...meta, state: "sending", last_error: null };
    saveJson("videoFuelOutbox", outbox);
    try {
      const r = await fetch(`${API_BASE}/video-scout/fuel-entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      outbox[id] = {
        ...outbox[id],
        state: r.ok ? "sent" : "failed",
        last_error: r.ok ? null : `http_${r.status}`,
        last_success_at: r.ok ? Date.now() : (outbox[id]?.last_success_at || null),
      };
      if (r.ok) synced += 1;
    } catch {
      outbox[id] = { ...outbox[id], state: "failed", last_error: "network_error" };
    }
    saveJson("videoFuelOutbox", outbox);
    window.dispatchEvent(new Event("videoOutboxChanged"));
  }
  const pending = Object.values(outbox).filter((m) => ["pending", "failed", "sending"].includes(m.state)).length;
  return { synced, pending };
}
