import { useState, useCallback } from 'react';
import {
  X, ChevronRight, Wrench, ShieldAlert, ShieldCheck,
  CheckCircle, AlertTriangle, SkipForward, RotateCcw, Sparkles
} from 'lucide-react';
import { runExportPipelineRaw, applyFixForRule, validatePipeline, DEFAULT_MACHINE } from '@/lib/exportPipeline';
import ValidationPreview from './ValidationPreview';

// ── Rule metadata: user-friendly descriptions ────────────────────────────────
const RULE_INFO = {
  R1:  { label: 'Puntada excesiva',     fix: 'Dividir en sub-puntadas ≤12.1mm',      icon: 'split',     severity: 'error' },
  R2:  { label: 'Salto excesivo',       fix: 'Dividir en sub-saltos ≤12.1mm',        icon: 'split',     severity: 'error' },
  R3:  { label: 'Fuera del bastidor',   fix: 'Recortar coordenadas al límite del bastidor', icon: 'crop', severity: 'error' },
  R4:  { label: 'Objeto vacío',         fix: 'Eliminar objeto sin puntadas',          icon: 'trash',    severity: 'error' },
  R5:  { label: 'Región abierta',       fix: 'Cerrar polígono automáticamente',       icon: 'close',    severity: 'warning' },
  R6:  { label: 'Trim innecesario',     fix: 'Eliminar trim redundante/consecutivo',  icon: 'scissors', severity: 'warning' },
  R7:  { label: 'Color redundante',     fix: 'Eliminar cambio de color duplicado',    icon: 'palette',  severity: 'warning' },
  R8:  { label: 'Comando ilegal',       fix: 'Eliminar comando inválido al inicio',   icon: 'alert',    severity: 'error' },
  R9:  { label: 'Falta terminador',     fix: 'Añadir comando END al final',           icon: 'flag',     severity: 'error' },
  R10: { label: 'Bloque corrupto',      fix: 'Eliminar bloque con <2 puntos únicos',  icon: 'trash',    severity: 'error' },
  R12: { label: 'Coordenada inválida',  fix: 'Eliminar comandos con NaN/Infinito',    icon: 'alert',    severity: 'error' },
  R13: { label: 'Salto sin corte',      fix: 'Insertar trim antes de saltos largos (>3.5mm)', icon: 'scissors', severity: 'warning' },
};

function RuleIcon({ rule, className }) {
  const map = {
    split: ChevronRight, crop: ShieldAlert, trash: X, close: CheckCircle,
    scissors: Wrench, palette: Sparkles, alert: AlertTriangle, flag: ShieldCheck,
  };
  const info = RULE_INFO[rule] || {};
  const Icon = map[info.icon] || AlertTriangle;
  return <Icon className={className} />;
}

/**
 * ExportFixWizard — Interactive step-by-step error correction assistant.
 *
 * Walks through each pipeline validation error one at a time, asks the user
 * to confirm or skip each fix, then proceeds to export only when all errors
 * are resolved (or intentionally skipped).
 */
export default function ExportFixWizard({ regions, config, machineSettings, format, onComplete, onCancel }) {
  const ms = { ...DEFAULT_MACHINE, ...machineSettings };

  // ── State ──────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState('fixing'); // 'fixing' | 'summary'
  const [applying, setApplying] = useState(false);

  // Pipeline state (mutable — updated after each fix)
  const [pipelineState, setPipelineState] = useState(() => {
    const raw = runExportPipelineRaw(regions, config, ms, format);
    return {
      commands: raw.commands,
      objects: raw.objects,
      errors: raw.errors,
      initialErrorCount: raw.errors.length,
    };
  });

  const [fixedLog, setFixedLog] = useState([]);
  const [skippedLog, setSkippedLog] = useState([]);

  const currentError = pipelineState.errors[0] || null;
  const totalProcessed = fixedLog.length + skippedLog.length;
  const progress = pipelineState.initialErrorCount > 0
    ? Math.round((totalProcessed / pipelineState.initialErrorCount) * 100)
    : 100;

  // ── Apply fix for current error ────────────────────────────────────────
  const handleApplyFix = useCallback(() => {
    if (!currentError) return;
    setApplying(true);

    setTimeout(() => {
      const result = applyFixForRule(
        pipelineState.commands,
        pipelineState.objects,
        currentError.rule,
        ms,
        format
      );

      // Re-validate after fix
      const validation = validatePipeline(result.fixedCommands, result.fixedObjects, ms, format);

      setFixedLog(prev => [...prev, ...(result.applied.length > 0 ? result.applied : [{ rule: currentError.rule, message: 'Sin cambios necesarios' }])]);

      setPipelineState(prev => ({
        ...prev,
        commands: result.fixedCommands,
        objects: result.fixedObjects,
        errors: validation.errors,
      }));

      setApplying(false);

      // If no more errors, go to summary
      if (validation.errors.length === 0) {
        setPhase('summary');
      }
    }, 200);
  }, [currentError, pipelineState, ms, format]);

  // ── Skip current error ─────────────────────────────────────────────────
  const handleSkip = useCallback(() => {
    if (!currentError) return;
    setSkippedLog(prev => [...prev, currentError]);

    setPipelineState(prev => ({
      ...prev,
      errors: prev.errors.slice(1),
    }));

    // If this was the last error, go to summary
    if (pipelineState.errors.length <= 1) {
      setPhase('summary');
    }
  }, [currentError, pipelineState]);

  // ── Apply ALL remaining fixes at once ──────────────────────────────────
  const handleFixAll = useCallback(() => {
    setApplying(true);
    setTimeout(() => {
      let cmds = pipelineState.commands;
      let objs = pipelineState.objects;
      let applied = [];
      // R13 must run LAST — R8 can remove trims at position 0, and R1/R2 splitting
      // can create new jump sequences. Running R13 after all other fixes ensures
      // trims are inserted on the final command sequence and aren't undone.
      const rulesToFix = ['R5', 'R4', 'R10', 'R7', 'R6', 'R9', 'R8', 'R1', 'R2', 'R12', 'R3', 'R13'];

      for (const rule of rulesToFix) {
        const result = applyFixForRule(cmds, objs, rule, ms, format);
        cmds = result.fixedCommands;
        objs = result.fixedObjects;
        applied = [...applied, ...result.applied];
      }

      const validation = validatePipeline(cmds, objs, ms, format);
      setFixedLog(prev => [...prev, ...applied]);
      setPipelineState(prev => ({ ...prev, commands: cmds, objects: objs, errors: validation.errors }));
      setApplying(false);
      setPhase('summary');
    }, 300);
  }, [pipelineState, ms, format]);

  // ── Restart wizard ─────────────────────────────────────────────────────
  const handleRestart = useCallback(() => {
    const raw = runExportPipelineRaw(regions, config, ms, format);
    setPipelineState({
      commands: raw.commands,
      objects: raw.objects,
      errors: raw.errors,
      initialErrorCount: raw.errors.length,
    });
    setFixedLog([]);
    setSkippedLog([]);
    setPhase('fixing');
  }, [regions, config, ms, format]);

  // ── Complete — pass fixed commands to export ───────────────────────────
  const handleComplete = useCallback(() => {
    onComplete({
      commands: pipelineState.commands,
      objects: pipelineState.objects,
      remainingErrors: pipelineState.errors.length,
      skippedCount: skippedLog.length,
    });
  }, [pipelineState, onComplete, skippedLog]);

  // ── Render ─────────────────────────────────────────────────────────────
  const hasErrors = pipelineState.errors.length > 0;
  const allResolved = !hasErrors && skippedLog.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Progress bar */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-[#1e2130] bg-[#0a0c12]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-slate-400 font-medium">
            {phase === 'fixing'
              ? `Error ${totalProcessed + 1} de ${pipelineState.initialErrorCount}`
              : 'Corrección completada'}
          </span>
          <span className="text-[11px] text-violet-400 font-bold">{progress}%</span>
        </div>
        <div className="h-1.5 bg-[#1e2130] rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-600 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-[10px]">
          <span className="text-emerald-400">✓ {fixedLog.length} corregidos</span>
          <span className="text-amber-400">↷ {skippedLog.length} omitidos</span>
          <span className="text-slate-500">{pipelineState.errors.length} restantes</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5">
        {phase === 'fixing' && currentError ? (
          <FixingView
            error={currentError}
            commands={pipelineState.commands}
            allErrors={pipelineState.errors}
            machineSettings={ms}
            applying={applying}
            onApplyFix={handleApplyFix}
            onSkip={handleSkip}
            onFixAll={handleFixAll}
            onCancel={onCancel}
            hasMore={pipelineState.errors.length > 1}
          />
        ) : phase === 'summary' ? (
          <SummaryView
            fixedLog={fixedLog}
            skippedLog={skippedLog}
            remainingErrors={pipelineState.errors}
            commands={pipelineState.commands}
            machineSettings={ms}
            allResolved={allResolved}
            onComplete={handleComplete}
            onRestart={handleRestart}
            onCancel={onCancel}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <ShieldCheck className="w-10 h-10 text-emerald-400 mb-3" />
            <p className="text-sm text-slate-300 font-medium">No hay errores que corregir</p>
            <p className="text-[11px] text-slate-500 mt-1">El diseño pasó todas las validaciones</p>
            <button
              onClick={handleComplete}
              className="mt-4 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors"
            >
              Continuar a exportación
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Fixing View: shows current error + fix actions ───────────────────────────
function FixingView({ error, commands, allErrors, machineSettings, applying, onApplyFix, onSkip, onFixAll, onCancel, hasMore }) {
  const info = RULE_INFO[error.rule] || { label: error.rule, fix: 'Aplicar corrección automática', severity: 'error' };
  const isWarning = info.severity === 'warning';

  return (
    <div className="space-y-4">
      {/* Visual preview — highlights problematic stitches in red */}
      <ValidationPreview
        commands={commands}
        errors={allErrors}
        currentIndex={error?.index}
        machineSettings={machineSettings}
      />

      {/* Error card */}
      <div className={`rounded-lg border p-4 ${isWarning ? 'border-amber-500/30 bg-amber-950/15' : 'border-red-500/30 bg-red-950/15'}`}>
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isWarning ? 'bg-amber-900/40' : 'bg-red-900/40'}`}>
            <RuleIcon rule={error.rule} className={`w-4 h-4 ${isWarning ? 'text-amber-400' : 'text-red-400'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isWarning ? 'bg-amber-900/40 text-amber-400' : 'bg-red-900/40 text-red-400'}`}>
                {error.rule}
              </span>
              <span className="text-sm font-bold text-white">{info.label}</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">{error.message}</p>
          </div>
        </div>
      </div>

      {/* Proposed fix */}
      <div className="rounded-lg border border-violet-500/30 bg-violet-950/15 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Wrench className="w-4 h-4 text-violet-400" />
          <span className="text-xs font-bold text-violet-300">Corrección propuesta</span>
        </div>
        <p className="text-[11px] text-slate-300 leading-relaxed">{info.fix}</p>
        <div className="mt-2 pt-2 border-t border-violet-500/15 text-[10px] text-slate-500">
          Esta acción se aplica automáticamente y se re-valida el pipeline completo.
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <button
          onClick={onApplyFix}
          disabled={applying}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold transition-colors disabled:opacity-50"
        >
          {applying ? (
            <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Aplicando...</>
          ) : (
            <><Wrench className="w-4 h-4" /> Aplicar corrección</>
          )}
        </button>
        <div className="flex gap-2">
          <button
            onClick={onSkip}
            disabled={applying}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-[#2a2d3a] bg-[#0d0f14] text-slate-400 text-xs font-medium hover:text-white transition-colors disabled:opacity-50"
          >
            <SkipForward className="w-3.5 h-3.5" /> Saltar
          </button>
          {hasMore && (
            <button
              onClick={onFixAll}
              disabled={applying}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-cyan-500/20 bg-cyan-950/20 text-cyan-400 text-xs font-medium hover:bg-cyan-900/30 transition-colors disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" /> Corregir todo
            </button>
          )}
        </div>
        <button
          onClick={onCancel}
          disabled={applying}
          className="w-full py-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors"
        >
          Cancelar asistente
        </button>
      </div>
    </div>
  );
}

// ── Summary View: final report after all errors processed ────────────────────
function SummaryView({ fixedLog, skippedLog, remainingErrors, commands, machineSettings, allResolved, onComplete, onRestart, onCancel }) {
  return (
    <div className="space-y-4">
      {/* Visual preview — shows final state after fixes */}
      <ValidationPreview
        commands={commands}
        errors={remainingErrors}
        machineSettings={machineSettings}
      />

      {/* Status banner */}
      <div className={`rounded-lg border p-4 ${allResolved ? 'border-emerald-500/30 bg-emerald-950/20' : remainingErrors.length > 0 ? 'border-red-500/30 bg-red-950/15' : 'border-amber-500/30 bg-amber-950/15'}`}>
        <div className="flex items-center gap-3 mb-2">
          {allResolved ? (
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
          ) : (
            <ShieldAlert className="w-6 h-6 text-amber-400" />
          )}
          <div>
            <div className={`text-sm font-bold ${allResolved ? 'text-emerald-300' : 'text-amber-300'}`}>
              {allResolved ? '¡Todos los errores corregidos!' : 'Corrección completada con advertencias'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {fixedLog.length} correcciones aplicadas · {skippedLog.length} omitidos · {remainingErrors.length} sin resolver
            </div>
          </div>
        </div>
      </div>

      {/* Applied fixes log */}
      {fixedLog.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold mb-2">Correcciones aplicadas</div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {fixedLog.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] bg-emerald-950/10 border border-emerald-500/15 rounded px-2 py-1.5">
                <CheckCircle className="w-3 h-3 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span className="text-emerald-300 font-bold text-[10px] shrink-0">[{f.rule}]</span>
                <span className="text-slate-400">{f.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skipped errors */}
      {skippedLog.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold mb-2">Errores omitidos</div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {skippedLog.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] bg-amber-950/10 border border-amber-500/15 rounded px-2 py-1.5">
                <SkipForward className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                <span className="text-amber-300 font-bold text-[10px] shrink-0">[{e.rule}]</span>
                <span className="text-slate-400">{e.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Remaining errors (after fixes) */}
      {remainingErrors.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold mb-2">Aún sin resolver</div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {remainingErrors.slice(0, 10).map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] bg-red-950/10 border border-red-500/15 rounded px-2 py-1.5">
                <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
                <span className="text-red-300 font-bold text-[10px] shrink-0">[{e.rule}]</span>
                <span className="text-slate-400">{e.message}</span>
              </div>
            ))}
            {remainingErrors.length > 10 && (
              <div className="text-[10px] text-slate-600 italic px-2">+{remainingErrors.length - 10} errores más...</div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-2 pt-2">
        {allResolved ? (
          <button
            onClick={onComplete}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold transition-colors"
          >
            <ChevronRight className="w-4 h-4" /> Continuar a exportación
          </button>
        ) : (
          <>
            <div className="text-[11px] text-amber-400 bg-amber-950/20 border border-amber-500/20 rounded-lg px-3 py-2">
              ⚠ {remainingErrors.length + skippedLog.length} error(es) sin corregir bloquean la exportación.
              Puedes reiniciar el asistente o corregir manualmente en el editor.
            </div>
            <button
              onClick={onRestart}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 text-sm font-bold hover:bg-violet-600/30 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Reiniciar asistente
            </button>
            <button
              onClick={onCancel}
              className="w-full py-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              Volver al editor
            </button>
          </>
        )}
      </div>
    </div>
  );
}