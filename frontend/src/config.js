export const API_BASE = import.meta.env.VITE_API_BASE || "/api";
export const TBA_BASE = "https://www.thebluealliance.com/api/v3";
export const STATBOTICS_BASE = "https://api.statbotics.io/v3";

export const CW = 640;
export const CH = 320;

function getStableDeviceId() {
  const key = "deviceId";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = `app-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, created);
    return created;
  } catch {
    return `app-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export const DEVICE_ID = getStableDeviceId();
