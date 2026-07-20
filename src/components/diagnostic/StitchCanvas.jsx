import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

/**
 * StitchCanvas — efficient Canvas viewer for embroidery geometry.
 *
 * Props:
 *  - entries: [{ geom, blocks, stitchColor, jumpColor, opacity, label }]
 *  - options: { showStitches, showJumps, showEnvelope, showBlocks, showStartEnd }
 *  - singleFit: if true, fit each entry individually (used in compare to keep scale)
 *
 * Drawing rules (per spec):
 *  - stitched segments: solid continuous line
 *  - jumps: dashed line (NEVER drawn as stitches)
 *  - color changes / block starts: markers
 *  - start / end: distinct markers
 *  - design envelope: dashed rectangle
 */
const StitchCanvas = forwardRef(function StitchCanvas({ entries, options, height = 460 }, ref) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const [, force] = useState(0);
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const [ready, setReady] = useState(false);

  useImperativeHandle(ref, () => ({
    fit: () => fitToScreen(),
    zoomBy: (f) => zoom(f),
  }));

  const opts = {
    showStitches: true,
    showJumps: true,
    showEnvelope: true,
    showBlocks: true,
    showStartEnd: true,
    ...options,
  };

  // Compute union world bounds across all entries.
  const worldBounds = () => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of entries || []) {
      const g = e.geom;
      if (!g || g.count === 0) continue;
      for (let i = 0; i < g.count; i++) {
        const x = g.xs[i], y = g.ys[i];
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  };

  const fitToScreen = () => {
    const canvas = canvasRef.current;
    const b = worldBounds();
    if (!canvas || !b) return;
    const cw = canvas.clientWidth || 600;
    const ch = canvas.clientHeight || height;
    const pad = 40;
    const sx = (cw - pad * 2) / Math.max(b.w, 0.001);
    const sy = (ch - pad * 2) / Math.max(b.h, 0.001);
    const scale = Math.min(sx, sy, 40);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    // world y up → canvas y down: flip
    viewRef.current = {
      scale,
      tx: cw / 2 - cx * scale,
      ty: ch / 2 + cy * scale, // + because y flipped
    };
    force((n) => n + 1);
  };

  const zoom = (factor, cx, cy) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const px = cx ?? cw / 2, py = cy ?? ch / 2;
    const v = viewRef.current;
    const wx = (px - v.tx) / v.scale;
    const wy = (py - v.ty) / -v.scale; // un-flip
    const ns = Math.max(0.2, Math.min(400, v.scale * factor));
    viewRef.current = {
      scale: ns,
      tx: px - wx * ns,
      ty: py + wy * ns,
    };
    force((n) => n + 1);
  };

  // Resize handling.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth, h = height;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setReady((r) => r + 1);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [height]);

  // Fit on entries change or once canvas size is known.
  useEffect(() => {
    fitToScreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, ready]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, cw, ch);

    const b = worldBounds();
    if (!b) {
      ctx.fillStyle = '#475569';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText('Sin geometría para mostrar.', 16, 24);
      return;
    }

    const v = viewRef.current;
    const toPx = (wx, wy) => [wx * v.scale + v.tx, -wy * v.scale + v.ty];

    // Envelope (union bounds).
    if (opts.showEnvelope) {
      const [x0, y0] = toPx(b.minX, b.minY);
      const [x1, y1] = toPx(b.maxX, b.maxY);
      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.5)';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.restore();
    }

    for (const e of entries || []) {
      const g = e.geom;
      if (!g || g.count === 0) continue;
      const stitchColor = e.stitchColor || '#a78bfa';
      const jumpColor = e.jumpColor || '#f59e0b';
      const opacity = e.opacity ?? 1;

      // Stitches (solid) — only segments between two consecutive stitches.
      if (opts.showStitches) {
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = stitchColor;
        ctx.lineWidth = 1.1;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let [sx0, sy0] = toPx(g.xs[0], g.ys[0]);
        ctx.moveTo(sx0, sy0);
        let drew = false;
        for (let i = 1; i < g.count; i++) {
          const t = g.types[i];
          const prev = g.types[i - 1];
          const [px, py] = toPx(g.xs[i], g.ys[i]);
          if (t === 0 && (prev === 0 || prev === 4)) {
            ctx.lineTo(px, py);
            drew = true;
          } else if (t === 0) {
            ctx.moveTo(px, py);
          }
        }
        if (drew) ctx.stroke();
        ctx.restore();
      }

      // Jumps (dashed) — never as stitches.
      if (opts.showJumps) {
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = jumpColor;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < g.count; i++) {
          if (g.types[i] !== 1) continue;
          const [px0, py0] = toPx(g.xs[i - 1], g.ys[i - 1]);
          const [px1, py1] = toPx(g.xs[i], g.ys[i]);
          ctx.moveTo(px0, py0);
          ctx.lineTo(px1, py1);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Block markers (color changes).
      if (opts.showBlocks && e.blocks) {
        const palette = ['#f87171', '#60a5fa', '#34d399', '#fbbf24', '#c084fc', '#22d3ee', '#fb923c', '#a3e635'];
        for (let bi = 0; bi < e.blocks.length; bi++) {
          const blk = e.blocks[bi];
          if (blk.start >= g.count) continue;
          const [px, py] = toPx(g.xs[blk.start], g.ys[blk.start]);
          ctx.fillStyle = palette[blk.colorIndex % palette.length];
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.5)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Start / End markers.
      if (opts.showStartEnd) {
        const [sx, sy] = toPx(g.xs[0], g.ys[0]);
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fill();
        const [ex, ey] = toPx(g.xs[g.count - 1], g.ys[g.count - 1]);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(ex - 4, ey - 4, 8, 8);
      }
    }

    // Scale ruler (1 cm).
    ctx.save();
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, sans-serif';
    const rulerMm = 10;
    const rulerPx = rulerMm * v.scale;
    ctx.fillRect(16, ch - 22, Math.max(8, rulerPx), 2);
    ctx.fillText(`${rulerMm} mm`, 16, ch - 26);
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, opts.showStitches, opts.showJumps, opts.showEnvelope, opts.showBlocks, opts.showStartEnd, ready, viewRef.current.scale, viewRef.current.tx, viewRef.current.ty]);

  const onWheel = (e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoom(factor, e.clientX - rect.left, e.clientY - rect.top);
  };

  const onPointerDown = (e) => {
    dragRef.current = { active: true, x: e.clientX, y: e.clientY };
    canvasRef.current.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current.x = e.clientX;
    dragRef.current.y = e.clientY;
    viewRef.current.tx += dx;
    viewRef.current.ty += dy;
    force((n) => n + 1);
  };
  const onPointerUp = (e) => {
    dragRef.current.active = false;
    try { canvasRef.current.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  return (
    <div className="relative rounded-xl border border-[#2a2d3a] bg-[#0b0d12] overflow-hidden">
      <div ref={wrapRef} className="w-full" style={{ height }}>
        <canvas
          ref={canvasRef}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="block cursor-grab active:cursor-grabbing touch-none"
        />
      </div>
      <div className="absolute top-2 right-2 flex gap-1">
        <button onClick={() => zoom(1.25)} className="rounded-md bg-[#161a23] border border-[#2a2d3a] p-1.5 text-slate-300 hover:border-violet-500" title="Acercar">
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => zoom(1 / 1.25)} className="rounded-md bg-[#161a23] border border-[#2a2d3a] p-1.5 text-slate-300 hover:border-violet-500" title="Alejar">
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => fitToScreen()} className="rounded-md bg-[#161a23] border border-[#2a2d3a] p-1.5 text-slate-300 hover:border-violet-500" title="Ajustar">
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="absolute bottom-2 left-2 flex flex-wrap gap-3 text-[9px] text-slate-400">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-violet-400" /> puntada</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: 'repeating-linear-gradient(90deg,#f59e0b 0 3px,transparent 3px 5px)' }} /> jump</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> inicio</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 bg-red-500" /> fin</span>
      </div>
    </div>
  );
});

export default StitchCanvas;