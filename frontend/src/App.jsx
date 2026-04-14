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
  getPitCredentials, getVideoCredentials, getAdminCredential,
  FIELD_SEATS, getSeatAssignments, isFreshSeat,
  getNextAvailableSeat, claimSeat, releaseSeat,
} from "./adminConfig";
import { getOfflineReports } from "./storage";
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

const DEVICE_ID = `app-${Math.random().toString(36).slice(2, 8)}`;

// Human-readable seat labels
const SEAT_LABEL = {
  red1: "R1", red2: "R2", red3: "R3",
  blue1: "M1", blue2: "M2", blue3: "M3",
};

// ─── UNIFIED LOGIN SCREEN ─────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  // ── Field scout state ──
  const [fieldName,    setFieldName]    = useState("");
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [assignments,  setAssignments]  = useState(getSeatAssignments);

  // Auto-suggest next free seat on first render
  useEffect(() => {
    setSelectedSeat(getNextAvailableSeat());
  }, []);

  // Refresh assignments when this component mounts (other devices may have claimed)
  useEffect(() => {
    setAssignments(getSeatAssignments());
  }, []);

  function fieldLogin() {
    const name = fieldName.trim();
    if (!name || !selectedSeat) return;
    claimSeat(selectedSeat, name);
    onLogin({
      username:  selectedSeat,
      seat:      selectedSeat,
      role:      "field_scout",
      name,
      seatIndex: FIELD_SEATS.indexOf(selectedSeat),
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

  const pitCreds   = getPitCredentials();
  const videoCreds = getVideoCredentials();
  const adminCred  = getAdminCredential();

  return (
    <div className="app-login">
      <img
        src="https://media.licdn.com/dms/image/v2/C4D0BAQGqCl_nrhQtdw/company-logo_200_200/company-logo_200_200/0/1671898098002/team_nf_logo?e=2147483647&v=beta&t=OGK3qeS0IF81gGSIehZTbXAiIky_AFMASexAWhewZH4"
        alt="Team NF" className="ef-nf-logo" />
      <h2 className="app-login-title">REBUILT SCOUTING</h2>
      <p className="app-login-sub">2026 · Team NF</p>

      {/* ── Saha Tayfa — ad + koltuk ── */}
      <p className="app-login-group-label">🕹 Saha Tayfa</p>
      <div className="app-field-login">
        <input
          className="app-field-name-input"
          placeholder="Adın..."
          value={fieldName}
          autoComplete="off"
          autoCapitalize="words"
          onChange={(e) => setFieldName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fieldLogin()}
        />

        <div className="app-seat-grid">
          {FIELD_SEATS.map((seat) => {
            const asgn    = assignments[seat];
            const isTaken = isFreshSeat(asgn);
            const isSel   = selectedSeat === seat;
            const isRed   = seat.startsWith("red");
            return (
              <button
                key={seat}
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
          className="app-field-go-btn"
          disabled={!fieldName.trim() || !selectedSeat}
          onClick={fieldLogin}
        >
          SAHA'YA GİR →
        </button>
      </div>

      {/* ── Pit + Video + Admin ── */}
      <div className="app-quick-row">
        <div>
          <p className="app-login-group-label">🔍 Pit Tayfa</p>
          <div className="app-quick-grid app-quick-grid--sm">
            {pitCreds.map((c) => (
              <button key={c.username} className="app-quick-btn qbtn-pit"
                onClick={() => attempt(c.username, c.pin)}>
                {c.seat.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="app-login-group-label">🎬 Video Tayfa</p>
          <div className="app-quick-grid app-quick-grid--sm">
            {videoCreds.map((c) => (
              <button key={c.username} className="app-quick-btn qbtn-video"
                onClick={() => attempt(c.username, c.pin)}>
                {c.seat.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="app-login-group-label">⚙️ Admin</p>
          <div className="app-quick-grid app-quick-grid--sm">
            <button className="app-quick-btn qbtn-admin"
              onClick={() => attempt(adminCred.username, adminCred.pin)}>
              ADMIN
            </button>
          </div>
        </div>
      </div>

      {/* ── Manuel PIN girişi (pit/video/admin) ── */}
      <div className="app-login-divider">pit / video / admin manuel giriş</div>
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

  // Auto-sync offline reports when network is restored
  useEffect(() => {
    const handleOnline = async () => {
      const reports = await getOfflineReports().catch(() => []);
      if (!reports.length) return;
      const { synced } = await syncReportsIfOnline(DEVICE_ID, reports);
      if (synced > 0) {
        setSyncToast(`✓ ${synced} rapor otomatik gönderildi`);
        setTimeout(() => setSyncToast(""), 4000);
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  function login(cred) {
    const a = {
      username:  cred.username,
      seat:      cred.seat,
      role:      cred.role,
      name:      cred.name || cred.username,
      seatIndex: cred.seatIndex ?? -1,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(a));
    setAuth(a);
    setMode(ROLE_DEFAULT[a.role] || "eyes");
  }

  function logout() {
    // Release field scout seat reservation
    if (auth?.role === "field_scout" && auth?.seat) {
      releaseSeat(auth.seat);
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
          <button key={t.key} className={mode === t.key ? "active" : ""}
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
