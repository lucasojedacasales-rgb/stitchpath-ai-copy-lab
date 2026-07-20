/**
 * SubpixelMetricsPanel
 *
 * Panel que muestra métricas sub-pixel de regiones "fill":
 * - Histograma de distribución de grosor
 * - Resumen del esqueleto medial
 * - Detección de ramificaciones
 */

import { useState, useEffect, useRef } from 'react';
import { Loader2, Activity, GitBranch, Ruler, AlertTriangle } from 'lucide-react';
import { computeSubpixelMetrics } from '@/lib/subpixelMetrics.js';

// ─── Histograma ───────────────────────────────────────────────────────────────

function ThicknessHistogram({ thickness }) {
  if (!thickness?.histogram?.length) return (
    <p className="text-xs text-slate-600 text-center py-4">Sin datos de grosor</p>
  );

  const { histogram, labels, mean, std, p10, p50, p90 } = thickness;
  const maxVal = Math.max(...histogram, 1);
  const barCount = histogram.length;
  // Mostrar solo bins con valores (filtramos la cola vacía)
  const lastNonZero = histogram.reduce((acc, v, i) => v > 0 ? i : acc, 0);
  const visibleBins = Math.min(barCount, lastNonZero + 2);

  return (
    <div className="space-y-2">
      {/* Gráfico de barras */}
      <div className="flex items-end gap-px h-20 bg-[#0d0f14] rounded-lg px-2 pt-2 pb-1">
        {histogram.slice(0, visibleBins).map((count, i) => {
          const height = (count / maxVal) * 100;
          const isMean = Math.abs(labels[i] - mean) < (labels[1] - labels[0]);
          return (
            <div
              key={i}
              className="flex-1 relative group"
              style={{ height: '100%', display: 'flex', alignItems: 'flex-end' }}
            >
              <div
                className={`w-full rounded-t-sm transition-colors ${isMean ? 'bg-violet-400' : 'bg-violet-700/60 group-hover:bg-violet-500/80'}`}
                style={{ height: `${Math.max(height, count > 0 ? 2 : 0)}%` }}
              />
              {/* Tooltip hover */}
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex bg-[#1a1d27] border border-[#2a2d3a] rounded px-2 py-1 text-[10px] text-white whitespace-nowrap z-10 pointer-events-none flex-col items-center">
                <span>{labels[i].toFixed(2)} mm</span>
                <span className="text-slate-400">{count} px</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Eje X simplificado */}
      <div className="flex justify-between text-[9px] text-slate-600 px-2">
        <span>{labels[0].toFixed(1)} mm</span>
        <span className="text-violet-400">{mean.toFixed(2)} mm (media)</span>
        <span>{labels[Math.min(visibleBins - 1, labels.length - 1)]?.toFixed(1)} mm</span>
      </div>

      {/* Percentiles */}
      <div className="grid grid-cols-3 gap-1 pt-1">
        {[
          { label: 'P10', value: p10, color: 'text-cyan-400' },
          { label: 'P50', value: p50, color: 'text-violet-400' },
          { label: 'P90', value: p90, color: 'text-amber-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-[#0d0f14] rounded px-2 py-1.5 text-center">
            <div className={`text-xs font-bold ${color}`}>{value?.toFixed(2)} mm</div>
            <div className="text-[10px] text-slate-600">{label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
        <span>σ = <span className="text-slate-300">{std?.toFixed(3)} mm</span></span>
        <span>n = <span className="text-slate-300">{thickness.sampleCount}</span> muestras</span>
        <span>rango <span className="text-slate-300">{thickness.min?.toFixed(2)}–{thickness.max?.toFixed(2)} mm</span></span>
      </div>
    </div>
  );
}

// ─── Miniatura de esqueleto + ramas ──────────────────────────────────────────

function TopologyBadge({ label, value, icon: Icon, color }) {
  return (
    <div className="flex items-center gap-2 bg-[#0d0f14] rounded-lg px-3 py-2">
      <Icon className={`w-3.5 h-3.5 ${color} flex-shrink-0`} />
      <div>
        <div className={`text-sm font-bold ${color}`}>{value}</div>
        <div className="text-[10px] text-slate-500">{label}</div>
      </div>
    </div>
  );
}

// ─── Visualización de puntos de rama sobre SVG ────────────────────────────────

function BranchMap({ topology, resolution }) {
  if (!topology || !resolution) return null;
  const { branchCoords, endpointCoords, branchPoints, endpoints } = topology;
  if (branchPoints === 0 && endpoints === 0) return (
    <p className="text-xs text-slate-600 text-center py-2">Sin ramificaciones detectadas</p>
  );

  const VW = 200, VH = 120;
  const scaleX = VW / (resolution?.W / resolution?.pxPerMm || 100);
  const scaleY = VH / (resolution?.H / resolution?.pxPerMm || 100);

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full rounded bg-[#0d0f14] border border-[#1e2130]" style={{ height: 80 }}>
      {/* Branch points: triángulos rojos */}
      {branchCoords.slice(0, 200).map(([x, y], i) => (
        <circle key={`b${i}`} cx={x * scaleX} cy={y * scaleY} r={2} fill="#f87171" opacity={0.8} />
      ))}
      {/* Endpoints: cuadrados cyan */}
      {endpointCoords.slice(0, 200).map(([x, y], i) => (
        <rect key={`e${i}`} x={x * scaleX - 1.5} y={y * scaleY - 1.5} width={3} height={3} fill="#22d3ee" opacity={0.8} />
      ))}
    </svg>
  );
}

// ─── Complejidad badge ────────────────────────────────────────────────────────

const COMPLEXITY_STYLE = {
  simple:         { text: 'Simple',         cls: 'bg-emerald-900/20 text-emerald-400 border-emerald-500/30' },
  moderate:       { text: 'Moderada',       cls: 'bg-amber-900/20   text-amber-400   border-amber-500/30'   },
  complex:        { text: 'Compleja',       cls: 'bg-orange-900/20  text-orange-400  border-orange-500/30'  },
  highly_complex: { text: 'Muy compleja',   cls: 'bg-red-900/20     text-red-400     border-red-500/30'     },
};

// ─── Panel principal ──────────────────────────────────────────────────────────

export default function SubpixelMetricsPanel({ region, widthMm = 100, heightMm = 100 }) {
  const [metrics, setMetrics]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const abortRef = useRef(false);

  useEffect(() => {
    if (!region || region.stitch_type !== 'fill' || !region.path_points?.length) {
      setMetrics(null);
      return;
    }

    abortRef.current = false;
    setLoading(true);
    setError(null);
    setMetrics(null);

    // Ejecutar en macro-task para no bloquear el render
    setTimeout(async () => {
      try {
        const result = await computeSubpixelMetrics(
          region.path_points,
          widthMm,
          heightMm,
          { resolution: 320, histogramBins: 40 }
        );
        if (!abortRef.current) setMetrics(result);
      } catch (e) {
        if (!abortRef.current) setError(e.message);
      } finally {
        if (!abortRef.current) setLoading(false);
      }
    }, 50);

    return () => { abortRef.current = true; };
  }, [region?.id, widthMm, heightMm]);

  if (!region) return (
    <div className="p-4 text-xs text-slate-600 text-center">Selecciona una región "fill"</div>
  );

  if (region.stitch_type !== 'fill') return (
    <div className="p-4 text-xs text-slate-500 text-center">
      Las métricas sub-pixel están disponibles para regiones de tipo <span className="text-violet-400">fill</span>.
    </div>
  );

  if (loading) return (
    <div className="flex flex-col items-center gap-3 py-8">
      <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
      <div className="text-center">
        <p className="text-xs text-white">Calculando métricas sub-pixel...</p>
        <p className="text-[11px] text-slate-500 mt-1">Skeletonización + EDT + histograma</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center gap-2 py-6">
      <AlertTriangle className="w-5 h-5 text-red-400" />
      <p className="text-xs text-red-400 text-center">{error}</p>
    </div>
  );

  if (!metrics) return null;

  const { topology, thickness, skeletonLengthMm, areaMm2, complexity, resolution } = metrics;
  const complexStyle = COMPLEXITY_STYLE[complexity] || COMPLEXITY_STYLE.simple;

  return (
    <div className="space-y-4 p-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Métricas sub-pixel</h4>
        <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${complexStyle.cls}`}>
          {complexStyle.text}
        </span>
      </div>

      {/* Stats generales */}
      <div className="grid grid-cols-2 gap-1.5">
        <TopologyBadge label="Puntos de rama"   value={topology.branchPoints}        icon={GitBranch} color="text-red-400" />
        <TopologyBadge label="Extremos"          value={topology.endpoints}           icon={Activity}  color="text-cyan-400" />
        <TopologyBadge label="Long. esqueleto"   value={`${skeletonLengthMm} mm`}    icon={Ruler}     color="text-amber-400" />
        <TopologyBadge label="Área real"         value={`${areaMm2} mm²`}            icon={Ruler}     color="text-emerald-400" />
      </div>

      {/* Densidad de ramas */}
      {topology.branchDensity > 0 && (
        <div className="bg-[#0d0f14] rounded-lg px-3 py-2 flex items-center justify-between">
          <span className="text-xs text-slate-500">Densidad de ramas</span>
          <span className="text-xs font-bold text-red-400">{topology.branchDensity.toFixed(3)} <span className="text-slate-600 font-normal">ramas/mm</span></span>
        </div>
      )}

      {/* Mapa de ramificaciones */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Mapa de ramificaciones</p>
        <BranchMap topology={topology} resolution={resolution} />
        <div className="flex gap-3 mt-1.5 text-[10px] text-slate-500">
          <span><span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1" />Branch points</span>
          <span><span className="inline-block w-2 h-2 bg-cyan-400 mr-1" />Extremos</span>
        </div>
      </div>

      {/* Histograma de grosor */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Distribución de grosor</p>
        <ThicknessHistogram thickness={thickness} />
      </div>

      {/* Resolución de análisis */}
      <div className="text-[10px] text-slate-700 border-t border-[#1e2130] pt-2">
        Análisis: {resolution.W}×{resolution.H}px · {resolution.pxPerMm.toFixed(1)} px/mm
      </div>
    </div>
  );
}