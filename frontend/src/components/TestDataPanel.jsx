/**
 * TestDataPanel — generates a realistic FRC regional for UI/system testing.
 *
 * Produces:
 *  - A mock 40-qual schedule (stored in localStorage as mockSchedule_2026test)
 *  - Pit reports for 30 teams          (stored in localStorage as pitReports)
 *  - Field scout reports for 30 quals  (stored in IndexedDB via saveReport)
 *  - Sets admin event key to "2026test"
 *
 * Team 9029 is always on Red 1 of Qual 1.
 */

import { useState } from "react";
import { setAdminConfig, getAdminConfig } from "../adminConfig";
import { saveReport, clearOfflineReports } from "../storage";

const EVENT_KEY  = "2026test";
const TOTAL_QUAL = 40;
const PLAYED_QUAL = 30;

// ─── TEAM ROSTER ────────────────────────────────────────────────────────────
const TEAMS = [
  9029, 254, 1114, 2056, 1678, 148, 118, 971, 2910, 4414,
  3476, 5740, 6328, 7407, 6834, 2175, 3015, 4099, 5895, 2767,
  4055, 6072, 1923, 3538, 4201, 7153, 8085, 8230, 9008, 9150,
];

// ─── SEEDED PRNG (Mulberry32) ─────────────────────────────────────────────
function makePRNG(seed = 42) {
  let s = seed;
  return {
    next() {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    },
    int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); },
    pick(arr)   { return arr[this.int(0, arr.length - 1)]; },
    bool(p = 0.5) { return this.next() < p; },
    gauss(mean, sd) {
      const u = 1 - this.next(), v = this.next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

// ─── ARCHETYPES ──────────────────────────────────────────────────────────────
// Tier 0 = powerhouse, 1 = solid, 2 = average, 3 = low, 4 = defense specialist
function getArchetype(teamNum) {
  const powerhouses = [254, 1114, 2056, 1678, 148];
  const solid       = [118, 971, 2910, 4414, 3476, 5740, 6328, 9029];
  const defense     = [7407, 9150, 4055];
  if (powerhouses.includes(teamNum)) return 0;
  if (solid.includes(teamNum))       return 1;
  if (defense.includes(teamNum))     return 4;
  const idx = TEAMS.indexOf(teamNum);
  return idx < 18 ? 2 : 3;
}

// ─── PIT DATA GENERATOR ──────────────────────────────────────────────────────
function generatePitReport(teamNum, rng) {
  const tier = getArchetype(teamNum);

  const drives    = ["Swerve", "Tank", "Mecanum"];
  const motors    = ["Kraken X60", "NEO", "Falcon 500", "NEO Vortex"];
  const climbs    = ["Yok", "L1", "L2", "L3"];
  const ranges    = ["Yok", "Hub Yakını", "Her Mesafe"];
  const defenses  = ["Yok", "Bazen", "Ana Strateji"];
  const consts    = ["Çok Güvenilir", "Güvenilir", "Orta", "Zayıf"];
  const noteBank  = [
    "Otonom çok güçlü, endgame zayıf.",
    "Savunma oynuyor dikkat.",
    "Bump geçişi yavaş ama yapabiliyor.",
    "Trench altına giremez.",
    "Kriko mekanizması sürücüye bağımlı.",
    "Kamera sistemi var, otonom tutarlı.",
    "Geçen yarışmada COMMS sorunu yaşadı.",
    "Yeni drivetrain, test edilmedi.",
    "Çok hızlı spinner, yakıt kapasitesi yüksek.",
    "Otonom yok, sadece teleop.",
  ];

  if (tier === 4) { // defense specialist
    return {
      drive: "Tank",
      driveMotor: rng.pick(["NEO", "Falcon 500"]),
      shootRange: "Yok",
      climbTeleop: rng.pick(["Yok", "L1"]),
      climbAuto: "Yok",
      bump: rng.bool(0.8),
      trench: rng.bool(0.7),
      defense: "Ana Strateji",
      consistency: rng.pick(["Güvenilir", "Orta"]),
      autoFuel: 0,
      teleopFuel: 0,
      carrierCap: rng.int(1, 3),
      notes: "Defans odaklı, bump/trench blokajı yapıyor.",
    };
  }

  const autoFuelBase  = [20, 14, 8,  3,  0][tier];
  const teleopFuelBase = [45, 30, 16, 6,  0][tier];
  const climbOptions  = [["L3"], ["L2","L3"], ["L1","L2"], ["Yok","L1"], ["Yok"]][tier];

  return {
    drive:      tier <= 1 ? "Swerve" : rng.pick(drives.slice(1)),
    driveMotor: tier === 0 ? "Kraken X60" : rng.pick(motors),
    shootRange: [ranges[2], ranges[2], ranges[1], rng.pick(ranges.slice(1)), ranges[0]][tier],
    climbTeleop: rng.pick(climbOptions),
    climbAuto:  rng.bool(tier === 0 ? 0.6 : tier === 1 ? 0.3 : 0.1) ? "L1" : "Yok",
    bump:       rng.bool([0.3, 0.5, 0.6, 0.7, 0.8][tier]),
    trench:     rng.bool([0.3, 0.5, 0.6, 0.7, 0.8][tier]),
    defense:    rng.pick([defenses[0], defenses[0], defenses[0], defenses[1]][tier] ? [defenses[0]] : defenses.slice(0, 2)),
    consistency: consts[Math.max(0, tier - 1 + rng.int(-1, 1))],
    autoFuel:   Math.max(0, Math.round(rng.gauss(autoFuelBase, autoFuelBase * 0.3))),
    teleopFuel: Math.max(0, Math.round(rng.gauss(teleopFuelBase, teleopFuelBase * 0.3))),
    carrierCap: [8, 7, 5, 3, 2][tier] + rng.int(-1, 1),
    notes: rng.bool(0.6) ? rng.pick(noteBank) : "",
  };
}

// ─── SCHEDULE GENERATOR ──────────────────────────────────────────────────────
// Each team plays ~8 matches in 40 quals (240 slots / 30 teams = 8)
function generateSchedule(rng) {
  const schedule = [];
  const playCount = Object.fromEntries(TEAMS.map(t => [t, 0]));

  // Helper: pick 3 teams not already in this match and with lowest play counts
  function pickTeams(used, n) {
    const pool = TEAMS
      .filter(t => !used.includes(t))
      .sort((a, b) => playCount[a] - playCount[b] + (rng.next() - 0.5) * 0.8);
    return pool.slice(0, n);
  }

  for (let q = 1; q <= TOTAL_QUAL; q++) {
    const used = [];
    const red  = pickTeams(used, 3); used.push(...red);
    const blue = pickTeams(used, 3); used.push(...blue);
    red.forEach(t  => playCount[t]++);
    blue.forEach(t => playCount[t]++);

    schedule.push({
      match_key: `${EVENT_KEY}_qm${q}`,
      red:  red.map(t  => `frc${t}`),
      blue: blue.map(t => `frc${t}`),
    });
  }

  // Force 9029 into Qual 1 Red 1
  schedule[0].red[0] = "frc9029";
  // Deduplicate
  schedule[0].red = [...new Set(schedule[0].red)];
  if (schedule[0].red.length < 3) schedule[0].red.push(`frc${TEAMS.find(t => !schedule[0].red.includes(`frc${t}`) && !schedule[0].blue.includes(`frc${t}`))}`);

  return schedule;
}

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }

// ─── ZONE CENTRES (normalised 0–1, EF convention: blue=left, red=right) ───────
const ZONE_CENTER = {
  blue_bump_top:   { x: 0.305, y: 0.315 },
  blue_bump_bot:   { x: 0.305, y: 0.685 },
  blue_trench_top: { x: 0.305, y: 0.15  },
  blue_trench_bot: { x: 0.305, y: 0.85  },
  red_bump_top:    { x: 0.695, y: 0.315 },
  red_bump_bot:    { x: 0.695, y: 0.685 },
  red_trench_top:  { x: 0.695, y: 0.15  },
  red_trench_bot:  { x: 0.695, y: 0.85  },
};

/**
 * Returns the specific bump/trench zone names this team prefers for this match.
 * Deterministic given the PRNG state — called once per team/match combination.
 */
function pickZonePreferences(alliance, pitData, rng) {
  const ownBumpTop   = alliance === "red" ? "red_bump_top"   : "blue_bump_top";
  const ownBumpBot   = alliance === "red" ? "red_bump_bot"   : "blue_bump_bot";
  const oppBumpTop   = alliance === "red" ? "blue_bump_top"  : "red_bump_top";
  const oppBumpBot   = alliance === "red" ? "blue_bump_bot"  : "red_bump_bot";
  const ownTrenchTop = alliance === "red" ? "red_trench_top" : "blue_trench_top";
  const ownTrenchBot = alliance === "red" ? "red_trench_bot" : "blue_trench_bot";

  // Most teams use their own bumps; some aggressive teams use opponent's
  const useOppBump = pitData.bump && rng.bool(0.18);
  const bumpZone   = pitData.bump
    ? (useOppBump
        ? (rng.bool(0.5) ? oppBumpTop : oppBumpBot)
        : (rng.bool(0.6) ? ownBumpTop : ownBumpBot))
    : null;
  const trenchZone = pitData.trench
    ? (rng.bool(0.55) ? ownTrenchTop : ownTrenchBot)
    : null;

  return { bumpZone, trenchZone };
}

// ─── AUTO PATH GENERATOR ─────────────────────────────────────────────────────
// EF convention: blue=left (x≈0.07), red=right (x≈0.93), y=0 top
function generateAutoPath(alliance, tier, rng) {
  if (tier === 3 && rng.bool(0.5)) return [];
  if (tier === 4 && rng.bool(0.7)) return [];

  const startX = alliance === "red" ? rng.gauss(0.93, 0.03) : rng.gauss(0.07, 0.03);
  const startY = rng.gauss(0.5, 0.15);
  const points = [{ x: clamp(startX), y: clamp(startY), t_ms: 0 }];

  const steps  = [4, 5, 6, 4, 2][tier] + rng.int(0, 2);
  const targetX = rng.gauss(0.5, 0.06);
  const targetY = rng.gauss(0.5, 0.08);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: clamp(startX + (targetX - startX) * t + rng.gauss(0, 0.03)),
      y: clamp(startY + (targetY - startY) * t + rng.gauss(0, 0.05)),
      t_ms: Math.round(i / steps * 15000),  // auto lasts ~15 s
    });
  }
  return points;
}

// ─── LOCATION PINGS GENERATOR ─────────────────────────────────────────────────
/**
 * Generates teleop pings (sorted by t_ms) with coordinates concentrated around
 * the team's preferred zones so that traversal zone inference works correctly.
 */
function generatePings(alliance, tier, pitData, preferences, rng) {
  const pings = [];
  const isDefense = pitData.defense === "Ana Strateji";
  const { bumpZone, trenchZone } = preferences;

  const count = rng.int(10, 20);

  // Build a weight table for where pings go
  const weights = [];
  if (!isDefense) {
    // Hub pings — red hub is on the right, blue hub is on the left (EF convention)
    const hubX = alliance === "red" ? 0.62 : 0.38;
    weights.push({ w: 0.45, cx: hubX, cy: 0.5, sx: 0.06, sy: 0.07, zone: "hub" });
    // Own bump pings — use specific zone centre
    if (bumpZone) {
      const bc = ZONE_CENTER[bumpZone];
      weights.push({ w: 0.30, cx: bc.x, cy: bc.y, sx: 0.04, sy: 0.05, zone: "bump" });
    }
    // Trench pings
    if (trenchZone) {
      const tc = ZONE_CENTER[trenchZone];
      weights.push({ w: 0.20, cx: tc.x, cy: tc.y, sx: 0.03, sy: 0.04, zone: "trench" });
    }
    // Roaming centre
    weights.push({ w: 0.05, cx: 0.5, cy: 0.5, sx: 0.15, sy: 0.15, zone: "center" });
  } else {
    // Defense: roam opponent half
    const oppCX = alliance === "red" ? 0.70 : 0.30;
    weights.push({ w: 1.0, cx: oppCX, cy: 0.5, sx: 0.15, sy: 0.20, zone: "center" });
  }

  // Normalise weights
  const totalW = weights.reduce((s, w) => s + w.w, 0);
  weights.forEach(w => { w.w /= totalW; });

  for (let i = 0; i < count; i++) {
    // Pick zone bucket
    let r = rng.next(), bucket = weights[weights.length - 1];
    let acc = 0;
    for (const w of weights) { acc += w.w; if (r < acc) { bucket = w; break; } }

    pings.push({
      t_ms: rng.int(30000, 130000),
      x:    clamp(rng.gauss(bucket.cx, bucket.sx)),
      y:    clamp(rng.gauss(bucket.cy, bucket.sy)),
      zone: bucket.zone,
      near_bump:   bucket.zone === "bump",
      near_trench: bucket.zone === "trench",
    });
  }
  return pings.sort((a, b) => a.t_ms - b.t_ms);
}

// ─── TIMELINE EVENTS GENERATOR ────────────────────────────────────────────────
/**
 * Generates traversal & problem events.
 * Traversal t_ms values are anchored to nearby bump/trench pings so that
 * the linear-interpolation zone inference in teamAnalytics resolves correctly.
 */
function generateTimeline(pitData, preferences, sortedPings, rng) {
  const events = [];
  const { bumpZone, trenchZone } = preferences;

  // Helper: find pings near a zone centre and return one of their timestamps ±noise
  function anchorTime(zone, fallbackMin, fallbackMax) {
    if (!zone) return rng.int(fallbackMin, fallbackMax);
    const c = ZONE_CENTER[zone];
    const nearby = sortedPings.filter(p => {
      const dx = p.x - c.x, dy = p.y - c.y;
      return Math.sqrt(dx*dx + dy*dy) < 0.15;
    });
    if (!nearby.length) return rng.int(fallbackMin, fallbackMax);
    const ref = rng.pick(nearby);
    return Math.max(fallbackMin, Math.min(fallbackMax, ref.t_ms + rng.int(-3000, 3000)));
  }

  // Bump traversals — each anchored near a bump ping
  if (bumpZone && rng.bool(0.75)) {
    const times = rng.int(1, 3);
    for (let i = 0; i < times; i++) {
      events.push({
        action: "traversal",
        key: "bump",
        t_ms: anchorTime(bumpZone, 35000, 120000),
      });
    }
  }

  // Trench traversals
  if (trenchZone && rng.bool(0.55)) {
    const times = rng.int(1, 2);
    for (let i = 0; i < times; i++) {
      events.push({
        action: "traversal",
        key: "trench",
        t_ms: anchorTime(trenchZone, 40000, 115000),
      });
    }
  }

  // Problems
  const problemProb = {
    "Çok Güvenilir": 0.05, "Güvenilir": 0.12, "Orta": 0.25, "Zayıf": 0.45,
  }[pitData.consistency] || 0.15;
  const problemTypes = ["comms", "mech", "stuck", "brownout", "foul"];
  if (rng.bool(problemProb))
    events.push({ action: "problem", key: rng.pick(problemTypes), t_ms: rng.int(40000, 120000) });
  if (rng.bool(problemProb * 0.4))
    events.push({ action: "problem", key: rng.pick(problemTypes), t_ms: rng.int(40000, 120000) });

  if (pitData.defense === "Ana Strateji")
    events.push({ action: "problem", key: "defense", t_ms: rng.int(30000, 100000) });

  return events.sort((a, b) => a.t_ms - b.t_ms);
}

// ─── MATCH SCORE GENERATOR ───────────────────────────────────────────────────
/**
 * Given a match and pit reports, produce a plausible FRC score for each alliance.
 * Typical score range: 20–140 pts.
 */
function generateMatchScore(match, pitReports, rng) {
  function allianceScore(teamKeys) {
    let total = 0;
    for (const tk of teamKeys) {
      const pit  = pitReports[tk] || {};
      const tier = getArchetype(parseInt(tk.replace("frc", "")) || 0);
      // Fuel points
      const auto   = Math.max(0, Math.round(rng.gauss(pit.autoFuel   || [20,14,8,3,0][tier], 4)));
      const teleop = Math.max(0, Math.round(rng.gauss(pit.teleopFuel || [45,30,16,6,0][tier], 7)));
      // Climb RP simulation
      const climbPts = { L3: 15, L2: 10, L1: 5, Yok: 0 }[pit.climbTeleop] || 0;
      const climbed  = rng.bool([0.85, 0.75, 0.6, 0.35, 0.2][tier]) ? climbPts : 0;
      total += auto + teleop + climbed;
    }
    return Math.max(5, total + rng.int(-6, 6));
  }

  const redScore  = allianceScore(match.red);
  const blueScore = allianceScore(match.blue);
  const winner    = redScore > blueScore ? "red" : blueScore > redScore ? "blue" : "tie";
  return { red_score: redScore, blue_score: blueScore, winning_alliance: winner };
}

// ─── MAIN GENERATOR ──────────────────────────────────────────────────────────
async function generateRegional(onProgress) {
  const rng = makePRNG(9029);

  // 1. Generate schedule (skeleton, scores added after pit generation)
  onProgress("Takvim oluşturuluyor…");
  const schedule = generateSchedule(rng);

  // 2. Generate pit reports for all 30 teams
  onProgress("Pit raporları oluşturuluyor…");
  const pitReports = {};
  for (const t of TEAMS) {
    pitReports[`frc${t}`] = generatePitReport(t, rng);
  }
  localStorage.setItem("pitReports", JSON.stringify(pitReports));

  // Embed scores into the played quals of the schedule
  for (let qi = 0; qi < PLAYED_QUAL; qi++) {
    const scores = generateMatchScore(schedule[qi], pitReports, rng);
    Object.assign(schedule[qi], scores);
  }
  localStorage.setItem(`mockSchedule_${EVENT_KEY}`, JSON.stringify(schedule));

  // 3. Clear existing offline reports, then generate field reports for played quals
  onProgress("Mevcut raporlar temizleniyor…");
  await clearOfflineReports();

  onProgress("Saha raporları oluşturuluyor…");
  let saved = 0;
  for (let qi = 0; qi < PLAYED_QUAL; qi++) {
    const match = schedule[qi];
    const allTeams = [...match.red, ...match.blue];
    const alliances = [...Array(3).fill("red"), ...Array(3).fill("blue")];
    const seats     = ["red1","red2","red3","blue1","blue2","blue3"];

    for (let ri = 0; ri < 6; ri++) {
      const teamKey  = allTeams[ri];
      const tNum     = parseInt(teamKey.replace("frc", ""));
      const alliance = alliances[ri];
      const pit      = pitReports[teamKey] || {};
      const tier     = getArchetype(tNum);

      // Pick this robot's preferred zones — must happen before pings/timeline
      const preferences = pickZonePreferences(alliance, pit, rng);

      const autoPath = generateAutoPath(alliance, tier, rng);
      const pings    = generatePings(alliance, tier, pit, preferences, rng);
      // Pass pings so traversal timestamps can anchor to nearby bump/trench pings
      const timeline = generateTimeline(pit, preferences, pings, rng);

      // Climb result
      let tower_level = "none";
      if (pit.climbTeleop === "L3" && rng.bool(0.8)) tower_level = "L3";
      else if (pit.climbTeleop === "L2" && rng.bool(0.75)) tower_level = "L2";
      else if (pit.climbTeleop === "L1" && rng.bool(0.7)) tower_level = "L1";

      const report = {
        event_key:   EVENT_KEY,
        match_key:   match.match_key,
        team_key:    teamKey,
        scout_device_id: seats[ri],
        auto_path_points: autoPath,
        auto_fuel_scored: Math.max(0, Math.round(rng.gauss(pit.autoFuel || 0, 3))),
        teleop_fuel_scored_active:   Math.max(0, Math.round(rng.gauss((pit.teleopFuel || 0) * 0.7, 5))),
        teleop_fuel_scored_inactive: Math.max(0, Math.round(rng.gauss((pit.teleopFuel || 0) * 0.3, 3))),
        hub_state_samples: [],
        bump_slow_or_stuck:   pit.bump   && timeline.some(e => e.action === "traversal" && e.key === "bump"),
        trench_slow_or_stuck: pit.trench && timeline.some(e => e.action === "traversal" && e.key === "trench"),
        tower_level,
        teleop_shoot_timestamps_ms: [],
        location_pings: pings,
        timeline,
        notes: rng.bool(0.25) ? rng.pick([
          "İyi bir maç oynadı.",
          "Otonom tutarlıydı.",
          "Bump geçişi hızlıydı.",
          "Endgame'de sıkıştı.",
          "Defans robotunu engelledi.",
          "COMMS sorunu yaşadı ama toparladı.",
        ]) : "",
      };

      await saveReport(report);
      saved++;
    }
    onProgress(`Saha raporları: ${saved}/${PLAYED_QUAL * 6}…`);
  }

  // 4. Set event key in admin config
  const cfg = getAdminConfig();
  setAdminConfig({ ...cfg, eventKey: EVENT_KEY, myTeam: "frc9029" });

  return { teams: TEAMS.length, quals: TOTAL_QUAL, played: PLAYED_QUAL, reports: saved };
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────
export default function TestDataPanel() {
  const [status,   setStatus]   = useState(null); // null | "running" | "done" | "error"
  const [progress, setProgress] = useState("");
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState(null);

  async function handleGenerate() {
    setStatus("running");
    setProgress("Başlıyor…");
    setResult(null);
    setError(null);
    try {
      const res = await generateRegional((msg) => setProgress(msg));
      setResult(res);
      setStatus("done");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  async function handleClear() {
    localStorage.removeItem(`mockSchedule_${EVENT_KEY}`);
    localStorage.removeItem("pitReports");
    localStorage.removeItem("warRoomAICache");
    localStorage.removeItem("warRoomStrategy");
    await clearOfflineReports();
    setStatus(null);
    setResult(null);
    setProgress("");
  }

  return (
    <div className="test-panel">
      <div className="test-header">
        <h2 className="test-title">🧪 Test Verisi Üretici</h2>
        <p className="test-desc">
          Sistemi test etmek için gerçekçi algoritmik bir regional verisi oluşturur.
          Event key <code>2026test</code> olarak ayarlanır, takımımız <code>frc9029</code>.
        </p>
      </div>

      <div className="test-summary-cards">
        <div className="test-card">
          <span className="test-card-num">30</span>
          <span className="test-card-lbl">Takım</span>
        </div>
        <div className="test-card">
          <span className="test-card-num">40</span>
          <span className="test-card-lbl">Qual</span>
        </div>
        <div className="test-card">
          <span className="test-card-num">30</span>
          <span className="test-card-lbl">Oynanmış</span>
        </div>
        <div className="test-card">
          <span className="test-card-num">180</span>
          <span className="test-card-lbl">Saha Raporu</span>
        </div>
      </div>

      <div className="test-team-list">
        <span className="test-team-lbl">Takımlar:</span>
        {TEAMS.map(t => (
          <span key={t} className={`test-team-chip ${t === 9029 ? "chip-ours" : ""}`}>
            {t}
          </span>
        ))}
      </div>

      <div className="test-actions">
        <button
          className="test-generate-btn"
          disabled={status === "running"}
          onClick={handleGenerate}>
          {status === "running" ? "⏳ Oluşturuluyor…" : "🏟 Regional Yarat"}
        </button>
        <button className="test-clear-btn" onClick={handleClear} disabled={status === "running"}>
          🗑 Temizle
        </button>
      </div>

      {status === "running" && (
        <div className="test-progress">
          <span className="wr-ai-spinner" style={{ width:12, height:12 }} />
          {progress}
        </div>
      )}

      {status === "done" && result && (
        <div className="test-result">
          <div className="test-result-icon">✅</div>
          <div>
            <strong>{result.teams} takım</strong> · <strong>{result.quals} qual</strong> ·{" "}
            <strong>{result.reports} saha raporu</strong> başarıyla oluşturuldu.
            <br />
            <span className="test-result-hint">
              Event key <code>2026test</code> set edildi. War Room → bir qual seç → Strateji Üret.
            </span>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="test-error">❌ Hata: {error}</div>
      )}

      <div className="test-archetypes">
        <p className="test-arch-title">Takım Arketipleri</p>
        <div className="test-arch-grid">
          {[
            { label: "POWERHOUSE",        teams: "254, 1114, 2056, 1678, 148",     color: "#fbbf24" },
            { label: "SOLID",             teams: "118, 971, 2910, 4414, 3476, 5740, 6328, 9029", color: "#4ade80" },
            { label: "ORTALAMA",          teams: "6834, 2175, 3015, 4099, 5895, 2767, 6072, 1923, 3538, 4201", color: "#60a5fa" },
            { label: "DÜŞÜK / ACEMI",     teams: "7153, 8085, 8230, 9008",          color: "#94a3b8" },
            { label: "DEFANS UZMANI",     teams: "7407, 9150, 4055",                color: "#f87171" },
          ].map(a => (
            <div key={a.label} className="test-arch-row">
              <span className="test-arch-badge" style={{ background: a.color + "22", border: `1px solid ${a.color}`, color: a.color }}>
                {a.label}
              </span>
              <span className="test-arch-teams">{a.teams}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
