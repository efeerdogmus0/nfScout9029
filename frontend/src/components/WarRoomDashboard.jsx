/**
 * War Room — match strategy prep for upcoming quals.
 * Data sources:
 *   - TBA schedule (fetchSchedule)
 *   - Pit reports (localStorage pitReports)
 *   - Field scout reports (IndexedDB via getOfflineReports)
 */
import { useEffect, useState } from "react";
import { getEventKey, getMyTeam, getTbaKey } from "../adminConfig";
import { fetchSchedule } from "../api";
import { getOfflineReports } from "../storage";

const LS_STRAT = "warRoomStrategy"; // { [match_key]: string }

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

function teamNum(key) { return (key || "").replace("frc", ""); }

/** Aggregate field scout data for a single team across all scouted matches. */
function aggregateScoutData(teamKey, reports) {
  const mine = reports.filter((r) => r.team_key === teamKey);
  if (!mine.length) return null;

  let bumpCount = 0, trenchCount = 0, problemCounts = {}, pingZones = {};
  let autoPathLast = null;

  mine.forEach((r) => {
    if (r.bump_slow_or_stuck)   bumpCount++;
    if (r.trench_slow_or_stuck) trenchCount++;

    // timeline events
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

// ─── TEAM CARD ────────────────────────────────────────────────────────────────
function TeamCard({ teamKey, alliance, pitReports, scoutReports }) {
  const pit   = pitReports[teamKey] || null;
  const scout = aggregateScoutData(teamKey, scoutReports);
  const tags  = buildTags(pit, scout);
  const num   = teamNum(teamKey);

  return (
    <div className={`wr-team-card wr-${alliance}`}>
      <div className="wr-team-header">
        <span className="wr-team-num">
          <a href={`https://www.thebluealliance.com/team/${num}`}
            target="_blank" rel="noreferrer">frc{num}</a>
        </span>
        {pit?.consistency && (
          <span className={`wr-reliability ${
            pit.consistency === "Çok Güvenilir" ? "rel-hi" :
            pit.consistency === "Güvenilir"     ? "rel-ok" :
            pit.consistency === "Orta"          ? "rel-mid" : "rel-lo"
          }`}>{pit.consistency}</span>
        )}
        {scout && (
          <span className="wr-scouted">{scout.matchesScoured} maç</span>
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

      {/* Scout stats */}
      {scout && (
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
  const qNum = match.match_key.split("_qm")[1];
  const isOurs = myTeam && (match.red.includes(myTeam) || match.blue.includes(myTeam));
  return (
    <button
      className={`wr-match-row${selected ? " selected" : ""}${isOurs ? " ours" : ""}`}
      onClick={onClick}>
      <span className="wr-match-num">Q{qNum}</span>
      {isOurs && <span className="wr-ours-badge">BİZ</span>}
      <span className="wr-match-teams">
        <span className="wr-red-mini">{match.red.map(teamNum).join(" ")}</span>
        <span className="wr-vs">vs</span>
        <span className="wr-blue-mini">{match.blue.map(teamNum).join(" ")}</span>
      </span>
    </button>
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
  const [showOursOnly, setShowOursOnly] = useState(false);
  const [filterInput, setFilterInput] = useState("");

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

  // Load offline scout reports once
  useEffect(() => {
    getOfflineReports().then(setScoutReps).catch(() => {});
    setPitReports(loadPitReports());
  }, []);

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

  function saveStrategy(matchKey, text) {
    const next = { ...strategies, [matchKey]: text };
    setStrategies(next);
    saveStrategies(next);
  }

  return (
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
          {loading && <p className="wr-loading">Yükleniyor…</p>}
          {!loading && qualList.length === 0 && (
            <p className="wr-loading">Maç bulunamadı.</p>
          )}
          {qualList.map((m) => (
            <MatchRow key={m.match_key} match={m} myTeam={myTeam}
              selected={selected === m.match_key}
              onClick={() => setSelected(m.match_key)} />
          ))}
        </div>
      </div>

      {/* ── MAIN AREA ── */}
      <div className="wr-main">
        {!selMatch ? (
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
              {myTeam && selMatch.red.includes(myTeam) && <span className="wr-alliance-badge wr-badge-red">RED ALLIANCEMIZ</span>}
              {myTeam && selMatch.blue.includes(myTeam) && <span className="wr-alliance-badge wr-badge-blue">BLUE ALLIANCEMIZ</span>}
            </div>

            {/* Alliance columns */}
            <div className="wr-alliances">
              {/* RED */}
              <div className="wr-alliance-col wr-alliance-red">
                <div className="wr-alliance-label">🔴 RED</div>
                {selMatch.red.map((tk) => (
                  <TeamCard key={tk} teamKey={tk} alliance="red"
                    pitReports={pitReports} scoutReports={scoutReps} />
                ))}
              </div>

              {/* BLUE */}
              <div className="wr-alliance-col wr-alliance-blue">
                <div className="wr-alliance-label">🔵 BLUE</div>
                {selMatch.blue.map((tk) => (
                  <TeamCard key={tk} teamKey={tk} alliance="blue"
                    pitReports={pitReports} scoutReports={scoutReps} />
                ))}
              </div>
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
  );
}
