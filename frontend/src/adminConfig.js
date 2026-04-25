const KEY = "adminConfig";

const DEFAULTS = {
  eventKey: "2026miket",
  tbaKey: "",
  openrouterKey: "",
  openrouterModel: "",
  pitScoutCount: 2,
  scoutNames: {},
  myTeam: "",
};

// ─── BASIC CONFIG ─────────────────────────────────────────────────────────────
export function getAdminConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; }
  catch { return { ...DEFAULTS }; }
}
export function setAdminConfig(config) {
  localStorage.setItem(KEY, JSON.stringify(config));
  window.dispatchEvent(new Event("adminConfigChanged"));
}

export function getEventKey()      { return getAdminConfig().eventKey || DEFAULTS.eventKey; }
export function getTbaKey()        { return getAdminConfig().tbaKey  || ""; }
export function getPitScoutCount() { return getAdminConfig().pitScoutCount ?? 2; }
export function getOpenRouterKey()   { return getAdminConfig().openrouterKey   || ""; }
export function getOpenRouterModel() { return getAdminConfig().openrouterModel || ""; }
export function getMyTeam() {
  const raw = (getAdminConfig().myTeam || "").trim();
  if (!raw) return "";
  return raw.startsWith("frc") ? raw : `frc${raw}`;
}

// ─── SCOUT NAMES (used for pit scouts) ────────────────────────────────────────
export function getScoutNames() { return getAdminConfig().scoutNames || {}; }
export function setScoutName(username, name) {
  const cfg = getAdminConfig();
  cfg.scoutNames = { ...cfg.scoutNames, [username]: name };
  setAdminConfig(cfg);
}
export function getScoutDisplayName(username) {
  const names = getScoutNames();
  return names[username] || username;
}

/** Build query string with tba_key if set */
export function tbaParams(extra = {}) {
  const key = getTbaKey();
  const params = new URLSearchParams(extra);
  if (key) params.set("tba_key", key);
  return params.toString() ? `?${params.toString()}` : "";
}

// ─── FIELD SEAT ASSIGNMENT (replaces rotation system) ─────────────────────────
// Each device claims a seat by name; sessions expire after 12 h.
// Order: red1 → red2 → red3 → blue1 → blue2 → blue3

export const FIELD_SEATS = ["red1", "red2", "red3", "blue1", "blue2", "blue3"];

const SEAT_LS         = "seatAssignments";
const ROLE_LS         = "roleSessions";
const SEAT_EXPIRY_MS  = 12 * 60 * 60 * 1000; // 12 hours

export function getSeatAssignments() {
  try { return JSON.parse(localStorage.getItem(SEAT_LS)) || {}; }
  catch { return {}; }
}

/** True if an assignment exists and is younger than 12 h. */
export function isFreshSeat(assignment) {
  return Boolean(assignment && (Date.now() - (assignment.ts || 0)) < SEAT_EXPIRY_MS);
}

/** Claim a seat for a named scout. Overwrites any existing claim. */
export function claimSeat(seat, name) {
  const prev = getSeatAssignments();
  prev[seat] = { name, ts: Date.now() };
  localStorage.setItem(SEAT_LS, JSON.stringify(prev));
}

/** Release a seat (called on logout). */
export function releaseSeat(seat) {
  const prev = getSeatAssignments();
  delete prev[seat];
  localStorage.setItem(SEAT_LS, JSON.stringify(prev));
}

/** Returns the first seat without a fresh assignment (auto-suggest). */
export function getNextAvailableSeat() {
  const assignments = getSeatAssignments();
  return FIELD_SEATS.find((s) => !isFreshSeat(assignments[s])) || FIELD_SEATS[0];
}

function cleanupRoleSessions(all) {
  const next = {};
  for (const [role, sessions] of Object.entries(all || {})) {
    next[role] = (sessions || []).filter((s) => isFreshSeat(s));
  }
  return next;
}

function getAllRoleSessions() {
  try {
    return cleanupRoleSessions(JSON.parse(localStorage.getItem(ROLE_LS)) || {});
  } catch {
    return {};
  }
}

function saveAllRoleSessions(all) {
  localStorage.setItem(ROLE_LS, JSON.stringify(cleanupRoleSessions(all)));
}

/** Returns active sessions for a role, sorted by join time. */
export function getRoleSessions(role) {
  const all = getAllRoleSessions();
  return [...(all[role] || [])].sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

/**
 * Join a role queue by name.
 * - role: "pit_scout" | "video_scout"
 * - maxCount: capacity limit (pit = 5)
 * - seatPrefix: "pit" or "video"
 */
export function joinRoleSession(role, name, maxCount = Infinity, seatPrefix = "role") {
  const n = (name || "").trim();
  if (!n) return { ok: false, error: "EMPTY_NAME" };
  const all = getAllRoleSessions();
  const list = (all[role] || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (list.length >= maxCount) return { ok: false, error: "FULL", count: list.length };
  const used = new Set(list.map((s) => s.seat));
  let idx = 1;
  while (used.has(`${seatPrefix}${idx}`)) idx++;
  const sess = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: n, seat: `${seatPrefix}${idx}`, ts: Date.now() };
  list.push(sess);
  all[role] = list;
  saveAllRoleSessions(all);
  return { ok: true, session: sess, count: list.length };
}

/** Leave role queue by session id. */
export function leaveRoleSession(role, sessionId) {
  const all = getAllRoleSessions();
  const list = (all[role] || []).filter((s) => s.id !== sessionId);
  all[role] = list;
  saveAllRoleSessions(all);
}

// ─── CREDENTIALS (pit / video / admin only) ───────────────────────────────────
export function getPitCredentials() {
  const count = getPitScoutCount();
  return Array.from({ length: count }, (_, i) => ({
    username:  `pit_scout_${i + 1}`,
    pin:       String((i + 1) * 111),
    seat:      `pit${i + 1}`,
    role:      "pit_scout",
    seatIndex: i,
  }));
}

export function getVideoCredentials() {
  return [
    { username: "video_1", pin: "v001", seat: "video1", role: "video_scout", seatIndex: -1 },
    { username: "video_2", pin: "v002", seat: "video2", role: "video_scout", seatIndex: -1 },
  ];
}

export function getAdminCredential() {
  return { username: "admin", pin: "efe123", seat: "admin", role: "admin", seatIndex: -1 };
}

/** Returns all non-field credentials (used by validateLogin). */
export function getAllCredentials() {
  return [
    ...getPitCredentials(),
    ...getVideoCredentials(),
    getAdminCredential(),
  ];
}

/**
 * Validate username + PIN for pit / video / admin accounts.
 * Field scouts skip this — they log in by name + seat selection.
 */
export function validateLogin(username, pin) {
  const trimU = (username || "").trim().toLowerCase();
  const trimP = (pin || "").trim();
  return getAllCredentials().find(
    (c) => c.username.toLowerCase() === trimU && c.pin === trimP
  ) || null;
}
