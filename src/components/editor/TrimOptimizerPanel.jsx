import { useState } from 'react';
import {
  Scissors, ShieldAlert, CheckCircle, RefreshCw,
  Zap, Activity, ArrowRight, Layers, Palette,
} from 'lucide-react';
import { optimizeCE01Trims } from '@/lib/ce01TrimOptimizer';

/**
 * TrimOptimizerPanel — manual trim optimization on top of finalEmbroideryCommands.
 * The optimizer also runs automatically inside buildFinalCommands, but this
 * panel allows re-running it on demand.
 *
 * Works ONLY on commands. Never touches stitches, coordinates, regions, or colors.
 */
export default function TrimOptimizerPanel({
  regions, config, machineSettings,
  finalCommands, onOptimizationApplied, onOptimizationDiscarded,
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    await new Promise(r => setTimeout(r, 50));
    try {
      const res = optimizeCE01Trims(finalCommands, regions, config, machineSettings);
      setResult(res);
      if (res.applied && onOptimizationApplied) {
        console.log('[trim-opt] applied — updating finalEmbroideryCommands');
        onOptimizationApplied(res.commands);
      } else if (!res.applied && onOptimizationDiscarded) {
        console.log('[trim-opt] discarded — finalEmbroideryCommands unchanged');
        onOptimizationDiscarded(res);
      }
    } finally {
      setRunning(false);
    }
  };

  const r = result?.report;

  return (
    <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Scissors className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-bold text-white">Trim Optimizer</span>
        <span className="text-[10px] text-slate-500 ml-auto">CE01</span>
      </div>

      <p className="text-[10px] text-slate-500 leading-relaxed">
        Elimina trims innecesarios entre bloques cercanos (≤6mm, mismo color).
        Mantiene trims en cambios de color y saltos largos (&gt;8mm).
        Solo aplica si trims bajan ≥30% sin empeorar saltos, largas o colores.
      </p>

      <button
        onClick={handleRun}
        disabled={running || !finalCommands || finalCommands.length === 0}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors"
      >
        {running ? (
          <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Optimizando...</>
        ) : (
          <><Scissors className="w-3.5 h-3.5" /> Optimizar Trims</>
        )}
      </button>

      {result && r && (
        <div className="space-y-2.5">
          {/* Status banner */}
          <div className={`border rounded-lg p-2.5 ${
            r.applied
              ? 'bg-emerald-900/15 border-emerald-500/30'
              : 'bg-amber-900/15 border-amber-500/30'
          }`}>
            <div className="flex items-center gap-2">
              {r.applied
                ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                : <ShieldAlert className="w-4 h-4 text-amber-400" />}
              <span className={`text-[11px] font-bold ${
                r.applied ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                {r.applied ? 'Trims reducidos' : 'Optimización descartada'}
              </span>
            </div>
            {!r.applied && r.discardedReason && (
              <p className="text-[10px] text-amber-300 mt-1">{r.discardedReason}</p>
            )}
          </div>

          {/* Before / After */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#161a23] border border-[#1e2130] rounded-lg p-2.5">
              <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1.5">Antes</div>
              <MetricRow icon={Scissors} label="Trims" value={r.trimsBefore} color="text-amber-400" />
              <MetricRow icon={Zap} label="Saltos" value={r.jumpsBefore} color="text-red-400" />
              <MetricRow icon={Layers} label="Puntadas" value={r.stitchesBefore} color="text-violet-400" />
              <MetricRow icon={Palette} label="Colores" value={r.colorsBefore} color="text-cyan-400" />
            </div>
            <div className="bg-[#161a23] border border-[#1e2130] rounded-lg p-2.5">
              <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1.5">Después</div>
              <MetricRow icon={Scissors} label="Trims" value={r.trimsAfter} color={
                r.trimsAfter < r.trimsBefore ? 'text-emerald-400' : 'text-amber-400'
              } />
              <MetricRow icon={Zap} label="Saltos" value={r.jumpsAfter} color={
                r.jumpsAfter <= r.jumpsBefore * 1.1 ? 'text-emerald-400' : 'text-red-400'
              } />
              <MetricRow icon={Layers} label="Puntadas" value={r.stitchesAfter} color="text-violet-400" />
              <MetricRow icon={Palette} label="Colores" value={r.colorsAfter} color="text-cyan-400" />
            </div>
          </div>

          {/* Safety checks */}
          <div className="bg-[#161a23] border border-[#1e2130] rounded-lg p-2.5">
            <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">Integridad</div>
            <div className="grid grid-cols-3 gap-1.5 text-[10px]">
              <SafetyItem label="Fuera región" before={r.outsideRegionBefore} after={r.outsideRegionAfter} />
              <SafetyItem label="Largas >8mm" before={r.longStitchesBefore} after={r.longStitchesAfter} />
              <SafetyItem label="Colores" before={r.colorsBefore} after={r.colorsAfter} />
            </div>
          </div>

          {/* Actions detail */}
          <div className="bg-[#161a23] border border-[#1e2130] rounded-lg p-2.5 space-y-1">
            <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">Acciones</div>
            <MetricRow icon={Activity} label="Trims eliminados (jump corto)" value={r.removedBeforeShortJump} color="text-emerald-400" />
            <MetricRow icon={Activity} label="Trims duplicados eliminados" value={r.removedDuplicateTrim} color="text-emerald-400" />
            <MetricRow icon={ShieldAlert} label="Mantenido: cambio color" value={r.keptColorChange} color="text-cyan-400" />
            <MetricRow icon={ShieldAlert} label="Mantenido: salto largo" value={r.keptLongJump} color="text-amber-400" />
          </div>

          {/* Reduction */}
          {r.applied && (
            <div className="flex items-center gap-3 text-[10px] bg-amber-900/10 border border-amber-500/20 rounded-lg px-2.5 py-2">
              <ArrowRight className="w-3 h-3 text-amber-400" />
              <span className="text-amber-300">
                Trims: −{Math.round((1 - r.trimsAfter / Math.max(r.trimsBefore, 1)) * 100)}%
              </span>
              <span className="text-slate-700">·</span>
              <span className="text-slate-400">
                {r.trimsBefore} → {r.trimsAfter}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricRow({ icon: Icon, label, value, color }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`w-3 h-3 ${color} flex-shrink-0`} />
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`text-xs font-bold ${color} ml-auto`}>{value}</span>
    </div>
  );
}

function SafetyItem({ label, before, after }) {
  const ok = after <= before;
  return (
    <div className="bg-[#0d0f14] rounded p-1.5 text-center border border-[#1e2130]">
      <div className={`text-sm font-bold ${ok ? 'text-emerald-400' : 'text-red-400'}`}>{after}</div>
      <div className="text-[8px] text-slate-600">{label}</div>
      <div className="text-[8px] text-slate-700">was {before}</div>
    </div>
  );
}