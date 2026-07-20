import { useState, useEffect, useRef, useMemo } from 'react';
import { Eye, EyeOff, Layers, Sparkles } from 'lucide-react';
import { DEFAULT_MACHINE } from '@/lib/exportPipeline';

/**
 * FinalLookSimulator — Realistic final embroidery look with thread thickness,
 * layer overlap, and toggles for contours / preserved details / discarded highlights.
 *
 * Renders the ACTUAL stitch sequence (from buildFinalCommands pipeline) with
 * visual thread thickness to show how the final embroidery will look.
 */
export default function FinalLookSimulator({ regions, config, machineSettings, detailReport, finalCommands, finalObjects }) {
  const canvasRef = useRef(null);
  const [showOutlinesOnly, setShowOutlinesOnly] = useState(false);
  const [showPreservedDetails, setShowPreservedDetails] = useState(true);
  const [highlightDiscarded, setHighlightDiscarded] = useState(true);
  const [threadThickness, setThreadThickness] = useState(1.5); // mm visual thickness

  const ms = { ...DEFAULT_MACHINE, ...machineSettings };
  const w = config.width_mm || 100;
  const h = config.height_mm || 100;

  // ── READ-ONLY: FinalLookSimulator NEVER generates its own commands ───────
  // It reads finalEmbroideryCommands from the Editor (single source of truth).
  // It cannot modify regions, commands, contours, sewing order, or metrics.
  const experimentalEnabled = config?.experimentalFinalLookSimulator === true;
  useEffect(() => {
    console.log('[command-sync] finalLook source: finalEmbroideryCommands (read-only)');
    console.log('[rollback-safe] experimentalFinalLookSimulator', experimentalEnabled ? 'ON' : 'OFF');
    console.log('[rollback-safe] FinalLookSimulator is read-only: no region/command mutation');
  }, [experimentalEnabled]);

  // Use finalCommands passed from Editor — NEVER build own commands
  const commands = finalCommands || [];
  const objects = finalObjects || [];

  // Compute projection bounds
  const projection = useMemo(() => {
    let minX = -w / 2, maxX = w / 2, minY = -h / 2, maxY = h / 2;
    for (const c of commands) {
      if (c.x === undefined || !Number.isFinite(c.x)) continue;
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }
    return { minX, maxX, minY, maxY };
  }, [commands, w, h]);

  const objectById = useMemo(() => new Map(objects.map(o => [o.id, o])), [objects]);

  // Build lookup for detail info
  const detailMap = useMemo(() => {
    const map = new Map();
    for (const d of detailReport?.details || []) {
      map.set(d.id, d);
    }
    return map;
  }, [detailReport]);

  // Render final look
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, width, height);

    if (commands.length === 0 || !projection) return;

    // Projection: mm → canvas pixels
    const padding = 20;
    const drawW = width - padding * 2;
    const drawH = height - padding * 2;
    const mmW = projection.maxX - projection.minX || w;
    const mmH = projection.maxY - projection.minY || h;
    const scale = Math.min(drawW / mmW, drawH / mmH);
    const toPx = (x, y) => [
      padding + (x - projection.minX) * scale + (drawW - mmW * scale) / 2,
      padding + (y - projection.minY) * scale + (drawH - mmH * scale) / 2,
    ];

    // Draw hoop boundary
    ctx.strokeStyle = '#2a2d3a';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const [hx1, hy1] = toPx(-w / 2, -h / 2);
    const [hx2, hy2] = toPx(w / 2, h / 2);
    ctx.strokeRect(hx1, hy1, hx2 - hx1, hy2 - hy1);
    ctx.setLineDash([]);

    // Thread thickness in pixels
    const threadPx = Math.max(1, threadThickness * scale);

    // Group commands by region/color for layer rendering
    let currentColor = '#888888';
    let currentRegionId = null;
    let isCurrentOutline = false;
    let isCurrentDetail = false;

    const renderStart = performance.now();
    let cancelled = false;
    let i = 0;
    const chunkSize = commands.length > 10000 ? 900 : commands.length;

    const drawCommandChunk = () => {
      const end = Math.min(commands.length, i + chunkSize);
      for (; i < end; i++) {
        const c = commands[i];
        if (c.type === 'colorChange') { currentColor = c.color || currentColor; continue; }
        if (c.type === 'end' || c.type === 'trim' || c.type === 'jump') continue;
        if (c.type === 'stitch' && i > 0) {
          const prev = commands[i - 1];
          if (prev.type !== 'stitch' && prev.type !== 'jump') continue;
          const [px, py] = toPx(prev.x, prev.y);
          const [cx, cy] = toPx(c.x, c.y);
          const segLenMm = Math.hypot(c.x - prev.x, c.y - prev.y) / scale;
          const regionId = c.regionId;
          const region = objectById.get(regionId);
          const detail = detailMap.get(regionId);
          const isOutline = region?.stitch_type === 'running_stitch' || region?.stitch_type === 'contour';
          const isDetailRun = detail?.preserved && (detail?.class === 'detail_run' || detail?.class === 'decorative_detail');
          if (segLenMm > 6 && (isOutline || isDetailRun)) continue;
          if (showOutlinesOnly && !isOutline && !isDetailRun) continue;
          if (!showPreservedDetails && isDetailRun) continue;
          let renderColor = c.color || currentColor;
          let renderWidth = threadPx;
          if (isOutline) renderWidth = threadPx * 1.3;
          else if (isDetailRun) { renderWidth = threadPx * 1.2; renderColor = c.color || '#1a1a1a'; }
          else if (isCurrentFillType(region, 'fill')) renderWidth = threadPx * 0.9;
          if (highlightDiscarded && detail && !detail.preserved && detail.score > 0) { renderColor = '#ef4444'; renderWidth = threadPx * 1.5; }
          ctx.strokeStyle = renderColor;
          ctx.lineWidth = renderWidth;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(cx, cy);
          ctx.stroke();
        }
      }
      if (!cancelled && i < commands.length) requestAnimationFrame(drawCommandChunk);
      else if (!cancelled) console.log('[PERF] finalLookRenderMs', Math.round(performance.now() - renderStart));
    };
    drawCommandChunk();
    return () => { cancelled = true; };
  }, [commands, objectById, detailMap, projection, showOutlinesOnly, showPreservedDetails, highlightDiscarded, threadThickness, w, h]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0b0d12]">
      <header className="flex-shrink-0 border-b border-[#242936] bg-[#10131a] px-5 py-4 text-center">
        <div className="flex items-center justify-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-400" />
          <h2 className="text-xl font-bold tracking-tight text-slate-100 sm:text-2xl">Final Look</h2>
        </div>
        <p className="mt-1 text-[10px] text-slate-500">Inspección ampliada del acabado final</p>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0b0d12] p-4 sm:p-6">
        <div className="relative h-full overflow-hidden rounded-2xl border border-[#303746] bg-[#0d1016] shadow-2xl">
          <canvas ref={canvasRef} width={900} height={620} className="h-full w-full" />

          <div className="absolute left-4 top-1/2 flex -translate-y-1/2 flex-col gap-2">
            <ToggleChip icon={Layers} label="Solo contornos" active={showOutlinesOnly} onClick={() => setShowOutlinesOnly(!showOutlinesOnly)} />
            <ToggleChip icon={Eye} label="Detalles" active={showPreservedDetails} onClick={() => setShowPreservedDetails(!showPreservedDetails)} />
            <ToggleChip icon={EyeOff} label="Descartados" active={highlightDiscarded} onClick={() => setHighlightDiscarded(!highlightDiscarded)} />
          </div>

          <div className="absolute right-4 top-1/2 w-36 -translate-y-1/2 rounded-2xl border border-cyan-400/70 bg-[#080b10]/95 p-4 shadow-[0_0_28px_rgba(34,211,238,0.22)] backdrop-blur-sm">
            <div className="mb-3 text-sm font-bold text-slate-100">Grosor hilo</div>
            <div className="flex items-center gap-3">
              <input type="range" min="0.5" max="3" step="0.1" value={threadThickness} onChange={(event) => setThreadThickness(Number(event.target.value))} className="h-28 w-5 accent-cyan-400 [writing-mode:vertical-lr] [direction:rtl]" aria-label="Grosor hilo" />
              <div className="space-y-2 text-[9px] text-slate-500"><div>0.5mm</div><div>1.0mm</div><div>1.5mm</div><div>2.0mm</div><div>2.5mm</div><div>3.0mm</div></div>
            </div>
            <div className="mt-3 text-center text-xs font-bold text-cyan-300">{threadThickness.toFixed(1)}mm</div>
          </div>
        </div>

        <div className="absolute bottom-7 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-5 rounded-full border border-violet-500/70 bg-black/95 px-7 py-3 text-xs text-slate-200 shadow-[0_0_28px_rgba(124,58,237,0.3)] sm:gap-7 sm:px-10">
          <LegendItem color="bg-cyan-400" label="Relleno" />
          <LegendItem ring label="Contorno" />
          <LegendItem detail label="Detalle" />
          {highlightDiscarded && <LegendItem discarded label="Descartado" />}
        </div>
      </div>
    </div>
  );
}

function isCurrentFillType(region, type) {
  return region?.stitch_type === type;
}

function ToggleChip({ icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className={`flex min-w-36 items-center gap-2 rounded-xl border px-4 py-3 text-xs font-bold shadow-lg backdrop-blur-sm transition-colors ${active ? 'border-violet-500/80 bg-[#151024]/95 text-violet-200 shadow-violet-900/30' : 'border-[#3a4050] bg-[#11141b]/90 text-slate-500 hover:text-slate-300'}`}>
      <Icon className="h-4 w-4" />{label}
    </button>
  );
}

function LegendItem({ color, label, ring, detail, discarded }) {
  return <div className="flex items-center gap-2"><span className={`h-4 w-4 ${color || ''} ${ring ? 'rounded-full border-2 border-cyan-400' : ''} ${detail ? 'border-y border-violet-400 bg-violet-900/40' : ''} ${discarded ? 'rounded border border-dashed border-slate-600' : ''}`} />{label}</div>;
}