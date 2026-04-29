import { useEffect, useMemo, useState } from "react";

import {
  getAdminConfig, setAdminConfig,
  getPitCredentials, getPitScoutCount,
  setScoutName, getScoutNames, setSharedEventKey, syncSharedEventKey,
} from "../adminConfig";
import { fetchEventTeams, fetchSchedule } from "../api";
import { getOfflineReports, getOutboxMeta } from "../storage";
import { getSyncTelemetry } from "../sync";
import FieldSetupTool from "./FieldSetupTool";

const KNOWN_EVENTS = [
  { key: "2026miket", label: "2026 Michigan State Championship" },
  { key: "2026micmp", label: "2026 Michigan Championship" },
  { key: "2026txcha", label: "2026 Texas Championship" },
  { key: "2026chcmp", label: "2026 FIRST Championship – Carver" },
  { key: "2026cmptx", label: "2026 FIRST Championship – Newton" },
  { key: "2026cmpmo", label: "2026 FIRST Championship – Hopper" },
];

const TABS = [
  { key: "settings", label: "⚙️ Ayarlar"  },
  { key: "pit",      label: "👷 Pit Tayfa" },
  { key: "coverage", label: "📊 Kapsama"   },
  { key: "calib",    label: "📐 Kalibre"   },
];

// ─── INLINE NAME EDITOR ───────────────────────────────────────────────────────
function NameInput({ username, initialName }) {
  const [val, setVal] = useState(initialName || "");

  function save() { setScoutName(username, val.trim()); }

  return (
    <input
      className="admin-name-input"
      placeholder="İsim..."
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && save()}
    />
  );
}

// ─── PIT TAB (with missing-team summary) ─────────────────────────────────────
function PitTab({ pitCount, pitCreds, scoutNames, changePitCount, config }) {
  const [allTeams,  setAllTeams]  = useState([]);
  const [loadState, setLoadState] = useState("idle"); // "idle"|"loading"|"error"

  // Pit reports stored in localStorage
  const pitReports = (() => {
    try { return JSON.parse(localStorage.getItem("pitReports")) || {}; } catch { return {}; }
  })();

  const scouted = new Set(Object.keys(pitReports));
  const missing = allTeams.filter(tk => !scouted.has(tk));

  function loadTeams() {
    if (!config.eventKey) return;
    setLoadState("loading");
    fetchEventTeams(config.eventKey)
      .then(({ teams, error }) => {
        if (error || !teams.length) setLoadState("error");
        else { setAllTeams(teams); setLoadState("done"); }
      })
      .catch(() => setLoadState("error"));
  }

  return (
    <>
      <p className="admin-section-label">Pit Scout Sayısı</p>
      <div className="admin-pit-stepper">
        <button onClick={() => changePitCount(-1)} disabled={pitCount <= 1}>−</button>
        <span className="admin-pit-count">{pitCount}</span>
        <button onClick={() => changePitCount(+1)} disabled={pitCount >= 8}>+</button>
        <span className="admin-pit-note">Yarışma takımları bu sayıya bölünür</span>
      </div>

      {/* ── Missing pit teams ── */}
      <div className="admin-missing-pit-section">
        <div className="admin-section-label" style={{ marginTop: "1.5rem", display:"flex", alignItems:"center", gap:"0.6rem" }}>
          🚨 Eksik Pit Raporları
          {loadState !== "loading" && (
            <button className="admin-missing-refresh" onClick={loadTeams}>
              {loadState === "idle" ? "TBA'dan Yükle" : "↻ Yenile"}
            </button>
          )}
        </div>
        {loadState === "loading" && <p className="admin-pit-info">Yükleniyor…</p>}
        {loadState === "error"   && <p className="admin-pit-info" style={{ color:"#f87171" }}>TBA anahtarı geçersiz veya bağlantı yok.</p>}
        {loadState === "done" && (
          missing.length === 0
            ? <p className="admin-pit-info" style={{ color:"#4ade80" }}>✓ Tüm {allTeams.length} takım scouting edildi!</p>
            : (
              <>
                <p className="admin-pit-info">
                  {scouted.size} / {allTeams.length} takım scouting edildi —{" "}
                  <strong style={{ color:"#fbbf24" }}>{missing.length} eksik</strong>
                </p>
                <div className="admin-missing-grid">
                  {missing.map(tk => (
                    <span key={tk} className="admin-missing-chip">{tk.replace("frc","")}</span>
                  ))}
                </div>
              </>
            )
        )}
      </div>

      <p className="admin-section-label" style={{ marginTop: "1.5rem" }}>👷 Pit Scout Girişleri</p>
      <div className="admin-cred-table">
        <div className="admin-cred-head">
          <span>Kullanıcı</span><span>İsim</span><span>PIN</span><span>Koltuk</span>
        </div>
        {pitCreds.map((c) => (
          <div key={c.username} className="admin-cred-row is-pit">
            <span className="admin-cred-user">{c.username}</span>
            <NameInput username={c.username} initialName={scoutNames[c.username] || ""} />
            <span className="admin-cred-pin">{c.pin}</span>
            <span className="admin-cred-seat">{c.seat.toUpperCase()}</span>
          </div>
        ))}
      </div>
      <p className="admin-pit-info">Pit scoutlar <strong>🔍 Pit</strong> ekranına bu bilgilerle giriş yapar.</p>
    </>
  );
}

// ─── COVERAGE TAB ────────────────────────────────────────────────────────────
/**
 * Shows a full coverage matrix: each row = a qual match,
 * each of the 6 columns = a robot slot.
 * Green = report exists, red = not scouted.
 * Clicking an uncovered cell opens a tooltip with the suggested seat
 * and a button to launch EyesFreeTerminal in retroactive mode.
 */
function CoverageTab({ config }) {
  const [schedule,  setSchedule]  = useState([]);
  const [reports,   setReports]   = useState([]);
  const [loadState, setLoadState] = useState("idle"); // idle|loading|done|error
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [retroTip,  setRetroTip]  = useState(null); // { matchKey, teamKey, seat, rect }

  function reload() {
    if (!config.eventKey) return;
    setLoadState("loading");
    Promise.all([
      fetchSchedule(config.eventKey).catch(() => []),
      getOfflineReports().catch(() => []),
    ]).then(([sched, reps]) => {
      setSchedule(sched.filter((m) => m.match_key.includes("_qm")));
      setReports(reps);
      setLoadState("done");
    }).catch(() => setLoadState("error"));
  }

  useEffect(() => {
    reload();
    const onReps = () => getOfflineReports().then(setReports).catch(() => {});
    window.addEventListener("offlineReportsChanged", onReps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.eventKey]);

  // coverage map: matchKey → teamKey → { device, count, autoDone }
  const coverageMap = useMemo(() => {
    const map = {};
    for (const r of reports) {
      if (!r.match_key || !r.team_key) continue;
      if (!map[r.match_key]) map[r.match_key] = {};
      const hasAutoPath = Array.isArray(r.auto_path_points) && r.auto_path_points.length > 0;
      const hasAutoFail = (r.timeline || []).some((e) => e.action === "problem" && e.key === "auto_fail");
      const autoDone = hasAutoPath || hasAutoFail;
      const prev = map[r.match_key][r.team_key];
      if (!prev) {
        map[r.match_key][r.team_key] = { device: r.scout_device_id || "?", count: 1, autoDone };
      } else {
        prev.count++;
        prev.autoDone = prev.autoDone || autoDone;
      }
    }
    return map;
  }, [reports]);

  // Summary stats
  const { fullyCovered, partiallyCovered, neverScouted } = useMemo(() => {
    let full = 0, partial = 0;
    const scoutedTeams = new Set(reports.map((r) => r.team_key));
    const allTeams = new Set(schedule.flatMap((m) => [...m.red, ...m.blue]));
    for (const m of schedule) {
      const mc = coverageMap[m.match_key] || {};
      const all6 = [...m.red, ...m.blue];
      const covered = all6.filter((tk) => mc[tk]?.count > 0).length;
      if (covered === 6) full++;
      else if (covered > 0) partial++;
    }
    const never = [...allTeams].filter((tk) => !scoutedTeams.has(tk));
    return { fullyCovered: full, partiallyCovered: partial, neverScouted: never };
  }, [schedule, reports, coverageMap]);

  const qNum = (mk) => parseInt(mk.split("_qm")[1]) || 0;

  const visibleMatches = onlyMissing
    ? schedule.filter((m) => {
        const mc = coverageMap[m.match_key] || {};
        return [...m.red, ...m.blue].some((tk) => !mc[tk]?.count);
      })
    : schedule;

  function handleCellClick(e, matchKey, teamKey, isCovered) {
    if (isCovered) { setRetroTip(null); return; }
    const match = schedule.find((m) => m.match_key === matchKey);
    if (!match) return;
    const alliance = match.red.includes(teamKey) ? "red" : "blue";
    const pos = (alliance === "red" ? match.red : match.blue).indexOf(teamKey) + 1;
    const seat = `${alliance}${pos}`;
    const rect = e.currentTarget.getBoundingClientRect();
    setRetroTip({ matchKey, teamKey, seat, x: rect.left, y: rect.bottom + 6 });
  }

  function launchRetro() {
    if (!retroTip) return;
    window.dispatchEvent(new CustomEvent("launchRetroScout", {
      detail: { matchKey: retroTip.matchKey, teamKey: retroTip.teamKey, seat: retroTip.seat },
    }));
    setRetroTip(null);
  }

  const SEAT_LABELS = {
    red1: "R1", red2: "R2", red3: "R3",
    blue1: "M1", blue2: "M2", blue3: "M3",
  };

  return (
    <div className="cov-root" onClick={(e) => { if (!e.target.closest(".cov-tip")) setRetroTip(null); }}>
      {/* ── Header ── */}
      <div className="cov-header">
        <span className="admin-section-label" style={{ margin: 0 }}>📊 Saha Kapsama Takibi</span>
        <button className="admin-missing-refresh" onClick={reload} disabled={loadState === "loading"}>
          {loadState === "loading" ? "…" : "↻ Yenile"}
        </button>
      </div>

      {loadState === "error" && <p className="admin-pit-info" style={{ color: "#f87171" }}>Takvim yüklenemedi.</p>}
      {loadState === "done" && (
        <>
          {/* ── Summary cards ── */}
          <div className="cov-summary">
            <div className="cov-stat cov-stat-good">
              <span className="cov-stat-val">{fullyCovered}</span>
              <span className="cov-stat-lbl">Tam Kapsanan</span>
            </div>
            <div className="cov-stat cov-stat-warn">
              <span className="cov-stat-val">{partiallyCovered}</span>
              <span className="cov-stat-lbl">Eksik Kapsanan</span>
            </div>
            <div className="cov-stat cov-stat-err">
              <span className="cov-stat-val">{schedule.length - fullyCovered - partiallyCovered}</span>
              <span className="cov-stat-lbl">Hiç Scouting Yok</span>
            </div>
            <div className="cov-stat cov-stat-muted">
              <span className="cov-stat-val">{neverScouted.length}</span>
              <span className="cov-stat-lbl">Sıfır Raporlu Takım</span>
            </div>
          </div>

          {neverScouted.length > 0 && (
            <div className="cov-never-section">
              <span className="cov-never-label">Hiç scouting yapılmamış:</span>
              <div className="cov-never-chips">
                {neverScouted.map((tk) => (
                  <span key={tk} className="admin-missing-chip">{tk.replace("frc", "")}</span>
                ))}
              </div>
            </div>
          )}

          {/* ── Filter toggle ── */}
          <div className="cov-filter-row">
            <label className="cov-filter-toggle">
              <input type="checkbox" checked={onlyMissing}
                onChange={(e) => setOnlyMissing(e.target.checked)} />
              Sadece eksik maçları göster
            </label>
            <span className="cov-filter-hint">{visibleMatches.length} maç</span>
          </div>

          {/* ── Coverage Matrix ── */}
          <div className="cov-matrix-wrap">
            <table className="cov-matrix">
              <thead>
                <tr>
                  <th className="cov-th-q">Q#</th>
                  <th colSpan={3} className="cov-th-red">🔴 RED</th>
                  <th colSpan={3} className="cov-th-blue">🔵 BLUE</th>
                </tr>
              </thead>
              <tbody>
                {visibleMatches.map((m) => {
                  const mc = coverageMap[m.match_key] || {};
                  const allSlots = [
                    ...m.red.map((tk, i) => ({ tk, alliance: "red", pos: i + 1 })),
                    ...m.blue.map((tk, i) => ({ tk, alliance: "blue", pos: i + 1 })),
                  ];
                  const rowFull = allSlots.every(({ tk }) => mc[tk]?.count > 0);
                  return (
                    <tr key={m.match_key} className={rowFull ? "cov-row-full" : ""}>
                      <td className="cov-td-q">Q{qNum(m.match_key)}</td>
                      {allSlots.map(({ tk, alliance, pos }) => {
                        const cov = mc[tk];
                        const isCov = Boolean(cov?.count);
                        const device = cov?.device?.replace("seat-", "") || "";
                        const isSelected = retroTip?.matchKey === m.match_key && retroTip?.teamKey === tk;
                        return (
                          <td key={tk}
                            className={`cov-td cov-td-${alliance}${isCov ? " cov-ok" : " cov-miss"}${isSelected ? " cov-selected" : ""}`}
                            onClick={(e) => handleCellClick(e, m.match_key, tk, isCov)}
                            title={isCov ? `${tk} — ${device} (${cov.count} rapor)` : `${tk} — scouting yok`}>
                            <span className="cov-team-num">{tk.replace("frc", "")}</span>
                            {isCov
                              ? <span className="cov-badge cov-badge-ok">{SEAT_LABELS[device] || device || "✓"}</span>
                              : <span className="cov-badge cov-badge-miss">✗</span>
                            }
                            {isCov && !cov.autoDone && <span className="cov-mini-tag">OTO?</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Retroactive tooltip ── */}
          {retroTip && (
            <div className="cov-tip" style={{ position: "fixed", left: retroTip.x, top: retroTip.y }}>
              <div className="cov-tip-title">📋 Geriye Dönük Scouting</div>
              <div className="cov-tip-body">
                <strong>frc{retroTip.teamKey.replace("frc","")}</strong> — {retroTip.matchKey.split("_qm")[0]}_qm{qNum(retroTip.matchKey)}
              </div>
              <div className="cov-tip-seat">
                Gerekli koltuk: <strong>{retroTip.seat.toUpperCase()}</strong>
              </div>
              <div className="cov-tip-hint">
                "{retroTip.seat.toUpperCase()}" sahacısı bu butona bastıktan sonra gelen saha ekranında bu maçı scout etmeli.
              </div>
              <div className="cov-tip-actions">
                <button className="cov-btn-retro" onClick={launchRetro}>
                  🕹 Saha Moduna Geç (Q{qNum(retroTip.matchKey)})
                </button>
                <button className="cov-btn-cancel" onClick={() => setRetroTip(null)}>İptal</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function fmtTs(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleTimeString("tr-TR"); } catch { return "—"; }
}

function SyncTelemetryCard() {
  const [tele, setTele] = useState(() => getSyncTelemetry());
  const [meta, setMeta] = useState(() => getOutboxMeta());

  useEffect(() => {
    const refresh = () => {
      setTele(getSyncTelemetry());
      setMeta(getOutboxMeta());
    };
    refresh();
    window.addEventListener("syncTelemetryChanged", refresh);
    window.addEventListener("outboxMetaChanged", refresh);
    return () => {
      window.removeEventListener("syncTelemetryChanged", refresh);
      window.removeEventListener("outboxMetaChanged", refresh);
    };
  }, []);

  const entries = Object.values(meta || {});
  const pendingCount = entries.filter((m) => ["pending", "sending", "failed"].includes(m.state)).length;
  const conflictedCount = entries.filter((m) => m.state === "conflicted").length;
  const failedCount = entries.filter((m) => m.state === "failed").length;

  return (
    <div className="admin-sync-card">
      <div className="admin-sync-title">📶 Sync Telemetry</div>
      <div className="admin-sync-grid">
        <div className="admin-sync-kpi"><span>Pending</span><strong>{pendingCount}</strong></div>
        <div className="admin-sync-kpi"><span>Conflicted</span><strong>{conflictedCount}</strong></div>
        <div className="admin-sync-kpi"><span>Failed</span><strong>{failedCount}</strong></div>
      </div>
      <div className="admin-sync-line">Son başarılı sync: <strong>{fmtTs(tele.lastSyncAt)}</strong></div>
      <div className="admin-sync-line">Son hata: <strong>{tele.lastError || "yok"}</strong></div>
      <div className="admin-sync-line">Retry ETA: <strong>{fmtTs(tele.retryEta)}</strong></div>
      <div className="admin-sync-line">Backend: <strong>{tele.backendHealthy ? "erişilebilir" : "erişilemiyor"}</strong></div>
    </div>
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function AdminPanel() {
  const [tab,      setTab]      = useState("settings");
  const [config,   setConfig]   = useState(getAdminConfig);
  const [custom,   setCustom]   = useState("");
  const [saved,    setSaved]    = useState(false);
  const [tbaInput,       setTbaInput]       = useState(() => getAdminConfig().tbaKey          || "");
  const [orKeyInput,     setOrKeyInput]     = useState(() => getAdminConfig().openrouterKey   || "");
  const [orModelInput,   setOrModelInput]   = useState(() => getAdminConfig().openrouterModel || "");
  const [orSaved,        setOrSaved]        = useState(false);
  const [myTeamInput,  setMyTeamInput] = useState(() => getAdminConfig().myTeam   || "");
  const [tbaSaved, setTbaSaved] = useState(false);
  const [pitCount, setPitCount] = useState(getPitScoutCount);

  useEffect(() => {
    const onCfg = () => {
      const c = getAdminConfig();
      setConfig(c);
      setPitCount(c.pitScoutCount ?? 2);
    };
    window.addEventListener("adminConfigChanged", onCfg);
    return () => window.removeEventListener("adminConfigChanged", onCfg);
  }, []);

  useEffect(() => {
    syncSharedEventKey();
  }, []);

  async function selectEvent(key) {
    const next = { ...config, eventKey: key };
    setConfig(next);
    await setSharedEventKey(key);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }
  function applyCustom() {
    if (!custom.trim()) return;
    selectEvent(custom.trim().toLowerCase()); setCustom("");
  }
  function saveTbaKey() {
    const next = { ...config, tbaKey: tbaInput.trim() };
    setConfig(next); setAdminConfig(next);
    setTbaSaved(true); setTimeout(() => setTbaSaved(false), 1500);
  }
  function changePitCount(delta) {
    const next = Math.max(1, Math.min(8, pitCount + delta));
    setPitCount(next);
    const cfg = { ...config, pitScoutCount: next };
    setConfig(cfg); setAdminConfig(cfg);
  }
  const scoutNames = getScoutNames();
  const pitCreds   = getPitCredentials();

  return (
    <section className="terminal admin-panel">
      <div className="admin-tabs">
        {TABS.map((t) => (
          <button key={t.key}
            className={`admin-tab-btn${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {/* ── SETTINGS ── */}
      {tab === "settings" && (
        <>
          <p className="admin-section-label">Aktif Regional</p>
          <div className="admin-event-list">
            {KNOWN_EVENTS.map((ev) => (
              <button key={ev.key}
                className={config.eventKey === ev.key ? "active" : ""}
                onClick={() => selectEvent(ev.key)}>
                <span className="admin-ev-key">{ev.key}</span>
                <span className="admin-ev-name">{ev.label}</span>
              </button>
            ))}
          </div>
          <div className="admin-custom-row">
            <input placeholder="Özel event key" value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyCustom()} />
            <button onClick={applyCustom}>EKLE</button>
          </div>
          {saved && <p className="admin-saved">✓ Kaydedildi.</p>}

          <p className="admin-section-label" style={{ marginTop: "1.5rem" }}>
            TBA API Key{" "}
            <a href="https://www.thebluealliance.com/account" target="_blank" rel="noreferrer"
              style={{ color: "var(--accent)", fontSize: "0.65rem" }}>
              (thebluealliance.com/account)
            </a>
          </p>
          <div className="admin-custom-row">
            <input type="password" placeholder="API key buraya..." value={tbaInput}
              onChange={(e) => setTbaInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveTbaKey()} autoComplete="off" />
            <button onClick={saveTbaKey}>KAYDET</button>
          </div>
          {tbaSaved && <p className="admin-saved">✓ TBA key kaydedildi.</p>}
          {config.tbaKey
            ? <p className="admin-status">Key: {config.tbaKey.slice(0, 8)}… ✓</p>
            : <p className="admin-status">Yerel override yok — backend `.env` içindeki `TBA_API_KEY` kullanılacak.</p>}
          <div className="admin-status">Seçili event: <strong>{config.eventKey}</strong></div>

          <p className="admin-section-label" style={{ marginTop: "1.5rem" }}>
            🤖 OpenRouter API Key{" "}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer"
              style={{ color: "var(--accent)", fontSize: "0.65rem" }}>
              (openrouter.ai/keys)
            </a>
          </p>
          <div className="admin-custom-row">
            <input type="password" placeholder="sk-or-..." value={orKeyInput}
              onChange={(e) => setOrKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const next = { ...config, openrouterKey: orKeyInput.trim(), openrouterModel: orModelInput.trim() };
                  setConfig(next); setAdminConfig(next);
                  setOrSaved(true); setTimeout(() => setOrSaved(false), 1500);
                }
              }} autoComplete="off" />
            <button onClick={() => {
              const next = { ...config, openrouterKey: orKeyInput.trim(), openrouterModel: orModelInput.trim() };
              setConfig(next); setAdminConfig(next);
              setOrSaved(true); setTimeout(() => setOrSaved(false), 1500);
            }}>KAYDET</button>
          </div>
          <div className="admin-custom-row" style={{ marginTop: "0.4rem" }}>
            <input placeholder="Model (boş = x-ai/grok-4-fast)"
              value={orModelInput} onChange={(e) => setOrModelInput(e.target.value)} />
          </div>
          {orSaved && <p className="admin-saved">✓ OpenRouter ayarları kaydedildi.</p>}
          {config.openrouterKey
            ? <p className="admin-status">Key: {config.openrouterKey.slice(0, 10)}… ✓ · model: {config.openrouterModel || "grok-4-fast"}</p>
            : <p className="admin-status">Yerel override yok — backend `.env` içindeki `OPENROUTER_API_KEY` kullanılacak · model: {config.openrouterModel || "grok-4-fast"}</p>}

          <p className="admin-section-label" style={{ marginTop: "1.5rem" }}>🤖 Takım Numaramız</p>
          <div className="admin-custom-row">
            <input placeholder="Örn: 254 veya frc254" value={myTeamInput}
              onChange={(e) => setMyTeamInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const next = { ...config, myTeam: myTeamInput.trim() };
                  setConfig(next); setAdminConfig(next);
                }
              }} />
            <button onClick={() => {
              const next = { ...config, myTeam: myTeamInput.trim() };
              setConfig(next); setAdminConfig(next);
            }}>KAYDET</button>
          </div>
          {config.myTeam && (
            <p className="admin-status">
              Takım: <strong>{config.myTeam.startsWith("frc") ? config.myTeam : `frc${config.myTeam}`}</strong>
            </p>
          )}
          <SyncTelemetryCard />
        </>
      )}

      {/* ── PIT TAYFA ── */}
      {tab === "pit" && (
        <PitTab
          pitCount={pitCount} pitCreds={pitCreds} scoutNames={scoutNames}
          changePitCount={changePitCount} config={config}
        />
      )}

      {/* ── COVERAGE ── */}
      {tab === "coverage" && <CoverageTab config={config} />}

      {/* ── CALIBRATION ── */}
      {tab === "calib" && <FieldSetupTool embedded />}
    </section>
  );
}
