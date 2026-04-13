import { useEffect, useMemo, useRef, useState } from "react";

import { buildQrDataUrl } from "../qr";
import { clearOfflineReports, getOfflineReports, saveReport } from "../storage";
import { syncReportsIfOnline } from "../sync";

const TELEOP_SECONDS = 140;

export default function TeleopTracker({ autoPathPoints, onScoutData }) {
  const [hubState, setHubState] = useState("active");
  const [activeFuel, setActiveFuel] = useState(0);
  const [inactiveFuel, setInactiveFuel] = useState(0);
  const [shootTimes, setShootTimes] = useState([]);
  const [pings, setPings] = useState([]);
  const [secondsLeft, setSecondsLeft] = useState(TELEOP_SECONDS);
  const [teleopRunning, setTeleopRunning] = useState(false);
  const [bumpSlow, setBumpSlow] = useState(false);
  const [trenchSlow, setTrenchSlow] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [syncResult, setSyncResult] = useState("");
  const timerRef = useRef(null);
  const pingRef = useRef(null);

  const avgCycle = useMemo(() => {
    if (shootTimes.length < 2) return 0;
    const deltas = shootTimes.slice(1).map((t, i) => t - shootTimes[i]);
    return deltas.reduce((a, b) => a + b, 0) / deltas.length;
  }, [shootTimes]);

  useEffect(() => {
    if (!teleopRunning) return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setTeleopRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    pingRef.current = setInterval(() => {
      addPing();
    }, 10000);

    return () => {
      clearInterval(timerRef.current);
      clearInterval(pingRef.current);
    };
  }, [teleopRunning]);

  useEffect(() => {
    onScoutData?.({
      hubState,
      activeFuel,
      inactiveFuel,
      pings,
      shootDeltas: shootTimes.slice(1).map((t, i) => t - shootTimes[i]),
      bumpSlow,
      trenchSlow,
    });
  }, [hubState, activeFuel, inactiveFuel, pings, shootTimes, bumpSlow, trenchSlow, onScoutData]);

  function addFuel() {
    if (hubState === "active") setActiveFuel((v) => v + 1);
    else setInactiveFuel((v) => v + 1);
  }

  function markShoot() {
    setShootTimes((prev) => [...prev, Date.now()]);
  }

  function addPing() {
    const ping = {
      t: Date.now(),
      x: Math.random() * 100,
      y: Math.random() * 100,
      nearBump: Math.random() > 0.5,
      nearTrench: Math.random() > 0.5,
    };
    setPings((prev) => [...prev, ping]);
  }

  function toggleTeleop() {
    if (secondsLeft === 0) setSecondsLeft(TELEOP_SECONDS);
    setTeleopRunning((v) => !v);
  }

  async function saveOffline() {
    const report = {
      event_key: "2026demo",
      match_key: "2026demo_qm1",
      team_key: "frc0000",
      scout_device_id: "web-scout-1",
      auto_path_points: autoPathPoints || [],
      auto_fuel_scored: 0,
      teleopSeconds: TELEOP_SECONDS,
      hubState,
      teleop_fuel_scored_active: activeFuel,
      teleop_fuel_scored_inactive: inactiveFuel,
      teleop_shoot_timestamps_ms: shootTimes,
      location_pings: pings,
      bump_slow_or_stuck: bumpSlow,
      trench_slow_or_stuck: trenchSlow,
      tower_level: "none",
    };
    await saveReport(report);
    const latest = await getOfflineReports();
    setQrDataUrl(await buildQrDataUrl({ reports: latest.length ? latest : [report] }));
  }

  async function syncNow() {
    const reports = await getOfflineReports();
    const result = await syncReportsIfOnline("web-scout-1", reports);
    setSyncResult(`Synced: ${result.synced}`);
    if (result.synced > 0) {
      await clearOfflineReports();
    }
  }

  return (
    <section>
      <h2>Teleop Action Tracker</h2>
      <p>Teleop window: {TELEOP_SECONDS} seconds</p>
      <div>
        <button data-cy="toggle-teleop" onClick={toggleTeleop}>
          {teleopRunning ? "Teleop Pause" : "Teleop Start"}
        </button>
        <span data-cy="teleop-seconds-left">Remaining: {secondsLeft}s</span>
      </div>
      <div>
        <button data-cy="hub-active" onClick={() => setHubState("active")}>HUB Active</button>
        <button data-cy="hub-inactive" onClick={() => setHubState("inactive")}>HUB Inactive</button>
        <span data-cy="hub-state">Current: {hubState}</span>
      </div>
      <div>
        <button data-cy="add-fuel" onClick={addFuel}>+1 FUEL</button>
        <span data-cy="active-count">Active: {activeFuel}</span>
        <span data-cy="inactive-count">Inactive: {inactiveFuel}</span>
      </div>
      <div>
        <button data-cy="shoot" onClick={markShoot}>Shoot</button>
        <p data-cy="avg-cycle-ms">Avg cycle (ms): {Math.round(avgCycle)}</p>
      </div>
      <div>
        <button data-cy="ping" onClick={addPing}>10s Ping</button>
        <p data-cy="ping-count">Pings: {pings.length}</p>
      </div>
      <div>
        <label>
          <input data-cy="bump-stuck" type="checkbox" checked={bumpSlow} onChange={(e) => setBumpSlow(e.target.checked)} />
          BUMP uzerinde yavasladi/takildi
        </label>
        <label>
          <input
            data-cy="trench-stuck"
            type="checkbox"
            checked={trenchSlow}
            onChange={(e) => setTrenchSlow(e.target.checked)}
          />
          TRENCH uzerinde yavasladi/takildi
        </label>
      </div>
      <div>
        <button data-cy="save-offline" onClick={saveOffline}>Save Offline + Generate QR</button>
        <button data-cy="sync-now" onClick={syncNow}>Sync Now</button>
      </div>
      {syncResult && <p data-cy="sync-result">{syncResult}</p>}
      {qrDataUrl && <img data-cy="qr-image" src={qrDataUrl} alt="Offline report QR" />}
    </section>
  );
}
