import React, { useState, useMemo } from 'react';
import { Zap, ArrowRight, Palette, Clock, Compass } from 'lucide-react';

export default function NeedlePathPanel({ regions, pathMetrics, config }) {
  const [expanded, setExpanded] = useState(false);

  if (!pathMetrics || !pathMetrics.metrics) {
    return (
      <div className="p-4 bg-[#1a1d27] border border-[#2a2d3a] rounded text-xs text-slate-500">
        Genera un plan de bordado para ver el recorrido óptimo
      </div>
    );
  }

  const { metrics, machineTime, groups, sequence } = pathMetrics;

  // Calcular eficiencia
  const efficiency = regions.length > 0
    ? Math.round((100 * (regions.length - metrics.colorChanges)) / regions.length)
    : 0;

  const colorGroups = groups.slice(0, 5); // mostrar top 5

  return (
    <div className="border border-[#1e2130] rounded-lg overflow-hidden bg-[#0a0c12]">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#1e2130]/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Recorrido de Aguja
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-600/20 text-cyan-300 border border-cyan-500/30">
            Optimizado
          </span>
        </div>
        <span className={`text-xs transition-transform ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-3 border-t border-[#1a1d27]">
          {/* Métricas principales */}
          <div className="grid grid-cols-2 gap-2">
            <MetricBox
              icon={<Zap className="w-3 h-3" />}
              label="Saltos"
              value={metrics.totalJumps}
              unit="total"
              color="text-amber-400"
            />
            <MetricBox
              icon={<ArrowRight className="w-3 h-3" />}
              label="Distancia"
              value={metrics.totalDistance}
              unit="mm"
              color="text-cyan-400"
            />
            <MetricBox
              icon={<Palette className="w-3 h-3" />}
              label="Cambios"
              value={metrics.colorChanges}
              unit="hilos"
              color="text-violet-400"
            />
            <MetricBox
              icon={<Clock className="w-3 h-3" />}
              label="Tiempo"
              value={machineTime.formatted}
              unit=""
              color="text-emerald-400"
            />
          </div>

          {/* Estadísticas de saltos */}
          <div className="space-y-1.5 p-2.5 bg-[#161a23] border border-[#2a2d3a] rounded text-[10px]">
            <div className="font-semibold text-slate-300 mb-1.5">Estadísticas de Saltos</div>
            <div className="flex justify-between">
              <span className="text-slate-400">Promedio:</span>
              <span className="text-cyan-300 font-bold">{metrics.averageJumpDistance} mm</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Máximo:</span>
              <span className="text-amber-300 font-bold">{metrics.maxJumpDistance} mm</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Mínimo:</span>
              <span className="text-emerald-300 font-bold">{metrics.minJumpDistance} mm</span>
            </div>
          </div>

          {/* Desglose de tiempo */}
          <div className="space-y-1.5 p-2.5 bg-[#161a23] border border-[#2a2d3a] rounded text-[10px]">
            <div className="font-semibold text-slate-300 mb-1.5">Desglose de Tiempo</div>
            <TimeBar
              label="Puntadas"
              seconds={machineTime.stitchSeconds}
              total={machineTime.totalSeconds}
              color="bg-violet-500"
            />
            <TimeBar
              label="Saltos (mismo color)"
              seconds={machineTime.jumpSecondsSameColor}
              total={machineTime.totalSeconds}
              color="bg-cyan-500"
            />
            <TimeBar
              label="Saltos (cambio hilo)"
              seconds={machineTime.jumpSecondsDifferent}
              total={machineTime.totalSeconds}
              color="bg-amber-600"
            />
            <TimeBar
              label="Cambios de hilo"
              seconds={machineTime.colorSeconds}
              total={machineTime.totalSeconds}
              color="bg-amber-500"
            />
          </div>

          {/* Secuencia por color */}
          {groups.length > 0 && (
            <div className="space-y-1.5 p-2.5 bg-[#161a23] border border-[#2a2d3a] rounded text-[10px]">
              <div className="font-semibold text-slate-300 mb-1.5">Agrupación por Color</div>
              <div className="space-y-1">
                {colorGroups.map((g, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded border border-slate-600"
                        style={{ backgroundColor: g.color }}
                      />
                      <span className="text-slate-400">{g.color}</span>
                    </div>
                    <span className="text-slate-300 font-semibold">{g.count} región(es)</span>
                  </div>
                ))}
                {groups.length > 5 && (
                  <div className="text-xs text-slate-500 italic">
                    +{groups.length - 5} color(es) más
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Indicador de eficiencia */}
          <EfficiencyIndicator efficiency={efficiency} />
        </div>
      )}
    </div>
  );
}

function MetricBox({ icon, label, value, unit, color }) {
  return (
    <div className="p-2 bg-[#161a23] border border-[#2a2d3a] rounded space-y-0.5">
      <div className="flex items-center gap-1">
        <span className={color}>{icon}</span>
        <span className="text-[9px] text-slate-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-sm font-bold ${color}`}>
        {value} <span className="text-[10px] opacity-75">{unit}</span>
      </div>
    </div>
  );
}

function TimeBar({ label, seconds, total, color }) {
  const percentage = total > 0 ? (seconds / total) * 100 : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300 font-semibold">{seconds}s ({Math.round(percentage)}%)</span>
      </div>
      <div className="w-full h-1.5 bg-[#0d0f14] rounded overflow-hidden border border-[#1a1d27]">
        <div className={`h-full ${color} opacity-80`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function EfficiencyIndicator({ efficiency }) {
  const getColor = (eff) => {
    if (eff >= 85) return { bg: 'bg-emerald-900/20', text: 'text-emerald-300', border: 'border-emerald-500/30' };
    if (eff >= 70) return { bg: 'bg-cyan-900/20', text: 'text-cyan-300', border: 'border-cyan-500/30' };
    if (eff >= 50) return { bg: 'bg-amber-900/20', text: 'text-amber-300', border: 'border-amber-500/30' };
    return { bg: 'bg-red-900/20', text: 'text-red-300', border: 'border-red-500/30' };
  };

  const colors = getColor(efficiency);

  return (
    <div className={`p-2 rounded border space-y-1 ${colors.bg} ${colors.border}`}>
      <div className="text-[9px] font-semibold text-slate-300 uppercase tracking-wider">
        Eficiencia de Recorrido
      </div>
      <div className="flex items-center justify-between">
        <div className="w-full bg-[#0d0f14] h-2 rounded border border-[#1a1d27] overflow-hidden">
          <div
            className={`h-full ${colors.text.replace('text-', 'bg-')} opacity-75`}
            style={{ width: `${efficiency}%` }}
          />
        </div>
        <span className={`ml-2 text-sm font-bold ${colors.text}`}>{efficiency}%</span>
      </div>
      <p className="text-[9px] text-slate-400 leading-tight">
        {efficiency >= 85
          ? '✓ Excelente — muy pocos saltos y cambios de hilo'
          : efficiency >= 70
          ? '✓ Buena — recorrido bien optimizado'
          : efficiency >= 50
          ? '⚠ Aceptable — considera ajustar orden de regiones'
          : '✗ Pobre — muchos cambios de hilo, requiere optimización'}
      </p>
    </div>
  );
}