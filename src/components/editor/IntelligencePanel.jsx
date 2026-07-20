/**
 * IntelligencePanel — EIE transparency + fix/calibrate actions
 */

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Zap, Brain, CheckCircle, AlertTriangle, XCircle, Info, Wrench, Sliders, RefreshCw } from 'lucide-react';
import { eieAnalyzeRegion, FABRIC_MODEL } from '@/lib/stitchIntelligence.js';

const STITCH_COLORS = {
  fill:           'text-violet-400 bg-violet-900/20 border-violet-500/30',
  satin:          'text-cyan-400 bg-cyan-900/20 border-cyan-500/30',
  running_stitch: 'text-slate-400 bg-slate-800/30 border-slate-600/30',
};

const STITCH_LABELS = { fill: 'Fill Tatami', satin: 'Satin', running_stitch: 'Running Stitch' };

const PRIORITY_LABELS = {
  1: 'Fondo base', 2: 'Capa fondo', 3: 'Secundaria', 4: 'Intermedia',
  5: 'Detalle fill', 6: 'Capa sup.', 7: 'Detalle sup.', 8: 'Outline',
  9: 'Contorno', 10: 'Detalle fino',
};

const UNDERLAY_LABELS = {
  null: 'Ninguno', centre_walk: 'Centre walk', zigzag: 'Zigzag',
  zigzag_centre: 'Zigzag + Centre walk', edge_walk: 'Edge walk',
  edge_walk_zigzag: 'Edge walk + Zigzag', full_coverage: 'Full coverage',
};

function ConfidenceBar({ value }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-[#1e2130] rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[11px] font-bold w-8 text-right ${pct >= 80 ? 'text-emerald-400' : pct >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{pct}%</span>
    </div>
  );
}

function Section({ title, icon: Icon, iconClass, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[#1e2130] rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-2 bg-[#0d0f14] hover:bg-[#161a23] transition-colors">
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${iconClass}`} />
        <span className="text-[11px] font-semibold text-slate-300 flex-1 text-left">{title}</span>
        {open ? <ChevronDown className="w-3 h-3 text-slate-600" /> : <ChevronRight className="w-3 h-3 text-slate-600" />}
      </button>
      {open && <div className="px-3 py-2.5 space-y-2 bg-[#0a0c12]">{children}</div>}
    </div>
  );
}

function DataRow({ label, value, valueClass = 'text-slate-300', note }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-[10px] text-slate-600 shrink-0">{label}</span>
      <div className="text-right">
        <span className={`text-[11px] font-semibold ${valueClass}`}>{value}</span>
        {note && <div className="text-[9px] text-slate-600 leading-tight mt-0.5">{note}</div>}
      </div>
    </div>
  );
}

function Rationale({ text }) {
  if (!text) return null;
  return <p className="text-[9px] text-slate-600 leading-relaxed border-l border-[#2a2d3a] pl-2 mt-1">{text}</p>;
}

// ─── Calibration slider ────────────────────────────────────────────────────────

function CalibSlider({ label, value, min, max, step = 0.01, unit = '', onChange, color = 'text-violet-400' }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500">{label}</span>
        <span className={`text-[11px] font-bold ${color}`}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-violet-600 h-1" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IntelligencePanel({ region, config, allRegions = [], onUpdate }) {
  const [showRaw, setShowRaw] = useState(false);
  const [activeAction, setActiveAction] = useState(null); // null | 'fix' | 'calibrate' | 'override'

  // Calibration overrides (local state until applied)
  const [calibOverrides, setCalibOverrides] = useState({});
  const [applied, setApplied] = useState(false);

  const eieResult = useMemo(() => {
    if (!region || !region.path_points || region.path_points.length < 3) return null;

    const { width_mm = 100, height_mm = 100, fabric_type = 'Algodón' } = config || {};

    const geo = {
      area_mm2:           region.area_mm2 || 10,
      perimeter_mm:       region.perimeter_mm || 20,
      mean_width_mm:      region.mean_width_mm || 5,
      max_width_mm:       region.max_width_mm || 6,
      skeleton_length_mm: region.skeleton_length_mm || 10,
      orientation:        region.orientation || 45,
      convexity:          region.convexity || 0.8,
      concavity:          region.concavity || 0.2,
      mean_curvature:     region.mean_curvature || 0.3,
      complexity:         region.complexity || { score: 0.3, level: 'media' },
      holes:              region.holes || 0,
      centroid:           region.centroid || [0.5, 0.5],
      color:              region.color || '#888888',
    };

    const neighbours = allRegions.filter(r => r.id !== region.id && r.angle != null);
    const [cx, cy] = geo.centroid;
    const nearest = neighbours.reduce((best, r) => {
      const [rx, ry] = r.centroid || [0.5, 0.5];
      const d = Math.hypot(rx - cx, ry - cy);
      return (!best || d < best.d) ? { d, angle: r.angle } : best;
    }, null);

    return eieAnalyzeRegion(geo, config?.fabric_type || 'Algodón', {
      neighbourAngle: nearest?.angle,
      existingPriority: null,
    }, {
      ...(region.adaptive === false && region.stitch_type ? { stitch_type: region.stitch_type } : {}),
      ...calibOverrides,
    });
  }, [region, config, allRegions, calibOverrides]);

  // Reset calibration state when region changes
  useMemo(() => {
    setCalibOverrides({});
    setApplied(false);
    setActiveAction(null);
  }, [region?.id]);

  if (!region) {
    return (
      <div className="p-4 text-center text-[11px] text-slate-600">
        <Brain className="w-6 h-6 mx-auto mb-2 text-slate-700" />
        Selecciona una región para ver el análisis del motor de inteligencia.
      </div>
    );
  }

  if (!eieResult) {
    return <div className="p-3 text-[11px] text-slate-600">Región sin geometría suficiente para analizar.</div>;
  }

  const qual = region.quality_score ?? 70;
  const qualColor = qual >= 80 ? 'text-emerald-400' : qual >= 60 ? 'text-amber-400' : 'text-red-400';
  const QIcon = qual >= 80 ? CheckCircle : qual >= 60 ? AlertTriangle : XCircle;
  const issues = region.quality_issues || [];

  // Apply EIE result to the region
  const applyEIE = (extraOverrides = {}) => {
    if (!onUpdate || !region) return;
    const merged = { ...eieResult, ...extraOverrides };
    const updated = allRegions.map(r =>
      r.id !== region.id ? r : {
        ...r,
        stitch_type:       merged.stitch_type,
        density:           merged.density_mm,
        angle:             merged.fill_angle,
        fill_angle:        merged.fill_angle,
        pull_compensation: merged.pull_compensation_mm,
        underlay:          merged.underlay?.type ? true : false,
        priority:          merged.priority,
        adaptive:          true,
        quality_issues:    [],
      }
    );
    onUpdate(updated);
    setApplied(true);
    setActiveAction(null);
  };

  // Auto-fix: apply EIE suggestion for each detected issue
  const autoFix = () => {
    const fixes = {};
    for (const issue of issues) {
      if (issue.includes('Área extremadamente pequeña') || issue.includes('running_stitch')) {
        fixes.stitch_type = 'running_stitch';
      }
      if (issue.includes('Ancho satin') && issue.includes('excede')) {
        fixes.stitch_type = 'fill';
      }
      if (issue.includes('concave') || issue.includes('cóncava')) {
        fixes.stitch_type = 'fill';
      }
      if (issue.includes('densidad muy alta')) {
        fixes.density_mm = Math.max(0.38, (eieResult.density_mm || 0.40) + 0.06);
      }
    }
    applyEIE(fixes);
  };

  return (
    <div className="space-y-2 text-white">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <Brain className="w-4 h-4 text-violet-400" />
        <span className="text-xs font-bold text-slate-200">EIE v2.0</span>
        {applied && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/30 border border-emerald-500/30 text-emerald-400 ml-auto">✓ Aplicado</span>
        )}
        {!applied && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-900/30 border border-violet-500/30 text-violet-400 ml-auto">Motor activo</span>
        )}
      </div>

      {/* Overall confidence */}
      <div className="bg-[#0d0f14] rounded-lg p-2.5 border border-[#1e2130]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-slate-500">Confianza global</span>
          <div className="flex items-center gap-1">
            <QIcon className={`w-3 h-3 ${qualColor}`} />
            <span className={`text-[11px] font-bold ${qualColor}`}>{qual}/100</span>
          </div>
        </div>
        <ConfidenceBar value={eieResult.overall_confidence} />
        {issues.length > 0 && (
          <div className="mt-2 space-y-1">
            {issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="w-2.5 h-2.5 text-amber-500 flex-shrink-0 mt-0.5" />
                <span className="text-[9px] text-amber-600 leading-relaxed">{issue}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Action buttons ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-1">
        <button
          onClick={() => applyEIE()}
          className="flex flex-col items-center gap-1 px-2 py-2 rounded-lg bg-violet-600/20 border border-violet-500/30 hover:bg-violet-600/40 text-violet-300 transition-colors"
        >
          <Zap className="w-3.5 h-3.5" />
          <span className="text-[9px] font-semibold">Aplicar EIE</span>
        </button>
        <button
          onClick={() => { setActiveAction(activeAction === 'fix' ? null : 'fix'); }}
          disabled={issues.length === 0}
          className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
            activeAction === 'fix'
              ? 'bg-amber-600/30 border-amber-500/40 text-amber-300'
              : 'bg-amber-600/10 border-amber-500/20 hover:bg-amber-600/25 text-amber-400'
          }`}
        >
          <Wrench className="w-3.5 h-3.5" />
          <span className="text-[9px] font-semibold">Fix errores</span>
        </button>
        <button
          onClick={() => {
            if (activeAction !== 'calibrate') {
              setCalibOverrides({
                stitch_type:       eieResult.stitch_type,
                density:           eieResult.density_mm,
                angle:             eieResult.fill_angle,
                pull_compensation: eieResult.pull_compensation_mm,
              });
            }
            setActiveAction(activeAction === 'calibrate' ? null : 'calibrate');
          }}
          className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border transition-colors ${
            activeAction === 'calibrate'
              ? 'bg-cyan-600/30 border-cyan-500/40 text-cyan-300'
              : 'bg-cyan-600/10 border-cyan-500/20 hover:bg-cyan-600/25 text-cyan-400'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span className="text-[9px] font-semibold">Calibrar</span>
        </button>
      </div>

      {/* ─── Fix errores panel ───────────────────────────────────────────── */}
      {activeAction === 'fix' && issues.length > 0 && (
        <div className="border border-amber-500/20 rounded-lg p-2.5 bg-amber-900/10 space-y-2">
          <div className="text-[10px] font-semibold text-amber-400 flex items-center gap-1.5">
            <Wrench className="w-3 h-3" /> Correcciones sugeridas
          </div>
          <div className="space-y-1.5">
            {issues.map((issue, i) => {
              // Derive fix label from issue text
              let fixLabel = 'Corregir parámetro';
              let fixDetail = '';
              if (issue.includes('pequeña') || issue.includes('pérdida')) {
                fixLabel = 'Cambiar a Running Stitch'; fixDetail = 'running_stitch';
              } else if (issue.includes('Ancho satin') && issue.includes('excede')) {
                fixLabel = 'Cambiar a Fill Tatami'; fixDetail = 'fill';
              } else if (issue.includes('cóncava') || issue.includes('concave')) {
                fixLabel = 'Cambiar a Fill Tatami'; fixDetail = 'fill';
              } else if (issue.includes('densidad')) {
                fixLabel = 'Aumentar espaciado (+0.06mm)'; fixDetail = 'density';
              } else if (issue.includes('agujero')) {
                fixLabel = 'Usar Fill con underlay'; fixDetail = 'fill_underlay';
              }
              return (
                <div key={i} className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="text-[9px] text-amber-500 leading-tight">{issue}</div>
                    <div className="text-[9px] text-slate-500 mt-0.5">→ {fixLabel}</div>
                  </div>
                  <button
                    onClick={() => {
                      const fix = {};
                      if (fixDetail === 'running_stitch') fix.stitch_type = 'running_stitch';
                      else if (fixDetail === 'fill') fix.stitch_type = 'fill';
                      else if (fixDetail === 'density') fix.density_mm = Math.min(0.65, (eieResult.density_mm || 0.40) + 0.06);
                      else if (fixDetail === 'fill_underlay') { fix.stitch_type = 'fill'; fix.underlay = true; }
                      applyEIE(fix);
                    }}
                    className="px-2 py-0.5 rounded bg-amber-600/30 border border-amber-500/30 text-amber-300 text-[9px] font-semibold hover:bg-amber-600/50 transition-colors flex-shrink-0"
                  >
                    Aplicar
                  </button>
                </div>
              );
            })}
          </div>
          <button
            onClick={autoFix}
            className="w-full mt-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-amber-600/25 border border-amber-500/30 text-amber-300 text-[10px] font-bold hover:bg-amber-600/40 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Fix automático (todos)
          </button>
        </div>
      )}

      {/* ─── Calibrar panel ──────────────────────────────────────────────── */}
      {activeAction === 'calibrate' && (
        <div className="border border-cyan-500/20 rounded-lg p-2.5 bg-cyan-900/10 space-y-3">
          <div className="text-[10px] font-semibold text-cyan-400 flex items-center gap-1.5">
            <Sliders className="w-3 h-3" /> Calibración manual
          </div>

          {/* Stitch type override */}
          <div className="space-y-1">
            <span className="text-[10px] text-slate-500">Tipo de puntada</span>
            <div className="flex gap-1">
              {['fill', 'satin', 'running_stitch'].map(t => (
                <button
                  key={t}
                  onClick={() => setCalibOverrides(o => ({ ...o, stitch_type: t }))}
                  className={`flex-1 px-1.5 py-1 rounded text-[9px] font-semibold border transition-colors ${
                    (calibOverrides.stitch_type || eieResult.stitch_type) === t
                      ? STITCH_COLORS[t]
                      : 'border-[#2a2d3a] text-slate-600 hover:text-slate-400'
                  }`}
                >
                  {t === 'fill' ? 'Fill' : t === 'satin' ? 'Satin' : 'Run'}
                </button>
              ))}
            </div>
          </div>

          <CalibSlider
            label="Ángulo de relleno"
            value={calibOverrides.angle ?? eieResult.fill_angle}
            min={0} max={179} step={1} unit="°"
            color="text-cyan-400"
            onChange={v => setCalibOverrides(o => ({ ...o, angle: v }))}
          />

          <CalibSlider
            label="Densidad (espaciado filas)"
            value={calibOverrides.density ?? eieResult.density_mm}
            min={0.28} max={0.65} step={0.01} unit="mm"
            color="text-amber-400"
            onChange={v => setCalibOverrides(o => ({ ...o, density: v }))}
          />

          <CalibSlider
            label="Pull compensation"
            value={calibOverrides.pull_compensation ?? eieResult.pull_compensation_mm}
            min={0} max={0.8} step={0.01} unit="mm"
            color="text-rose-400"
            onChange={v => setCalibOverrides(o => ({ ...o, pull_compensation: v }))}
          />

          <CalibSlider
            label="Prioridad de capa"
            value={calibOverrides.priority ?? eieResult.priority}
            min={1} max={10} step={1} unit=""
            color="text-indigo-400"
            onChange={v => setCalibOverrides(o => ({ ...o, priority: v }))}
          />

          <div className="flex gap-1 pt-1">
            <button
              onClick={() => { setCalibOverrides({}); }}
              className="flex-1 py-1.5 rounded border border-[#2a2d3a] text-slate-500 text-[9px] font-semibold hover:text-slate-300 transition-colors"
            >
              Resetear
            </button>
            <button
              onClick={() => applyEIE(calibOverrides)}
              className="flex-1 py-1.5 rounded bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 text-[9px] font-bold hover:bg-cyan-600/50 transition-colors"
            >
              Aplicar calibración
            </button>
          </div>
        </div>
      )}

      {/* ─── Stitch Type ─────────────────────────────────────────────────── */}
      <Section title="Tipo de puntada" icon={Zap} iconClass="text-violet-400" defaultOpen>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded border ${STITCH_COLORS[eieResult.stitch_type] || 'text-slate-400'}`}>
            {STITCH_LABELS[eieResult.stitch_type] || eieResult.stitch_type}
          </span>
          <ConfidenceBar value={eieResult.stitch_confidence} />
        </div>
        <Rationale text={eieResult.stitch_rationale} />
        {eieResult.stitch_signals?.length > 0 && (
          <div className="mt-2">
            <div className="text-[9px] text-slate-600 mb-1">Señales disparadas:</div>
            <div className="space-y-0.5">
              {eieResult.stitch_signals.filter(s => s.fired).map(s => (
                <div key={s.id} className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-500 font-mono">{s.id.replace(/_/g, ' ')}</span>
                  <span className={`text-[9px] font-bold ${s.weight > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {s.weight > 0 ? '+' : ''}{s.weight.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ─── Fill Angle ──────────────────────────────────────────────────── */}
      <Section title="Ángulo de relleno" icon={Info} iconClass="text-cyan-400">
        <DataRow label="Ángulo EIE" value={`${eieResult.fill_angle}°`} valueClass="text-cyan-400" />
        <Rationale text={eieResult.angle_rationale} />
      </Section>

      {/* ─── Density ─────────────────────────────────────────────────────── */}
      <Section title="Densidad" icon={Info} iconClass="text-amber-400">
        <DataRow
          label="Espaciado de filas"
          value={`${eieResult.density_mm}mm`}
          valueClass="text-amber-400"
          note={eieResult.density_mm < 0.34 ? 'Denso (patches/badges)' : eieResult.density_mm < 0.46 ? 'Estándar' : 'Aireado (delicado)'}
        />
        <Rationale text={eieResult.density_rationale} />
      </Section>

      {/* ─── Compensation ────────────────────────────────────────────────── */}
      <Section title="Compensación" icon={Info} iconClass="text-rose-400">
        <DataRow label="Pull (lateral)" value={`+${eieResult.pull_compensation_mm}mm`} valueClass="text-rose-400" />
        <Rationale text={eieResult.pull_rationale} />
        <div className="mt-2">
          <DataRow label="Push (longitudinal)" value={`+${eieResult.push_compensation_mm}mm`} valueClass="text-orange-400" />
          <Rationale text={eieResult.push_rationale} />
        </div>
      </Section>

      {/* ─── Underlay ────────────────────────────────────────────────────── */}
      <Section title="Underlay" icon={Info} iconClass="text-emerald-400">
        <DataRow
          label="Tipo"
          value={eieResult.underlay.type ? (UNDERLAY_LABELS[eieResult.underlay.type] || eieResult.underlay.type) : 'Ninguno'}
          valueClass={eieResult.underlay.type ? 'text-emerald-400' : 'text-slate-500'}
        />
        {eieResult.underlay.type && (
          <>
            {eieResult.underlay.density_mm > 0 && <DataRow label="Densidad underlay" value={`${eieResult.underlay.density_mm}mm`} valueClass="text-emerald-300" />}
            {eieResult.underlay.angle_deg > 0 && <DataRow label="Ángulo underlay" value={`${eieResult.underlay.angle_deg}°`} valueClass="text-emerald-300" />}
            {eieResult.underlay.second_pass && (
              <div className="text-[9px] text-emerald-600 border border-emerald-800/40 rounded px-1.5 py-0.5 mt-1">⚡ Doble pase activado</div>
            )}
          </>
        )}
        <Rationale text={eieResult.underlay_rationale} />
      </Section>

      {/* ─── Priority + Travel ───────────────────────────────────────────── */}
      <Section title="Prioridad y recorrido" icon={Info} iconClass="text-indigo-400">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-full bg-indigo-900/40 border border-indigo-500/30 flex items-center justify-center">
            <span className="text-[10px] font-bold text-indigo-400">{eieResult.priority}</span>
          </div>
          <span className="text-[10px] text-slate-400">{PRIORITY_LABELS[eieResult.priority] || '—'}</span>
        </div>
        <Rationale text={eieResult.priority_rationale} />
        <div className="mt-2 pt-2 border-t border-[#1e2130]">
          <DataRow label="Travel score" value={eieResult.travel_score.toFixed(4)} valueClass="text-indigo-400" note="Menor = costura antes (mismo grupo)" />
        </div>
      </Section>

      {/* ─── Fabric model ────────────────────────────────────────────────── */}
      <div className="bg-[#0a0c12] rounded-lg border border-[#1e2130] px-3 py-2">
        <div className="text-[9px] text-slate-600 mb-1.5">Modelo de tejido — {config?.fabric_type || 'Algodón'}</div>
        {(() => {
          const f = FABRIC_MODEL[config?.fabric_type || 'Algodón'] || FABRIC_MODEL['Algodón'];
          return (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <DataRow label="Pull factor" value={`×${f.pull_factor}`} valueClass="text-rose-400" />
              <DataRow label="Push factor" value={`×${f.push_factor}`} valueClass="text-orange-400" />
              <DataRow label="Δ densidad" value={`${f.density_adj >= 0 ? '+' : ''}${f.density_adj}mm`} valueClass="text-amber-400" />
              <DataRow label="Estabilizador" value={'★'.repeat(f.stabiliser_need)} valueClass="text-yellow-400" />
            </div>
          );
        })()}
      </div>

      {/* ─── Raw JSON ────────────────────────────────────────────────────── */}
      <button onClick={() => setShowRaw(r => !r)} className="w-full text-[9px] text-slate-600 hover:text-slate-400 py-1 transition-colors">
        {showRaw ? '▲ Ocultar datos brutos' : '▼ Ver datos brutos EIE'}
      </button>
      {showRaw && (
        <pre className="text-[8px] text-slate-600 bg-[#0a0c12] rounded p-2 overflow-auto max-h-48 border border-[#1e2130]">
          {JSON.stringify(eieResult, null, 2)}
        </pre>
      )}
    </div>
  );
}