import { useEffect, useRef, useState } from "react";

import { getAdminConfig, getEventKey, tbaParams } from "../adminConfig";

const API_BASE   = "http://localhost:8001";
const SEATS      = ["red1", "red2", "red3", "blue1", "blue2", "blue3"];
const SPEEDS     = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const ZOOMS      = [1, 1.5, 2, 2.5, 3];
const QUALITIES  = [
  { key: "default", label: "Oto",   vq: ""       },
  { key: "small",   label: "240p",  vq: "small"  },
  { key: "medium",  label: "360p",  vq: "medium" },
  { key: "large",   label: "480p",  vq: "large"  },
  { key: "hd720",   label: "720p",  vq: "hd720"  },
  { key: "hd1080",  label: "1080p", vq: "hd1080" },
];
const COMP_FILTERS = [
  { key: "all", label: "Tümü"  },
  { key: "qm",  label: "Quals" },
  { key: "sf",  label: "Semis" },
  { key: "f",   label: "Final" },
];

function matchLabel(m) {
  if (m.comp_level === "qm") return `Q${m.match_number}`;
  if (m.comp_level === "sf") return `SF${m.set_number}-M${m.match_number}`;
  if (m.comp_level === "f")  return `F${m.match_number}`;
  return m.match_key;
}

// ── YouTube IFrame API loader (idempotent) ────────────────────────────────────
let ytApiLoaded    = false;
let ytApiCallbacks = [];
function loadYTApi(cb) {
  if (window.YT?.Player) { cb(); return; }
  ytApiCallbacks.push(cb);
  if (ytApiLoaded) return;
  ytApiLoaded = true;
  const tag = document.createElement("script");
  tag.src   = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = () => {
    ytApiCallbacks.forEach((fn) => fn());
    ytApiCallbacks = [];
  };
}

// ── Force quality — call repeatedly until it sticks ──────────────────────────
function forceQuality(player, qKey) {
  if (!player || qKey === "default") return;
  player.setPlaybackQuality(qKey);
  // YouTube sometimes reverts; hammer it a few times
  [200, 600, 1400].forEach((ms) =>
    setTimeout(() => player?.setPlaybackQuality?.(qKey), ms)
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function VideoScoutPanel() {
  const [eventKey,    setEventKey]    = useState(getEventKey);
  const [config,      setConfig]      = useState(getAdminConfig);
  const [matches,     setMatches]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [compFilter,  setCompFilter]  = useState("all");
  const [selected,    setSelected]    = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Player
  const playerRef    = useRef(null);
  const playerDivRef = useRef(null);
  const overlayRef   = useRef(null);
  const [speed,      setSpeed]   = useState(1);
  const [zoom,       setZoom]    = useState(1);
  const [quality,    setQuality] = useState("default");
  const [panMode,    setPanMode] = useState(false);
  const [pan,        setPan]     = useState({ x: 0, y: 0 });
  const panDragRef   = useRef(null);
  const [playing,    setPlaying] = useState(false);

  // Fuel + shoot tracking
  const [entries,       setEntries]      = useState(() => SEATS.map((s) => ({ seat: s, fuelScored: "", maxCarried: "", shoots: [] })));
  const [shootState,    setShootState]   = useState({});   // { seat: startTimeSec }
  const [matchStartSec, setMatchStartSec] = useState(null); // video timestamp when match started
  const [submitStatus,  setSubmitStatus] = useState("");

  // ── Admin config sync ────────────────────────────────────────────────────────
  useEffect(() => {
    const fn = () => {
      const cfg = getAdminConfig();
      setConfig(cfg);
      setEventKey(cfg.eventKey || "2026miket");
      setSelected(null); setMatches([]);
    };
    window.addEventListener("adminConfigChanged", fn);
    return () => window.removeEventListener("adminConfigChanged", fn);
  }, []);

  // ── Fetch all matches ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!eventKey) return;
    setLoading(true);
    fetch(`${API_BASE}/events/${eventKey}/all-matches${tbaParams()}`)
      .then((r) => r.json())
      .then((d) => setMatches(Array.isArray(d) ? d : []))
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));
  }, [eventKey, config]);

  // ── Select match ─────────────────────────────────────────────────────────────
  function selectMatch(m) {
    setSelected(m);
    setZoom(1); setPan({ x: 0, y: 0 }); setPanMode(false); setPlaying(false);
    setEntries(SEATS.map((s) => ({ seat: s, fuelScored: "", maxCarried: "", shoots: [] })));
    setShootState({});
    setMatchStartSec(null);
    setSubmitStatus("");
  }

  // ── YouTube player: init or switch video ──────────────────────────────────────
  useEffect(() => {
    if (!selected?.youtube_key) return;
    const videoId = selected.youtube_key;
    const qKey    = quality;

    loadYTApi(() => {
      if (playerRef.current) {
        playerRef.current.loadVideoById(videoId);
        playerRef.current.pauseVideo();
        forceQuality(playerRef.current, qKey);
        setPlaying(false);
        return;
      }
      playerRef.current = new window.YT.Player(playerDivRef.current, {
        videoId,
        width:  "100%",
        height: "100%",
        playerVars: {
          controls:       0,
          disablekb:      1,
          modestbranding: 1,
          rel:            0,
          fs:             0,
          iv_load_policy: 3,
          vq:             qKey !== "default" ? qKey : undefined,
        },
        events: {
          onReady: (e) => {
            e.target.setPlaybackRate(speed);
            e.target.pauseVideo();
            forceQuality(e.target, qKey);
          },
          onStateChange: (e) => {
            setPlaying(e.data === window.YT.PlayerState.PLAYING);
            // Re-apply quality every time playback state changes
            forceQuality(e.target, qKey);
          },
        },
      });
    });
  }, [selected?.youtube_key]);

  // ── Speed ─────────────────────────────────────────────────────────────────────
  function applySpeed(s) {
    setSpeed(s);
    playerRef.current?.setPlaybackRate?.(s);
  }

  // ── Quality — force aggressively ──────────────────────────────────────────────
  function applyQuality(q) {
    setQuality(q);
    forceQuality(playerRef.current, q);
  }

  // ── Play / pause ──────────────────────────────────────────────────────────────
  function togglePlay() {
    if (!playerRef.current) return;
    if (playing) playerRef.current.pauseVideo();
    else         playerRef.current.playVideo();
  }

  // ── Seek ──────────────────────────────────────────────────────────────────────
  function seek(delta) {
    if (!playerRef.current?.getCurrentTime) return;
    playerRef.current.seekTo(playerRef.current.getCurrentTime() + delta, true);
  }

  // ── Pan drag ──────────────────────────────────────────────────────────────────
  function onOverlayDown(e) {
    if (!panMode) return;
    const pt = e.touches?.[0] ?? e;
    panDragRef.current = { startX: pt.clientX - pan.x, startY: pt.clientY - pan.y };
  }
  function onOverlayMove(e) {
    if (!panMode || !panDragRef.current) return;
    const pt = e.touches?.[0] ?? e;
    setPan({ x: pt.clientX - panDragRef.current.startX, y: pt.clientY - panDragRef.current.startY });
  }
  function onOverlayUp() { panDragRef.current = null; }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function getVideoTime() {
    return playerRef.current?.getCurrentTime?.() ?? null;
  }

  function fmtSec(s) {
    if (s == null) return "";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function markMatchStart() {
    const t = getVideoTime();
    if (t !== null) setMatchStartSec(+t.toFixed(2));
  }

  function shootStart(seat) {
    const t = getVideoTime();
    if (t === null) return;
    setShootState((prev) => ({ ...prev, [seat]: t }));
  }

  function shootEnd(seat) {
    const endT   = getVideoTime();
    const startT = shootState[seat];
    if (endT === null || startT == null) return;
    setEntries((prev) => prev.map((e) =>
      e.seat === seat
        ? { ...e, shoots: [...e.shoots, { start: +startT.toFixed(2), end: +endT.toFixed(2) }] }
        : e
    ));
    setShootState((prev) => { const n = { ...prev }; delete n[seat]; return n; });
  }

  // ── Fuel submit ───────────────────────────────────────────────────────────────
  async function submitFuel() {
    if (!selected) { setSubmitStatus("Önce maç seç."); return; }
    setSubmitStatus("Kaydediliyor...");

    // Seat → team_key mapping
    const seatToTeam = (seat) => {
      const pos = parseInt(seat.slice(-1)) - 1;
      if (seat.startsWith("red"))  return selected.red[pos]  || null;
      if (seat.startsWith("blue")) return selected.blue[pos] || null;
      return null;
    };

    // Persist fuel data locally so War Room analytics can use it
    try {
      const stored = JSON.parse(localStorage.getItem("videoFuelData") || "{}");
      if (!stored[selected.match_key]) stored[selected.match_key] = {};
      entries.forEach((e) => {
        const tk = seatToTeam(e.seat);
        if (!tk) return;
        stored[selected.match_key][tk] = {
          fuel_scored: parseInt(e.fuelScored) || 0,
          max_carried: parseInt(e.maxCarried) || 0,
        };
      });
      localStorage.setItem("videoFuelData", JSON.stringify(stored));
      window.dispatchEvent(new Event("videoFuelChanged"));
    } catch { /* localStorage failure non-fatal */ }

    try {
      const r = await fetch(`${API_BASE}/video-scout/fuel-entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_key:       selected.match_key,
          match_start_sec: matchStartSec,
          entries: entries.map((e) => ({
            seat:        e.seat,
            fuel_scored: parseInt(e.fuelScored) || 0,
            max_carried: parseInt(e.maxCarried) || 0,
            note:        e.shoots.length ? `shoots:${JSON.stringify(e.shoots)}` : "",
          })),
        }),
      });
      setSubmitStatus(r.ok ? "✓ Kaydedildi." : "✗ Sunucu hatası — yerel kayıt tamam.");
    } catch { setSubmitStatus("✓ Yerel kayıt tamam. (Çevrimdışı)"); }
  }

  const filtered = compFilter === "all" ? matches : matches.filter((m) => m.comp_level === compFilter);
  const videoTransform = `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`;

  return (
    <div className="vs2-root">

      {/* ── Sidebar toggle ── */}
      <button className="vs2-sidebar-toggle" onClick={() => setSidebarOpen((v) => !v)}
        title={sidebarOpen ? "Maç listesini gizle" : "Maç listesini göster"}>
        {sidebarOpen ? "◀" : "▶"}
      </button>

      {/* ── LEFT: Match browser ── */}
      {sidebarOpen && (
        <aside className="vs2-sidebar">
          <div className="vs2-sidebar-header">
            <span className="vs2-event-key">{eventKey}</span>
            {loading && <span className="vs2-loading">yükleniyor…</span>}
          </div>
          <div className="vs2-filter">
            {COMP_FILTERS.map((f) => (
              <button key={f.key} className={compFilter === f.key ? "active" : ""}
                onClick={() => setCompFilter(f.key)}>{f.label}</button>
            ))}
          </div>
          <div className="vs2-match-list">
            {filtered.length === 0 && !loading && (
              <p className="vs2-empty">TBA'dan maç verisi yok.</p>
            )}
            {filtered.map((m) => (
              <button key={m.match_key}
                className={`vs2-match-row ${selected?.match_key === m.match_key ? "active" : ""} ${m.comp_level}`}
                onClick={() => selectMatch(m)}>
                <span className="vs2-match-label">{matchLabel(m)}</span>
                <span className="vs2-match-teams vs2-red">{m.red.map((t) => t.replace("frc","")).join(" ")}</span>
                <span className="vs2-match-teams vs2-blue">{m.blue.map((t) => t.replace("frc","")).join(" ")}</span>
                {m.youtube_key ? <span className="vs2-yt-badge">▶ YT</span> : <span className="vs2-no-yt">–</span>}
              </button>
            ))}
          </div>
        </aside>
      )}

      {/* ── CENTER: Video + controls ── */}
      <div className="vs2-center">
        {!selected ? (
          <div className="vs2-placeholder">← Sol taraftan maç seç</div>
        ) : (
          <>
            <div className="vs2-match-header">
              <span className="vs2-match-title">{matchLabel(selected)} — {selected.match_key}</span>
              <span className="vs2-match-teams-inline">
                <span className="vs2-red">{selected.red.map((t) => t.replace("frc","")).join(" · ")}</span>
                {" vs "}
                <span className="vs2-blue">{selected.blue.map((t) => t.replace("frc","")).join(" · ")}</span>
              </span>
            </div>

            {selected.youtube_key ? (
              <>
                <div className="vs2-player-outer">
                  <div className="vs2-player-inner" style={{ transform: videoTransform, transformOrigin: "center center" }}>
                    <div ref={playerDivRef} className="vs2-yt-div" />
                  </div>
                  <div ref={overlayRef}
                    className={`vs2-player-overlay ${panMode ? "pan-active" : ""}`}
                    onMouseDown={onOverlayDown} onMouseMove={onOverlayMove}
                    onMouseUp={onOverlayUp} onMouseLeave={onOverlayUp}
                    onTouchStart={onOverlayDown} onTouchMove={onOverlayMove} onTouchEnd={onOverlayUp}
                    onClick={() => { if (!panMode) togglePlay(); }}
                  />
                </div>

                <div className="vs2-controls">
                  {/* Match start marker */}
                  <div className="vs2-ctrl-row vs2-match-start-row">
                    <button
                      className={`vs2-match-start-btn${matchStartSec !== null ? " marked" : ""}`}
                      onClick={matchStartSec !== null ? () => setMatchStartSec(null) : markMatchStart}
                      title={matchStartSec !== null ? "Sıfırlamak için tıkla" : "Videonun bu anını maç başlangıcı olarak işaretle"}>
                      {matchStartSec !== null
                        ? `✅ MAÇ BAŞI: ${fmtSec(matchStartSec)} (${matchStartSec}s) — sıfırla`
                        : "🏁 MAÇ BAŞLADI"}
                    </button>
                  </div>

                  {/* Seek + play */}
                  <div className="vs2-ctrl-row">
                    <button className="vs2-ctrl-btn" onClick={() => seek(-10)}>−10s</button>
                    <button className="vs2-ctrl-btn" onClick={() => seek(-5)}>−5s</button>
                    <button className="vs2-ctrl-btn" onClick={() => seek(-1)}>−1s</button>
                    <button className="vs2-ctrl-btn vs2-ctrl-btn--half" onClick={() => seek(-0.5)}>−½s</button>
                    <button className={`vs2-play-btn ${playing ? "playing" : ""}`} onClick={togglePlay}>
                      {playing ? "⏸" : "▶"}
                    </button>
                    <button className="vs2-ctrl-btn vs2-ctrl-btn--half" onClick={() => seek(0.5)}>+½s</button>
                    <button className="vs2-ctrl-btn" onClick={() => seek(1)}>+1s</button>
                    <button className="vs2-ctrl-btn" onClick={() => seek(5)}>+5s</button>
                    <button className="vs2-ctrl-btn" onClick={() => seek(10)}>+10s</button>
                  </div>

                  {/* Speed */}
                  <div className="vs2-ctrl-row">
                    <span className="vs2-ctrl-label">HIZ</span>
                    {SPEEDS.map((s) => (
                      <button key={s} className={`vs2-speed-btn ${speed === s ? "active" : ""}`}
                        onClick={() => applySpeed(s)}>{s}×</button>
                    ))}
                  </div>

                  {/* Quality */}
                  <div className="vs2-ctrl-row">
                    <span className="vs2-ctrl-label">KALİTE</span>
                    {QUALITIES.map((q) => (
                      <button key={q.key} className={`vs2-quality-btn ${quality === q.key ? "active" : ""}`}
                        onClick={() => applyQuality(q.key)}>{q.label}</button>
                    ))}
                  </div>

                  {/* Zoom + pan */}
                  <div className="vs2-ctrl-row">
                    <span className="vs2-ctrl-label">ZOOM</span>
                    {ZOOMS.map((z) => (
                      <button key={z} className={`vs2-zoom-btn ${zoom === z ? "active" : ""}`}
                        onClick={() => { setZoom(z); if (z === 1) { setPan({ x:0, y:0 }); setPanMode(false); } }}>{z}×</button>
                    ))}
                    {zoom > 1 && (
                      <button className={`vs2-pan-btn ${panMode ? "active" : ""}`}
                        onClick={() => setPanMode((v) => !v)}>{panMode ? "🔒 Pan" : "✋ Pan"}</button>
                    )}
                    {zoom > 1 && (
                      <button className="vs2-ctrl-btn" onClick={() => setPan({ x:0, y:0 })}>Reset</button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="vs2-no-video">
                <span>Bu maç için YouTube videosu yok.</span>
                <span className="vs2-no-video-sub">TBA'ya henüz yüklenmemiş olabilir.</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── RIGHT: Fuel entry ── */}
      <aside className="vs2-fuel-panel">
        <p className="vs2-section-label">
          {selected ? `${matchLabel(selected)} — Fuel` : "Fuel Girişi"}
        </p>

        <div className="vs2-fuel-cols-header">
          <span>KOLTUK</span><span>FUEL</span><span>KAP.</span><span>ŞUT</span>
        </div>

        {entries.map((entry, idx) => {
          const isShoting = !!shootState[entry.seat];
          return (
            <div key={entry.seat}
              className={`vs2-fuel-compact-row ${entry.seat.startsWith("red") ? "vs2-red-row" : "vs2-blue-row"}`}>
              <span className="vs2-seat">{entry.seat.replace("red","R").replace("blue","B")}</span>
              <input className="vs2-num" type="number" inputMode="numeric" min="0"
                placeholder="0" value={entry.fuelScored}
                onChange={(e) => setEntries((prev) => prev.map((en, i) => i === idx ? { ...en, fuelScored: e.target.value } : en))} />
              <input className="vs2-num" type="number" inputMode="numeric" min="0"
                placeholder="0" value={entry.maxCarried}
                onChange={(e) => setEntries((prev) => prev.map((en, i) => i === idx ? { ...en, maxCarried: e.target.value } : en))} />
              <div className="vs2-shoot-cell">
                {!isShoting ? (
                  <button className="vs2-shoot-start" onClick={() => shootStart(entry.seat)} title="Şut başladı">
                    ▶
                  </button>
                ) : (
                  <button className="vs2-shoot-end" onClick={() => shootEnd(entry.seat)} title="Şut bitti">
                    ■
                  </button>
                )}
                {entry.shoots.length > 0 && (
                  <span className="vs2-shoot-count">×{entry.shoots.length}</span>
                )}
              </div>
            </div>
          );
        })}

        <button className="vs2-submit-btn" onClick={submitFuel} disabled={!selected}>KAYDET</button>
        {submitStatus && <p className="vs2-submit-status">{submitStatus}</p>}
      </aside>
    </div>
  );
}
