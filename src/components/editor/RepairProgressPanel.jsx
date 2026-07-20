import { useState, useMemo } from 'react';
import {
  Wrench, ShieldCheck, ShieldAlert, RefreshCw, ChevronDown, ChevronRight,
  Activity, CheckCircle, XCircle, TrendingUp,
} from 'lucide-react';
import { runRepairEngine } from '@/lib/repairEngine';

/**
 * RepairProgressPanel — iterative repair engine UI.
 * Runs the surgical repair loop and shows per-iteration progress.
 */
export default function RepairProgressPanel({ regions, config, machineSettings, format, onRepairComplete }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [expandedIter, setExpandedIter] = useState(null);

  const machineSettingsFinal = useMemo(() => ({
    maxStitchLength: 12.1,
    maxJumpLength: 12.1,
    hoopSize: [config.width_mm || 100, config.height_mm || 100],
    designOffset: [0, 0],
    trimThreshold: 3.5,
    ...machineSettings,
  }), [config, machineSettings]);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    // Defer to next tick so the spinner renders before the sync work
    await new Promise(r => setTimeout(r, 50));
    try {
      const res = runRepairEngine(regions, config, machineSettingsFinal, format);
      setResult(res);
      if (onRepairComplete) onRepairComplete(res);
    } finally {
      setRunning(false);
    }
  };

  const STATUS_STYLES = {
    SAFE:   { wrap: 'bg-emerald-900/20 border-emerald-500/40', text: 'text-emerald-400', icon: ShieldCheck },
    RISKY:  { wrap: 'bg-amber-900/20 border-amber-500/40',     text: 'text-amber-400',   icon: ShieldAlert },
    INVALID:{ wrap: 'bg-red-900/20 border-red-500/40',         text: 'text-red-400',     icon: ShieldAlert },
  };
  const st = result ? (STATUS_STYLES[result.status] || STATUS_STYLES.INVALID) : null;

  // Literal color maps so Tailwind keeps the classes
  const CARD_COLORS = {
    violet:  { icon: 'text-violet-400',  val: 'text-violet-400' },
    cyan:    { icon: 'text-cyan-400',    val: 'text-cyan-400' },
    emerald: { icon: 'text-emerald-400', val: 'text-emerald-400' },
    red:     { icon: 'text-red-400',     val: 'text-red-400' },
  };
  const BADGE_COLORS = {
    SAFE:   'bg-emerald-900/30 text-emerald-400 border-emerald-500/30',
    RISKY:  'bg-amber-900/30 text-amber-400 border-amber-500/30',
    INVALID:'bg-red-900/30 text-red-400 border-red-500/30',
  };

  return (
    <div className="space-y-4">
      {/* Header + run button */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-violet-900/20 border border-violet-500/30 flex items-center justify-center">
          <Wrench className="w-4 h-4 text-violet-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-white">Motor de Reparación Iterativa</h3>
          <p className="text-[11px] text-slate-500">
            Corrige solo los elementos con errores. Nunca regenera el diseño completo. Máx. 10 iteraciones.
          </p>
        </div>
        <button
          onClick={handleRun}
          disabled={running || !regions?.length}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-bold transition-colors"
        >
          {running
            ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Reparando...</>
            : <><Activity className="w-3.5 h-3.5" /> Reparar automáticamente</>}
        </button>
      </div>

      {/* Progress during run */}
      {running && (
        <div className="flex items-center gap-3 bg-violet-900/10 border border-violet-500/20 rounded-lg p-3">
          <RefreshCw className="w-4 h-4 text-violet-400 animate-spin" />
          <span className="text-xs text-violet-300">
            Analizando errores y aplicando correcciones quirúrgicas...
          </span>
        </div>
      )}

      {/* Result */}
      {result && !running && st && (
        <>
          {/* Final status banner */}
          <div className={`${st.wrap} rounded-lg p-4`}>
            <div className="flex items-center gap-2 mb-2">
              <st.icon className={`w-4 h-4 ${st.text}`} />
              <span className={`text-sm font-bold ${st.text}`}>
                Estado final: {result.status}
              </span>
              <span className="text-xs text-slate-400 ml-auto">
                {result.iterations} iteración(es)
              </span>
            </div>

            {/* Score + metrics grid */}
            <div className="grid grid-cols-4 gap-2 mb-3">
              <ScoreCard label="Puntuación" value={result.score} icon={TrendingUp} colors={CARD_COLORS.violet} />
              <ScoreCard label="Correcciones" value={result.history.reduce((s, h) => s + h.fixesApplied.length, 0)} icon={Wrench} colors={CARD_COLORS.cyan} />
              <ScoreCard label="Errores rest." value={result.remainingErrors.length} icon={XCircle} colors={result.remainingErrors.length === 0 ? CARD_COLORS.emerald : CARD_COLORS.red} />
              <ScoreCard label="Críticos" value={result.history[result.history.length - 1]?.criticalCount ?? 0} icon={ShieldAlert} colors={(result.history[result.history.length - 1]?.criticalCount ?? 1) === 0 ? CARD_COLORS.emerald : CARD_COLORS.red} />
            </div>

            {/* Report text */}
            <div className="bg-[#0d0f14] rounded p-2.5 border border-[#1e2130]">
              <pre className="text-[10px] text-slate-400 whitespace-pre-wrap font-mono leading-relaxed">
                {result.report}
              </pre>
            </div>
          </div>

          {/* Iteration history */}
          <div className="space-y-1.5">
            <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
              Historial de iteraciones
            </div>
            {result.history.map((h) => {
              const badge = BADGE_COLORS[h.status] || BADGE_COLORS.INVALID;
              return (
                <div key={h.iteration} className="bg-[#0d0f14] border border-[#1e2130] rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedIter(expandedIter === h.iteration ? null : h.iteration)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#161a23] transition-colors"
                  >
                    {expandedIter === h.iteration
                      ? <ChevronDown className="w-3 h-3 text-slate-500" />
                      : <ChevronRight className="w-3 h-3 text-slate-500" />}
                    <span className="text-[11px] font-bold text-slate-300 w-16">Iteración {h.iteration}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badge}`}>
                      {h.score}/100
                    </span>
                    <span className="text-[10px] text-slate-500 ml-auto">
                      {h.errors} errores · {h.fixesApplied.length} fixes
                    </span>
                    {h.errors === 0 && h.fixesApplied.length === 0 && (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                  </button>
                  {expandedIter === h.iteration && (
                    <div className="px-3 pb-2.5 border-t border-[#1e2130] pt-2 space-y-1">
                      {h.errorRules.length > 0 && (
                        <div className="text-[10px] text-amber-400">
                          Reglas con errores: {h.errorRules.join(', ')}
                        </div>
                      )}
                      {h.fixesApplied.length > 0 ? (
                        h.fixesApplied.map((f, i) => (
                          <div key={i} className="text-[10px] text-emerald-300 flex items-start gap-1">
                            <Wrench className="w-2.5 h-2.5 text-emerald-400 mt-0.5 shrink-0" />
                            <span>{f}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-[10px] text-slate-500">Sin correcciones — iteración de verificación.</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ScoreCard({ label, value, icon: Icon, colors }) {
  return (
    <div className="bg-[#0d0f14] rounded-lg p-2 text-center border border-[#1e2130]">
      <Icon className={`w-3.5 h-3.5 ${colors.icon} mx-auto mb-1`} />
      <div className={`text-sm font-bold ${colors.val}`}>{value}</div>
      <div className="text-[9px] text-slate-600">{label}</div>
    </div>
  );
}