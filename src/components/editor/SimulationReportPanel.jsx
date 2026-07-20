import { useMemo } from 'react';
import {
  ShieldCheck, ShieldAlert, AlertTriangle, TrendingUp, Activity,
  Zap, Scissors, Palette, Ruler, Clock, Route, CheckCircle, XCircle,
  Flame, Layers,
} from 'lucide-react';
import { analyzeSimulation } from '@/lib/simulationMetrics';
import { DEFAULT_MACHINE, buildFinalCommands, logCommandsSync } from '@/lib/exportPipeline';

/**
 * SimulationReportPanel — read-only simulation metrics and recommendations.
 * Real repair is intentionally reserved for Exportar → Reparar y validar.
 */
export default function SimulationReportPanel({ regions, config, machineSettings, finalCommands, finalObjects }) {

  const ms = { ...DEFAULT_MACHINE, ...machineSettings };

  // Full analysis — uses finalCommands from Editor (single source of truth)
  // Falls back to buildFinalCommands only if finalCommands not provided
  const analysis = useMemo(() => {
    let cmds, objs, meta;
    if (finalCommands) {
      cmds = finalCommands;
      objs = finalObjects || [];
      meta = {
        source: 'finalEmbroideryCommands',
        stitchCount: cmds.filter(c => c.type === 'stitch').length,
        jumpCount: cmds.filter(c => c.type === 'jump').length,
        trimCount: cmds.filter(c => c.type === 'trim').length,
      };
      console.log('[commands-state] simulation uses: finalEmbroideryCommands');
      console.log('[commands-state] panel metrics source: finalEmbroideryCommands', meta);
    } else {
      const built = buildFinalCommands(regions, config, ms);
      cmds = built.commands;
      objs = built.objects;
      meta = built.meta;
      logCommandsSync('simulation', meta);
    }
    return analyzeSimulation(cmds, objs, ms, regions, config);
  }, [regions, config, ms.maxStitchLength, ms.maxJumpLength, ms.trimThreshold, ms.designOffset, finalCommands, finalObjects]);

  const m = analysis.metrics;
  const rec = analysis.recommendations;

  const statusStyle = analysis.status === 'SAFE'
    ? { wrap: 'bg-emerald-900/20 border-emerald-500/40', text: 'text-emerald-400', icon: ShieldCheck }
    : analysis.status === 'RISKY'
      ? { wrap: 'bg-amber-900/20 border-amber-500/40', text: 'text-amber-400', icon: ShieldAlert }
      : { wrap: 'bg-red-900/20 border-red-500/40', text: 'text-red-400', icon: ShieldAlert };
  const StatusIcon = statusStyle.icon;

  return (
    <div className="space-y-4">
      {/* Quality score banner */}
      <div className={`${statusStyle.wrap} border rounded-lg p-4`}>
        <div className="flex items-center gap-2 mb-2">
          <StatusIcon className={`w-5 h-5 ${statusStyle.text}`} />
          <span className={`text-sm font-bold ${statusStyle.text}`}>
            {analysis.status === 'SAFE' ? 'Diseño SAFE — listo para bordar' : analysis.status === 'RISKY' ? 'Diseño RISKY — revisar advertencias' : 'Diseño INVALID — bloquear exportación'}
          </span>
          <span className="text-2xl font-bold text-white ml-auto">{analysis.qualityScore}</span>
          <span className="text-xs text-slate-500">/100</span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-red-400">{analysis.recommendations.critical.length > 0 ? `${analysis.recommendations.critical.length} crítico(s)` : '0 críticos'}</span>
          <span className="text-amber-400">{analysis.recommendations.warnings.length} advertencia(s)</span>
          <span className="text-cyan-400">{analysis.recommendations.improvements.length} mejora(s)</span>
        </div>
      </div>

      {/* Metrics grid */}
      <div>
        <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Métricas de producción</div>
        <div className="grid grid-cols-2 gap-2">
          <Metric icon={Zap} label="Total puntadas" value={m.totalStitches.toLocaleString()} color="text-violet-400" />
          <Metric icon={Activity} label="Saltos" value={m.totalJumps} color="text-slate-300" />
          <Metric icon={Scissors} label="Cortes (trim)" value={m.totalTrims} color="text-amber-400" />
          <Metric icon={Palette} label="Cambios color" value={m.colorChanges} color="text-cyan-400" />
          <Metric icon={Ruler} label="Dist. cosida" value={`${m.sewingDistance}mm`} color="text-emerald-400" />
          <Metric icon={Route} label="Dist. sin coser" value={`${m.jumpDistance}mm`} color="text-red-400" />
          <Metric icon={TrendingUp} label="Eficiencia" value={`${m.routeEfficiency}%`} color={m.routeEfficiency >= 70 ? 'text-emerald-400' : 'text-amber-400'} />
          <Metric icon={Clock} label="Tiempo est." value={`${m.estimatedTimeMin}min`} color="text-violet-400" />
        </div>
      </div>

      {/* Visual diagnostics */}
      {m.stitchesOutsideRegion !== undefined && (
        <div>
          <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Diagnóstico visual</div>
          <div className="grid grid-cols-2 gap-2">
            <Metric icon={AlertTriangle} label="Fuera de región" value={m.stitchesOutsideRegion ?? 0} color={m.stitchesOutsideRegion > 0 ? 'text-orange-400' : 'text-emerald-400'} />
            <Metric icon={Activity} label="Duplicadas" value={m.duplicateStitches ?? 0} color={m.duplicateStitches > 0 ? 'text-orange-400' : 'text-emerald-400'} />
            <Metric icon={Zap} label="Cortas <0.8mm" value={m.shortStitches ?? 0} color={m.shortStitches > 20 ? 'text-amber-400' : 'text-slate-300'} />
            <Metric icon={Ruler} label="Largas >8mm" value={m.longStitches ?? 0} color={m.longStitches > 0 ? 'text-red-400' : 'text-emerald-400'} />
            <Metric icon={Flame} label="Densidad máx." value={`${m.maxDensityPerZone ?? 0}/zona`} color={m.maxDensityPerZone > 50 ? 'text-red-400' : 'text-slate-300'} />
            <Metric icon={Layers} label="Bloques" value={analysis.blockCount} color="text-violet-400" />
          </div>
          {m.stitchesOutsideRegion > 0 && m.stitchesOutsideRegion > (m.totalStitches * 0.1) && (
            <div className="mt-2 text-[10px] text-orange-300 bg-orange-900/15 border border-orange-500/20 rounded px-2 py-1.5">
              ⚠ Planner está generando puntadas fuera del polígono — revisar generación de stitches.
            </div>
          )}
        </div>
      )}

      {/* Recommendations */}
      <div className="space-y-2">
        {rec.critical.length > 0 && (
          <RecSection title="Errores críticos" items={rec.critical} icon={XCircle} color="red" />
        )}
        {rec.warnings.length > 0 && (
          <RecSection title="Advertencias" items={rec.warnings} icon={AlertTriangle} color="amber" />
        )}
        {rec.improvements.length > 0 && (
          <RecSection title="Mejoras sugeridas" items={rec.improvements} icon={CheckCircle} color="cyan" />
        )}
      </div>

      <div className="border-t border-[#1e2130] pt-3">
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-900/10 p-3">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 text-cyan-300" />
            <span className="text-xs font-bold text-cyan-200">Reparación disponible en Exportar</span>
          </div>
          <p className="text-[10px] text-slate-400">
            Para corregir errores reales del archivo, usa Exportar → Reparar y validar. La pestaña Simular es solo una vista previa de reproducción.
          </p>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-[#0d0f14] rounded-lg p-2.5 border border-[#1e2130] flex items-center gap-2">
      <Icon className={`w-3.5 h-3.5 ${color} flex-shrink-0`} />
      <div className="min-w-0">
        <div className={`text-sm font-bold ${color}`}>{value}</div>
        <div className="text-[9px] text-slate-600 truncate">{label}</div>
      </div>
    </div>
  );
}

const REC_STYLES = {
  red:   { wrap: 'bg-red-900/10 border-red-500/20',     text: 'text-red-300',     icon: 'text-red-400'     },
  amber: { wrap: 'bg-amber-900/10 border-amber-500/20', text: 'text-amber-300',   icon: 'text-amber-400'   },
  cyan:  { wrap: 'bg-cyan-900/10 border-cyan-500/20',   text: 'text-cyan-300',    icon: 'text-cyan-400'    },
};

function RecSection({ title, items, icon: Icon, color }) {
  const st = REC_STYLES[color] || REC_STYLES.amber;
  return (
    <div className={`${st.wrap} border rounded-lg p-2.5`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={`w-3.5 h-3.5 ${st.icon}`} />
        <span className={`text-[11px] font-bold ${st.text}`}>{title}</span>
        <span className="text-[10px] text-slate-500 ml-auto">{items.length}</span>
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className={`text-[10px] ${st.text} flex items-start gap-1`}>
            <span className="text-slate-600 shrink-0">•</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}