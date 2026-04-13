/**
 * QrImportModal — scan or paste offline QR data to import scout reports.
 *
 * Import flow:
 *   1. User uploads a screenshot of the QR OR pastes the raw base64 string.
 *   2. We decode base64 → TSV.
 *   3. Parse TSV rows (one per timeline event).
 *   4. Group by (match_key, team_key) → reconstruct partial reports.
 *   5. saveReport() for each reconstructed report.
 *
 * QR format (from qr.js toTabSeparated):
 *   header: match_key\tteam_key\thub_state\tscore_state\tt_ms\tx\ty\tmeta
 *   rows:   one per timeline event
 */
import { useRef, useState } from "react";
import { saveReport } from "../storage";

// ─── PARSER ───────────────────────────────────────────────────────────────────
function parseTsvToReports(tsv) {
  const lines = tsv.trim().split("\n");
  if (lines.length < 2) throw new Error("Geçersiz veri — en az 1 satır event bekleniyor.");

  const header = lines[0].split("\t");
  const col = (row, name) => {
    const i = header.indexOf(name);
    return i >= 0 ? row[i] : "";
  };

  const grouped = {};
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split("\t");
    const mk = col(row, "match_key");
    const tk = col(row, "team_key");
    if (!mk || !tk) continue;
    const key = `${mk}__${tk}`;
    if (!grouped[key]) grouped[key] = { match_key: mk, team_key: tk, timeline: [], location_pings: [] };

    const action = col(row, "score_state");
    const t_ms   = parseInt(col(row, "t_ms")) || 0;
    const x      = col(row, "x") !== "" ? parseFloat(col(row, "x")) : undefined;
    const y      = col(row, "y") !== "" ? parseFloat(col(row, "y")) : undefined;

    const ev = { action, t_ms };
    if (x != null) ev.x = x;
    if (y != null) ev.y = y;
    grouped[key].timeline.push(ev);

    if (action === "ping" && x != null && y != null) {
      grouped[key].location_pings.push({ t_ms, x, y });
    }
  }

  const reports = Object.values(grouped);
  if (!reports.length) throw new Error("Hiç rapor satırı bulunamadı.");
  return reports;
}

async function decodeQr(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Boş veri.");
  // Decode base64 → TSV
  try {
    const tsv = decodeURIComponent(escape(atob(trimmed)));
    return parseTsvToReports(tsv);
  } catch (e) {
    // Maybe it was pasted as raw TSV (not base64)
    if (trimmed.startsWith("match_key\t")) return parseTsvToReports(trimmed);
    throw new Error("Veri çözümlenemedi — geçerli QR base64 veya TSV giriniz.");
  }
}

async function scanFileWithBarcodeDetector(file) {
  if (!("BarcodeDetector" in window)) return null;
  try {
    const bitmap   = await createImageBitmap(file);
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    const codes    = await detector.detect(bitmap);
    bitmap.close();
    return codes[0]?.rawValue || null;
  } catch { return null; }
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function QrImportModal({ onClose }) {
  const fileRef  = useRef(null);
  const [paste,  setPaste]  = useState("");
  const [status, setStatus] = useState({ msg: "", ok: null });
  const [busy,   setBusy]   = useState(false);

  async function processRaw(raw) {
    setBusy(true);
    setStatus({ msg: "İşleniyor…", ok: null });
    try {
      const reports = await decodeQr(raw);
      for (const r of reports) await saveReport(r);
      setStatus({ msg: `✓ ${reports.length} rapor içe aktarıldı.`, ok: true });
      window.dispatchEvent(new Event("offlineReportsChanged"));
    } catch (e) {
      setStatus({ msg: `✗ ${e.message}`, ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus({ msg: "QR taranıyor…", ok: null });

    const raw = await scanFileWithBarcodeDetector(file);
    if (raw) {
      await processRaw(raw);
    } else {
      // BarcodeDetector unavailable or failed — read as text (TSV paste scenario)
      setStatus({ msg: "QR okunamadı. BarcodeDetector desteklenmiyor — aşağıya veriyi yapıştırın.", ok: false });
      setBusy(false);
    }
    e.target.value = "";
  }

  const hasBarcodeDetector = typeof window !== "undefined" && "BarcodeDetector" in window;

  return (
    <div className="qr-import-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qr-import-modal">
        <h3 className="qr-import-title">📥 QR İçe Aktar</h3>

        {hasBarcodeDetector ? (
          <>
            <div className="qr-import-drop" onClick={() => fileRef.current?.click()}>
              📷 QR ekran görüntüsü yükle (tıkla veya sürükle)
              <input ref={fileRef} type="file" accept="image/*"
                style={{ display: "none" }} onChange={onFile} />
            </div>
            <p className="qr-import-sep">— veya —</p>
          </>
        ) : (
          <p className="qr-import-sep" style={{ color: "var(--muted)", fontSize: "0.72rem" }}>
            Bu tarayıcı QR görüntü tarama desteklemiyor. Veriyi aşağıya yapıştırın.
          </p>
        )}

        <textarea
          className="qr-import-paste"
          placeholder="QR base64 veya TSV verisini buraya yapıştır..."
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={4}
        />

        {status.msg && (
          <p className={`qr-import-status ${status.ok === true ? "ok" : status.ok === false ? "err" : ""}`}>
            {status.msg}
          </p>
        )}

        <div className="qr-import-actions">
          <button className="qr-import-btn secondary" onClick={onClose}>Kapat</button>
          <button
            className="qr-import-btn primary"
            disabled={busy || !paste.trim()}
            onClick={() => processRaw(paste.trim())}>
            {busy ? "…" : "İçe Aktar"}
          </button>
        </div>
      </div>
    </div>
  );
}
