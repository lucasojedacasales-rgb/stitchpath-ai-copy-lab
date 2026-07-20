import { useRef, useEffect, useMemo } from 'react';
import { DEFAULT_MACHINE } from '@/lib/exportPipeline';

/**
 * ValidationPreview — Canvas that renders the stitch path and highlights
 * commands flagged by the validation pipeline in red.
 *
 * Props:
 *   commands       — flat command array from the export pipeline
 *   errors         — validation errors (each may have .index pointing into commands)
 *   currentIndex   — index of the error currently being reviewed (gets a marker)
 *   machineSettings — hoop size + offset for coordinate mapping
 *   height         — canvas display height in px (default 180)
 */
export default function ValidationPreview({ commands, errors, currentIndex, machineSettings, height = 180 }) {
  const canvasRef = useRef(null);
  const ms = { ...DEFAULT_MACHINE, ...machineSettings };
  const [hw, hh] = ms.hoopSize;

  // Set of command indices that have validation errors — O(1) lookup
  const errorIndices = useMemo(() => {
    const set = new Set();
    for (const e of errors || []) {
      if (e?.index !== undefined && e?.index !== null) set.add(e.index);
    }
    return set;
  }, [errors]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;
    const displayW = parent ? parent.clientWidth : 400;
    const displayH = height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    canvas.style.width = displayW + 'px';
    canvas.style.height = displayH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ── Background ──────────────────────────────────────────────────────
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(0, 0, displayW, displayH);

    // ── Coordinate transform: mm → canvas px (origin at hoop center) ─────
    const padding = 14;
    const scale = Math.min((displayW - padding * 2) / hw, (displayH - padding * 2) / hh);
    const ox = displayW / 2;
    const oy = displayH / 2;
    const toCanvas = (x, y) => [ox + x * scale, oy - y * scale];

    // ── Hoop boundary ───────────────────────────────────────────────────
    ctx.strokeStyle = '#1e2130';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    const [bx, by] = toCanvas(-hw / 2, hh / 2);
    ctx.strokeRect(bx, by, hw * scale, hh * scale);
    ctx.setLineDash([]);

    // Center crosshair
    ctx.strokeStyle = '#1a1d28';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(ox - 4, oy); ctx.lineTo(ox + 4, oy);
    ctx.moveTo(ox, oy - 4); ctx.lineTo(ox, oy + 4);
    ctx.stroke();

    if (!commands || commands.length === 0) {
      ctx.fillStyle = '#3a3d4a';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Sin puntadas', ox, oy + 4);
      return;
    }

    // ── Draw stitch sequence ────────────────────────────────────────────
    let prevX = 0, prevY = 0;
    for (let i = 0; i < commands.length; i++) {
      const c = commands[i];
      if (!c) continue;
      if (c.type === 'end') break;
      if (c.type === 'colorChange' || c.type === 'trim') {
        if (c.x !== undefined && Number.isFinite(c.x)) { prevX = c.x; prevY = c.y; }
        continue;
      }
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;

      const [px, py] = toCanvas(prevX, prevY);
      const [qx, qy] = toCanvas(c.x, c.y);
      const hasError = errorIndices.has(i);

      if (c.type === 'jump') {
        ctx.strokeStyle = hasError ? '#ef4444' : 'rgba(100,116,139,0.2)';
        ctx.lineWidth = hasError ? 1.5 : 0.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(qx, qy);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // stitch — thread color normally, bright red if flagged
        ctx.strokeStyle = hasError ? '#ef4444' : (c.color || '#a78bfa');
        ctx.globalAlpha = hasError ? 1 : 0.65;
        ctx.lineWidth = hasError ? 2 : 0.8;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(qx, qy);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      prevX = c.x;
      prevY = c.y;
    }

    // ── Highlight current error command with a marker ───────────────────
    if (currentIndex !== undefined && currentIndex !== null && commands[currentIndex]) {
      const c = commands[currentIndex];
      if (c.x !== undefined && Number.isFinite(c.x) && Number.isFinite(c.y)) {
        const [mx, my] = toCanvas(c.x, c.y);
        // Crosshair lines
        ctx.strokeStyle = 'rgba(239,68,68,0.35)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(mx - 14, my); ctx.lineTo(mx + 14, my);
        ctx.moveTo(mx, my - 14); ctx.lineTo(mx, my + 14);
        ctx.stroke();
        ctx.setLineDash([]);
        // Outer ring
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(mx, my, 8, 0, Math.PI * 2);
        ctx.stroke();
        // Inner dot
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(mx, my, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [commands, errorIndices, currentIndex, hw, hh, height]);

  return (
    <div className="relative rounded-lg border border-[#1e2130] overflow-hidden bg-[#0a0c12]">
      <canvas ref={canvasRef} className="block" />
      {/* Legend */}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-2.5 text-[9px] text-slate-500 bg-[#0a0c12]/85 px-2 py-1 rounded border border-[#1e2130]">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-px bg-violet-400" /> Puntada
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-px bg-slate-600" /> Salto
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-red-500" /> A corregir
        </span>
      </div>
      {/* Error count badge */}
      {errorIndices.size > 0 ? (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 text-[9px] text-red-400 bg-red-950/60 px-2 py-1 rounded border border-red-500/30">
          <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
          {errorIndices.size} marcadas
        </div>
      ) : commands && commands.length > 0 ? (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 text-[9px] text-emerald-400 bg-emerald-950/60 px-2 py-1 rounded border border-emerald-500/30">
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
          Limpio
        </div>
      ) : null}
    </div>
  );
}