/**
 * LearnedPresetValidationPanel.jsx — StitchPath AI
 * Panel que VALIDA de verdad el preset aprendido: aplica el preset, regenera
 * finalCommands antes/después, ejecuta el Quality Gate y muestra el veredicto.
 * Permite descargar REFERENCE_LEARNING_VALIDATED_REPORT.md.
 */
import { useState, useCallback } from 'react';
import { FlaskConical, Download, AlertTriangle, CheckCircle2, XCircle, Sparkles } from 'lucide-react';
import { validateLearnedPresetEffectiveness } from '@/lib/referenceLearning/learnedPresetValidator';

export default function LearnedPresetValidationPanel({ regions, config, darkStroke, machineSettings, designName, onApplyConfig, showDownloads = false }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleRun = useCallback(() => {
    if (!regions || regions.length === 0) {
      setError('No hay regiones generadas. Digitaliza una imagen primero.');
      return;
    }
    setRunning(true);
    setError(null);
    // La validación es síncrona y pesada (rebuild + gate). Ceder al event loop.
    setTimeout(() => {
      try {
        const res = validateLearnedPresetEffectiveness({
          regions, baseConfig: config, darkStroke, machineSettings, designName,
        });
        if (res.error) { setError(res.error); setResult(null); }
        else {
          setResult(res);
          // Aplicar el config patch al Editor (activa Professional Mode + learned* + override)
          if (res.configPatch && typeof onApplyConfig === 'function') onApplyConfig(res.configPatch);
        }
      } catch (e) {
        setError(e.message || 'Error durante la validación');
      } finally {
        setRunning(false);
      }
    }, 0);
  }, [regions, config, darkStroke, machineSettings, designName, onApplyConfig]);

  const handleDownload = useCallback(() => {
    if (!result?.report) return;
    const blob = new Blob([result.report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'REFERENCE_LEARNING_VALIDATED_REPORT.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const handleDownloadTrimGuard = useCallback(() => {
    if (!result?.trimGuard?.md) return;
    const blob = new Blob([result.trimGuard.md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'REFERENCE_TRIM_GUARD_REPORT_V1.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const handleDownloadAfterTrimGuard = useCallback(() => {
    if (!result?.report) return;
    const blob = new Blob([result.report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'REFERENCE_LEARNING_VALIDATED_REPORT_AFTER_TRIM_GUARD.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const handleDownloadSplitterReport = useCallback(() => {
    if (!result?.splitterReport) return;
    const blob = new Blob([result.splitterReport], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'REFERENCE_LEARNING_VALIDATED_REPORT_AFTER_VISIBLE_SPLITTER_V1_2.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const handleDownloadUnderlayReport = useCallback(() => {
    if (!result?.underlayGenerator?.md) return;
    const blob = new Blob([result.underlayGenerator.md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'UNDERLAY_GENERATOR_REPORT_V1.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const handleDownloadUnderlayIntegrated = useCallback(() => {
    if (!result?.underlayIntegratedValidation?.md) return;
    const blob = new Blob([result.underlayIntegratedValidation.md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'REFERENCE_INTEGRATED_PIPELINE_AFTER_UNDERLAY_V1.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const handleDownloadSplitterV1_1Report = useCallback(() => {
    if (!result?.visibleSplitter?.md) return;
    const blob = new Blob([result.visibleSplitter.md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'REFERENCE_VISIBLE_STITCH_SPLITTER_REPORT_V1_2.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const handleDownloadSplitterForensics = useCallback(() => {
    if (!result?.visibleSplitterForensics?.report) return;
    const blob = new Blob([result.visibleSplitterForensics.report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'REFERENCE_VISIBLE_SPLITTER_FORENSICS_V1.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const handleDownloadSatinOuterContour = useCallback(() => {
    if (!result?.satinOuterContourConverter?.md) return;
    const blob = new Blob([result.satinOuterContourConverter.md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SATIN_OUTER_CONTOUR_CONVERTER_REPORT_V1.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const handleDownloadAfterSatinOuterContour = useCallback(() => {
    if (!result?.satinOuterContourConverter?.referenceValidationMd) return;
    const blob = new Blob([result.satinOuterContourConverter.referenceValidationMd], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'REFERENCE_LEARNING_VALIDATED_REPORT_AFTER_SATIN_OUTER_CONTOUR.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className="bg-[#161a23] border border-violet-500/30 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-bold text-white">Validar preset aprendido</h3>
          <span className="text-[10px] text-slate-500">regenera · mide · compara</span>
        </div>
        <button
          onClick={handleRun}
          disabled={running || !regions?.length}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors disabled:opacity-40"
        >
          <FlaskConical className="w-3.5 h-3.5" />
          {running ? 'Validando...' : 'Validar preset'}
        </button>
      </div>

      {showDownloads && result && (
        <div className="mb-3 rounded-lg border border-[#2a2d3a] bg-[#0d0f14] p-2.5">
          <div className="mb-2 text-[11px] font-bold text-slate-300">Descargas del último resultado</div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handleDownload} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-900/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold hover:bg-emerald-900/30 transition-colors"><Download className="w-3.5 h-3.5" /> Informe validado</button>
            {result.trimGuard && <button onClick={handleDownloadTrimGuard} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-900/20 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-900/30 transition-colors"><Download className="w-3.5 h-3.5" /> Trim Guard V1</button>}
            <button onClick={handleDownloadAfterTrimGuard} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-900/20 border border-violet-500/30 text-violet-300 text-xs font-bold hover:bg-violet-900/30 transition-colors"><Download className="w-3.5 h-3.5" /> After Trim Guard</button>
            {result.underlayGenerator?.md && <button onClick={handleDownloadUnderlayReport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900/20 border border-amber-500/30 text-amber-300 text-xs font-bold hover:bg-amber-900/30 transition-colors"><Download className="w-3.5 h-3.5" /> Underlay V1</button>}
            {result.underlayIntegratedValidation?.md && <button onClick={handleDownloadUnderlayIntegrated} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-900/20 border border-orange-500/30 text-orange-300 text-xs font-bold hover:bg-orange-900/30 transition-colors"><Download className="w-3.5 h-3.5" /> After Underlay V1</button>}
            {result.visibleSplitter && <button onClick={handleDownloadSplitterReport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fuchsia-900/20 border border-fuchsia-500/30 text-fuchsia-300 text-xs font-bold hover:bg-fuchsia-900/30 transition-colors"><Download className="w-3.5 h-3.5" /> After Splitter V1_2</button>}
            {result.visibleSplitter?.md && <button onClick={handleDownloadSplitterV1_1Report} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fuchsia-900/20 border border-fuchsia-500/30 text-fuchsia-300 text-xs font-bold hover:bg-fuchsia-900/30 transition-colors"><Download className="w-3.5 h-3.5" /> Splitter V1_2 Report</button>}
            {result.visibleSplitterForensics?.report && <button onClick={handleDownloadSplitterForensics} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900/20 border border-amber-500/30 text-amber-300 text-xs font-bold hover:bg-amber-900/30 transition-colors"><Download className="w-3.5 h-3.5" /> Splitter Forensics</button>}
            {result.satinOuterContourConverter?.md && <button onClick={handleDownloadSatinOuterContour} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-900/20 border border-sky-500/30 text-sky-300 text-xs font-bold hover:bg-sky-900/30 transition-colors"><Download className="w-3.5 h-3.5" /> Satin Converter V1</button>}
            {result.satinOuterContourConverter?.referenceValidationMd && <button onClick={handleDownloadAfterSatinOuterContour} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-900/20 border border-blue-500/30 text-blue-300 text-xs font-bold hover:bg-blue-900/30 transition-colors"><Download className="w-3.5 h-3.5" /> After Satin Outer</button>}
          </div>
        </div>
      )}

      {error && (
        <div className="text-[11px] text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2 mb-2 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {result && (
        <LearnedValidationResult result={result} />
      )}

      {!result && !error && (
        <p className="text-[11px] text-slate-500">
          Aplica el preset aprendido al diseño actual, regenera finalCommands antes/después, ejecuta el Quality Gate
          y mide <span className="text-slate-300">stitchCount, visibleDiagonalStitches, maxVisibleStitchMm, professionalScore</span> y más.
          Incluye <span className="text-cyan-300">CARTOON_OUTLINE_PROFESSIONAL_OVERRIDE</span> si el diseño es cartoon con contorno negro.
        </p>
      )}
    </div>
  );
}

function LearnedValidationResult({ result }) {
  const { selection, cartoon, before, after, verdict, notEffective, integrity, basePreset, finalPreset, trimGuard, underlayGenerator, visibleSplitter } = result;
  const vColor = verdict.verdict === 'IMPROVED' ? 'text-emerald-400' : verdict.verdict === 'WORSENED' ? 'text-red-400' : 'text-amber-400';
  const vIcon = verdict.verdict === 'IMPROVED' ? CheckCircle2 : verdict.verdict === 'WORSENED' ? XCircle : AlertTriangle;
  const VIcon = vIcon;

  return (
    <div className="space-y-3">
      {/* Perfil + override */}
      <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-2.5">
        <div className="text-[11px] text-slate-400">
          Perfil: <span className="text-cyan-300 font-bold">{selection?.selectedProfile?.label || selection?.selectedProfileId}</span>
          {' '}· {(result.selection?.confidence ? (result.selection.confidence * 100).toFixed(0) : 0)}%
        </div>
        {cartoon?.applies ? (
          <div className="mt-1 text-[10px] text-violet-300 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> CARTOON_OUTLINE_PROFESSIONAL_OVERRIDE aplicado
            <span className="text-slate-500">(contourAfterFill {String(basePreset.contourAfterFill)}→{String(finalPreset.contourAfterFill)}, satin {String(basePreset.useSatinForOuterContours)}→{String(finalPreset.useSatinForOuterContours)})</span>
          </div>
        ) : (
          <div className="mt-1 text-[10px] text-slate-600">Override cartoon: no aplica</div>
        )}
      </div>

      {/* Veredicto */}
      <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-2.5">
        <div className="flex items-center gap-2 mb-1">
          <VIcon className={`w-4 h-4 ${vColor}`} />
          <span className={`text-sm font-bold ${vColor}`}>{verdict.verdict}</span>
          <span className="text-[10px] text-slate-500">net={verdict.net}</span>
          {notEffective && <span className="ml-auto text-[10px] text-red-400 font-bold">LEARNED_PRESET_NOT_EFFECTIVE</span>}
        </div>
        {verdict.changes?.length > 0 && (
          <div className="space-y-0.5 max-h-28 overflow-y-auto">
            {verdict.changes.slice(0, 12).map((c, i) => (
              <div key={i} className="text-[10px] text-slate-400 font-mono">{c}</div>
            ))}
          </div>
        )}
      </div>

      {/* UNDERLAY_GENERATOR_V1 — resumen */}
      {underlayGenerator && (
        <div className={`rounded-lg p-2.5 border ${underlayGenerator.phaseAccepted ? 'bg-amber-900/10 border-amber-500/30' : 'bg-slate-900/20 border-slate-600/30'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-sm font-bold ${underlayGenerator.phaseAccepted ? 'text-amber-300' : 'text-slate-400'}`}>
              UNDERLAY_GENERATOR_V1 {underlayGenerator.phaseAccepted ? 'aplicado' : 'revertido'}
            </span>
            <span className="text-[10px] text-slate-500">source={underlayGenerator.commandsReturnedSource}</span>
          </div>
          <div className="grid grid-cols-4 gap-1 text-[10px]">
            <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130]">
              <span className="text-slate-500">underlay</span>
              <span className="text-slate-300 ml-1">{underlayGenerator.underlayCountBefore}→<b className="text-amber-300">{underlayGenerator.underlayCountAfter}</b></span>
            </div>
            <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130]">
              <span className="text-slate-500">candidates</span>
              <span className="text-amber-300 font-bold ml-1">{underlayGenerator.candidatesAccepted}/{underlayGenerator.candidatesFound}</span>
            </div>
            <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130]">
              <span className="text-slate-500">added</span>
              <span className="text-amber-300 font-bold ml-1">{underlayGenerator.addedUnderlayStitches}</span>
            </div>
            <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130]">
              <span className="text-slate-500">CE01</span>
              <span className={`font-bold ml-1 ${underlayGenerator.ce01StatusAfter === 'SAFE' ? 'text-emerald-400' : underlayGenerator.ce01StatusAfter === 'RISKY' ? 'text-amber-300' : 'text-red-400'}`}>{underlayGenerator.ce01StatusAfter}</span>
            </div>
          </div>
          {!underlayGenerator.phaseAccepted && underlayGenerator.revertReason && (
            <div className="text-[10px] text-amber-300 mt-1.5">Revertido: {underlayGenerator.revertReason}</div>
          )}
        </div>
      )}

      {/* Trim Guard V1 — resumen */}
      {trimGuard && (
        <div className={`rounded-lg p-2.5 border ${trimGuard.phaseAccepted ? 'bg-cyan-900/10 border-cyan-500/30' : 'bg-amber-900/10 border-amber-500/30'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-sm font-bold ${trimGuard.phaseAccepted ? 'text-cyan-400' : 'text-amber-400'}`}>
              REFERENCE_TRIM_GUARD_V1 {trimGuard.phaseAccepted ? 'aplicado' : 'revertido'}
            </span>
            <span className="text-[10px] text-slate-500">maxNewTrims={trimGuard.maxNewTrims}</span>
          </div>
          <div className="grid grid-cols-4 gap-1 text-[10px]">
            <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130]">
              <span className="text-slate-500">trimCount</span>
              <span className="text-slate-300 ml-1">{trimGuard.beforeTrimCount}→<b className="text-cyan-300">{trimGuard.afterTrimCount}</b></span>
            </div>
            <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130]">
              <span className="text-slate-500">applied</span>
              <span className="text-cyan-300 font-bold ml-1">{trimGuard.candidatesApplied}</span>
            </div>
            <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130]">
              <span className="text-slate-500">CE01</span>
              <span className={`font-bold ml-1 ${trimGuard.ce01StatusAfter === 'SAFE' ? 'text-emerald-400' : trimGuard.ce01StatusAfter === 'RISKY' ? 'text-amber-300' : 'text-red-400'}`}>{trimGuard.ce01StatusAfter}</span>
            </div>
            <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130]">
              <span className="text-slate-500">profScore</span>
              <span className="text-cyan-300 font-bold ml-1">{trimGuard.professionalScoreAfter}</span>
            </div>
          </div>
          {!trimGuard.phaseAccepted && (
            <div className="text-[10px] text-amber-300 mt-1.5">Revertido: {trimGuard.revertReason}</div>
          )}
        </div>
      )}

      {/* REFERENCE_VISIBLE_STITCH_SPLITTER_V1 — resumen */}
      {visibleSplitter && (
        <div className={`rounded-lg p-2.5 border ${visibleSplitter.phaseAccepted ? 'bg-fuchsia-900/10 border-fuchsia-500/30' : 'bg-amber-900/10 border-amber-500/30'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-sm font-bold ${visibleSplitter.phaseAccepted ? 'text-fuchsia-400' : 'text-amber-400'}`}>
              REFERENCE_VISIBLE_STITCH_SPLITTER_V1_2 {visibleSplitter.phaseAccepted ? 'aplicado' : 'revertido'}
            </span>
            <span className="text-[10px] text-slate-500">target={visibleSplitter.targetMaxMm}mm · budget={visibleSplitter.maxAddedStitches}</span>
            {visibleSplitter.phaseStatus && (
              <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded ${visibleSplitter.phaseStatus === 'ACCEPTED' ? 'bg-emerald-900/40 text-emerald-300' : visibleSplitter.phaseStatus === 'NO_EFFECTIVE_REVERTED' ? 'bg-amber-900/40 text-amber-300' : 'bg-red-900/40 text-red-300'}`}>{visibleSplitter.phaseStatus}</span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-1 text-[10px]">
            <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130]">
              <span className="text-slate-500">maxVisMm</span>
              <span className="text-slate-300 ml-1">{visibleSplitter.beforeMaxVisibleStitchMm.toFixed(2)}→<b className="text-fuchsia-300">{visibleSplitter.afterMaxVisibleStitchMm.toFixed(2)}</b></span>
            </div>
            <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130]">
              <span className="text-slate-500">returned</span>
              <span className="text-slate-300 font-bold ml-1">{visibleSplitter.returnedMaxVisibleStitchMm.toFixed(2)}</span>
            </div>
            <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130]">
              <span className="text-slate-500">addedExp/Ret</span>
              <span className="text-fuchsia-300 font-bold ml-1">{visibleSplitter.addedStitchesExperimental}/{visibleSplitter.addedStitchesReturned}</span>
            </div>
            <div className="bg-[#0d0f14] rounded px-1.5 py-1 border border-[#1e2130]">
              <span className="text-slate-500">visDiag</span>
              <span className="text-fuchsia-300 font-bold ml-1">{visibleSplitter.visibleDiagonalStitchesAfter}</span>
            </div>
          </div>
          {!visibleSplitter.phaseAccepted && (
            <div className="text-[10px] text-amber-300 mt-1.5">Revertido ({visibleSplitter.commandsReturnedSource}): {visibleSplitter.revertReason}</div>
          )}
          {!visibleSplitter.splitterEffective && visibleSplitter.phaseStatus === 'NO_EFFECTIVE_REVERTED' && (
            <div className="text-[10px] text-amber-400 mt-1 font-bold">NO_EFFECTIVE → recomendado: SATIN_OUTER_CONTOUR_CONVERTER_V1</div>
          )}
        </div>
      )}

      {/* Métricas antes/después */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-slate-500 border-b border-[#1e2130]">
              <th className="text-left py-1 px-2">Métrica</th>
              <th className="text-center py-1 px-2">Antes</th>
              <th className="text-center py-1 px-2">Después</th>
              <th className="text-center py-1 px-2">Δ</th>
            </tr>
          </thead>
          <tbody>
            <MetricRow label="stitchCount" b={before.stitchCount} a={after.stitchCount} dir="lower" />
            <MetricRow label="jumpCount" b={before.jumpCount} a={after.jumpCount} dir="lower" />
            <MetricRow label="trimCount" b={before.trimCount} a={after.trimCount} dir="lower" />
            <MetricRow label="colorCount" b={before.colorCount} a={after.colorCount} dir="lower" />
            <MetricRow label="visibleDiagonalStitches" b={before.visibleDiagonalStitches} a={after.visibleDiagonalStitches} dir="lower" />
            <MetricRow label="maxVisibleStitchMm" b={before.maxVisibleStitchMm} a={after.maxVisibleStitchMm} dir="lower" fmt={2} />
            <MetricRow label="unsupportedTravelStitches" b={before.unsupportedTravelStitches} a={after.unsupportedTravelStitches} dir="lower" />
            <MetricRow label="unsupportedLongStitches" b={before.unsupportedLongStitches} a={after.unsupportedLongStitches} dir="lower" />
            <MetricRow label="shortStitchCount" b={before.shortStitchCount} a={after.shortStitchCount} dir="lower" />
            <MetricRow label="duplicateStitches" b={before.duplicateStitches} a={after.duplicateStitches} dir="lower" />
            <MetricRow label="satinContourCount" b={before.satinContourCount} a={after.satinContourCount} dir="higher" />
            <MetricRow label="runningContourCount" b={before.runningContourCount} a={after.runningContourCount} dir="higher" />
            <MetricRow label="fillBlockCount" b={before.fillBlockCount} a={after.fillBlockCount} dir="higher" />
            <MetricRow label="underlayCount" b={before.underlayCount} a={after.underlayCount} dir="higher" />
            <MetricRow label="professionalScore" b={before.professionalScore} a={after.professionalScore} dir="higher" />
          </tbody>
        </table>
      </div>

      {/* Integridad */}
      <div className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-2.5">
        <div className="text-[10px] font-bold text-slate-300 mb-1">Integridad</div>
        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <IntegrityRow label="finalLook=export" ok={!integrity.finalLookExportMismatch} />
          <IntegrityRow label="contour both feet" ok={!integrity.contourMissingOnOneFoot} />
          <IntegrityRow label="fill after contour" ok={!integrity.fillAfterContour} />
          <IntegrityRow label="CE01 status" value={integrity.ce01Status} ok={integrity.ce01Status !== 'INVALID'} warn={integrity.ce01Status === 'RISKY'} />
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, b, a, dir, fmt }) {
  const f = (v) => typeof v === 'number' ? (fmt ? v.toFixed(fmt) : v) : '—';
  const delta = (typeof b === 'number' && typeof a === 'number') ? a - b : 0;
  const better = dir === 'lower' ? delta < 0 : delta > 0;
  const worse = dir === 'lower' ? delta > 0 : delta < 0;
  const color = better ? 'text-emerald-400' : worse ? 'text-red-400' : 'text-slate-400';
  return (
    <tr className="border-b border-[#1e2130]">
      <td className="py-1 px-2 text-slate-400">{label}</td>
      <td className="py-1 px-2 text-center text-slate-300">{f(b)}</td>
      <td className="py-1 px-2 text-center text-slate-200 font-bold">{f(a)}</td>
      <td className={`py-1 px-2 text-center font-bold ${color}`}>{delta > 0 ? '+' : ''}{fmt ? delta.toFixed(fmt) : delta}</td>
    </tr>
  );
}

function IntegrityRow({ label, value, ok, warn }) {
  const color = ok ? 'text-emerald-400' : warn ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`font-bold ${color}`}>{value != null ? value : ok ? '✓' : '✗'}</span>
    </div>
  );
}