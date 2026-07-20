import { useState } from 'react';
import {
  Brain, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle, XCircle,
  TrendingUp, TrendingDown, ChevronDown, ChevronRight, Activity,
} from 'lucide-react';

const STATUS_STYLES = {
  SAFE:    { wrap: 'bg-emerald-900/20 border-emerald-500/40', text: 'text-emerald-400', icon: ShieldCheck, label: 'SAFE — exportación permitida' },
  RISKY:   { wrap: 'bg-amber-900/20 border-amber-500/40',     text: 'text-amber-400',   icon: ShieldAlert, label: 'RISKY — revisar antes de exportar' },
  INVALID: { wrap: 'bg-red-900/20 border-red-500/40',         text: 'text-red-400',     icon: ShieldAlert, label: 'INVALID — exportación bloqueada' },
};

/**
 * AdaptiveOptimizationReport — shows the full optimization loop report.
 * Used inside ExportModal when adaptiveOptimizationEngine returns readyToExport: false.
 */
export default function AdaptiveOptimizationReport({ result, onClose }) {
  const [expandedIter, setExpandedIter] = useState(null);
  const [showModified, setShowModified] = useState(true);

  if (!result) return null;

  const st = STATUS_STYLES[result.status] || STATUS_STYLES.INVALID;
  const scoreDelta = result.finalScore - result.initialScore;
  const report = result.report;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-violet-900/20 border border-violet-500/30 flex items-center justify-center">
          <Brain className="w-4 h-4 text-violet-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-white">Motor de Optimización Adaptativa</h3>
          <p className="text-[11px] text-slate-500">
            Bucle automático de {result.iterations}/{report.maxIterations} iteraciones · objetivo ≥{report.targetScore}/100
          </p>
        </div>
      </div>

      {/* Status banner */}
      <div className={`${st.wrap} border rounded-lg p-4`}>
        <div className="flex items-center gap-2 mb-3">
          <st.icon className={`w-5 h-5 ${st.text}`} />
          <span className={`text-sm font-bold ${st.text}`}>{st.label}</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-2xl font-bold text-white">{result.finalScore}</span>
            <span className="text-xs text-slate-500">/100</span>
          </div>
        </div>

        {/* Score progression */}
        <div className="flex items-center gap-4 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Inicial:</span>
            <span className="font-bold text-slate-300">{result.initialScore}</span>
          </div>
          {scoreDelta >= 0
            ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
          <span className={`font-bold ${scoreDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {scoreDelta >= 0 ? '+' : ''}{scoreDelta}
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-slate-500">Final:</span>
            <span className="font-bold text-white">{result.finalScore}</span>
          </div>
        </div>
      </div>

      {/* Block reasons */}
      {!result.readyToExport && report.blockReasons.length > 0 && (
        <div className="bg-red-900/15 border border-red-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-xs font-bold text-red-400">Razones de bloqueo de exportación</span>
          </div>
          <div className="space-y-1">
            {report.blockReasons.map((r, i) => (
              <div key={i} className="text-[10px] text-red-300 flex items-start gap-1">
                <XCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stop conditions */}
      <div>
        <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Condiciones de parada</div>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { label: 'Sin errores críticos', passed: report.stopConditions.noCritical },
            { label: 'Stability ≥ 98', passed: report.stopConditions.stabilityOk },
            { label: 'Validación OK', passed: report.stopConditions.validationOk },
            { label: 'Sin saltos peligrosos', passed: report.stopConditions.noDangerousJumps },
            { label: 'Sin puntadas fuera de rango', passed: report.stopConditions.noOutOfRange },
            { label: 'Sin paths abiertos', passed: report.stopConditions.noOpenPaths },
          ].map((c, i) => (
            <div key={i} className="flex items-center gap-1.5 bg-[#0d0f14] border border-[#1e2130] rounded px-2 py-1.5">
              {c.passed
                ? <CheckCircle className="w-3 h-3 text-emerald-400" />
                : <XCircle className="w-3 h-3 text-red-400" />}
              <span className={`text-[10px] ${c.passed ? 'text-slate-300' : 'text-red-300'}`}>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Simulation metrics */}
      <div>
        <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Métricas de simulación final</div>
        <div className="grid grid-cols-4 gap-2">
          <MetricCard label="Puntadas" value={report.simulation.totalStitches?.toLocaleString()} color="text-violet-400" />
          <MetricCard label="Saltos" value={report.simulation.totalJumps} color="text-amber-400" />
          <MetricCard label="Trims" value={report.simulation.totalTrims} color="text-cyan-400" />
          <MetricCard label="Colores" value={report.simulation.colorChanges} color="text-emerald-400" />
          <MetricCard label="Eficiencia" value={`${report.simulation.routeEfficiency}%`} color="text-emerald-400" />
          <MetricCard label="Cosido" value={`${report.simulation.sewingDistance}mm`} color="text-violet-400" />
          <MetricCard label="Sin coser" value={`${report.simulation.jumpDistance}mm`} color="text-amber-400" />
          <MetricCard label="Errores" value={report.simulation.totalErrors} color={report.simulation.totalErrors === 0 ? 'text-emerald-400' : 'text-red-400'} />
        </div>
      </div>

      {/* Iteration log */}
      <div>
        <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Histórico de iteraciones</div>
        <div className="space-y-1">
          {report.iterationLog.map((it) => {
            const expanded = expandedIter === it.iteration;
            return (
              <div key={it.iteration} className="bg-[#0d0f14] border border-[#1e2130] rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedIter(expanded ? null : it.iteration)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#161a23] transition-colors"
                >
                  {expanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                  <span className="text-[10px] font-bold text-slate-400 w-16">Iteración {it.iteration}</span>
                  <span className={`text-sm font-bold ${it.score >= 98 ? 'text-emerald-400' : it.score >= 70 ? 'text-amber-400' : 'text-red-400'}`}>{it.score}</span>
                  <span className="text-[10px] text-slate-600">·</span>
                  <span className="text-[10px] text-slate-500">{it.totalErrors} errores</span>
                  {it.criticalErrors > 0 && <span className="text-[10px] text-red-400">· {it.criticalErrors} crítico(s)</span>}
                  {it.reverted && <span className="text-[10px] text-amber-400 ml-2">⟲ revertida</span>}
                  <span className="text-[10px] text-slate-600 ml-auto truncate max-w-[200px]">{it.result}</span>
                </button>
                {expanded && (
                  <div className="px-3 pb-2.5 border-t border-[#1e2130] pt-2 space-y-1.5">
                    <div className="grid grid-cols-3 gap-1">
                      {Object.entries(it.stopConditions).filter(([k]) => k !== '_all').map(([k, v]) => (
                        <div key={k} className="flex items-center gap-1 text-[9px]">
                          {v ? <CheckCircle className="w-2.5 h-2.5 text-emerald-400" /> : <XCircle className="w-2.5 h-2.5 text-red-400" />}
                          <span className={v ? 'text-slate-400' : 'text-red-300'}>{stopLabel(k)}</span>
                        </div>
                      ))}
                    </div>
                    {it.fixesApplied.length > 0 && (
                      <div className="mt-1">
                        <div className="text-[9px] text-slate-500 mb-0.5">Fixes aplicados:</div>
                        {it.fixesApplied.map((f, i) => (
                          <div key={i} className="text-[9px] text-emerald-300 flex items-start gap-1">
                            <span className="text-emerald-400 font-bold shrink-0">[{f.rule}]</span>
                            <span>{f.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Modified regions */}
      {result.modifiedRegions.length > 0 && (
        <div>
          <button
            onClick={() => setShowModified(!showModified)}
            className="flex items-center gap-2 mb-2"
          >
            {showModified ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
              Regiones modificadas ({result.modifiedRegions.length})
            </span>
            <span className="text-[10px] text-emerald-400 ml-auto">
              {report.safeRegionsPreserved} SAFE preservadas
            </span>
          </button>
          {showModified && (
            <div className="space-y-1.5">
              {result.modifiedRegions.map((r) => (
                <div key={r.id} className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="w-3 h-3 text-violet-400" />
                    <span className="text-[11px] font-bold text-slate-300">{r.name}</span>
                    <span className="text-[9px] text-slate-600 ml-auto">{r.fixes.length} fix(es)</span>
                  </div>
                  <div className="space-y-0.5">
                    {r.fixes.map((f, i) => (
                      <div key={i} className="text-[9px] text-slate-400 flex items-start gap-1">
                        <span className="text-violet-400 font-bold shrink-0">[{f.rule}]</span>
                        <span>{f.message}</span>
                        <span className="text-slate-600 ml-auto">iter {f.iteration}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Unresolved issues */}
      {result.unresolvedIssues.length > 0 && (
        <div>
          <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">
            Issues no resueltos ({result.unresolvedIssues.length})
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {result.unresolvedIssues.map((u, i) => (
              <div key={i} className="text-[10px] flex items-start gap-1 bg-[#0d0f14] border border-[#1e2130] rounded px-2 py-1.5">
                <span className={`font-bold shrink-0 ${u.severity === 'CRITICAL' ? 'text-red-400' : 'text-amber-400'}`}>[{u.rule}]</span>
                <span className={u.severity === 'CRITICAL' ? 'text-red-300' : 'text-amber-300'}>{u.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Guarantees */}
      <div className="border-t border-[#1e2130] pt-3">
        <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Garantías del motor</div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: 'No regeneración completa', ok: report.guarantees.noFullRegeneration },
            { label: 'Regiones SAFE intactas', ok: report.guarantees.safeRegionsUntouched },
            { label: 'Colores preservados', ok: report.guarantees.colorsPreserved },
            { label: 'Escala preservada', ok: report.guarantees.scalePreserved },
            { label: 'Caydo CE01 compatible', ok: report.guarantees.caydoCE01Compatible },
          ].map((g, i) => (
            <div key={i} className={`flex items-center gap-1 px-2 py-1 rounded border text-[9px] ${g.ok ? 'bg-emerald-900/15 border-emerald-500/30 text-emerald-300' : 'bg-red-900/15 border-red-500/30 text-red-300'}`}>
              {g.ok ? <CheckCircle className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
              {g.label}
            </div>
          ))}
        </div>
      </div>

      {onClose && (
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold transition-colors"
        >
          Cerrar informe
        </button>
      )}
    </div>
  );
}

function MetricCard({ label, value, color }) {
  return (
    <div className="bg-[#0d0f14] rounded-lg p-2 text-center border border-[#1e2130]">
      <div className={`text-sm font-bold ${color}`}>{value}</div>
      <div className="text-[9px] text-slate-600">{label}</div>
    </div>
  );
}

function stopLabel(key) {
  const labels = {
    noCritical: 'Sin críticos',
    noDangerousJumps: 'Sin saltos peligro',
    noOutOfRange: 'En rango',
    noOpenPaths: 'Paths cerrados',
    validationOk: 'Validación OK',
    stabilityOk: 'Stability ≥98',
  };
  return labels[key] || key;
}