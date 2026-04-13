/**
 * TeamProfileModal — detailed team drawer opened by clicking a team card in War Room.
 *
 * Tabs:
 *   Genel Bakış — full pit data + analytics
 *   Maçlar      — per-match history with auto path animation
 *   Notlar & AI — all scout notes + LLM summary (cached, staleness-aware)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getOpenRouterKey, getOpenRouterModel } from "../adminConfig";
import { analyzeTeam, ZONE_LABEL, classifyXY } from "../teamAnalytics";

const LS_SUMMARY = "teamSummaryCache"; // {[teamKey]: {text, generatedAt, matchCount}}

function loadSummaryCache() {
  try { return JSON.parse(localStorage.getItem(LS_SUMMARY)) || {}; }
  catch { return {}; }
}
function saveSummaryCache(c) { localStorage.setItem(LS_SUMMARY, JSON.stringify(c)); }

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function teamNum(key) { return (key || "").replace("frc", ""); }

// ─── ZONE COLOUR MAP ──────────────────────────────────────────────────────────
const ZONE_COLOR = {
  red_bump_top:    "#f87171", red_bump_bot:    "#f87171",
  blue_bump_top:   "#60a5fa", blue_bump_bot:   "#60a5fa",
  red_trench_top:  "#fb923c", red_trench_bot:  "#fb923c",
  blue_trench_top: "#818cf8", blue_trench_bot: "#818cf8",
  red_hub:         "#fca5a5", blue_hub:        "#93c5fd",
  center:          "#6b7280",
};

// ─── FIELD BACKGROUND ZONES (fallback when no field photo) ───────────────────
// EF convention: blue alliance LEFT (x<0.38), red alliance RIGHT (x>0.62)
// Zones derived from FIELD_DEFAULT in EyesFreeTerminal (640×320 canvas).
const FIELD_ZONES_FALLBACK = [
  // Blue bumps (left, x≈0.277–0.333)
  { x:0.257, y:0.18, w:0.09, h:0.27, c:"rgba(96,165,250,0.35)" },
  { x:0.257, y:0.55, w:0.09, h:0.27, c:"rgba(96,165,250,0.35)" },
  // Red bumps (right, x≈0.669–0.725)
  { x:0.652, y:0.18, w:0.09, h:0.27, c:"rgba(248,113,113,0.35)" },
  { x:0.652, y:0.55, w:0.09, h:0.27, c:"rgba(248,113,113,0.35)" },
  // Blue trenches (left)
  { x:0.257, y:0.00, w:0.09, h:0.25, c:"rgba(129,140,248,0.25)" },
  { x:0.257, y:0.75, w:0.09, h:0.25, c:"rgba(129,140,248,0.25)" },
  // Red trenches (right)
  { x:0.652, y:0.00, w:0.09, h:0.25, c:"rgba(251,146,60,0.25)" },
  { x:0.652, y:0.75, w:0.09, h:0.25, c:"rgba(251,146,60,0.25)" },
  // Blue hub (left-centre, cx≈0.306)
  { x:0.260, y:0.36, w:0.20, h:0.28, c:"rgba(147,197,253,0.22)" },
  // Red hub (right-centre, cx≈0.694)
  { x:0.540, y:0.36, w:0.20, h:0.28, c:"rgba(252,165,165,0.22)" },
  // Alliance zone tints (full height)
  { x:0.00,  y:0.00, w:0.24, h:1.00, c:"rgba(96,165,250,0.07)" },
  { x:0.76,  y:0.00, w:0.24, h:1.00, c:"rgba(248,113,113,0.07)" },
];

// Build an interpolatable keyframe list from report data
function buildKeyframes(report) {
  const autoRaw = (report.auto_path_points || []).map((p, i, arr) => ({
    x: p.x, y: p.y,
    t: p.t_ms ?? Math.round(i / (arr.length - 1 || 1) * 15000),
    phase: "auto",
  }));

  const pingRaw = (() => {
    const lp = (report.location_pings || []).filter(p => p.x != null && p.t_ms != null);
    if (lp.length) return lp;
    return (report.timeline || []).filter(e => e.action === "ping" && e.x != null && e.t_ms != null);
  })().map(p => ({ x: p.x, y: p.y, t: p.t_ms, phase: "teleop" }));

  return [...autoRaw, ...pingRaw].sort((a, b) => a.t - b.t);
}

function lerpPos(kf, tMs) {
  if (!kf.length) return null;
  if (tMs <= kf[0].t) return kf[0];
  const last = kf[kf.length - 1];
  if (tMs >= last.t) return last;
  for (let i = 0; i < kf.length - 1; i++) {
    if (tMs >= kf[i].t && tMs <= kf[i + 1].t) {
      const a = kf[i], b = kf[i + 1];
      // Don't interpolate across phase boundaries (e.g. auto→teleop gap).
      // Hold the robot at its last known position instead of sliding it.
      if (a.phase !== b.phase) return { ...a };
      const f = (tMs - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, phase: b.phase };
    }
  }
  return last;
}

function drawRobot(ctx, px, py, alliance, angle) {
  const R  = 9;
  const clr = alliance === "red" ? "#f87171" : "#60a5fa";
  const border = alliance === "red" ? "#fca5a5" : "#93c5fd";

  ctx.save();
  ctx.translate(px, py);
  if (angle != null) ctx.rotate(angle);

  // Body
  ctx.fillStyle = clr;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(-R, -R, R * 2, R * 2);
  ctx.fill();
  ctx.stroke();

  // Direction triangle (front = +x direction)
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(R + 5, 0);
  ctx.lineTo(R, -4);
  ctx.lineTo(R, 4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ─── MATCH REPLAY CANVAS ──────────────────────────────────────────────────────
function MatchReplayCanvas({ report, tMs, fieldImg }) {
  const canvasRef = useRef(null);
  const alliance  = (report.scout_device_id || "").startsWith("red") ? "red" : "blue";
  const kfRef     = useRef(buildKeyframes(report));

  useEffect(() => { kfRef.current = buildKeyframes(report); }, [report]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // ── Background ────────────────────────────────────────────────────────────
    if (fieldImg) {
      ctx.drawImage(fieldImg, 0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = "#0a0e1a";
      ctx.fillRect(0, 0, W, H);
      for (const z of FIELD_ZONES_FALLBACK) {
        ctx.fillStyle = z.c;
        ctx.fillRect(z.x * W, z.y * H, z.w * W, z.h * H);
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    const kf = kfRef.current;
    if (!kf.length) return;

    // ── Auto path reference line ───────────────────────────────────────────────
    const autoKf = kf.filter(p => p.phase === "auto");
    if (autoKf.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(autoKf[0].x * W, autoKf[0].y * H);
      for (let i = 1; i < autoKf.length; i++) ctx.lineTo(autoKf[i].x * W, autoKf[i].y * H);
      ctx.strokeStyle = "rgba(74,222,128,0.45)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Teleop ping trail (last 6 positions before tMs, fading) ───────────────
    const telKf = kf.filter(p => p.phase === "teleop" && p.t <= tMs);
    const trail  = telKf.slice(-6);
    for (let i = 0; i < trail.length - 1; i++) {
      const alpha = (i + 1) / trail.length * 0.5;
      ctx.beginPath();
      ctx.arc(trail[i].x * W, trail[i].y * H, 3 + i * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = alliance === "red"
        ? `rgba(248,113,113,${alpha})`
        : `rgba(96,165,250,${alpha})`;
      ctx.fill();
    }

    // ── Phase label ───────────────────────────────────────────────────────────
    const phase = tMs < 15000 ? "AUTO" : tMs < 30000 ? "GEÇİŞ" : "TELEOP";
    ctx.font = "bold 9px monospace";
    ctx.fillStyle = phase === "AUTO" ? "#4ade80" : phase === "GEÇİŞ" ? "#fbbf24" : "#94a3b8";
    ctx.fillText(phase, 5, 11);

    // ── Robot position ─────────────────────────────────────────────────────────
    const pos = lerpPos(kf, tMs);
    if (!pos) return;

    // Compute heading from last two keyframes near tMs
    let angle = null;
    const nearby = kf.filter(p => p.t <= tMs);
    if (nearby.length >= 2) {
      const a = nearby[nearby.length - 2], b = nearby[nearby.length - 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) > 0.005 || Math.abs(dy) > 0.005) {
        angle = Math.atan2(dy * H, dx * W);
      }
    }

    drawRobot(ctx, pos.x * W, pos.y * H, alliance, angle);
  }, [report, tMs, fieldImg, alliance]);

  return (
    <canvas ref={canvasRef} width={480} height={240} className="tp-auto-canvas" />
  );
}

// ─── MATCH PLAYER ─────────────────────────────────────────────────────────────
function MatchPlayer({ report }) {
  const [tMs,     setTMs]     = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed,   setSpeed]   = useState(4);
  const [fieldImg, setFieldImg] = useState(null);
  const rafRef       = useRef(null);
  const lastRealRef  = useRef(null);
  const playingRef   = useRef(false);

  const kf      = buildKeyframes(report);
  const totalMs = kf.length ? kf[kf.length - 1].t : 15000;

  // Load field image once
  useEffect(() => {
    const src = localStorage.getItem("fieldCalibImage");
    if (!src) return;
    const img = new Image();
    img.onload = () => setFieldImg(img);
    img.src = src;
  }, []);

  // rAF loop
  useEffect(() => {
    playingRef.current = playing;
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      lastRealRef.current = null;
      return;
    }
    function tick(now) {
      if (!playingRef.current) return;
      if (lastRealRef.current != null) {
        const delta = (now - lastRealRef.current) * speed;
        setTMs(prev => {
          const next = prev + delta;
          if (next >= totalMs) {
            playingRef.current = false;
            setPlaying(false);
            return totalMs;
          }
          return next;
        });
      }
      lastRealRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed, totalMs]);

  const reset = useCallback(() => {
    setPlaying(false);
    setTMs(0);
    lastRealRef.current = null;
  }, []);

  const fmtMs = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  if (!kf.length) return <div className="tp-no-auto">Hareket verisi yok.</div>;

  return (
    <div className="tp-auto-player">
      <MatchReplayCanvas report={report} tMs={tMs} fieldImg={fieldImg} />
      <input
        type="range" className="tp-scrubber"
        min={0} max={totalMs} step={100} value={Math.round(tMs)}
        onChange={e => { setPlaying(false); setTMs(+e.target.value); }}
      />
      <div className="tp-auto-controls">
        <button className="tp-play-btn" onClick={() => {
          if (tMs >= totalMs) { setTMs(0); }
          setPlaying(p => !p);
        }}>
          {playing ? "⏸" : tMs >= totalMs ? "↩ Tekrar" : "▶ Oynat"}
        </button>
        <button className="tp-play-btn" onClick={reset}>↩ Sıfırla</button>
        <select className="tp-speed-sel" value={speed} onChange={e => setSpeed(+e.target.value)}>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
          <option value={8}>8×</option>
          <option value={16}>16×</option>
        </select>
        <span className="tp-frame-lbl">{fmtMs(tMs)} / {fmtMs(totalMs)}</span>
      </div>
    </div>
  );
}

// ─── MATCH ROW ────────────────────────────────────────────────────────────────
function MatchRow({ report }) {
  const [open, setOpen] = useState(false);
  const alliance = (report.scout_device_id || "").startsWith("red") ? "red" : "blue";
  const qNum = report.match_key?.split("_qm")[1] || "?";
  const fuel  = (report.auto_fuel_scored || 0)
    + (report.teleop_fuel_scored_active || 0)
    + (report.teleop_fuel_scored_inactive || 0);
  const problems = [
    ...((report.timeline || []).filter(e => e.action === "problem").map(e => e.key)),
    ...(report.problems || []),
  ];
  const climb = report.tower_level || "none";

  // Zone distribution from pings
  const zoneCounts = {};
  for (const p of (report.location_pings || [])) {
    const z = p.x != null ? classifyXY(p.x, p.y) : (p.zone || "center");
    zoneCounts[z] = (zoneCounts[z] || 0) + 1;
  }
  const topZones = Object.entries(zoneCounts).sort((a,b)=>b[1]-a[1]).slice(0,3);

  return (
    <div className="tp-match-row">
      <button className="tp-match-head" onClick={() => setOpen(o => !o)}>
        <span className={`tp-alliance-dot tp-dot-${alliance}`} />
        <span className="tp-match-num">Q{qNum}</span>
        <span className="tp-match-fuel">{fuel}F</span>
        {climb !== "none" && <span className="tp-match-climb">{climb}</span>}
        {problems.length > 0 && (
          <span className="tp-match-problems">
            {[...new Set(problems)].map(p => p.toUpperCase()).join(" · ")}
          </span>
        )}
        <span className="tp-match-chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="tp-match-detail">
          {/* Match replay */}
          <div className="tp-match-section-title">Maç Tekrarı (Auto + Teleop)</div>
          <MatchPlayer report={report} />

          {/* Zone distribution */}
          {topZones.length > 0 && (
            <>
              <div className="tp-match-section-title" style={{ marginTop: "0.6rem" }}>Konum Dağılımı</div>
              <div className="tp-zone-bars">
                {topZones.map(([z, c]) => {
                  const total = Object.values(zoneCounts).reduce((a,b)=>a+b,0) || 1;
                  return (
                    <div key={z} className="tp-zone-bar-row">
                      <span className="tp-zone-label">{ZONE_LABEL[z] || z}</span>
                      <div className="tp-zone-bar-bg">
                        <div className="tp-zone-bar-fill"
                          style={{ width: `${(c/total*100).toFixed(0)}%`, background: ZONE_COLOR[z] || "#6b7280" }} />
                      </div>
                      <span className="tp-zone-pct">{(c/total*100).toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Fuel breakdown */}
          <div className="tp-match-section-title" style={{ marginTop: "0.6rem" }}>Yakıt Detayı</div>
          <div className="tp-fuel-grid">
            <div><span>Auto</span><strong>{report.auto_fuel_scored || 0}F</strong></div>
            <div><span>Aktif hub</span><strong>{report.teleop_fuel_scored_active || 0}F</strong></div>
            <div><span>İnaktif hub</span><strong>{report.teleop_fuel_scored_inactive || 0}F</strong></div>
          </div>

          {/* Notes */}
          {report.notes && (
            <>
              <div className="tp-match-section-title" style={{ marginTop: "0.6rem" }}>Not</div>
              <p className="tp-note-text">"{report.notes}"</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AI SUMMARY ───────────────────────────────────────────────────────────────
async function generateTeamSummary({ teamKey, pit, reports, analysis, apiKey, model }) {
  if (!apiKey) throw new Error("NO_KEY");

  const num = teamNum(teamKey);
  const allNotes = reports.map(r => r.notes).filter(Boolean);

  const pitLines = [];
  if (pit) {
    const fields = ["drive","driveMotor","shootRange","climbTeleop","climbAuto",
      "bump","trench","defense","consistency","autoFuel","teleopFuel","carrierCap"];
    for (const f of fields) {
      if (pit[f] != null && pit[f] !== "" && pit[f] !== false)
        pitLines.push(`${f}: ${pit[f]}`);
    }
  }

  const prompt = `Sen FRC 2026 REBUILT yarışmasında görevli bir kıdemli strateji analistsin.

Takım frc${num} hakkında aşağıdaki veriler mevcut:

=== PİT RAPORU ===
${pitLines.length ? pitLines.join("\n") : "Pit verisi yok."}

=== PERFORMANS ANALİZİ (${analysis?.n || 0} maç) ===
Ort. yakıt: ${analysis?.avgFuelTotal ?? "?"} | Tutarlılık: ${analysis?.scoreConsistency ?? "?"} | SD: ${analysis?.fuelSd ?? "?"}
Kendi bumpu kullanınca: ${analysis?.bumpCorr?.ownBump?.avgFuel ?? "?"}F, bumpsız: ${analysis?.bumpCorr?.noBumps?.avgFuel ?? "?"}F
Hub-ağırlıklı maçlar: ${analysis?.hubVsBump?.hubHeavy?.avgFuel ?? "?"}F | Bump-ağırlıklı: ${analysis?.hubVsBump?.bumpHeavy?.avgFuel ?? "?"}F
Kırmızı allianc: ${analysis?.allianceFuel?.red ?? "?"}F | Mavi allianc: ${analysis?.allianceFuel?.blue ?? "?"}F
Otonom eğilim: ${analysis?.autoPathTendency ?? "?"}
Sorunlar (%${analysis?.matchesWithProblemsPct ?? 0} maçta): ${analysis?.topProblems?.map(p=>`${p.type.toUpperCase()}(%${p.pct})`).join(", ") || "yok"}
Tırmanma: L1×${analysis?.climbSummary?.l1 ?? 0}, L2×${analysis?.climbSummary?.l2 ?? 0}, L3×${analysis?.climbSummary?.l3 ?? 0}

=== SAHACILARIN NOTLARI ===
${allNotes.length ? allNotes.map((n,i) => `${i+1}. "${n}"`).join("\n") : "Not girilmemiş."}

Görev: Bu takım hakkında kısa ama kapsamlı bir scout özeti yaz. Türkçe ol. Şu başlıkları kullan:

**Güçlü Yanlar** — 1-2 cümle.
**Zayıf Yanlar / Riskler** — 1-2 cümle.
**Önerilen Rol** — Bu takımla ittifak kurulacaksa ona ne görevi vermeli? 1 cümle.
**Dikkat Noktaları** — Saha gözlemcilerinin öne çıkardığı özel durumlar. 1-2 cümle.

Mümkün olduğunca spesifik ol, soyut kalma.`;

  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": window.location.origin,
      "X-Title": "FRC REBUILT Scouting",
    },
    body: JSON.stringify({
      model: (model || "x-ai/grok-4-fast").trim(),
      messages: [
        { role: "system", content: "Sen FRC strateji asistanısın. Türkçe, özlü ve eyleme dönüştürülebilir yanıtlar ver." },
        { role: "user", content: prompt },
      ],
      temperature: 0.35,
      max_tokens: 600,
    }),
  });

  if (resp.status === 401) throw new Error("INVALID_KEY");
  if (resp.status === 402) throw new Error("NO_CREDITS");
  if (resp.status === 429) throw new Error("RATE_LIMIT");
  if (!resp.ok) throw new Error(`API_ERROR_${resp.status}`);

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── NOTES & AI TAB ───────────────────────────────────────────────────────────
function NotesAiTab({ teamKey, pit, reports, analysis, summaryCache, onSummarySaved }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const cached = summaryCache[teamKey];
  const hasNew = cached && reports.length > cached.matchCount;

  async function handleGenerate() {
    setError(null);
    setLoading(true);
    try {
      const apiKey = getOpenRouterKey();
      const model  = getOpenRouterModel();
      const text   = await generateTeamSummary({ teamKey, pit, reports, analysis, apiKey, model });
      const entry  = { text, generatedAt: Date.now(), matchCount: reports.length };
      onSummarySaved(teamKey, entry);
    } catch (err) {
      const msg = err.message === "NO_KEY"      ? "OpenRouter key girilmedi. Admin → ⚙️ Ayarlar." :
                  err.message === "INVALID_KEY" ? "OpenRouter key geçersiz." :
                  err.message === "NO_CREDITS"  ? "OpenRouter bakiyesi yetersiz." :
                  err.message === "RATE_LIMIT"  ? "Rate limit — bekle." :
                  `Hata: ${err.message}`;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const allNotes = reports.map((r, i) => ({
    matchKey: r.match_key,
    note: r.notes,
    problems: [...((r.timeline||[]).filter(e=>e.action==="problem").map(e=>e.key)), ...(r.problems||[])],
    qNum: r.match_key?.split("_qm")[1] || "?",
  })).filter(r => r.note || r.problems.length);

  return (
    <div className="tp-notes-tab">
      {/* Scout notes list */}
      <div className="tp-notes-section">
        <div className="tp-section-title">📝 Sahacı Notları</div>
        {allNotes.length === 0 && <p className="tp-empty">Henüz not girilmemiş.</p>}
        {allNotes.map((r, i) => (
          <div key={i} className="tp-note-item">
            <span className="tp-note-match">Q{r.qNum}</span>
            {r.problems.length > 0 && (
              <span className="tp-note-probs">{[...new Set(r.problems)].map(p=>p.toUpperCase()).join(" · ")}</span>
            )}
            {r.note && <p className="tp-note-text">"{r.note}"</p>}
          </div>
        ))}
      </div>

      {/* AI Summary */}
      <div className="tp-ai-summary-section">
        <div className="tp-section-title" style={{ display:"flex", alignItems:"center", gap:"0.5rem" }}>
          🤖 AI Özet
          {hasNew && (
            <span className="tp-new-badge">
              +{reports.length - cached.matchCount} yeni maç
            </span>
          )}
          {cached && !hasNew && (
            <span className="tp-stale-ok">Güncel</span>
          )}
        </div>

        <div className="tp-summary-actions">
          <button className="tp-gen-btn" disabled={loading} onClick={handleGenerate}>
            {loading ? "⏳ Üretiliyor…"
              : cached ? (hasNew ? "🔄 Yeni Veriyle Güncelle" : "🔄 Yeniden Üret")
              : "⚡ Özet Üret"}
          </button>
          {cached && (
            <span className="tp-gen-date">
              {new Date(cached.generatedAt).toLocaleString("tr-TR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}
              {" "}· {cached.matchCount} maçla üretildi
            </span>
          )}
        </div>

        {error && <div className="tp-summary-error">{error}</div>}
        {loading && <div className="tp-summary-loading"><span className="wr-ai-spinner" />AI analiz yapıyor…</div>}

        {!loading && cached?.text && (
          <div className="tp-summary-text">
            {cached.text.split("\n").map((line, i) => {
              if (!line.trim()) return <br key={i} />;
              const html = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
              const isH  = /^\*\*/.test(line.trim());
              return (
                <p key={i}
                  className={isH ? "tp-sum-heading" : "tp-sum-para"}
                  dangerouslySetInnerHTML={{ __html: html }} />
              );
            })}
          </div>
        )}

        {!loading && !cached && !error && (
          <p className="tp-empty">Özet henüz üretilmedi. "{teamKey}" için tüm notlar ve analitik veriler kullanılarak kısa bir scout raporu oluşturulur.</p>
        )}
      </div>
    </div>
  );
}

// ─── OVERVIEW TAB ─────────────────────────────────────────────────────────────
function OverviewTab({ pit, analysis, epaEntry }) {
  const inspStatusLabel = {
    passed: "✓ Geçti", failed: "✗ Kaldı", pending: "⏳ Bekliyor",
  };
  const pitFields = [
    ["Sürüş", pit?.drive],
    ["Motor", pit?.driveMotor],
    ["Şut", pit?.shootRange],
    ["Teleop Tırmanma", pit?.climbTeleop],
    ["Auto Tırmanma", pit?.climbAuto],
    ["Bump Geçişi", pit?.bump ? "Evet" : pit ? "Hayır" : null],
    ["Trench Geçişi", pit?.trench ? "Evet" : pit ? "Hayır" : null],
    ["Defans", pit?.defense],
    ["Güvenilirlik", pit?.consistency],
    ["Auto Yakıt (tahmin)", pit?.autoFuel != null ? `${pit.autoFuel}F` : null],
    ["Teleop Yakıt (tahmin)", pit?.teleopFuel != null ? `${pit.teleopFuel}F` : null],
    ["Taşıma Kapasitesi", pit?.carrierCap != null ? `${pit.carrierCap} adet` : null],
    ["⚖️ Başlangıç Ağırlığı", pit?.inspectionWeight ? `${pit.inspectionWeight} kg` : null],
    ["🔎 İnspeksiyon", pit?.inspectionStatus ? inspStatusLabel[pit.inspectionStatus] : null],
  ].filter(([, v]) => v != null);

  const climbIcons = { L1:"🟡", L2:"🟠", L3:"🔴", none:"—" };

  return (
    <div className="tp-overview-tab">
      {/* Statbotics EPA */}
      {epaEntry && (
        <div className="tp-section">
          <div className="tp-section-title">📊 Statbotics EPA</div>
          <div className="tp-analytics-grid" style={{ gridTemplateColumns:"repeat(3,1fr)" }}>
            <div className="tp-ana-card">
              <span className="tp-ana-num">{epaEntry.epa}</span>
              <span className="tp-ana-lbl">Ort. EPA</span>
            </div>
            {epaEntry.epaSd != null && (
              <div className="tp-ana-card">
                <span className="tp-ana-num">±{epaEntry.epaSd}</span>
                <span className="tp-ana-lbl">SD</span>
              </div>
            )}
            {epaEntry.rank != null && (
              <div className="tp-ana-card">
                <span className="tp-ana-num">#{epaEntry.rank}{epaEntry.numTeams ? `/${epaEntry.numTeams}` : ""}</span>
                <span className="tp-ana-lbl">Sıralama</span>
              </div>
            )}
          </div>
          {epaEntry.wins != null && (
            <p style={{ fontSize:"0.65rem", color:"var(--muted)", margin:"0.3rem 0 0" }}>
              Qual rekor: {epaEntry.wins}G–{epaEntry.losses}K · %{epaEntry.winrate} kazanma
            </p>
          )}
        </div>
      )}

      {/* Pit data */}
      {pit ? (
        <div className="tp-section">
          <div className="tp-section-title">🔧 Pit Raporu</div>
          <div className="tp-pit-grid">
            {pitFields.map(([label, val]) => (
              <div key={label} className="tp-pit-row">
                <span className="tp-pit-label">{label}</span>
                <span className="tp-pit-val">{val}</span>
              </div>
            ))}
          </div>
          {pit.notes && <p className="tp-note-text" style={{marginTop:"0.5rem"}}>"{pit.notes}"</p>}
          {pit.inspectionNotes && (
            <p className="tp-note-text" style={{marginTop:"0.3rem", color:"#fbbf24"}}>
              🔎 "{pit.inspectionNotes}"
            </p>
          )}
        </div>
      ) : (
        <p className="tp-empty">Pit verisi yok.</p>
      )}

      {/* Analytics */}
      {analysis && (
        <div className="tp-section">
          <div className="tp-section-title">📊 Performans Özeti ({analysis.n} maç)</div>
          <div className="tp-analytics-grid">
            <div className="tp-ana-card">
              <span className="tp-ana-num">{analysis.avgFuelTotal}F</span>
              <span className="tp-ana-lbl">Ort. Yakıt</span>
            </div>
            <div className="tp-ana-card">
              <span className="tp-ana-num">±{analysis.fuelSd}</span>
              <span className="tp-ana-lbl">SD</span>
            </div>
            <div className="tp-ana-card">
              <span className="tp-ana-num">{analysis.allianceFuel.red ?? "—"}F</span>
              <span className="tp-ana-lbl">🔴 Kırmızı</span>
            </div>
            <div className="tp-ana-card">
              <span className="tp-ana-num">{analysis.allianceFuel.blue ?? "—"}F</span>
              <span className="tp-ana-lbl">🔵 Mavi</span>
            </div>
          </div>

          {/* Bump correlation */}
          <div className="tp-corr-rows">
            <div className="tp-section-title" style={{ marginTop:"0.6rem" }}>Bump / Hub Korelasyonu</div>
            {[
              ["Kendi bumpı", analysis.bumpCorr.ownBump],
              ["Rakip bumpu", analysis.bumpCorr.oppBump],
              ["Bumpsız", analysis.bumpCorr.noBumps],
              ["Hub-ağırlıklı", analysis.hubVsBump.hubHeavy],
              ["Bump-ağırlıklı", analysis.hubVsBump.bumpHeavy],
            ].filter(([,v]) => v?.n > 0).map(([label, v]) => (
              <div key={label} className="tp-corr-row">
                <span className="tp-corr-label">{label} ({v.n}m)</span>
                <div className="tp-corr-bar-bg">
                  <div className="tp-corr-bar" style={{ width: `${Math.min(100, (v.avgFuel || 0) * 1.5)}%` }} />
                </div>
                <span className="tp-corr-val">{v.avgFuel ?? "—"}F</span>
              </div>
            ))}
          </div>

          {/* Traversal zone breakdown */}
          {(analysis.totalBumpTraversals > 0 || analysis.totalTrenchTraversals > 0) && (
            <div>
              <div className="tp-section-title" style={{ marginTop:"0.6rem" }}>
                🛤 Geçiş Bölgesi Dağılımı
              </div>
              {analysis.totalBumpTraversals > 0 && (
                <div className="tp-trav-group">
                  <div className="tp-trav-label">BUMP ({analysis.totalBumpTraversals}×)</div>
                  {Object.entries(analysis.bumpZoneCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([z, cnt]) => {
                      const fuel = analysis.bumpZoneAvgFuel[z];
                      const pct  = Math.round(cnt / analysis.totalBumpTraversals * 100);
                      return (
                        <div key={z} className="tp-trav-row">
                          <span className="tp-trav-zone">{z.replace(/_/g," ").replace("red","K").replace("blue","M")}</span>
                          <div className="tp-trav-bar-bg">
                            <div className="tp-trav-bar" style={{ width:`${pct}%` }} />
                          </div>
                          <span className="tp-trav-cnt">{cnt}× {fuel != null ? `· ${fuel}F` : ""}</span>
                        </div>
                      );
                    })}
                </div>
              )}
              {analysis.totalTrenchTraversals > 0 && (
                <div className="tp-trav-group" style={{ marginTop:"0.4rem" }}>
                  <div className="tp-trav-label">TRENCH ({analysis.totalTrenchTraversals}×)</div>
                  {Object.entries(analysis.trenchZoneCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([z, cnt]) => {
                      const fuel = analysis.trenchZoneAvgFuel[z];
                      const pct  = Math.round(cnt / analysis.totalTrenchTraversals * 100);
                      return (
                        <div key={z} className="tp-trav-row">
                          <span className="tp-trav-zone">{z.replace(/_/g," ").replace("red","K").replace("blue","M")}</span>
                          <div className="tp-trav-bar-bg">
                            <div className="tp-trav-bar tp-trav-bar--trench" style={{ width:`${pct}%` }} />
                          </div>
                          <span className="tp-trav-cnt">{cnt}× {fuel != null ? `· ${fuel}F` : ""}</span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* Climb */}
          {analysis.climbSummary.attempts > 0 && (
            <div className="tp-climb-row">
              <div className="tp-section-title" style={{ marginTop:"0.6rem" }}>Tırmanma Geçmişi</div>
              {[["L1", analysis.climbSummary.l1], ["L2", analysis.climbSummary.l2], ["L3", analysis.climbSummary.l3]]
                .filter(([,n]) => n > 0)
                .map(([lv, n]) => (
                  <span key={lv} className="tp-climb-chip">{climbIcons[lv]} {lv} ×{n}</span>
                ))}
            </div>
          )}

          {/* Problems */}
          {analysis.topProblems.length > 0 && (
            <div>
              <div className="tp-section-title" style={{ marginTop:"0.6rem" }}>Sorunlar</div>
              <div className="tp-problem-chips">
                {analysis.topProblems.map(p => (
                  <span key={p.type} className="tp-problem-chip">
                    {p.type.toUpperCase()} — %{p.pct} ({p.count}×)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MAIN MODAL ───────────────────────────────────────────────────────────────
export default function TeamProfileModal({ teamKey, pitReports, scoutReports, epaEntry, onClose }) {
  const [tab, setTab] = useState("overview");
  const [summaryCache, setSummaryCache] = useState(loadSummaryCache);

  const pit      = pitReports[teamKey] || null;
  const reports  = scoutReports.filter(r => r.team_key === teamKey)
    .sort((a, b) => {
      const qa = parseInt(a.match_key?.split("_qm")[1]) || 0;
      const qb = parseInt(b.match_key?.split("_qm")[1]) || 0;
      return qb - qa; // newest first
    });
  const analysis = analyzeTeam(teamKey, scoutReports);
  const num      = teamNum(teamKey);

  function handleSummarySaved(tk, entry) {
    const next = { ...summaryCache, [tk]: entry };
    setSummaryCache(next);
    saveSummaryCache(next);
  }

  // Close on Escape
  useEffect(() => {
    const fn = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const cached = summaryCache[teamKey];
  const hasNew = cached && reports.length > cached.matchCount;

  return (
    <>
      {/* Backdrop */}
      <div className="tp-backdrop" onClick={onClose} />

      {/* Drawer */}
      <div className="tp-drawer">
        {/* Header */}
        <div className="tp-drawer-head">
          <div className="tp-drawer-title">
            <a href={`https://www.thebluealliance.com/team/${num}`}
              target="_blank" rel="noreferrer" className="tp-tba-link">
              frc{num}
            </a>
            {pit?.consistency && (
              <span className={`wr-reliability ${
                pit.consistency === "Çok Güvenilir" ? "rel-hi" :
                pit.consistency === "Güvenilir"     ? "rel-ok" :
                pit.consistency === "Orta"          ? "rel-mid" : "rel-lo"
              }`}>{pit.consistency}</span>
            )}
            {hasNew && <span className="tp-new-badge">+{reports.length - cached.matchCount} yeni maç</span>}
          </div>
          <button className="tp-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="tp-tabs">
          {[
            ["overview", "📋 Genel"],
            ["matches",  `🎮 Maçlar (${reports.length})`],
            ["notes",    `📝 Notlar & AI`],
          ].map(([k, label]) => (
            <button key={k} className={`tp-tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="tp-content">
          {tab === "overview" && <OverviewTab pit={pit} analysis={analysis} epaEntry={epaEntry} />}
          {tab === "matches"  && (
            <div className="tp-matches-tab">
              {reports.length === 0 && <p className="tp-empty">Saha raporu yok.</p>}
              {reports.map(r => <MatchRow key={r.match_key + r.scout_device_id} report={r} />)}
            </div>
          )}
          {tab === "notes" && (
            <NotesAiTab
              teamKey={teamKey}
              pit={pit}
              reports={reports}
              analysis={analysis}
              summaryCache={summaryCache}
              onSummarySaved={handleSummarySaved}
            />
          )}
        </div>
      </div>
    </>
  );
}
