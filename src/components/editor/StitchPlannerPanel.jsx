/**
 * StitchPlannerPanel
 *
 * Panel UI del AI Stitch Planner.
 * Muestra el plan estratégico completo generado por stitchPlanner.js
 */

import { useState, useMemo } from 'react';
import {
  Zap, CheckCircle, AlertTriangle, XCircle, Clock, Layers,
  GitBranch, ChevronDown, ChevronRight, Cpu, RefreshCw, Sparkles,
} from 'lucide-react';
import { generateStitchPlan } from '@/lib/stitchPlanner.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STITCH_BADGE = {
  fill:            { label: 'Fill',    cls: 'badge-fill'  },
  satin:           { label: 'Satén',   cls: 'badge-satin' },
  running_stitch:  { label: 'Run',     cls: 'badge-run'   },
};

const WARNING_STYLE = {
  error: { icon: XCircle,       cls: 'bg-red-900/10 border-red-500/20 text-red-400',    iconCls: 'text-red-400'    },
  warn:  { icon: AlertTriangle, cls: 'bg-amber-900/10 border-amber-500/20 text-amber-400', iconCls: 'text-amber-400' },
  info:  { icon: CheckCircle,   cls: 'bg-blue-900/10 border-blue-500/20 text-blue-400', iconCls: 'text-blue-400'  },
};

function ViabilityMeter({ score }) {
  const color = score >= 85 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
  const label = score >= 85 ? 'Listo para producción' : score >= 60 ? 'Requiere ajustes' : 'Revisar diseño';
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-xs text-slate-400">Viabilidad</span>
        <span className="text-sm font-bold" style={{ color }}>{score}%</span>
      </div>
      <div className="h-2 bg-[#161a23] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <p className="text-[11px]" style={{ color }}>{label}</p>
    </div>
  );
}

function StatPill({ label, value, color = 'text-slate-300' }) {
  return (
    <div className="bg-[#0d0f14] rounded-lg px-3 py-2 text-center">
      <div className={`text-sm font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-slate-600 mt-0.5">{label}</div>
    </div>
  );
}

function WarningItem({ warning }) {
  const style = WARNING_STYLE[warning.level] || WARNING_STYLE.info;
  const Icon  = style.icon;
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${style.cls}`}>
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${style.iconCls}`} />
      <span>{warning.message}</span>
    </div>
  );
}

function RegionPlanRow({ plan, index }) {
  const [open, setOpen] = useState(false);
  const badge = STITCH_BADGE[plan.stitchType] || STITCH_BADGE.running_stitch;
  const confColor = plan.confidence >= 0.9 ? 'text-emerald-400' : plan.confidence >= 0.75 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="border-b border-[#1a1d27] last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#1a1d27]/50 transition-colors text-left"
      >
        <span className="text-[10px] text-slate-600 w-4 flex-shrink-0">{index + 1}</span>
        <div className="w-3 h-3 rounded-full flex-shrink-0 border border-white/10" style={{ background: plan.color }} />
        <span className="flex-1 text-xs text-slate-300 truncate">{plan.regionName}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${badge.cls}`}>{badge.label}</span>
        <span className={`text-[10px] font-bold ${confColor}`}>{Math.round(plan.confidence * 100)}%</span>
        {open ? <ChevronDown className="w-3 h-3 text-slate-600" /> : <ChevronRight className="w-3 h-3 text-slate-600" />}
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-1.5 bg-[#0a0c10]">
          <p className="text-[11px] text-slate-400 leading-relaxed">{plan.reason}</p>
          <div className="grid grid-cols-3 gap-1 pt-1">
            <div className="text-center">
              <div className="text-xs font-bold text-violet-400">{plan.optimalAngle}°</div>
              <div className="text-[10px] text-slate-600">Ángulo óptimo</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-bold text-cyan-400">{plan.estimatedStitches.toLocaleString()}</div>
              <div className="text-[10px] text-slate-600">Puntadas est.</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-bold text-amber-400">{(plan.areaMm2 || 0).toFixed(1)} mm²</div>
              <div className="text-[10px] text-slate-600">Área</div>
            </div>
          </div>
          {plan.underlay && (
            <div className="flex items-center gap-2 mt-1 px-2 py-1.5 rounded bg-violet-900/10 border border-violet-500/20">
              <Layers className="w-3 h-3 text-violet-400 flex-shrink-0" />
              <span className="text-[11px] text-violet-300">{plan.underlay.reason}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Panel principal ──────────────────────────────────────────────────────────

export default function StitchPlannerPanel({ regions, config, onApplyPlan }) {
  const [expanded, setExpanded] = useState({ summary: true, sequence: false, warnings: true });
  const [applied, setApplied]   = useState(false);

  const plan = useMemo(() => {
    if (!regions || regions.length === 0) return null;
    return generateStitchPlan(regions, config);
  }, [regions, config]);

  const toggle = (key) => setExpanded(e => ({ ...e, [key]: !e[key] }));

  const handleApply = () => {
    if (!plan || !onApplyPlan) return;
    // Construir mapa de cambios sugeridos para cada región
    const updates = plan.sequence.map(rp => ({
      id:          rp.regionId,
      stitch_type: rp.stitchType,
      angle:       rp.optimalAngle,
      underlay:    !!rp.underlay,
    }));
    onApplyPlan(updates);
    setApplied(true);
    setTimeout(() => setApplied(false), 2500);
  };

  if (!regions || regions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 px-4 text-center">
        <Cpu className="w-8 h-8 text-slate-700" />
        <p className="text-xs text-slate-500">Procesa una imagen primero para generar el plan estratégico.</p>
      </div>
    );
  }

  if (!plan) return null;

  const { summary, warnings, narrative, sequence } = plan;
  const hasErrors = warnings.some(w => w.level === 'error');

  return (
    <div className="flex flex-col h-full bg-[#0d0f14] overflow-y-auto">

      {/* ── Header ── */}
      <div className="px-4 py-3 border-b border-[#1e2130] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <span className="text-xs font-bold text-white">AI Stitch Planner</span>
        </div>
        <button
          onClick={() => setExpanded({ summary: true, sequence: false, warnings: true })}
          title="Recalcular"
          className="p-1.5 rounded hover:bg-[#1e2130] text-slate-500 hover:text-white transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Narrativa ── */}
      <div className="px-4 py-3 border-b border-[#1e2130] bg-[#0a0c12]">
        <p className="text-xs text-slate-300 leading-relaxed">{narrative}</p>
      </div>

      {/* ── Viabilidad ── */}
      <div className="px-4 py-3 border-b border-[#1e2130]">
        <ViabilityMeter score={summary.viabilityScore} />
      </div>

      {/* ── Stats ── */}
      <div className="px-4 py-3 border-b border-[#1e2130]">
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          <StatPill label="Colores" value={summary.uniqueColors} color="text-cyan-400" />
          <StatPill label="Cambios hilo" value={summary.colorChanges} color="text-amber-400" />
          <StatPill label="Puntadas est." value={`~${Math.round(summary.totalStitches / 1000)}k`} color="text-violet-400" />
          <StatPill label="Tiempo" value={summary.time.formatted} color="text-emerald-400" />
        </div>
        <div className="flex gap-1.5">
          <div className="flex-1 text-center bg-[#0d0f14] rounded px-2 py-1.5">
            <div className="text-xs font-bold text-violet-400">{summary.fillCount}</div>
            <div className="text-[10px] text-slate-600">Fill</div>
          </div>
          <div className="flex-1 text-center bg-[#0d0f14] rounded px-2 py-1.5">
            <div className="text-xs font-bold text-cyan-400">{summary.satinCount}</div>
            <div className="text-[10px] text-slate-600">Satén</div>
          </div>
          <div className="flex-1 text-center bg-[#0d0f14] rounded px-2 py-1.5">
            <div className="text-xs font-bold text-slate-400">{summary.runCount}</div>
            <div className="text-[10px] text-slate-600">Run</div>
          </div>
          <div className="flex-1 text-center bg-[#0d0f14] rounded px-2 py-1.5">
            <div className="text-xs font-bold text-amber-400">{summary.withUnderlay}</div>
            <div className="text-[10px] text-slate-600">Underlay</div>
          </div>
        </div>
      </div>

      {/* ── Advertencias ── */}
      {warnings.length > 0 && (
        <div className="border-b border-[#1e2130]">
          <button
            onClick={() => toggle('warnings')}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1e2130]/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className={`w-3.5 h-3.5 ${hasErrors ? 'text-red-400' : 'text-amber-400'}`} />
              <span className="text-xs font-semibold text-slate-300">
                Advertencias <span className={hasErrors ? 'text-red-400' : 'text-amber-400'}>({warnings.length})</span>
              </span>
            </div>
            {expanded.warnings ? <ChevronDown className="w-3.5 h-3.5 text-slate-600" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-600" />}
          </button>
          {expanded.warnings && (
            <div className="px-4 pb-3 space-y-2">
              {warnings.map((w, i) => <WarningItem key={i} warning={w} />)}
            </div>
          )}
        </div>
      )}

      {/* ── Secuencia de regiones ── */}
      <div className="border-b border-[#1e2130]">
        <button
          onClick={() => toggle('sequence')}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1e2130]/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <GitBranch className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-xs font-semibold text-slate-300">
              Secuencia de bordado <span className="text-violet-400">({sequence.length})</span>
            </span>
          </div>
          {expanded.sequence ? <ChevronDown className="w-3.5 h-3.5 text-slate-600" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-600" />}
        </button>
        {expanded.sequence && (
          <div>
            <div className="px-4 pb-1 text-[10px] text-slate-600 flex justify-between">
              <span>Región</span>
              <span>Técnica · Confianza</span>
            </div>
            {sequence.map((rp, i) => (
              <RegionPlanRow key={rp.regionId} plan={rp} index={i} />
            ))}
          </div>
        )}
      </div>

      {/* ── Botón aplicar ── */}
      <div className="p-4 mt-auto">
        <button
          onClick={handleApply}
          disabled={applied}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-bold transition-colors"
        >
          {applied ? (
            <><CheckCircle className="w-4 h-4" /> Plan aplicado</>
          ) : (
            <><Zap className="w-4 h-4" /> Aplicar plan al proyecto</>
          )}
        </button>
        <p className="text-[10px] text-slate-600 text-center mt-2">
          Actualiza tipo de puntada, ángulo y underlay en todas las regiones
        </p>
      </div>
    </div>
  );
}