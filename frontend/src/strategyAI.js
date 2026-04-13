/**
 * Strategy AI — builds a detailed FRC match context and calls OpenRouter
 * to generate a Turkish-language strategy recommendation.
 */

import {
  analyzeTeam, formatInsightsForPrompt,
  detectAutoCollisions, findOpponentCarrier, findChokePoint,
  analyzeTrafficRouting, getReliabilityRoles, analyzeShootingPositions,
  ZONE_LABEL,
} from "./teamAnalytics";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "x-ai/grok-4-fast";

// ─── BUILD TEAM CONTEXT STRING ─────────────────────────────────────────────
function pitSummary(pit, teamNum) {
  if (!pit) return `frc${teamNum}: Pit verisi yok.`;
  const parts = [];
  if (pit.drive)        parts.push(`sürüş: ${pit.drive}`);
  if (pit.drive === "Swerve") {
    const model = [pit.swerveModel, pit.swerveRatioCustom || pit.swerveRatio].filter(Boolean).join(" ");
    if (model) parts.push(`swerve modülü: ${model}`);
  }
  if (pit.driveMotor)   parts.push(`motor: ${pit.driveMotor}`);
  if (pit.intake)       parts.push(`toparlama: ${pit.intake}`);
  if (pit.shootRange)   parts.push(`şut menzili: ${pit.shootRange}`);
  if (pit.climbTeleop)  parts.push(`teleop tırmanma: ${pit.climbTeleop}`);
  if (pit.climbAuto)    parts.push(`oto tırmanma: ${pit.climbAuto}`);
  if (pit.bump)         parts.push("bump geçebilir");
  if (pit.trench)       parts.push("trench geçebilir");
  if (pit.defense)      parts.push(`defans: ${pit.defense}`);
  if (pit.consistency)  parts.push(`güvenilirlik: ${pit.consistency}`);
  if (pit.autoFuel)     parts.push(`tahmini auto yakıt: ${pit.autoFuel}`);
  if (pit.teleopFuel)   parts.push(`tahmini teleop yakıt: ${pit.teleopFuel}`);
  if (pit.fuelPerSec)   parts.push(`atış hızı: ${pit.fuelPerSec} f/sn`);
  if (pit.carrierCap)   parts.push(`taşıma kapasitesi: ${pit.carrierCap}`);
  if ((pit.limelights || []).length) {
    const llStr = pit.limelights.join("+");
    const llCount = pit.limelightCount ? `×${pit.limelightCount}` : "";
    parts.push(`vision: ${llStr}${llCount}`);
  }
  if (pit.notes)              parts.push(`pit notu: "${pit.notes}"`);
  if (pit.interviewNotes)     parts.push(`görüşme: "${pit.interviewNotes}"`);
  if (pit.inspectionWeight)   parts.push(`insp. ağırlık: ${pit.inspectionWeight} kg`);
  if (pit.inspectionStatus)   parts.push(`insp. durum: ${pit.inspectionStatus}`);
  if (pit.inspectionNotes)    parts.push(`insp. notu: "${pit.inspectionNotes}"`);
  return `frc${teamNum} — ${parts.join(", ")}.`;
}

function scoutSummary(reports, teamKey, teamNum) {
  const mine = reports.filter((r) => r.team_key === teamKey);
  if (!mine.length) return `frc${teamNum}: Maç scouting verisi yok.`;

  let bumpCount = 0, trenchCount = 0;
  const problemMap = {};
  const zoneMap = {};
  let climbSet = new Set();

  mine.forEach((r) => {
    if (r.bump_slow_or_stuck)   bumpCount++;
    if (r.trench_slow_or_stuck) trenchCount++;
    if (r.tower_level && r.tower_level !== "none") climbSet.add(r.tower_level);

    (r.timeline || []).forEach((ev) => {
      if (ev.action === "problem")   problemMap[ev.key] = (problemMap[ev.key] || 0) + 1;
      if (ev.action === "traversal" && ev.key === "bump")   bumpCount++;
      if (ev.action === "traversal" && ev.key === "trench") trenchCount++;
      if (ev.action === "ping" && ev.zone) zoneMap[ev.zone] = (zoneMap[ev.zone] || 0) + 1;
    });
  });

  const n = mine.length;
  const topZone = Object.entries(zoneMap).sort((a, b) => b[1] - a[1])[0]?.[0];
  const problems = Object.entries(problemMap)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k.toUpperCase()} (${v}×)`).join(", ");

  const parts = [`${n} maç scouted`];
  if (bumpCount)   parts.push(`bump kullanımı: ${(bumpCount / n).toFixed(1)}×/maç`);
  if (trenchCount) parts.push(`trench kullanımı: ${(trenchCount / n).toFixed(1)}×/maç`);
  if (topZone)     parts.push(`en sık bölge: ${topZone}`);
  if (climbSet.size) parts.push(`tırmanma gördük: ${[...climbSet].join("/")}`);
  if (problems)    parts.push(`sorunlar: ${problems}`);

  return `frc${teamNum} saha geçmişi — ${parts.join(", ")}.`;
}

function teamNum(key) { return (key || "").replace("frc", ""); }

// ─── BUILD FULL PROMPT ──────────────────────────────────────────────────────
export function buildPrompt({ match, myTeam, pitReports, scoutReports, epaData = {} }) {
  const myNum = (myTeam || "").replace("frc", "");
  const redNums  = match.red.map(teamNum);
  const blueNums = match.blue.map(teamNum);

  const myAlliance = myTeam
    ? match.red.includes(myTeam)
      ? "red"
      : match.blue.includes(myTeam)
        ? "blue"
        : null
    : null;

  const sections = [];

  sections.push(`Sen FRC (FIRST Robotics Competition) 2026 sezonu "REBUILT" oyununda deneyimli bir strateji analistsin.`);
  sections.push(`Maç: ${match.match_key}`);

  if (myAlliance) {
    sections.push(`Biz ${myAlliance.toUpperCase()} alliance'dayız — Takım ${myNum}.`);
  } else {
    sections.push(`Takımımızın numarası: ${myNum || "bilinmiyor"}. Bu maçta oynamıyoruz, gözlem yapıyoruz.`);
  }

  // Build analytics for all 6 robots
  const allTeams = [...match.red, ...match.blue];
  const analyticsMap = {};
  for (const tk of allTeams) {
    analyticsMap[tk] = analyzeTeam(tk, scoutReports);
  }

  function teamBlock(tk) {
    const lines = [];
    lines.push(pitSummary(pitReports[tk], teamNum(tk)));
    lines.push(scoutSummary(scoutReports, tk, teamNum(tk)));
    const a = analyticsMap[tk];
    if (a) lines.push(formatInsightsForPrompt(tk, a));
    return lines.join("\n");
  }

  sections.push(`\n=== RED ALLIANCE (${redNums.join(", ")}) ===`);
  match.red.forEach(tk => sections.push(teamBlock(tk)));

  sections.push(`\n=== BLUE ALLIANCE (${blueNums.join(", ")}) ===`);
  match.blue.forEach(tk => sections.push(teamBlock(tk)));

  // ── Match-level analytics ──────────────────────────────────────────────────
  const ourTeams   = myAlliance ? (myAlliance === "red" ? match.red  : match.blue) : [];
  const enemyTeams = myAlliance ? (myAlliance === "red" ? match.blue : match.red)  : [];

  if (Object.keys(epaData).length && ourTeams.length && enemyTeams.length) {
    const avgOur  = (ourTeams.map(t  => epaData[t]?.epa || 0).reduce((a,b)=>a+b,0) / ourTeams.length).toFixed(1);
    const avgEnem = (enemyTeams.map(t => epaData[t]?.epa || 0).reduce((a,b)=>a+b,0) / enemyTeams.length).toFixed(1);
    sections.push(`\n=== STATBOTICS EPA ===`);
    sections.push(`Bizim: ${ourTeams.map(t=>`${teamNum(t)}(${epaData[t]?.epa??"-"})`).join(", ")} — ort. ${avgOur}`);
    sections.push(`Rakip: ${enemyTeams.map(t=>`${teamNum(t)}(${epaData[t]?.epa??"-"})`).join(", ")} — ort. ${avgEnem}`);
    sections.push(+avgOur >= +avgEnem ? "→ Biz EPA üstünüz." : "→ Rakip EPA üstün, dikkatli oynayalım.");
  }

  const collisions = detectAutoCollisions(match, scoutReports).filter(c => !c.sameAlliance);
  if (collisions.length) {
    sections.push(`\n=== OTONOM ÇARPIŞMA RİSKLERİ ===`);
    collisions.slice(0,3).forEach(c =>
      sections.push(`  frc${teamNum(c.teamA)} ↔ frc${teamNum(c.teamB)}: mesafe ${(c.dist*100).toFixed(0)}%, şiddet: ${c.severity}`)
    );
  }

  if (enemyTeams.length) {
    const carrier = findOpponentCarrier(enemyTeams, scoutReports);
    if (carrier?.avgActFuel > 0) {
      sections.push(`\n=== RAKİP TAŞIYICI & TIKALAMA NOKTASI ===`);
      sections.push(`Taşıyıcı: frc${teamNum(carrier.teamKey)} — ${carrier.avgActFuel}F aktif ort. (${carrier.n}m)`);
      const choke = findChokePoint(carrier.teamKey, scoutReports);
      if (choke) sections.push(`En sık geçiş: ${ZONE_LABEL[choke.zone]||choke.zone} — savunmayı buraya yoğunlaştır.`);
      const shoot = analyzeShootingPositions(carrier.teamKey, pitReports[carrier.teamKey], scoutReports);
      if (shoot?.verdict) sections.push(`Atış: ${shoot.verdict}`);
    }
  }

  if (ourTeams.length) {
    const routing = analyzeTrafficRouting(ourTeams, pitReports, scoutReports);
    sections.push(`\n=== TRAFİK & ROTA (BİZİM ALLIANCE) ===`);
    routing.forEach(r => sections.push(`  frc${teamNum(r.teamKey)}: ${r.note} → ${r.assignedRoute}`));

    const unreliable = getReliabilityRoles(ourTeams, pitReports, scoutReports).filter(r => r.isUnreliable);
    if (unreliable.length) {
      sections.push(`\n=== GÜVENİLMEZ PARTNERLER ===`);
      unreliable.forEach(r => sections.push(`  frc${teamNum(r.teamKey)}: ${r.role}`));
    }
  }

  sections.push(`
=== OYUN KURALLARI ÖZETİ (REBUILT 2026) ===
- FUEL: Hub'a yakıt atarak puan kazanılır (aktif hub'a 3p, inaktif hub'a 1p).
- AUTO (0-20s): Her iki hub aktif. Daha fazla yakıt atan alliance SHIFT 1'i kazanır.
- TRANSITION SHIFT (20-30s): Her iki hub aktif, geçiş dönemi.
- TELEOP SHIFTs (30-130s): HUB aktivitesi AUTO sonucuna göre değişir — kazanan alliance avantajlı periyotlar alır.
- BUMP: Robot yavaşlar veya takılır — geçiş zor ama rakibi engelleyebilir.
- TRENCH: Benzer engel, trench altından geçmek zaman alır.
- ENDGAME (130-160s): Tower Level (L1=10p, L2=20p, L3=30p), oto tırmanma (L1=15p bonus).
- Yakıt puanı sadece aktif hub'a atılırsa tam değer verir.
- Saha sol/sağ bump ile ikiye bölünmüş. Kendi alliance bump'ı kendi tarafında, rakip bump'ı karşı taraftadır.
`);

  sections.push(`
=== GÖREVİN ===
Yukarıdaki veriler — pit raporları, geçmiş maç istatistikleri ve **hareket/konum korelasyon analizleri** (hangi bumpı kullandıklarında ne kadar skoru var, hangi alliance'da daha iyi performans gösteriyorlar, otonom yön eğilimleri, sorun kalıpları) — kullanılarak ${myAlliance ? `${myAlliance.toUpperCase()} alliance için` : "her iki alliance için"} somut bir maç stratejisi üret.

Yanıtını şu başlıklarla ver:

1. **Tehdit Analizi** — Rakip allancedaki en tehlikeli robotlar kimler? Hangi bump'ı kullandıklarında tehlikeliler, hangisinde zayıflar?
2. **Bizim Planımız** — Her robotun rolü ne olmalı? Hareket analizi bize ne söylüyor?
3. **Bump & Trench Konuşlanması** — Spesifik olarak: rakibin güçlü olduğu bump'ı blokla, kendi güçlü bump'ını özgür bırak. Sol/sağ bump bazında konumlanma ver.
4. **Hub & Shift Stratejisi** — AUTO'da hangi hub'a yoğunlaşalım? Takımların hub-ağırlıklı vs bump-ağırlıklı performanslarına göre kimi nereye yönlendirmeliyiz?
5. **Risk & Uyarılar** — Tekrarlayan sorun tipleri, tutarsız robotlar, beklenmedik otonom yönleri.

Yanıt Türkçe olsun. Somut, kısa ve uygulanabilir. Her madde 2-4 cümle, gerektiğinde spesifik takım numaralarına atıf yap.`);

  return sections.join("\n");
}

// ─── CALL OPENAI ────────────────────────────────────────────────────────────
export async function generateStrategy({ apiKey, model, match, myTeam, pitReports, scoutReports, epaData = {} }) {
  if (!apiKey) throw new Error("NO_KEY");

  const userContent = buildPrompt({ match, myTeam, pitReports, scoutReports, epaData });
  const chosenModel = (model || DEFAULT_MODEL).trim();

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": window.location.origin,
      "X-Title": "FRC REBUILT Scouting",
    },
    body: JSON.stringify({
      model: chosenModel,
      messages: [
        {
          role: "system",
          content:
            "Sen FRC strateji asistanısın. Türkçe, net ve eyleme dönüştürülebilir yanıtlar ver. Gereksiz selamlama veya kapanış cümlesi kullanma.",
        },
        { role: "user", content: userContent },
      ],
      temperature: 0.4,
      max_tokens: 1200,
    }),
  });

  if (response.status === 401) throw new Error("INVALID_KEY");
  if (response.status === 402) throw new Error("NO_CREDITS");
  if (response.status === 429) throw new Error("RATE_LIMIT");
  if (!response.ok) throw new Error(`API_ERROR_${response.status}`);

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}
