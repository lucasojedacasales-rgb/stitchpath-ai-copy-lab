import { useState, useMemo } from 'react';
import {
  Zap, TrendingDown, Scissors, Palette, Route,
  ChevronDown, ChevronRight, CheckCircle2, Clock, Layers,
} from 'lucide-react';
import {
  optimizeStitchSequence,
  formatTimeSec,
  formatThreadMm,
} from '@/lib/stitchSequenceOptimizer';

// ─── Sub-components ───────────────────────────────────────────────────────────

const BAND_LABELS = { 0: 'Relleno Fill', 1: 'Satín', 2: 'Corrida' };
const BAND_COLORS = {
  0: 'text-violet-400 bg-violet-900/10 border-violet-500/30',
  1: 'text-cyan-400 bg-cyan-900/10 border-cyan-500/30',
  2: 'text-slate-400 bg-slate-900/10 border-slate-500/30',
};

function SavingCard({ icon: Icon, label, before, after, unit, color, sub }) {
  const saved = before - after;
  const pct   = before > 0 ? Math.round((saved / before) * 100) : 0;
  const colorMap = {
    violet: 'border-violet-500/30 bg-violet-900/10 text-violet-400',
    cyan:   'border-cyan-500/30 bg-cyan-900/10 text-cyan-400',
    amber:  'border-amber-500/30 bg-amber-900/10 text-amber-400',
    emerald:'border-emerald-500/30 bg-emerald-900/10 text-emerald-400',
    rose:   'border-rose-500/30 bg-rose-900/10 text-rose-400',
  };
  return (
    <div className={`rounded-lg border p-2.5 ${colorMap[color]}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="w-3 h-3 opacity-70" />
        <span className="text-[9px] font-semibold uppercase tracking-wider opacity-70">{label}</span>
      </div>
      <div className="flex items-end gap-1 mb-0.5">
        <span className="text-xl font-black leading-none">
          {pct > 0 ? `↓${pct}%` : '—'}
        </span>
      </div>
      <div className="text-[9px] opacity-50 leading-tight">{before}{unit} → {after}{unit}</div>
      {sub && <div className="text-[9px] opacity-40 mt-0.5">{sub}</div>}
    </div>
  );
}

function MetricRow({ label, before, after, unit, formatter }) {
  const fmt = formatter || (v => `${v}${unit}`);
  const saved = before - after;
  const pct   = before > 0 ? Math.round((saved / before) * 100) : 0;
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-[#1a1d27] last:border-0">
      <span className="text-[11px] text-slate-400 flex-1">{label}</span>
      <span className="text-[11px] text-slate-600 line-through">{fmt(before)}</span>
      <span className="text-[11px] font-bold text-white ml-1">{fmt(after)}</span>
      {pct > 0
        ? <span className="text-[10px] font-bold text-emerald-400 w-12 text-right">↓{pct}%</span>
        : <span className="text-[10px] text-slate-700 w-12 text-right">—</span>
      }
    </div>
  );
}

function BandGroupRow({ group, index }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-[#1a1d27] last:border-0">
      <span className="text-[10px] text-slate-600 w-4 text-right">{index + 1}</span>
      <div className="w-2.5 h-2.5 rounded-full border border-white/10 shrink-0" style={{ background: group.color }} />
      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${BAND_COLORS[group.band]}`}>
        {BAND_LABELS[group.band]}
      </span>
      <span className="text-[10px] text-slate-400 flex-1 truncate">{group.color}</span>
      <span className="text-[10px] text-slate-600">{group.count} reg</span>
    </div>
  );
}

function AlgorithmBadge({ label }) {
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#1a1d27] border border-[#2a2d3a] text-slate-500 font-mono">
      {label}
    </span>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function TravelOptimizerPanel({ regions, onApplyOrder }) {
  const [result, setResult]         = useState(null);
  const [running, setRunning]       = useState(false);
  const [applied, setApplied]       = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showBands, setShowBands]   = useState(false);

  const validCount = useMemo(
    () => regions.filter(r => (r.path_points?.length >= 3 || r.centroid) && r.visible !== false).length,
    [regions]
  );

  const run = () => {
    setRunning(true);
    setApplied(false);
    setResult(null);
    setTimeout(() => {
      const res = optimizeStitchSequence(regions, {
        width_mm:  100,
        height_mm: 100,
        speed_spm: 800,
      });
      setResult(res);
      setRunning(false);
    }, 30);
  };

  const applyOrder = () => {
    if (!result?.optimizedSequence?.length) return;
    onApplyOrder(result.optimizedSequence);
    setApplied(true);
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0f14] overflow-y-auto">

      {/* Header */}
      <div className="px-4 py-3 border-b border-[#1e2130]">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-6 h-6 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
            <Route className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <h2 className="text-sm font-bold text-white">Sequence Optimizer</h2>
        </div>
        <p className="text-[11px] text-slate-500 mb-2">
          Minimiza saltos, cortes y cambios de hilo preservando el orden de capas fill → satín → corrida.
        </p>
        <div className="flex flex-wrap gap-1">
          <AlgorithmBadge label="NN-Greedy" />
          <AlgorithmBadge label="2-opt" />
          <AlgorithmBadge label="Or-opt(1-3)" />
          <AlgorithmBadge label="Color-merge" />
        </div>
      </div>

      {/* Run button */}
      <div className="px-4 py-3 border-b border-[#1e2130]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-slate-500">{validCount} regiones</span>
          {result && (
            <span className="text-[10px] text-emerald-400 font-semibold">
              {result.after?.totalStitches?.toLocaleString()} puntadas totales
            </span>
          )}
        </div>
        <button
          onClick={run}
          disabled={running || validCount === 0}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors"
        >
          {running
            ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Optimizando secuencia...</>
            : <><Zap className="w-3.5 h-3.5" />{result ? 'Re-optimizar' : 'Optimizar secuencia'}</>
          }
        </button>
      </div>

      {/* Results */}
      {result && result.before && (
        <div className="flex-1 px-4 py-3 space-y-4">

          {/* Overall saving */}
          <div className="flex items-center justify-center py-3">
            <div className="text-center">
              <div className="text-5xl font-black text-emerald-400 leading-none">{result.overallPct}%</div>
              <div className="text-xs font-semibold text-slate-400 mt-1 uppercase tracking-wider">Ahorro global</div>
            </div>
          </div>

          {/* Time saving highlight */}
          <div className="rounded-lg border border-violet-500/25 bg-violet-900/10 px-3 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-violet-400" />
              <div>
                <div className="text-[11px] font-semibold text-violet-300">Tiempo de máquina</div>
                <div className="text-[10px] text-slate-500">
                  {formatTimeSec(result.before.totalTimeSec)} → {formatTimeSec(result.after.totalTimeSec)}
                </div>
              </div>
            </div>
            <span className="text-xl font-black text-violet-300">
              {result.savings.timePct > 0 ? `↓${result.savings.timePct}%` : '—'}
            </span>
          </div>

          {/* Thread saving */}
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-900/10 px-3 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 text-base">🧵</span>
              <div>
                <div className="text-[11px] font-semibold text-emerald-300">Hilo ahorrado</div>
                <div className="text-[10px] text-slate-500">
                  {formatThreadMm(result.before.threadMm)} → {formatThreadMm(result.after.threadMm)}
                </div>
              </div>
            </div>
            <span className="text-xl font-black text-emerald-400">
              {result.savings.threadPct > 0 ? `↓${result.savings.threadPct}%` : '—'}
            </span>
          </div>

          {/* 4-card grid */}
          <div className="grid grid-cols-2 gap-1.5">
            <SavingCard
              icon={Route}     label="Saltos"
              before={result.before.jumps} after={result.after.jumps} unit=""
              color="cyan"
            />
            <SavingCard
              icon={Scissors}  label="Cortes"
              before={result.before.cuts}  after={result.after.cuts}  unit=""
              color="rose"
            />
            <SavingCard
              icon={Palette}   label="Cambios hilo"
              before={result.before.colorChanges} after={result.after.colorChanges} unit=""
              color="amber"
            />
            <SavingCard
              icon={TrendingDown} label="Distancia"
              before={result.before.jumpDistMm} after={result.after.jumpDistMm} unit="mm"
              color="violet"
              sub={result.savings.jumpDistMm > 0 ? `−${result.savings.jumpDistMm}mm` : undefined}
            />
          </div>

          {/* Detailed comparison */}
          <button
            onClick={() => setShowDetail(d => !d)}
            className="w-full flex items-center justify-between py-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors border-t border-[#1a1d27]"
          >
            <span>Comparativa detallada</span>
            {showDetail ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {showDetail && (
            <div className="rounded-lg border border-[#1e2130] bg-[#0a0c12] px-3 py-1">
              <MetricRow label="Saltos totales"   before={result.before.jumps}        after={result.after.jumps}        unit="" />
              <MetricRow label="Cortes de hilo"   before={result.before.cuts}         after={result.after.cuts}         unit="" />
              <MetricRow label="Cambios color"    before={result.before.colorChanges} after={result.after.colorChanges} unit="" />
              <MetricRow label="Distancia saltos" before={result.before.jumpDistMm}   after={result.after.jumpDistMm}   unit="mm" />
              <MetricRow label="Tiempo puntadas"  before={result.before.stitchTimeSec} after={result.after.stitchTimeSec} unit="s" formatter={formatTimeSec} />
              <MetricRow label="Tiempo saltos"    before={result.before.jumpTimeSec}  after={result.after.jumpTimeSec}  unit="s" formatter={formatTimeSec} />
              <MetricRow label="Tiempo cambios"   before={result.before.colorTimeSec} after={result.after.colorTimeSec} unit="s" formatter={formatTimeSec} />
              <MetricRow label="Hilo total"       before={result.before.threadMm}     after={result.after.threadMm}     unit="" formatter={formatThreadMm} />
            </div>
          )}

          {/* Band sequence */}
          <button
            onClick={() => setShowBands(d => !d)}
            className="w-full flex items-center justify-between py-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors border-t border-[#1a1d27]"
          >
            <div className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              <span>Secuencia de capas ({result.bandGroups?.length} grupos)</span>
            </div>
            {showBands ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {showBands && (
            <div className="rounded-lg border border-[#1e2130] bg-[#0a0c12] px-3 py-1 max-h-52 overflow-y-auto">
              {result.bandGroups?.map((g, i) => (
                <BandGroupRow key={`${g.color}-${i}`} group={g} index={i} />
              ))}
            </div>
          )}

          {/* Apply button */}
          <button
            onClick={applyOrder}
            disabled={applied}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-colors ${
              applied
                ? 'bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 cursor-default'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white'
            }`}
          >
            {applied
              ? <><CheckCircle2 className="w-3.5 h-3.5" />Orden aplicado al diseño</>
              : <><Route className="w-3.5 h-3.5" />Aplicar secuencia optimizada</>
            }
          </button>

        </div>
      )}

      {/* Empty state */}
      {!result && !running && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 py-10">
          <div className="w-12 h-12 rounded-full bg-violet-900/20 border border-violet-500/20 flex items-center justify-center">
            <Route className="w-6 h-6 text-violet-500 opacity-60" />
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Analiza el orden actual de regiones y recalcula la secuencia óptima usando
            NN-Greedy + 2-opt + Or-opt para minimizar saltos y tiempo de bordado.
          </p>
        </div>
      )}
    </div>
  );
}