/**
 * War Room — match strategy prep for upcoming quals.
 * Data sources:
 *   - TBA schedule (fetchSchedule)
 *   - Pit reports (localStorage pitReports)
 *   - Field scout reports (IndexedDB via getOfflineReports)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getEventKey, getMyTeam, getOpenRouterKey, getOpenRouterModel } from "../adminConfig";
import { fetchSchedule, fetchEPA, runWinPredict, fetchHubState, runTacticalInsight, runOverlay, fetchMatchData, fetchRankings, getStrategyBoard, postStrategyBoard } from "../api";
import { getOfflineReports, enrichReportsWithVideoFuel } from "../storage";
import { generateStrategy, DEFAULT_MODEL } from "../strategyAI";
import {
  analyzeTeam, getCardInsights,
  detectAutoCollisions, findOpponentCarrier, findChokePoint,
  analyzeTrafficRouting, getReliabilityRoles, analyzeShootingPositions,
  computeSoS, ZONE_LABEL,
} from "../teamAnalytics";
import TeamProfileModal from "./TeamProfileModal";
import { runWarRoomDecisionEngine, FEATURE_DEFS } from "../warRoomEngine";

const LS_STRAT    = "warRoomStrategy"; // { [match_key]: string }
const LS_AI_CACHE = "warRoomAICache";  // { [match_key]: string }
const LS_PICKLIST = "warRoomPickList";
const LS_COMPARE  = "warRoomCompareTeams";

function normalizeTeamKeyInput(raw) {
  const t = String(raw || "").trim().replace(/^frc/i, "");
  if (!/^\d{1,5}$/.test(t)) return null;
  return `frc${t}`;
}

function loadPickList() {
  try {
    const j = JSON.parse(localStorage.getItem(LS_PICKLIST));
    if (!j || typeof j !== "object") throw new Error("bad");
    return {
      favorites: Array.isArray(j.favorites) ? j.favorites.filter(Boolean) : [],
      avoid: Array.isArray(j.avoid) ? j.avoid.filter(Boolean) : [],
      backup: [
        j.backup?.[0] || null,
        j.backup?.[1] || null,
        j.backup?.[2] || null,
      ],
      rankingOrder: Array.isArray(j.rankingOrder) ? j.rankingOrder.filter(Boolean) : [],
    };
  } catch {
    return { favorites: [], avoid: [], backup: [null, null, null], rankingOrder: [] };
  }
}
function savePickList(p) {
  localStorage.setItem(LS_PICKLIST, JSON.stringify(p));
}

function loadCompareTeams() {
  try {
    const j = JSON.parse(localStorage.getItem(LS_COMPARE));
    if (!Array.isArray(j)) return [];
    return j.filter(Boolean).slice(0, 3);
  } catch {
    return [];
  }
}
function saveCompareTeams(arr) {
  localStorage.setItem(LS_COMPARE, JSON.stringify(arr.slice(0, 3)));
}

/** Tek satır metrik — karşılaştırma tablosu için */
function buildTeamMetrics(teamKey, scoutReports, schedule, epaData) {
  const sos = computeSoS(teamKey, schedule, epaData);
  const scout = analyzeTeam(teamKey, scoutReports);
  return {
    epa: epaData[teamKey]?.epa ?? null,
    epaRank: epaData[teamKey]?.rank ?? null,
    sos: sos.sos,
    sosTier: sos.tier,
    adjEpa: sos.adjEpa,
    avgFuel: scout?.avgFuelTotal ?? null,
    scoutMatches: scout?.n ?? 0,
    autoTendency: scout?.autoPathTendency ?? null,
    problemPct: scout?.matchesWithProblemsPct ?? null,
  };
}

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

function qualNumFromKey(matchKey = "") {
  return parseInt(String(matchKey).split("_qm")[1], 10) || 0;
}

/** İlk oynanmamış qual (skor yok) — bizim takımın yer aldığı. */
function findNextUnplayedQualForTeam(schedule, myTeam) {
  if (!myTeam || !schedule?.length) return null;
  const ours = schedule
    .filter((m) => m.match_key?.includes("_qm"))
    .filter((m) => m.red?.includes(myTeam) || m.blue?.includes(myTeam))
    .sort((a, b) => qualNumFromKey(a.match_key) - qualNumFromKey(b.match_key));
  for (const m of ours) {
    const played = m.red_score != null && m.blue_score != null;
    if (!played) return m;
  }
  return null;
}

function etaFromPredicted(predictedTime) {
  if (predictedTime == null) return { line: "TBA saati yok", hint: "Yine de sıra listesinden takip et." };
  const sec = Number(predictedTime) - Date.now() / 1000;
  const min = Math.round(sec / 60);
  if (min > 90) return { line: `~${min} dk sonra (tahmini)`, hint: null };
  if (min > 2) return { line: `~${min} dk sonra`, hint: null };
  if (min >= -3) return { line: "Yakında — sıra / saha hazır", hint: null };
  return { line: "Planlanan saat geçti", hint: "Field delay olabilir; sıra ekranına bak." };
}

function NextMatchStrip({ schedule, myTeam, epaData, onOpenMatch, selectedKey }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 20000);
    return () => clearInterval(id);
  }, []);

  const next = useMemo(
    () => findNextUnplayedQualForTeam(schedule, myTeam),
    [schedule, myTeam, tick]
  );
  const eta = useMemo(() => (next ? etaFromPredicted(next.predicted_time) : null), [next, tick]);

  const oppSummary = useMemo(() => {
    if (!next || !myTeam) return null;
    const opp = next.red.includes(myTeam) ? next.blue : next.red;
    const epas = opp.map((tk) => epaData[tk]?.epa).filter((v) => v != null);
    const avgEpa = epas.length ? +(epas.reduce((a, b) => a + b, 0) / epas.length).toFixed(1) : null;
    const tiers = opp.map((tk) => computeSoS(tk, schedule, epaData).tier).filter(Boolean);
    const hard = tiers.filter((t) => t === "hard").length;
    const easy = tiers.filter((t) => t === "easy").length;
    let sosHint = "SoS: —";
    if (hard >= 2) sosHint = "SoS: rakipler ağır program";
    else if (easy >= 2) sosHint = "SoS: rakipler hafif program";
    else if (tiers.length) sosHint = "SoS: karışık";
    return { opp, avgEpa, sosHint };
  }, [next, myTeam, epaData, schedule]);

  if (!myTeam) return null;

  if (!next) {
    return (
      <div className="wr-next-strip wr-next-strip--muted">
        <span className="wr-next-icon">⏱</span>
        <div className="wr-next-body">
          <strong>Sonraki maç</strong>
          <span className="wr-next-sub">Takvimde oynanmamış qual kalmadı veya bu eventte maçın yok.</span>
        </div>
      </div>
    );
  }

  const qn = qualNumFromKey(next.match_key);
  const onRed = next.red.includes(myTeam);
  const isSelected = selectedKey === next.match_key;

  return (
    <div className={`wr-next-strip${isSelected ? " wr-next-strip--active" : ""}`}>
      <span className="wr-next-icon">🎯</span>
      <div className="wr-next-body">
        <div className="wr-next-row">
          <strong>Q{qn}</strong>
          <span className={onRed ? "wr-next-all wr-next-all-red" : "wr-next-all wr-next-all-blue"}>
            {onRed ? "RED" : "BLUE"} alliance
          </span>
          <span className="wr-next-eta">{eta?.line}</span>
        </div>
        <div className="wr-next-row wr-next-meta">
          <span>
            Rakip ort. EPA: <strong>{oppSummary?.avgEpa != null ? oppSummary.avgEpa : "—"}</strong>
          </span>
          <span className="wr-next-dot">·</span>
          <span>{oppSummary?.sosHint}</span>
          {oppSummary?.opp?.length ? (
            <span className="wr-next-oppnums">
              ({oppSummary.opp.map(teamNum).join(" · ")})
            </span>
          ) : null}
        </div>
        {eta?.hint && <p className="wr-next-hint">{eta.hint}</p>}
      </div>
      <button
        type="button"
        className="wr-next-open-btn"
        onClick={() => onOpenMatch(next.match_key)}
      >
        Bu maçı aç
      </button>
    </div>
  );
}

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

const AUTO_LANES = ["top", "mid", "bot"];
const LANE_LABEL = { top: "Üst", mid: "Orta", bot: "Alt" };
function laneOfY(y) {
  if (y == null) return "mid";
  if (y < 0.33) return "top";
  if (y < 0.66) return "mid";
  return "bot";
}
function permutations3(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = 0; j < arr.length; j++) {
      if (j === i) continue;
      for (let k = 0; k < arr.length; k++) {
        if (k === i || k === j) continue;
        out.push([arr[i], arr[j], arr[k]]);
      }
    }
  }
  return out;
}
function buildAutoLaneProfiles(teamKeys, scoutReports) {
  const out = {};
  for (const tk of teamKeys) {
    const reps = scoutReports.filter(
      (r) => r.team_key === tk && (r.auto_path_points || []).length >= 2
    );
    const starts = reps.map((r) => laneOfY(r.auto_path_points[0]?.y));
    const counts = { top: 0, mid: 0, bot: 0 };
    starts.forEach((l) => { counts[l] = (counts[l] || 0) + 1; });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const bestLane = entries[0]?.[0] || null;
    const bestN = entries[0]?.[1] || 0;
    const samples = starts.length;
    const confidence = samples ? bestN / samples : 0;
    const seenLanes = AUTO_LANES.filter((l) => counts[l] > 0);
    const locked = samples >= 2 && confidence >= 0.75;
    out[tk] = { samples, counts, bestLane, confidence, seenLanes, locked };
  }
  return out;
}
function optimizeAllianceLanes(teamKeys, profiles) {
  const perms = permutations3(AUTO_LANES);
  let best = null;
  for (const p of perms) {
    const assignment = {};
    let score = 0;
    for (let i = 0; i < teamKeys.length; i++) {
      const tk = teamKeys[i];
      const lane = p[i];
      const pr = profiles[tk];
      assignment[tk] = lane;
      if (!pr || !pr.samples) { score -= 0.5; continue; }
      if (lane === pr.bestLane) score += 3;
      if (pr.seenLanes.includes(lane)) score += 1;
      if (pr.locked && lane !== pr.bestLane) score -= 3;
    }
    if (!best || score > best.score) best = { score, assignment };
  }
  return best?.assignment || {};
}

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
  const lanePlan = useMemo(() => {
    const allTeams = [...match.red, ...match.blue];
    const profiles = buildAutoLaneProfiles(allTeams, scoutReports);
    const redAssign = optimizeAllianceLanes(match.red, profiles);
    const blueAssign = optimizeAllianceLanes(match.blue, profiles);
    const redLine = match.red.map((tk) => `${teamNum(tk)}:${LANE_LABEL[redAssign[tk] || "mid"]}`).join(" · ");
    const blueLine = match.blue.map((tk) => `${teamNum(tk)}:${LANE_LABEL[blueAssign[tk] || "mid"]}`).join(" · ");
    const lockWarnings = allTeams
      .filter((tk) => profiles[tk]?.locked)
      .map((tk) => `frc${teamNum(tk)} genelde ${LANE_LABEL[profiles[tk].bestLane]} lane (${Math.round((profiles[tk].confidence || 0) * 100)}%)`);
    return { redLine, blueLine, lockWarnings };
  }, [match.red, match.blue, scoutReports]);

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
      <p className="wr-overlay-plan">
        🎯 Çakışmasız öneri — <strong>RED:</strong> {lanePlan.redLine} · <strong>BLUE:</strong> {lanePlan.blueLine}
      </p>
      {lanePlan.lockWarnings.length > 0 && (
        <p className="wr-overlay-hint">
          🔒 {lanePlan.lockWarnings.join(" · ")}. Bu takımları alışık oldukları lane'de tutup diğerlerini boş lane'lere kaydırın.
        </p>
      )}
      {!hasPaths && <p className="wr-overlay-hint">Bu maçtaki takımlar için otonom path henüz scouting edilmemiş.</p>}
    </div>
  );
}

// ─── VISUAL STRATEGY BOARD ───────────────────────────────────────────────────
function StrategyBoardCanvas({ matchKey, onDataUrlUpdate }) {
  const canvasRef = useRef(null);
  const [fieldImg, setFieldImg] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [mode, setMode] = useState("draw"); // "draw", "arrow", "text"
  const [color, setColor] = useState("#ef4444");
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState(null);

  useEffect(() => {
    const src = localStorage.getItem("fieldCalibImage");
    if (!src) return;
    const img = new Image();
    img.onload = () => setFieldImg(img);
    img.onerror = () => {};
    img.src = src;
  }, []);

  useEffect(() => {
    getStrategyBoard(matchKey).then(res => {
      if (res && res.annotations) setAnnotations(res.annotations);
    });
  }, [matchKey]);

  function saveAnns(newAnns) {
    setAnnotations(newAnns);
    postStrategyBoard(matchKey, newAnns);
  }

  // Trigger export of the canvas whenever annotations change (for printing)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && onDataUrlUpdate) {
       setTimeout(() => onDataUrlUpdate(canvas.toDataURL("image/png")), 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    if (fieldImg) {
      ctx.drawImage(fieldImg, 0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = "#0a0e1a"; ctx.fillRect(0, 0, W, H);
      for (const z of FIELD_ZONES_FB) {
        ctx.fillStyle = z.c;
        ctx.fillRect(z.x * W, z.y * H, z.w * W, z.h * H);
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    const drawPaths = [...annotations];
    if (currentPath) drawPaths.push(currentPath);

    for (const ann of drawPaths) {
      if ((ann.type === "draw" || ann.type === "arrow") && ann.points && ann.points.length > 0) {
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x * W, ann.points[0].y * H);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x * W, ann.points[i].y * H);
        }
        ctx.stroke();

        // If arrow, draw arrowhead at the end
        if (ann.type === "arrow" && ann.points.length >= 2) {
          const last = ann.points[ann.points.length - 1];
          const prev = ann.points[ann.points.length - 2];
          const angle = Math.atan2((last.y - prev.y) * H, (last.x - prev.x) * W);
          ctx.save();
          ctx.translate(last.x * W, last.y * H);
          ctx.rotate(angle);
          ctx.fillStyle = ann.color;
          ctx.beginPath();
          ctx.moveTo(10, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      } else if (ann.type === "text") {
        ctx.font = "bold 13px sans-serif";
        ctx.fillStyle = ann.color;
        
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 4;
        ctx.fillText(ann.text, ann.x * W, ann.y * H);
        ctx.shadowBlur = 0;
      }
    }
  }, [fieldImg, annotations, currentPath]);

  function getPt(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
  }

  function handleDown(e) {
    e.preventDefault();
    const pt = getPt(e);
    if (mode === "text") {
      const txt = prompt("Not girin:");
      if (txt) {
        saveAnns([...annotations, { type: "text", x: pt.x, y: pt.y, text: txt, color }]);
      }
      return;
    }
    setIsDrawing(true);
    setCurrentPath({ type: mode, color, points: [pt] });
  }

  function handleMove(e) {
    if (!isDrawing || !currentPath) return;
    const pt = getPt(e);
    setCurrentPath({ ...currentPath, points: [...currentPath.points, pt] });
  }

  function handleUp(e) {
    if (!isDrawing || !currentPath) return;
    setIsDrawing(false);
    if (currentPath.points.length > 1) {
      saveAnns([...annotations, currentPath]);
    }
    setCurrentPath(null);
  }

  return (
    <div className="wr-strat-board-section">
      <div className="wr-section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>🖍 Görsel Strateji Tahtası</span>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="wr-strat-sel">
            <option value="draw">Serbest Çizim</option>
            <option value="arrow">Ok (Yön)</option>
            <option value="text">Not (Tıkla)</option>
          </select>
          <select value={color} onChange={(e) => setColor(e.target.value)} className="wr-strat-sel">
            <option value="#ef4444">Kırmızı</option>
            <option value="#60a5fa">Mavi</option>
            <option value="#fcd34d">Sarı</option>
            <option value="#4ade80">Yeşil</option>
            <option value="#ffffff">Beyaz</option>
          </select>
          <button className="wr-strat-btn" onClick={() => saveAnns(annotations.slice(0, -1))} disabled={annotations.length === 0}>↩ Geri</button>
          <button className="wr-strat-btn" onClick={() => { if(confirm("Tüm çizimleri sil?")) saveAnns([]); }} disabled={annotations.length === 0}>🗑 Tümü</button>
        </div>
      </div>
      <canvas 
        ref={canvasRef} width={640} height={320} className="wr-strat-canvas"
        onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={handleUp} onPointerLeave={handleUp}
        style={{ width: "100%", cursor: mode === "text" ? "text" : "crosshair", touchAction: "none" }}
      />
      <p className="wr-overlay-hint">Bu tahtaya çizilen her şey anında backend'e kaydedilir ve diğer cihazlarla senkronize olur.</p>
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

  ${opts.strategyBoardImg ? `
  <div style="margin-top:5mm;page-break-inside:avoid;text-align:center;">
    <div style="font-size:10pt;font-weight:bold;margin-bottom:1.5mm;">🖍 Görsel Strateji Tahtası</div>
    <img src="${opts.strategyBoardImg}" style="max-width:100%; border:1pt solid #aaa; border-radius:4px;" />
  </div>` : ""}

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

// ─── RANKING TABLE WIDGET ────────────────────────────────────────────────────
function RankingTable({ rankings, epaData, onTeamClick }) {
  const [filter, setFilter] = useState("all"); // 'all', 'top24', 'picks'

  if (!rankings || !rankings.length) {
    return <div className="wr-empty">TBA sıralama verisi yok veya yüklenmedi.</div>;
  }

  let list = rankings;
  
  if (filter === "top24") {
    list = list.slice(0, 24);
  } else if (filter === "picks") {
    // Gizli potansiyel (Gizli Pick / Yükselişte): EPA rank asıl sıralamadan çok daha iyiyse
    list = list.filter(r => {
      const tk = r.team_key;
      const epaRank = epaData[tk]?.rank;
      return epaRank && epaRank < r.rank - 3;
    });
  }

  return (
    <div className="wr-ranking-panel" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="wr-match-title" style={{ paddingBottom: "1rem" }}>
        <span className="wr-match-key">🏆 Canlı Sıralama (TBA & EPA)</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
          <button className={`wr-filter-btn ${filter==="all"?"active":""}`} onClick={() => setFilter("all")}>Tümü</button>
          <button className={`wr-filter-btn ${filter==="top24"?"active":""}`} onClick={() => setFilter("top24")}>Top 24</button>
          <button className={`wr-filter-btn ${filter==="picks"?"active":""}`} onClick={() => setFilter("picks")} title="EPA Sıralaması > TBA Sıralaması">📈 Yükselişte / Gizli Potansiyel</button>
        </div>
      </div>
      <div className="cov-matrix-wrap" style={{ maxHeight: "calc(100vh - 150px)", border: "1px solid var(--border-dim)" }}>
        <table className="cov-matrix">
          <thead>
            <tr>
              <th className="cov-th-q">RANK</th>
              <th className="cov-th-q">TAKIM</th>
              <th className="cov-th-q">W-L-T</th>
              <th className="cov-th-q">RS/Match</th>
              <th className="cov-th-q">Statbotics EPA</th>
              <th className="cov-th-q">EPA Rank</th>
              <th className="cov-th-q">Fark</th>
            </tr>
          </thead>
          <tbody>
            {list.map(r => {
              const tk = r.team_key;
              const epaObj = epaData[tk] || {};
              const wlt = r.record ? `${r.record.wins}-${r.record.losses}-${r.record.ties}` : "-";
              const rs = r.sort_orders ? r.sort_orders[0].toFixed(2) : "-";
              const diff = epaObj.rank ? (r.rank - epaObj.rank) : null;
              
              return (
                <tr key={tk} onClick={() => onTeamClick(tk)} style={{ cursor: "pointer", borderBottom: "1px solid var(--border-deep)" }}>
                  <td className="cov-td-q" style={{ textAlign: "center", fontSize: "1rem", color: "var(--text)" }}>{r.rank}</td>
                  <td className="cov-td-q" style={{ fontWeight: 900, color: "var(--accent)" }}>{teamNum(tk)}</td>
                  <td className="cov-td-q" style={{ textAlign: "center" }}>{wlt}</td>
                  <td className="cov-td-q" style={{ textAlign: "center", fontFamily: "monospace" }}>{rs}</td>
                  <td className="cov-td-q" style={{ textAlign: "center", color: "#fcd34d", fontWeight: 800 }}>{epaObj.epa || "-"}</td>
                  <td className="cov-td-q" style={{ textAlign: "center" }}>{epaObj.rank || "-"}</td>
                  <td className="cov-td-q" style={{ textAlign: "center", color: diff > 0 ? "#4ade80" : diff < 0 ? "#f87171" : "var(--muted)", fontWeight: "bold" }}>
                    {diff > 0 ? `▲ +${diff}` : diff < 0 ? `▼ ${Math.abs(diff)}` : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── ALLIANCE PICK LIST (localStorage) ───────────────────────────────────────
function TeamQuickAdd({ allTeams, onPickTeam, hint }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const digits = q.replace(/\D/g, "");
    if (!digits) return [];
    return allTeams
      .filter((tk) => teamNum(tk).includes(digits))
      .slice(0, 14);
  }, [allTeams, q]);

  function tryAdd(raw) {
    const tk = normalizeTeamKeyInput(raw) || (filtered[0] ?? null);
    if (tk) onPickTeam(tk);
    setQ("");
  }

  return (
    <div className="wr-pick-add">
      <input
        className="wr-pick-add-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={hint || "Takım # yaz, Enter"}
        onKeyDown={(e) => {
          if (e.key === "Enter") tryAdd(q);
        }}
      />
      {filtered.length > 0 && (
        <div className="wr-pick-suggest">
          {filtered.map((tk) => (
            <button
              key={tk}
              type="button"
              className="wr-pick-suggest-row"
              onClick={() => { onPickTeam(tk); setQ(""); }}
            >
              {teamNum(tk)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function stripTeamFromPick(pick, tk) {
  if (!tk) return pick;
  return {
    ...pick,
    favorites: pick.favorites.filter((t) => t !== tk),
    avoid: pick.avoid.filter((t) => t !== tk),
    backup: pick.backup.map((b) => (b === tk ? null : b)),
    rankingOrder: pick.rankingOrder.filter((t) => t !== tk),
  };
}

function pickAddFavorite(pick, tk) {
  const p = stripTeamFromPick(pick, tk);
  return { ...p, favorites: [...p.favorites, tk] };
}
function pickAddAvoid(pick, tk) {
  const p = stripTeamFromPick(pick, tk);
  return { ...p, avoid: [...p.avoid, tk] };
}
function pickSetBackupSlot(pick, slot, tk) {
  if (!tk) {
    const nb = [...pick.backup];
    nb[slot] = null;
    return { ...pick, backup: nb };
  }
  const p = stripTeamFromPick(pick, tk);
  const nb = [...p.backup];
  nb[slot] = tk;
  return { ...p, backup: nb };
}
function pickAddRanking(pick, tk) {
  const p = stripTeamFromPick(pick, tk);
  return { ...p, rankingOrder: [...p.rankingOrder, tk] };
}
function moveArr(arr, i, dir) {
  const next = [...arr];
  const j = i + dir;
  if (j < 0 || j >= next.length) return arr;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function PickListPanel({ pick, onPickChange, allTeams, rankByTeam, onTeamProfile }) {
  const [subView, setSubView] = useState("prep"); // 'prep' | 'ranking'

  return (
    <div className="wr-pick-root">
      <div className="wr-match-title wr-pick-head">
        <span className="wr-match-key">📋 Alliance seçim — Pick list</span>
        <div className="wr-pick-tabs">
          <button
            type="button"
            className={`wr-filter-btn${subView === "prep" ? " active" : ""}`}
            onClick={() => setSubView("prep")}
          >
            Hazırlık
          </button>
          <button
            type="button"
            className={`wr-filter-btn${subView === "ranking" ? " active" : ""}`}
            onClick={() => setSubView("ranking")}
          >
            Sıralama günü
          </button>
        </div>
      </div>
      <p className="wr-pick-blurb">
        Favoriler, kesinlikle alma ve yedek 1–2–3 bu cihazda saklanır (spreadsheet yerine).
      </p>

      {subView === "prep" ? (
        <div className="wr-pick-grid">
          <section className="wr-pick-card wr-pick-fav">
            <h3 className="wr-pick-card-title">⭐ Favoriler</h3>
            <TeamQuickAdd
              allTeams={allTeams}
              onPickTeam={(tk) => onPickChange(pickAddFavorite(pick, tk))}
            />
            <ul className="wr-pick-list">
              {pick.favorites.map((tk, i) => (
                <li key={tk} className="wr-pick-row">
                  <span className="wr-pick-rank">{i + 1}.</span>
                  <button type="button" className="wr-pick-team" onClick={() => onTeamProfile(tk)}>
                    {teamNum(tk)}
                    {rankByTeam[tk] != null && (
                      <span className="wr-pick-tba-rank">TBA #{rankByTeam[tk]}</span>
                    )}
                  </button>
                  <div className="wr-pick-row-actions">
                    <button type="button" className="wr-pick-icon-btn" title="Yukarı" onClick={() => onPickChange({ ...pick, favorites: moveArr(pick.favorites, i, -1) })}>↑</button>
                    <button type="button" className="wr-pick-icon-btn" title="Aşağı" onClick={() => onPickChange({ ...pick, favorites: moveArr(pick.favorites, i, 1) })}>↓</button>
                    <button type="button" className="wr-pick-icon-btn wr-pick-remove" title="Çıkar" onClick={() => onPickChange({ ...pick, favorites: pick.favorites.filter((_, j) => j !== i) })}>✕</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="wr-pick-card wr-pick-avoid">
            <h3 className="wr-pick-card-title">🚫 Kesinlikle alma</h3>
            <TeamQuickAdd
              allTeams={allTeams}
              hint="Ekle…"
              onPickTeam={(tk) => onPickChange(pickAddAvoid(pick, tk))}
            />
            <ul className="wr-pick-list">
              {pick.avoid.map((tk) => (
                <li key={tk} className="wr-pick-row">
                  <button type="button" className="wr-pick-team wr-pick-team-avoid" onClick={() => onTeamProfile(tk)}>
                    {teamNum(tk)}
                  </button>
                  <button type="button" className="wr-pick-icon-btn wr-pick-remove" title="Çıkar" onClick={() => onPickChange({ ...pick, avoid: pick.avoid.filter((t) => t !== tk) })}>✕</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="wr-pick-card wr-pick-backup">
            <h3 className="wr-pick-card-title">🔢 Yedek 1 · 2 · 3</h3>
            <p className="wr-pick-slot-hint">Pick turunda önce düşündüğün yedekler (tek takım / slot).</p>
            {[0, 1, 2].map((slot) => (
              <div key={slot} className="wr-pick-slot">
                <span className="wr-pick-slot-label">Yedek {slot + 1}</span>
                {pick.backup[slot] ? (
                  <div className="wr-pick-slot-filled">
                    <button type="button" className="wr-pick-team" onClick={() => onTeamProfile(pick.backup[slot])}>
                      {teamNum(pick.backup[slot])}
                    </button>
                    <button type="button" className="wr-pick-icon-btn wr-pick-remove" onClick={() => onPickChange(pickSetBackupSlot(pick, slot, null))}>✕</button>
                  </div>
                ) : (
                  <TeamQuickAdd
                    allTeams={allTeams}
                    hint={`Yedek ${slot + 1}…`}
                    onPickTeam={(tk) => onPickChange(pickSetBackupSlot(pick, slot, tk))}
                  />
                )}
              </div>
            ))}
          </section>
        </div>
      ) : (
        <div className="wr-pick-ranking-block">
          <div className="wr-pick-ranking-toolbar">
            <TeamQuickAdd
              allTeams={allTeams}
              hint="Taslak sıraya takım ekle…"
              onPickTeam={(tk) => onPickChange(pickAddRanking(pick, tk))}
            />
            <button
              type="button"
              className="wr-pick-copy-btn"
              onClick={() => onPickChange({ ...pick, rankingOrder: [...pick.favorites] })}
            >
              Favori sırasını buraya kopyala
            </button>
            <button
              type="button"
              className="wr-pick-copy-btn"
              onClick={() => onPickChange({ ...pick, rankingOrder: [] })}
            >
              Taslağı temizle
            </button>
          </div>
          <p className="wr-pick-blurb">
            Sıralama / alliance seçim turunda kullanacağın tam liste — üsttekiler önce düşündüğün pick.
          </p>
          <ol className="wr-pick-ranking-list">
            {pick.rankingOrder.map((tk, i) => (
              <li key={`${tk}-${i}`} className="wr-pick-ranking-item">
                <span className="wr-pick-rnum">#{i + 1}</span>
                <button type="button" className="wr-pick-team" onClick={() => onTeamProfile(tk)}>
                  {teamNum(tk)}
                  {rankByTeam[tk] != null && <span className="wr-pick-tba-rank">TBA #{rankByTeam[tk]}</span>}
                </button>
                <div className="wr-pick-row-actions">
                  <button type="button" className="wr-pick-icon-btn" onClick={() => onPickChange({ ...pick, rankingOrder: moveArr(pick.rankingOrder, i, -1) })}>↑</button>
                  <button type="button" className="wr-pick-icon-btn" onClick={() => onPickChange({ ...pick, rankingOrder: moveArr(pick.rankingOrder, i, 1) })}>↓</button>
                  <button type="button" className="wr-pick-icon-btn wr-pick-remove" onClick={() => onPickChange({ ...pick, rankingOrder: pick.rankingOrder.filter((_, j) => j !== i) })}>✕</button>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ComparePanel({ teams, setTeams, allTeams, scoutReports, schedule, epaData, onTeamProfile }) {
  const metrics = useMemo(
    () => teams.map((tk) => ({ tk, m: buildTeamMetrics(tk, scoutReports, schedule, epaData) })),
    [teams, scoutReports, schedule, epaData]
  );

  function addTeam(tk) {
    if (teams.includes(tk) || teams.length >= 3) return;
    setTeams([...teams, tk]);
  }
  function removeTeam(tk) {
    setTeams(teams.filter((t) => t !== tk));
  }

  const tierLabel = { hard: "zor", easy: "kolay", normal: "normal" };

  return (
    <div className="wr-cmp-root">
      <div className="wr-match-title">
        <span className="wr-match-key">⚖ Karşılaştırma</span>
        <span className="wr-cmp-sub">2–3 takım seç; aynı metrikler yan yana.</span>
      </div>

      <div className="wr-cmp-chips">
        {teams.map((tk) => (
          <span key={tk} className="wr-cmp-chip">
            <button type="button" className="wr-cmp-chip-name" onClick={() => onTeamProfile(tk)}>
              {teamNum(tk)}
            </button>
            <button type="button" className="wr-cmp-chip-x" onClick={() => removeTeam(tk)} aria-label="Kaldır">×</button>
          </span>
        ))}
        {teams.length < 3 && (
          <div className="wr-cmp-add-wrap">
            <TeamQuickAdd allTeams={allTeams} hint="Karşılaştırmaya ekle…" onPickTeam={addTeam} />
          </div>
        )}
      </div>

      {teams.length < 2 ? (
        <div className="wr-empty">
          <p>En az iki takım seç.</p>
          <p className="wr-empty-hint">Field raporu olmayan takımlarda ort. fuel / oto / sorun % boş görünebilir.</p>
        </div>
      ) : (
        <div className="wr-cmp-table-wrap">
          <table className="wr-cmp-table">
            <thead>
              <tr>
                <th className="wr-cmp-th-metric">Metrik</th>
                {metrics.map(({ tk }) => (
                  <th key={tk} className="wr-cmp-th-team">
                    <button type="button" onClick={() => onTeamProfile(tk)} className="wr-cmp-th-btn">
                      {teamNum(tk)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>EPA</td>
                {metrics.map(({ tk, m }) => (
                  <td key={tk}>{m.epa != null ? m.epa : "—"}</td>
                ))}
              </tr>
              <tr>
                <td>SoS (opp. ort. EPA)</td>
                {metrics.map(({ tk, m }) => (
                  <td key={tk}>{m.sos != null ? (+m.sos.toFixed(1)) : "—"}</td>
                ))}
              </tr>
              <tr>
                <td>SoS katmanı</td>
                {metrics.map(({ tk, m }) => (
                  <td key={tk}>{m.sosTier ? (tierLabel[m.sosTier] || m.sosTier) : "—"}</td>
                ))}
              </tr>
              <tr>
                <td>Adj. EPA</td>
                {metrics.map(({ tk, m }) => (
                  <td key={tk}>{m.adjEpa != null ? m.adjEpa : "—"}</td>
                ))}
              </tr>
              <tr>
                <td>Ort. fuel (field)</td>
                {metrics.map(({ tk, m }) => (
                  <td key={tk}>{m.avgFuel != null ? m.avgFuel : "—"}</td>
                ))}
              </tr>
              <tr>
                <td>Oto eğilimi</td>
                {metrics.map(({ tk, m }) => (
                  <td key={tk}>{m.autoTendency ?? "—"}</td>
                ))}
              </tr>
              <tr>
                <td>Sorun % (maç)</td>
                {metrics.map(({ tk, m }) => (
                  <td key={tk}>{m.problemPct != null ? `${m.problemPct}%` : "—"}</td>
                ))}
              </tr>
              <tr className="wr-cmp-muted-row">
                <td>Field örnek (n)</td>
                {metrics.map(({ tk, m }) => (
                  <td key={tk}>{m.scoutMatches}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function qNum(matchKey = "") {
  return parseInt(String(matchKey).split("_qm")[1], 10) || 0;
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

function buildDriverTrend(teamKey, scoutReports) {
  const mine = scoutReports
    .filter((r) => r.team_key === teamKey)
    .sort((a, b) => qNum(b.match_key) - qNum(a.match_key));
  if (!mine.length) return null;
  const scoreOf = (r) =>
    (r.auto_fuel_scored || 0) + (r.teleop_fuel_scored_active || 0) + (r.teleop_fuel_scored_inactive || 0);
  const last3 = mine.slice(0, 3).map(scoreOf);
  const prev3 = mine.slice(3, 6).map(scoreOf);
  const lastAvg = avg(last3);
  const prevAvg = avg(prev3);
  const delta = prevAvg == null || lastAvg == null ? null : +(lastAvg - prevAvg).toFixed(1);
  const form = delta == null ? "n/a" : delta > 4 ? "yukseliyor" : delta < -4 ? "dusuyor" : "stabil";
  return { lastAvg, prevAvg, delta, form, samples: mine.length };
}

function buildReliability(teamKey, scoutReports) {
  const mine = scoutReports.filter((r) => r.team_key === teamKey);
  if (!mine.length) return null;
  const counts = { comms: 0, stuck: 0, noshow: 0, foul: 0 };
  let badMatches = 0;
  for (const r of mine) {
    const keys = [
      ...(r.problems || []),
      ...((r.timeline || []).filter((e) => e.action === "problem").map((e) => e.key)),
    ].map((k) => String(k || "").toLowerCase());
    const had = { comms: false, stuck: false, noshow: false, foul: false };
    keys.forEach((k) => {
      if (k.includes("comm")) had.comms = true;
      if (k.includes("stuck") || k.includes("mech")) had.stuck = true;
      if (k.includes("no_show") || k.includes("noshow") || k.includes("absent")) had.noshow = true;
      if (k.includes("foul") || k.includes("penalty")) had.foul = true;
    });
    Object.keys(had).forEach((k) => { if (had[k]) counts[k] += 1; });
    if (Object.values(had).some(Boolean)) badMatches += 1;
  }
  const pct = Math.round((badMatches / mine.length) * 100);
  return {
    matches: mine.length,
    pct,
    counts,
    critical: pct >= 45 || counts.comms >= 2 || counts.noshow >= 1,
  };
}

function AllianceSimulatorPanel({
  rankings,
  epaData,
  scoutReports,
  pitReports,
  pickList,
  myTeam,
  compareTeams,
  setCompareTeams,
  onTeamProfile,
}) {
  const [captainSlot, setCaptainSlot] = useState(8);
  const [rivalSlot, setRivalSlot] = useState(1);

  const captains = useMemo(() => (rankings || []).slice(0, 8).map((r) => r.team_key), [rankings]);
  useEffect(() => {
    if (!myTeam || !captains.length) return;
    const idx = captains.indexOf(myTeam);
    if (idx >= 0) setCaptainSlot(idx + 1);
  }, [myTeam, captains]);

  const teamScore = (tk) => {
    const epa = epaData[tk]?.epa ?? 0;
    const trend = buildDriverTrend(tk, scoutReports);
    const rel = buildReliability(tk, scoutReports);
    const pit = pitReports[tk] || {};
    const defenseBonus = pit.defense === "Ana Strateji" ? 4 : pit.defense === "Bazen" ? 2 : 0;
    const trendBonus = trend?.delta != null ? Math.max(-6, Math.min(6, trend.delta * 0.45)) : 0;
    const relPenalty = rel ? rel.pct * 0.17 : 0;
    return epa + defenseBonus + trendBonus - relPenalty;
  };

  const pool = useMemo(() => {
    const fromRank = (rankings || []).map((r) => r.team_key).slice(0, 40);
    const p = [...pickList.favorites, ...pickList.rankingOrder, ...fromRank];
    return Array.from(new Set(p)).filter((tk) => tk && !pickList.avoid.includes(tk));
  }, [rankings, pickList]);

  const sim = useMemo(() => {
    if (captains.length < 8) return null;
    const alliances = captains.map((c) => [c]);
    const taken = new Set(captains);
    const remaining = () => pool.filter((tk) => !taken.has(tk));
    const our = captainSlot - 1;
    const ourPicks = [];
    const fallbackNotes = [];

    // Round 1: 1..8
    for (let i = 0; i < 8; i++) {
      const cand = remaining().sort((a, b) => teamScore(b) - teamScore(a))[0];
      if (!cand) continue;
      alliances[i].push(cand);
      taken.add(cand);
      if (i === our) ourPicks.push(cand);
    }
    // Round 2: 8..1
    for (let i = 7; i >= 0; i--) {
      const options = remaining().sort((a, b) => teamScore(b) - teamScore(a)).slice(0, 3);
      const pick = options[0];
      if (!pick) continue;
      alliances[i].push(pick);
      taken.add(pick);
      if (i === our) {
        ourPicks.push(pick);
        const fb = options.slice(1, 3).map((t) => teamNum(t)).join(" / ");
        if (fb) fallbackNotes.push(`Eger ${teamNum(pick)} giderse -> ${fb}`);
      }
    }

    const ourAlliance = alliances[our] || [];
    return { alliances, ourAlliance, ourPicks, fallbackNotes };
  }, [captains, pool, captainSlot]);

  const candidateRows = useMemo(() => {
    return pool
      .filter((tk) => !captains.includes(tk))
      .map((tk) => ({
        tk,
        score: +teamScore(tk).toFixed(1),
        trend: buildDriverTrend(tk, scoutReports),
        rel: buildReliability(tk, scoutReports),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 18);
  }, [pool, captains, scoutReports, pitReports, epaData]);

  const rivalCounter = useMemo(() => {
    if (!sim) return [];
    const idx = Math.max(0, Math.min(7, rivalSlot - 1));
    const rival = sim.alliances[idx] || [];
    const oppHasDefense = rival.some((tk) => (pitReports[tk]?.defense || "") === "Ana Strateji");
    return candidateRows
      .filter((r) => !rival.includes(r.tk))
      .map((r) => {
        const pit = pitReports[r.tk] || {};
        const def = pit.defense === "Ana Strateji" ? 1 : pit.defense === "Bazen" ? 0.5 : 0;
        const pace = (r.trend?.lastAvg || 0) / 20;
        const rel = 1 - ((r.rel?.pct || 50) / 100);
        const score = (oppHasDefense ? def * 2 + pace + rel : pace * 1.5 + def + rel);
        return { ...r, counterScore: +score.toFixed(2), role: oppHasDefense ? "anti-defense/pacing" : "pure pace" };
      })
      .sort((a, b) => b.counterScore - a.counterScore)
      .slice(0, 5);
  }, [sim, rivalSlot, candidateRows, pitReports]);

  const trio = compareTeams.slice(0, 3);
  const autoCompat = useMemo(() => {
    if (trio.length < 3) return null;
    const profiles = buildAutoLaneProfiles(trio, scoutReports);
    const assign = optimizeAllianceLanes(trio, profiles);
    const taken = {};
    trio.forEach((tk) => {
      const lane = assign[tk] || "mid";
      taken[lane] = (taken[lane] || 0) + 1;
    });
    const collisions = Object.values(taken).filter((n) => n > 1).reduce((a, b) => a + (b - 1), 0);
    const risk = collisions === 0 ? "dusuk" : collisions === 1 ? "orta" : "yuksek";
    return { assign, risk, profiles };
  }, [trio, scoutReports]);

  return (
    <div className="wr-sim-root">
      <div className="wr-match-title">
        <span className="wr-match-key">🎛 Alliance Selection Simulator</span>
      </div>
      <div className="wr-sim-controls">
        <label>Kaptan slotumuz
          <select value={captainSlot} onChange={(e) => setCaptainSlot(Number(e.target.value))} className="wr-strat-sel">
            {[1,2,3,4,5,6,7,8].map((n) => <option key={n} value={n}>#{n}</option>)}
          </select>
        </label>
        <label>Counter hedef slot
          <select value={rivalSlot} onChange={(e) => setRivalSlot(Number(e.target.value))} className="wr-strat-sel">
            {[1,2,3,4,5,6,7,8].map((n) => <option key={n} value={n}>#{n}</option>)}
          </select>
        </label>
      </div>

      {!sim ? (
        <div className="wr-empty">TBA ranking ile en az 8 kaptan gerekli.</div>
      ) : (
        <>
          <div className="wr-sim-cards">
            <section className="wr-sim-card">
              <h3>Bizim alliance (sim)</h3>
              <p>{sim.ourAlliance.map(teamNum).join(" · ") || "—"}</p>
              {sim.fallbackNotes.map((n) => <p key={n} className="wr-sim-note">↪ {n}</p>)}
            </section>
            <section className="wr-sim-card">
              <h3>Counter-pick onerisi (slot #{rivalSlot})</h3>
              {rivalCounter.map((r) => (
                <p key={r.tk}>
                  <button type="button" className="wr-pick-team" onClick={() => onTeamProfile(r.tk)}>{teamNum(r.tk)}</button>
                  {" "}· {r.role} · skor {r.counterScore}
                </p>
              ))}
            </section>
          </div>

          <div className="wr-cmp-table-wrap">
            <table className="wr-cmp-table">
              <thead>
                <tr>
                  <th className="wr-cmp-th-metric">Aday</th>
                  <th>Skor</th>
                  <th>EPA</th>
                  <th>Son3 form</th>
                  <th>Reliability</th>
                  <th>Heatmap</th>
                </tr>
              </thead>
              <tbody>
                {candidateRows.map((r) => (
                  <tr key={r.tk}>
                    <td>
                      <button type="button" className="wr-pick-team" onClick={() => onTeamProfile(r.tk)}>{teamNum(r.tk)}</button>
                    </td>
                    <td>{r.score}</td>
                    <td>{epaData[r.tk]?.epa ?? "—"}</td>
                    <td>
                      {r.trend?.lastAvg != null ? `${r.trend.lastAvg.toFixed(1)} (${r.trend.form})` : "—"}
                    </td>
                    <td className={r.rel?.critical ? "wr-sim-bad" : ""}>{r.rel ? `%${r.rel.pct}` : "—"}</td>
                    <td>
                      {r.rel ? `C${r.rel.counts.comms} S${r.rel.counts.stuck} N${r.rel.counts.noshow} F${r.rel.counts.foul}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="wr-sim-cards">
            <section className="wr-sim-card">
              <h3>Auto Path Uyumluluk (3 takim)</h3>
              <p className="wr-sim-note">Compare sekmesindeki takimlar kullanilir.</p>
              <div className="wr-cmp-chips">
                {trio.map((tk) => <span key={tk} className="wr-cmp-chip">{teamNum(tk)}</span>)}
                {trio.length < 3 && <span className="wr-sim-note">3 takim secmek icin Kiyasla sekmesini kullan.</span>}
              </div>
              {autoCompat && (
                <>
                  <p>Risk: <strong>{autoCompat.risk}</strong></p>
                  <p>{trio.map((tk) => `${teamNum(tk)}:${LANE_LABEL[autoCompat.assign[tk] || "mid"]}`).join(" · ")}</p>
                </>
              )}
            </section>
            <section className="wr-sim-card">
              <h3>8 alliance snapshot</h3>
              <ol className="wr-sim-alliances">
                {sim.alliances.map((al, i) => <li key={`a-${i}`}>#{i + 1}: {al.map(teamNum).join(" · ")}</li>)}
              </ol>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function DecisionEnginePanel({ match, myTeam, pitReports, scoutReports, epaData, schedule }) {
  const engine = useMemo(
    () => runWarRoomDecisionEngine({ match, myTeam, pitReports, scoutReports, epaData, schedule }),
    [match, myTeam, pitReports, scoutReports, epaData, schedule]
  );
  if (!engine) return null;
  return (
    <div className="wr-match-analysis">
      <div className="wr-ma-title">🧠 Decision Engine (Signal → Scenario)</div>
      {!myTeam && (
        <p className="wr-ma-card-body" style={{ marginBottom: "0.5rem", color: "#fbbf24" }}>
          Gözlemci modu: takım numarası yok — simülasyon <strong>RED</strong> alliance üzerinden (Admin’de takım gir).
        </p>
      )}
      <div className="wr-ma-cards">
        {engine.scenarioCards.map((s) => (
          <div key={s.key} className="wr-ma-card wr-ma-info">
            <div className="wr-ma-card-head">🎯 {s.label}</div>
            <p className="wr-ma-card-body">
              Win% <strong>{Math.round(s.winProb * 100)}</strong>{"\n"}
              Normal senaryoya göre: <strong>{s.deltaVsNormalPp >= 0 ? "+" : ""}{s.deltaVsNormalPp} pp</strong>{"\n"}
              Fark dağılımı P10/P50/P90: <strong>{s.p10.toFixed(1)} / {s.p50.toFixed(1)} / {s.p90.toFixed(1)}</strong>{"\n"}
              (50% baseline’e göre: {s.baselinePp >= 0 ? "+" : ""}{s.baselinePp} pp)
            </p>
          </div>
        ))}
      </div>

      <details className="wr-feature-dict" style={{ marginTop: "0.4rem", fontSize: "0.62rem", color: "var(--muted)" }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Feature sözlüğü</summary>
        <ul style={{ margin: "0.35rem 0 0 1rem", padding: 0, lineHeight: 1.45 }}>
          {Object.entries(FEATURE_DEFS).map(([k, v]) => (
            <li key={k}><code>{k}</code> — {v.label}: {v.desc}</li>
          ))}
        </ul>
      </details>

      <div className="wr-ma-cards" style={{ marginTop: "0.5rem" }}>
        <div className="wr-ma-card wr-ma-warn">
          <div className="wr-ma-card-head">🔬 Sensitivity Top 3</div>
          <p className="wr-ma-card-body">
            {engine.sensitivity.map((s) => `${s.key}: ${s.deltaWinProb > 0 ? "+" : ""}${s.deltaWinProb}pp`).join("\n")}
          </p>
        </div>
        <div className="wr-ma-card wr-ma-good">
          <div className="wr-ma-card-head">🎓 Coach 5 Madde</div>
          <p className="wr-ma-card-body">{engine.roleOutput.coach.join("\n")}</p>
        </div>
        <div className="wr-ma-card wr-ma-info">
          <div className="wr-ma-card-head">🎮 Drive Coach Trigger</div>
          <p className="wr-ma-card-body">{engine.roleOutput.driveCoach.join("\n")}</p>
        </div>
        <div className="wr-ma-card wr-ma-danger">
          <div className="wr-ma-card-head">🛰 Scout Lead İzleme</div>
          <p className="wr-ma-card-body">{engine.roleOutput.scoutLead.join("\n")}</p>
        </div>
      </div>
    </div>
  );
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
  const [rankings,    setRankings]    = useState([]);
  const [strategyBoardDataUrl, setStrategyBoardDataUrl] = useState(null);
  const [profileTeam, setProfileTeam] = useState(null); // teamKey for modal
  const [showOursOnly, setShowOursOnly] = useState(false);
  const [filterInput, setFilterInput] = useState("");
  const [activeMainView, setActiveMainView] = useState("match"); // match | rankings | picklist | compare | allianceSim
  const [pickList, setPickList] = useState(loadPickList);
  const [compareTeams, setCompareTeams] = useState(loadCompareTeams);
  const aiRef = useRef(null);

  useEffect(() => {
    savePickList(pickList);
  }, [pickList]);

  useEffect(() => {
    saveCompareTeams(compareTeams);
  }, [compareTeams]);

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
    if (eventKey) {
      fetchEPA(eventKey).then(setEpaData).catch(() => {});
      fetchRankings(eventKey)
        .then(res => { if (res && res.rankings) setRankings(res.rankings); })
        .catch(() => {});
    }
  }, [eventKey]);

  const allEventTeams = useMemo(() => {
    const set = new Set();
    (rankings || []).forEach((r) => set.add(r.team_key));
    schedule.forEach((m) => {
      [...(m.red || []), ...(m.blue || [])].forEach((t) => set.add(t));
    });
    return Array.from(set).sort((a, b) => Number(teamNum(a)) - Number(teamNum(b)));
  }, [rankings, schedule]);

  const rankByTeam = useMemo(() => {
    const o = {};
    (rankings || []).forEach((r) => {
      o[r.team_key] = r.rank;
    });
    return o;
  }, [rankings]);

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
        schedule,
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
      strategyBoardImg: strategyBoardDataUrl,
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
          <button
            className={`wr-match-row ${activeMainView === "rankings" ? "selected" : ""}`}
            onClick={() => setActiveMainView("rankings")}
            style={{ borderBottom: "2px solid var(--border)", background: activeMainView === "rankings" ? "rgba(251,191,36,0.18)" : "rgba(251,191,36,0.08)" }}
          >
            <span style={{ fontWeight: 800, color: "#fbbf24", padding: "0.2rem 0", fontSize: "0.8rem", textAlign: "center" }}>🏆 CANLI SIRALAMA</span>
          </button>
          <button
            className={`wr-match-row ${activeMainView === "picklist" ? "selected" : ""}`}
            onClick={() => setActiveMainView("picklist")}
            style={{ borderBottom: "2px solid var(--border)", background: activeMainView === "picklist" ? "rgba(52,211,153,0.22)" : "rgba(52,211,153,0.08)" }}
          >
            <span style={{ fontWeight: 800, color: "#6ee7b7", padding: "0.2rem 0", fontSize: "0.8rem", textAlign: "center" }}>📋 PICK LIST</span>
          </button>
          <button
            className={`wr-match-row ${activeMainView === "compare" ? "selected" : ""}`}
            onClick={() => setActiveMainView("compare")}
            style={{ borderBottom: "2px solid var(--border)", background: activeMainView === "compare" ? "rgba(147,197,253,0.22)" : "rgba(147,197,253,0.08)" }}
          >
            <span style={{ fontWeight: 800, color: "#93c5fd", padding: "0.2rem 0", fontSize: "0.8rem", textAlign: "center" }}>⚖ KIYASLA</span>
          </button>
          <button
            className={`wr-match-row ${activeMainView === "allianceSim" ? "selected" : ""}`}
            onClick={() => setActiveMainView("allianceSim")}
            style={{ borderBottom: "2px solid var(--border)", background: activeMainView === "allianceSim" ? "rgba(244,114,182,0.22)" : "rgba(244,114,182,0.08)" }}
          >
            <span style={{ fontWeight: 800, color: "#f9a8d4", padding: "0.2rem 0", fontSize: "0.8rem", textAlign: "center" }}>🎛 ALLIANCE SIM</span>
          </button>

          {loading && <p className="wr-loading">Yükleniyor…</p>}
          {!loading && qualList.length === 0 && (
            <p className="wr-loading">Maç bulunamadı.</p>
          )}
          {qualList.map((m) => (
            <MatchRow key={m.match_key} match={m} myTeam={myTeam}
              selected={selected === m.match_key && activeMainView === "match"}
              onClick={() => { setSelected(m.match_key); setActiveMainView("match"); }} />
          ))}
        </div>
      </div>

      {/* ── MAIN AREA ── */}
      <div className="wr-main">
        {myTeam && activeMainView === "match" && (
          <NextMatchStrip
            schedule={schedule}
            myTeam={myTeam}
            epaData={epaData}
            selectedKey={selected}
            onOpenMatch={(k) => { setSelected(k); setActiveMainView("match"); }}
          />
        )}
        {activeMainView === "rankings" ? (
          <RankingTable rankings={rankings} epaData={epaData} onTeamClick={setProfileTeam} />
        ) : activeMainView === "picklist" ? (
          <PickListPanel
            pick={pickList}
            onPickChange={setPickList}
            allTeams={allEventTeams}
            rankByTeam={rankByTeam}
            onTeamProfile={setProfileTeam}
          />
        ) : activeMainView === "compare" ? (
          <ComparePanel
            teams={compareTeams}
            setTeams={setCompareTeams}
            allTeams={allEventTeams}
            scoutReports={scoutReps}
            schedule={schedule}
            epaData={epaData}
            onTeamProfile={setProfileTeam}
          />
        ) : activeMainView === "allianceSim" ? (
          <AllianceSimulatorPanel
            rankings={rankings}
            epaData={epaData}
            scoutReports={scoutReps}
            pitReports={pitReports}
            pickList={pickList}
            myTeam={myTeam}
            compareTeams={compareTeams}
            setCompareTeams={setCompareTeams}
            onTeamProfile={setProfileTeam}
          />
        ) : !selMatch ? (
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
            <DecisionEnginePanel
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

            {/* Visual Strategy Board */}
            <StrategyBoardCanvas 
              matchKey={selMatch.match_key} 
              onDataUrlUpdate={setStrategyBoardDataUrl} 
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
