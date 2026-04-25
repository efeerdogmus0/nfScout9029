import { useMemo, useState } from "react";
import { API_BASE } from "../config";

export default function StrategyDashboard({ ourData, opponentData }) {
  const [prediction, setPrediction] = useState(null);
  const [llmPrompt, setLlmPrompt] = useState("");

  const hotspots = useMemo(() => {
    const pings = opponentData?.pings || [];
    const bumpCount = pings.filter((p) => p.nearBump).length;
    const trenchCount = pings.filter((p) => p.nearTrench).length;
    const result = [];
    if (bumpCount > 0) result.push("bump");
    if (trenchCount > 0) result.push("trench");
    return result;
  }, [opponentData]);

  async function runWinPredict() {
    const payload = {
      our_epa: ourData.epa || 30,
      opponent_epa: opponentData?.epa || 28,
      our_live_cycle_ms: ourData.shootDeltas || [],
      opponent_live_cycle_ms: opponentData?.shootDeltas || [9800, 10200],
      our_active_fuel: ourData.activeFuel || 0,
      opponent_active_fuel: opponentData?.activeFuel || 0,
    };
    const response = await fetch(`${API_BASE}/strategy/win-predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setPrediction(await response.json());
  }

  async function buildPrompt() {
    const response = await fetch(`${API_BASE}/strategy/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cycle_times: opponentData?.shootDeltas || [9800, 10200],
        hotspots,
        hub_state: ourData.hubState || "active",
      }),
    });
    const body = await response.json();
    setLlmPrompt(body.prompt);
  }

  return (
    <section>
      <h2>Strategy Dashboard</h2>
      <p>Statbotics EPA + canlı cycle datası ile win model.</p>
      <button data-cy="run-win-predict" onClick={runWinPredict}>Win Predict Hesapla</button>
      <button data-cy="build-llm-prompt" onClick={buildPrompt}>LLM Prompt Uret</button>
      {prediction && (
        <p data-cy="win-predict">
          Win%: {(prediction.win_probability * 100).toFixed(1)} - {prediction.rationale}
        </p>
      )}
      {llmPrompt && <textarea data-cy="llm-prompt" value={llmPrompt} readOnly rows={5} />}
    </section>
  );
}
