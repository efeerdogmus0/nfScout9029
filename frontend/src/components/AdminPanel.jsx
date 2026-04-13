import { useEffect, useState } from "react";

import {
  getAdminConfig, setAdminConfig,
  getCurrentMatchNum, setCurrentMatchNum, clearCurrentMatchNum,
  getFieldCredentials, getPitCredentials, getPitScoutCount,
  getFullSchedule,
  setScoutName, getScoutNames,
} from "../adminConfig";
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
  { key: "settings",  label: "⚙️ Ayarlar"     },
  { key: "rotation",  label: "🔄 Vardiya"      },
  { key: "pit",       label: "👷 Pit Tayfa"    },
  { key: "calib",     label: "📐 Kalibre"      },
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

// ─── SHIFT BADGE ─────────────────────────────────────────────────────────────
function ShiftBadge({ status }) {
  if (!status || status.isActive === null)
    return <span className="shift-badge shift-unknown">–</span>;
  if (status.isActive)
    return <span className="shift-badge shift-active">▶ {status.matchesLeft}m · →{status.nextChangeAt}</span>;
  return <span className="shift-badge shift-break">☕ {status.matchesLeft}m · →{status.nextChangeAt}</span>;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function AdminPanel() {
  const [tab,      setTab]      = useState("settings");
  const [config,   setConfig]   = useState(getAdminConfig);
  const [custom,   setCustom]   = useState("");
  const [saved,    setSaved]    = useState(false);
  const [tbaInput,    setTbaInput]    = useState(() => getAdminConfig().tbaKey || "");
  const [myTeamInput, setMyTeamInput] = useState(() => getAdminConfig().myTeam || "");
  const [tbaSaved, setTbaSaved] = useState(false);
  const [pitCount,          setPitCount]          = useState(getPitScoutCount);
  const [currentMatchNum,   setCurrentMatchNumSt] = useState(getCurrentMatchNum);
  const [rotationMatchCount, setRotationMatchCountSt] = useState(() => getAdminConfig().rotationMatchCount ?? 12);

  useEffect(() => {
    const onCfg = () => {
      const c = getAdminConfig();
      setConfig(c);
      setPitCount(c.pitScoutCount ?? 2);
      setRotationMatchCountSt(c.rotationMatchCount ?? 12);
    };
    const onMatch = () => setCurrentMatchNumSt(getCurrentMatchNum());
    window.addEventListener("adminConfigChanged", onCfg);
    window.addEventListener("currentMatchNumChanged", onMatch);
    return () => {
      window.removeEventListener("adminConfigChanged", onCfg);
      window.removeEventListener("currentMatchNumChanged", onMatch);
    };
  }, []);

  function selectEvent(key) {
    const next = { ...config, eventKey: key };
    setConfig(next); setAdminConfig(next); setSaved(true);
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
  function changeRotation(delta) {
    const next = Math.max(3, Math.min(30, rotationMatchCount + delta));
    setRotationMatchCountSt(next);
    const cfg = { ...config, rotationMatchCount: next };
    setConfig(cfg); setAdminConfig(cfg);
  }
  function changeMatchNum(delta) {
    const base = currentMatchNum ?? 1;
    const next = Math.max(1, base + delta);
    setCurrentMatchNumSt(next);
    setCurrentMatchNum(next);
  }
  function resetMatchNum() { clearCurrentMatchNum(); setCurrentMatchNumSt(null); }

  const scoutNames = getScoutNames();
  const fieldCreds = getFieldCredentials();
  const pitCreds   = getPitCredentials();
  const schedule   = getFullSchedule(currentMatchNum, rotationMatchCount);

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
            : <p className="admin-status" style={{ color: "#ef4444" }}>⚠ Key girilmedi.</p>}
          <div className="admin-status">Seçili event: <strong>{config.eventKey}</strong></div>

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
        </>
      )}

      {/* ── ROTATION / VARDIYA ── */}
      {tab === "rotation" && (
        <>
          {/* Controls row */}
          <div className="admin-rot-controls">
            <div className="admin-rot-ctrl-block">
              <p className="admin-section-label">Rotasyon Periyodu (maç)</p>
              <div className="admin-pit-stepper">
                <button onClick={() => changeRotation(-1)} disabled={rotationMatchCount <= 3}>−</button>
                <span className="admin-pit-count">{rotationMatchCount}</span>
                <button onClick={() => changeRotation(+1)} disabled={rotationMatchCount >= 30}>+</button>
                <span className="admin-pit-note">maç aktif → {Math.round(rotationMatchCount * 2 / 3)} maç mola</span>
              </div>
            </div>
            <div className="admin-rot-ctrl-block">
              <p className="admin-section-label">Güncel Maç Numarası</p>
              <div className="admin-pit-stepper">
                <button onClick={() => changeMatchNum(-1)} disabled={!currentMatchNum || currentMatchNum <= 1}>−</button>
                <span className="admin-pit-count">{currentMatchNum ?? "—"}</span>
                <button onClick={() => changeMatchNum(+1)}>+</button>
                {currentMatchNum
                  ? <button className="admin-evtstart-reset" onClick={resetMatchNum} style={{ marginLeft: "0.4rem" }}>Sıfırla</button>
                  : <span className="admin-pit-note">MATCH START'ta otomatik set edilir</span>
                }
              </div>
            </div>
          </div>

          {/* Rotation info */}
          <p className="admin-pit-info" style={{ margin: "0.4rem 0 0.8rem" }}>
            Her an tam <strong>6 kişi aktif, 4 kişi molada</strong> · 5 grup · döngü = {5 * rotationMatchCount} maç
          </p>

          {/* Schedule table */}
          <div className="admin-rotation-table">
            <div className="admin-rot-head">
              <span>Grup</span>
              <span>Hesap</span>
              <span>İsim</span>
              <span>Koltuk</span>
              <span>Durum</span>
            </div>
            {schedule.map((s, i) => {
              const groupLabel = ["A","A","B","B","C","C","D","D","E","E"][i];
              const isExtra = s.seatIndex >= 6;
              const displaySeat = isExtra && s.isActive && s.coversSeat
                ? s.coversSeat
                : isExtra ? "—" : s.seat;
              const seatClass = displaySeat.startsWith("red") ? "is-red"
                              : displaySeat.startsWith("blue") ? "is-blue"
                              : "is-extra";
              return (
                <div key={s.username}
                  className={`admin-rot-row${s.isActive ? " rot-active" : s.isActive === false ? " rot-break" : ""}`}>
                  <span className="admin-rot-group">{groupLabel}</span>
                  <span className="admin-rot-user">{s.username}</span>
                  <NameInput username={s.username} initialName={scoutNames[s.username] || ""} />
                  <span className={`admin-rot-seat ${seatClass}`}>
                    {isExtra && s.isActive && s.coversSeat
                      ? <>→ {displaySeat.toUpperCase()}</>
                      : displaySeat.toUpperCase()}
                  </span>
                  <ShiftBadge status={s} />
                </div>
              );
            })}
          </div>
          <p className="admin-pit-info" style={{ marginTop: "0.6rem" }}>
            D/E grubu (seat7-10) aktifken üstteki tablodaki <strong>koltuk sütunu</strong> hangi fiziksel koltuğa oturacaklarını gösterir.
          </p>
        </>
      )}

      {/* ── PIT TAYFA ── */}
      {tab === "pit" && (
        <>
          <p className="admin-section-label">Pit Scout Sayısı</p>
          <div className="admin-pit-stepper">
            <button onClick={() => changePitCount(-1)} disabled={pitCount <= 1}>−</button>
            <span className="admin-pit-count">{pitCount}</span>
            <button onClick={() => changePitCount(+1)} disabled={pitCount >= 8}>+</button>
            <span className="admin-pit-note">Yarışma takımları bu sayıya bölünür</span>
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
      )}

      {/* ── CALIBRATION ── */}
      {tab === "calib" && <FieldSetupTool embedded />}
    </section>
  );
}
