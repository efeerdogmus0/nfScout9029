import { useEffect, useRef, useState } from "react";

import AdminPanel        from "./components/AdminPanel";
import WarRoomDashboard  from "./components/WarRoomDashboard";
import TestDataPanel     from "./components/TestDataPanel";
import UserManual        from "./components/UserManual";
import EyesFreeTerminal from "./components/EyesFreeTerminal";
import PitScoutPanel    from "./components/PitScoutPanel";
import VideoScoutPanel  from "./components/VideoScoutPanel";
import {
  validateLogin, getScoutDisplayName,
  getFieldCredentials, getPitCredentials, getVideoCredentials, getAdminCredential,
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
  field_scout:  "eyes",
  pit_scout:    "pit",
  video_scout:  "video",
  admin:        "eyes",
};

// Nav tabs — adminOnly ones are hidden from non-admin users
const TABS = [
  { key: "eyes",    label: "🕹 Saha",      adminOnly: false },
  { key: "pit",     label: "🔍 Pit",       adminOnly: false },
  { key: "video",   label: "🎬 Video",     adminOnly: false },
  { key: "warroom", label: "⚡ War Room",  adminOnly: true  },
  { key: "admin",   label: "⚙️ Admin",    adminOnly: true  },
  { key: "test",    label: "🧪 Test",     adminOnly: true  },
  { key: "manual",  label: "📖 Kılavuz",  adminOnly: false },
];

const DEVICE_ID = `app-${Math.random().toString(36).slice(2, 8)}`;

// ─── UNIFIED LOGIN SCREEN ─────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [pin,      setPin]      = useState("");
  const [err,      setErr]      = useState("");
  const inputRef = useRef(null);

  function attempt(u, p) {
    const cred = validateLogin(u ?? username, p ?? pin);
    if (cred) { onLogin(cred); }
    else { setErr("Hatalı kullanıcı adı veya PIN."); setPin(""); }
  }

  // Quick-login button groups
  const fieldCreds = getFieldCredentials();
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

      {/* ── Saha Tayfa ── */}
      <p className="app-login-group-label">🕹 Saha Tayfa</p>
      <div className="app-quick-grid app-quick-grid--field">
        {fieldCreds.slice(0, 6).map((c) => {
          const isRed = c.seat.startsWith("red");
          return (
            <button key={c.username}
              className={`app-quick-btn ${isRed ? "qbtn-red" : "qbtn-blue"}`}
              onClick={() => attempt(c.username, c.pin)}>
              {c.seat.replace("red","R").replace("blue","B").toUpperCase()}
            </button>
          );
        })}
        {fieldCreds.slice(6).map((c) => (
          <button key={c.username} className="app-quick-btn qbtn-extra"
            onClick={() => attempt(c.username, c.pin)}>
            {c.seat.replace("seat","S-").toUpperCase()}
          </button>
        ))}
      </div>

      {/* ── Pit + Video ── */}
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

      {/* ── Manuel giriş ── */}
      <div className="app-login-divider">veya manuel gir</div>
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
  const [auth,       setAuth]       = useState(getStoredAuth);
  const [mode,       setMode]       = useState(() => {
    const a = getStoredAuth();
    return a ? (ROLE_DEFAULT[a.role] || "eyes") : "eyes";
  });
  const [syncToast,    setSyncToast]    = useState("");
  const [showImport,   setShowImport]   = useState(false);
  const [retroMatchKey, setRetroMatchKey] = useState(null); // for retroactive scouting

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

  // Clear retroMatchKey when leaving eyes mode so next visit starts fresh
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
      username: cred.username,
      seat:     cred.seat,
      role:     cred.role,
      name:     getScoutDisplayName(cred.username),
      seatIndex: cred.seatIndex ?? -1,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(a));
    setAuth(a);
    setMode(ROLE_DEFAULT[a.role] || "eyes");
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    setAuth(null);
  }

  if (!auth) return <LoginScreen onLogin={login} />;

  const isAdmin    = auth.role === "admin";
  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin);

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
