/**
 * PhysicsSimulator.jsx
 *
 * Vista de simulación física de bordado.
 * Reemplaza el canvas de puntadas planas con un render físico completo:
 * grosor, relieve, brillo, underlay, tensión y textura de tela.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Download, Sliders } from 'lucide-react';
import { generateTatamiFill } from '@/lib/tatamiFill';
import {
  drawFabricTexture,
  drawPhysicalStitch,
  drawUnderlayStitches,
  FABRIC_SIM_PARAMS,
  STITCH_TYPE_PROFILES,
} from '@/lib/physicsSimulator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isContourRegion(region) {
  if (!region) return false;
  if ((region.name || '').toLowerCase().includes('contour_')) return true;
  const hex = (region.color || '').toLowerCase();
  return hex === '#000000' || hex === '#1a1a1a';
}

function getDrawSize(imageEl, W, H) {
  if (!imageEl) return { drawW: W * 0.75, drawH: H * 0.75 };
  const iw = imageEl.width, ih = imageEl.height;
  const s = Math.min(W * 0.75 / iw, H * 0.75 / ih);
  return { drawW: iw * s, drawH: ih * s };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PhysicsSimulator({ imageUrl, regions, config }) {
  const fabricCanvasRef  = useRef(null);
  const stitchCanvasRef  = useRef(null);
  const postCanvasRef    = useRef(null);   // post-processing: vignette + color grading
  const containerRef     = useRef(null);
  const imageRef         = useRef(null);
  const stitchCacheRef   = useRef(new Map());

  const [zoom, setZoom]     = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart]   = useState(null);
  const [showControls, setShowControls] = useState(false);

  const fabricType = config?.fabric_type || 'Algodón';
  const fabricPreset = FABRIC_SIM_PARAMS[fabricType] || FABRIC_SIM_PARAMS['Algodón'];

  // Controles de simulación — threadScale es un multiplicador (1.0 = físicamente correcto)
  const [simParams, setSimParams] = useState({
    threadScale:   1.0,    // multiplicador de grosor (1.0 = diámetro físico real)
    tension:       fabricPreset.tensionBase,
    glossiness:    fabricPreset.glossiness,
    lightAngleDeg: fabricPreset.lightAngleDeg,
    showUnderlay:  true,
  });

  // Actualizar parámetros cuando cambia el tejido
  useEffect(() => {
    const p = FABRIC_SIM_PARAMS[fabricType] || FABRIC_SIM_PARAMS['Algodón'];
    setSimParams(prev => ({
      ...prev,
      tension:       p.tensionBase,
      glossiness:    p.glossiness,
      lightAngleDeg: p.lightAngleDeg,
    }));
    stitchCacheRef.current.clear();
  }, [fabricType]);

  // Stable refs to always-current draw functions — avoids stale closure in ResizeObserver
  const drawFabricRef  = useRef(null);
  const drawStitchesRef = useRef(null);

  // Resize observer — uses refs so it always calls the latest version of the draw functions
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      resizeCanvases();
      drawFabricRef.current?.();
      drawStitchesRef.current?.();
    });
    if (containerRef.current) obs.observe(containerRef.current);
    resizeCanvases();
    return () => obs.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load image — uses refs to avoid stale closure on first render
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      drawFabricRef.current?.();
      drawStitchesRef.current?.();
    };
    img.src = imageUrl;
  }, [imageUrl]);

  function resizeCanvases() {
    const el = containerRef.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;
    for (const ref of [fabricCanvasRef, stitchCanvasRef, postCanvasRef]) {
      if (ref.current) { ref.current.width = W; ref.current.height = H; }
    }
  }

  // ── Layer 1: Tejido ─────────────────────────────────────────────────────────
  const drawFabric = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    drawFabricTexture(ctx, W, H, fabricType);
  }, [fabricType]);

  // ── Layer 3: Post-processing fotográfico ─────────────────────────────────────
  const drawPostProcess = useCallback(() => {
    const canvas = postCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Viñeta fotográfica — oscurece los bordes como una lente real
    const vignette = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.30, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(0.7, 'rgba(0,0,0,0)');
    vignette.addColorStop(1,   'rgba(0,0,0,0.38)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    // Micro-grain fotográfico (simula ruido de sensor de cámara real)
    const imageData = ctx.getImageData(0, 0, W, H);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 6;
      data[i]   = Math.max(0, Math.min(255, data[i]   + noise));
      data[i+1] = Math.max(0, Math.min(255, data[i+1] + noise));
      data[i+2] = Math.max(0, Math.min(255, data[i+2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  // ── Layer 2: Puntadas físicas ───────────────────────────────────────────────
  const drawStitches = useCallback(() => {
    const canvas = stitchCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    if (!regions || regions.length === 0) return;

    const { drawW, drawH } = getDrawSize(imageRef.current, W, H);

    ctx.save();
    ctx.translate(offset.x + W / 2, offset.y + H / 2);
    ctx.scale(zoom, zoom);

    // Sort regions: use travelOrder/priority from region builder when available.
    // Contour/outline regions always go last regardless of priority.
    // Falls back to stitch_type ordering for regions without computed priority.
    const sorted = [...regions]
      .filter(r => r.path_points?.length >= 3 && r.visible !== false)
      .sort((a, b) => {
        const aContour = isContourRegion(a);
        const bContour = isContourRegion(b);
        if (aContour && !bContour) return 1;
        if (!aContour && bContour) return -1;
        // Use travelOrder if both have it (most accurate — computed by enrichAllRegions)
        if (a.travelOrder != null && b.travelOrder != null) return a.travelOrder - b.travelOrder;
        // Fall back to priority: lower priority = drawn first (bottom layer), higher = drawn last (on top)
        const pa = a.priority ?? (a.stitch_type === 'fill' ? 2 : a.stitch_type === 'satin' ? 5 : 8);
        const pb = b.priority ?? (b.stitch_type === 'fill' ? 2 : b.stitch_type === 'satin' ? 5 : 8);
        return pa - pb; // lower priority drawn first (background), higher priority drawn last (details on top)
      });

    // pxPerMm based on actual design size in mm
    const designWidthMm  = config?.width_mm  || 100;
    const designHeightMm = config?.height_mm || 100;
    const pxPerMm = Math.min(drawW / designWidthMm, drawH / designHeightMm);

    // Grosor físico real: 40wt = 0.38mm. Escalado a px * multiplicador de tejido * control usuario.
    const threadMult        = FABRIC_SIM_PARAMS[fabricType]?.threadMult || 1;
    const physicalThreadPx  = 0.38 * pxPerMm * threadMult * (simParams.threadScale || 1.0);
    const threadThicknessPx = Math.max(1.0, physicalThreadPx);
    const baseParams = {
      ...simParams,
      threadThicknessPx,
      zoom,
    };

    for (let layerIdx = 0; layerIdx < sorted.length; layerIdx++) {
      const region = sorted[layerIdx];
      const pts = region.path_points;
      const color = region.color || '#ffffff';
      const effectiveType = isContourRegion(region) ? 'running_stitch' : region.stitch_type;
      const layerDepth = Math.min(layerIdx / sorted.length * 2, 1.5);

      const regionParams = { ...baseParams, layerDepth, stitchType: effectiveType };

      // Clip a la región
      ctx.save();
      ctx.beginPath();
      ctx.moveTo((pts[0][0] - 0.5) * drawW, (pts[0][1] - 0.5) * drawH);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo((pts[i][0] - 0.5) * drawW, (pts[i][1] - 0.5) * drawH);
      }
      ctx.closePath();
      ctx.clip();

      if (effectiveType === 'fill') {
        // Obtener o generar puntadas Tatami
        const density  = region.density || region.tatami_density || region.density_mm || 0.38;
        const angle    = region.fill_angle ?? region.angle ?? region.orientation ?? 45;
        // stitch_length_mm is set by the Adaptive Engine per-region; no fixed fallback
        const stitchLenMm = region.stitch_length_mm ?? 3.0;
        const cacheKey = `${region.id}_${drawW.toFixed(0)}_${drawH.toFixed(0)}_${angle}_${density.toFixed(3)}_${stitchLenMm}_${region.color}`;
        let cached = stitchCacheRef.current.get(cacheKey);
        if (!cached) {
          const polygon = pts.map(p => [(p[0] - 0.5) * drawW, (p[1] - 0.5) * drawH]);
          const { stitches } = generateTatamiFill(polygon, density, stitchLenMm, angle, pxPerMm);
          cached = stitches;
          stitchCacheRef.current.set(cacheKey, cached);
        }

        // Underlay primero
        if (simParams.showUnderlay && region.underlay !== false) {
          drawUnderlayStitches(ctx, cached, color, { ...regionParams, zoom, stitchType: 'fill' });
        }

        // Puntadas físicas principales
        ctx.globalAlpha = 0.96;
        for (const [x0, y0, x1, y1] of cached) {
          drawPhysicalStitch(ctx, x0, y0, x1, y1, color, regionParams);
        }
        ctx.globalAlpha = 1;

      } else if (effectiveType === 'satin') {
        // Satén: columnas densas perpendiculares — espaciado = diámetro real del hilo satin (0.35mm)
        const satinAngle = (((region.fill_angle ?? region.angle ?? 45)) * Math.PI) / 180;
        const satinDiamMm = STITCH_TYPE_PROFILES.satin.threadDiameterMm; // 0.35mm
        const satinSpacingPx = Math.max(1.0, satinDiamMm * pxPerMm);

        const xs = pts.map(p => (p[0] - 0.5) * drawW);
        const ys = pts.map(p => (p[1] - 0.5) * drawH);
        const cx2 = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy2 = (Math.min(...ys) + Math.max(...ys)) / 2;
        const diagLen = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.5 + satinSpacingPx * 2;

        ctx.save();
        ctx.translate(cx2, cy2);
        ctx.rotate(satinAngle);
        for (let sy = -diagLen; sy <= diagLen; sy += satinSpacingPx) {
          drawPhysicalStitch(ctx, -diagLen, sy, diagLen, sy, color, { ...regionParams, zoom });
        }
        ctx.restore();

      } else {
        // Running stitch: puntadas individuales con perfil físico
        const dashPx  = Math.max(2, 3.5 / zoom);
        const gapPx   = Math.max(1.5, 2.5 / zoom);
        let accumulated = 0;
        let drawing = true;

        for (let i = 0; i < pts.length - 1; i++) {
          const x0c = (pts[i][0]   - 0.5) * drawW;
          const y0c = (pts[i][1]   - 0.5) * drawH;
          const x1c = (pts[i+1][0] - 0.5) * drawW;
          const y1c = (pts[i+1][1] - 0.5) * drawH;
          const segLen = Math.hypot(x1c - x0c, y1c - y0c);
          if (segLen < 0.1) continue;

          let t = 0;
          while (t < 1) {
            const remaining = drawing ? dashPx - accumulated : gapPx - accumulated;
            const tEnd = Math.min(t + remaining / segLen, 1);
            if (drawing) {
              drawPhysicalStitch(
                ctx,
                x0c + (x1c - x0c) * t,     y0c + (y1c - y0c) * t,
                x0c + (x1c - x0c) * tEnd,   y0c + (y1c - y0c) * tEnd,
                color, regionParams
              );
            }
            accumulated += (tEnd - t) * segLen;
            if (accumulated >= (drawing ? dashPx : gapPx) - 0.01) {
              drawing = !drawing;
              accumulated = 0;
            }
            t = tEnd;
            if (tEnd >= 1) break;
          }
        }
      }

      ctx.restore(); // clip
    }

    ctx.restore(); // transform

    // Badge de info
    ctx.save();
    ctx.font = 'bold 11px Inter, sans-serif';
    const stitchCount = regions.reduce((s, r) => s + (r.stitch_count || 0), 0);
    const text = `${Math.round(zoom * 100)}%  ·  ${fabricType}  ·  ${stitchCount.toLocaleString()} pts`;
    const tw = ctx.measureText(text).width;
    const bw = tw + 16, bh = 22, bx = W - bw - 12, by = 12;
    ctx.fillStyle = 'rgba(13,15,20,0.85)';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 4); ctx.fill();
    ctx.strokeStyle = '#2a2d3a'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(text, bx + 8, by + 15);
    ctx.restore();

    // Post-process después de las puntadas
    drawPostProcess();
  }, [regions, zoom, offset, simParams, fabricType]);

  // Keep refs current so ResizeObserver always calls the latest version
  useEffect(() => { drawFabricRef.current  = drawFabric;  }, [drawFabric]);
  useEffect(() => { drawStitchesRef.current = drawStitches; }, [drawStitches]);

  // Redraw on param/region/zoom changes
  useEffect(() => { drawFabric(); drawStitches(); drawPostProcess(); }, [regions, zoom, offset, simParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Interacción ──────────────────────────────────────────────────────────────
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom(z => Math.max(0.2, Math.min(20, z * delta)));
  };
  const handleMouseDown = (e) => { setIsDragging(true); setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y }); };
  const handleMouseMove = (e) => { if (isDragging && dragStart) setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); };
  const handleMouseUp   = () => { setIsDragging(false); setDragStart(null); };

  const fitToScreen = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };

  const downloadPNG = () => {
    const W = fabricCanvasRef.current?.width || 800;
    const H = fabricCanvasRef.current?.height || 600;
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const ctx = tmp.getContext('2d');
    if (fabricCanvasRef.current) ctx.drawImage(fabricCanvasRef.current, 0, 0);
    if (stitchCanvasRef.current) ctx.drawImage(stitchCanvasRef.current, 0, 0);
    if (postCanvasRef.current)   ctx.drawImage(postCanvasRef.current,   0, 0);
    const a = document.createElement('a'); a.download = 'physics-preview.png'; a.href = tmp.toDataURL('image/png', 0.95); a.click();
  };

  const set = (key, val) => {
    setSimParams(prev => ({ ...prev, [key]: val }));
    if (key === 'threadScale') stitchCacheRef.current.clear();
  };

  return (
    <div className="flex flex-col w-full h-full">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0d0f14] border-b border-[#1e2130] flex-shrink-0">
        <div className="flex items-center gap-1">
          <ToolBtn onClick={() => setZoom(z => Math.min(20, z * 1.25))} title="Zoom In"><ZoomIn className="w-3.5 h-3.5" /></ToolBtn>
          <ToolBtn onClick={() => setZoom(z => Math.max(0.2, z / 1.25))} title="Zoom Out"><ZoomOut className="w-3.5 h-3.5" /></ToolBtn>
          <ToolBtn onClick={fitToScreen} title="Ajustar"><Maximize2 className="w-3.5 h-3.5" /></ToolBtn>
          <div className="w-px h-4 bg-[#2a2d3a] mx-1" />
          <ToolBtn
            onClick={() => setShowControls(v => !v)}
            title="Parámetros de simulación"
            active={showControls}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span className="ml-1 text-xs">Parámetros</span>
          </ToolBtn>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-amber-400 font-semibold bg-amber-900/20 border border-amber-500/20 px-2 py-0.5 rounded">
            ✦ Simulación física
          </span>
          <ToolBtn onClick={downloadPNG} title="Descargar">
            <Download className="w-3.5 h-3.5" />
            <span className="ml-1 text-xs">PNG</span>
          </ToolBtn>
        </div>
      </div>

      {/* ── Panel de controles ── */}
      {showControls && (
        <div className="flex-shrink-0 bg-[#0a0c12] border-b border-[#1e2130] px-4 py-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
            <SimSlider label="Escala de hilo" value={simParams.threadScale} min={0.5} max={2.5} step={0.05}
              onChange={v => set('threadScale', v)}
              display={v => v === 1.0 ? '1× físico' : `${v.toFixed(2)}×`} color="text-violet-400" />
            <SimSlider label="Tensión del hilo" value={simParams.tension} min={0} max={1} step={0.05}
              onChange={v => set('tension', v)}
              display={v => v < 0.4 ? 'Flojo' : v < 0.7 ? 'Normal' : 'Tenso'} color="text-cyan-400" />
            <SimSlider label="Brillo / Glossiness" value={simParams.glossiness} min={0} max={1} step={0.05}
              onChange={v => set('glossiness', v)}
              display={v => v < 0.3 ? 'Mate' : v < 0.6 ? 'Semi' : 'Brillante'} color="text-amber-400" />
            <SimSlider label="Ángulo de luz" value={simParams.lightAngleDeg} min={0} max={360} step={5}
              onChange={v => set('lightAngleDeg', v)}
              display={v => `${v}°`} color="text-emerald-400" />
          </div>
          <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-[#1a1d27]">
            <label className="flex items-center gap-2 cursor-pointer">
              <button
                onClick={() => set('showUnderlay', !simParams.showUnderlay)}
                className={`relative w-8 h-4 rounded-full transition-colors ${simParams.showUnderlay ? 'bg-violet-600' : 'bg-[#2a2d3a]'}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${simParams.showUnderlay ? 'translate-x-4' : ''}`} />
              </button>
              <span className="text-xs text-slate-400">Mostrar underlay</span>
            </label>
            <button
              onClick={() => {
                const p = FABRIC_SIM_PARAMS[fabricType] || FABRIC_SIM_PARAMS['Algodón'];
                setSimParams(prev => ({ ...prev, tension: p.tensionBase, glossiness: p.glossiness, lightAngleDeg: p.lightAngleDeg, threadScale: 1.0 }));
                stitchCacheRef.current.clear();
              }}
              className="ml-auto text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              ↺ Restablecer para {fabricType}
            </button>
          </div>
        </div>
      )}

      {/* ── Canvas stack ── */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <canvas ref={fabricCanvasRef}  className="absolute inset-0 w-full h-full" />
        <canvas ref={stitchCanvasRef}  className="absolute inset-0 w-full h-full" />
        <canvas ref={postCanvasRef}    className="absolute inset-0 w-full h-full pointer-events-none" />

        {(!regions || regions.length === 0) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-slate-600">Procesa una imagen para ver la simulación física</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolBtn({ onClick, children, title, active }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center px-2 py-1.5 rounded border text-xs transition-colors
        ${active
          ? 'border-violet-500/50 bg-violet-900/20 text-violet-300'
          : 'border-[#2a2d3a] bg-[#161a23] text-slate-400 hover:text-white hover:bg-[#1e2130]'
        }`}
    >
      {children}
    </button>
  );
}

function SimSlider({ label, value, min, max, step, onChange, display, color }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-slate-500 w-28 flex-shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-violet-600 h-1"
      />
      <span className={`text-[11px] font-bold w-16 text-right ${color}`}>{display(value)}</span>
    </div>
  );
}