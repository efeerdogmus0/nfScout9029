import { useEffect, useRef, useState } from "react";

import AdminPanel        from "./components/AdminPanel";
import WarRoomDashboard  from "./components/WarRoomDashboard";
import TestDataPanel     from "./components/TestDataPanel";
import UserManual        from "./components/UserManual";
import EyesFreeTerminal  from "./components/EyesFreeTerminal";
import PitScoutPanel     from "./components/PitScoutPanel";
import VideoScoutPanel   from "./components/VideoScoutPanel";
import {
  validateLogin,
  getAdminCredential,
  FIELD_SEATS, getSeatAssignments, isFreshSeat,
  getNextAvailableSeat, claimSeatShared, releaseSeatShared, getSeatAssignmentsShared,
  getRoleSessions, joinRoleSessionShared, leaveRoleSessionShared, getRoleSessionsShared, syncSharedEventKey,
} from "./adminConfig";
import { syncReportsIfOnline } from "./sync";
import QrImportModal from "./components/QrImportModal";

const SESSION_KEY = "appAuth";

function getStoredAuth() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}

// Default panel each role lands on after login
const ROLE_DEFAULT = {
  field_scout: "eyes",
  pit_scout:   "pit",
  video_scout: "video",
  admin:       "eyes",
};

// Nav tabs — adminOnly ones are hidden from non-admin users
const TABS = [
  { key: "eyes",    label: "🕹 Saha",     adminOnly: false },
  { key: "pit",     label: "🔍 Pit",      adminOnly: false },
  { key: "video",   label: "🎬 Video",    adminOnly: false },
  { key: "warroom", label: "⚡ War Room", adminOnly: true  },
  { key: "admin",   label: "⚙️ Admin",   adminOnly: true  },
  { key: "test",    label: "🧪 Test",    adminOnly: true  },
  { key: "manual",  label: "📖 Kılavuz", adminOnly: false },
];

import { DEVICE_ID } from "./config";

// Human-readable seat labels
const SEAT_LABEL = {
  red1: "R1", red2: "R2", red3: "R3",
  blue1: "M1", blue2: "M2", blue3: "M3",
};

// ─── UNIFIED LOGIN SCREEN ─────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [crewName,     setCrewName]     = useState("");
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [assignments,  setAssignments]  = useState(getSeatAssignments);
  const [pitSessions,  setPitSessions]  = useState(() => getRoleSessions("pit_scout"));
  const [videoSessions, setVideoSessions] = useState(() => getRoleSessions("video_scout"));

  // Auto-suggest next free seat on first render
  useEffect(() => {
    setSelectedSeat(getNextAvailableSeat());
  }, []);

  // Refresh assignments when this component mounts (other devices may have claimed)
  useEffect(() => {
    setAssignments(getSeatAssignments());
    setPitSessions(getRoleSessions("pit_scout"));
    setVideoSessions(getRoleSessions("video_scout"));
    const refresh = async () => {
      setAssignments(await getSeatAssignmentsShared());
      setPitSessions(await getRoleSessionsShared("pit_scout"));
      setVideoSessions(await getRoleSessionsShared("video_scout"));
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, []);

  async function fieldLogin() {
    const name = crewName.trim();
    if (!name || !selectedSeat) return;
    await claimSeatShared(selectedSeat, name);
    onLogin({
      username:  selectedSeat,
      seat:      selectedSeat,
      role:      "field_scout",
      name,
      seatIndex: FIELD_SEATS.indexOf(selectedSeat),
    });
  }
  async function pitLogin() {
    const name = crewName.trim();
    if (!name) { setErr("Önce ismini yaz."); return; }
    const res = await joinRoleSessionShared("pit_scout", name, Number.MAX_SAFE_INTEGER, "pit");
    if (!res.ok) {
      setErr("Pit girişi başarısız.");
      return;
    }
    onLogin({
      username: `pit_${res.session.id}`,
      seat: res.session.seat,
      role: "pit_scout",
      name: res.session.name,
      seatIndex: -1,
      sessionId: res.session.id,
    });
  }
  async function videoLogin() {
    const name = crewName.trim();
    if (!name) { setErr("Önce ismini yaz."); return; }
    const res = await joinRoleSessionShared("video_scout", name, 50, "video");
    if (!res.ok) { setErr("Video girişi başarısız."); return; }
    onLogin({
      username: `video_${res.session.id}`,
      seat: res.session.seat,
      role: "video_scout",
      name: res.session.name,
      seatIndex: -1,
      sessionId: res.session.id,
    });
  }

  // ── Pit / Video / Admin state ──
  const [username, setUsername] = useState("");
  const [pin,      setPin]      = useState("");
  const [err,      setErr]      = useState("");
  const inputRef = useRef(null);

  function attempt(u, p) {
    const cred = validateLogin(u ?? username, p ?? pin);
    if (cred) {
      onLogin({ ...cred, name: cred.username });
    } else {
      setErr("Hatalı kullanıcı adı veya PIN.");
      setPin("");
    }
  }

  const adminCred  = getAdminCredential();

  return (
    <div className="app-login">
      <img
        src="https://media.licdn.com/dms/image/v2/C4D0BAQGqCl_nrhQtdw/company-logo_200_200/company-logo_200_200/0/1671898098002/team_nf_logo?e=2147483647&v=beta&t=OGK3qeS0IF81gGSIehZTbXAiIky_AFMASexAWhewZH4"
        alt="Team NF" className="ef-nf-logo" />
      <h2 className="app-login-title">REBUILT SCOUTING</h2>
      <p className="app-login-sub">2026 · Team NF</p>
      <input
        className="app-field-name-input"
        data-cy="crew-name"
        placeholder="Adın..."
        value={crewName}
        autoComplete="off"
        autoCapitalize="words"
        onChange={(e) => { setCrewName(e.target.value); setErr(""); }}
      />

      {/* ── Saha Tayfa — ad + koltuk ── */}
      <p className="app-login-group-label">🕹 Saha Tayfa</p>
      <div className="app-field-login">
        <div className="app-seat-grid">
          {FIELD_SEATS.map((seat) => {
            const asgn    = assignments[seat];
            const isTaken = isFreshSeat(asgn);
            const isSel   = selectedSeat === seat;
            const isRed   = seat.startsWith("red");
            return (
              <button
                key={seat}
                type="button"
                data-cy={`seat-${seat}`}
                className={`app-seat-btn${isRed ? " seat-red" : " seat-blue"}${isSel ? " seat-selected" : ""}${isTaken && !isSel ? " seat-taken" : ""}`}
                onClick={() => setSelectedSeat(isSel ? null : seat)}
                title={isTaken && !isSel ? `${asgn.name} bu koltuğu kullanıyor` : seat}
              >
                <span className="seat-label">{SEAT_LABEL[seat]}</span>
                {isTaken && !isSel
                  ? <span className="seat-occupant">{asgn.name}</span>
                  : <span className="seat-pos">{seat.replace("red", "RED ").replace("blue", "BLUE ")}</span>
                }
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="app-field-go-btn"
          data-cy="field-login-go"
          disabled={!crewName.trim() || !selectedSeat}
          onClick={fieldLogin}
        >
          SAHA'YA GİR →
        </button>
      </div>

      {/* ── Pit + Video + Admin ── */}
      <div className="app-quick-row">
        <div>
          <p className="app-login-group-label">🔍 Pit Tayfa</p>
          <button className="app-quick-btn qbtn-pit" onClick={pitLogin} disabled={!crewName.trim()}>
            PITE GİR ({pitSessions.length})
          </button>
          <div className="app-role-presence">
            {pitSessions.map((s) => <span key={s.id} className="app-role-chip">{s.name}</span>)}
            {!pitSessions.length && <span className="app-role-empty">Henüz kimse yok</span>}
          </div>
        </div>
        <div>
          <p className="app-login-group-label">🎬 Video Tayfa</p>
          <button className="app-quick-btn qbtn-video" onClick={videoLogin} disabled={!crewName.trim()}>
            VİDEOYA GİR ({videoSessions.length})
          </button>
          <div className="app-role-presence">
            {videoSessions.map((s) => <span key={s.id} className="app-role-chip">{s.name}</span>)}
            {!videoSessions.length && <span className="app-role-empty">Henüz kimse yok</span>}
          </div>
        </div>
        <div>
          <p className="app-login-group-label">⚙️ Admin</p>
          <div className="app-quick-grid app-quick-grid--sm">
            <button type="button" className="app-quick-btn qbtn-admin" data-cy="quick-admin"
              onClick={() => attempt(adminCred.username, adminCred.pin)}>
              ADMIN
            </button>
          </div>
        </div>
      </div>

      {/* ── Manuel PIN girişi (admin) ── */}
      <div className="app-login-divider">admin manuel giriş</div>
      <div className="app-login-manual">
        <input ref={inputRef} placeholder="Kullanıcı adı" value={username}
          autoCapitalize="none" autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.nextSibling?.focus()} />
        <input placeholder="PIN / Şifre" type="password" inputMode="numeric" value={pin}
          autoComplete="current-password"
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && attempt()} />
        <button onClick={() => attempt()}>GİRİŞ</button>
      </div>
      {err && <p className="app-login-err">{err}</p>}
    </div>
  );
}


// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [auth,          setAuth]          = useState(getStoredAuth);
  const [mode,          setMode]          = useState(() => {
    const a = getStoredAuth();
    return a ? (ROLE_DEFAULT[a.role] || "eyes") : "eyes";
  });
  const [syncToast,     setSyncToast]     = useState("");
  const [showImport,    setShowImport]    = useState(false);
  const [retroMatchKey, setRetroMatchKey] = useState(null);

  // Launch retroactive scouting from Admin Coverage panel
  useEffect(() => {
    const handle = (e) => {
      const { matchKey } = e.detail || {};
      if (!matchKey) return;
      setRetroMatchKey(matchKey);
      setMode("eyes");
    };
    window.addEventListener("launchRetroScout", handle);
    return () => window.removeEventListener("launchRetroScout", handle);
  }, []);

  // Clear retroMatchKey when leaving eyes mode
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current === "eyes" && mode !== "eyes") setRetroMatchKey(null);
    prevModeRef.current = mode;
  }, [mode]);

  // Auto-sync loop (online + periodic + visibility regain)
  useEffect(() => {
    const attemptSync = async () => {
      const { synced } = await syncReportsIfOnline(DEVICE_ID);
      if (synced > 0) {
        setSyncToast(`✓ ${synced} rapor otomatik gönderildi`);
        setTimeout(() => setSyncToast(""), 4000);
      }
    };
    const handleOnline = () => { attemptSync(); };
    const handleVisible = () => {
      if (document.visibilityState === "visible") attemptSync();
    };
    const handleSwMessage = (e) => {
      if (e?.data?.type === "SYNC_OUTBOX") attemptSync();
    };
    const timer = setInterval(attemptSync, 12_000);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisible);
    navigator.serviceWorker?.addEventListener?.("message", handleSwMessage);
    attemptSync();
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisible);
      navigator.serviceWorker?.removeEventListener?.("message", handleSwMessage);
    };
  }, []);

  // Keep event/division selection shared across devices
  useEffect(() => {
    const pullShared = () => { syncSharedEventKey(); };
    pullShared();
    const id = setInterval(pullShared, 5000);
    return () => clearInterval(id);
  }, []);

  function login(cred) {
    const a = {
      username:  cred.username,
      seat:      cred.seat,
      role:      cred.role,
      name:      cred.name || cred.username,
      seatIndex: cred.seatIndex ?? -1,
      sessionId: cred.sessionId || null,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(a));
    setAuth(a);
    setMode(ROLE_DEFAULT[a.role] || "eyes");
  }

  function logout() {
    // Release field scout seat reservation
    if (auth?.role === "field_scout" && auth?.seat) {
      releaseSeatShared(auth.seat);
    }
    if ((auth?.role === "pit_scout" || auth?.role === "video_scout") && auth?.sessionId) {
      leaveRoleSessionShared(auth.role, auth.sessionId);
    }
    sessionStorage.removeItem(SESSION_KEY);
    setAuth(null);
  }

  if (!auth) return <LoginScreen onLogin={login} />;

  const isAdmin     = auth.role === "admin";
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <>
      <nav className="app-nav">
        <span className="app-title">REBUILT 2026</span>
        {visibleTabs.map((t) => (
          <button key={t.key} type="button" data-cy={`nav-${t.key}`}
            className={mode === t.key ? "active" : ""}
            onClick={() => setMode(t.key)}>
            {t.label}
          </button>
        ))}
        {isAdmin && (
          <button className="app-nav-import" onClick={() => setShowImport(true)} title="QR İçe Aktar">
            📥
          </button>
        )}
        <button className="app-nav-logout" onClick={logout} title="Çıkış yap">⏻</button>
      </nav>

      {mode === "eyes"    && <EyesFreeTerminal auth={auth} onLogout={logout}
                               initialMatchKey={retroMatchKey}
                               key={retroMatchKey || "default"} />}
      {mode === "pit"     && <PitScoutPanel    auth={auth} onLogout={logout} />}
      {mode === "video"   && <VideoScoutPanel />}
      {mode === "warroom" && <WarRoomDashboard />}
      {mode === "test"    && <TestDataPanel />}
      {mode === "admin"   && <AdminPanel />}
      {mode === "manual"  && <UserManual />}

      {syncToast && <div className="sync-toast">{syncToast}</div>}
      {showImport && <QrImportModal onClose={() => setShowImport(false)} />}
    </>
  );
}
