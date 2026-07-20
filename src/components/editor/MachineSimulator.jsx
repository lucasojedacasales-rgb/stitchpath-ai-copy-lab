import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Play, Pause, SkipForward, Zap, Scissors, Palette, Flag,
  AlertTriangle, Layers, Grid2x2, Eye, Route,
} from 'lucide-react';
import { buildStitchObjects, flattenToCommands, DEFAULT_MACHINE } from '@/lib/exportPipeline';
import { analyzeSimulation } from '@/lib/simulationMetrics';
import {
  buildSimulationBlocks,
  renderSimulationOverlay,
  DEFAULT_SIMULATION_SETTINGS,
} from '@/lib/stitchSimulation';

const TYPE_META = {
  stitch:      { label: 'Puntada',  color: '#a78bfa', icon: Zap },
  jump:        { label: 'Salto',    color: '#64748b', icon: SkipForward },
  trim:        { label: 'Corte',    color: '#fbbf24', icon: Scissors },
  colorChange: { label: 'C.color',  color: '#22d3ee', icon: Palette },
  end:         { label: 'Fin',      color: '#34d399', icon: Flag },
};

/**
 * MachineSimulator — professional embroidery simulation with clean visual layers.
 *
 * Uses buildSimulationBlocks + renderSimulationOverlay for region-clipped,
 * realistic thread rendering. Supports normal mode (clean) and debug mode
 * (jumps, path, warnings, block indices).
 */
export default function MachineSimulator({ regions, config, machineSettings, finalCommands, finalObjects, commandVersion = 'empty', commandSourceLabel = 'simulationFallback' }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const renderReportRef = useRef(null);

  const ms = { ...DEFAULT_MACHINE, ...machineSettings };
  const w = config.width_mm || 100;
  const h = config.height_mm || 100;

  // ── Build command sequence + analysis + simulation blocks (memoized) ──────
  const { commands, analysis, simData, prefixStats, commandSourceUsed, simulationMatchesFinalCommands, finalCommandCount } = useMemo(() => {
    const t0 = performance.now();
    const hasFinalCommands = Array.isArray(finalCommands) && finalCommands.length > 0;
    const objs = hasFinalCommands ? (finalObjects || []) : buildStitchObjects(regions, config);
    const cmds = hasFinalCommands ? finalCommands : flattenToCommands(objs, ms);
    const source = hasFinalCommands ? commandSourceLabel : 'buildStitchObjectsFallback';
    const sim = analyzeSimulation(cmds, objs, ms);
    const blocks = buildSimulationBlocks(cmds, regions, { width_mm: w, height_mm: h });
    const prefix = buildPrefixStats(cmds);
    console.log('[PERF] machineSimulatorAnalysisMs', Math.round(performance.now() - t0));
    return {
      commands: cmds,
      analysis: sim,
      simData: blocks,
      prefixStats: prefix,
      commandSourceUsed: source,
      simulationMatchesFinalCommands: hasFinalCommands,
      finalCommandCount: hasFinalCommands ? finalCommands.length : 0,
    };
  }, [commandVersion]);

  // ── Projection bounds ─────────────────────────────────────────────────────
  const projection = useMemo(() => {
    if (commands.length === 0) return null;
    let minX = -w / 2, maxX = w / 2, minY = -h / 2, maxY = h / 2;
    for (const c of commands) {
      if (c.x === undefined || !Number.isFinite(c.x)) continue;
      if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
    }
    return { minX, maxX, minY, maxY };
  }, [commands, w, h]);

  // ── State ─────────────────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [showHoop, setShowHoop] = useState(true);
  const [simSettings, setSimSettings] = useState(DEFAULT_SIMULATION_SETTINGS);
  const [renderReport, setRenderReport] = useState(null);

  useEffect(() => { setCurrentIndex(0); setIsPlaying(false); }, [commandVersion]);

  // ── Playback loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;
    let last = performance.now();
    const loop = (now) => {
      const dt = now - last; last = now;
      const advance = Math.max(1, Math.round(speed * (dt / 16)));
      setCurrentIndex((prev) => {
        const next = prev + advance;
        if (next >= commands.length - 1) { setIsPlaying(false); return commands.length - 1; }
        return next;
      });
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying, speed, commands.length]);

  // ── Canvas drawing ─────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !projection || !simData) return;
    const ctx = canvas.getContext('2d');
    const cw = canvas.width, ch = canvas.height;

    // Background
    ctx.fillStyle = '#f7f8fb';
    ctx.fillRect(0, 0, cw, ch);

    // Grid
    ctx.strokeStyle = 'rgba(15,23,42,0.05)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < cw; gx += 20) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, ch); ctx.stroke(); }
    for (let gy = 0; gy < ch; gy += 20) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cw, gy); ctx.stroke(); }

    // Projection
    const { minX, maxX, minY, maxY } = projection;
    const dataW = maxX - minX, dataH = maxY - minY;
    const scale = Math.min((cw - 60) / dataW, (ch - 60) / dataH);
    const offX = (cw - dataW * scale) / 2 - minX * scale;
    const offY = (ch - dataH * scale) / 2 - minY * scale;
    const toX = (x) => offX + x * scale;
    const toY = (y) => offY + y * scale;

    // Hoop boundary
    if (showHoop) {
      ctx.strokeStyle = 'rgba(124,58,237,0.25)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(toX(-w / 2), toY(-h / 2), w * scale, h * scale);
      ctx.setLineDash([]);
    }

    // ── Main simulation render ──────────────────────────────────────────────
    const drawStart = performance.now();
    const heatMap = simSettings.showDensityHeatmap ? analysis.heatMap : null;
    const fastPreview = commands.length > 10000 && isPlaying && speed >= 15;
    const effectiveIndex = fastPreview ? Math.min(commands.length - 1, Math.floor(currentIndex / 4) * 4) : currentIndex;
    const report = renderSimulationOverlay(
      ctx, simData, effectiveIndex, simSettings,
      { toX, toY, scale }, heatMap
    );
    const prevBlock = renderReportRef.current?.currentBlock?.blockId;
    const nextBlock = report?.currentBlock?.blockId;
    renderReportRef.current = report;
    if (prevBlock !== nextBlock || !isPlaying) setRenderReport(report);
    if (!isPlaying) console.log('[PERF] machineSimulatorDrawMs', Math.round(performance.now() - drawStart));

    // ── Needle at current position ──────────────────────────────────────────
    const curCmd = commands[currentIndex];
    if (curCmd && curCmd.x !== undefined && Number.isFinite(curCmd.x)) {
      const nx = toX(curCmd.x), ny = toY(curCmd.y);

      // Glow
      const grd = ctx.createRadialGradient(nx, ny, 0, nx, ny, 14);
      grd.addColorStop(0, 'rgba(124,58,237,0.7)');
      grd.addColorStop(1, 'rgba(124,58,237,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(nx - 14, ny - 14, 28, 28);

      // Needle dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(nx, ny, 3.5, 0, Math.PI * 2); ctx.fill();

      // Crosshair
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(nx - 9, ny); ctx.lineTo(nx + 9, ny);
      ctx.moveTo(nx, ny - 9); ctx.lineTo(nx, ny + 9);
      ctx.stroke();
    }
  }, [commands, currentIndex, projection, simData, simSettings, analysis, w, h, showHoop, isPlaying, speed]);

  useEffect(() => { draw(); }, [draw]);

  // ── Current info ───────────────────────────────────────────────────────────
  const curPC = analysis.perCommand[currentIndex];
  const curCmd = commands[currentIndex];
  const curBlock = renderReport?.currentBlock;
  const progress = commands.length > 1 ? Math.round((currentIndex / (commands.length - 1)) * 100) : 0;

  // Live stats from precomputed prefix array — O(1) per frame
  const liveStats = prefixStats[Math.min(currentIndex, prefixStats.length - 1)] || { stitches: 0, jumps: 0, trims: 0, colorChanges: 0 };

  const handlePlay = () => { if (currentIndex >= commands.length - 1) setCurrentIndex(0); setIsPlaying(true); };
  const handleStepFwd = () => { setIsPlaying(false); setCurrentIndex((i) => Math.min(i + 1, commands.length - 1)); };
  const handleStepBack = () => { setIsPlaying(false); setCurrentIndex((i) => Math.max(i - 1, 0)); };
  const handleReset = () => { setIsPlaying(false); setCurrentIndex(0); };

  const toggleSetting = (key) => setSimSettings(s => ({ ...s, [key]: !s[key] }));
  const isDebugMode = simSettings.showDebugPath;

  if (commands.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Zap className="w-8 h-8 text-slate-600 mb-3" />
        <p className="text-sm text-slate-400 font-medium">No hay caminos de costura</p>
        <p className="text-[11px] text-slate-600 mt-1">Procesa la imagen para generar regiones primero</p>
      </div>
    );
  }

  const typeMeta = TYPE_META[curCmd?.type] || { label: '—', color: '#64748b', icon: AlertTriangle };
  const TypeIcon = typeMeta.icon;
  const statusColor = analysis.status === 'SAFE' ? 'emerald' : analysis.status === 'RISKY' ? 'amber' : 'red';
  const visStats = simData.stats;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#071126]">
      <header className="flex-shrink-0 border-b border-[#17315f] bg-[#09152d] px-5 py-3 text-center">
        <h2 className="text-base font-bold text-slate-100 sm:text-lg">Simulación basada en comandos finales</h2>
        <p className="mt-1 text-[10px] text-slate-400 sm:text-xs">Esta vista usa la misma secuencia que Final Look. La reparación real se hace desde Exportar → Reparar y validar.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 rounded-lg border border-[#1d3c70] bg-[#061127] px-3 py-1.5 text-[9px] text-slate-400 sm:text-[10px]">
          <span>simulationCommandCount=<b className="text-violet-300">{commands.length}</b></span>
          <span>finalCommandCount=<b className="text-cyan-300">{finalCommandCount || commands.length}</b></span>
          <span>commandSourceUsed=<b className="text-emerald-300">{commandSourceUsed}</b></span>
          <span className={simulationMatchesFinalCommands ? 'font-bold text-emerald-300' : 'font-bold text-amber-300'}>{simulationMatchesFinalCommands ? 'simulationMatchesFinalCommands=true' : 'fallback=true'}</span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-[#17315f] lg:grid-cols-[minmax(0,1fr)_176px]">
        <div className="relative min-h-[360px] overflow-hidden bg-[#f7f8fb]">
          <canvas ref={canvasRef} width={1000} height={700} className="h-full w-full" />

          <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-[#214177] bg-[#07152f]/95 p-2 shadow-2xl backdrop-blur-sm">
            {Object.entries(TYPE_META).map(([type, meta]) => {
              const Icon = meta.icon;
              return <div key={type} className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold ${curCmd?.type === type ? 'bg-violet-600 text-white' : 'bg-[#142851] text-slate-300'}`}><Icon className="h-3 w-3" />{meta.label}</div>;
            })}
            <span className="ml-1 text-[9px] text-slate-400">#{currentIndex + 1}/{commands.length}</span>
          </div>

          <div className="absolute left-3 right-3 top-14 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-[#214177] bg-[#07152f]/95 px-3 py-2 text-[10px] text-slate-300 shadow-xl backdrop-blur-sm">
            {curPC && curPC.x !== null && <><span>Pos: <b className="font-mono text-white">{curPC.x.toFixed(1)}, {curPC.y.toFixed(1)}</b></span><span>Dir: <b className="text-white">{curPC.direction !== null ? `${curPC.direction}°` : '—'}</b></span><span>Long: <b className="text-white">{curPC.length}mm</b></span><span>Vel: <b className="text-white">{curPC.speedMmS}mm/s</b></span></>}
            {curBlock && <><span>Bloque: <b className="text-white">B{curBlock.blockId}</b></span><span className="rounded bg-violet-900/40 px-1.5 py-0.5 text-violet-200">{curBlock.isContour ? 'contour' : 'fill'}</span></>}
            <div className="ml-auto flex flex-wrap gap-1">
              <SimToggle active={simSettings.realisticThreadPreview} onClick={() => toggleSetting('realisticThreadPreview')} icon={Eye} label="Hilo" />
              <SimToggle active={simSettings.showJumps} onClick={() => toggleSetting('showJumps')} icon={Route} label="Saltos" />
              <SimToggle active={simSettings.showTrims} onClick={() => toggleSetting('showTrims')} icon={Scissors} label="Trims" />
              <SimToggle active={simSettings.showWarnings} onClick={() => toggleSetting('showWarnings')} icon={AlertTriangle} label="Avisos" />
              <SimToggle active={simSettings.showCurrentBlockOnly} onClick={() => toggleSetting('showCurrentBlockOnly')} icon={Layers} label="Bloque" />
              <SimToggle active={showHoop} onClick={() => setShowHoop(!showHoop)} icon={Grid2x2} label="Hoop" />
            </div>
          </div>

          {curPC?.errors?.length > 0 && <div className="absolute bottom-3 left-3 max-w-[280px] space-y-1">{curPC.errors.map((error, index) => <div key={index} className="rounded-lg border border-red-500/40 bg-red-950/90 px-2.5 py-1.5 text-[10px] text-red-300"><b>[{error.rule}] {error.severity}</b><div className="text-[9px] text-red-400/80">{error.message}</div></div>)}</div>}
        </div>

        <aside className="grid content-start gap-1 overflow-y-auto bg-[#08152e] p-2 sm:grid-cols-2 lg:grid-cols-1">
          <LiveStat label="Puntadas" value={liveStats.stitches} color="text-violet-300" />
          <LiveStat label="Saltos" value={liveStats.jumps} color="text-slate-200" />
          <LiveStat label="Trims" value={liveStats.trims} color="text-amber-300" />
          <LiveStat label="C.color" value={liveStats.colorChanges} color="text-cyan-300" />
          <LiveStat label="Fuera región" value={visStats.stitchesOutsideRegion} color={visStats.stitchesOutsideRegion > 0 ? 'text-orange-300' : 'text-emerald-300'} />
          <LiveStat label="Duplicados" value={visStats.duplicateStitches} color={visStats.duplicateStitches > 0 ? 'text-orange-300' : 'text-emerald-300'} />
        </aside>
      </div>

      <footer className="flex-shrink-0 border-t border-[#17315f] bg-[#07152f] px-3 py-2.5">
        <input type="range" min={0} max={commands.length - 1} value={currentIndex} onChange={(event) => { setIsPlaying(false); setCurrentIndex(Number(event.target.value)); }} className="mb-2 w-full accent-cyan-500" aria-label="Progreso de costura" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-[10px] text-slate-400">Progreso de costura <b className="text-cyan-300">{progress}%</b></span>
          <button onClick={handleReset} className="rounded-lg bg-[#142851] px-3 py-2 text-xs text-slate-200 hover:bg-[#1c376d]">Reiniciar</button>
          <button onClick={handleStepBack} disabled={currentIndex === 0} className="rounded-lg bg-[#142851] px-3 py-2 text-xs text-slate-200 disabled:opacity-30">Paso atrás</button>
          <button onClick={() => isPlaying ? setIsPlaying(false) : handlePlay()} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">{isPlaying ? <><Pause className="h-4 w-4" /> Pausar</> : <><Play className="h-4 w-4" /> Simular costura</>}</button>
          <button onClick={handleStepFwd} disabled={currentIndex >= commands.length - 1} className="rounded-lg bg-[#142851] px-3 py-2 text-xs text-slate-200 disabled:opacity-30">Paso adelante</button>
          <span className="ml-2 text-[10px] text-slate-400">Vel</span>
          {[1, 5, 15, 50].map((value) => <button key={value} onClick={() => setSpeed(value)} className={`rounded-md px-2 py-1.5 text-[10px] font-bold ${speed === value ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-[#142851]'}`}>{value}×</button>)}
        </div>
      </footer>
    </div>
  );
}

function buildPrefixStats(commands = []) {
  const prefix = [];
  let stitches = 0, jumps = 0, trims = 0, colorChanges = 0;
  for (const c of commands) {
    if (c.type === 'stitch') stitches++;
    if (c.type === 'jump') jumps++;
    if (c.type === 'trim') trims++;
    if (c.type === 'colorChange') colorChanges++;
    prefix.push({ stitches, jumps, trims, colorChanges });
  }
  return prefix.length ? prefix : [{ stitches: 0, jumps: 0, trims: 0, colorChanges: 0 }];
}

function SimToggle({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[10px] font-bold transition-colors ${
        active ? 'bg-violet-900/30 border-violet-500/40 text-violet-300' : 'bg-[#0d0f14] border-[#2a2d3a] text-slate-500 hover:text-slate-300'
      }`}>
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}

function LiveStat({ label, value, color }) {
  return (
    <div className="rounded-lg border border-[#244273] bg-[#142851] px-3 py-1 shadow-lg">
      <div className="text-[9px] font-bold text-slate-100">{label}</div>
      <div className={`text-base font-bold ${color}`}>{value}</div>
    </div>
  );
}