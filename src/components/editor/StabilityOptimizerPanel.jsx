import { useState } from 'react';
import {
  Activity, Gauge, ShieldCheck, ShieldAlert, CheckCircle, XCircle,
  Wrench, ChevronDown, ChevronRight, Layers, Route,
  Zap, Scissors, Grid2x2, Beaker, Play, AlertTriangle, ArrowRight,
} from 'lucide-react';
import { optimizeStabilitySafe } from '@/lib/stabilityOptimizer';

const STATUS_STYLES = {
  SAFE:     { wrap: 'bg-emerald-900/20 border-emerald-500/40', text: 'text-emerald-400', icon: ShieldCheck },
  RISKY:    { wrap: 'bg-amber-900/20 border-amber-500/40',     text: 'text-amber-400',   icon: ShieldAlert },
  INVALID:  { wrap: 'bg-red-900/20 border-red-500/40',         text: 'text-red-400',     icon: ShieldAlert },
};

/**
 * StabilityOptimizerPanel — transactional, safe optimization.
 *
 * Uses optimizeStabilitySafe which:
 *   1. Snapshots before metrics from buildFinalCommands
 *   2. Runs conservative optimization on a COPY
 *   3. Compares before/after
 *   4. Applies ONLY if candidate improves — otherwise reverts
 *
 * NEVER modifies regions or visual state.
 */
export default function StabilityOptimizerPanel({ regions, config, machineSettings, finalCommands, finalObjects, onOptimizationApplied, onOptimizationDiscarded }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    await new Promise(r => setTimeout(r, 50));
    try {
      // Use finalCommands passed from Editor — NEVER regenerate internally
      const res = optimizeStabilitySafe(finalCommands, finalObjects, regions, config, machineSettings);
      setResult(res);
      if (res.applied && onOptimizationApplied) {
        console.log('[commands-state] optimization applied — updating finalEmbroideryCommands');
        onOptimizationApplied(res.commands);
      } else if (!res.applied && onOptimizationDiscarded) {
        console.log('[commands-state] optimization discarded — finalEmbroideryCommands unchanged');
        onOptimizationDiscarded(res);
      }
    } finally {
      setRunning(false);
    }
  };

  const statusKey = result
    ? (res_canExport(result) ? 'SAFE' : result.indices.stabilityScore >= 50 ? 'RISKY' : 'INVALID')
    : 'RISKY';
  const st = STATUS_STYLES[statusKey];

  return (
    <div className="space-y-4">
      {/* Header + run button */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-violet-900/20 border border-violet-500/30 flex items-center justify-center">
          <Gauge className="w-4 h-4 text-violet-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-white">Optimizador de Estabilidad</h3>
          <p className="text-[11px] text-slate-500">
            Transaccional · nunca empeora comandos · nunca modifica regiones visuales.
          </p>
        </div>
        <button
          onClick={handleRun}
          disabled={running || !regions?.length}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-bold transition-colors"
        >
          {running
            ? <><Activity className="w-3.5 h-3.5 animate-spin" /> Optimizando...</>
            : <><Wrench className="w-3.5 h-3.5" /> Optimizar estabilidad</>}
        </button>
      </div>

      {running && (
        <div className="flex items-center gap-3 bg-violet-900/10 border border-violet-500/20 rounded-lg p-3">
          <Activity className="w-4 h-4 text-violet-400 animate-spin" />
          <span className="text-xs text-violet-300">Evaluando optimización transaccional...</span>
        </div>
      )}

      {result && !running && (
        <>
          {/* Result banner: applied or discarded */}
          <div className={`border rounded-lg p-4 ${result.applied ? 'bg-emerald-900/20 border-emerald-500/40' : 'bg-amber-900/20 border-amber-500/40'}`}>
            <div className="flex items-center gap-2 mb-2">
              {result.applied
                ? <CheckCircle className="w-5 h-5 text-emerald-400" />
                : <AlertTriangle className="w-5 h-5 text-amber-400" />}
              <span className={`text-sm font-bold ${result.applied ? 'text-emerald-400' : 'text-amber-400'}`}>
                {result.applied ? 'Optimización APLICADA' : 'Optimización DESCARTADA'}
              </span>
              <span className="text-2xl font-bold text-white ml-auto">{result.indices.stabilityScore}</span>
              <span className="text-xs text-slate-500">/100</span>
            </div>
            {!result.applied && result.reason && (
              <p className="text-[11px] text-amber-300">
                La optimización fue descartada porque empeoraba saltos/trims/score: {result.reason}
              </p>
            )}
            {result.applied && (
              <p className="text-[11px] text-emerald-300">
                Mejora detectada y aplicada sin empeorar CE01 validator ni saltos/trims.
              </p>
            )}
          </div>

          {/* Before / After comparison */}
          <div>
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Comparación Before / After</div>
            <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg overflow-hidden">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-[#1e2130]">
                    <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Métrica</th>
                    <th className="text-right px-3 py-1.5 text-slate-500 font-medium">Antes</th>
                    <th className="text-center px-2 py-1.5 text-slate-600 w-8"></th>
                    <th className="text-right px-3 py-1.5 text-slate-500 font-medium">Después</th>
                    <th className="text-right px-3 py-1.5 text-slate-500 font-medium w-12">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {buildComparisonRows(result).map((row, i) => (
                    <tr key={i} className="border-b border-[#1e2130] last:border-0">
                      <td className="px-3 py-1.5 text-slate-400">{row.label}</td>
                      <td className="px-3 py-1.5 text-right text-slate-300 font-mono">{row.before}</td>
                      <td className="px-2 py-1.5 text-center"><ArrowRight className="w-3 h-3 text-slate-600 mx-auto" /></td>
                      <td className="px-3 py-1.5 text-right text-slate-300 font-mono">{row.after}</td>
                      <td className={`px-3 py-1.5 text-right font-mono font-bold ${row.deltaColor}`}>{row.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stability indices grid */}
          <div>
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Índices de estabilidad</div>
            <div className="grid grid-cols-2 gap-2">
              <IndexCard label="Complejidad" value={result.indices.complexityIndex} />
              <IndexCard label="Densidad" value={result.indices.densityIndex} />
              <IndexCard label="Recorrido aguja" value={result.indices.needleTravelIndex} />
              <IndexCard label="Long. puntadas" value={result.indices.stitchLengthIndex} />
              <IndexCard label="Underlay" value={result.indices.underlayIndex} />
              <IndexCard label="Trims" value={result.indices.trimIndex} />
              <IndexCard label="Tensión hilo" value={result.indices.tensionIndex} />
              <IndexCard label="Eficiencia global" value={result.indices.globalEfficiency} />
            </div>
          </div>

          {/* Risk indices */}
          <div>
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Riesgos (mayor = más seguro)</div>
            <div className="grid grid-cols-3 gap-2">
              <RiskCard label="Rotura hilo" value={result.indices.threadBreakRisk} />
              <RiskCard label="Fruncido" value={result.indices.puckeringRisk} />
              <RiskCard label="Desplaz. bastidor" value={result.indices.hoopDisplacementRisk} />
            </div>
          </div>

          {/* CE01 status comparison */}
          <div className="border-t border-[#1e2130] pt-3">
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Estado CE01</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-2.5">
                <div className="text-[9px] text-slate-600 mb-1">ANTES</div>
                <div className={`text-sm font-bold ${ce01Color(result.before.ce01.status)}`}>{result.before.ce01.status}</div>
                <div className="text-[10px] text-slate-500">Score: {result.before.ce01.score}/100</div>
              </div>
              <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-2.5">
                <div className="text-[9px] text-slate-600 mb-1">DESPUÉS</div>
                <div className={`text-sm font-bold ${ce01Color(result.after.ce01.status)}`}>{result.after.ce01.status}</div>
                <div className="text-[10px] text-slate-500">Score: {result.after.ce01.score}/100</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function res_canExport(result) {
  return result.applied || result.before.ce01.status !== 'INVALID';
}

function buildComparisonRows(result) {
  const b = result.before.metrics;
  const a = result.after.metrics;
  const rows = [
    { label: 'Puntadas', before: b.stitches, after: a.stitches, lower: false },
    { label: 'Saltos', before: b.jumps, after: a.jumps, lower: true },
    { label: 'Trims', before: b.trims, after: a.trims, lower: true },
    { label: 'Cortas <0.8mm', before: b.shortStitches, after: a.shortStitches, lower: true },
    { label: 'Largas >8mm', before: b.longStitches, after: a.longStitches, lower: true },
    { label: 'Duplicadas', before: b.duplicates, after: a.duplicates, lower: true },
    { label: 'Stability', before: result.before.stability, after: result.after.stability, lower: false },
    { label: 'CE01 Score', before: result.before.ce01.score, after: result.after.ce01.score, lower: false },
  ];
  return rows.map(r => {
    const delta = r.after - r.before;
    const improved = r.lower ? delta < 0 : delta > 0;
    const worsened = r.lower ? delta > 0 : delta < 0;
    return {
      ...r,
      delta: delta > 0 ? `+${delta}` : `${delta}`,
      deltaColor: improved ? 'text-emerald-400' : worsened ? 'text-red-400' : 'text-slate-500',
    };
  });
}

function ce01Color(status) {
  if (status === 'SAFE') return 'text-emerald-400';
  if (status === 'RISKY') return 'text-amber-400';
  return 'text-red-400';
}

function IndexCard({ label, value }) {
  const color = value >= 90 ? 'text-emerald-400' : value >= 50 ? 'text-amber-400' : 'text-red-400';
  const bar = value >= 90 ? 'bg-emerald-500' : value >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="bg-[#0d0f14] rounded-lg p-2.5 border border-[#1e2130]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-500">{label}</span>
        <span className={`text-sm font-bold ${color}`}>{value}</span>
      </div>
      <div className="h-1 bg-[#1e2130] rounded-full overflow-hidden">
        <div className={`h-full ${bar} rounded-full`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function RiskCard({ label, value }) {
  const color = value >= 80 ? 'text-emerald-400' : value >= 50 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="bg-[#0d0f14] rounded-lg p-2 text-center border border-[#1e2130]">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[9px] text-slate-600">{label}</div>
    </div>
  );
}