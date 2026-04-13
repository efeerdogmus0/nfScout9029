const DB_NAME = "rebuilt-scouting";
const STORE = "reports";

export async function saveReport(report) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add({ ...report, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const list = JSON.parse(localStorage.getItem("reports") || "[]");
    list.push({ ...report, savedAt: Date.now() });
    localStorage.setItem("reports", JSON.stringify(list));
  }
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
