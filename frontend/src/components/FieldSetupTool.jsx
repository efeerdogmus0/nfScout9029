/**
 * FieldSetupTool — saha kalibrasyon aracı.
 * Fotoğraf + zone verisi localStorage'a kaydedilir.
 * EyesFreeTerminal bu veriyi kullanarak gerçek fotoğrafı arka plan yapar.
 */
import { useEffect, useRef, useState } from "react";

const CW = 640;
const CH = 320;

// Zones the user draws manually
const ZONES = [
  { key: "fieldBoundary", label: "Saha Sınırı",   color: "#ffffff", mode: "rect",   hint: "Oyun alanı (driver station HARİÇ)" },
  { key: "neutralZone",   label: "Neutral Zone",   color: "#a78bfa", mode: "rect",   hint: "Orta nötr bölge" },
  { key: "blueZone",      label: "Blue Zone",      color: "#60a5fa", mode: "rect",   hint: "Blue alliance bölgesi" },
  { key: "redZone",       label: "Red Zone",       color: "#ef4444", mode: "rect",   hint: "Red alliance bölgesi" },
  { key: "blueHub",       label: "Blue HUB",       color: "#93c5fd", mode: "circle", hint: "Blue fuel hedefi — merkeze tıkla, kenara sürükle" },
  { key: "redHub",        label: "Red HUB",        color: "#f87171", mode: "circle", hint: "Red fuel hedefi — merkeze tıkla, kenara sürükle" },
  { key: "blue_bump1",    label: "Blue BUMP 1",    color: "#fbbf24", mode: "rect",   hint: "Blue taraf 1. bump → Red otomatik aynalar" },
  { key: "blue_bump2",    label: "Blue BUMP 2",    color: "#fbbf24", mode: "rect",   hint: "Blue taraf 2. bump → Red otomatik aynalar" },
  { key: "blue_trench1",  label: "Blue TRENCH 1",  color: "#94a3b8", mode: "rect",   hint: "Blue taraf 1. trench → Red otomatik aynalar" },
  { key: "blue_trench2",  label: "Blue TRENCH 2",  color: "#94a3b8", mode: "rect",   hint: "Blue taraf 2. trench → Red otomatik aynalar" },
  { key: "blueTower",     label: "Blue TOWER",     color: "#bfdbfe", mode: "rect",   hint: "Blue tırmanma kulesi" },
  { key: "redTower",      label: "Red TOWER",      color: "#fca5a5", mode: "rect",   hint: "Red tırmanma kulesi" },
];

// Keys that get auto-mirrored to a red counterpart
const MIRROR_PAIRS = [
  ["blue_bump1",   "red_bump1"],
  ["blue_bump2",   "red_bump2"],
  ["blue_trench1", "red_trench1"],
  ["blue_trench2", "red_trench2"],
];

// Mirror a rect horizontally within the field boundary
function mirrorRect(rect, boundary) {
  const fieldLeft  = boundary?.x ?? 0;
  const fieldRight = boundary ? boundary.x + boundary.w : CW;
  return { ...rect, x: fieldLeft + fieldRight - rect.x - rect.w };
}

// Migrate old key names from before the blue_/red_ rename
function migrateKeys(data) {
  const map = { bump1: "blue_bump1", bump2: "blue_bump2", trench1: "blue_trench1", trench2: "blue_trench2" };
  const out = { ...data };
  Object.entries(map).forEach(([old, nw]) => {
    if (out[old] && !out[nw]) { out[nw] = out[old]; delete out[old]; }
  });
  return out;
}

const LS_ZONES = "fieldCalibZones";
const LS_IMAGE = "fieldCalibImage";

function loadSaved() {
  try { return migrateKeys(JSON.parse(localStorage.getItem(LS_ZONES)) || {}); } catch { return {}; }
}

// eslint-disable-next-line no-unused-vars
export default function FieldSetupTool({ embedded = false }) {
  const canvasRef  = useRef(null);
  const imgRef     = useRef(null);
  const dragRef    = useRef(null);

  const [shapes,    setShapes]    = useState(loadSaved);
  const [activeKey, setActiveKey] = useState(ZONES[0].key);
  const [drawing,   setDrawing]   = useState(false);
  const [preview,   setPreview]   = useState(null);
  const [hasSaved,  setHasSaved]  = useState(false);

  const activeZone = ZONES.find((z) => z.key === activeKey);

  // ── Load stored image on mount ───────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem(LS_IMAGE);
    if (!stored) return;
    const img = new Image();
    img.onload = () => { imgRef.current = img; redraw(shapes, null); };
    img.src = stored;
  }, []);

  // ── File upload → resize to canvas size → store as base64 ───────────────────
  function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Resize to 640×320 offscreen canvas before storing
      const off = document.createElement("canvas");
      off.width = CW; off.height = CH;
      off.getContext("2d").drawImage(img, 0, 0, CW, CH);
      const b64 = off.toDataURL("image/jpeg", 0.85);
      localStorage.setItem(LS_IMAGE, b64);
      imgRef.current = img;
      redraw(shapes, null);
    };
    img.src = url;
  }

  // ── Auto-save zones to localStorage whenever shapes change ──────────────────
  useEffect(() => {
    localStorage.setItem(LS_ZONES, JSON.stringify(shapes));
    setHasSaved(true);
    const t = setTimeout(() => setHasSaved(false), 1000);
    return () => clearTimeout(t);
  }, [shapes]);

  // ── Canvas redraw ────────────────────────────────────────────────────────────
  function redraw(sh, prev) {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, CW, CH);

    // Background
    if (imgRef.current) {
      ctx.drawImage(imgRef.current, 0, 0, CW, CH);
    } else {
      ctx.fillStyle = "#0d1f36";
      ctx.fillRect(0, 0, CW, CH);
      ctx.fillStyle = "#94a3b8"; ctx.font = "16px monospace";
      ctx.fillText("← Saha fotoğrafı yükle", 20, CH / 2);
    }

    // Auto-mirrored red zones (dashed, drawn first so blue overlaps)
    const mirrorColors = { red_bump1: "#f59e0b", red_bump2: "#f59e0b", red_trench1: "#64748b", red_trench2: "#64748b" };
    Object.entries(mirrorColors).forEach(([key, color]) => {
      const s = sh[key];
      if (!s) return;
      ctx.setLineDash([5, 3]);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.fillStyle   = color + "22";
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.font = "bold 8px monospace";
      ctx.fillText(key.replace("red_", "").toUpperCase(), s.x + 2, s.y + 10);
    });

    // Drawn zones — render in order (fieldBoundary first, rest on top)
    const order = ["fieldBoundary", ...ZONES.map((z) => z.key).filter((k) => k !== "fieldBoundary")];
    order.forEach((key) => {
      const s = sh[key];
      if (!s) return;
      const z = ZONES.find((z) => z.key === key);
      ctx.setLineDash([]);
      ctx.strokeStyle = z.color;
      ctx.fillStyle   = z.color + "28";
      ctx.lineWidth   = key === "fieldBoundary" ? 3 : 2;

      if (z.mode === "rect") {
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.strokeRect(s.x, s.y, s.w, s.h);
        ctx.fillStyle = z.color;
        ctx.font = "bold 9px monospace";
        ctx.fillText(z.label, s.x + 4, s.y + 12);
      } else {
        ctx.beginPath(); ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = z.color; ctx.font = "bold 9px monospace";
        ctx.fillText(z.label, s.cx - 16, s.cy + s.r + 12);
      }
    });

    // In-progress preview
    if (prev) {
      ctx.strokeStyle = activeZone.color; ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      if (activeZone.mode === "rect") ctx.strokeRect(prev.x, prev.y, prev.w, prev.h);
      else {
        ctx.beginPath(); ctx.arc(prev.cx, prev.cy, prev.r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  useEffect(() => { redraw(shapes, preview); }, [shapes, preview, activeKey]);

  // ── Canvas coords ────────────────────────────────────────────────────────────
  function coords(e) {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - r.left) * (CW / r.width)),
      y: Math.round((e.clientY - r.top)  * (CH / r.height)),
    };
  }

  // ── Draw interaction ─────────────────────────────────────────────────────────
  function onDown(e) { dragRef.current = coords(e); setDrawing(true); }

  function onMove(e) {
    if (!drawing || !dragRef.current) return;
    const p = coords(e), o = dragRef.current;
    if (activeZone.mode === "rect") {
      setPreview({ x: Math.min(o.x, p.x), y: Math.min(o.y, p.y),
                   w: Math.abs(p.x - o.x), h: Math.abs(p.y - o.y) });
    } else {
      const dx = p.x - o.x, dy = p.y - o.y;
      setPreview({ cx: o.x, cy: o.y, r: Math.round(Math.sqrt(dx*dx + dy*dy)) });
    }
  }

  function onUp(e) {
    if (!drawing || !dragRef.current) return;
    const p = coords(e), o = dragRef.current;
    let shape;
    if (activeZone.mode === "rect") {
      const x = Math.min(o.x, p.x), y = Math.min(o.y, p.y);
      const w = Math.abs(p.x - o.x),  h = Math.abs(p.y - o.y);
      if (w < 4 || h < 4) { setDrawing(false); setPreview(null); return; }
      shape = { x, y, w, h };
    } else {
      const dx = p.x - o.x, dy = p.y - o.y;
      const r  = Math.round(Math.sqrt(dx*dx + dy*dy));
      if (r < 4) { setDrawing(false); setPreview(null); return; }
      shape = { cx: o.x, cy: o.y, r };
    }
    setShapes((prev) => {
      const next = { ...prev, [activeKey]: shape };
      // Auto-mirror blue zones to red
      const pair = MIRROR_PAIRS.find(([blueKey]) => blueKey === activeKey);
      if (pair) {
        next[pair[1]] = mirrorRect(shape, next.fieldBoundary);
      }
      return next;
    });
    setDrawing(false); setPreview(null);
    const next = ZONES.find((z) => z.key !== activeKey && !shapes[z.key]);
    if (next) setActiveKey(next.key);
  }

  function clearZone(key) { setShapes((prev) => { const c = { ...prev }; delete c[key]; return c; }); }
  function clearAll()     { setShapes({}); }

  function onJsonLoad(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw  = JSON.parse(ev.target.result);
        const data = migrateKeys(raw);
        if (typeof data === "object" && data !== null) {
          setShapes((prev) => {
            const merged = { ...prev, ...data };
            // Re-compute all mirrors from the loaded data
            MIRROR_PAIRS.forEach(([blueKey, redKey]) => {
              if (merged[blueKey]) merged[redKey] = mirrorRect(merged[blueKey], merged.fieldBoundary);
            });
            return merged;
          });
        }
      } catch { alert("Geçersiz JSON dosyası."); }
    };
    reader.readAsText(file);
    e.target.value = "";   // reset so same file can be re-loaded
  }

  const jsonOutput = JSON.stringify(shapes, null, 2);
  const doneCount  = ZONES.filter((z) => shapes[z.key]).length;
  const mirrorCount = MIRROR_PAIRS.filter(([, rk]) => shapes[rk]).length;

  return (
    <div className="fst-root">
      <h2>Saha Kalibre Aracı</h2>
      <p className="fst-hint">
        Fotoğraf yükle → zone seç → sürükle → otomatik kaydedilir.
        EyesFreeTerminal bu fotoğrafı ve koordinatları direkt kullanır.
        Tüm bitmeden de çalışır — saha grafiği anlık güncellenir.
      </p>

      <div className="fst-top-row">
        <label className="fst-upload">
          📂 Saha fotoğrafı yükle
          <input type="file" accept="image/*" onChange={onFileChange} />
        </label>
        <label className="fst-upload fst-upload--json">
          📋 JSON yükle
          <input type="file" accept=".json,application/json" onChange={onJsonLoad} />
        </label>
        <span className="fst-autosave">{hasSaved ? "✓ Otomatik kaydedildi" : `${doneCount}/${ZONES.length} zone · ${mirrorCount}/4 ayna`}</span>
        <button className="fst-clear-all" onClick={clearAll}>Tümünü Sil</button>
      </div>

      <div className="fst-workspace">
        {/* Zone list */}
        <div className="fst-zones">
          {ZONES.map((z) => (
            <div key={z.key}
              className={`fst-zone-item ${activeKey === z.key ? "active" : ""} ${shapes[z.key] ? "done" : ""}`}
              onClick={() => setActiveKey(z.key)}
              style={{ borderColor: z.color }}>
              <span className="fst-zi-dot" style={{ background: z.color }} />
              <div className="fst-zi-text">
                <span className="fst-zi-label">{z.label}</span>
                <span className="fst-zi-hint">{z.hint}</span>
              </div>
              {shapes[z.key] && <span className="fst-zi-check">✓</span>}
              {shapes[z.key] && (
                <button className="fst-zi-clear" onClick={(e) => { e.stopPropagation(); clearZone(z.key); }}>✕</button>
              )}
            </div>
          ))}
          <p className="fst-mode-tip">
            {activeZone.mode === "rect" ? "→ Sürükle: dikdörtgen" : "→ Merkeze tıkla, kenara sürükle: daire"}
          </p>
        </div>

        {/* Canvas */}
        <canvas ref={canvasRef} width={CW} height={CH} className="fst-canvas"
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
          onTouchStart={(e) => onDown(e.touches[0])}
          onTouchMove={(e) => { e.preventDefault(); onMove(e.touches[0]); }}
          onTouchEnd={(e) => onUp(e.changedTouches[0])} />
      </div>

      {/* JSON output */}
      <div className="fst-output">
        <div className="fst-output-header">
          <span>{doneCount}/{ZONES.length} zone tanımlandı</span>
          <button onClick={() => navigator.clipboard.writeText(jsonOutput)}>📋 JSON Kopyala</button>
        </div>
        <pre className="fst-json">{jsonOutput}</pre>
      </div>
    </div>
  );
}
