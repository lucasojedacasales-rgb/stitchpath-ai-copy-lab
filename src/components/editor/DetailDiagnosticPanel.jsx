import { useMemo } from 'react';
import { ShieldCheck, ShieldAlert, Eye, EyeOff, Layers, Scissors, Palette } from 'lucide-react';
import { preserveDetails } from '@/lib/detailPreservation.js';
import { classifyAllRegions } from '@/lib/regionClassifier.js';
import { processDetailRegions } from '@/lib/centerlineExtractor.js';

/**
 * DetailDiagnosticPanel — Lists preserved/discarded details with reasons.
 * Shows: detail score, preservation status, final class, original vs bordable
 * size, sewing order, and discard reason.
 */
const CLASS_LABELS = {
  outer_outline:     { label: 'Contorno Exterior', color: 'text-cyan-400', icon: Layers },
  inner_outline:     { label: 'Contorno Interno',  color: 'text-cyan-400', icon: Layers },
  detail_run:        { label: 'Detalle Run',       color: 'text-amber-400', icon: Scissors },
  detail_satin:      { label: 'Detalle Satin',     color: 'text-amber-400', icon: Scissors },
  micro_fill:        { label: 'Micro Relleno',     color: 'text-violet-400', icon: Palette },
  decorative_detail: { label: 'Detalle Deco',      color: 'text-amber-400', icon: Scissors },
  fill:              { label: 'Relleno',           color: 'text-violet-400', icon: Palette },
};

export default function DetailDiagnosticPanel({ regions = [], config = {}, detailReport, classReport, centerlineReport, outlineReport }) {
  const fallbackReports = useMemo(() => {
    if (detailReport || classReport || regions.length === 0) return null;
    const scored = preserveDetails(regions, { ...config, preserveAestheticDetails: true });
    const classified = classifyAllRegions(scored.regions, config);
    const centerlined = processDetailRegions(classified.regions, config);
    return { detail: scored.report, classes: classified.report, centerlines: centerlined.report };
  }, [regions, config, detailReport, classReport]);

  const effectiveDetailReport = detailReport || fallbackReports?.detail;
  const effectiveClassReport = classReport || fallbackReports?.classes;
  const effectiveCenterlineReport = centerlineReport || fallbackReports?.centerlines;

  if (!effectiveDetailReport && !effectiveClassReport) {
    return (
      <div className="p-3 text-center text-[11px] text-slate-600">
        Procesa una imagen para ver el diagnóstico de detalles.
      </div>
    );
  }

  const details = effectiveDetailReport?.details || [];
  const classes = effectiveClassReport?.classes || [];
  const centerlines = effectiveCenterlineReport?.details || [];
  const outlines = outlineReport?.outlines || [];

  // Build lookup maps
  const classMap = new Map(classes.map(c => [c.id, c]));
  const centerlineMap = new Map(centerlines.map(c => [c.id, c]));

  // Merge detail info with class info
  const merged = details.map(d => {
    const cls = classMap.get(d.id);
    const cl = centerlineMap.get(d.id);
    return {
      ...d,
      class: cls?.class || 'fill',
      stitchType: cls?.stitchType || 'fill',
      classReason: cls?.reason || '',
      priority: cls?.priority || 3,
      centerlinePts: cl?.centerlinePoints || 0,
      passes: cl?.passes || 0,
      originalWidth: cl?.originalWidth ?? d.mean_width_mm ?? 0,
      bordableWidth: cl?.bordableWidth ?? d.mean_width_mm ?? 0,
      expanded: cl?.expanded || false,
    };
  });

  const preserved = merged.filter(d => d.preserved);
  const discarded = merged.filter(d => !d.preserved);
  const hasMouth = preserved.some(d =>
    (d.name || '').toLowerCase().includes('mouth') ||
    (d.name || '').toLowerCase().includes('boca') ||
    (d.class === 'detail_run' && d.centerlinePts > 0)
  );

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard icon={ShieldCheck} label="Preservados" value={preserved.length} color="text-emerald-400" />
        <SummaryCard icon={ShieldAlert} label="Descartados" value={discarded.length} color="text-red-400" />
        <SummaryCard icon={Layers} label="Contornos" value={outlines.length} color="text-cyan-400" />
      </div>

      {/* Mouth detection badge */}
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-bold ${
        hasMouth
          ? 'bg-emerald-900/20 border-emerald-500/40 text-emerald-400'
          : 'bg-red-900/20 border-red-500/40 text-red-400'
      }`}>
        <Scissors className="w-3.5 h-3.5" />
        Boca como detail_run: {hasMouth ? 'SÍ ✓' : 'NO ✗'}
      </div>

      {/* Preserved details */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Eye className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[11px] font-bold text-emerald-400">Detalles Preservados</span>
        </div>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {preserved.length === 0 ? (
            <div className="text-[10px] text-slate-600 italic px-2">Ningún detalle preservado</div>
          ) : preserved.map(d => (
            <DetailRow key={d.id} detail={d} preserved={true} />
          ))}
        </div>
      </div>

      {/* Discarded details */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <EyeOff className="w-3.5 h-3.5 text-red-400" />
          <span className="text-[11px] font-bold text-red-400">Detalles Descartados</span>
        </div>
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {discarded.length === 0 ? (
            <div className="text-[10px] text-slate-600 italic px-2">Ningún detalle descartado</div>
          ) : discarded.map(d => (
            <DetailRow key={d.id} detail={d} preserved={false} />
          ))}
        </div>
      </div>

      {/* Outlines */}
      {outlines.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] font-bold text-cyan-400">Contornos Generados</span>
          </div>
          <div className="space-y-1">
            {outlines.map((o, i) => (
              <div key={i} className="text-[10px] text-slate-400 flex items-center gap-2 px-2 py-1 bg-[#0d0f14] rounded">
                <span className="text-cyan-400 font-bold">{o.name}</span>
                <span className="text-slate-600">·</span>
                <span>{o.stitchType}</span>
                <span className="text-slate-600">·</span>
                <span>prio={o.priority}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-[#0d0f14] rounded-lg p-2 text-center border border-[#1e2130]">
      <Icon className={`w-4 h-4 ${color} mx-auto mb-1`} />
      <div className={`text-sm font-bold ${color}`}>{value}</div>
      <div className="text-[9px] text-slate-600">{label}</div>
    </div>
  );
}

function DetailRow({ detail, preserved }) {
  const cls = CLASS_LABELS[detail.class] || CLASS_LABELS.fill;
  const Icon = cls.icon;
  return (
    <div className={`px-2 py-1.5 rounded text-[10px] border ${
      preserved ? 'bg-emerald-900/10 border-emerald-500/20' : 'bg-red-900/10 border-red-500/20'
    }`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className={`w-3 h-3 ${cls.color}`} />
        <span className={`font-bold ${preserved ? 'text-emerald-300' : 'text-red-300'}`}>
          {detail.name || detail.id}
        </span>
        <span className={`ml-auto ${cls.color} font-medium`}>{cls.label}</span>
      </div>
      <div className="flex items-center gap-2 text-slate-500">
        <span>Score: <span className={preserved ? 'text-emerald-400' : 'text-red-400'}>{detail.score}</span></span>
        {detail.originalWidth > 0 && (
          <span>Ancho: {detail.originalWidth.toFixed(1)}→{detail.bordableWidth.toFixed(1)}mm</span>
        )}
        {detail.centerlinePts > 0 && (
          <span>CL: {detail.centerlinePts}pts</span>
        )}
        <span className="ml-auto">Orden: {detail.priority}</span>
      </div>
      {!preserved && (!detail.reasons || detail.reasons.length === 0) && (
        <div className="text-[9px] text-red-400 mt-0.5">Descartado: score insuficiente ({detail.score}/55)</div>
      )}
      {preserved && detail.reasons?.length > 0 && (
        <div className="text-[9px] text-emerald-400 mt-0.5">{detail.reasons.join(' · ')}</div>
      )}
    </div>
  );
}