import { useMemo, useState } from "react";

import { buildQrDataUrl } from "../qr";
import { getOfflineReports, saveReport } from "../storage";

const TELEOP_SECONDS = 140;

export default function TeleopTracker() {
  const [hubState, setHubState] = useState("active");
  const [activeFuel, setActiveFuel] = useState(0);
  const [inactiveFuel, setInactiveFuel] = useState(0);
  const [shootTimes, setShootTimes] = useState([]);
  const [pings, setPings] = useState([]);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const avgCycle = useMemo(() => {
    if (shootTimes.length < 2) return 0;
    const deltas = shootTimes.slice(1).map((t, i) => t - shootTimes[i]);
    return deltas.reduce((a, b) => a + b, 0) / deltas.length;
  }, [shootTimes]);

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

  async function saveOffline() {
    const report = {
      teleopSeconds: TELEOP_SECONDS,
      hubState,
      activeFuel,
      inactiveFuel,
      shootTimes,
      pings,
    };
    await saveReport(report);
    const latest = getOfflineReports();
    setQrDataUrl(await buildQrDataUrl({ reports: latest.length ? latest : [report] }));
  }

  return (
    <section>
      <h2>Teleop Action Tracker</h2>
      <p>Teleop window: {TELEOP_SECONDS} seconds</p>
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
        <button data-cy="save-offline" onClick={saveOffline}>Save Offline + Generate QR</button>
      </div>
      {qrDataUrl && <img data-cy="qr-image" src={qrDataUrl} alt="Offline report QR" />}
    </section>
  );
}
