import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Play, Pause, SkipForward, SkipBack, RotateCcw, Zap, Scissors,
  Palette, Flag, AlertTriangle, ChevronRight
} from 'lucide-react';
import { buildStitchObjects, flattenToCommands, DEFAULT_MACHINE } from '@/lib/exportPipeline';

/**
 * SewingSimulator — Anima paso a paso el orden real de costura.
 *
 * Usa el pipeline de exportación (buildStitchObjects + flattenToCommands) para
 * obtener la secuencia exacta de comandos que la máquina coserá. La aguja se
 * mueve comando por comando, dibujando el recorrido acumulado.
 *
 * Los saltos > trimThreshold (3.5mm) se marcan en rojo como "saltos
 * innecesarios" — potenciales problemas para la Caydo CE01.
 */
export default function SewingSimulator({ regions, config, machineSettings }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  const ms = { ...DEFAULT_MACHINE, ...machineSettings };
  const w = config.width_mm || 100;
  const h = config.height_mm || 100;

  // ── Build real sewing command sequence (memoized) ──────────────────────
  const { commands, objects } = useMemo(() => {
    const objs = buildStitchObjects(regions, config);
    const cmds = flattenToCommands(objs, ms);
    return { commands: cmds, objects: objs };
  }, [regions, config, ms.maxStitchLength, ms.maxJumpLength, ms.trimThreshold, ms.designOffset]);

  // ── Compute canvas projection bounds from all commands ─────────────────
  const projection = useMemo(() => {
    if (commands.length === 0) return null;
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

  // ── Simulation state ───────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(5); // stitches per frame

  // Reset index when commands change
  useEffect(() => {
    setCurrentIndex(0);
    setIsPlaying(false);
  }, [commands]);

  // ── Playback loop ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;
    let last = performance.now();
    const loop = (now) => {
      const dt = now - last;
      last = now;
      // Advance ~speed * (dt/16ms) commands per frame
      const advance = Math.max(1, Math.round(speed * (dt / 16)));
      setCurrentIndex((prev) => {
        const next = prev + advance;
        if (next >= commands.length - 1) {
          setIsPlaying(false);
          return commands.length - 1;
        }
        return next;
      });
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying, speed, commands.length]);

  // ── Canvas drawing ─────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !projection) return;
    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;

    // Background
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(0, 0, cw, ch);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < cw; gx += 20) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, ch); ctx.stroke();
    }
    for (let gy = 0; gy < ch; gy += 20) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cw, gy); ctx.stroke();
    }

    const { minX, maxX, minY, maxY } = projection;
    const dataW = maxX - minX;
    const dataH = maxY - minY;
    const scale = Math.min((cw - 60) / dataW, (ch - 60) / dataH);
    const offX = (cw - dataW * scale) / 2 - minX * scale;
    const offY = (ch - dataH * scale) / 2 - minY * scale;
    const toX = (x) => offX + x * scale;
    const toY = (y) => offY + y * scale;

    // Draw hoop boundary
    ctx.strokeStyle = 'rgba(124,58,237,0.2)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(toX(-w / 2), toY(-h / 2), w * scale, h * scale);
    ctx.setLineDash([]);

    // Draw all commands up to currentIndex as connected path
    let prevX = 0, prevY = 0;
    let prevType = null;
    let prevColor = null;

    for (let i = 0; i <= currentIndex && i < commands.length; i++) {
      const c = commands[i];
      if (c.x === undefined || !Number.isFinite(c.x)) {
        // colorChange/trim/end with no coords — just track
        if (c.type === 'colorChange') prevColor = c.color;
        prevType = c.type;
        continue;
      }

      const sx = toX(c.x);
      const sy = toY(c.y);

      if (c.type === 'stitch') {
        // Draw stitch segment in current color
        ctx.strokeStyle = c.color || prevColor || '#a78bfa';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(toX(prevX), toY(prevY));
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (c.type === 'jump') {
        const dist = Math.hypot(c.x - prevX, c.y - prevY);
        const isUnnecessary = dist > ms.trimThreshold;
        // Draw jump as dashed line — red if > trimThreshold
        ctx.strokeStyle = isUnnecessary ? '#ef4444' : 'rgba(100,116,139,0.35)';
        ctx.lineWidth = isUnnecessary ? 1.2 : 0.8;
        ctx.setLineDash(isUnnecessary ? [3, 3] : [2, 4]);
        ctx.beginPath();
        ctx.moveTo(toX(prevX), toY(prevY));
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      prevX = c.x; prevY = c.y;
      prevType = c.type;
      if (c.color) prevColor = c.color;
    }

    // Draw needle at current position
    const curCmd = commands[currentIndex];
    if (curCmd && curCmd.x !== undefined && Number.isFinite(curCmd.x)) {
      const nx = toX(curCmd.x);
      const ny = toY(curCmd.y);

      // Glow
      const grd = ctx.createRadialGradient(nx, ny, 0, nx, ny, 12);
      grd.addColorStop(0, 'rgba(124,58,237,0.6)');
      grd.addColorStop(1, 'rgba(124,58,237,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(nx - 12, ny - 12, 24, 24);

      // Needle dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(nx, ny, 3, 0, Math.PI * 2);
      ctx.fill();

      // Crosshair
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(nx - 8, ny); ctx.lineTo(nx + 8, ny);
      ctx.moveTo(nx, ny - 8); ctx.lineTo(nx, ny + 8);
      ctx.stroke();
    }
  }, [commands, currentIndex, projection, ms.trimThreshold, w, h]);

  useEffect(() => { draw(); }, [draw]);

  // ── Stats ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let stitches = 0, jumps = 0, trims = 0, colorChanges = 0, unnecessaryJumps = 0;
    let lastColor = null;
    let prevX = 0, prevY = 0;
    const unnecessaryJumpList = [];

    for (let i = 0; i <= currentIndex && i < commands.length; i++) {
      const c = commands[i];
      if (c.type === 'stitch') stitches++;
      if (c.type === 'jump') {
        jumps++;
        const dist = Math.hypot((c.x || 0) - prevX, (c.y || 0) - prevY);
        if (dist > ms.trimThreshold) {
          unnecessaryJumps++;
          unnecessaryJumpList.push({ index: i, dist: Math.round(dist * 10) / 10 });
        }
      }
      if (c.type === 'trim') trims++;
      if (c.type === 'colorChange') {
        colorChanges++;
        lastColor = c.color;
      }
      if (c.x !== undefined && Number.isFinite(c.x)) { prevX = c.x; prevY = c.y; }
    }

    const curCmd = commands[currentIndex];
    return {
      stitches, jumps, trims, colorChanges, unnecessaryJumps,
      unnecessaryJumpList,
      currentColor: curCmd?.color || lastColor,
      currentType: curCmd?.type || '—',
      progress: commands.length > 1 ? Math.round((currentIndex / (commands.length - 1)) * 100) : 0,
    };
  }, [commands, currentIndex, ms.trimThreshold]);

  // ── Controls ───────────────────────────────────────────────────────────
  const handlePlay = () => {
    if (currentIndex >= commands.length - 1) setCurrentIndex(0);
    setIsPlaying(true);
  };
  const handleStepFwd = () => { setIsPlaying(false); setCurrentIndex((i) => Math.min(i + 1, commands.length - 1)); };
  const handleStepBack = () => { setIsPlaying(false); setCurrentIndex((i) => Math.max(i - 1, 0)); };
  const handleReset = () => { setIsPlaying(false); setCurrentIndex(0); };

  if (commands.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Zap className="w-8 h-8 text-slate-600 mb-3" />
        <p className="text-sm text-slate-400 font-medium">No hay caminos de costura</p>
        <p className="text-[11px] text-slate-600 mt-1">Procesa la imagen para generar regiones primero</p>
      </div>
    );
  }

  const typeMeta = {
    stitch:      { label: 'Puntada',     icon: Zap,      color: 'text-violet-300', bg: 'bg-violet-900/30 border-violet-500/30' },
    jump:        { label: 'Salto',       icon: ChevronRight, color: 'text-slate-300', bg: 'bg-slate-800/40 border-slate-600/30' },
    trim:        { label: 'Corte',       icon: Scissors, color: 'text-amber-300',  bg: 'bg-amber-900/30 border-amber-500/30' },
    colorChange: { label: 'Cambio color',icon: Palette,  color: 'text-cyan-300',   bg: 'bg-cyan-900/30 border-cyan-500/30' },
    end:         { label: 'Fin',         icon: Flag,     color: 'text-emerald-300',bg: 'bg-emerald-900/30 border-emerald-500/30' },
  };
  const meta = typeMeta[stats.currentType] || { label: '—', icon: AlertTriangle, color: 'text-slate-400', bg: 'bg-slate-800/40 border-slate-600/30' };
  const TypeIcon = meta.icon;

  return (
    <div className="flex flex-col h-full">
      {/* Canvas */}
      <div className="flex-1 relative bg-[#0a0c12] min-h-0">
        <canvas
          ref={canvasRef}
          width={800}
          height={500}
          className="w-full h-full"
        />

        {/* Current command badge — top left overlay */}
        <div className={`absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-lg border ${meta.bg}`}>
          <TypeIcon className={`w-3.5 h-3.5 ${meta.color}`} />
          <span className={`text-xs font-bold ${meta.color}`}>{meta.label}</span>
          <span className="text-[10px] text-slate-500 ml-1">#{currentIndex + 1}/{commands.length}</span>
        </div>

        {/* Current color swatch — top right */}
        {stats.currentColor && (
          <div className="absolute top-3 right-3 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0d0f14] border border-[#2a2d3a]">
            <div className="w-3 h-3 rounded-sm border border-white/20" style={{ background: stats.currentColor }} />
            <span className="text-[10px] text-slate-400 font-mono">{stats.currentColor}</span>
          </div>
        )}

        {/* Unnecessary jump warning — bottom right */}
        {stats.unnecessaryJumps > 0 && (
          <div className="absolute bottom-3 right-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-950/40 border border-red-500/40 max-w-[220px]">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[11px] font-bold text-red-300">{stats.unnecessaryJumps} salto{stats.unnecessaryJumps > 1 ? 's' : ''} largo{stats.unnecessaryJumps > 1 ? 's' : ''}</div>
              <div className="text-[10px] text-red-400/80">&gt;{ms.trimThreshold}mm sin corte — revisar para CE01</div>
            </div>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="flex-shrink-0 px-4 py-2 border-t border-[#1e2130] bg-[#0a0c12]">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-500">Progreso de costura</span>
          <span className="text-[10px] text-violet-400 font-bold">{stats.progress}%</span>
        </div>
        <div className="h-1.5 bg-[#1e2130] rounded-full overflow-hidden">
          <div className="h-full bg-violet-600 rounded-full transition-all" style={{ width: `${stats.progress}%` }} />
        </div>
      </div>

      {/* Stats row */}
      <div className="flex-shrink-0 grid grid-cols-4 gap-2 px-4 py-2 border-t border-[#1e2130] bg-[#0a0c12]">
        {[
          { label: 'Puntadas',  value: stats.stitches,         color: 'text-violet-400' },
          { label: 'Saltos',    value: stats.jumps,            color: 'text-slate-300' },
          { label: 'Cortes',    value: stats.trims,            color: 'text-amber-400' },
          { label: 'C. color',  value: stats.colorChanges,     color: 'text-cyan-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="text-center">
            <div className={`text-sm font-bold ${color}`}>{value}</div>
            <div className="text-[9px] text-slate-600 uppercase tracking-wider">{label}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-t border-[#1e2130] bg-[#0a0c12]">
        <button onClick={handleReset} className="p-2 rounded-lg border border-[#2a2d3a] text-slate-400 hover:text-white hover:border-[#3a3d4a] transition-colors" title="Reiniciar">
          <RotateCcw className="w-4 h-4" />
        </button>
        <button onClick={handleStepBack} disabled={currentIndex === 0} className="p-2 rounded-lg border border-[#2a2d3a] text-slate-400 hover:text-white hover:border-[#3a3d4a] transition-colors disabled:opacity-30" title="Paso atrás">
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          onClick={() => isPlaying ? setIsPlaying(false) : handlePlay()}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold transition-colors"
        >
          {isPlaying ? <><Pause className="w-4 h-4" /> Pausar</> : <><Play className="w-4 h-4" /> Simular</>}
        </button>
        <button onClick={handleStepFwd} disabled={currentIndex >= commands.length - 1} className="p-2 rounded-lg border border-[#2a2d3a] text-slate-400 hover:text-white hover:border-[#3a3d4a] transition-colors disabled:opacity-30" title="Paso adelante">
          <SkipForward className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-1 ml-1">
          <span className="text-[10px] text-slate-600">Velocidad</span>
          {[1, 5, 15, 50].map(s => (
            <button key={s} onClick={() => setSpeed(s)}
              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${speed === s ? 'bg-violet-900/40 text-violet-300 border border-violet-500/30' : 'text-slate-500 hover:text-slate-300 border border-transparent'}`}>
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}