/**
 * RegionInspector.jsx
 *
 * Panel lateral que muestra todos los campos enriquecidos de una región:
 * geometría, producción, calidad, thread, timing.
 */

import { useMemo } from 'react';
import { enrichRegion } from '@/lib/regionBuilder.js';

function Row({ label, value, color = 'text-slate-200', mono = false }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-[#1a1d27] last:border-0">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`text-[11px] font-semibold ${color} ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-3">
      <div className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1 px-1">{title}</div>
      <div className="bg-[#0d0f14] rounded-lg px-3 py-1">{children}</div>
    </div>
  );
}

function QualityBar({ score }) {
  const color = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
  return (
    <div className="mt-1 mb-2">
      <div className="flex justify-between mb-1">
        <span className="text-[10px] text-slate-500">Quality Score</span>
        <span className="text-[11px] font-bold" style={{ color }}>{score}/100</span>
      </div>
      <div className="h-1.5 bg-[#161a23] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function RegionInspector({ region, allRegions, widthMm, heightMm }) {
  const r = useMemo(
    () => enrichRegion(region, allRegions || [], widthMm || 100, heightMm || 100),
    [region, allRegions, widthMm, heightMm]
  );

  if (!r) return null;

  const complexityColor = r.complexity?.level === 'simple' ? 'text-emerald-400'
    : r.complexity?.level === 'media' ? 'text-amber-400'
    : 'text-red-400';

  const convexityColor = (r.convexity || 0) > 0.85 ? 'text-emerald-400'
    : (r.convexity || 0) > 0.6 ? 'text-amber-400'
    : 'text-red-400';

  const timeFormatted = r.estimatedTime < 1
    ? `<1 min`
    : r.estimatedTime < 60
    ? `${r.estimatedTime.toFixed(1)} min`
    : `${Math.floor(r.estimatedTime / 60)}h ${Math.round(r.estimatedTime % 60)}min`;

  return (
    <div className="p-3 text-xs">
      <QualityBar score={r.qualityScore || 0} />

      <Section title="Identificación">
        <Row label="ID" value={r.id?.slice(0, 12) + '…'} mono />
        <Row label="Nombre" value={r.name || '—'} />
        <Row label="Tipo" value={r.stitch_type || '—'} color={
          r.stitch_type === 'fill' ? 'text-violet-400' :
          r.stitch_type === 'satin' ? 'text-cyan-400' : 'text-slate-400'
        } />
        <Row label="Prioridad" value={`${r.priority || 1} / 5`} color="text-amber-400" />
        <Row label="Orden viaje" value={r.travelOrder ? `#${r.travelOrder}` : '—'} color="text-violet-300" />
      </Section>

      <Section title="Geometría">
        <Row label="Área" value={`${(r.area_mm2 || 0).toFixed(1)} mm²`} color="text-slate-200" />
        <Row label="Perímetro" value={`${(r.perimeter_mm || 0).toFixed(1)} mm`} />
        <Row label="Orientación" value={`${r.orientation ?? '—'}°`} color="text-cyan-300" />
        <Row label="Convexidad" value={`${((r.convexity || 0) * 100).toFixed(0)}%`} color={convexityColor} />
        <Row label="Curvatura" value={(r.curvature || 0).toFixed(3)} />
        <Row label="Agujeros" value={r.holes ?? 0} color={r.holes > 0 ? 'text-amber-400' : 'text-slate-400'} />
        <Row label="Complejidad" value={r.complexity?.level || '—'} color={complexityColor} />
      </Section>

      <Section title="Puntadas">
        <Row label="Puntadas est." value={(r.stitch_count || 0).toLocaleString('es-ES')} color="text-violet-400" />
        <Row label="Densidad" value={r.density || 0.7} />
        <Row label="Ángulo" value={`${r.angle || 0}°`} />
        <Row label="Underlay" value={r.underlay ? 'Sí' : 'No'} color={r.underlay ? 'text-emerald-400' : 'text-slate-500'} />
        <Row label="Pull comp." value={`${r.pull_compensation || 0} mm`} />
      </Section>

      <Section title="Producción">
        <Row label="Tiempo est." value={timeFormatted} color="text-emerald-400" />
        <Row label="Hilo (mm)" value={(r.estimatedThread?.mm || 0).toLocaleString('es-ES')} color="text-amber-400" />
        <Row label="Hilo (g)" value={`≈${r.estimatedThread?.grams || 0} g`} color="text-amber-300" />
        <Row label="Capa" value={r.layer_order || 1} />
      </Section>

      {r.thread && (
        <Section title="Hilo asignado">
          <Row label="Marca" value={r.thread.brand || '—'} />
          <Row label="Código" value={r.thread.code || '—'} mono />
          <Row label="Nombre" value={r.thread.name || '—'} />
          {r.thread.hex && (
            <div className="flex items-center gap-2 py-1">
              <div className="w-4 h-4 rounded border border-white/10 flex-shrink-0" style={{ background: r.thread.hex }} />
              <span className="text-[10px] text-slate-500 font-mono">{r.thread.hex}</span>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}