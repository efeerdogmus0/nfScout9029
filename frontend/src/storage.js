const DB_NAME = "rebuilt-scouting";
const STORE = "reports";
const OUTBOX_META_KEY = "outboxMeta"; // { [report_id]: { state, ... } }

function now() { return Date.now(); }
function randomHex(n = 8) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// UUIDv7-like (time ordered) id for idempotent sync
function createReportId() {
  return `rpt_${now().toString(36)}_${randomHex(6)}`;
}

function loadOutboxMeta() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_META_KEY)) || {}; }
  catch { return {}; }
}
function saveOutboxMeta(meta) {
  localStorage.setItem(OUTBOX_META_KEY, JSON.stringify(meta));
  window.dispatchEvent(new Event("outboxMetaChanged"));
}
function ensureReportEnvelope(report) {
  return {
    ...report,
    report_id: report.report_id || createReportId(),
    updated_at: report.updated_at || now(),
    created_at: report.created_at || now(),
  };
}

export async function saveReport(report) {
  const enriched = ensureReportEnvelope(report);
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add({ ...enriched, savedAt: now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const list = JSON.parse(localStorage.getItem("reports") || "[]");
    list.push({ ...enriched, savedAt: now() });
    localStorage.setItem("reports", JSON.stringify(list));
  }
  // Outbox state machine entry
  const meta = loadOutboxMeta();
  meta[enriched.report_id] = {
    state: "pending",
    retry_count: 0,
    next_retry_at: 0,
    last_error: null,
    updated_at: enriched.updated_at,
  };
  saveOutboxMeta(meta);
  window.dispatchEvent(new Event("offlineReportsChanged"));
  // Best-effort background sync request (if supported)
  try {
    if ("serviceWorker" in navigator && "SyncManager" in window) {
      navigator.serviceWorker.ready
        .then((reg) => reg.sync?.register("outbox-sync"))
        .catch(() => {});
    }
  } catch {}
}

export async function getOfflineReports() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return JSON.parse(localStorage.getItem("reports") || "[]");
  }
}

export async function clearOfflineReports() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    localStorage.removeItem("reports");
  }
  localStorage.removeItem(OUTBOX_META_KEY);
  window.dispatchEvent(new Event("outboxMetaChanged"));
}

/**
 * Merge video-scout fuel data (localStorage "videoFuelData") into field reports.
 * For each report, if matching video fuel entry exists, fill in the fuel fields.
 */
export function enrichReportsWithVideoFuel(reports) {
  let videoFuel = {};
  try { videoFuel = JSON.parse(localStorage.getItem("videoFuelData") || "{}"); } catch {}
  return reports.map((r) => {
    const matchFuel = videoFuel[r.match_key];
    if (!matchFuel || !matchFuel[r.team_key]) return r;
    const vf = matchFuel[r.team_key];
    return {
      ...r,
      teleop_fuel_scored_active:   vf.fuel_scored ?? r.teleop_fuel_scored_active,
      auto_fuel_scored:             r.auto_fuel_scored || 0,
    };
  });
}

export function getOutboxMeta() {
  return loadOutboxMeta();
}
export function setOutboxMeta(next) {
  saveOutboxMeta(next);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "savedAt" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
