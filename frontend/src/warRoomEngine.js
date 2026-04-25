import { computeSoS } from "./teamAnalytics";

export const FEATURE_DEFS = {
  cycle_time_p50: { label: "Cycle Time P50", desc: "Medyan şut çevrim süresi (sn), düşük daha iyi." },
  auto_lane_commit: { label: "Auto Lane Commit", desc: "Otonom başlangıç lane kararlılığı." },
  defense_pressure_rate: { label: "Defense Pressure Rate", desc: "Maç başına defans baskısı tag sıklığı." },
  comms_mech_risk: { label: "Comms/Mech Risk", desc: "Comms/mech problem olasılığı." },
  confidence_score: { label: "Scout Confidence", desc: "Scout confidence alanından normalize güven." },
  epa_strength: { label: "EPA Strength", desc: "Statbotics EPA normalize gücü." },
  schedule_strength: { label: "SoS Strength", desc: "Program zorluğu (rakip EPA ort.)." },
  pit_output_hint: { label: "Pit Output Hint", desc: "Pit atış hızı ve kapasite sinyali." },
};

function qNum(matchKey = "") {
  return parseInt(String(matchKey).split("_qm")[1], 10) || 0;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = clamp(Math.floor((p / 100) * (s.length - 1)), 0, s.length - 1);
  return s[idx];
}
function winsorize(arr, low = 5, high = 95) {
  if (!arr.length) return [];
  const lo = percentile(arr, low);
  const hi = percentile(arr, high);
  return arr.map((v) => clamp(v, lo, hi));
}
function weightedMean(values, weights) {
  if (!values.length || !weights.length) return 0;
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  return values.reduce((s, v, i) => s + v * (weights[i] || 0), 0) / wSum;
}
function recencyWeight(currentQual, reportQual) {
  const age = Math.max(0, currentQual - reportQual);
  return Math.exp(-0.12 * age);
}
function confidenceToNum(c) {
  const t = String(c || "").toLowerCase();
  if (t.includes("eminim")) return 1;
  if (t.includes("orta")) return 0.65;
  if (t.includes("değilim")) return 0.35;
  return 0.55;
}
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(avg(arr.map((x) => (x - m) ** 2)));
}
function randomNormal() {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function cycleP50(report) {
  const t = report.teleop_shoot_timestamps_ms || [];
  if (t.length < 2) return null;
  const diffs = [];
  for (let i = 1; i < t.length; i++) diffs.push((t[i] - t[i - 1]) / 1000);
  return percentile(diffs, 50);
}
function laneOf(report) {
  const y = report.auto_path_points?.[0]?.y;
  if (y == null) return null;
  if (y < 0.33) return "top";
  if (y < 0.66) return "mid";
  return "bot";
}
function hasProblem(report, key) {
  const tl = report.timeline || [];
  if (tl.some((e) => e.action === "problem" && String(e.key || "").includes(key))) return true;
  const probs = report.problems || [];
  return probs.some((p) => String(p).includes(key));
}
function countDefenseEvents(report) {
  const tl = report.timeline || [];
  return tl.filter((e) => {
    const k = String(e.key || "");
    return k.includes("defense") || k.includes("def_");
  }).length;
}

function buildTeamFeatures(teamKey, ctx) {
  const { reports, pitReports, epaData, schedule, currentQual } = ctx;
  const mine = reports.filter((r) => r.team_key === teamKey);
  const cyclePairs = mine
    .map((r) => ({ c: cycleP50(r), w: recencyWeight(currentQual, qNum(r.match_key)) }))
    .filter((x) => x.c != null);
  const cyclesRaw = winsorize(cyclePairs.map((x) => x.c));
  const cycleWeights = cyclePairs.map((x) => x.w);
  const cycleWeighted = cyclesRaw.length ? weightedMean(cyclesRaw, cycleWeights) : 8;

  const laneCounts = { top: 0, mid: 0, bot: 0 };
  mine.forEach((r) => { const l = laneOf(r); if (l) laneCounts[l]++; });
  const laneTotal = laneCounts.top + laneCounts.mid + laneCounts.bot;
  const laneCommit = laneTotal ? Math.max(laneCounts.top, laneCounts.mid, laneCounts.bot) / laneTotal : 0.4;

  const defenseRate = mine.length ? avg(mine.map(countDefenseEvents)) : 0;
  const commsMechRisk = mine.length
    ? mine.filter((r) => hasProblem(r, "comms") || hasProblem(r, "mech")).length / mine.length
    : 0.2;
  const confidence = mine.length ? avg(mine.map((r) => confidenceToNum(r.scout_confidence))) : 0.55;
  const epa = epaData[teamKey]?.epa ?? 0;
  const epaNorm = clamp(epa / 70, 0, 1);
  const sos = computeSoS(teamKey, schedule, epaData);
  const sosNorm = sos.sos == null || !sos.avgEventEpa ? 0.5 : clamp(sos.sos / (sos.avgEventEpa * 1.4), 0, 1);
  const pit = pitReports[teamKey] || {};
  const pitHint = clamp(((pit.fuelPerSecond || 0) / 10) * 0.7 + ((pit.carrierCap || 0) / 25) * 0.3, 0, 1);
  const fuelTotals = mine.map((r) =>
    (r.auto_fuel_scored || 0) + (r.teleop_fuel_scored_active || 0) + (r.teleop_fuel_scored_inactive || 0)
  );
  const fuelNorm = clamp(percentile(winsorize(fuelTotals), 50) / 80, 0, 1);
  const variability = clamp(stddev(fuelTotals) / 25, 0, 1);

  const fused = {
    offense_index: clamp(epaNorm * 0.34 + fuelNorm * 0.33 + pitHint * 0.18 + laneCommit * 0.15, 0, 1),
    reliability_index: clamp(confidence * 0.5 + (1 - commsMechRisk) * 0.35 + (1 - variability) * 0.15, 0, 1),
    defense_resilience: clamp((1 - defenseRate / 5) * 0.5 + laneCommit * 0.25 + confidence * 0.25, 0, 1),
  };

  return {
    teamKey,
    features: {
      cycle_time_p50: cycleWeighted,
      auto_lane_commit: laneCommit,
      defense_pressure_rate: defenseRate,
      comms_mech_risk: commsMechRisk,
      confidence_score: confidence,
      epa_strength: epaNorm,
      schedule_strength: sosNorm,
      pit_output_hint: pitHint,
    },
    derived: { ...fused, fuel_variability: variability, sosTier: sos.tier || "normal" },
  };
}

function teamExpectedPoints(team, scenario, oppDefenseMean) {
  const o = team.derived.offense_index;
  const r = team.derived.reliability_index;
  const d = team.derived.defense_resilience;
  const base = 12 + o * 55 + r * 18;

  let scenarioMult = 1;
  if (scenario === "heavy_defense") scenarioMult *= 0.82 + d * 0.2;
  if (scenario === "auto_lane_conflict") scenarioMult *= 0.88 + team.features.auto_lane_commit * 0.15;
  if (scenario === "comms_mech_risk") scenarioMult *= 0.78 + (1 - team.features.comms_mech_risk) * 0.25;

  // matchup model: opponent defense shifts output up/down
  const matchupMult = clamp(1 - (oppDefenseMean - 0.5) * 0.18, 0.82, 1.18);
  return base * scenarioMult * matchupMult;
}

function simulateScenario(ourTeams, oppTeams, scenario, runs = 1000) {
  const oppDefenseMean = avg(oppTeams.map((t) => t.derived.defense_resilience));
  const ourDefenseMean = avg(ourTeams.map((t) => t.derived.defense_resilience));
  const diffs = [];
  let wins = 0;
  for (let i = 0; i < runs; i++) {
    const ourScore = ourTeams.reduce((s, t) => {
      const mu = teamExpectedPoints(t, scenario, oppDefenseMean);
      return s + Math.max(0, mu + randomNormal() * (4 + t.derived.fuel_variability * 6));
    }, 0);
    const oppScore = oppTeams.reduce((s, t) => {
      const mu = teamExpectedPoints(t, scenario, ourDefenseMean);
      return s + Math.max(0, mu + randomNormal() * (4 + t.derived.fuel_variability * 6));
    }, 0);
    const diff = ourScore - oppScore;
    diffs.push(diff);
    if (diff > 0) wins++;
  }
  const sorted = [...diffs].sort((a, b) => a - b);
  return {
    winProb: wins / runs,
    p10: percentile(sorted, 10),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
  };
}

function topSensitivity(ourTeams, oppTeams) {
  const keys = ["offense_index", "reliability_index", "defense_resilience"];
  const base = simulateScenario(ourTeams, oppTeams, "normal", 350).winProb;
  const out = [];
  for (const k of keys) {
    const boosted = ourTeams.map((t) => ({
      ...t,
      derived: { ...t.derived, [k]: clamp(t.derived[k] * 1.12, 0, 1) },
    }));
    const next = simulateScenario(boosted, oppTeams, "normal", 350).winProb;
    out.push({ key: k, deltaWinProb: +(100 * (next - base)).toFixed(1) });
  }
  return out.sort((a, b) => Math.abs(b.deltaWinProb) - Math.abs(a.deltaWinProb)).slice(0, 3);
}

function buildRoleOutputs(scenarios, ourTeams) {
  const normal = scenarios.normal?.winProb || 0;
  const defense = scenarios.heavy_defense?.winProb || 0;
  const conflict = scenarios.auto_lane_conflict?.winProb || 0;
  const risk = scenarios.comms_mech_risk?.winProb || 0;
  const stable = ourTeams.filter((t) => t.derived.reliability_index > 0.65).map((t) => t.teamKey.replace("frc", ""));
  const fragile = ourTeams
    .sort((a, b) => a.derived.reliability_index - b.derived.reliability_index)
    .slice(0, 1)
    .map((t) => t.teamKey.replace("frc", ""));

  return {
    coach: [
      `Normal senaryo kazanma: %${Math.round(normal * 100)} (P50 fark ${scenarios.normal?.p50?.toFixed(1)}).`,
      `Ağır defansta win% düşüşü: ~${Math.round((normal - defense) * 100)} pp — cycle kısaltma kritik.`,
      `Auto lane conflict win% etkisi: ~${Math.round((normal - conflict) * 100)} pp; lane ayrımı şart.`,
      `Comms/mech risk senaryosu win% ~${Math.round(risk * 100)} (normalden ${Math.round((normal - risk) * 100)} pp).`,
      `Riskli / stabil: ${fragile[0] || "-"} → basit rol · ${stable.join(", ") || "-"}`,
    ],
    driveCoach: [
      "İlk 30s: auto çıkışta lane çakışması görürsen Plan B (mid lane fallback).",
      "İlk 30s: 1+ comms/mech işareti varsa riskli robotu hub çevresi güvenli role çek.",
      "İlk 30s: rakip defansı sertse uzun çevrim yerine kısa cycle setine dön.",
      "2 başarısız cycle üst üste olursa throughput yerine foul-risk düşür.",
    ],
    scoutLead: [
      "İlk 30s lane usage ve auto bitiş pozisyonlarını işaretle.",
      "Comms/mech olaylarını timestamp ile etiketle.",
      "Defans baskısı yoğunluğunu (event strip) takip et.",
      "Post-match confidence düşükse raporu review kuyruğuna al.",
    ],
  };
}

export function runWarRoomDecisionEngine({ match, myTeam, pitReports, scoutReports, epaData, schedule }) {
  if (!match) return null;
  const ourAlliance = myTeam
    ? (match.red.includes(myTeam) ? "red" : match.blue.includes(myTeam) ? "blue" : "red")
    : "red";
  const ourKeys = ourAlliance === "red" ? match.red : match.blue;
  const oppKeys = ourAlliance === "red" ? match.blue : match.red;
  const currentQual = qNum(match.match_key);
  const ctx = { reports: scoutReports, pitReports, epaData, schedule, currentQual };

  const featureMap = {};
  [...ourKeys, ...oppKeys].forEach((tk) => { featureMap[tk] = buildTeamFeatures(tk, ctx); });
  const ourTeams = ourKeys.map((k) => featureMap[k]).filter(Boolean);
  const oppTeams = oppKeys.map((k) => featureMap[k]).filter(Boolean);

  const scenarios = {
    normal: simulateScenario(ourTeams, oppTeams, "normal", 1000),
    heavy_defense: simulateScenario(ourTeams, oppTeams, "heavy_defense", 1000),
    auto_lane_conflict: simulateScenario(ourTeams, oppTeams, "auto_lane_conflict", 1000),
    comms_mech_risk: simulateScenario(ourTeams, oppTeams, "comms_mech_risk", 1000),
  };
  const sensitivity = topSensitivity(ourTeams, oppTeams);
  const roleOutput = buildRoleOutputs(scenarios, ourTeams);

  const baseWin = scenarios.normal.winProb;
  const scenarioCards = Object.entries(scenarios).map(([k, v]) => ({
    key: k,
    label: k.replaceAll("_", " "),
    winProb: v.winProb,
    p10: v.p10,
    p50: v.p50,
    p90: v.p90,
    deltaVsNormalPp: +(100 * (v.winProb - baseWin)).toFixed(1),
    baselinePp: +(100 * (v.winProb - 0.5)).toFixed(1),
  }));

  return {
    featureDefinitions: FEATURE_DEFS,
    featureMap,
    scenarios,
    scenarioCards,
    sensitivity,
    roleOutput,
    triggers: roleOutput.driveCoach,
    ourAlliance,
  };
}
