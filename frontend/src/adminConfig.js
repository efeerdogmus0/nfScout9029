const KEY = "adminConfig";

const DEFAULTS = { eventKey: "2026miket", tbaKey: "", pitScoutCount: 2, rotationMatchCount: 12, scoutNames: {}, myTeam: "" };

// ─── BASIC CONFIG ─────────────────────────────────────────────────────────────
export function getAdminConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; }
  catch { return { ...DEFAULTS }; }
}
export function setAdminConfig(config) {
  localStorage.setItem(KEY, JSON.stringify(config));
  window.dispatchEvent(new Event("adminConfigChanged"));
}

export function getEventKey()     { return getAdminConfig().eventKey || DEFAULTS.eventKey; }
export function getTbaKey()       { return getAdminConfig().tbaKey  || ""; }
export function getPitScoutCount(){ return getAdminConfig().pitScoutCount ?? 2; }
/** Our team number, normalised to "frcXXX" format. */
export function getMyTeam() {
  const raw = (getAdminConfig().myTeam || "").trim();
  if (!raw) return "";
  return raw.startsWith("frc") ? raw : `frc${raw}`;
}

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

// ─── CREDENTIALS ──────────────────────────────────────────────────────────────
/** Auto-generated field scout credentials (mirrors backend SEAT_ASSIGNMENTS). */
export function getFieldCredentials() {
  return [
    { username: "scout_red_1",  pin: "1111", seat: "red1",   seatIndex: 0 },
    { username: "scout_red_2",  pin: "2222", seat: "red2",   seatIndex: 1 },
    { username: "scout_red_3",  pin: "3333", seat: "red3",   seatIndex: 2 },
    { username: "scout_blue_1", pin: "4444", seat: "blue1",  seatIndex: 3 },
    { username: "scout_blue_2", pin: "5555", seat: "blue2",  seatIndex: 4 },
    { username: "scout_blue_3", pin: "6666", seat: "blue3",  seatIndex: 5 },
    { username: "scout_7",      pin: "7777", seat: "seat7",  seatIndex: 6 },
    { username: "scout_8",      pin: "8888", seat: "seat8",  seatIndex: 7 },
    { username: "scout_9",      pin: "9999", seat: "seat9",  seatIndex: 8 },
    { username: "scout_10",     pin: "0000", seat: "seat10", seatIndex: 9 },
  ];
}

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

/** Returns every credential in the app (used by the unified login screen). */
export function getAllCredentials() {
  return [
    ...getFieldCredentials().map(c => ({ ...c, role: "field_scout" })),
    ...getPitCredentials(),
    ...getVideoCredentials(),
    getAdminCredential(),
  ];
}

/**
 * Validate username + PIN against all known credentials.
 * Returns the credential object (with role) or null.
 */
export function validateLogin(username, pin) {
  const trimU = (username || "").trim().toLowerCase();
  const trimP = (pin || "").trim();
  return getAllCredentials().find(
    c => c.username.toLowerCase() === trimU && c.pin === trimP
  ) || null;
}

// ─── MATCH-BASED ROTATION ─────────────────────────────────────────────────────
// 10 scouts → 5 groups of 2 (A-E), staggered by rotationMatchCount (R).
// Cycle = 5R: each group is ACTIVE for 3R matches, BREAK for 2R matches.
// At any match M: exactly 3 groups active = 6 scouts on field.
//
// Groups:
//   A (0) → red1, red2     (seatIndex 0,1)  — primary
//   B (1) → red3, blue1    (seatIndex 2,3)  — primary
//   C (2) → blue2, blue3   (seatIndex 4,5)  — primary
//   D (3) → seat7, seat8   (seatIndex 6,7)  — extra
//   E (4) → seat9, seat10  (seatIndex 8,9)  — extra
//
// Active segments (R=rotationMatchCount):
//   Maç 1–R       : A B C aktif | D E mola
//   Maç R+1–2R    : A B E aktif | C D mola
//   Maç 2R+1–3R   : A D E aktif | B C mola
//   Maç 3R+1–4R   : C D E aktif | A B mola
//   Maç 4R+1–5R   : B C D aktif | A E mola
const LS_MATCH = "currentMatchNum";
const SEAT_GROUP = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]; // group index per seatIndex

export function getCurrentMatchNum() {
  try { const v = localStorage.getItem(LS_MATCH); return v ? parseInt(v) : null; }
  catch { return null; }
}
export function setCurrentMatchNum(n) {
  localStorage.setItem(LS_MATCH, String(n));
  window.dispatchEvent(new Event("currentMatchNumChanged"));
}
export function clearCurrentMatchNum() {
  localStorage.removeItem(LS_MATCH);
  window.dispatchEvent(new Event("currentMatchNumChanged"));
}

export function getRotationMatchCount() {
  return getAdminConfig().rotationMatchCount ?? 12;
}

/**
 * Returns match-based shift status for a scout.
 * @param {number} seatIndex   0-9
 * @param {number|null} currentMatchNum  current qual match number
 * @param {number} R  rotationMatchCount
 */
export function getShiftStatus(seatIndex, currentMatchNum, R) {
  const rot = R ?? getRotationMatchCount();
  if (currentMatchNum == null || seatIndex < 0 || seatIndex > 9) return null;
  const CYCLE = 5 * rot;
  const WORK  = 3 * rot;
  const phase = ((currentMatchNum - 1) + SEAT_GROUP[seatIndex] * rot) % CYCLE;
  const isActive    = phase < WORK;
  const matchesLeft = isActive ? WORK - phase : CYCLE - phase;
  const nextChangeAt = currentMatchNum + matchesLeft;
  return { isActive, matchesLeft, nextChangeAt };
}

/** Returns shift status by username. */
export function getShiftStatusByUsername(username, currentMatchNum, R) {
  const cred = getFieldCredentials().find(c => c.username === username);
  if (!cred) return null;
  return getShiftStatus(cred.seatIndex, currentMatchNum, R ?? getRotationMatchCount());
}

/**
 * For an extra scout (seatIndex 6-9), returns which primary seat they cover
 * when they are active (e.g. "red3"). Returns null when on break or if primary.
 */
export function getCoversSeat(seatIndex, currentMatchNum, R) {
  if (seatIndex < 6) return null;
  const rot = R ?? getRotationMatchCount();
  const status = getShiftStatus(seatIndex, currentMatchNum, rot);
  if (!status?.isActive) return null;
  // Primary groups on break (A=0, B=1, C=2) sorted by group index
  const onBreak = [0, 1, 2].filter(g => {
    const s = getShiftStatus(g * 2, currentMatchNum, rot);
    return s && !s.isActive;
  });
  // D (group 3) covers onBreak[0]; E (group 4) covers onBreak[1]
  const coverGroup = onBreak[SEAT_GROUP[seatIndex] - 3];
  if (coverGroup == null) return null;
  const posInGroup = seatIndex % 2; // 0=first, 1=second in pair
  return getFieldCredentials()[coverGroup * 2 + posInGroup]?.seat ?? null;
}

/**
 * Full snapshot of all 10 scouts' rotation status.
 */
export function getFullSchedule(currentMatchNum, R) {
  const rot = R ?? getRotationMatchCount();
  return getFieldCredentials().map(c => ({
    ...c,
    name: getScoutDisplayName(c.username),
    ...(getShiftStatus(c.seatIndex, currentMatchNum, rot) ?? { isActive: null, matchesLeft: null, nextChangeAt: null }),
    coversSeat: getCoversSeat(c.seatIndex, currentMatchNum, rot),
  }));
}
