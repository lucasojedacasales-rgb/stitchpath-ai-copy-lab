import { useState } from 'react';
import {
  Route, ShieldAlert, CheckCircle, RefreshCw,
  Zap, Scissors, Activity, ArrowRight,
} from 'lucide-react';
import { optimizeCE01TravelPath } from '@/lib/ce01TravelPathOptimizer';

/**
 * TravelPathOptimizerPanel — manual travel path optimization on top of
 * finalEmbroideryCommands. The optimizer also runs automatically inside
 * buildFinalCommands, but this panel allows re-running it on demand.
 *
 * Works ONLY on commands (read-only input). Never touches regions or visual state.
 */
export default function TravelPathOptimizerPanel({
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
      const res = optimizeCE01TravelPath(finalCommands, regions, config, machineSettings);
      setResult(res);
      if (res.applied && onOptimizationApplied) {
        console.log('[travel-opt] applied — updating finalEmbroideryCommands');
        onOptimizationApplied(res.commands);
      } else if (!res.applied && onOptimizationDiscarded) {
        console.log('[travel-opt] discarded — finalEmbroideryCommands unchanged');
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
        <Route className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-bold text-white">Travel Path Optimizer</span>
        <span className="text-[10px] text-slate-500 ml-auto">CE01</span>
      </div>

      <p className="text-[10px] text-slate-500 leading-relaxed">
        Colapsa saltos consecutivos, convierte saltos cortos seguros (≤3.5mm) en puntadas
        cuando el segmento está dentro del polígono, y elimina trims innecesarios.
        Solo aplica si mejora sin aumentar largas ni duplicadas.
      </p>

      <button
        onClick={handleRun}
        disabled={running || !finalCommands || finalCommands.length === 0}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors"
      >
        {running ? (
          <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Optimizando...</>
        ) : (
          <><Route className="w-3.5 h-3.5" /> Optimizar Travel Path</>
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
                {r.applied ? 'Optimización aplicada' : 'Optimización descartada'}
              </span>
            </div>
            {!r.applied && r.discardedReason && (
              <p className="text-[10px] text-amber-300 mt-1">{r.discardedReason}</p>
            )}
          </div>

          {/* Before / After comparison */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#161a23] border border-[#1e2130] rounded-lg p-2.5">
              <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1.5">Antes</div>
              <MetricRow icon={Zap} label="Saltos" value={r.jumpsBefore} color="text-red-400" />
              <MetricRow icon={Scissors} label="Trims" value={r.trimsBefore} color="text-amber-400" />
            </div>
            <div className="bg-[#161a23] border border-[#1e2130] rounded-lg p-2.5">
              <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1.5">Después</div>
              <MetricRow icon={Zap} label="Saltos" value={r.jumpsAfter} color={
                r.jumpsAfter < r.jumpsBefore ? 'text-emerald-400' : 'text-red-400'
              } />
              <MetricRow icon={Scissors} label="Trims" value={r.trimsAfter} color={
                r.trimsAfter < r.trimsBefore ? 'text-emerald-400' : 'text-amber-400'
              } />
            </div>
          </div>

          {/* Optimization actions */}
          <div className="bg-[#161a23] border border-[#1e2130] rounded-lg p-2.5 space-y-1">
            <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">Acciones</div>
            <MetricRow icon={Activity} label="Saltos convertidos a puntadas" value={r.convertedShortJumps} color="text-cyan-400" />
            <MetricRow icon={Scissors} label="Trims eliminados" value={r.removedTrims} color="text-violet-400" />
            <div className="flex items-center gap-1.5 pt-1 border-t border-[#1e2130] mt-1">
              <span className="text-[10px] text-slate-600">Bloques:</span>
              <span className="text-[10px] text-slate-400 font-bold">{r.blocksBuilt}</span>
              <span className="text-slate-700 ml-2">·</span>
              <span className="text-[10px] text-slate-600">Largas:</span>
              <span className={`text-[10px] font-bold ${r.longAfter > r.longBefore ? 'text-red-400' : 'text-emerald-400'}`}>{r.longBefore}→{r.longAfter}</span>
              <span className="text-slate-700">·</span>
              <span className="text-[10px] text-slate-600">Dups:</span>
              <span className={`text-[10px] font-bold ${r.dupAfter > r.dupBefore + 2 ? 'text-red-400' : 'text-emerald-400'}`}>{r.dupBefore}→{r.dupAfter}</span>
            </div>
          </div>

          {/* Reduction percentages */}
          {r.applied && (
            <div className="flex items-center gap-3 text-[10px] bg-cyan-900/10 border border-cyan-500/20 rounded-lg px-2.5 py-2">
              <ArrowRight className="w-3 h-3 text-cyan-400" />
              <span className="text-cyan-300">
                Saltos: −{Math.round((1 - r.jumpsAfter / Math.max(r.jumpsBefore, 1)) * 100)}%
              </span>
              <span className="text-slate-700">·</span>
              <span className="text-cyan-300">
                Trims: −{Math.round((1 - r.trimsAfter / Math.max(r.trimsBefore, 1)) * 100)}%
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