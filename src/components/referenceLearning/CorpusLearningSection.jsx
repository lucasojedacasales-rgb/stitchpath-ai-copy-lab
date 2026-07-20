import { useState, useCallback, useMemo } from 'react';
import { Brain, Sparkles, Layers, Download, Wand2, AlertTriangle, CheckCircle2, FileText, Cpu, RotateCw, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { learnFromReferenceCorpus } from '@/lib/referenceLearning/referenceCorpusLearner';
import { applyLearnedProfileToMotor, mergeLearnedConfig } from '@/lib/referenceLearning/applyLearnedProfileToMotor';
import { saveLearningState, loadLearningState, clearLearningState } from '@/lib/referenceLearning/referenceLearningState';
import { applyLearnedProfileToProfessionalMode } from '@/lib/referenceLearning/referenceLearningApplier';
import { isReferenceLearningManualOnly } from '@/lib/emergencyStabilization';

/**
 * CorpusLearningSection — Panel principal "Aprendizaje de referencias".
 * Botón "🧠 APRENDER DEL CORPUS" que procesa TODOS los archivos subidos y
 * extrae conocimiento profesional real, con progreso visible y tablas de
 * resultados. Read-only respecto al motor/export.
 */
export default function CorpusLearningSection({ parsedFiles, embeddedProjectCommands, embeddedProjectRegions, embeddedProjectName, onApplyLearnedConfig }) {
  const [learning, setLearning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showRules, setShowRules] = useState(true);
  const [showProfiles, setShowProfiles] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [appliedProfileId, setAppliedProfileId] = useState(null);
  const [appliedResult, setAppliedResult] = useState(null);
  const [applying, setApplying] = useState(false);

  // Sincronizar nombres de archivos subidos para persistencia
  const uploadedFileNames = useMemo(() => (parsedFiles || []).map((p) => p.filename), [parsedFiles]);

  const handleLearn = useCallback(async () => {
    if (!parsedFiles || parsedFiles.length === 0) {
      setError('Sube archivos DST/DSB antes de aprender.');
      return;
    }
    setLearning(true);
    setError(null);
    setProgress({ phase: 'parsing', label: 'Analizando archivo', index: 0, total: parsedFiles.length, percent: 0 });
    try {
      const res = await learnFromReferenceCorpus(parsedFiles, (p) => setProgress(p), {
        commands: embeddedProjectCommands,
        regions: embeddedProjectRegions,
        name: embeddedProjectName,
      });
      if (res.error) {
        setError(res.error);
        setResult(null);
      } else {
        res.uploadedFileNames = uploadedFileNames;
        setResult(res);
        saveLearningState(res);
      }
    } catch (e) {
      setError(e.message || 'Error durante el aprendizaje');
    } finally {
      setLearning(false);
      setProgress(null);
    }
  }, [parsedFiles, uploadedFileNames]);

  const handleApplyProfile = useCallback((profileId) => {
    if (!result || !result.learnedProfiles) return;
    const profile = result.learnedProfiles.find((p) => p.name === profileId);
    if (!profile) return;
    const patch = applyLearnedProfileToMotor(profile, result.learnedRules || []);
    const merged = mergeLearnedConfig({}, patch);
    if (typeof onApplyLearnedConfig === 'function') {
      onApplyLearnedConfig(merged);
    }
    setAppliedProfileId(profileId);
    setSelectedProfileId(profileId);
  }, [result, onApplyLearnedConfig]);

  // ── FASE 5 — Aplicar perfil aprendido al modo profesional ──
  // Selecciona el mejor perfil para el diseño actual, construye el preset,
  // activa Professional Mode y compara antes/después.
  const handleApplyLearnedToProfessionalMode = useCallback(() => {
    if (!result || !result.learnedProfiles || result.learnedProfiles.length === 0) {
      setError('Primero aprende del corpus antes de aplicar un perfil.');
      return;
    }
    if (!embeddedProjectCommands || embeddedProjectCommands.length === 0) {
      setError('No hay un diseño activo para aplicar el perfil. Abre un proyecto en el Editor.');
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const applyRes = applyLearnedProfileToProfessionalMode({
        currentCommands: embeddedProjectCommands,
        currentRegions: embeddedProjectRegions || [],
        learnedProfiles: result.learnedProfiles,
        learnedRules: result.learnedRules || [],
        corpusSummary: result.corpusSummary,
        designName: embeddedProjectName || 'Diseño actual',
      });
      if (applyRes.error) {
        setError(applyRes.error);
        setAppliedResult(null);
      } else {
        // Aplicar el config patch al Editor (activa Professional Mode + learned* keys)
        if (typeof onApplyLearnedConfig === 'function') {
          onApplyLearnedConfig(applyRes.configPatch);
        }
        setAppliedResult(applyRes);
        setAppliedProfileId(applyRes.selection?.selectedProfileId);
        setSelectedProfileId(applyRes.selection?.selectedProfileId);
      }
    } catch (e) {
      setError(e.message || 'Error al aplicar el perfil aprendido');
    } finally {
      setApplying(false);
    }
  }, [result, embeddedProjectCommands, embeddedProjectRegions, embeddedProjectName, onApplyLearnedConfig]);

  const handleExportAppliedReport = useCallback(() => {
    if (!appliedResult?.report) return;
    const blob = new Blob([appliedResult.report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'REFERENCE_LEARNING_APPLIED_REPORT.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [appliedResult]);

  const handleExportReport = useCallback(() => {
    if (!result?.learningReportMarkdown) return;
    const blob = new Blob([result.learningReportMarkdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'REFERENCE_LEARNING_ENGINE_REPORT.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const handleClearLearning = useCallback(() => {
    if (!confirm('¿Borrar el conocimiento aprendido? Tendrás que volver a pulsar APRENDER DEL CORPUS.')) return;
    clearLearningState();
    setResult(null);
    setAppliedProfileId(null);
    setSelectedProfileId(null);
  }, []);

  const totalFiles = result?.totalFiles || 0;
  const validFiles = result?.validFiles || 0;
  const failedFiles = result?.failedFiles || [];
  const rules = result?.learnedRules || [];
  const profiles = result?.learnedProfiles || [];
  const stats = result?.globalProfessionalStats || null;
  const blockCounts = result?.blockCounts || null;

  return (
    <div className="space-y-4">
      {/* ── Sección 1: Archivos cargados + botón APRENDER ───────────────────── */}
      <div className="bg-[#161a23] border border-violet-500/30 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-bold text-white">Aprendizaje de referencias</h3>
            <span className="text-[10px] text-slate-500">{parsedFiles?.length || 0} archivos en memoria</span>
            {result?.generatedAt && (
              <span className="text-[10px] text-emerald-400">· aprendido {new Date(result.generatedAt).toLocaleString()}</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleLearn}
              disabled={learning || !parsedFiles || parsedFiles.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-violet-900/40"
            >
              <Brain className="w-4 h-4" />
              {learning ? 'Aprendiendo...' : '🧠 APRENDER DEL CORPUS'}
            </button>
            <button
              onClick={handleApplyLearnedToProfessionalMode}
              disabled={learning || applying || !result?.learnedProfiles?.length || !embeddedProjectCommands?.length}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-cyan-900/40"
            >
              <Zap className="w-4 h-4" />
              {applying ? 'Aplicando...' : 'Aplicar perfil al modo profesional'}
            </button>
            <button
              onClick={handleExportReport}
              disabled={!result?.learningReportMarkdown}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0d0f14] border border-[#2a2d3a] text-slate-300 text-xs font-bold hover:bg-[#1e2130] transition-colors disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" /> Informe
            </button>
            {appliedResult && (
              <button
                onClick={handleExportAppliedReport}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-900/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold hover:bg-emerald-900/30 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Informe aplicado
              </button>
            )}
            {result && (
              <button
                onClick={handleClearLearning}
                className="flex items-center gap-1.5 px-2 py-2 rounded-lg bg-red-900/20 border border-red-500/30 text-red-300 text-xs hover:bg-red-900/30 transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {isReferenceLearningManualOnly() && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-900/15 px-3 py-2 text-[11px] text-amber-300">
            Reference Learning está en modo manual para evitar lentitud y errores. Nada se procesa hasta pulsar APRENDER DEL CORPUS.
          </div>
        )}

        {/* Archivos cargados — stats */}
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-center mb-3">
          <Stat label="Total archivos" value={parsedFiles?.length || 0} color="text-violet-400" />
          <Stat label="Válidos" value={validFiles} color="text-emerald-400" />
          <Stat label="Fallidos" value={failedFiles.length} color="text-red-400" />
          <Stat label="DST" value={countFormat(parsedFiles, 'DST')} color="text-cyan-400" />
          <Stat label="DSB" value={countFormat(parsedFiles, 'DSB')} color="text-amber-400" />
          <Stat label="Puntadas (prom)" value={stats ? Math.round(stats.avgStitchCount) : '—'} color="text-violet-400" />
          <Stat label="Colores (prom)" value={stats ? stats.avgColorCount.toFixed(1) : '—'} color="text-cyan-400" />
        </div>
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
            <Stat label="Tamaño bloques" value={stats.blockCount} color="text-violet-400" />
            <Stat label="Densidad (prom)" value={stats.avgDensity.toFixed(3)} color="text-emerald-400" />
            <Stat label="Jumps (prom)" value={Math.round(stats.avgJumpCount)} color="text-amber-400" />
            <Stat label="Trims (prom)" value={Math.round(stats.avgTrimCount)} color="text-red-400" />
          </div>
        )}

        {error && (
          <div className="mt-3 text-[11px] text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> {error}
          </div>
        )}

        {/* ── Sección 2: Progreso de aprendizaje ───────────────────────────── */}
        {learning && progress && (
          <div className="mt-4 bg-[#0d0f14] border border-violet-500/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="w-3.5 h-3.5 text-violet-400 animate-pulse" />
              <span className="text-xs font-bold text-violet-300">{progress.label}</span>
              {progress.filename && (
                <span className="text-[10px] text-slate-500 truncate">{progress.filename}</span>
              )}
              <span className="text-[10px] text-slate-400 ml-auto">{progress.percent}%</span>
            </div>
            <div className="w-full h-2 bg-[#1e2130] rounded-full overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full transition-all duration-200" style={{ width: `${progress.percent}%` }} />
            </div>
            {progress.index && progress.total && (
              <div className="text-[10px] text-slate-500 mt-1">Archivo {progress.index}/{progress.total}</div>
            )}
          </div>
        )}

        {/* ── Resumen de aprendizaje completado ─────────────────────────────── */}
        {result && !learning && (
          <div className="mt-4 bg-emerald-900/15 border border-emerald-500/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-emerald-300">RUN_REFERENCE_LEARNING completado</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
              <Stat label="Archivos procesados" value={`${validFiles}/${totalFiles}`} color="text-emerald-400" />
              <Stat label="Bloques técnicos" value={blockCounts?.total || 0} color="text-violet-400" />
              <Stat label="Reglas aprendidas" value={rules.length} color="text-cyan-400" />
              <Stat label="Perfiles generados" value={profiles.length} color="text-amber-400" />
            </div>
            {blockCounts && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                {blockCountsByTypeList(blockCounts).map(([t, n]) => (
                  <span key={t} className="px-2 py-0.5 rounded bg-[#0d0f14] border border-[#1e2130] text-slate-400">
                    <span className="font-bold text-slate-300">{n}</span> {t}
                  </span>
                ))}
              </div>
            )}
            {failedFiles.length > 0 && (
              <div className="mt-2 text-[10px] text-red-300">
                {failedFiles.length} archivo(s) fallido(s): {failedFiles.map((f) => f.filename).join(', ')}
              </div>
            )}
          </div>
        )}

        {/* ── Sección 2.5: Aplicación del perfil aprendido (FASE 5) ────────────── */}
        {appliedResult && (
          <div className="mt-4 bg-cyan-900/10 border border-cyan-500/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold text-cyan-300">Perfil aprendido aplicado al Professional Mode</span>
            </div>
            {/* Perfil seleccionado */}
            <div className="mb-3">
              <div className="text-[11px] text-slate-400">
                Perfil: <span className="text-cyan-300 font-bold">{appliedResult.selection?.selectedProfile?.label || appliedResult.selection?.selectedProfileId}</span>
                {' '}· Confianza: <span className="text-emerald-400 font-bold">{Math.round((appliedResult.selection?.confidence || 0) * 100)}%</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">{appliedResult.selection?.reason}</div>
            </div>
            {/* Parámetros cambiados */}
            {appliedResult.preset && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center mb-3">
                <AppliedParam label="Densidad relleno" value={`${appliedResult.preset.fillRowSpacingMm}mm`} />
                <AppliedParam label="Ángulo relleno" value={`${appliedResult.preset.fillAngleDeg}°`} />
                <AppliedParam label="Satin spacing" value={`${appliedResult.preset.satinColumnSpacingMm}mm`} />
                <AppliedParam label="Pull comp" value={`${appliedResult.preset.pullCompensationMm}mm`} />
                <AppliedParam label="Max stitch" value={`${appliedResult.preset.maxVisibleStitchMm}mm`} />
                <AppliedParam label="Trim travel" value={`${appliedResult.preset.trimBeforeTravelMm}mm`} />
                <AppliedParam label="Jump travel" value={`${appliedResult.preset.convertTravelAboveMmToJump}mm`} />
                <AppliedParam label="Max colores" value={appliedResult.preset.maxColorCount} />
              </div>
            )}
            {/* Antes / Después */}
            {appliedResult.beforeComparison && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#0d0f14] border border-red-500/20 rounded-lg p-3">
                  <div className="text-[10px] font-bold text-red-400 mb-2">ANTES (diseño actual vs corpus)</div>
                  <div className="space-y-1">
                    <MetricRow label="Gap score" value={`${appliedResult.beforeComparison.professionalGapScore}/100`} color="text-red-400" />
                    <MetricRow label="Reglas incumplidas" value={appliedResult.beforeComparison.violatedRules?.length || 0} color="text-amber-400" />
                    <MetricRow label="Características faltantes" value={appliedResult.beforeComparison.missingFeatures?.length || 0} color="text-amber-400" />
                    <MetricRow label="Correcciones" value={appliedResult.beforeComparison.recommendedFixes?.length || 0} color="text-slate-400" />
                  </div>
                </div>
                <div className="bg-[#0d0f14] border border-emerald-500/20 rounded-lg p-3">
                  <div className="text-[10px] font-bold text-emerald-400 mb-2">DESPUÉS (preset aplicado)</div>
                  <div className="space-y-1">
                    <MetricRow label="Max stitch visible" value={`${appliedResult.preset.maxVisibleStitchMm}mm`} color="text-emerald-400" />
                    <MetricRow label="Contour after fill" value={appliedResult.preset.contourAfterFill ? 'sí' : 'no'} color="text-cyan-400" />
                    <MetricRow label="Underlay" value={appliedResult.preset.underlayEnabled ? 'sí' : 'no'} color="text-cyan-400" />
                    <MetricRow label="Satin contours" value={appliedResult.preset.useSatinForOuterContours ? 'sí' : 'no'} color="text-cyan-400" />
                  </div>
                </div>
              </div>
            )}
            {/* Reglas incumplidas por el diseño actual */}
            {appliedResult.beforeComparison?.violatedRules?.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] font-bold text-amber-400 mb-1.5">Tu diseño incumple estas reglas aprendidas:</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {appliedResult.beforeComparison.violatedRules.map((v, i) => (
                    <div key={i} className="text-[10px] text-slate-400 flex items-start gap-1.5 bg-[#0d0f14] rounded px-2 py-1 border border-[#1e2130]">
                      <span className={`font-bold shrink-0 ${v.severity === 'high' ? 'text-red-400' : v.severity === 'medium' ? 'text-amber-400' : 'text-slate-400'}`}>[{v.ruleId}]</span>
                      <span className="flex-1">{v.action}</span>
                      <span className="text-slate-600 shrink-0">{(v.confidence * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-3 text-[10px] text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3" />
              Professional Mode activado con preset aprendido. Ve al Editor → pestaña Profesional para ver el quality gate.
            </div>
          </div>
        )}
      </div>

      {/* ── Sección 3: Reglas aprendidas (TABLA 1) ──────────────────────────── */}
      {rules.length > 0 && (
        <div className="bg-[#161a23] border border-[#1e2130] rounded-xl p-4">
          <button onClick={() => setShowRules(!showRules)} className="flex items-center gap-2 mb-3 w-full">
            {showRules ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">Reglas aprendidas ({rules.length})</h3>
          </button>
          {showRules && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-500 border-b border-[#1e2130]">
                    <th className="text-left py-1.5 px-2">Regla</th>
                    <th className="text-left py-1.5 px-2">Categoría</th>
                    <th className="text-center py-1.5 px-2">Confianza</th>
                    <th className="text-center py-1.5 px-2">Archivos</th>
                    <th className="text-left py-1.5 px-2">Acción recomendada</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.ruleId} className="border-b border-[#1e2130] hover:bg-[#0d0f14]">
                      <td className="py-1.5 px-2">
                        <div className="text-violet-300 font-semibold">{r.name}</div>
                        <div className="text-[9px] text-slate-600 font-mono">{r.ruleId}</div>
                      </td>
                      <td className="py-1.5 px-2 text-slate-400">{categoryLabel(r.category)}</td>
                      <td className="py-1.5 px-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded font-bold ${r.confidence > 0.7 ? 'bg-emerald-900/30 text-emerald-300' : r.confidence > 0.4 ? 'bg-amber-900/30 text-amber-300' : 'bg-red-900/30 text-red-300'}`}>
                          {(r.confidence * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-center text-slate-400">{r.learnedFromFiles}</td>
                      <td className="py-1.5 px-2 text-cyan-300">{r.recommendedAction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Sección 4: Perfiles aprendidos (TABLA 2) + aplicar ──────────────── */}
      {profiles.length > 0 && (
        <div className="bg-[#161a23] border border-[#1e2130] rounded-xl p-4">
          <button onClick={() => setShowProfiles(!showProfiles)} className="flex items-center gap-2 mb-3 w-full">
            {showProfiles ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
            <Layers className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">Perfiles aprendidos ({profiles.length})</h3>
          </button>
          {showProfiles && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-500 border-b border-[#1e2130]">
                    <th className="text-left py-1.5 px-2">Perfil</th>
                    <th className="text-center py-1.5 px-2">Archivos</th>
                    <th className="text-center py-1.5 px-2">Densidad</th>
                    <th className="text-center py-1.5 px-2">Max stitch</th>
                    <th className="text-left py-1.5 px-2">Orden de capas</th>
                    <th className="text-center py-1.5 px-2">Colores</th>
                    <th className="text-center py-1.5 px-2">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.name} className="border-b border-[#1e2130] hover:bg-[#0d0f14]">
                      <td className="py-1.5 px-2">
                        <div className="text-amber-300 font-semibold">{p.label || p.name}</div>
                        <div className="text-[9px] text-slate-600 font-mono">{p.name}</div>
                      </td>
                      <td className="py-1.5 px-2 text-center text-slate-400">{(p.matchedFiles || []).length}</td>
                      <td className="py-1.5 px-2 text-center text-emerald-400">{(p.recommendedFillDensity ?? 0).toFixed(3)}</td>
                      <td className="py-1.5 px-2 text-center text-violet-400">{p.maxVisibleStitchMm}mm</td>
                      <td className="py-1.5 px-2 text-slate-400 text-[10px]">{(p.layerOrderRules || []).join(' → ') || '—'}</td>
                      <td className="py-1.5 px-2 text-center text-cyan-400">{p.maxColorCount}</td>
                      <td className="py-1.5 px-2 text-center">
                        <button
                          onClick={() => handleApplyProfile(p.name)}
                          disabled={appliedProfileId === p.name}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors ${appliedProfileId === p.name ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-500/40' : 'bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30'}`}
                        >
                          <Wand2 className="w-3 h-3" />
                          {appliedProfileId === p.name ? 'Aplicado' : 'Aplicar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {appliedProfileId && (
            <div className="mt-2 text-[10px] text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3" />
              Perfil "{appliedProfileId}" aplicado al Professional Mode. Activa Professional Mode en el Editor para que el motor use estos parámetros.
            </div>
          )}
        </div>
      )}

      {/* ── Sección 5: Métricas promedio del corpus (TABLA 3) ───────────────── */}
      {stats && (
        <div className="bg-[#161a23] border border-[#1e2130] rounded-xl p-4">
          <button onClick={() => setShowStats(!showStats)} className="flex items-center gap-2 mb-3 w-full">
            {showStats ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
            <FileText className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">Métricas promedio del corpus</h3>
          </button>
          {showStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
              <Stat label="Puntadas medias" value={Math.round(stats.avgStitchCount)} color="text-violet-400" />
              <Stat label="Colores medios" value={stats.avgColorCount.toFixed(1)} color="text-cyan-400" />
              <Stat label="Jumps medios" value={Math.round(stats.avgJumpCount)} color="text-amber-400" />
              <Stat label="Trims medios" value={Math.round(stats.avgTrimCount)} color="text-red-400" />
              <Stat label="Densidad" value={stats.avgDensity.toFixed(3)} color="text-emerald-400" />
              <Stat label="Short stitch ratio" value={stats.avgShortStitchRatio.toFixed(3)} color="text-amber-400" />
              <Stat label="Duplicate ratio" value={stats.avgDuplicateRatio.toFixed(3)} color="text-orange-400" />
              <Stat label="Long visible ratio" value={stats.avgLongVisibleStitchRatio.toFixed(3)} color="text-red-400" />
            </div>
          )}
          {stats.dacSummary && (
            <div className="mt-3 pt-3 border-t border-[#1e2130]">
              <div className="text-[10px] text-emerald-300 font-bold mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" /> Densidad · Ángulo · Compensación mineros
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                <Stat label="Densidad relleno (mm)" value={stats.dacSummary.fillDensityMm.toFixed(3)} color="text-emerald-400" />
                <Stat label="Ángulo relleno (°)" value={stats.dacSummary.fillAngleDeg.toFixed(1)} color="text-violet-400" />
                <Stat label="Espaciado satin (mm)" value={stats.dacSummary.satinColumnSpacingMm.toFixed(3)} color="text-cyan-400" />
                <Stat label="Pull compensation (mm)" value={stats.dacSummary.pullCompensationMm.toFixed(3)} color="text-amber-400" />
              </div>
            </div>
          )}
          {stats.patternFreq && Object.keys(stats.patternFreq).length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#1e2130]">
              <div className="text-[10px] text-slate-500 uppercase mb-1">Patrones profesionales (frecuencia)</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(stats.patternFreq).sort((a, b) => b[1] - a[1]).map(([p, n]) => (
                  <span key={p} className="text-[10px] px-2 py-0.5 rounded bg-[#0d0f14] border border-[#1e2130] text-slate-400">
                    <span className="font-bold text-emerald-400">{n}</span> {p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────
function Stat({ label, value, color }) {
  return (
    <div className="bg-[#0d0f14] rounded-lg p-2 border border-[#1e2130]">
      <div className={`text-sm font-bold ${color}`}>{value}</div>
      <div className="text-[9px] text-slate-600">{label}</div>
    </div>
  );
}

function AppliedParam({ label, value }) {
  return (
    <div className="bg-[#0d0f14] rounded-lg p-2 border border-cyan-500/20">
      <div className="text-sm font-bold text-cyan-300">{value}</div>
      <div className="text-[9px] text-slate-600">{label}</div>
    </div>
  );
}

function MetricRow({ label, value, color }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-slate-500">{label}</span>
      <span className={`font-bold ${color}`}>{value}</span>
    </div>
  );
}

function countFormat(parsedFiles, fmt) {
  if (!parsedFiles) return 0;
  return parsedFiles.filter((p) => (p.format || '').toUpperCase() === fmt).length;
}

function blockCountsByTypeList(blockCounts) {
  const entries = Object.entries(blockCounts.byType || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return entries;
}

function categoryLabel(cat) {
  const map = {
    layer_order: 'Orden capas', contour: 'Contorno', fill: 'Relleno',
    jumps_trims: 'Saltos/Trims', colors: 'Colores', meta: 'Meta',
  };
  return map[cat] || cat;
}