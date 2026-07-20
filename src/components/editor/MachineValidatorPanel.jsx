import { useState, useMemo } from 'react';
import {
  ShieldCheck, ShieldAlert, ShieldX, AlertTriangle, AlertCircle,
  Info, ChevronDown, ChevronRight, Activity, Gauge, Scissors, Box, Link,
  Lightbulb, Wrench,
} from 'lucide-react';
import { validateForMachine } from '@/lib/machineValidator';
import { runExportPipeline, DEFAULT_MACHINE, buildFinalCommands, logCommandsSync } from '@/lib/exportPipeline';

const STATUS_CONFIG = {
  SAFE:   { icon: ShieldCheck, color: 'emerald', label: 'SAFE',   desc: 'Ejecutable sin problemas' },
  RISKY:  { icon: ShieldAlert, color: 'amber',   label: 'RISKY',  desc: 'Puede fallar o deformarse' },
  INVALID:{ icon: ShieldX,     color: 'red',     label: 'INVALID',desc: 'Romperá o será ignorado' },
};

const CATEGORY_ICONS = {
  GEOMETRY: Box,
  DENSITY: Gauge,
  JUMPS: Scissors,
  STRUCTURE: Activity,
  TRIM: Link,
};

const SEVERITY_STYLES = {
  CRITICAL: { bg: 'bg-red-950/20', border: 'border-red-500/30', text: 'text-red-400', label: 'CRÍTICO' },
  MAJOR:    { bg: 'bg-amber-950/20', border: 'border-amber-500/30', text: 'text-amber-400', label: 'MAYOR' },
  MINOR:    { bg: 'bg-slate-950/20', border: 'border-slate-500/20', text: 'text-slate-400', label: 'MENOR' },
  INFO:     { bg: 'bg-blue-950/20', border: 'border-blue-500/20', text: 'text-blue-400', label: 'INFO' },
};

export default function MachineValidatorPanel({ regions, config, machineSettings, commands: preCommands, onSimplifyGeometry }) {
  const [expandedIssues, setExpandedIssues] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const result = useMemo(() => {
    const ms = { ...DEFAULT_MACHINE, ...machineSettings };
    let cmds, meta;
    if (preCommands) {
      cmds = preCommands;
      meta = { source: 'finalEmbroideryCommands', stitchCount: cmds.filter(c => c.type === 'stitch').length, jumpCount: cmds.filter(c => c.type === 'jump').length, trimCount: cmds.filter(c => c.type === 'trim').length };
      console.log('[commands-state] validation uses: finalEmbroideryCommands');
      console.log('[commands-state] panel metrics source: finalEmbroideryCommands', meta);
    } else {
      const built = buildFinalCommands(regions, config, ms);
      cmds = built.commands;
      meta = built.meta;
    }
    logCommandsSync('validation', meta);
    return validateForMachine(regions, cmds, config, ms);
  }, [regions, config, machineSettings, preCommands]);

  const statusCfg = STATUS_CONFIG[result.status];
  const StatusIcon = statusCfg.icon;
  const colorClasses = {
    emerald: { text: 'text-emerald-400', bg: 'bg-emerald-950/20', border: 'border-emerald-500/30', ring: 'ring-emerald-500/20', bar: 'bg-emerald-500' },
    amber:   { text: 'text-amber-400',   bg: 'bg-amber-950/20',   border: 'border-amber-500/30',   ring: 'ring-amber-500/20',   bar: 'bg-amber-500'   },
    red:     { text: 'text-red-400',     bg: 'bg-red-950/20',     border: 'border-red-500/30',     ring: 'ring-red-500/20',     bar: 'bg-red-500'     },
  };
  const c = colorClasses[statusCfg.color];

  // Split command issues into blocking (CRITICAL) and warnings (MAJOR/MINOR)
  const blockingIssues = result.commandIssues.filter(i => i.severity === 'CRITICAL');
  const warningIssues = result.commandIssues.filter(i => i.severity === 'MAJOR' || i.severity === 'MINOR');
  const geometryWarnings = result.geometryWarnings || [];
  const suggestions = result.optimizationSuggestions || [];

  const renderIssue = (issue, key) => {
    const style = SEVERITY_STYLES[issue.severity] || SEVERITY_STYLES.MINOR;
    return (
      <div key={key} className={`rounded-lg border ${style.border} ${style.bg} px-2.5 py-2`}>
        <div className="flex items-start gap-2">
          {issue.severity === 'CRITICAL' ? (
            <AlertTriangle className={`w-3 h-3 ${style.text} flex-shrink-0 mt-0.5`} />
          ) : issue.severity === 'MAJOR' ? (
            <AlertCircle className={`w-3 h-3 ${style.text} flex-shrink-0 mt-0.5`} />
          ) : (
            <Info className={`w-3 h-3 ${style.text} flex-shrink-0 mt-0.5`} />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${style.bg} ${style.text}`}>{issue.rule || issue.type}</span>
              <span className={`text-[8px] font-bold ${style.text}`}>{style.label}</span>
            </div>
            <p className="text-[10px] text-slate-400 leading-snug">{issue.message}</p>
            {issue.recommendation && <p className="text-[9px] text-slate-500 mt-1 italic">→ {issue.recommendation}</p>}
          </div>
        </div>
      </div>
    );
  };

  const renderGeomWarning = (warn, key) => (
    <div key={key} className="rounded-lg border border-blue-500/20 bg-blue-950/20 px-2.5 py-2">
      <div className="flex items-start gap-2">
        <Box className="w-3 h-3 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-blue-950/20 text-blue-400">{warn.type}</span>
          <p className="text-[10px] text-slate-400 leading-snug mt-0.5">{warn.message}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* ── Status Banner ─────────────────────────────────────────────── */}
      <div className={`rounded-xl border ${c.border} ${c.bg} p-4`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-10 h-10 rounded-lg ${c.bg} border ${c.border} flex items-center justify-center`}>
            <StatusIcon className={`w-5 h-5 ${c.text}`} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold ${c.text}`}>{statusCfg.label}</span>
              <span className="text-[10px] text-slate-500">· {statusCfg.desc}</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {result.stats.criticalCount} bloqueantes · {result.stats.majorCount + result.stats.minorCount} advertencias · {result.stats.geometryWarningCount} geom.
            </div>
          </div>
        </div>

        {/* Score gauge */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500 font-medium">SCORE DE COMANDOS</span>
            <span className={`font-bold ${c.text}`}>{result.score}/100</span>
          </div>
          <div className="h-2 bg-[#0d0f14] rounded-full overflow-hidden">
            <div className={`h-full ${c.bar} rounded-full transition-all duration-500`} style={{ width: `${result.score}%` }} />
          </div>
          <div className="flex justify-between text-[8px] text-slate-600 px-0.5">
            <span>INVALID</span>
            <span>RISKY</span>
            <span>SAFE</span>
          </div>
        </div>

        {/* Recommendation */}
        <div className={`mt-3 pt-3 border-t ${c.border} text-[11px] text-slate-300 leading-relaxed`}>
          {result.recommendation}
        </div>
      </div>

      {/* ── Stats Grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-1.5">
        {[
          { label: 'Objetos', value: result.stats.totalObjects },
          { label: 'Puntadas', value: result.stats.totalStitches?.toLocaleString() },
          { label: 'Saltos', value: result.stats.totalJumps },
          { label: 'Trims', value: result.stats.totalTrims },
          { label: 'Colores', value: result.stats.colorChanges + 1 },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-2 text-center">
            <div className="text-xs font-bold text-slate-300">{value}</div>
            <div className="text-[8px] text-slate-600 uppercase tracking-wide">{label}</div>
          </div>
        ))}
      </div>

      {/* ── BLOQUEANTE ────────────────────────────────────────────────── */}
      {blockingIssues.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <ShieldX className="w-3 h-3 text-red-400" />
            <span className="text-[9px] text-red-400 uppercase tracking-wider font-bold">Bloqueante</span>
            <span className="text-[9px] text-slate-600">({blockingIssues.length})</span>
          </div>
          {blockingIssues.slice(0, 8).map((issue, i) => renderIssue(issue, `blk-${i}`))}
        </div>
      )}

      {/* ── ADVERTENCIAS ──────────────────────────────────────────────── */}
      {warningIssues.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <AlertCircle className="w-3 h-3 text-amber-400" />
            <span className="text-[9px] text-amber-400 uppercase tracking-wider font-bold">Advertencias</span>
            <span className="text-[9px] text-slate-600">({warningIssues.length})</span>
          </div>
          {warningIssues.slice(0, 8).map((issue, i) => renderIssue(issue, `warn-${i}`))}
          {warningIssues.length > 8 && (
            <div className="text-[9px] text-slate-600 italic px-2">+{warningIssues.length - 8} más...</div>
          )}
        </div>
      )}

      {/* ── GEOMETRY WARNINGS (non-blocking) ──────────────────────────── */}
      {geometryWarnings.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <Box className="w-3 h-3 text-blue-400" />
            <span className="text-[9px] text-blue-400 uppercase tracking-wider font-bold">Geometría visual (no bloqueante)</span>
            <span className="text-[9px] text-slate-600">({geometryWarnings.length})</span>
          </div>
          {geometryWarnings.slice(0, 5).map((warn, i) => renderGeomWarning(warn, `geo-${i}`))}
          {geometryWarnings.length > 5 && (
            <div className="text-[9px] text-slate-600 italic px-2">+{geometryWarnings.length - 5} más...</div>
          )}
        </div>
      )}

      {/* ── SUGERENCIAS ───────────────────────────────────────────────── */}
      {suggestions.length > 0 && (
        <div className="space-y-1.5">
          <button
            onClick={() => setShowSuggestions(!showSuggestions)}
            className="flex items-center gap-1.5 px-1 w-full"
          >
            {showSuggestions ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
            <Lightbulb className="w-3 h-3 text-cyan-400" />
            <span className="text-[9px] text-cyan-400 uppercase tracking-wider font-bold">Sugerencias de optimización</span>
            <span className="text-[9px] text-slate-600">({suggestions.length})</span>
          </button>
          {showSuggestions && (
            <div className="space-y-1">
              {suggestions.slice(0, 6).map((sug, i) => (
                <div key={i} className="rounded-lg border border-cyan-500/20 bg-cyan-950/20 px-2.5 py-2">
                  <div className="flex items-start gap-2">
                    <Wrench className="w-3 h-3 text-cyan-400 flex-shrink-0 mt-0.5" />
                    <p className="text-[10px] text-slate-400 leading-snug">{sug.message}</p>
                  </div>
                </div>
              ))}
              {suggestions.length > 0 && (
                <button
                  className="w-full mt-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-950/20 text-cyan-300 text-[10px] font-bold hover:bg-cyan-950/40 transition-colors disabled:opacity-40"
                  onClick={onSimplifyGeometry}
                  disabled={!onSimplifyGeometry}
                >
                  <Wrench className="w-3 h-3" />
                  Simplificar geometría visual
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── No issues ─────────────────────────────────────────────────── */}
      {result.commandIssues.length === 0 && geometryWarnings.length === 0 && (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <ShieldCheck className="w-8 h-8 text-emerald-400 mb-2" />
          <p className="text-xs text-slate-300 font-medium">Sin issues detectados</p>
          <p className="text-[10px] text-slate-500 mt-0.5">El diseño pasó todas las validaciones</p>
        </div>
      )}
    </div>
  );
}