/**
 * teamAnalytics.js — Deep per-team & per-match insight engine.
 *
 * Field layout (normalised 0–1, matches EyesFreeTerminal canvas convention):
 *   x=0 left/BLUE,  x=1 right/RED   (640×320 canvas, Blue alliance LEFT)
 *
 *   BLUE SIDE (x < 0.38):
 *     blue_bump_top  : x < 0.38, 0.18 < y < 0.45
 *     blue_bump_bot  : x < 0.38, 0.55 < y < 0.82
 *     blue_trench_top: x < 0.38, y < 0.25
 *     blue_trench_bot: x < 0.38, y > 0.75
 *     blue_hub       : 0.26 < x < 0.50, 0.36 < y < 0.64
 *
 *   RED SIDE (x > 0.62):
 *     red_bump_top   : x > 0.62, 0.18 < y < 0.45
 *     red_bump_bot   : x > 0.62, 0.55 < y < 0.82
 *     red_trench_top : x > 0.62, y < 0.25
 *     red_trench_bot : x > 0.62, y > 0.75
 *     red_hub        : 0.50 < x < 0.74, 0.36 < y < 0.64
 *
 *   CENTER: everything else
 */

// ─── ZONE CLASSIFIER ─────────────────────────────────────────────────────────
export function classifyXY(x, y) {
  // Blue bumps (left side)
  if (x < 0.38 && y > 0.18 && y < 0.45) return "blue_bump_top";
  if (x < 0.38 && y > 0.55 && y < 0.82) return "blue_bump_bot";
  // Blue trenches
  if (x < 0.38 && y < 0.25)             return "blue_trench_top";
  if (x < 0.38 && y > 0.75)             return "blue_trench_bot";
  // Red bumps (right side)
  if (x > 0.62 && y > 0.18 && y < 0.45) return "red_bump_top";
  if (x > 0.62 && y > 0.55 && y < 0.82) return "red_bump_bot";
  // Red trenches
  if (x > 0.62 && y < 0.25)             return "red_trench_top";
  if (x > 0.62 && y > 0.75)             return "red_trench_bot";
  // Hubs
  if (x > 0.26 && x < 0.50 && y > 0.36 && y < 0.64) return "blue_hub";
  if (x > 0.50 && x < 0.74 && y > 0.36 && y < 0.64) return "red_hub";
  return "center";
}

export const ZONE_LABEL = {
  red_bump_top:   "Kırmızı Üst Bump",
  red_bump_bot:   "Kırmızı Alt Bump",
  red_trench_top: "Kırmızı Üst Trench",
  red_trench_bot: "Kırmızı Alt Trench",
  blue_bump_top:  "Mavi Üst Bump",
  blue_bump_bot:  "Mavi Alt Bump",
  blue_trench_top:"Mavi Üst Trench",
  blue_trench_bot:"Mavi Alt Trench",
  red_hub:        "Kırmızı Hub",
  blue_hub:       "Mavi Hub",
  center:         "Merkez",
};

function isBumpZone(z)   { return z.includes("bump"); }
function isTrenchZone(z) { return z.includes("trench"); }
function isHubZone(z)    { return z.includes("hub"); }

function allianceOf(report) {
  return (report.scout_device_id || "").startsWith("red") ? "red" : "blue";
}

// ─── PING ZONE RESOLVER ───────────────────────────────────────────────────────
function resolveZone(p, report) {
  if (p.x != null && p.y != null) return classifyXY(p.x, p.y);
  // Fallback: use coarse tags from test data
  const al = allianceOf(report || {});
  if (p.zone === "hub")    return al === "red" ? "red_hub" : "blue_hub";
  if (p.zone === "bump")   return "center";  // can't determine side without coords
  if (p.zone === "trench") return "center";
  return "center";
}

// ─── TRAVERSAL ZONE INFERENCE ────────────────────────────────────────────────
// Geometric centres of each traversable zone — EF convention (blue=left, red=right)
const ZONE_CENTERS = {
  blue_bump_top:   { x: 0.305, y: 0.315 },
  blue_bump_bot:   { x: 0.305, y: 0.685 },
  blue_trench_top: { x: 0.305, y: 0.15  },
  blue_trench_bot: { x: 0.305, y: 0.85  },
  red_bump_top:    { x: 0.695, y: 0.315 },
  red_bump_bot:    { x: 0.695, y: 0.685 },
  red_trench_top:  { x: 0.695, y: 0.15  },
  red_trench_bot:  { x: 0.695, y: 0.85  },
};

const BUMP_ZONES   = ["red_bump_top",   "red_bump_bot",   "blue_bump_top",   "blue_bump_bot"];
const TRENCH_ZONES = ["red_trench_top", "red_trench_bot", "blue_trench_top", "blue_trench_bot"];

/** Return the zone name (among bump or trench zones) nearest to (x, y). */
function nearestObstacleZone(x, y, key) {
  const candidates = key === "bump" ? BUMP_ZONES : TRENCH_ZONES;
  return candidates.reduce((best, z) => {
    const c = ZONE_CENTERS[z];
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    return d < best.d ? { z, d } : best;
  }, { z: candidates[0], d: Infinity }).z;
}

/**
 * Linear interpolation between sorted ping array.
 * Returns normalised {x, y} estimate at time t_ms, or null if no pings.
 */
function interpolatePosition(t_ms, sortedPings) {
  if (!sortedPings.length) return null;
  if (t_ms <= sortedPings[0].t_ms) return { x: sortedPings[0].x, y: sortedPings[0].y };
  const last = sortedPings[sortedPings.length - 1];
  if (t_ms >= last.t_ms) return { x: last.x, y: last.y };
  for (let i = 0; i < sortedPings.length - 1; i++) {
    const a = sortedPings[i], b = sortedPings[i + 1];
    if (t_ms >= a.t_ms && t_ms <= b.t_ms) {
      const frac = (t_ms - a.t_ms) / (b.t_ms - a.t_ms);
      return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
    }
  }
  return null;
}

/**
 * Given a traversal event {t_ms, key:"bump"|"trench"} and a sorted ping list,
 * return the most likely zone name (e.g. "blue_bump_top").
 * Uses linear interpolation; falls back to nearest-obstacle if position is ambiguous.
 */
function inferTraversalZone(traversal, sortedPings) {
  const pos = interpolatePosition(traversal.t_ms, sortedPings);
  if (!pos) return nearestObstacleZone(0.5, 0.5, traversal.key);
  const classified = classifyXY(pos.x, pos.y);
  // If the interpolated position already lands in the right zone type, use it
  if (traversal.key === "bump"   && classified.includes("bump"))   return classified;
  if (traversal.key === "trench" && classified.includes("trench")) return classified;
  // Position is ambiguous (robot in centre etc.) — snap to nearest zone of correct type
  return nearestObstacleZone(pos.x, pos.y, traversal.key);
}

// ─── PER-MATCH STATS ─────────────────────────────────────────────────────────
function matchStats(report) {
  // Accept pings from location_pings OR extracted from the timeline array
  const pings = (() => {
    const lp = report.location_pings || [];
    if (lp.length) return lp;
    return (report.timeline || []).filter(e => e.action === "ping");
  })();

  const alliance   = allianceOf(report);
  const zoneCounts = {};

  for (const p of pings) {
    const z = resolveZone(p, report);
    zoneCounts[z] = (zoneCounts[z] || 0) + 1;
  }

  // ── Traversal zone inference ────────────────────────────────────────────────
  const timeline     = report.timeline || [];
  const traversals   = timeline.filter(e => e.action === "traversal" && e.t_ms != null);
  const sortedPings  = [...pings].filter(p => p.t_ms != null && p.x != null).sort((a, b) => a.t_ms - b.t_ms);

  const traversalBumpZones   = traversals.filter(t => t.key === "bump")
    .map(t => inferTraversalZone(t, sortedPings));
  const traversalTrenchZones = traversals.filter(t => t.key === "trench")
    .map(t => inferTraversalZone(t, sortedPings));

  const total  = pings.length || 1;
  const fuel   = (report.auto_fuel_scored || 0)
    + (report.teleop_fuel_scored_active   || 0)
    + (report.teleop_fuel_scored_inactive || 0);

  // "Own" side zones = same alliance side
  const ownBumps   = alliance === "red"
    ? ["red_bump_top",  "red_bump_bot"]
    : ["blue_bump_top", "blue_bump_bot"];
  const oppBumps   = alliance === "red"
    ? ["blue_bump_top", "blue_bump_bot"]
    : ["red_bump_top",  "red_bump_bot"];
  const ownTrenches = alliance === "red"
    ? ["red_trench_top",  "red_trench_bot"]
    : ["blue_trench_top", "blue_trench_bot"];

  const problems = [];
  (report.timeline || []).forEach(ev => { if (ev.action === "problem") problems.push(ev.key); });
  (report.problems || []).forEach(k => problems.push(k));

  // Per zone pcts
  const pct = (z) => (zoneCounts[z] || 0) / total;

  return {
    match_key:   report.match_key,
    alliance,
    fuelTotal:   fuel,
    autoFuel:    report.auto_fuel_scored || 0,
    teleopFuelAct:   report.teleop_fuel_scored_active   || 0,
    teleopFuelInact: report.teleop_fuel_scored_inactive || 0,
    tower_level: report.tower_level || "none",
    zoneCounts,
    total,
    // Aggregated zone families
    ownBumpPct:   ownBumps.reduce((s, z)   => s + pct(z), 0),
    oppBumpPct:   oppBumps.reduce((s, z)   => s + pct(z), 0),
    ownTrenchPct: ownTrenches.reduce((s, z) => s + pct(z), 0),
    hubPct:       pct("red_hub") + pct("blue_hub"),
    centerPct:    pct("center"),
    // Dominant bump: which own-side bump used more
    topOwnBump: ownBumps.reduce((best, z) => (pct(z) > pct(best) ? z : best), ownBumps[0]),
    usedOwnBump:  ownBumps.some(z  => (zoneCounts[z]  || 0) > 0),
    usedOppBump:  oppBumps.some(z  => (zoneCounts[z]  || 0) > 0),
    bump_stuck:   report.bump_slow_or_stuck   || false,
    trench_stuck: report.trench_slow_or_stuck || false,
    autoPathPoints: report.auto_path_points || [],
    problems,
    // Traversal zones inferred via linear interpolation between pings
    traversalBumpZones,
    traversalTrenchZones,
  };
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(avg(arr.map(v => (v - m) ** 2)));
}

// ─── PER-TEAM ANALYSIS ───────────────────────────────────────────────────────
export function analyzeTeam(teamKey, reports) {
  const mine = reports.filter(r => r.team_key === teamKey);
  if (!mine.length) return null;
  const stats = mine.map(matchStats);
  const n     = stats.length;

  // Zone distribution
  const zoneTotals = {};
  for (const s of stats) {
    for (const [z, c] of Object.entries(s.zoneCounts)) {
      zoneTotals[z] = (zoneTotals[z] || 0) + c / s.total / n;
    }
  }

  // Dominant zone
  const dominantZone = Object.entries(zoneTotals)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "center";

  // Top bump used (across all matches, own-side)
  const bumpZones = ["red_bump_top","red_bump_bot","blue_bump_top","blue_bump_bot"];
  const topBump   = bumpZones.reduce(
    (best, z) => (zoneTotals[z] || 0) > (zoneTotals[best] || 0) ? z : best,
    bumpZones[0]
  );

  // Own bump vs opp bump performance split
  const withOwnBump = stats.filter(s => s.usedOwnBump && !s.usedOppBump);
  const withOppBump = stats.filter(s => s.usedOppBump && !s.usedOwnBump);
  const noBumps     = stats.filter(s => !s.usedOwnBump && !s.usedOppBump);

  // Hub-heavy vs bump-heavy
  const hubHeavy  = stats.filter(s => s.hubPct   > 0.4);
  const bumpHeavy = stats.filter(s => s.ownBumpPct > 0.25);

  // Alliance conditional
  const asRed  = stats.filter(s => s.alliance === "red");
  const asBlue = stats.filter(s => s.alliance === "blue");

  // Top own-bump sub-zone (top vs bot) from ping heatmap
  const topBumpPct = (stats.reduce((s, m) => s + (m.zoneCounts["red_bump_top"]||0) + (m.zoneCounts["blue_bump_top"]||0), 0) / n);
  const botBumpPct = (stats.reduce((s, m) => s + (m.zoneCounts["red_bump_bot"]||0) + (m.zoneCounts["blue_bump_bot"]||0), 0) / n);
  const preferredBumpSide = topBumpPct >= botBumpPct ? "üst bump" : "alt bump";

  // ── Traversal zone aggregation (from interpolated positional inference) ──────
  // Count how many times each specific zone was traversed across all matches
  const bumpZoneCounts   = {};
  const trenchZoneCounts = {};
  for (const s of stats) {
    for (const z of s.traversalBumpZones)   bumpZoneCounts[z]   = (bumpZoneCounts[z]   || 0) + 1;
    for (const z of s.traversalTrenchZones) trenchZoneCounts[z] = (trenchZoneCounts[z] || 0) + 1;
  }
  const totalBumpTraversals   = Object.values(bumpZoneCounts).reduce((a, b) => a + b, 0);
  const totalTrenchTraversals = Object.values(trenchZoneCounts).reduce((a, b) => a + b, 0);

  // Most-used specific zone for bump and trench
  const topBumpZone   = totalBumpTraversals   > 0
    ? Object.entries(bumpZoneCounts).sort((a,b)=>b[1]-a[1])[0][0]   : null;
  const topTrenchZone = totalTrenchTraversals > 0
    ? Object.entries(trenchZoneCounts).sort((a,b)=>b[1]-a[1])[0][0] : null;

  // Build per-zone avgFuel objects (only zones with ≥2 matches for reliability)
  const bumpZoneAvgFuel   = {};
  const trenchZoneAvgFuel = {};
  for (const z of Object.keys(bumpZoneCounts)) {
    const ms = stats.filter(s => s.traversalBumpZones.includes(z));
    if (ms.length >= 2) bumpZoneAvgFuel[z] = +avg(ms.map(s => s.fuelTotal)).toFixed(1);
  }
  for (const z of Object.keys(trenchZoneCounts)) {
    const ms = stats.filter(s => s.traversalTrenchZones.includes(z));
    if (ms.length >= 2) trenchZoneAvgFuel[z] = +avg(ms.map(s => s.fuelTotal)).toFixed(1);
  }

  // Best vs worst bump zone (highest vs lowest avgFuel)
  const bumpZoneFuelEntries   = Object.entries(bumpZoneAvgFuel);
  const trenchZoneFuelEntries = Object.entries(trenchZoneAvgFuel);
  const bestBumpZone   = bumpZoneFuelEntries.length   ? bumpZoneFuelEntries.sort((a,b)=>b[1]-a[1])[0]   : null;
  const worstBumpZone  = bumpZoneFuelEntries.length > 1 ? bumpZoneFuelEntries.sort((a,b)=>a[1]-b[1])[0] : null;
  const bestTrenchZone = trenchZoneFuelEntries.length  ? trenchZoneFuelEntries.sort((a,b)=>b[1]-a[1])[0] : null;

  // Problems
  const problemMap = {};
  let matchesWithProblems = 0;
  for (const s of stats) {
    if (s.problems.length) matchesWithProblems++;
    for (const p of s.problems) problemMap[p] = (problemMap[p] || 0) + 1;
  }
  const topProblems = Object.entries(problemMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => ({ type: k, count: v, pct: Math.round(v / n * 100) }));

  // Fuel stats
  const fuels = stats.map(s => s.fuelTotal);
  const fuelMean = avg(fuels);
  const fuelSd   = stddev(fuels);
  const teleopActAvg = avg(stats.map(s => s.teleopFuelAct));

  // Climb
  const cs = {
    l3: stats.filter(s => s.tower_level === "L3").length,
    l2: stats.filter(s => s.tower_level === "L2").length,
    l1: stats.filter(s => s.tower_level === "L1").length,
    n,
  };
  cs.attempts = cs.l1 + cs.l2 + cs.l3;

  // Auto path tendency (last point x-coordinate)
  const validAuto = stats.filter(s => s.autoPathPoints.length);
  const autoEndXs = validAuto.map(s => s.autoPathPoints.at(-1).x);
  const avgAutoEndX = autoEndXs.length ? avg(autoEndXs) : null;
  const autoPathLen = validAuto.length ? avg(validAuto.map(s => s.autoPathPoints.length)) : 0;

  return {
    teamKey, n,
    avgFuelTotal: +fuelMean.toFixed(1),
    fuelSd:       +fuelSd.toFixed(1),
    teleopActAvg: +teleopActAvg.toFixed(1),
    scoreConsistency: fuelSd < 5 ? "tutarlı" : fuelSd < 12 ? "değişken" : "çok değişken",
    dominantZone,
    topBump,
    preferredBumpSide,
    zoneTotals,
    bumpCorr: {
      ownBump:  { n: withOwnBump.length, avgFuel: withOwnBump.length  ? +avg(withOwnBump.map(s=>s.fuelTotal)).toFixed(1) : null },
      oppBump:  { n: withOppBump.length, avgFuel: withOppBump.length  ? +avg(withOppBump.map(s=>s.fuelTotal)).toFixed(1) : null },
      noBumps:  { n: noBumps.length,     avgFuel: noBumps.length      ? +avg(noBumps.map(s=>s.fuelTotal)).toFixed(1)     : null },
    },
    hubVsBump: {
      hubHeavy:  { n: hubHeavy.length,  avgFuel: hubHeavy.length  ? +avg(hubHeavy.map(s=>s.fuelTotal)).toFixed(1)  : null },
      bumpHeavy: { n: bumpHeavy.length, avgFuel: bumpHeavy.length ? +avg(bumpHeavy.map(s=>s.fuelTotal)).toFixed(1) : null },
    },
    allianceFuel: {
      red:  asRed.length  >= 2 ? +avg(asRed.map(s=>s.fuelTotal)).toFixed(1)  : null,
      blue: asBlue.length >= 2 ? +avg(asBlue.map(s=>s.fuelTotal)).toFixed(1) : null,
      redN: asRed.length, blueN: asBlue.length,
    },
    topProblems,
    matchesWithProblemsPct: Math.round(matchesWithProblems / n * 100),
    climbSummary: cs,
    autoPathLen: +autoPathLen.toFixed(1),
    avgAutoEndX,
    autoPathTendency: avgAutoEndX == null ? null
      : avgAutoEndX < 0.42 ? "sola"
      : avgAutoEndX > 0.58 ? "sağa"
      : "merkeze",
    // Traversal zone breakdown
    bumpZoneCounts,
    trenchZoneCounts,
    totalBumpTraversals,
    totalTrenchTraversals,
    topBumpZone,
    topTrenchZone,
    bumpZoneAvgFuel,
    trenchZoneAvgFuel,
    bestBumpZone,
    worstBumpZone,
    bestTrenchZone,
  };
}

// ─── MATCH-LEVEL: AUTO COLLISION DETECTION ────────────────────────────────────
/**
 * Returns list of robot pairs whose auto paths come dangerously close.
 * Threshold: normalized distance < 0.10 at any corresponding path step.
 */
export function detectAutoCollisions(match, allReports) {
  const allTeams = [...(match.red || []), ...(match.blue || [])];
  const paths = {};
  for (const tk of allTeams) {
    const r = allReports.find(r => r.team_key === tk && r.match_key === match.match_key);
    if (r?.auto_path_points?.length) paths[tk] = r.auto_path_points;
  }

  const risks = [];
  const teams = Object.keys(paths);
  const THRESHOLD = 0.10;

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = paths[teams[i]];
      const b = paths[teams[j]];
      const steps = Math.min(a.length, b.length);
      let minDist = Infinity;
      let riskStep = -1;
      for (let k = 0; k < steps; k++) {
        const d = Math.sqrt((a[k].x - b[k].x) ** 2 + (a[k].y - b[k].y) ** 2);
        if (d < minDist) { minDist = d; riskStep = k; }
      }
      if (minDist < THRESHOLD) {
        const sameAlliance = (match.red.includes(teams[i]) && match.red.includes(teams[j]))
          || (match.blue.includes(teams[i]) && match.blue.includes(teams[j]));
        risks.push({
          teamA: teams[i], teamB: teams[j],
          dist: +minDist.toFixed(3),
          step: riskStep,
          sameAlliance,
          severity: minDist < 0.05 ? "yüksek" : "orta",
        });
      }
    }
  }
  return risks.sort((a, b) => a.dist - b.dist);
}

// ─── MATCH-LEVEL: OPPONENT CARRIER FINDER ────────────────────────────────────
/**
 * Finds the opponent robot with the highest average teleop_fuel_scored_active.
 */
export function findOpponentCarrier(enemyTeamKeys, allReports) {
  const results = enemyTeamKeys.map(tk => {
    const mine = allReports.filter(r => r.team_key === tk);
    if (!mine.length) return { teamKey: tk, avgActFuel: 0, n: 0 };
    const avgActFuel = avg(mine.map(r => r.teleop_fuel_scored_active || 0));
    return { teamKey: tk, avgActFuel: +avgActFuel.toFixed(1), n: mine.length };
  });
  return results.sort((a, b) => b.avgActFuel - a.avgActFuel)[0] || null;
}

// ─── MATCH-LEVEL: CHOKE POINT ─────────────────────────────────────────────────
/**
 * Finds the most-visited zone for a team, focusing on obstacle zones (bumps/trenches).
 * This is the zone to block.
 */
export function findChokePoint(teamKey, allReports) {
  const mine = allReports.filter(r => r.team_key === teamKey);
  if (!mine.length) return null;

  const zoneTotals = {};
  for (const r of mine) {
    for (const p of (r.location_pings || [])) {
      const z = resolveZone(p);
      zoneTotals[z] = (zoneTotals[z] || 0) + 1;
    }
  }

  // Prefer obstacle zones (bump/trench) as choke points — easier to block physically
  const obstacleZones = Object.entries(zoneTotals)
    .filter(([z]) => isBumpZone(z) || isTrenchZone(z))
    .sort((a, b) => b[1] - a[1]);

  const hubZones = Object.entries(zoneTotals)
    .filter(([z]) => isHubZone(z))
    .sort((a, b) => b[1] - a[1]);

  const topObstacle = obstacleZones[0];
  const topHub      = hubZones[0];

  if (!topObstacle && !topHub) return null;

  // Choose: if obstacle zone frequency is significant, prefer it (blockable)
  const chokeZone = (topObstacle && (!topHub || topObstacle[1] >= topHub[1] * 0.6))
    ? topObstacle[0]
    : topHub?.[0] || topObstacle?.[0];

  return {
    zone:     chokeZone,
    label:    ZONE_LABEL[chokeZone] || chokeZone,
    isBump:   isBumpZone(chokeZone),
    isTrench: isTrenchZone(chokeZone),
    isHub:    isHubZone(chokeZone),
    visits:   zoneTotals[chokeZone] || 0,
    allZones: zoneTotals,
  };
}

// ─── MATCH-LEVEL: TRAFFIC ROUTING (Bump/Trench assignment) ───────────────────
/**
 * Given 3 alliance robots, figure out which route each should take
 * to avoid traffic on field. Returns role recommendations.
 */
export function analyzeTrafficRouting(allianceTeamKeys, pitReports, allReports) {
  const routes = allianceTeamKeys.map(tk => {
    const pit  = pitReports[tk] || {};
    const mine = allReports.filter(r => r.team_key === tk);
    const stuckInBump   = mine.length ? mine.some(r => r.bump_slow_or_stuck)   : null;
    const stuckInTrench = mine.length ? mine.some(r => r.trench_slow_or_stuck) : null;
    const stuckRatio    = mine.length
      ? mine.filter(r => r.bump_slow_or_stuck || r.trench_slow_or_stuck).length / mine.length
      : null;

    const canBump   = !stuckInBump   && (pit.bump   !== false);
    const canTrench = !stuckInTrench && (pit.trench !== false);

    // Dominant zone from pings
    const zoneTotals = {};
    for (const r of mine) {
      for (const p of (r.location_pings || [])) {
        const z = resolveZone(p);
        zoneTotals[z] = (zoneTotals[z] || 0) + 1;
      }
    }
    const topZone = Object.entries(zoneTotals).sort((a,b)=>b[1]-a[1])[0]?.[0] || "center";

    return { teamKey: tk, canBump, canTrench, stuckInBump, stuckInTrench, stuckRatio, topZone };
  });

  // Assign routes: prefer to spread teams across zones
  // Robots that CAN'T do bump get trench or hub routes
  const recommendations = routes.map(r => {
    if (!r.canBump && !r.canTrench) {
      return { ...r, assignedRoute: "hub_only", note: "Bump ve trench geçemiyor — sadece hub etrafında tut." };
    }
    if (!r.canBump && r.canTrench) {
      return { ...r, assignedRoute: "trench", note: "Bump geçemiyor → TRENCH rotasına yönlendir." };
    }
    if (r.canBump && !r.canTrench) {
      return { ...r, assignedRoute: "bump", note: "Trench geçemiyor → BUMP rotasını kullan." };
    }
    // Can do both — assign based on history
    const isBumpFocused = isBumpZone(r.topZone);
    return { ...r, assignedRoute: isBumpFocused ? "bump" : "trench",
      note: `Geçmişte ${ZONE_LABEL[r.topZone] || r.topZone} tercihli → aynı rotada devam.` };
  });

  // Conflict check: if 2+ robots prefer same bump (top or bot)
  const bumpRoutes = recommendations.filter(r => r.assignedRoute === "bump");
  if (bumpRoutes.length >= 2) {
    // Assign one to top bump, one to bot bump
    bumpRoutes[1].note += " ⚠ Aynı bump kullanılıyor — biri üst bumpı, diğeri alt bumpı alsın.";
  }

  return recommendations;
}

// ─── MATCH-LEVEL: RELIABILITY FILTER ─────────────────────────────────────────
/**
 * Returns which alliance partners are unreliable (high problem rate / brownout).
 * Unreliable partners should get simple "carry and stay" assignments.
 */
export function getReliabilityRoles(allianceTeamKeys, pitReports, allReports) {
  return allianceTeamKeys.map(tk => {
    const pit  = pitReports[tk] || {};
    const mine = allReports.filter(r => r.team_key === tk);
    const problemPct = mine.length
      ? mine.filter(r => {
          const probs = [...(r.problems||[]), ...(r.timeline||[]).filter(e=>e.action==="problem").map(e=>e.key)];
          return probs.some(p => ["comms","brownout","stuck"].includes(p));
        }).length / mine.length * 100
      : null;

    const consistencyScore = { "Çok Güvenilir": 0, "Güvenilir": 1, "Orta": 2, "Tutarsız": 3, "Zayıf": 3 }[pit.consistency] ?? 2;
    const isUnreliable = (problemPct != null && problemPct >= 30) || consistencyScore >= 3;
    const carrierCap   = pit.carrierCap || 0;

    return {
      teamKey:        tk,
      problemPct:     problemPct != null ? +problemPct.toFixed(0) : null,
      consistencyScore,
      isUnreliable,
      carrierCap,
      role: isUnreliable
        ? `Basit taşıyıcı — ortada dur, yakıt taşı (cap: ${carrierCap || "?"})${problemPct != null ? `, sorun oranı %${problemPct}` : ""}`
        : "Normal görev",
    };
  });
}

// ─── MATCH-LEVEL: SHOOTING POSITION ANALYSIS ──────────────────────────────────
/**
 * Where does the team shoot from? Is it a single-point, easily-defended position?
 */
export function analyzeShootingPositions(teamKey, pitReport, allReports) {
  const mine = allReports.filter(r => r.team_key === teamKey);
  if (!mine.length) return null;

  const shootRange = pitReport?.shootRange || "Yok";
  if (shootRange === "Yok") return { shootRange, verdict: "Topçu değil." };

  // Aggregate hub-proximity pings
  const hubPings = [];
  for (const r of mine) {
    for (const p of (r.location_pings || [])) {
      const z = resolveZone(p);
      if (isHubZone(z)) hubPings.push({ x: p.x, y: p.y });
    }
  }

  if (!hubPings.length) return { shootRange, verdict: "Hub verisi yok." };

  const xs = hubPings.map(p => p.x);
  const ys = hubPings.map(p => p.y);
  const cx = avg(xs), cy = avg(ys);
  const spread = stddev(xs.concat(ys));

  const isSinglePoint = spread < 0.06;
  const label = ZONE_LABEL[classifyXY(cx, cy)] || "bilinmiyor";

  return {
    shootRange,
    hubPingCount: hubPings.length,
    centroid:     { x: +cx.toFixed(2), y: +cy.toFixed(2) },
    spread:       +spread.toFixed(3),
    isSinglePoint,
    dominantHubZone: label,
    verdict: isSinglePoint
      ? `Sadece ${label}'nden atış yapıyor — kolay savunulur, o noktayı blokla.`
      : `Birden fazla noktadan atış yapabiliyor (menzil: ${shootRange}) — savunması zor.`,
  };
}

// ─── SCHEDULE STRENGTH (SoS) ─────────────────────────────────────────────────
/**
 * Computes Strength of Schedule for a team at an event.
 *
 * Algorithm:
 *   For every *played* match the team was part of, collect the EPA values of
 *   all opponents (3 robots from the other alliance).  Average across all
 *   collected values → SoS.
 *
 * Interpretation:
 *   SoS > eventAvgEpa × 1.12  → "hard"  (tough schedule, EPA may be under-rated)
 *   SoS < eventAvgEpa × 0.88  → "easy"  (easy schedule, EPA may be over-rated)
 *   otherwise                 → "normal"
 *
 * adjEpa = teamEpa × (sos / eventAvgEpa)
 *   Normalises EPA relative to difficulty so teams from different schedule
 *   difficulties can be compared on equal footing.
 *
 * @param {string}   teamKey   e.g. "frc1234"
 * @param {Array}    schedule  full qual schedule array (with red_score / blue_score)
 * @param {Object}   epaData   { [teamKey]: { epa, ... } }
 * @returns {{ sos, matchCount, tier, avgEventEpa, adjEpa }}
 */
export function computeSoS(teamKey, schedule, epaData) {
  const played = schedule.filter(
    (m) =>
      (m.red_score != null || m.blue_score != null) &&
      (m.red.includes(teamKey) || m.blue.includes(teamKey))
  );

  if (!played.length) return { sos: null, matchCount: 0, tier: "normal", avgEventEpa: null, adjEpa: null };

  const oppEpas = [];
  for (const m of played) {
    const opps = m.red.includes(teamKey) ? m.blue : m.red;
    for (const opp of opps) {
      const e = epaData[opp]?.epa;
      if (e != null) oppEpas.push(e);
    }
  }

  if (!oppEpas.length) return { sos: null, matchCount: played.length, tier: "normal", avgEventEpa: null, adjEpa: null };

  const sos = oppEpas.reduce((a, b) => a + b, 0) / oppEpas.length;

  const allEpas = Object.values(epaData).map((d) => d.epa).filter((e) => e != null);
  const avgEventEpa = allEpas.length
    ? allEpas.reduce((a, b) => a + b, 0) / allEpas.length
    : null;

  const ratio = avgEventEpa ? sos / avgEventEpa : 1;
  const tier  = ratio >= 1.12 ? "hard" : ratio <= 0.88 ? "easy" : "normal";

  const teamEpa = epaData[teamKey]?.epa ?? null;
  const adjEpa  = teamEpa != null && avgEventEpa
    ? +(teamEpa * (sos / avgEventEpa)).toFixed(1)
    : null;

  return {
    sos:         +sos.toFixed(1),
    matchCount:  played.length,
    tier,
    avgEventEpa: avgEventEpa ? +avgEventEpa.toFixed(1) : null,
    adjEpa,
  };
}

// ─── FORMAT FOR AI PROMPT ────────────────────────────────────────────────────
export function formatInsightsForPrompt(teamKey, a) {
  if (!a) return `${teamKey}: Yeterli saha verisi yok.`;
  const num   = teamKey.replace("frc", "");
  const lines = [`frc${num} (${a.n}m, ort. ${a.avgFuelTotal}F, ${a.scoreConsistency}):`];

  const bc = a.bumpCorr;
  if (bc.ownBump.n && bc.noBumps.n) {
    const diff = ((bc.ownBump.avgFuel || 0) - (bc.noBumps.avgFuel || 0)).toFixed(1);
    lines.push(`  • Kendi bumpı kullandığında ${diff > 0 ? "+" : ""}${diff}F fark (${bc.ownBump.avgFuel}F vs ${bc.noBumps.avgFuel}F).`);
  }
  if (bc.ownBump.n && bc.oppBump.n) {
    const diff = ((bc.ownBump.avgFuel||0) - (bc.oppBump.avgFuel||0)).toFixed(1);
    if (Math.abs(diff) >= 3)
      lines.push(`  • Rakip bumpı kullandığında ${diff > 0 ? "daha düşük" : "daha yüksek"} skor (kendi:${bc.ownBump.avgFuel}F, rakip:${bc.oppBump.avgFuel}F).`);
  }


  const af = a.allianceFuel;
  if (af.red != null && af.blue != null && af.redN >= 2 && af.blueN >= 2) {
    const diff = (af.red - af.blue).toFixed(1);
    if (Math.abs(diff) >= 4)
      lines.push(`  • ${diff > 0 ? "Kırmızı" : "Mavi"} allianc'da +${Math.abs(diff)}F (K:${af.red}F, M:${af.blue}F).`);
  }

  if (a.autoPathTendency)
    lines.push(`  • Otonom: ${a.autoPathTendency} yönelme, ort. ${a.autoPathLen} waypoint.`);

  if (a.matchesWithProblemsPct >= 25)
    lines.push(`  • Sorunlar (%${a.matchesWithProblemsPct}): ${a.topProblems.map(p=>`${p.type.toUpperCase()}(%${p.pct})`).join(", ")}.`);

  if (a.fuelSd > 10)
    lines.push(`  • Skor tutarsız (SD:${a.fuelSd}) — tahmin zor.`);

  const cs = a.climbSummary;
  if (cs.attempts > 0) {
    const level = cs.l3 ? "L3" : cs.l2 ? "L2" : "L1";
    lines.push(`  • Tırmanma: %${Math.round(cs.attempts/cs.n*100)} başarı, ağırlıklı ${level}.`);
  }

  // Traversal zone breakdown
  if (a.totalBumpTraversals > 0) {
    const parts = Object.entries(a.bumpZoneCounts)
      .sort((x,y) => y[1]-x[1])
      .map(([z,c]) => `${ZONE_LABEL[z]||z}:${c}`).join(", ");
    lines.push(`  • Bump geçişleri (${a.totalBumpTraversals}): ${parts}.`);
    if (a.bestBumpZone && a.worstBumpZone && a.bestBumpZone[0] !== a.worstBumpZone[0]) {
      lines.push(`    ↳ En iyi bump: ${ZONE_LABEL[a.bestBumpZone[0]]||a.bestBumpZone[0]} (${a.bestBumpZone[1]}F), zayıf: ${ZONE_LABEL[a.worstBumpZone[0]]||a.worstBumpZone[0]} (${a.worstBumpZone[1]}F).`);
    }
  }
  if (a.totalTrenchTraversals > 0) {
    const parts = Object.entries(a.trenchZoneCounts)
      .sort((x,y) => y[1]-x[1])
      .map(([z,c]) => `${ZONE_LABEL[z]||z}:${c}`).join(", ");
    lines.push(`  • Trench geçişleri (${a.totalTrenchTraversals}): ${parts}.`);
    if (a.bestTrenchZone) {
      lines.push(`    ↳ En iyi trench: ${ZONE_LABEL[a.bestTrenchZone[0]]||a.bestTrenchZone[0]} (${a.bestTrenchZone[1]}F).`);
    }
  }

  return lines.join("\n");
}

// ─── CARD INSIGHTS (max 3, shown in War Room team cards) ─────────────────────
export function getCardInsights(a) {
  if (!a) return [];
  const insights = [];

  const bc = a.bumpCorr;
  if (bc.ownBump.n && bc.noBumps.n && bc.ownBump.avgFuel != null && bc.noBumps.avgFuel != null) {
    const delta = +(bc.ownBump.avgFuel - bc.noBumps.avgFuel).toFixed(0);
    if (Math.abs(delta) >= 3) insights.push({
      icon: "📍",
      text: `Kendi bumpta ${delta > 0 ? "+" : ""}${delta}F vs bumpsız`,
      kind: delta > 0 ? "positive" : "negative",
    });
  }

  if (bc.ownBump.n && bc.oppBump.n && bc.ownBump.avgFuel != null && bc.oppBump.avgFuel != null) {
    const delta = +(bc.ownBump.avgFuel - bc.oppBump.avgFuel).toFixed(0);
    if (Math.abs(delta) >= 4) insights.push({
      icon: "⚡",
      text: delta > 0
        ? `Kendi bumpta ${delta}F daha iyi`
        : `Rakip bumpta ${-delta}F daha iyi (!?)`,
      kind: "info",
    });
  }


  const af = a.allianceFuel;
  if (af.red != null && af.blue != null && af.redN >= 2 && af.blueN >= 2) {
    const delta = +(af.red - af.blue).toFixed(0);
    if (Math.abs(delta) >= 5) insights.push({
      icon: delta > 0 ? "🔴" : "🔵",
      text: `${delta > 0 ? "Kırmızı" : "Mavi"}'da +${Math.abs(delta)}F`,
      kind: "info",
    });
  }

  if (a.matchesWithProblemsPct >= 30 && a.topProblems[0]) insights.push({
    icon: "⚠",
    text: `${a.topProblems[0].type.toUpperCase()} — %${a.topProblems[0].pct} maçta`,
    kind: "warning",
  });

  if (a.autoPathTendency) insights.push({
    icon: "🤖",
    text: `Oto: ${a.autoPathTendency} (${a.autoPathLen} wp)`,
    kind: "info",
  });

  // Traversal zone preference — show best vs worst bump if data exists
  if (a.bestBumpZone && a.worstBumpZone && a.bestBumpZone[0] !== a.worstBumpZone[0]) {
    const delta = +(a.bestBumpZone[1] - a.worstBumpZone[1]).toFixed(0);
    if (delta >= 4) insights.push({
      icon: "🛤",
      text: `${ZONE_LABEL[a.bestBumpZone[0]]||a.bestBumpZone[0]} +${delta}F`,
      kind: "positive",
    });
  } else if (a.topBumpZone && a.totalBumpTraversals >= 3) {
    insights.push({
      icon: "🛤",
      text: `${ZONE_LABEL[a.topBumpZone]||a.topBumpZone} (${a.bumpZoneCounts[a.topBumpZone]}x)`,
      kind: "info",
    });
  }

  if (a.topTrenchZone && a.totalTrenchTraversals >= 3) insights.push({
    icon: "🕳",
    text: `${ZONE_LABEL[a.topTrenchZone]||a.topTrenchZone} (${a.trenchZoneCounts[a.topTrenchZone]}x)`,
    kind: "info",
  });

  return insights.slice(0, 3);
}
