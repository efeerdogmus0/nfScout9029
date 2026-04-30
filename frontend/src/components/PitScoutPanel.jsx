/**
 * PitScoutPanel — pit scouting for non-field crew.
 * Auth uses locally generated credentials from adminConfig.
 * Data stored offline-first in localStorage.
 */
import { useEffect, useRef, useState } from "react";

import { getEventKey, getPitScoutCount } from "../adminConfig";
import { fetchEventTeams, fetchPitReports, upsertPitReport } from "../api";

const LS_KEY = "pitReports"; // { [teamKey]: PitReport }
const PIT_OUTBOX_KEY = "pitReportsOutbox"; // { [event__team]: { state, updated_at, last_error, ... } }

function loadPitOutbox() {
  try { return JSON.parse(localStorage.getItem(PIT_OUTBOX_KEY)) || {}; }
  catch { return {}; }
}
function savePitOutbox(next) {
  localStorage.setItem(PIT_OUTBOX_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("pitOutboxChanged"));
}

// ─── CAPABILITY SCHEMA ────────────────────────────────────────────────────────
// Capability toggle groups
const SWERVE_MODELS = ["MK4", "MK4i", "MK4n", "MK5", "MK5n", "SDS Diğer", "Swerve X", "WCP SwerveX", "Diğer"];
const SWERVE_RATIOS = ["L1", "L2", "L3", "L4"];
const LL_MODELS = ["LL1", "LL2", "LL2+", "LL3", "LL3G", "LL4"];

const CAPS = [
  {
    key: "drive",
    label: "Sürüş",
    options: ["Swerve", "Tank/WCD", "Mecanum", "Diğer"],
  },
  {
    key: "driveMotor",
    label: "Drive Motor",
    options: ["NEO", "NEO Vortex", "Kraken X60", "Falcon 500", "CIM", "Diğer"],
  },
  {
    key: "intake",
    label: "Toparlama",
    options: ["Yer", "Human Player", "Her İkisi", "Yok"],
  },
  {
    key: "shootRange",
    label: "Atış Menzili",
    options: ["Yok", "Yakın", "Orta", "Uzak", "Her Mesafe"],
  },
  {
    key: "climbTeleop",
    label: "Tırmanma (Teleop)",
    options: ["Yok", "L1 (10p)", "L2 (20p)", "L3 (30p)"],
  },
  {
    key: "climbAuto",
    label: "Auto Tırmanma",
    options: ["Yok", "L1 (15p)"],
  },
  {
    key: "consistency",
    label: "Güvenilirlik",
    options: ["Tutarsız", "Orta", "Güvenilir", "Çok Güvenilir"],
  },
  {
    key: "defense",
    label: "Savunma",
    options: ["Oynamaz", "Bazen", "Ana Strateji"],
  },
];

const TOGGLES = [
  { key: "bump",   label: "Bump Geçişi"   },
  { key: "trench", label: "Trench Geçişi" },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function loadReports() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
  catch { return {}; }
}

function saveReports(reports) {
  localStorage.setItem(LS_KEY, JSON.stringify(reports));
  window.dispatchEvent(new Event("pitReportsChanged"));
}

/** Divide teams among pit scouts in round-robin fashion.
 *  If seatIndex is invalid / admin viewing, return all teams. */
function assignTeams(allTeams, seatIndex, total) {
  if (seatIndex < 0 || seatIndex >= total || total <= 0) return allTeams;
  return allTeams.filter((_, i) => i % total === seatIndex);
}

function teamNum(key) {
  return key.replace("frc", "");
}

// ─── TEAM FORM ────────────────────────────────────────────────────────────────
function PitTeamForm({ teamKey, report, onChange }) {
  const fileRef = useRef(null);

  function set(field, value) {
    onChange({ ...report, [field]: value });
  }

  function onPhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => set("photo", ev.target.result);
    reader.readAsDataURL(file);
  }

  return (
    <div className="pit-form">
      {/* Header */}
      <div className="pit-form-header">
        <span className="pit-form-team">frc{teamNum(teamKey)}</span>
        <label className={`pit-done-toggle${report.completed ? " done" : ""}`}>
          <input type="checkbox" checked={!!report.completed}
            onChange={(e) => set("completed", e.target.checked)} />
          {report.completed ? "✓ Tamamlandı" : "Tamamlandı mı?"}
        </label>
      </div>

      {/* Photo */}
      <div className="pit-photo-section">
        {report.photo
          ? <img src={report.photo} alt="robot" className="pit-photo-preview" onClick={() => fileRef.current?.click()} />
          : <button className="pit-photo-btn" onClick={() => fileRef.current?.click()}>📷 Fotoğraf Ekle</button>
        }
        <input ref={fileRef} type="file" accept="image/*" capture="environment"
          style={{ display: "none" }} onChange={onPhoto} />
        {report.photo && (
          <button className="pit-photo-remove" onClick={() => set("photo", null)}>✕ Kaldır</button>
        )}
      </div>

      {/* ── SCORING ESTIMATES ── */}
      <div className="pit-score-section">
        <span className="pit-section-title">⚡ Skor Tahmini</span>

        <div className="pit-score-grid">
          {/* Auto fuel */}
          <div className="pit-score-field">
            <label>🤖 Auto Fuel</label>
            <input type="number" min="0" max="999" placeholder="~kaç?"
              value={report.autoFuel ?? ""}
              onChange={(e) => set("autoFuel", e.target.value)} />
            <span className="pit-score-hint">puan = fuel sayısı × 1</span>
          </div>

          {/* Teleop fuel per match */}
          <div className="pit-score-field">
            <label>🎮 Teleop Fuel / Maç</label>
            <input type="number" min="0" max="999" placeholder="~kaç?"
              value={report.teleopFuel ?? ""}
              onChange={(e) => set("teleopFuel", e.target.value)} />
            <span className="pit-score-hint">aktif shiftte kaç fuel atabiliyor?</span>
          </div>

          {/* Fuel per second */}
          <div className="pit-score-field">
            <label>⚡ Fuel / Saniye</label>
            <input type="number" min="0" max="30" step="0.5" placeholder="~kaç?"
              value={report.fuelPerSec ?? ""}
              onChange={(e) => set("fuelPerSec", e.target.value)} />
            <span className="pit-score-hint">atış hızı (fuel/sn)</span>
          </div>

          {/* Carrier capacity */}
          <div className="pit-score-field">
            <label>📦 Taşıma Kapasitesi</label>
            <input type="number" min="0" max="50" placeholder="kaç top?"
              value={report.carrierCap ?? ""}
              onChange={(e) => set("carrierCap", e.target.value)} />
            <span className="pit-score-hint">bir seferde max kaç fuel</span>
          </div>

        </div>

        {/* RP contribution estimate */}
        {(report.teleopFuel || report.autoFuel || report.fuelPerSec) && (() => {
          const af  = parseInt(report.autoFuel)   || 0;
          const tf  = parseInt(report.teleopFuel) || 0;
          const fps = parseFloat(report.fuelPerSec);
          const total = af + tf;
          const energized = total >= 34
            ? "✅ ENERGIZED'a katkı olabilir (3 robot ~100)"
            : `🔸 ${34 - total} fuel daha → ENERGIZED eşiğine yaklaş (34/robot)`;
          return (
            <div className="pit-rp-hint">
              <strong>Tahmini katkı:</strong> ~{total} fuel/maç
              {!isNaN(fps) && fps > 0 && (
                <>&nbsp;·&nbsp;atış hızı <strong>{fps} f/sn</strong> → ~{Math.round(fps * 90)} fuel/maç kapasitesi</>
              )}
              {total > 0 && <>&nbsp;·&nbsp;{energized}</>}
            </div>
          );
        })()}
      </div>

      {/* ── DRIVETRAIN DETAILS ── */}
      <div className="pit-caps">
        {/* Swerve modülü — sadece Swerve seçiliyse göster */}
        {report.drive === "Swerve" && (
          <>
            <div className="pit-cap-group">
              <span className="pit-cap-label">Swerve Modülü</span>
              <div className="pit-cap-options">
                {SWERVE_MODELS.map((m) => (
                  <button key={m}
                    className={`pit-cap-btn${report.swerveModel === m ? " selected" : ""}`}
                    onClick={() => set("swerveModel", report.swerveModel === m ? null : m)}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="pit-cap-group">
              <span className="pit-cap-label">Tork Oranı (Ratio)</span>
              <div className="pit-cap-options">
                {SWERVE_RATIOS.map((r) => (
                  <button key={r}
                    className={`pit-cap-btn${report.swerveRatio === r ? " selected" : ""}`}
                    onClick={() => set("swerveRatio", report.swerveRatio === r ? null : r)}>
                    {r}
                  </button>
                ))}
                {/* Serbest tork girişi */}
                <input
                  className="pit-inline-input"
                  placeholder="Özel (ör. L2+)"
                  value={report.swerveRatioCustom || ""}
                  onChange={(e) => set("swerveRatioCustom", e.target.value)}
                />
              </div>
            </div>
          </>
        )}

        {/* Limelight */}
        <div className="pit-cap-group">
          <span className="pit-cap-label">Limelight Modeli</span>
          <div className="pit-cap-options">
            {LL_MODELS.map((m) => (
              <button key={m}
                className={`pit-cap-btn${(report.limelights || []).includes(m) ? " selected" : ""}`}
                onClick={() => {
                  const cur = report.limelights || [];
                  set("limelights", cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]);
                }}>
                {m}
              </button>
            ))}
          </div>
          {(report.limelights || []).length > 0 && (
            <div className="pit-ll-count-row">
              <span className="pit-cap-label" style={{ marginTop: 0 }}>Limelight Adedi</span>
              <div className="pit-cap-options">
                {[1, 2, 3, 4].map((n) => (
                  <button key={n}
                    className={`pit-cap-btn${report.limelightCount === n ? " selected" : ""}`}
                    onClick={() => set("limelightCount", report.limelightCount === n ? null : n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Capability selectors */}
      <div className="pit-caps">
        {CAPS.map((cap) => (
          <div key={cap.key} className="pit-cap-group">
            <span className="pit-cap-label">{cap.label}</span>
            <div className="pit-cap-options">
              {cap.options.map((opt) => (
                <button
                  key={opt}
                  className={`pit-cap-btn${report[cap.key] === opt ? " selected" : ""}`}
                  onClick={() => set(cap.key, report[cap.key] === opt ? null : opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Toggle row */}
        <div className="pit-cap-group">
          <span className="pit-cap-label">Geçiş</span>
          <div className="pit-cap-options">
            {TOGGLES.map((t) => (
              <button
                key={t.key}
                className={`pit-cap-btn${report[t.key] ? " selected" : ""}`}
                onClick={() => set(t.key, !report[t.key])}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="pit-notes-section">
        <label className="pit-notes-label">Genel Notlar</label>
        <textarea className="pit-textarea" rows={3}
          placeholder="Dikkat çeken özellikler, güçlü / zayıf yönler..."
          value={report.notes || ""}
          onChange={(e) => set("notes", e.target.value)} />

        <label className="pit-notes-label">Görüşme Notları</label>
        <textarea className="pit-textarea" rows={3}
          placeholder="Takımla konuşurken öğrenilen bilgiler..."
          value={report.interviewNotes || ""}
          onChange={(e) => set("interviewNotes", e.target.value)} />
      </div>

      {/* ── INSPECTION ── */}
      <div className="pit-inspection-section">
        <span className="pit-section-title">🔎 İnspeksiyon</span>

        <div className="pit-inspection-row">
          {/* Weight */}
          <div className="pit-insp-field">
            <label>⚖️ Başlangıç Ağırlığı</label>
            <div className="pit-insp-weight-wrap">
              <input
                type="number" min="0" max="200" step="0.1"
                placeholder="kg"
                className="pit-insp-weight-input"
                value={report.inspectionWeight ?? ""}
                onChange={(e) => set("inspectionWeight", e.target.value)}
              />
              <span className="pit-insp-unit">kg</span>
            </div>
            <span className="pit-score-hint">limit: 125 lb ≈ 56.7 kg</span>
          </div>

          {/* Pass / Fail */}
          <div className="pit-insp-field">
            <label>✅ Durum</label>
            <div className="pit-insp-status-btns">
              {[
                { val: "passed",   label: "✓ Geçti",     cls: "insp-pass"    },
                { val: "failed",   label: "✗ Kaldı",     cls: "insp-fail"    },
                { val: "pending",  label: "⏳ Bekliyor",  cls: "insp-pending" },
              ].map(({ val, label, cls }) => (
                <button key={val}
                  className={`pit-insp-btn ${cls}${report.inspectionStatus === val ? " selected" : ""}`}
                  onClick={() => set("inspectionStatus", report.inspectionStatus === val ? null : val)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="pit-notes-label">İnspeksiyon Notları</label>
        <textarea className="pit-textarea" rows={2}
          placeholder="Örn: kablo düzensiz, düzeltmesi istendi · bumper yüksekliği sınırda · ilk inspeksiyonda kaldı..."
          value={report.inspectionNotes || ""}
          onChange={(e) => set("inspectionNotes", e.target.value)} />
      </div>
    </div>
  );
}

// ─── MAIN PANEL ───────────────────────────────────────────────────────────────
export default function PitScoutPanel({ auth, onLogout }) {
  const [eventKey,     setEventKey]     = useState(getEventKey);
  const [allTeams,     setAllTeams]     = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(true); // true on mount so spinner shows immediately
  const [teamsError,   setTeamsError]   = useState(null);
  const [reports,      setReports]      = useState(loadReports);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [sidebarOpen,  setSidebarOpen]  = useState(true);
  const [syncStatus, setSyncStatus] = useState("");
  const uploadTimersRef = useRef({});

  // Listen for event key changes
  useEffect(() => {
    const fn = () => setEventKey(getEventKey());
    window.addEventListener("adminConfigChanged", fn);
    return () => window.removeEventListener("adminConfigChanged", fn);
  }, []);

  // Fetch event teams
  function loadTeams() {
    if (!eventKey) return;
    setTeamsLoading(true);
    setTeamsError(null);
    fetchEventTeams(eventKey).then(({ teams, error }) => {
      setAllTeams(teams);
      setTeamsError(error);
      setTeamsLoading(false);
    });
  }
  useEffect(() => { loadTeams(); }, [eventKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pull shared pit reports from backend and merge local unsynced edits on top.
  useEffect(() => {
    if (!eventKey) return;
    const local = loadReports();
    fetchPitReports(eventKey).then((remote) => {
      setReports((prev) => ({ ...(remote || {}), ...local, ...prev }));
    }).catch(() => {});
    Object.entries(local).forEach(([teamKey, report]) => {
      if (!report || typeof report !== "object") return;
      const outboxKey = `${eventKey}__${teamKey}`;
      const meta = loadPitOutbox();
      meta[outboxKey] = {
        ...(meta[outboxKey] || {}),
        event_key: eventKey,
        team_key: teamKey,
        state: "pending",
        updated_at: Date.now(),
        last_error: null,
      };
      savePitOutbox(meta);
      upsertPitReport(eventKey, teamKey, report)
        .then((ok) => {
          const latest = loadPitOutbox();
          latest[outboxKey] = {
            ...(latest[outboxKey] || {}),
            event_key: eventKey,
            team_key: teamKey,
            state: ok ? "sent" : "failed",
            last_success_at: ok ? Date.now() : (latest[outboxKey]?.last_success_at || null),
            last_error: ok ? null : "upload_failed",
          };
          savePitOutbox(latest);
        })
        .catch(() => {
          const latest = loadPitOutbox();
          latest[outboxKey] = {
            ...(latest[outboxKey] || {}),
            event_key: eventKey,
            team_key: teamKey,
            state: "failed",
            last_error: "network_error",
          };
          savePitOutbox(latest);
        });
    });
  }, [eventKey]);

  // Persist reports on every change
  useEffect(() => { saveReports(reports); }, [reports]);

  useEffect(() => {
    return () => {
      Object.values(uploadTimersRef.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  function logout() { setSelectedTeam(null); onLogout?.(); }

  async function syncAllLocalPitReports() {
    if (!eventKey) return;
    const all = loadReports();
    const entries = Object.entries(all).filter(([, report]) => report && typeof report === "object");
    if (!entries.length) {
      setSyncStatus("Aktarılacak yerel pit raporu yok.");
      return;
    }
    let okCount = 0;
    for (const [teamKey, report] of entries) {
      const outboxKey = `${eventKey}__${teamKey}`;
      const meta = loadPitOutbox();
      meta[outboxKey] = {
        ...(meta[outboxKey] || {}),
        event_key: eventKey,
        team_key: teamKey,
        state: "sending",
        updated_at: Date.now(),
        last_error: null,
      };
      savePitOutbox(meta);
      try {
        const ok = await upsertPitReport(eventKey, teamKey, report);
        const latest = loadPitOutbox();
        latest[outboxKey] = {
          ...(latest[outboxKey] || {}),
          event_key: eventKey,
          team_key: teamKey,
          state: ok ? "sent" : "failed",
          last_success_at: ok ? Date.now() : (latest[outboxKey]?.last_success_at || null),
          last_error: ok ? null : "upload_failed",
        };
        savePitOutbox(latest);
        if (ok) okCount += 1;
      } catch {
        const latest = loadPitOutbox();
        latest[outboxKey] = {
          ...(latest[outboxKey] || {}),
          event_key: eventKey,
          team_key: teamKey,
          state: "failed",
          last_error: "network_error",
        };
        savePitOutbox(latest);
      }
    }
    setSyncStatus(okCount === entries.length
      ? `✓ ${okCount}/${entries.length} pit raporu aktarıldı.`
      : `⚠ ${okCount}/${entries.length} aktarıldı. Kalanlar kuyrukta.`);
    setTimeout(() => setSyncStatus(""), 4000);
  }

  function updateReport(teamKey, data) {
    setReports((prev) => ({ ...prev, [teamKey]: data }));
    if (!eventKey) return;
    const outboxKey = `${eventKey}__${teamKey}`;
    const meta = loadPitOutbox();
    meta[outboxKey] = {
      ...(meta[outboxKey] || {}),
      event_key: eventKey,
      team_key: teamKey,
      state: "pending",
      updated_at: Date.now(),
      last_error: null,
    };
    savePitOutbox(meta);
    const existing = uploadTimersRef.current[teamKey];
    if (existing) clearTimeout(existing);
    uploadTimersRef.current[teamKey] = setTimeout(() => {
      upsertPitReport(eventKey, teamKey, data)
        .then((ok) => {
          const latest = loadPitOutbox();
          latest[outboxKey] = {
            ...(latest[outboxKey] || {}),
            event_key: eventKey,
            team_key: teamKey,
            state: ok ? "sent" : "failed",
            last_success_at: ok ? Date.now() : (latest[outboxKey]?.last_success_at || null),
            last_error: ok ? null : "upload_failed",
          };
          savePitOutbox(latest);
        })
        .catch(() => {
          const latest = loadPitOutbox();
          latest[outboxKey] = {
            ...(latest[outboxKey] || {}),
            event_key: eventKey,
            team_key: teamKey,
            state: "failed",
            last_error: "network_error",
          };
          savePitOutbox(latest);
        });
    }, 700);
  }

  const pitCount  = getPitScoutCount();
  const myTeams   = assignTeams(allTeams, auth.seatIndex, pitCount);
  const doneCount = myTeams.filter((t) => reports[t]?.completed).length;

  return (
    <div className="pit-panel">
      {/* ── HEADER ── */}
      <div className="pit-header">
        <button className="pit-sidebar-toggle" onClick={() => setSidebarOpen((v) => !v)}>
          {sidebarOpen ? "◀" : "▶"} {sidebarOpen ? "Gizle" : "Takımlar"}
        </button>
        <span className="pit-header-title">
          {auth.seat.toUpperCase()} · {eventKey}
        </span>
        <span className="pit-progress">
          {doneCount}/{myTeams.length} ✓
        </span>
        <button className="pit-retry-btn" onClick={syncAllLocalPitReports}>☁ Hepsini Aktar</button>
        <button className="pit-logout-btn" onClick={logout}>Çıkış</button>
      </div>
      {syncStatus && <p className="pit-loading">{syncStatus}</p>}

      <div className="pit-body">
        {/* ── SIDEBAR: team list ── */}
        {sidebarOpen && (
          <div className="pit-sidebar">
            {teamsLoading && <p className="pit-loading">Takımlar yükleniyor…</p>}
            {!teamsLoading && teamsError && (
              <div className="pit-teams-error">
                {teamsError === "NO_KEY" && (
                  <>
                    <p>⚠️ TBA API key girilmemiş.</p>
                    <p className="pit-err-hint">Admin paneli → ⚙️ Ayarlar → TBA API Key</p>
                  </>
                )}
                {teamsError === "INVALID_KEY" && (
                  <>
                    <p>⚠️ TBA key hatalı veya süresi dolmuş.</p>
                    <p className="pit-err-hint">thebluealliance.com/account adresinden yeni key al.</p>
                  </>
                )}
                {teamsError === "NOT_FOUND" && (
                  <>
                    <p>⚠️ Event bulunamadı: <strong>{eventKey}</strong></p>
                    <p className="pit-err-hint">Admin panelinden event key'i kontrol et.</p>
                  </>
                )}
                {teamsError === "NETWORK" && (
                  <p>⚠️ Backend'e bağlanılamadı.</p>
                )}
                <button className="pit-retry-btn" onClick={loadTeams}>↺ Tekrar Dene</button>
              </div>
            )}
            {!teamsLoading && !teamsError && allTeams.length === 0 && (
              <p className="pit-loading">Takım listesi boş — etkinlikte kayıtlı takım yok.</p>
            )}
            {!teamsLoading && !teamsError && allTeams.length > 0 && myTeams.length === 0 && (
              <p className="pit-loading">Bu hesaba atanmış takım yok.</p>
            )}
            {myTeams.map((t) => {
              const rep = reports[t] || {};
              return (
                <button
                  key={t}
                  className={`pit-team-row${selectedTeam === t ? " active" : ""}${rep.completed ? " done" : ""}`}
                  onClick={() => setSelectedTeam(t)}
                >
                  <span className="pit-team-num">frc{teamNum(t)}</span>
                  {rep.completed && <span className="pit-done-badge">✓</span>}
                  {rep.photo    && <span className="pit-photo-badge">📷</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* ── MAIN: team form ── */}
        <div className="pit-main">
          {!selectedTeam ? (
            <div className="pit-empty">
              <p>← Soldaki listeden bir takım seç</p>
              {myTeams.length > 0 && (
                <p className="pit-empty-sub">
                  Sana atanan {myTeams.length} takım var
                </p>
              )}
            </div>
          ) : (
            <PitTeamForm
              key={selectedTeam}
              teamKey={selectedTeam}
              report={reports[selectedTeam] || {}}
              onChange={(data) => updateReport(selectedTeam, data)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
