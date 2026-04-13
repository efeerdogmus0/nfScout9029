import { useEffect, useRef, useState } from "react";

import {
  getEventKey,
  getCurrentMatchNum, setCurrentMatchNum, getRotationMatchCount,
  getShiftStatusByUsername, getScoutDisplayName,
} from "../adminConfig";
import { fetchActiveQualification, fetchSchedule } from "../api";
import { buildQrDataUrl } from "../qr";
import { getOfflineReports, saveReport } from "../storage";

// ─── TIMING ──────────────────────────────────────────────────────────────────
// FRC 2026 REBUILT game manual (Table 6-2):
//   AUTO:             20s  (0:20→0:00)
//   TRANSITION SHIFT: 10s  (2:20→2:10)  ← first segment of TELEOP, both hubs active
//   SHIFT 1-4:        4×25s (2:10→0:30) ← hub alternates every 25s
//   END GAME:         30s  (0:30→0:00)  ← both hubs active again
//   TOTAL:            160s
// Note: the manual's "3-second delay for scoring purposes" is contained within
//       the first 3s of TRANSITION — robots are briefly disabled, no extra time added.
const AUTO_MS            = 20_000;   // AUTO period ends
const TRANSITION_END_MS  = 30_000;   // TRANSITION SHIFT ends → SHIFT 1 begins
const SHIFT_MS           = 25_000;   // duration of each SHIFT (1-4)
const TELEOP_END_MS      = 130_000;  // SHIFT 4 ends → END GAME begins
const MATCH_END_MS       = 160_000;  // END GAME ends

// ─── CANVAS SIZE ─────────────────────────────────────────────────────────────
const CW = 640;
const CH = 320;

// ─── FIELD ZONES — calibrated from real 2026 REBUILT field photo ─────────────
// Blue alliance LEFT, Red alliance RIGHT. Canvas: 640×320.
// Red bumps/trenches are blue mirrors: new_x = 641 - blue_x - blue_w
const FIELD_DEFAULT = {
  fieldBoundary: { x: 42,  y: 18,  w: 557, h: 283 },
  blueZone:      { x: 43,  y: 19,  w: 132, h: 281 },
  redZone:       { x: 465, y: 20,  w: 134, h: 280 },
  neutralZone:   { x: 213, y: 20,  w: 213, h: 279 },
  blueHub:       { cx: 196, cy: 160, r: 18 },
  redHub:        { cx: 444, cy: 159, r: 19 },
  // Blue bumps
  blue_bump1:    { x: 177, y: 179, w: 36, h: 64 },
  blue_bump2:    { x: 176, y: 74,  w: 36, h: 63 },
  // Red bumps (mirrored)
  red_bump1:     { x: 428, y: 179, w: 36, h: 64 },
  red_bump2:     { x: 429, y: 74,  w: 36, h: 63 },
  // Blue trenches
  blue_trench1:  { x: 177, y: 243, w: 36, h: 58 },
  blue_trench2:  { x: 176, y: 22,  w: 37, h: 53 },
  // Red trenches (mirrored)
  red_trench1:   { x: 428, y: 243, w: 36, h: 58 },
  red_trench2:   { x: 428, y: 22,  w: 37, h: 53 },
  // Towers
  redTower:      { x: 557, y: 131, w: 43, h: 37 },
  blueTower:     { x: 43,  y: 151, w: 36, h: 36 },
};

function loadFieldZones() {
  try {
    const stored = JSON.parse(localStorage.getItem("fieldCalibZones"));
    return stored && Object.keys(stored).length > 0
      ? { ...FIELD_DEFAULT, ...stored }
      : FIELD_DEFAULT;
  } catch { return FIELD_DEFAULT; }
}
let FIELD = loadFieldZones();

function inRect(x, y, r) {
  return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
function inCircle(x, y, c) {
  if (!c) return false;
  const dx = x - c.cx, dy = y - c.cy;
  return dx*dx + dy*dy <= c.r*c.r;
}

function classifyZone(x, y) {
  const f = FIELD;
  if (inRect(x, y, f.blueZone))  return "blue_zone";
  if (inRect(x, y, f.redZone))   return "red_zone";
  if (inCircle(x, y, f.blueHub)) return "blue_hub";
  if (inCircle(x, y, f.redHub))  return "red_hub";
  if (inRect(x, y, f.blue_bump1) || inRect(x, y, f.blue_bump2) ||
      inRect(x, y, f.red_bump1)  || inRect(x, y, f.red_bump2))    return "bump";
  if (inRect(x, y, f.blue_trench1) || inRect(x, y, f.blue_trench2) ||
      inRect(x, y, f.red_trench1)  || inRect(x, y, f.red_trench2)) return "trench";
  if (inRect(x, y, f.neutralZone)) return "neutral";
  return "open";
}

// ─── FIELD DRAW ──────────────────────────────────────────────────────────────
function drawField(canvas, { autoPath, timeline, pingGlow, fieldImg, autoReview = false }) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const f = FIELD;

  // Background: calibration photo or fallback carpet
  if (fieldImg) {
    // Full photo scaled to canvas
    ctx.drawImage(fieldImg, 0, 0, CW, CH);
    // Subtle darkening so markers stay readable; ping = blue flash
    ctx.fillStyle = pingGlow ? "rgba(12,26,51,0.45)" : "rgba(0,0,0,0.28)";
    ctx.fillRect(0, 0, CW, CH);
  } else {
    ctx.fillStyle = pingGlow ? "#0c2d5e" : "#14291f";
    ctx.fillRect(0, 0, CW, CH);
  }

  // Field boundary outline (if calibrated)
  if (f.fieldBoundary) {
    ctx.strokeStyle = "#ffffffaa"; ctx.lineWidth = 2; ctx.setLineDash([]);
    ctx.strokeRect(f.fieldBoundary.x, f.fieldBoundary.y, f.fieldBoundary.w, f.fieldBoundary.h);
  } else {
    ctx.strokeStyle = "#ffffff55"; ctx.lineWidth = 1;
    ctx.strokeRect(4, 4, CW - 8, CH - 8);
  }

  // Center line
  ctx.setLineDash([8, 6]); ctx.strokeStyle = "#ffffff66"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(CW/2, 0); ctx.lineTo(CW/2, CH); ctx.stroke();
  ctx.setLineDash([]);

  // Neutral zone
  if (f.neutralZone) {
    ctx.fillStyle = "rgba(167,139,250,0.12)";
    ctx.fillRect(f.neutralZone.x, f.neutralZone.y, f.neutralZone.w, f.neutralZone.h);
    ctx.strokeStyle = "#a78bfa55"; ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(f.neutralZone.x, f.neutralZone.y, f.neutralZone.w, f.neutralZone.h);
    ctx.setLineDash([]);
    ctx.fillStyle = "#a78bfa55"; ctx.font = "7px monospace";
    ctx.fillText("NEUTRAL", f.neutralZone.x + 4, f.neutralZone.y + 10);
  }

  // Blue alliance zone
  if (f.blueZone) {
    ctx.fillStyle = "rgba(30,100,200,0.25)";
    ctx.fillRect(f.blueZone.x, f.blueZone.y, f.blueZone.w, f.blueZone.h);
    ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 2;
    ctx.strokeRect(f.blueZone.x, f.blueZone.y, f.blueZone.w, f.blueZone.h);
    ctx.fillStyle = "#60a5fa99"; ctx.font = "8px monospace";
    ctx.fillText("BLUE", f.blueZone.x + 4, f.blueZone.y + f.blueZone.h - 6);
  }

  // Red alliance zone
  if (f.redZone) {
    ctx.fillStyle = "rgba(180,30,30,0.25)";
    ctx.fillRect(f.redZone.x, f.redZone.y, f.redZone.w, f.redZone.h);
    ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2;
    ctx.strokeRect(f.redZone.x, f.redZone.y, f.redZone.w, f.redZone.h);
    ctx.fillStyle = "#ef444499"; ctx.font = "8px monospace";
    ctx.fillText("RED", f.redZone.x + 4, f.redZone.y + f.redZone.h - 6);
  }

  // BUMPs — blue side (yellow), red side (amber)
  [
    { b: f.blue_bump1, c: "#fbbf24" }, { b: f.blue_bump2, c: "#fbbf24" },
    { b: f.red_bump1,  c: "#f59e0b" }, { b: f.red_bump2,  c: "#f59e0b" },
  ].filter(({ b }) => b).forEach(({ b, c }) => {
    ctx.fillStyle = c + "55";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = c; ctx.lineWidth = 1;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = c; ctx.font = "bold 7px monospace";
    ctx.save(); ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    if (b.h > b.w) ctx.rotate(-Math.PI / 2);
    ctx.fillText("BUMP", -10, 3);
    ctx.restore();
  });

  // TRENCHes — blue side (slate), red side (darker slate)
  [
    { t: f.blue_trench1, c: "#94a3b8" }, { t: f.blue_trench2, c: "#94a3b8" },
    { t: f.red_trench1,  c: "#64748b" }, { t: f.red_trench2,  c: "#64748b" },
  ].filter(({ t }) => t).forEach(({ t, c }) => {
    ctx.fillStyle = "rgba(2,6,23,0.70)";
    ctx.fillRect(t.x, t.y, t.w, t.h);
    ctx.strokeStyle = c; ctx.lineWidth = 1;
    ctx.strokeRect(t.x, t.y, t.w, t.h);
    ctx.fillStyle = c; ctx.font = "bold 7px monospace";
    ctx.save(); ctx.translate(t.x + t.w / 2, t.y + t.h / 2);
    if (t.h > t.w) ctx.rotate(-Math.PI / 2);
    ctx.fillText("TRCH", -10, 3);
    ctx.restore();
  });

  // HUBs
  if (f.blueHub) drawHub(ctx, f.blueHub.cx, f.blueHub.cy, f.blueHub.r, "#60a5fa", "HUB");
  if (f.redHub)  drawHub(ctx, f.redHub.cx,  f.redHub.cy,  f.redHub.r,  "#ef4444", "HUB");

  // Towers
  if (f.redTower)  drawTower(ctx, f.redTower,  "#ef4444");
  if (f.blueTower) drawTower(ctx, f.blueTower, "#60a5fa");

  // ── DATA LAYER ──

  // Auto path
  if (autoPath.length > 1) {
    ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 2.5; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(autoPath[0].x, autoPath[0].y);
    autoPath.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  }
  autoPath.forEach((p, i) => {
    const r = autoReview ? 8 : (i === 0 ? 5 : 3);
    ctx.fillStyle = i === 0 ? "#16a34a" : "#4ade80";
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2); ctx.fill();
    if (autoReview) {
      ctx.strokeStyle = "#4ade80bb";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // Teleop pings — heatmap
  timeline.filter((e) => e.action === "ping").forEach((e, i) => {
    const age = timeline.filter((x) => x.action === "ping").length - i;
    const alpha = Math.max(0.2, 1 - age * 0.07);
    ctx.fillStyle = `rgba(56,189,248,${alpha})`;
    ctx.beginPath(); ctx.arc(e.x, e.y, 9, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = `rgba(56,189,248,${alpha * 0.6})`; ctx.lineWidth = 1; ctx.stroke();
  });

  // Shoot events — star marker
  // (shoot events drawn by video scout, not field)
  // Active shoot position crosshair
  // Problem events — exclamation
  timeline.filter((e) => e.action === "problem").forEach((e) => {
    if (!e.x) return;
    ctx.fillStyle = "#f97316";
    ctx.font = "bold 14px monospace";
    ctx.fillText("!", e.x - 4, e.y + 4);
  });
}

function drawHub(ctx, cx, cy, r, color, label) {
  // Outer ring
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
  // Inner target
  ctx.strokeStyle = color + "88"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.6, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.25, 0, Math.PI*2); ctx.stroke();
  // Cross
  ctx.strokeStyle = color + "55"; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
  ctx.stroke();
  ctx.fillStyle = color; ctx.font = "bold 9px monospace";
  ctx.fillText(label, cx - 8, cy + r + 12);
}

function drawTower(ctx, rect, color) {
  ctx.fillStyle = color + "33";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  // diagonal lines
  ctx.strokeStyle = color + "88"; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.x, rect.y); ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
  ctx.moveTo(rect.x + rect.w, rect.y); ctx.lineTo(rect.x, rect.y + rect.h);
  ctx.stroke();
  ctx.fillStyle = color; ctx.font = "7px monospace";
  ctx.fillText("TWR", rect.x + 1, rect.y + rect.h + 10);
}

function drawStar(ctx, cx, cy, color) {
  ctx.fillStyle = color;
  ctx.font = "14px monospace";
  ctx.fillText("★", cx - 6, cy + 5);
}

const PROBLEMS = [
  { key: "comms",    label: "COMMS"  },
  { key: "mech",     label: "MECH"   },
  { key: "stuck",    label: "STUCK"  },
  { key: "brownout", label: "BRNOUT" },
];

const TRAVERSALS = [
  { key: "trench", label: "TRENCH" },
  { key: "bump",   label: "BUMP"   },
];

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function EyesFreeTerminal({ auth, onLogout, onTimelineUpdate }) {
  const canvasRef      = useRef(null);
  const wrapRef        = useRef(null);
  const matchStartRef  = useRef(null);
  const fieldImgRef    = useRef(null);   // loaded field photo
  const climbRef       = useRef(null);
  const lastPingRef    = useRef(null);
  const dragRef       = useRef(null);   // index of dot being dragged, or null

  // Event from admin config
  const [eventKey, setEventKey] = useState(getEventKey);

  const [activeQual,      setActiveQual]      = useState(null);
  const [schedule,        setSchedule]        = useState([]);   // qm-only entries {match_key, red, blue}
  const [qualNumOverride, setQualNumOverride] = useState(null); // manual override for match number

  // Match state: idle | running | post_match | done
  const [matchPhase, setMatchPhase] = useState("idle");
  const [elapsedMs,  setElapsedMs]  = useState(0);

  // Field data
  const [autoPath, setAutoPath] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [pingGlow,      setPingGlow]      = useState(false);
  const [pingCountdown, setPingCountdown] = useState(0);   // seconds until next ping
  const lastPingTimeRef = useRef(null);                     // ms timestamp of last tap

  // Auto winner
  const [showAutoWinner,   setShowAutoWinner]   = useState(false);
  const [autoWinner,       setAutoWinner]       = useState(null);
  const [autoWinnerLocked, setAutoWinnerLocked] = useState(false);
  const [autoSaved,        setAutoSaved]        = useState(false);  // OTO KAYDET pressed

  // Shoot state

  // Foul
  const [foulCount,    setFoulCount]    = useState(0);
  const [showFoulNote, setShowFoulNote] = useState(false);
  const [foulNote,     setFoulNote]     = useState("");

  // Post-match
  const [postMatchData, setPostMatchData] = useState({ note: "" });

  // Save hint — small bottom feedback bar {msg, id}
  const [saveHint,    setSaveHint]    = useState(null);
  const saveHintTimer = useRef(null);
  const saveHintId    = useRef(0);
  function flash(msg) {
    const id = ++saveHintId.current;
    setSaveHint({ msg, id });
    clearTimeout(saveHintTimer.current);
    saveHintTimer.current = setTimeout(() => setSaveHint(null), 2000);
  }

  // Output
  const [syncStatus, setSyncStatus] = useState("");
  const [qr,         setQr]         = useState("");

  // Shift / vardiya — match-based
  const [currentMatchNum,    setCurrentMatchNumSt] = useState(getCurrentMatchNum);
  const [rotationMatchCount, setRotationMatchCount] = useState(getRotationMatchCount);

  const seat          = auth?.seat || "";
  const scoutAlliance = seat.startsWith("red") ? "red" : "blue";

  // ── Effective match: manual override wins over TBA active-qual ────────────────
  const effectiveMatch = (() => {
    if (qualNumOverride == null) return activeQual;
    const key = `${eventKey}_qm${qualNumOverride}`;
    return schedule.find(m => m.match_key === key)
        || { match_key: key, red: [], blue: [] };
  })();
  const teamLabel = resolveSeatTeam(effectiveMatch, seat);

  const isRunning    = matchPhase === "running";
  const isAuto       = isRunning && elapsedMs < AUTO_MS;
  // Auto review: auto timer ended but scout hasn't pressed OTO KAYDET yet
  const isAutoReview  = isRunning && elapsedMs >= AUTO_MS && !autoWinnerLocked;
  // TRANSITION SHIFT: 10s window at start of TELEOP, both hubs active (manual §6.4)
  const isTransition  = isRunning && autoWinnerLocked && elapsedMs >= AUTO_MS && elapsedMs < TRANSITION_END_MS;
  const isTeleop      = isRunning && autoWinnerLocked && elapsedMs >= TRANSITION_END_MS && elapsedMs < TELEOP_END_MS;
  const isEndgame     = isRunning && autoWinnerLocked && elapsedMs >= TELEOP_END_MS;
  // Which SHIFT are we in (1-4)?
  const shiftNum      = isTeleop
    ? Math.min(4, Math.floor((elapsedMs - TRANSITION_END_MS) / SHIFT_MS) + 1)
    : null;
  const hubState      = computeHubState({ elapsedMs, autoWinner, scoutAlliance });
  const shiftStatus = auth ? getShiftStatusByUsername(auth.username, currentMatchNum, rotationMatchCount) : null;
  const scoutName   = auth ? getScoutDisplayName(auth.username) : "";

  // ── Sync event key from admin config ────────────────────────────────────────
  useEffect(() => {
    const onCfg = () => setEventKey(getEventKey());
    window.addEventListener("adminConfigChanged", onCfg);
    return () => window.removeEventListener("adminConfigChanged", onCfg);
  }, []);

  // ── Shift / vardiya refresh ───────────────────────────────────────────────
  useEffect(() => {
    const onMatch = () => setCurrentMatchNumSt(getCurrentMatchNum());
    const onCfg   = () => setRotationMatchCount(getRotationMatchCount());
    window.addEventListener("currentMatchNumChanged", onMatch);
    window.addEventListener("adminConfigChanged", onCfg);
    return () => {
      window.removeEventListener("currentMatchNumChanged", onMatch);
      window.removeEventListener("adminConfigChanged", onCfg);
    };
  }, []);

  // ── Load field photo + zones (once on mount, refresh on storage change) ──────
  useEffect(() => {
    FIELD = loadFieldZones();

    function loadImg(src) {
      if (!src) { fieldImgRef.current = null; return; }
      const img = new Image();
      img.onload = () => {
        fieldImgRef.current = img;
        drawField(canvasRef.current, {
          autoPath: [], timeline: [], pingGlow: false,
          fieldImg: img,
        });
      };
      img.src = src;
    }

    loadImg(localStorage.getItem("fieldCalibImage"));

    const onStorage = (e) => {
      if (e.key === "fieldCalibZones") { FIELD = loadFieldZones(); }
      if (e.key === "fieldCalibImage") { loadImg(e.newValue); }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ── Canvas sizing: fill wrapper exactly (no aspect-ratio math) ──────────────
  useEffect(() => {
    const wrap   = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    function syncSize() {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w > 0 && h > 0) {
        canvas.style.width  = w + "px";
        canvas.style.height = h + "px";
      }
    }
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ── Timer ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (matchPhase !== "running") return;
    const id = setInterval(() => {
      if (!matchStartRef.current) return;
      const ms = Math.min(MATCH_END_MS, Date.now() - matchStartRef.current);
      setElapsedMs(ms);
      if (ms >= MATCH_END_MS) setMatchPhase("post_match");
    }, 100);
    return () => clearInterval(id);
  }, [matchPhase]);


  // ── Auto ends → vibrate only (winner shown after OTO KAYDET) ────────────────
  useEffect(() => {
    if (!isRunning || elapsedMs < AUTO_MS || elapsedMs > AUTO_MS + 600 || autoWinnerLocked) return;
    if (navigator.vibrate) navigator.vibrate(120);
  }, [elapsedMs, isRunning, autoWinnerLocked]);


  // ── Teleop→Endgame vibrate ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning || elapsedMs < TELEOP_END_MS || elapsedMs > TELEOP_END_MS + 400) return;
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
  }, [elapsedMs, isRunning]);

  const PING_INTERVAL = 7_000;

  // ── 7s ping countdown + glow ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isTransition && !isTeleop) { setPingCountdown(0); return; }
    // Tick every 100ms to keep countdown smooth
    const id = setInterval(() => {
      const now     = Date.now();
      const lastMs  = lastPingTimeRef.current ?? (matchStartRef.current ?? now);
      const sinceMs = now - lastMs;
      const leftMs  = Math.max(0, PING_INTERVAL - sinceMs);
      const leftSec = Math.ceil(leftMs / 1000);
      setPingCountdown(leftSec);

      if (sinceMs >= PING_INTERVAL) {
        // Time's up — flash + vibrate
        setPingGlow(true);
        if (navigator.vibrate) navigator.vibrate([40, 20, 40]);
        setTimeout(() => setPingGlow(false), 700);
        // Reset so glow fires once per interval, not every tick
        lastPingTimeRef.current = now;
      }
    }, 100);
    return () => { clearInterval(id); setPingCountdown(0); };
  }, [isTransition, isTeleop]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pull active qual + schedule ───────────────────────────────────────────────
  useEffect(() => {
    if (!seat || !eventKey) return;
    const pull = async () => {
      fetchActiveQualification(eventKey).then(setActiveQual).catch(() => {});
      try {
        const sched = await fetchSchedule(eventKey);
        setSchedule(sched.filter(m => m.match_key.includes("_qm")));
      } catch {}
    };
    pull();
    const id = setInterval(pull, 30_000);
    return () => clearInterval(id);
  }, [eventKey, seat]);

  // ── Canvas redraw ─────────────────────────────────────────────────────────────
  useEffect(() => {
    // During active AUTO: show only the last node (clean screen, less distraction).
    // During autoReview: show all nodes as large draggable dots.
    // After autoWinner locked (teleop+): draw no path at all.
    const pathToDraw = autoWinnerLocked
      ? []           // teleop / endgame: no path on canvas
      : autoPath;    // auto + autoReview: all nodes visible
    // During teleop/endgame: only the most recent ping is shown (previous ones cleared)
    const pings     = timeline.filter((e) => e.action === "ping");
    const lastPing  = pings.length ? [pings[pings.length - 1]] : [];
    const timelineToDraw = autoWinnerLocked
      ? [...timeline.filter((e) => e.action !== "ping"), ...lastPing]
      : timeline;

    drawField(canvasRef.current, {
      autoPath: pathToDraw, timeline: timelineToDraw, pingGlow,
      fieldImg: fieldImgRef.current,
      autoReview: isAutoReview,
    });
  }, [autoPath, timeline, pingGlow, isAutoReview, autoWinnerLocked]);

  // ── Propagate timeline ───────────────────────────────────────────────────────
  useEffect(() => { onTimelineUpdate?.(timeline); }, [timeline, onTimelineUpdate]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function nowMs() { return matchStartRef.current ? Date.now() - matchStartRef.current : 0; }
  function addEvent(ev) { setTimeline((prev) => [...prev, ev]); }

  function logout() { resetMatch(); onLogout?.(); }

  // ── Match flow ────────────────────────────────────────────────────────────────
  function startMatch() {
    const now = Date.now();
    // Save current qual number for match-based shift tracking
    const qualNum = effectiveMatch?.match_key
      ? parseInt(effectiveMatch.match_key.split("_qm")[1])
      : null;
    if (qualNum && !isNaN(qualNum)) {
      setCurrentMatchNum(qualNum);
      setCurrentMatchNumSt(qualNum);
    }
    resetMatch();
    setMatchPhase("running");
    matchStartRef.current = now;
  }

  function resetMatch() {
    setElapsedMs(0); setMatchPhase("idle");
    setAutoPath([]); setTimeline([]);
    setAutoWinner(null); setAutoWinnerLocked(false); setShowAutoWinner(false); setAutoSaved(false);
    setFoulCount(0); setFoulNote(""); setShowFoulNote(false);
    setPingCountdown(0); lastPingTimeRef.current = null;
    setPostMatchData({ note: "" });
    setSyncStatus(""); setQr("");
    lastPingRef.current = null;
    dragRef.current = null;
    setQualNumOverride(null); // let TBA pick next match automatically
  }

  function pickAutoWinner(winner) {
    setAutoWinner(winner); setAutoWinnerLocked(true); setShowAutoWinner(false);
  }

  function undoAutoPath() {
    setAutoPath((prev) => prev.slice(0, -1));
  }

  function saveAuto() {
    setAutoSaved(true);
    setShowAutoWinner(true);
    flash(`✅ Oto yolu kaydedildi (${autoPath.length} nokta)`);
  }

  // ── Canvas pointer handling (draw, drag, ping) ───────────────────────────────
  function canvasCoords(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left)  * (CW / rect.width),
      y: (e.clientY - rect.top)   * (CH / rect.height),
    };
  }

  function onPointerDown(e) {
    if (!isRunning) return;
    const { x, y } = canvasCoords(e);

    if (isAuto || isAutoReview) {
      // Check if touching an existing dot (hit radius = 18 canvas-px)
      const HIT2 = 18 * 18;
      let hitIdx = -1;
      for (let i = autoPath.length - 1; i >= 0; i--) {
        const dx = autoPath[i].x - x, dy = autoPath[i].y - y;
        if (dx*dx + dy*dy <= HIT2) { hitIdx = i; break; }
      }
      if (hitIdx >= 0) {
        dragRef.current = hitIdx;
        e.currentTarget.setPointerCapture(e.pointerId);
      } else if (isAuto) {
        // Add new waypoint only during active auto drawing (not review)
        setAutoPath((prev) => [...prev, { x, y, t_ms: nowMs() }]);
        flash("📍 Oto nokta eklendi");
      }
      return;
    }

    if (isTransition || isTeleop || isEndgame) {
      const ev = { t_ms: nowMs(), action: "ping", x, y, zone: classifyZone(x, y) };
      addEvent(ev);
      lastPingRef.current     = ev;
      lastPingTimeRef.current = Date.now();
      flash("📍 Konum işaretlendi");
    }
  }

  function onPointerMove(e) {
    if (dragRef.current === null) return;
    const { x, y } = canvasCoords(e);
    setAutoPath((prev) => prev.map((d, i) =>
      i === dragRef.current ? { ...d, x, y } : d
    ));
  }

  function onPointerUp() {
    dragRef.current = null;
  }


  // ── Foul ─────────────────────────────────────────────────────────────────────
  function addFoul() {
    setFoulCount((v) => v + 1);
    addEvent({ t_ms: nowMs(), action: "foul", note: "" });
    setShowFoulNote(true);
    flash("🟨 Faul kaydedildi");
  }
  function saveFoulNote() {
    if (foulNote.trim()) {
      setTimeline((prev) => {
        const copy = [...prev];
        const last = [...copy].reverse().find((e) => e.action === "foul");
        if (last) last.note = foulNote;
        return copy;
      });
    }
    setFoulNote(""); setShowFoulNote(false);
  }

  // ── Problems ─────────────────────────────────────────────────────────────────
  function logProblem(key) {
    if (!isRunning) return;
    addEvent({ t_ms: nowMs(), action: "problem", key });
    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    const label = PROBLEMS.find(p => p.key === key)?.label ?? key.toUpperCase();
    flash(`⚠️ ${label} işaretlendi`);
  }

  function logTraversal(key) {
    if (!isRunning) return;
    addEvent({ t_ms: nowMs(), action: "traversal", key });
    if (navigator.vibrate) navigator.vibrate(40);
    const label = TRAVERSALS.find(t => t.key === key)?.label ?? key.toUpperCase();
    flash(`🔀 ${label} geçişi kaydedildi`);
  }

  // ── Climb ────────────────────────────────────────────────────────────────────
  function onClimbDown(level) {
    if (!isEndgame) return;
    climbRef.current = { level, startedAt: Date.now(), t_ms: nowMs() };
  }
  function onClimbUp() {
    if (!climbRef.current) return;
    const { level } = climbRef.current;
    addEvent({ t_ms: climbRef.current.t_ms, action: "climb", value: level, duration_ms: Date.now() - climbRef.current.startedAt });
    climbRef.current = null;
    flash(`🧗 Tırmanma ${level} kaydedildi`);
  }

  // ── Post-match submit ────────────────────────────────────────────────────────
  async function submitPostMatch() {
    const climbs = timeline.filter((e) => e.action === "climb");
    const climb  = climbs.length ? climbs[climbs.length - 1].value : "none";
    const report = toBackendReport({ eventKey, matchKey: effectiveMatch?.match_key || "unknown", teamKey: teamLabel, seat, autoPath, timeline, foulCount, postMatchData, climb });
    // Normalise pixel-space coords to 0-1 for consistent analytics consumption
    const normPath     = autoPath.map(p => ({ ...p, x: p.x / CW, y: p.y / CH }));
    const normTimeline = timeline.map(ev =>
      ev.action === "ping" ? { ...ev, x: ev.x / CW, y: ev.y / CH } : ev
    );
    // Normalise tower_level to "L1"/"L2"/"L3" for teamAnalytics compatibility
    const normTowerLevel = (report.tower_level || "none")
      .replace("level_", "L").replace(/^L(\d)$/, (_, n) => `L${n}`);
    await saveReport({
      ...report,
      auto_path_points: normPath,
      timeline: normTimeline,
      location_pings: report.location_pings.map(p => ({ ...p, x: p.x / CW, y: p.y / CH })),
      tower_level: normTowerLevel,
    });
    if (navigator.onLine) {
      try {
        const r = await fetch("http://localhost:8001/sync/upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_id: `seat-${seat}`, reports: [report] }),
        });
        setSyncStatus(r.ok ? "✓ Veri gönderildi." : "✗ Gönderim başarısız.");
      } catch { setSyncStatus("✗ Bağlantı yok."); }
    } else {
      const reports = await getOfflineReports();
      setQr(await buildQrDataUrl({ reports }));
      setSyncStatus("Offline — QR hazır.");
    }
    setMatchPhase("done");
  }

  // ── SCREENS ──────────────────────────────────────────────────────────────────
  if (matchPhase === "post_match") return (
    <PostMatchScreen postMatchData={postMatchData} setPostMatchData={setPostMatchData}
      foulCount={foulCount} timeline={timeline} onSubmit={submitPostMatch} />
  );

  if (matchPhase === "done") return (
    <DoneScreen syncStatus={syncStatus} qr={qr} onNext={resetMatch} />
  );

  if (matchPhase === "idle") return (
    <ReadyScreen
      seat={seat} teamLabel={teamLabel}
      matchKey={effectiveMatch?.match_key}
      eventKey={eventKey}
      schedule={schedule}
      qualNumOverride={qualNumOverride}
      onQualChange={setQualNumOverride}
      shiftStatus={shiftStatus}
      scoutName={scoutName}
      onStart={startMatch} onLogout={logout} />
  );

  // ── RUNNING ──────────────────────────────────────────────────────────────────
  const secsLeft   = Math.max(0, Math.ceil((MATCH_END_MS - elapsedMs) / 1000));
  const phaseLabel = isAuto         ? "AUTO"
                   : isAutoReview   ? "OTO BİTTİ"
                   : isTransition   ? "TRANSİSYON"
                   : isTeleop       ? `TELEOP S${shiftNum}`
                   : "ENDGAME";
  const phaseColor = isAuto         ? "#4ade80"
                   : isAutoReview   ? "#fde68a"
                   : isTransition   ? "#a78bfa"
                   : isTeleop       ? "#38bdf8"
                   : "#f97316";

  return (
    <div className="ef-root">
      {/* STATUS BAR */}
      <div className="ef-statusbar">
        <span className="ef-timer">{secsLeft}s</span>
        <span className="ef-phase" style={{ color: phaseColor }}>{phaseLabel}</span>
        <span className={`ef-hub ${hubState}`}>HUB {hubState === "active" ? "ON" : "OFF"}</span>
        <span className="ef-seat">{seat.toUpperCase()}</span>
        {shiftStatus && (
          <span className={`ef-shift-badge ${shiftStatus.isActive ? "shift-active" : "shift-break"}`}>
            {shiftStatus.isActive ? `▶ ${shiftStatus.matchesLeft}m` : `☕ →${shiftStatus.nextChangeAt}`}
          </span>
        )}
      </div>

      {/* AUTO WINNER OVERLAY */}
      {showAutoWinner && (
        <div className="ef-overlay">
          <p>OTO KİM KAZANDI?</p>
          <div className="ef-auto-winner-row">
            <button className="btn-red-win"  onClick={() => pickAutoWinner("red")}>RED</button>
            <button className="btn-blue-win" onClick={() => pickAutoWinner("blue")}>BLUE</button>
          </div>
        </div>
      )}

      {/* FOUL NOTE OVERLAY */}
      {showFoulNote && (
        <div className="ef-overlay">
          <p>Foul sebebi:</p>
          <input autoFocus value={foulNote} onChange={(e) => setFoulNote(e.target.value)}
            placeholder="G12, contact vs." onKeyDown={(e) => e.key === "Enter" && saveFoulNote()} />
          <button onClick={saveFoulNote}>KAYDET</button>
        </div>
      )}

      {/* FIELD CANVAS */}
      <div ref={wrapRef} className="ef-canvas-wrap">
        <canvas data-cy="battle-canvas" ref={canvasRef}
          width={CW} height={CH} className="ef-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} />
      </div>

      {isAuto && (
        <div className="ef-auto-hint-bar">
          <span className="ef-hint">✏️ Sahaya dokun → nokta koy · {Math.max(0, Math.ceil((AUTO_MS - elapsedMs)/1000))}s</span>
          <button className="ef-undo-btn" onClick={undoAutoPath} disabled={autoPath.length === 0}>↩ Geri Al</button>
        </div>
      )}
      {isAutoReview && (
        <div className="ef-auto-review-bar">
          <span className="ef-ar-hint">Noktaları sürükle &amp; düzenle</span>
          <button className="ef-undo-btn" onClick={undoAutoPath} disabled={autoPath.length === 0}>↩ Geri Al</button>
          <button className="ef-ar-save-btn" onClick={saveAuto}>OTO KAYDET →</button>
        </div>
      )}
      {(isTransition || isTeleop) && (
        <div className={`ef-ping-bar ${pingCountdown <= 2 ? "ef-ping-urgent" : pingCountdown <= 4 ? "ef-ping-soon" : ""}`}>
          <span className="ef-ping-label">📍 KONUM İŞARETLE</span>
          <span className="ef-ping-countdown">{pingCountdown}s</span>
        </div>
      )}
      {/* TRAVERSAL ROW — big TRENCH + BUMP buttons (teleop + endgame) */}
      {(isTransition || isTeleop || isEndgame) && (
        <div className="ef-traversal-row">
          {TRAVERSALS.map((t) => {
            const count = timeline.filter((e) => e.action === "traversal" && e.key === t.key).length;
            return (
              <button key={t.key} className="ef-trav-btn" onClick={() => logTraversal(t.key)}>
                <span>{t.label}</span>
                {count > 0 && <span className="ef-trav-count">×{count}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* ISSUE ROW — small problem + foul buttons (teleop + endgame) */}
      {(isTransition || isTeleop || isEndgame) && (
        <div className="ef-issue-row">
          {PROBLEMS.map((p) => (
            <button key={p.key} className="ef-issue-sm" onClick={() => logProblem(p.key)}>{p.label}</button>
          ))}
          <button className="ef-foul-sm" onClick={addFoul}>
            FOUL{foulCount > 0 ? ` ×${foulCount}` : ""}
          </button>
        </div>
      )}

      {/* ENDGAME CLIMB — L1/L2/L3 (shown alongside traversal+issue rows) */}
      {/* SAVE HINT — small confirmation bar */}
      {saveHint && (
        <div className="ef-save-hint" key={saveHint.id}>
          {saveHint.msg}
        </div>
      )}

      {isEndgame && (
        <div className="ef-endgame">
          {[1, 2, 3].map((lvl) => (
            <button key={lvl} className="ef-climb-btn"
              onPointerDown={() => onClimbDown(`level_${lvl}`)}
              onPointerUp={onClimbUp}>
              L{lvl}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SUB-SCREENS ──────────────────────────────────────────────────────────────

function PostMatchScreen({ postMatchData, setPostMatchData, foulCount, timeline, onSubmit }) {
  const problems    = timeline.filter((e) => e.action === "problem");
  const trenchCount = timeline.filter((e) => e.action === "traversal" && e.key === "trench").length;
  const bumpCount     = timeline.filter((e) => e.action === "traversal" && e.key === "bump").length;
  return (
    <div className="ef-postmatch">
      <h2>POST-MATCH NOTLAR</h2>
      <div className="ef-postmatch-summary">
        <div className="ef-pm-stat"><span>{foulCount}</span><label>FOUL</label></div>
        <div className="ef-pm-stat"><span>{problems.length}</span><label>PROBLEM</label></div>
        <div className="ef-pm-stat"><span>{trenchCount}</span><label>TRENCH</label></div>
        <div className="ef-pm-stat"><span>{bumpCount}</span><label>BUMP</label></div>
      </div>
      <p className="ef-pm-section">Genel not:</p>
      <textarea rows={4} placeholder="Dikkat çeken? Hız, strateji, zayıf nokta..."
        value={postMatchData.note}
        onChange={(e) => setPostMatchData((p) => ({ ...p, note: e.target.value }))} />
      <button className="ef-start-btn" onClick={onSubmit}>VERİYİ GÖNDER</button>
    </div>
  );
}

function DoneScreen({ syncStatus, qr, onNext }) {
  return (
    <div className="ef-summary">
      <h2>GÖNDERİLDİ</h2>
      <p className="ef-sync-status">{syncStatus}</p>
      {qr && <img data-cy="qr-image" src={qr} alt="Offline QR" className="ef-qr" />}
      <button className="ef-start-btn" onClick={onNext}>Sonraki Maç</button>
    </div>
  );
}

function ReadyScreen({ seat, teamLabel, matchKey, eventKey, schedule, qualNumOverride, onQualChange,
                        shiftStatus, scoutName, onStart, onLogout }) {
  const qualNum = matchKey ? parseInt(matchKey.split("_qm")[1]) : null;
  const isOverridden = qualNumOverride != null;
  const [inputVal, setInputVal] = useState(qualNum != null ? String(qualNum) : "");

  // Keep input in sync when TBA updates activeQual
  useEffect(() => {
    if (!isOverridden) setInputVal(qualNum != null ? String(qualNum) : "");
  }, [qualNum, isOverridden]);

  function commitInput(raw) {
    const n = parseInt(raw);
    if (!isNaN(n) && n >= 1) onQualChange(n);
    else if (raw === "") onQualChange(null);
  }

  return (
    <div className="ef-ready">
      {/* Shift / vardiya card */}
      {shiftStatus ? (
        <div className={`ef-shift-card ${shiftStatus.isActive ? "shift-active" : "shift-break"}`}>
          {shiftStatus.isActive
            ? <>
                <span className="ef-shift-icon">▶</span>
                <span className="ef-shift-text">
                  <strong>{scoutName || seat.toUpperCase()}</strong>
                  {" · aktif · "}<em>{shiftStatus.matchesLeft} maç</em> kaldı
                  {" · maç "}<strong>{shiftStatus.nextChangeAt}</strong>'de mola
                </span>
              </>
            : <>
                <span className="ef-shift-icon">☕</span>
                <span className="ef-shift-text">
                  <strong>{scoutName || seat.toUpperCase()}</strong>
                  {" · mola · "}<em>{shiftStatus.matchesLeft} maç</em> sonra dön
                  {" · maç "}<strong>{shiftStatus.nextChangeAt}</strong>'de aktif
                </span>
              </>
          }
        </div>
      ) : (
        <div className="ef-shift-card shift-unknown">
          <span className="ef-shift-icon">⏱</span>
          <span className="ef-shift-text">
            {scoutName || seat.toUpperCase()}
            {" · "}vardiya ilk MATCH START'ta otomatik başlar
          </span>
        </div>
      )}

      <div className="ef-ready-seat">{seat.toUpperCase()}</div>
      <div className="ef-ready-team">TEAM {teamLabel}</div>

      {/* Qual number stepper */}
      <div className="ef-qual-stepper">
        <button className="ef-qs-btn" onClick={() => {
          const cur = parseInt(inputVal) || (qualNum ?? 1);
          const next = Math.max(1, cur - 1);
          setInputVal(String(next)); onQualChange(next);
        }}>−</button>
        <span className="ef-qs-label">QUAL</span>
        <input
          className="ef-qs-input"
          type="number" min="1" inputMode="numeric"
          value={inputVal}
          onChange={(e) => { setInputVal(e.target.value); commitInput(e.target.value); }}
          onBlur={(e) => commitInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
        />
        <button className="ef-qs-btn" onClick={() => {
          const cur = parseInt(inputVal) || (qualNum ?? 0);
          const next = cur + 1;
          setInputVal(String(next)); onQualChange(next);
        }}>+</button>
        {isOverridden && (
          <button className="ef-qs-reset" onClick={() => { onQualChange(null); setInputVal(qualNum != null ? String(qualNum) : ""); }} title="TBA'ya dön">↺ TBA</button>
        )}
      </div>

      <div className="ef-ready-match">
        {matchKey || "Maç bekleniyor..."}
        {isOverridden && <span className="ef-manual-badge"> MANUEL</span>}
      </div>
      <div className="ef-ready-event">{eventKey}</div>

      <button data-cy="start-match" className="ef-start-btn" onClick={onStart}>MATCH START</button>
      <button className="ef-logout-btn" onClick={onLogout}>Çıkış yap</button>
    </div>
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function resolveSeatTeam(activeQual, seat) {
  if (!activeQual || !seat) return "---";
  const teams = seat.startsWith("red") ? activeQual.red || [] : activeQual.blue || [];
  return teams[Number(seat.slice(-1)) - 1] || "---";
}

// HUB STATUS per game manual §6.4.1:
//   AUTO + TRANSITION SHIFT + END GAME → both hubs active
//   SHIFT 1 (30-55s)  → autoWinner hub INACTIVE, opponent ACTIVE
//   SHIFT 2 (55-80s)  → autoWinner hub ACTIVE,   opponent INACTIVE
//   SHIFT 3 (80-105s) → autoWinner hub INACTIVE
//   SHIFT 4 (105-130s)→ autoWinner hub ACTIVE
// "The ALLIANCE that scores the most FUEL during AUTO will have their HUB
//  set to inactive for SHIFT 1" — then alternates each shift.
function computeHubState({ elapsedMs, autoWinner, scoutAlliance }) {
  // AUTO + TRANSITION SHIFT + END GAME: both hubs always active (game manual §6.4)
  if (elapsedMs < TRANSITION_END_MS) return "active";  // covers AUTO + TRANSITION
  if (elapsedMs >= TELEOP_END_MS)    return "active";  // covers ENDGAME
  // SHIFTS 1-4: depends on who won auto — need autoWinner
  if (!autoWinner) return "inactive";
  const shiftIndex = Math.floor((elapsedMs - TRANSITION_END_MS) / SHIFT_MS); // 0-3
  const autoWinnerActive = (shiftIndex % 2 === 1);
  const myHubActive = scoutAlliance === autoWinner ? autoWinnerActive : !autoWinnerActive;
  return myHubActive ? "active" : "inactive";
}

function toBackendReport({ eventKey, matchKey, teamKey, seat, autoPath, timeline, foulCount, postMatchData, climb }) {
  const pings = timeline.filter((e) => e.action === "ping");
  const usedBump    = timeline.some((e) => e.action === "traversal" && e.key === "bump");
  const usedTrench  = timeline.some((e) => e.action === "traversal" && e.key === "trench");
  const notes       = [postMatchData.note].filter(Boolean).join("; ");
  return {
    event_key: eventKey, match_key: matchKey, team_key: teamKey,
    scout_device_id: `seat-${seat}`,
    auto_path_points: autoPath.map(p => ({ ...p, x: p.x / CW, y: p.y / CH })),
    auto_fuel_scored: 0,
    teleop_fuel_scored_active: 0, teleop_fuel_scored_inactive: 0,
    hub_state_samples: [],
    bump_slow_or_stuck:   usedBump,
    trench_slow_or_stuck: usedTrench,
    tower_level: climb === "none" ? "none" : climb,
    teleop_shoot_timestamps_ms: [],
    location_pings: pings.map((p) => ({
      t_ms: p.t_ms, x: p.x / CW, y: p.y / CH,
      near_bump:   p.zone === "bump",
      near_trench: p.zone === "trench",
    })),
    notes,
  };
}
