/**
 * War Room — match strategy prep for upcoming quals.
 * Data sources:
 *   - TBA schedule (fetchSchedule)
 *   - Pit reports (localStorage pitReports)
 *   - Field scout reports (IndexedDB via getOfflineReports)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getEventKey, getMyTeam, getOpenRouterKey, getOpenRouterModel } from "../adminConfig";
import { fetchSchedule, fetchEPA, runWinPredict, fetchHubState, runTacticalInsight, runOverlay, fetchMatchData } from "../api";
import { getOfflineReports, enrichReportsWithVideoFuel } from "../storage";
import { generateStrategy, DEFAULT_MODEL } from "../strategyAI";
import {
  analyzeTeam, getCardInsights,
  detectAutoCollisions, findOpponentCarrier, findChokePoint,
  analyzeTrafficRouting, getReliabilityRoles, analyzeShootingPositions,
  computeSoS, ZONE_LABEL,
} from "../teamAnalytics";
import TeamProfileModal from "./TeamProfileModal";

const LS_STRAT    = "warRoomStrategy"; // { [match_key]: string }
const LS_AI_CACHE = "warRoomAICache";  // { [match_key]: string }

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function loadPitReports() {
  try { return JSON.parse(localStorage.getItem("pitReports")) || {}; }
  catch { return {}; }
}
function loadStrategies() {
  try { return JSON.parse(localStorage.getItem(LS_STRAT)) || {}; }
  catch { return {}; }
}
function saveStrategies(s) { localStorage.setItem(LS_STRAT, JSON.stringify(s)); }

function loadAiCache() {
  try { return JSON.parse(localStorage.getItem(LS_AI_CACHE)) || {}; }
  catch { return {}; }
}
function saveAiCache(c) { localStorage.setItem(LS_AI_CACHE, JSON.stringify(c)); }

/** Render GPT markdown-lite: **bold**, numbered lists */
function AiText({ text }) {
  const lines = text.split("\n");
  return (
    <div className="wr-ai-text">
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />;
        // Heading: starts with "1." "2." etc or "**...**" alone
        const isHeading = /^\d+\.\s+\*\*/.test(line);
        const rendered = line
          .replace(/\*\*(.+?)\*\*/g, (_, m) => `<strong>${m}</strong>`)
          .replace(/^#+\s+/, "");
        return (
          <p key={i}
            className={isHeading ? "wr-ai-heading" : "wr-ai-para"}
            dangerouslySetInnerHTML={{ __html: rendered }} />
        );
      })}
    </div>
  );
}

function teamNum(key) { return (key || "").replace("frc", ""); }

/** Aggregate field scout data for a single team across all scouted matches. */
function aggregateScoutData(teamKey, reports) {
  const mine = reports.filter((r) => r.team_key === teamKey);
  if (!mine.length) return null;

  let bumpCount = 0, trenchCount = 0, problemCounts = {}, pingZones = {};
  let autoPathLast = null;

  mine.forEach((r) => {
    if (r.bump_slow_or_stuck)   bumpCount++;
    if (r.trench_slow_or_stuck) trenchCount++;

    // timeline events (test data / enriched reports)
    (r.timeline || []).forEach((ev) => {
      if (ev.action === "problem") {
        problemCounts[ev.key] = (problemCounts[ev.key] || 0) + 1;
      }
      if (ev.action === "traversal") {
        if (ev.key === "bump")   bumpCount++;
        if (ev.key === "trench") trenchCount++;
      }
      if (ev.action === "ping" && ev.zone) {
        pingZones[ev.zone] = (pingZones[ev.zone] || 0) + 1;
      }
    });

    // location_pings from real EyesFreeTerminal reports
    (r.location_pings || []).forEach((p) => {
      if (p.zone)             pingZones[p.zone] = (pingZones[p.zone] || 0) + 1;
      else if (p.near_bump)   pingZones["bump"]   = (pingZones["bump"]   || 0) + 1;
      else if (p.near_trench) pingZones["trench"] = (pingZones["trench"] || 0) + 1;
      else                    pingZones["merkez"] = (pingZones["merkez"] || 0) + 1;
    });

    // problems from top-level array (real reports)
    (r.problems || []).forEach((key) => {
      problemCounts[key] = (problemCounts[key] || 0) + 1;
    });

    if (r.auto_path_points?.length) autoPathLast = r.auto_path_points;
  });

  const n = mine.length;
  return {
    matchesScoured: n,
    bumpPerMatch:   +(bumpCount   / n).toFixed(1),
    trenchPerMatch: +(trenchCount / n).toFixed(1),
    problemCounts,
    topZone: Object.entries(pingZones).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    autoPathLast,
  };
}

/** Auto-generate strategy tags from pit + scout data. */
function buildTags(pit, scout) {
  const tags = [];
  if (pit?.defense === "Ana Strateji")          tags.push({ label: "DEFANS", cls: "tag-defense" });
  if (pit?.defense === "Bazen")                  tags.push({ label: "DEFANS?", cls: "tag-warn" });
  if (scout?.bumpPerMatch >= 1)                  tags.push({ label: `BUMP ×${scout.bumpPerMatch}`, cls: "tag-bump" });
  if (scout?.trenchPerMatch >= 1)                tags.push({ label: `TRENCH ×${scout.trenchPerMatch}`, cls: "tag-trench" });
  if (pit?.bump)                                 tags.push({ label: "BUMP GEÇEBİLİR", cls: "tag-info" });
  if (pit?.trench)                               tags.push({ label: "TRENCH GEÇEBİLİR", cls: "tag-info" });
  if (pit?.climbTeleop?.includes("L3"))          tags.push({ label: "L3 (30p)", cls: "tag-climb" });
  else if (pit?.climbTeleop?.includes("L2"))     tags.push({ label: "L2 (20p)", cls: "tag-climb" });
  else if (pit?.climbTeleop?.includes("L1"))     tags.push({ label: "L1 (10p)", cls: "tag-climb" });
  if (pit?.climbAuto?.includes("L1"))            tags.push({ label: "AUTO L1 (15p)", cls: "tag-climb-auto" });
  if (pit?.shootRange === "Yok")                 tags.push({ label: "TOPÇU DEĞİL", cls: "tag-muted" });
  if (pit?.shootRange === "Her Mesafe")          tags.push({ label: "UZAK ATIŞÇI", cls: "tag-shooter" });
  if (scout?.problemCounts?.comms > 0)           tags.push({ label: `COMMS ×${scout.problemCounts.comms}`, cls: "tag-error" });
  if (scout?.problemCounts?.stuck > 0)           tags.push({ label: `STUCK ×${scout.problemCounts.stuck}`, cls: "tag-error" });
  if (pit?.autoFuel > 0)                         tags.push({ label: `AUTO ~${pit.autoFuel}F`, cls: "tag-fuel" });
  if (pit?.teleopFuel > 0)                       tags.push({ label: `TELEOP ~${pit.teleopFuel}F`, cls: "tag-fuel" });
  if (!pit && !scout)                            tags.push({ label: "VERİ YOK", cls: "tag-muted" });
  return tags;
}

// ─── FIELD ZONE FALLBACK (same as TeamProfileModal) ──────────────────────────
const FIELD_ZONES_FB = [
  { x:0,    y:0.18, w:0.30, h:0.27, c:"rgba(248,113,113,0.18)" },
  { x:0,    y:0.55, w:0.30, h:0.27, c:"rgba(248,113,113,0.18)" },
  { x:0.70, y:0.18, w:0.30, h:0.27, c:"rgba(96,165,250,0.18)"  },
  { x:0.70, y:0.55, w:0.30, h:0.27, c:"rgba(96,165,250,0.18)"  },
  { x:0,    y:0,    w:0.22, h:0.22, c:"rgba(251,146,60,0.15)"  },
  { x:0,    y:0.78, w:0.22, h:0.22, c:"rgba(251,146,60,0.15)"  },
  { x:0.78, y:0,    w:0.22, h:0.22, c:"rgba(129,140,248,0.15)" },
  { x:0.78, y:0.78, w:0.22, h:0.22, c:"rgba(129,140,248,0.15)" },
  { x:0.28, y:0.36, w:0.22, h:0.28, c:"rgba(252,165,165,0.20)" },
  { x:0.50, y:0.36, w:0.22, h:0.28, c:"rgba(147,197,253,0.20)" },
];

// Alliance colour palette: each robot gets a distinct shade
const TEAM_PALETTE = {
  red:  ["#f87171","#fca5a5","#ef4444"],
  blue: ["#60a5fa","#93c5fd","#3b82f6"],
};

// ─── MULTI PATH OVERLAY ───────────────────────────────────────────────────────
function MultiPathOverlay({ match, scoutReports }) {
  const canvasRef  = useRef(null);
  const [fieldImg, setFieldImg] = useState(null);
  const [overlayNote, setOverlayNote] = useState("");

  useEffect(() => {
    const src = localStorage.getItem("fieldCalibImage");
    if (!src) return;
    const img = new Image();
    img.onload  = () => setFieldImg(img);
    img.onerror = () => {};
    img.src = src;
  }, []);

  // Per-team last auto path — memoized so draw effect only fires when data changes
  const teamPaths = useMemo(() => {
    const paths = {};
    for (const tk of [...match.red, ...match.blue]) {
      const reps = scoutReports.filter(
        r => r.team_key === tk && (r.auto_path_points || []).length >= 2
      );
      if (!reps.length) continue;
      // Pick the most recent match report
      const latest = reps.reduce((a, b) => {
        const qa = parseInt(a.match_key?.split("_qm")[1]) || 0;
        const qb = parseInt(b.match_key?.split("_qm")[1]) || 0;
        return qb > qa ? b : a;
      });
      paths[tk] = latest.auto_path_points;
    }
    return paths;
  }, [match.red, match.blue, scoutReports]);

  // Team colour map
  const colorOf = (tk) => {
    const ri = match.red.indexOf(tk);
    if (ri >= 0) return TEAM_PALETTE.red[ri]  || TEAM_PALETTE.red[0];
    const bi = match.blue.indexOf(tk);
    if (bi >= 0) return TEAM_PALETTE.blue[bi] || TEAM_PALETTE.blue[0];
    return "#94a3b8";
  };

  // Draw — canvas is 480×240 to match field 640×320 (exact 2:1 ratio)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height; // 480 × 240

    ctx.clearRect(0, 0, W, H);

    // Background: fieldCalibImage is captured at 640×320 (2:1), canvas is 480×240 (2:1)
    // Same ratio → drawImage fits perfectly with no distortion
    if (fieldImg) {
      ctx.drawImage(fieldImg, 0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.42)"; ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = "#0a0e1a"; ctx.fillRect(0, 0, W, H);
      for (const z of FIELD_ZONES_FB) {
        ctx.fillStyle = z.c;
        ctx.fillRect(z.x * W, z.y * H, z.w * W, z.h * H);
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    if (!Object.keys(teamPaths).length) {
      ctx.font = "11px monospace"; ctx.fillStyle = "#64748b";
      ctx.textAlign = "center";
      ctx.fillText("Otonom path verisi yok", W / 2, H / 2);
      ctx.textAlign = "left";
      return;
    }

    for (const [tk, path] of Object.entries(teamPaths)) {
      if (!path.length) continue;
      const clr = colorOf(tk);

      // Draw path line
      ctx.strokeStyle = clr; ctx.lineWidth = 2.5; ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(path[0].x * W, path[0].y * H);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x * W, path[i].y * H);
      ctx.stroke();

      // Start dot (filled circle)
      ctx.beginPath();
      ctx.arc(path[0].x * W, path[0].y * H, 4, 0, Math.PI * 2);
      ctx.fillStyle = clr; ctx.fill();

      // End dot (direction arrow)
      const last = path[path.length - 1];
      const prev = path.length >= 2 ? path[path.length - 2] : path[0];
      const angle = Math.atan2(
        (last.y - prev.y) * H,
        (last.x - prev.x) * W
      );
      ctx.save();
      ctx.translate(last.x * W, last.y * H);
      ctx.rotate(angle);
      ctx.fillStyle = clr;
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4);
      ctx.closePath(); ctx.fill();
      ctx.restore();

      // Team number label above start point
      ctx.font = "bold 9px monospace"; ctx.fillStyle = clr;
      ctx.fillText(tk.replace("frc", ""), path[0].x * W + 5, path[0].y * H - 4);
    }
  }, [fieldImg, teamPaths]);

  // Try backend overlay for collision warnings
  // Schema: { match_key, paths: [{ robot: string, points: [{x,y,t_ms?}] }] }
  // Response: { match_key, warnings: [{ robot_a, robot_b, t_ms, x, y }] }
  useEffect(() => {
    if (!Object.keys(teamPaths).length) return;
    const paths = Object.entries(teamPaths).map(([tk, pts]) => ({
      robot:  tk,
      points: pts.map(p => ({ x: p.x, y: p.y, ...(p.t_ms != null ? { t_ms: p.t_ms } : {}) })),
    }));
    runOverlay({ match_key: match.match_key, paths })
      .then(r => {
        const w = r.warnings || [];
        if (w.length) {
          const msg = w.map(c =>
            `${teamNum(c.robot_a)} ↔ ${teamNum(c.robot_b)} yakın geçiş (t=${(c.t_ms/1000).toFixed(1)}s)`
          ).join(" · ");
          setOverlayNote(msg);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.match_key, teamPaths]);

  const hasPaths = Object.keys(teamPaths).length > 0;

  return (
    <div className="wr-overlay-section">
      <div className="wr-section-title">
        🗺 Otonom Yol Haritası
        <span className="wr-overlay-legend">
          {match.red.map((tk, i) => (
            <span key={tk} className="wr-overlay-dot" style={{ background: TEAM_PALETTE.red[i] }}>
              {teamNum(tk)}{teamPaths[tk] ? "" : " ✗"}
            </span>
          ))}
          {match.blue.map((tk, i) => (
            <span key={tk} className="wr-overlay-dot" style={{ background: TEAM_PALETTE.blue[i] }}>
              {teamNum(tk)}{teamPaths[tk] ? "" : " ✗"}
            </span>
          ))}
        </span>
      </div>
      {/* width=480 height=240 → exactly 2:1 to match field canvas (640×320) */}
      <canvas ref={canvasRef} width={480} height={240} className="wr-overlay-canvas" />
      {overlayNote && <p className="wr-overlay-note">⚠ {overlayNote}</p>}
      {!hasPaths && <p className="wr-overlay-hint">Bu maçtaki takımlar için otonom path henüz scouting edilmemiş.</p>}
    </div>
  );
}

// ─── LIVE HUB STATE ───────────────────────────────────────────────────────────
function HubStateWidget() {
  const [hub, setHub] = useState(null); // { red_hub_active, blue_hub_active, time_s }

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetchHubState()
        .then(d => { if (!cancelled) setHub(d); })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!hub) return null;

  return (
    <div className="wr-hub-state">
      <span className="wr-hub-label">🏭 Hub</span>
      <span className={`wr-hub-dot ${hub.red_hub_active  ? "hub-on" : "hub-off"}`}>RED</span>
      <span className={`wr-hub-dot ${hub.blue_hub_active ? "hub-on" : "hub-off"}`}>BLUE</span>
      {hub.time_s != null && (
        <span className="wr-hub-time">
          {hub.time_s >= 0 ? `+${hub.time_s}s` : `${hub.time_s}s`}
        </span>
      )}
    </div>
  );
}

// ─── TACTICAL INSIGHT PANEL ───────────────────────────────────────────────────
function TacticalInsightPanel({ match, myTeam, pitReports, scoutReports }) {
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState(null);

  const myAlliance = myTeam
    ? match.red.includes(myTeam) ? "red" : match.blue.includes(myTeam) ? "blue" : null
    : null;
  const ourTeams   = myAlliance ? (myAlliance === "red" ? match.red  : match.blue) : match.red;
  const enemyTeams = myAlliance ? (myAlliance === "red" ? match.blue : match.red)  : match.blue;

  async function fetchInsight() {
    setLoading(true); setErr(null);
    try {
      const res = await runTacticalInsight({
        match_key:    match.match_key,
        our_alliance: myAlliance || "red",
        our_teams:    ourTeams,
        enemy_teams:  enemyTeams,
        pit_data:     Object.fromEntries(
          [...ourTeams, ...enemyTeams].map(tk => [tk, pitReports[tk] || {}])
        ),
      });
      setInsight(res.insight || res.text || JSON.stringify(res));
    } catch {
      setErr("Backend bağlı değil ya da veri yetersiz.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wr-tactical-section">
      <div className="wr-section-title" style={{ display:"flex", alignItems:"center", gap:"0.6rem" }}>
        🧠 Taktik İpucu (Backend)
        <button className="wr-tactical-btn" disabled={loading} onClick={fetchInsight}>
          {loading ? "⏳" : insight ? "🔄" : "▶ Getir"}
        </button>
      </div>
      {err && <p className="wr-tactical-err">{err}</p>}
      {!loading && insight && (
        <p className="wr-tactical-text">{insight}</p>
      )}
    </div>
  );
}

// ─── SCOUT NOTES SUMMARY ──────────────────────────────────────────────────────
function ScoutNotesSummary({ match, scoutReports }) {
  const allTeams = [...match.red, ...match.blue];
  const notes = [];
  for (const tk of allTeams) {
    const reps = scoutReports.filter(r => r.team_key === tk);
    const alliance = match.red.includes(tk) ? "red" : "blue";
    for (const r of reps) {
      const qNum = r.match_key?.split("_qm")[1] || "?";
      if (r.notes?.trim()) notes.push({ tk, alliance, qNum, text: r.notes.trim() });
    }
  }
  if (!notes.length) return null;

  return (
    <div className="wr-scout-notes">
      <div className="wr-section-title">📝 Geçmiş Sahacı Notları</div>
      <div className="wr-notes-list">
        {notes.map((n, i) => (
          <div key={i} className={`wr-note-row wr-note-${n.alliance}`}>
            <span className="wr-note-team">{teamNum(n.tk)}</span>
            <span className="wr-note-match">Q{n.qNum}</span>
            <span className="wr-note-text">"{n.text}"</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MATCH AUDIT ─────────────────────────────────────────────────────────────
/**
 * Parses a 2026 TBA score_breakdown object for one alliance.
 * Returns { auto, transition, shift1, shift2, shift3, shift4, endgame, total }
 * — all as ball counts (1 ball = 1 point in 2026 REBUILT).
 */
function parseTbaFuel(bd) {
  if (!bd) return null;
  // TBA may use different field name patterns; try several
  const get = (...keys) => {
    for (const k of keys) { if (bd[k] != null) return bd[k]; }
    return 0;
  };

  const auto       = get("autoFuelPoints",       "autoFuelCount",       "auto_fuel_points");
  const transition = get("transitionShiftFuelPoints", "transitionFuelPoints", "transitionShiftFuelCount");
  const shift1     = get("shift1FuelPoints",  "shift1Fuel",  "teleopShift1Fuel");
  const shift2     = get("shift2FuelPoints",  "shift2Fuel",  "teleopShift2Fuel");
  const shift3     = get("shift3FuelPoints",  "shift3Fuel",  "teleopShift3Fuel");
  const shift4     = get("shift4FuelPoints",  "shift4Fuel",  "teleopShift4Fuel");
  const endgame    = get("endGameFuelPoints", "endgameFuelPoints", "endGameFuel");
  const total      = get("totalFuelPoints",   "fuelPoints") || (auto + transition + shift1 + shift2 + shift3 + shift4 + endgame);

  return { auto, transition, shift1, shift2, shift3, shift4, endgame, total };
}

/**
 * Scout aggregate fuel for an alliance from our IndexedDB reports.
 * Returns { auto, teleopActive, teleopInactive, total }
 */
function scoutFuelForAlliance(teams, matchKey, scoutReports) {
  let auto = 0, teleopActive = 0, teleopInactive = 0;
  for (const tk of teams) {
    const rep = scoutReports.find(r => r.team_key === tk && r.match_key === matchKey);
    if (!rep) continue;
    auto          += rep.auto_fuel_scored              || 0;
    teleopActive  += rep.teleop_fuel_scored_active     || 0;
    teleopInactive += rep.teleop_fuel_scored_inactive  || 0;
  }
  return { auto, teleopActive, teleopInactive, total: auto + teleopActive + teleopInactive };
}

// Flag levels
function auditFlag(scoutTotal, tbaTotal) {
  if (tbaTotal === 0 && scoutTotal === 0) return "ok";
  const diff = tbaTotal - scoutTotal;
  if (diff < 0)                                          return "overcount";   // impossible — critical
  if (diff > 0 && scoutTotal === 0 && tbaTotal > 0)     return "no_data";     // no scout at all
  const pct = tbaTotal > 0 ? diff / tbaTotal : 0;
  if (pct > 0.45 || diff > 40)                          return "large_gap";   // >45% or >40 balls gap
  if (pct > 0.20 || diff > 15)                          return "gap";         // >20% or >15 balls gap
  return "ok";
}

const FLAG_META = {
  ok:         { emoji: "✓",  cls: "audit-ok",        label: "Tutarlı"            },
  gap:        { emoji: "⚠",  cls: "audit-warn",       label: "Fark — İncele"      },
  large_gap:  { emoji: "🚨", cls: "audit-danger",     label: "Büyük Fark — Yeniden Scout" },
  overcount:  { emoji: "❌", cls: "audit-critical",   label: "Scoutcular Fazla Saydı!" },
  no_data:    { emoji: "📭", cls: "audit-muted",      label: "Scout Verisi Yok"   },
};

function AuditBar({ scout, tba, label }) {
  const max   = Math.max(tba, scout, 1);
  const flag  = auditFlag(scout, tba);
  const meta  = FLAG_META[flag];
  return (
    <div className="audit-bar-row">
      <span className="audit-bar-label">{label}</span>
      <div className="audit-bar-track">
        <div className="audit-bar-tba"   style={{ width: `${tba   / max * 100}%` }} title={`TBA: ${tba}`} />
        <div className="audit-bar-scout" style={{ width: `${scout / max * 100}%` }} title={`Scout: ${scout}`} />
      </div>
      <span className="audit-bar-nums">
        <span className="audit-tba-val">{tba}</span>
        <span className="audit-sep">/</span>
        <span className="audit-scout-val">{scout}</span>
      </span>
      <span className={`audit-flag ${meta.cls}`}>{meta.emoji}</span>
    </div>
  );
}

function AllianceAudit({ label, cls, teams, matchKey, scoutReports, tbaFuel }) {
  const scout = scoutFuelForAlliance(teams, matchKey, scoutReports);
  const flag  = auditFlag(scout.total, tbaFuel?.total ?? 0);
  const meta  = FLAG_META[flag];
  const diff  = (tbaFuel?.total ?? 0) - scout.total;

  return (
    <div className={`audit-alliance-block audit-alliance-${cls}`}>
      <div className="audit-alliance-head">
        <span className="audit-alliance-label">{label}</span>
        <span className="audit-alliance-teams">{teams.map(teamNum).join(" · ")}</span>
        <span className={`audit-total-flag ${meta.cls}`}>{meta.emoji} {meta.label}</span>
      </div>

      {tbaFuel && (
        <div className="audit-bars">
          <AuditBar label="Auto"        scout={scout.auto}           tba={tbaFuel.auto} />
          <AuditBar label="Transition"  scout={0}                    tba={tbaFuel.transition} />
          <AuditBar label="Shift 1"     scout={0}                    tba={tbaFuel.shift1} />
          <AuditBar label="Shift 2"     scout={0}                    tba={tbaFuel.shift2} />
          <AuditBar label="Shift 3"     scout={0}                    tba={tbaFuel.shift3} />
          <AuditBar label="Shift 4"     scout={0}                    tba={tbaFuel.shift4} />
          <AuditBar label="End Game"    scout={0}                    tba={tbaFuel.endgame} />
          <div className="audit-total-row">
            <span className="audit-total-label">TOPLAM</span>
            <span className="audit-total-tba">{tbaFuel.total} top (TBA)</span>
            <span className="audit-total-scout">{scout.total} top (Scout)</span>
            {diff >= 0
              ? <span className="audit-total-human">≈ {diff} top human player / kaçırılan</span>
              : <span className="audit-total-over">Scoutcular {Math.abs(diff)} fazla saydı!</span>
            }
          </div>
        </div>
      )}
    </div>
  );
}

function MatchAuditPanel({ match, scoutReports }) {
  const [tbaMatch, setTbaMatch] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [err,      setErr]      = useState(null);
  const [open,     setOpen]     = useState(false);

  // Only relevant for played matches
  const isPlayed = match.red_score != null;

  useEffect(() => {
    if (!open || !isPlayed) return;
    setLoading(true); setErr(null);
    fetchMatchData(match.match_key)
      .then(data => {
        if (!data) setErr("TBA anahtarı girilmemiş veya bağlantı yok. Admin → ⚙️ Ayarlar → TBA Key.");
        else setTbaMatch(data);
      })
      .catch(() => setErr("TBA verisi çekilemedi."))
      .finally(() => setLoading(false));
  }, [open, match.match_key, isPlayed]);

  if (!isPlayed) return null;

  const redFuel  = tbaMatch ? parseTbaFuel(tbaMatch.score_breakdown?.red)  : null;
  const blueFuel = tbaMatch ? parseTbaFuel(tbaMatch.score_breakdown?.blue) : null;

  // Overall flags
  const redScout  = scoutFuelForAlliance(match.red,  match.match_key, scoutReports);
  const blueScout = scoutFuelForAlliance(match.blue, match.match_key, scoutReports);
  const redFlag   = redFuel  ? auditFlag(redScout.total,  redFuel.total)  : null;
  const blueFlag  = blueFuel ? auditFlag(blueScout.total, blueFuel.total) : null;
  const hasAlert  = [redFlag, blueFlag].some(f => f === "gap" || f === "large_gap" || f === "overcount");

  return (
    <div className="wr-audit-section">
      <button className="wr-audit-toggle" onClick={() => setOpen(o => !o)}>
        <span className="wr-section-title" style={{ marginBottom: 0 }}>
          🔍 TBA Skor Denetimi
          {hasAlert && !open && <span className="audit-alert-badge">⚠ Tutarsızlık</span>}
        </span>
        <span className="wr-audit-chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="wr-audit-body">
          {loading && <p className="audit-status">TBA verisi yükleniyor…</p>}
          {err     && <p className="audit-status audit-err">{err}</p>}

          {tbaMatch && (
            <>
              <p className="audit-legend">
                <span className="audit-legend-tba">▮ TBA (gerçek)</span>
                <span className="audit-legend-scout">▮ Scout raporu</span>
                — fark = human player + kaçırılan atışlar
              </p>
              <AllianceAudit
                label="🔴 RED" cls="red"
                teams={match.red} matchKey={match.match_key}
                scoutReports={scoutReports} tbaFuel={redFuel}
              />
              <AllianceAudit
                label="🔵 BLUE" cls="blue"
                teams={match.blue} matchKey={match.match_key}
                scoutReports={scoutReports} tbaFuel={blueFuel}
              />
              <p className="audit-note">
                Scout raporları robot atışlarını takip eder. Human player katkısı ve kaçırılan atışlar "fark"a dahildir.
                Scout toplamı TBA'dan büyükse scoutcu fazla saymış demektir — yeniden inceleme talep edilmeli.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── WIN PROBABILITY WIDGET ───────────────────────────────────────────────────
function WinProbWidget({ match, myTeam, epaData }) {
  const [prob,      setProb]      = useState(null);
  const [rationale, setRationale] = useState("");
  const [loading,   setLoading]   = useState(false);

  const myAlliance  = myTeam
    ? match.red.includes(myTeam) ? "red" : match.blue.includes(myTeam) ? "blue" : null
    : null;
  const ourTeams   = myAlliance ? (myAlliance === "red" ? match.red  : match.blue) : match.red;
  const enemyTeams = myAlliance ? (myAlliance === "red" ? match.blue : match.red)  : match.blue;

  const ourEpa   = ourTeams.reduce((s, t)   => s + (epaData[t]?.epa || 0), 0);
  const enemyEpa = enemyTeams.reduce((s, t) => s + (epaData[t]?.epa || 0), 0);
  const hasEpa   = ourEpa + enemyEpa > 0;

  // Client-side fallback: simple EPA ratio
  const clientProb = hasEpa ? ourEpa / (ourEpa + enemyEpa) : null;

  useEffect(() => {
    if (!hasEpa) return;
    setLoading(true);
    runWinPredict({ our_epa: ourEpa, opponent_epa: enemyEpa })
      .then((res) => { setProb(res.win_probability); setRationale(res.rationale || ""); })
      .catch(() => { setProb(clientProb); setRationale("EPA oranından tahmin (backend bağlı değil)."); })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.match_key, ourEpa, enemyEpa]);

  if (!hasEpa && !loading) return null;

  const pct     = prob != null ? Math.round(prob * 100) : null;
  const cls     = pct == null ? "neutral" : pct >= 60 ? "good" : pct <= 40 ? "danger" : "warn";
  const label   = myAlliance
    ? (myAlliance === "red" ? "RED" : "BLUE")
    : "RED";

  return (
    <div className={`wr-winprob wr-ma-${cls}`}>
      <span className="wr-winprob-label">🎲 {label} Kazanma İhtimali</span>
      {loading
        ? <span className="wr-winprob-val">…</span>
        : <span className="wr-winprob-val">{pct != null ? `%${pct}` : "—"}</span>
      }
      <div className="wr-winprob-bar">
        <div className="wr-winprob-fill" style={{ width: `${pct ?? 50}%` }} />
      </div>
      {rationale && <p className="wr-winprob-note">{rationale}</p>}
    </div>
  );
}

// ─── SCHEDULE STRENGTH WIDGET ────────────────────────────────────────────────
/**
 * Shows per-team SoS for all 6 robots in the selected match.
 * - EPA: raw Statbotics score
 * - SoS: avg EPA of opponents faced so far
 * - Adj. EPA: EPA × (SoS / event avg) — corrected for schedule difficulty
 * - Tier badge: Zorlu / Normal / Kolay
 */
function ScheduleStrengthWidget({ match, schedule, epaData }) {
  const hasEpa = Object.keys(epaData).length > 0;
  if (!hasEpa) return null;

  const rows = [
    ...match.red.map((tk) => ({ tk, alliance: "red" })),
    ...match.blue.map((tk) => ({ tk, alliance: "blue" })),
  ].map(({ tk, alliance }) => {
    const epa = epaData[tk]?.epa ?? null;
    const { sos, matchCount, tier, adjEpa } = computeSoS(tk, schedule, epaData);
    return { tk, alliance, epa, sos, matchCount, tier, adjEpa };
  });

  const TIER_LABEL = { hard: "⬆ Zorlu", normal: "Normal", easy: "⬇ Kolay" };

  return (
    <div className="wr-sos-widget">
      <div className="wr-sos-title">📅 Program Zorluğu (SoS)</div>
      <table className="wr-sos-table">
        <thead>
          <tr>
            <th>Takım</th>
            <th title="Statbotics EPA">EPA</th>
            <th title="Oynanan maçlardaki ortalama rakip EPA">SoS</th>
            <th title="EPA × (SoS / etkinlik ort.) — program zorluğuna göre düzeltilmiş">Düz. EPA</th>
            <th>Program</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ tk, alliance, epa, sos, matchCount, tier, adjEpa }) => (
            <tr key={tk} className={`wr-sos-row wr-sos-${alliance}`}>
              <td className="wr-sos-team">{teamNum(tk)}</td>
              <td className="wr-sos-epa">{epa ?? "—"}</td>
              <td className="wr-sos-sos">
                {sos != null ? sos : "—"}
                {matchCount > 0 && <span className="wr-sos-mc"> ({matchCount}m)</span>}
              </td>
              <td className={`wr-sos-adj${
                adjEpa == null || epa == null ? "" :
                adjEpa > epa ? " wr-sos-up" : adjEpa < epa ? " wr-sos-down" : ""
              }`}>
                {adjEpa ?? "—"}
                {adjEpa != null && epa != null && adjEpa !== epa && (
                  <span className="wr-sos-delta">
                    {adjEpa > epa ? ` (+${(adjEpa - epa).toFixed(1)})` : ` (${(adjEpa - epa).toFixed(1)})`}
                  </span>
                )}
              </td>
              <td>
                <span className={`wr-sos-tier wr-sos-tier-${tier}`}>
                  {TIER_LABEL[tier]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="wr-sos-note">
        SoS = oynanan maçlardaki rakip takımların ort. EPA'sı · Düz. EPA = EPA × (SoS / etkinlik ort.)
        — kolay program üstünlüğünü kompanse eder, gerçek güç karşılaştırması için kullanın.
      </p>
    </div>
  );
}

// ─── MATCH ANALYSIS PANEL ────────────────────────────────────────────────────
function MatchAnalysisPanel({ match, myTeam, pitReports, scoutReports, epaData, schedule }) {
  const myAlliance   = myTeam
    ? match.red.includes(myTeam) ? "red" : match.blue.includes(myTeam) ? "blue" : null
    : null;
  const ourTeams  = myAlliance ? (myAlliance === "red" ? match.red  : match.blue) : [];
  const enemyTeams = myAlliance ? (myAlliance === "red" ? match.blue : match.red)  : [...match.red, ...match.blue];

  // Auto collision detection
  const collisions = detectAutoCollisions(match, scoutReports);
  const dangerCollisions = collisions.filter(c => !c.sameAlliance); // cross-alliance are interesting

  // Opponent carrier
  const carrier    = findOpponentCarrier(enemyTeams, scoutReports);
  const chokePoint = carrier ? findChokePoint(carrier.teamKey, scoutReports) : null;

  // Traffic routing for our alliance
  const trafficRec = ourTeams.length
    ? analyzeTrafficRouting(ourTeams, pitReports, scoutReports)
    : [];

  // Reliability roles
  const reliabilityRoles = ourTeams.length
    ? getReliabilityRoles(ourTeams, pitReports, scoutReports)
    : [];
  const unreliable = reliabilityRoles.filter(r => r.isUnreliable);

  // EPA comparison
  const ourAvgEpa  = ourTeams.length && Object.keys(epaData).length
    ? ourTeams.map(t => epaData[t]?.epa || 0).reduce((a,b)=>a+b,0) / ourTeams.length
    : null;
  const enemyAvgEpa = enemyTeams.length && Object.keys(epaData).length
    ? enemyTeams.map(t => epaData[t]?.epa || 0).reduce((a,b)=>a+b,0) / enemyTeams.length
    : null;

  // Shooting position analysis for carrier
  const carrierShoot = carrier
    ? analyzeShootingPositions(carrier.teamKey, pitReports[carrier.teamKey], scoutReports)
    : null;

  const cards = [];

  // EPA
  if (ourAvgEpa !== null && enemyAvgEpa !== null) {
    const diff     = +(ourAvgEpa - enemyAvgEpa).toFixed(1);
    const stronger = diff >= 0 ? "bizim" : "rakip";
    // Build per-team EPA string with rank
    const fmt = (tk) => {
      const d = epaData[tk];
      if (!d) return teamNum(tk);
      const rankStr = d.rank ? `#${d.rank}` : "";
      return `${teamNum(tk)}(${d.epa}${rankStr ? " "+rankStr : ""})`;
    };
    const ourStr   = ourTeams.map(fmt).join(", ");
    const enemyStr = enemyTeams.map(fmt).join(", ");
    cards.push({
      icon: "📊",
      title: "Kağıt Güç (Statbotics EPA)",
      body:  `${stronger} alliance EPA üstün — fark ${Math.abs(diff).toFixed(1)}.\nBizim: ${ourStr} (ort. ${ourAvgEpa.toFixed(1)})\nRakip: ${enemyStr} (ort. ${enemyAvgEpa.toFixed(1)})`,
      kind:  diff >= 0 ? "good" : "warn",
    });
  }

  // SoS inflation warning: opponents with high EPA but easy schedule
  if (schedule?.length && Object.keys(epaData).length) {
    const allEpas = Object.values(epaData).map((d) => d.epa).filter((e) => e != null);
    const avgEpa  = allEpas.length ? allEpas.reduce((a, b) => a + b, 0) / allEpas.length : null;

    const inflated = enemyTeams.filter((tk) => {
      const { tier } = computeSoS(tk, schedule, epaData);
      return tier === "easy" && (epaData[tk]?.epa ?? 0) > (avgEpa ?? 0);
    });
    const underrated = ourTeams.filter((tk) => {
      const { tier } = computeSoS(tk, schedule, epaData);
      return tier === "hard" && (epaData[tk]?.epa ?? 0) < (avgEpa ?? 0);
    });

    if (inflated.length) {
      cards.push({
        icon:  "📅",
        title: "Rakip EPA Şişirilmiş Olabilir",
        body:  `${inflated.map((tk) => `frc${teamNum(tk)}`).join(", ")} yüksek EPA'sına rağmen kolay program oynamış — gerçek güçleri daha düşük olabilir. Baskı altında sınanmamış olabilirler.`,
        kind:  "info",
      });
    }
    if (underrated.length) {
      cards.push({
        icon:  "💎",
        title: "Bizim Takım Değer Altında",
        body:  `${underrated.map((tk) => `frc${teamNum(tk)}`).join(", ")} düşük EPA'sına rağmen zorlu bir program geçirmiş — kağıtta göründüğünden daha güçlü olabilir.`,
        kind:  "good",
      });
    }
  }

  // Auto collision risks
  if (dangerCollisions.length) {
    const top = dangerCollisions[0];
    cards.push({
      icon: "💥",
      title: "Otonom Çarpışma Riski",
      body:  `${teamNum(top.teamA)} ↔ ${teamNum(top.teamB)} — yaklaşma mesafesi ${(top.dist*100).toFixed(0)}% alan (şiddet: ${top.severity}).`,
      kind:  top.severity === "yüksek" ? "danger" : "warn",
    });
  }

  // Opponent carrier + choke point
  if (carrier?.avgActFuel > 0) {
    const chokeStr = chokePoint
      ? `Taşıyıcının geçiş noktası: **${chokePoint.label}** — savunma partnerine orayı kilitle.`
      : "Geçiş noktası belirlenemedi.";
    const shootStr = carrierShoot?.isSinglePoint
      ? ` ${carrierShoot.verdict}`
      : "";
    cards.push({
      icon: "🎯",
      title: `Rakip Taşıyıcı: frc${teamNum(carrier.teamKey)}`,
      body:  `Ort. ${carrier.avgActFuel}F aktif yakıt (${carrier.n} maç). ${chokeStr}${shootStr}`,
      kind:  "danger",
    });
  }

  // Traffic routing
  const conflicted = trafficRec.find(r => r.note?.includes("⚠"));
  if (conflicted) {
    cards.push({
      icon: "🚦",
      title: "Trafik Çakışması",
      body:  `frc${teamNum(conflicted.teamKey)}: ${conflicted.note}`,
      kind:  "warn",
    });
  }
  // Bump-blocked robots
  const bumpBlocked = trafficRec.filter(r => r.assignedRoute === "trench");
  if (bumpBlocked.length) {
    cards.push({
      icon: "🔀",
      title: "Rota Önerisi",
      body:  bumpBlocked.map(r => `frc${teamNum(r.teamKey)}: ${r.note}`).join(" | "),
      kind:  "info",
    });
  }

  // Unreliable partners
  if (unreliable.length) {
    cards.push({
      icon: "⚠",
      title: "Güvenilmez Partner",
      body:  unreliable.map(r => `frc${teamNum(r.teamKey)}: ${r.role}`).join(" · "),
      kind:  "warn",
    });
  }

  if (!cards.length) return null;

  return (
    <div className="wr-match-analysis">
      <div className="wr-ma-title">🔬 Maç Analizi</div>
      <div className="wr-ma-cards">
        {cards.map((c, i) => (
          <div key={i} className={`wr-ma-card wr-ma-${c.kind}`}>
            <div className="wr-ma-card-head">
              <span>{c.icon}</span>
              <strong>{c.title}</strong>
            </div>
            <p className="wr-ma-card-body"
              dangerouslySetInnerHTML={{ __html: c.body.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── TEAM CARD ────────────────────────────────────────────────────────────────
function TeamCard({ teamKey, alliance, pitReports, scoutReports, onTeamClick, epaData }) {
  const pit      = pitReports[teamKey] || null;
  const scout    = aggregateScoutData(teamKey, scoutReports);
  const analysis = analyzeTeam(teamKey, scoutReports);
  const tags     = buildTags(pit, scout);
  const insights = getCardInsights(analysis);
  const num      = teamNum(teamKey);

  return (
    <div className={`wr-team-card wr-${alliance}`} onClick={() => onTeamClick?.(teamKey)}
      style={{ cursor: "pointer" }}>
      <div className="wr-team-header">
        <span className="wr-team-num">frc{num}</span>
        {pit?.consistency && (
          <span className={`wr-reliability ${
            pit.consistency === "Çok Güvenilir" ? "rel-hi" :
            pit.consistency === "Güvenilir"     ? "rel-ok" :
            pit.consistency === "Orta"          ? "rel-mid" : "rel-lo"
          }`}>{pit.consistency}</span>
        )}
        {analysis && (
          <span className="wr-scouted">{analysis.n}m · ort.{analysis.avgFuelTotal}F</span>
        )}
        {epaData?.[teamKey] && (
          <span className="wr-epa-badge" title="Statbotics EPA">
            {epaData[teamKey].epa} EPA
            {epaData[teamKey].rank && ` · #${epaData[teamKey].rank}`}
          </span>
        )}
      </div>

      {/* Drive */}
      {(pit?.drive || pit?.driveMotor) && (
        <div className="wr-drive">
          {[pit.drive, pit.driveMotor].filter(Boolean).join(" · ")}
        </div>
      )}

      {/* Tags */}
      <div className="wr-tags">
        {tags.map((t, i) => (
          <span key={i} className={`wr-tag ${t.cls}`}>{t.label}</span>
        ))}
      </div>

      {/* Analytics insights */}
      {insights.length > 0 && (
        <div className="wr-insights">
          {insights.map((ins, i) => (
            <div key={i} className={`wr-insight wr-insight-${ins.kind}`}>
              <span className="wr-insight-icon">{ins.icon}</span>
              <span className="wr-insight-text">{ins.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Legacy scout stats (only show if no analytics) */}
      {!analysis && scout && (
        <div className="wr-scout-stats">
          {scout.topZone && <span>📍 {scout.topZone} bölgesi</span>}
          {Object.keys(scout.problemCounts).length > 0 && (
            <span>⚠ {Object.entries(scout.problemCounts)
              .sort((a,b) => b[1]-a[1])
              .map(([k,v]) => `${k.toUpperCase()}×${v}`)
              .join(" ")}</span>
          )}
        </div>
      )}

      {/* Pit notes */}
      {pit?.notes && (
        <p className="wr-pit-note">"{pit.notes}"</p>
      )}
    </div>
  );
}

// ─── MATCH ROW in sidebar ────────────────────────────────────────────────────
function MatchRow({ match, myTeam, selected, onClick }) {
  const qNum   = match.match_key.split("_qm")[1];
  const isOurs = myTeam && (match.red.includes(myTeam) || match.blue.includes(myTeam));
  const played = match.red_score != null && match.blue_score != null;
  const win    = match.winning_alliance; // "red" | "blue" | "tie" | null

  return (
    <button
      className={`wr-match-row${selected ? " selected" : ""}${isOurs ? " ours" : ""}${played ? " played" : ""}`}
      onClick={onClick}>
      <div className="wr-match-row-top">
        <span className="wr-match-num">Q{qNum}</span>
        {isOurs && <span className="wr-ours-badge">BİZ</span>}
        {played && (
          <span className={`wr-result-mini wr-result-${win || "tie"}`}>
            <span className={win === "red" ? "wr-score-bold" : ""}>{match.red_score}</span>
            <span className="wr-score-sep">:</span>
            <span className={win === "blue" ? "wr-score-bold" : ""}>{match.blue_score}</span>
          </span>
        )}
      </div>
      <span className="wr-match-teams">
        <span className="wr-red-mini">{match.red.map(teamNum).join(" ")}</span>
        <span className="wr-vs">vs</span>
        <span className="wr-blue-mini">{match.blue.map(teamNum).join(" ")}</span>
      </span>
    </button>
  );
}

// ─── PRINT PREVIEW (opens new window → window.print()) ───────────────────────
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPrintHTML({ match, pitReports, scoutReports, epaData, schedule, aiText, strategyText, myTeam }) {
  const eventKey   = match.match_key.split("_qm")[0];
  const qNum       = match.match_key.split("_qm")[1];
  const now        = new Date().toLocaleString("tr-TR");
  const myAlliance = myTeam
    ? match.red.includes(myTeam) ? "red" : match.blue.includes(myTeam) ? "blue" : null
    : null;

  const TIER_LABEL = { hard: "⬆ Zorlu", normal: "Normal", easy: "⬇ Kolay" };
  const INSP_LABEL = { passed: "✓ Geçti", failed: "✗ Kaldı", pending: "⏳ Bekliyor" };

  function teamCard(tk, alliance) {
    const pit      = pitReports[tk] || {};
    const analysis = analyzeTeam(tk, scoutReports);
    const { sos, tier, adjEpa } = computeSoS(tk, schedule, epaData);
    const epaEntry = epaData[tk];
    const isOurs   = tk === myTeam;
    const num      = tk.replace("frc", "");

    const fields = [
      ["Sürüş",       [pit.drive, pit.driveMotor].filter(Boolean).join(" ") || null],
      ["Swerve",      pit.swerveModel ? `${pit.swerveModel}${pit.swerveTorque ? ` ${pit.swerveTorque}` : ""}` : null],
      ["Limelight",   pit.limelightCount ? `${pit.limelightCount}× ${pit.limelightModel || ""}`.trim() : null],
      ["Tırmanma T.", pit.climbTeleop || null],
      ["Tırmanma O.", pit.climbAuto   || null],
      ["Atış Menzili",pit.shootRange  || null],
      ["Defans",      pit.defense     || null],
      ["Taşıyıcı",   pit.carrierCap  ? `${pit.carrierCap} top` : null],
      ["Güvenilirlik",pit.consistency || null],
      ["EPA",         epaEntry ? `${epaEntry.epa}${epaEntry.rank ? ` · #${epaEntry.rank}` : ""}${epaEntry.winrate != null ? ` · %${epaEntry.winrate}W` : ""}` : null],
      ["SoS",         sos != null ? `${sos} (${TIER_LABEL[tier]})` : null],
      ["Düz. EPA",    adjEpa != null ? String(adjEpa) : null],
      ["Scout (n)",   analysis ? `${analysis.n}m · ort.${analysis.avgFuelTotal}F · ${analysis.scoreConsistency}` : null],
      ["İnsp. Ağır.", pit.inspectionWeight ? `${pit.inspectionWeight} kg` : null],
      ["İnspeksiyon", pit.inspectionStatus ? INSP_LABEL[pit.inspectionStatus] || pit.inspectionStatus : null],
    ].filter(([, v]) => v != null && v !== "");

    const problems = analysis?.topProblems?.length
      ? analysis.topProblems.map((p) => `${p.type.toUpperCase()}(%${p.pct})`).join(", ")
      : null;

    const climb = analysis?.climbSummary;
    const climbStr = climb?.attempts
      ? `%${Math.round(climb.attempts / climb.n * 100)} · ${climb.l3 ? "L3" : climb.l2 ? "L2" : "L1"}`
      : null;

    const allNotes = [pit.notes, pit.inspectionNotes, pit.interviewNotes].filter(Boolean);

    const border = alliance === "red" ? "#ef4444" : "#3b82f6";

    return `
      <div style="border:0.75pt solid #ccc;border-left:3pt solid ${border};border-radius:2mm;padding:2mm 3mm;margin-bottom:2mm;page-break-inside:avoid;">
        <div style="display:flex;align-items:baseline;gap:3mm;margin-bottom:1.5mm;">
          <span style="font-size:12pt;font-weight:bold;">${isOurs ? "★ " : ""}frc${escHtml(num)}</span>
          ${pit.consistency ? `<span style="font-size:7.5pt;color:#555;">${escHtml(pit.consistency)}</span>` : ""}
          ${climbStr        ? `<span style="font-size:7.5pt;color:#666;">Tır: ${escHtml(climbStr)}</span>` : ""}
          ${problems        ? `<span style="font-size:7.5pt;color:#b91c1c;">⚠ ${escHtml(problems)}</span>` : ""}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 4mm;font-size:8pt;">
          ${fields.map(([l, v]) => `
            <div style="display:flex;gap:1mm;line-height:1.6;">
              <span style="color:#666;min-width:22mm;flex-shrink:0;">${escHtml(l)}:</span>
              <span style="font-weight:600;">${escHtml(v)}</span>
            </div>`).join("")}
        </div>
        ${allNotes.length ? `<div style="font-size:7.5pt;color:#444;font-style:italic;margin-top:1.5mm;border-top:0.5pt solid #e5e5e5;padding-top:1mm;">${allNotes.map((n) => `"${escHtml(n)}"`).join(" · ")}</div>` : ""}
      </div>`;
  }

  const aiHtml = aiText
    ? escHtml(aiText)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>")
    : null;

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Maç Önizleme — ${escHtml(match.match_key)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; margin: 0; padding: 8mm 10mm; background: white; color: #111; }
    @media print { @page { size: A4; margin: 8mm 10mm; } body { padding: 0; } }
  </style>
</head>
<body>
  <!-- HEADER -->
  <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5pt solid #000;margin-bottom:4mm;padding-bottom:2mm;">
    <div>
      <div style="font-size:13pt;font-weight:bold;margin:0;">📋 Maç Önizleme — Q${escHtml(qNum)}</div>
      <div style="font-size:8.5pt;color:#555;margin-top:0.5mm;">${escHtml(eventKey)}${myAlliance ? ` · ${myAlliance === "red" ? "🔴 RED ALLIANCEMIZ" : "🔵 BLUE ALLIANCEMIZ"}` : ""}</div>
    </div>
    <div style="font-size:8pt;color:#666;text-align:right;">Yazdırma: ${escHtml(now)}<br>FRC Scouting App</div>
  </div>

  <!-- ALLIANCES -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4mm;">
    <div>
      <span style="font-size:10.5pt;font-weight:bold;background:#fee2e2;color:#991b1b;padding:1mm 2.5mm;border-radius:2mm;display:inline-block;margin-bottom:2mm;">🔴 RED ALLIANCE</span>
      ${match.red.map((tk) => teamCard(tk, "red")).join("")}
    </div>
    <div>
      <span style="font-size:10.5pt;font-weight:bold;background:#dbeafe;color:#1e3a8a;padding:1mm 2.5mm;border-radius:2mm;display:inline-block;margin-bottom:2mm;">🔵 BLUE ALLIANCE</span>
      ${match.blue.map((tk) => teamCard(tk, "blue")).join("")}
    </div>
  </div>

  ${strategyText ? `
  <div style="margin-top:5mm;border-top:1pt solid #555;padding-top:2.5mm;page-break-inside:avoid;">
    <div style="font-size:10pt;font-weight:bold;margin-bottom:1.5mm;">📋 Strateji Notları</div>
    <div style="font-size:8.5pt;white-space:pre-wrap;line-height:1.5;">${escHtml(strategyText)}</div>
  </div>` : ""}

  ${aiHtml ? `
  <div style="margin-top:5mm;border-top:1pt solid #555;padding-top:2.5mm;">
    <div style="font-size:10pt;font-weight:bold;margin-bottom:1.5mm;">🤖 AI Strateji Analizi</div>
    <div style="font-size:8pt;line-height:1.45;">${aiHtml}</div>
  </div>` : ""}
</body>
</html>`;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function WarRoomDashboard() {
  const [eventKey,    setEventKey]    = useState(getEventKey);
  const [myTeam,      setMyTeam]      = useState(getMyTeam);
  const [schedule,    setSchedule]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState(null); // match_key
  const [pitReports,  setPitReports]  = useState(loadPitReports);
  const [scoutReps,   setScoutReps]   = useState([]);
  const [strategies,  setStrategies]  = useState(loadStrategies);
  const [aiCache,     setAiCache]     = useState(loadAiCache);
  const [aiLoading,   setAiLoading]   = useState(false);
  const [aiError,     setAiError]     = useState(null);
  const [epaData,     setEpaData]     = useState({});
  const [profileTeam, setProfileTeam] = useState(null); // teamKey for modal
  const [showOursOnly, setShowOursOnly] = useState(false);
  const [filterInput, setFilterInput] = useState("");
  const aiRef = useRef(null);

  // Reload on admin config change
  useEffect(() => {
    const fn = () => { setEventKey(getEventKey()); setMyTeam(getMyTeam()); };
    window.addEventListener("adminConfigChanged", fn);
    return () => window.removeEventListener("adminConfigChanged", fn);
  }, []);

  // Fetch schedule
  useEffect(() => {
    setLoading(true);
    fetchSchedule(eventKey)
      .then((s) => {
        setSchedule(s.filter((m) => m.match_key.includes("_qm")));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [eventKey]);

  // Load offline scout reports + EPA once; refresh pit/video when data changes
  useEffect(() => {
    const loadReps = () => getOfflineReports()
      .then((r) => setScoutReps(enrichReportsWithVideoFuel(r)))
      .catch(() => {});
    loadReps();
    setPitReports(loadPitReports());
    const onPit   = () => setPitReports(loadPitReports());
    const onVideo = () => loadReps();
    window.addEventListener("pitReportsChanged", onPit);
    window.addEventListener("videoFuelChanged",  onVideo);
    return () => {
      window.removeEventListener("pitReportsChanged", onPit);
      window.removeEventListener("videoFuelChanged",  onVideo);
    };
  }, []);

  useEffect(() => {
    if (eventKey) fetchEPA(eventKey).then(setEpaData).catch(() => {});
  }, [eventKey]);

  const qualList = schedule.filter((m) => {
    if (showOursOnly && myTeam) {
      if (!m.red.includes(myTeam) && !m.blue.includes(myTeam)) return false;
    }
    if (filterInput.trim()) {
      const q = filterInput.trim();
      const all = [...m.red, ...m.blue].map(teamNum).join(" ");
      const qNum = m.match_key.split("_qm")[1] || "";
      if (!all.includes(q) && !qNum.includes(q)) return false;
    }
    return true;
  });

  const selMatch = schedule.find((m) => m.match_key === selected);

  async function handleGenerateStrategy() {
    if (!selMatch) return;
    setAiError(null);
    setAiLoading(true);
    try {
      const apiKey = getOpenRouterKey();
      const model  = getOpenRouterModel();
      const text = await generateStrategy({
        apiKey,
        model,
        match:        selMatch,
        myTeam,
        pitReports,
        scoutReports: scoutReps,
        epaData,
      });
      const next = { ...aiCache, [selMatch.match_key]: text };
      setAiCache(next);
      saveAiCache(next);
      setTimeout(() => aiRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (err) {
      const msg =
        err.message === "NO_KEY"      ? "OpenRouter key girilmedi. Admin → ⚙️ Ayarlar'dan ekle." :
        err.message === "INVALID_KEY" ? "OpenRouter key geçersiz. Kontrol et." :
        err.message === "NO_CREDITS"  ? "OpenRouter bakiyesi yetersiz. openrouter.ai/credits'den yükle." :
        err.message === "RATE_LIMIT"  ? "Rate limit — biraz bekle, tekrar dene." :
        `Hata: ${err.message}`;
      setAiError(msg);
    } finally {
      setAiLoading(false);
    }
  }

  function saveStrategy(matchKey, text) {
    const next = { ...strategies, [matchKey]: text };
    setStrategies(next);
    saveStrategies(next);
  }

  function handlePrint() {
    if (!selMatch) return;
    const html = buildPrintHTML({
      match:         selMatch,
      pitReports,
      scoutReports:  scoutReps,
      epaData,
      schedule,
      aiText:        aiCache[selMatch.match_key] || null,
      strategyText:  strategies[selMatch.match_key] || null,
      myTeam,
    });
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  }

  return (
    <>
    <div className="wr-root">
      {/* ── SIDEBAR ── */}
      <div className="wr-sidebar">
        <div className="wr-sidebar-head">
          <span className="wr-sidebar-title">⚡ War Room</span>
          <span className="wr-event-label">{eventKey}</span>
        </div>

        <div className="wr-sidebar-filters">
          <input className="wr-search" placeholder="Qual # veya takım..."
            value={filterInput} onChange={(e) => setFilterInput(e.target.value)} />
          {myTeam && (
            <button
              className={`wr-filter-btn${showOursOnly ? " active" : ""}`}
              onClick={() => setShowOursOnly((v) => !v)}>
              Sadece Bizim
            </button>
          )}
        </div>

        <div className="wr-match-list">
          {loading && <p className="wr-loading">Yükleniyor…</p>}
          {!loading && qualList.length === 0 && (
            <p className="wr-loading">Maç bulunamadı.</p>
          )}
          {qualList.map((m) => (
            <MatchRow key={m.match_key} match={m} myTeam={myTeam}
              selected={selected === m.match_key}
              onClick={() => setSelected(m.match_key)} />
          ))}
        </div>
      </div>

      {/* ── MAIN AREA ── */}
      <div className="wr-main">
        {!selMatch ? (
          <div className="wr-empty">
            <p>👈 Sol taraftan bir qual seç</p>
            {!myTeam && (
              <p className="wr-empty-hint">
                Admin → ⚙️ Ayarlar → "Takım Numaramız" girersen kendi maçlarını filtreyebilirsin.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="wr-match-title">
              <span className="wr-match-key">{selMatch.match_key}</span>
              {myTeam && selMatch.red.includes(myTeam)  && <span className="wr-alliance-badge wr-badge-red">RED ALLIANCEMIZ</span>}
              {myTeam && selMatch.blue.includes(myTeam) && <span className="wr-alliance-badge wr-badge-blue">BLUE ALLIANCEMIZ</span>}
              <button className="wr-print-btn" onClick={handlePrint} title="Maç önizlemesini yazdır / PDF kaydet">
                🖨 Yazdır
              </button>
            </div>

            {/* ── RESULT SCOREBOARD (shown for played matches) ── */}
            {selMatch.red_score != null && selMatch.blue_score != null && (() => {
              const win = selMatch.winning_alliance;
              return (
                <div className="wr-scoreboard">
                  <div className={`wr-sb-half wr-sb-red${win === "red" ? " wr-sb-winner" : ""}`}>
                    <span className="wr-sb-label">RED</span>
                    <span className="wr-sb-score">{selMatch.red_score}</span>
                    {win === "red" && <span className="wr-sb-crown">👑</span>}
                  </div>
                  <div className="wr-sb-divider">
                    {win === "tie" ? <span className="wr-sb-tie">BERABERE</span> : <span className="wr-sb-vs">–</span>}
                  </div>
                  <div className={`wr-sb-half wr-sb-blue${win === "blue" ? " wr-sb-winner" : ""}`}>
                    {win === "blue" && <span className="wr-sb-crown">👑</span>}
                    <span className="wr-sb-score">{selMatch.blue_score}</span>
                    <span className="wr-sb-label">BLUE</span>
                  </div>
                </div>
              );
            })()}

            {/* ── TBA AUDIT (played matches only) ── */}
            <MatchAuditPanel match={selMatch} scoutReports={scoutReps} />

            {/* ── WIN PROBABILITY ── */}
            <WinProbWidget match={selMatch} myTeam={myTeam} epaData={epaData} />

            {/* ── SCHEDULE STRENGTH ── */}
            <ScheduleStrengthWidget match={selMatch} schedule={schedule} epaData={epaData} />

            {/* ── MATCH ANALYSIS PANEL ── */}
            <MatchAnalysisPanel
              match={selMatch}
              myTeam={myTeam}
              pitReports={pitReports}
              scoutReports={scoutReps}
              epaData={epaData}
              schedule={schedule}
            />

            {/* Live hub state (only when match is on) */}
            <HubStateWidget />

            {/* Alliance columns */}
            <div className="wr-alliances">
              {/* RED */}
              <div className="wr-alliance-col wr-alliance-red">
                <div className="wr-alliance-label">🔴 RED</div>
                {selMatch.red.map((tk) => (
                  <TeamCard key={tk} teamKey={tk} alliance="red"
                    pitReports={pitReports} scoutReports={scoutReps}
                    onTeamClick={setProfileTeam} epaData={epaData} />
                ))}
              </div>

              {/* BLUE */}
              <div className="wr-alliance-col wr-alliance-blue">
                <div className="wr-alliance-label">🔵 BLUE</div>
                {selMatch.blue.map((tk) => (
                  <TeamCard key={tk} teamKey={tk} alliance="blue"
                    pitReports={pitReports} scoutReports={scoutReps}
                    onTeamClick={setProfileTeam} epaData={epaData} />
                ))}
              </div>
            </div>

            {/* Auto path overlay */}
            <MultiPathOverlay match={selMatch} scoutReports={scoutReps} />

            {/* Scout field notes */}
            <ScoutNotesSummary match={selMatch} scoutReports={scoutReps} />

            {/* Tactical insight (backend) */}
            <TacticalInsightPanel
              match={selMatch} myTeam={myTeam}
              pitReports={pitReports} scoutReports={scoutReps}
            />

            {/* AI Strategy */}
            <div className="wr-ai-section" ref={aiRef}>
              <div className="wr-ai-header">
                <span className="wr-ai-title">🤖 AI Strateji Analizi</span>
                <div className="wr-ai-actions">
                  {aiCache[selMatch.match_key] && (
                    <button className="wr-ai-clear-btn"
                      onClick={() => {
                        const next = { ...aiCache };
                        delete next[selMatch.match_key];
                        setAiCache(next); saveAiCache(next);
                      }}>✕ Temizle</button>
                  )}
                  <button
                    className="wr-ai-btn"
                    disabled={aiLoading}
                    onClick={handleGenerateStrategy}>
                    {aiLoading
                      ? "⏳ Analiz ediliyor…"
                      : aiCache[selMatch.match_key]
                        ? "🔄 Yenile"
                        : "⚡ Strateji Üret"}
                  </button>
                </div>
              </div>

              {aiError && (
                <div className="wr-ai-error">{aiError}</div>
              )}

              {aiLoading && (
                <div className="wr-ai-loading">
                  <span className="wr-ai-spinner" />
                  {(getOpenRouterModel() || DEFAULT_MODEL).split("/").pop()} ile analiz yapılıyor…
                </div>
              )}

              {!aiLoading && aiCache[selMatch.match_key] && (
                <AiText text={aiCache[selMatch.match_key]} />
              )}

              {!aiLoading && !aiCache[selMatch.match_key] && !aiError && (
                <p className="wr-ai-hint">
                  Pit scouting ve maç geçmişi datası kullanılarak bu qual için strateji analizi yapılır.
                  Sonuç bu cihazda önbelleğe alınır.
                </p>
              )}
            </div>

            {/* Strategy notes */}
            <div className="wr-strategy-section">
              <label className="wr-strat-label">📋 Strateji Notları — {selMatch.match_key}</label>
              <textarea className="wr-strat-textarea"
                placeholder="Örn: Defans botumuz karşı bumpta beklesin, topçular serbest çalışsın. 254 zayıf COMMS, riske girmesin..."
                value={strategies[selMatch.match_key] || ""}
                onChange={(e) => saveStrategy(selMatch.match_key, e.target.value)}
              />
            </div>
          </>
        )}
      </div>
    </div>

    {profileTeam && (
      <TeamProfileModal
        teamKey={profileTeam}
        pitReports={pitReports}
        scoutReports={scoutReps}
        epaEntry={epaData[profileTeam] || null}
        onClose={() => setProfileTeam(null)}
      />
    )}
    </>
  );
}
