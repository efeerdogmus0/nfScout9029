import { useEffect, useRef, useState } from "react";

const WIDTH = 420;
const HEIGHT = 220;
const AUTO_SECONDS = 20;

export default function AutonomousPathCanvas({ onPathChange }) {
  const canvasRef = useRef(null);
  const [points, setPoints] = useState([]);

  useEffect(() => {
    drawField();
  }, [points]);

  useEffect(() => {
    onPathChange(points);
  }, [onPathChange, points]);

  function drawField() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.strokeStyle = "#22d3ee";
    ctx.strokeRect(12, 12, WIDTH - 24, HEIGHT - 24);

    ctx.fillStyle = "#334155";
    ctx.fillRect(130, 30, 40, 160);
    ctx.fillRect(250, 30, 40, 160);

    ctx.fillStyle = "#f59e0b";
    ctx.fillText("BUMP", 132, 25);
    ctx.fillText("TRENCH", 244, 25);

    if (points.length > 1) {
      ctx.strokeStyle = "#4ade80";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.stroke();
    }

    points.forEach((point) => {
      ctx.fillStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function handleCanvasClick(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const t_ms = Math.min(AUTO_SECONDS * 1000, points.length * 1200);
    setPoints((prev) => [...prev, { x, y, t_ms }]);
  }

  return (
    <section>
      <h2>Autonomous Path ({AUTO_SECONDS}s)</h2>
      <p>Haritada tıklayarak 20s auto rotasını çiz.</p>
      <canvas
        data-cy="auto-canvas"
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        onClick={handleCanvasClick}
      />
      <div>
        <button data-cy="auto-clear" onClick={() => setPoints([])}>Auto Path Temizle</button>
        <span data-cy="auto-point-count">Point: {points.length}</span>
      </div>
    </section>
  );
}
