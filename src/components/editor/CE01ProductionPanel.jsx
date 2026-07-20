import { ShieldCheck, ShieldAlert, ShieldX, Zap, Activity, Scissors, AlertTriangle, Flame, Layers, Lock } from 'lucide-react';

/**
 * CE01ProductionPanel — Displays production-mode export info and metrics.
 * Shows the exact command source and key metrics so the user can verify
 * that the exported file will match what they see in simulation.
 */
export default function CE01ProductionPanel({ report, effectiveSource }) {
  if (!report) return null;

  const m = report.finalMetrics;
  const ce01 = report.ce01Report;

  const statusCfg = ce01.status === 'SAFE'
    ? { icon: ShieldCheck, color: 'text-emerald-400', bg: 'bg-emerald-900/20', border: 'border-emerald-500/40', label: 'SAFE' }
    : ce01.status === 'RISKY'
      ? { icon: ShieldAlert, color: 'text-amber-400', bg: 'bg-amber-900/20', border: 'border-amber-500/40', label: 'RISKY' }
      : { icon: ShieldX, color: 'text-red-400', bg: 'bg-red-900/20', border: 'border-red-500/40', label: 'INVALID' };

  const StatusIcon = statusCfg.icon;

  const metrics = [
    { icon: AlertTriangle, label: 'Fuera de región', value: m.outsideRegion, danger: m.outsideRegion > 0 },
    { icon: Zap,            label: 'Largas >8mm',     value: m.longStitches, danger: m.longStitches > 0 },
    { icon: Activity,       label: 'Duplicadas',       value: m.duplicates,   danger: m.duplicates > 0 },
    { icon: Layers,         label: 'Cortas <0.8mm',    value: m.shortStitches, danger: false },
    { icon: Scissors,       label: 'Saltos',           value: m.jumps,        danger: false },
    { icon: Flame,          label: 'Densidad máx.',    value: `${m.maxDensity}/zona`, danger: m.maxDensity > 200 },
  ];

  return (
    <div className="bg-violet-900/10 border border-violet-500/30 rounded-lg p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Lock className="w-3.5 h-3.5 text-violet-400" />
        <span className="text-xs font-bold text-violet-300">Modo de exportación: CE01 Production</span>
        <span className="text-[10px] text-slate-500 ml-auto">
          {effectiveSource === 'repairedCommands'
            ? 'Export efectivo: repairedCommands (V5)'
            : effectiveSource === 'productionReport.commands'
              ? 'Export efectivo: productionReport.commands'
              : 'finalEmbroideryCommands'}
        </span>
      </div>

      {effectiveSource === 'repairedCommands' && (
        <div className="text-[10px] text-cyan-300 bg-cyan-900/15 border border-cyan-500/30 rounded px-2 py-1 flex items-center gap-1.5">
          <ShieldCheck className="w-3 h-3 text-cyan-400" />
          <span>repairAccepted=true — la exportación usará <span className="font-bold">repairedCommands</span> (V5).</span>
        </div>
      )}

      {/* Mode status — explicit ON/OFF flags */}
      <div className="bg-[#0d0f14] border border-[#1e2130] rounded px-2.5 py-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
        <div className="text-[10px] text-slate-400 flex items-center gap-1"><span className="text-emerald-400 font-bold">ON</span><span>CE01 Production Mode</span></div>
        <div className="text-[10px] text-slate-400 flex items-center gap-1"><span className="text-red-400 font-bold">OFF</span><span>Adaptive Engine</span></div>
        <div className="text-[10px] text-slate-400 flex items-center gap-1"><span className="text-red-400 font-bold">OFF</span><span>Stability Gate 98</span></div>
        <div className="text-[10px] text-slate-400 flex items-center gap-1"><span className="text-cyan-400 font-bold">ON</span><span>Export Gate: CE01 only</span></div>
      </div>

      {/* Command source + pipeline */}
      <div className="bg-[#0d0f14] border border-[#1e2130] rounded px-2.5 py-2 space-y-0.5">
        <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
          <span className="font-bold text-violet-400 shrink-0">[source]</span>
          <span>finalEmbroideryCommands (no recalculation)</span>
        </div>
        <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
          <span className="font-bold text-cyan-400 shrink-0">[pipeline]</span>
          <span>repair {report.repairApplied ? '✓' : '—'} → sanitizer {report.sanitizeApplied ? '✓' : '—'} → CE01 validate → encode</span>
        </div>
      </div>

      {/* CE01 status */}
      <div className={`${statusCfg.bg} ${statusCfg.border} border rounded-lg px-3 py-2 flex items-center gap-2`}>
        <StatusIcon className={`w-4 h-4 ${statusCfg.color}`} />
        <span className={`text-xs font-bold ${statusCfg.color}`}>CE01: {statusCfg.label}</span>
        <span className="text-[10px] text-slate-500">· score</span>
        <span className={`text-sm font-bold ${statusCfg.color}`}>{ce01.score}</span>
        <span className="text-[10px] text-slate-600">/100</span>
        <span className={`text-[10px] font-bold ml-auto ${report.exportAllowed ? 'text-emerald-400' : 'text-red-400'}`}>
          {report.exportAllowed ? 'Export permitido' : 'Export bloqueado'}
        </span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {metrics.map(({ icon: Icon, label, value, danger }) => (
          <div key={label} className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-2 text-center">
            <Icon className={`w-3 h-3 ${danger ? 'text-red-400' : 'text-slate-400'} mx-auto mb-0.5`} />
            <div className={`text-xs font-bold ${danger ? 'text-red-400' : 'text-slate-200'}`}>{value}</div>
            <div className="text-[8px] text-slate-600 uppercase tracking-wide">{label}</div>
          </div>
        ))}
      </div>

      {/* Trims + stitches summary */}
      <div className="flex items-center gap-3 text-[10px] text-slate-500 bg-[#0d0f14] border border-[#1e2130] rounded px-2.5 py-1.5">
        <span>Trims: <span className="text-amber-400 font-bold">{m.trims}</span></span>
        <span>Puntadas: <span className="text-violet-400 font-bold">{m.stitches?.toLocaleString()}</span></span>
        <span className="ml-auto">Sim: <span className="text-slate-300 font-bold">{m.simScore}/100</span></span>
      </div>

      <p className="text-[9px] text-slate-500 leading-relaxed">
        Los comandos exportados coinciden con las métricas de simulación. No se ejecutarán optimizadores agresivos ni regeneración de diseño.
      </p>
    </div>
  );
}