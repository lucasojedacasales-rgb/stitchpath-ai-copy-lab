import { useState, useCallback, useMemo } from 'react';
import { Brain, Layers, GitCompare, Sparkles, Download, Wand2, AlertTriangle, CheckCircle2, Cpu } from 'lucide-react';
import { buildReferenceCorpus, summarizeCorpus } from '@/lib/referenceLearning/referenceCorpus';
import { mineProfessionalRules } from '@/lib/referenceLearning/professionalRuleMiner';
import { generateLearnedProfiles } from '@/lib/referenceLearning/learnedProfessionalProfiles';
import { buildDesignProfileFromDesign, retrieveSimilarReferences } from '@/lib/referenceLearning/referenceRetriever';
import { compareAgainstCorpus } from '@/lib/referenceLearning/wilcomStyleComparator';
import { classifyTechnicalBlocks } from '@/lib/referenceLearning/blockClassifier';
import { applyLearnedProfileToMotor } from '@/lib/referenceLearning/applyLearnedProfileToMotor';
import { mineDensityAngleCompensationRules } from '@/lib/referenceLearning/densityAngleCompensationMiner';
import { generateReferenceLearningEngineReport } from '@/lib/referenceLearning/referenceLearningEngineReport';
import { analyzeReferenceMetrics } from '@/lib/referenceLearning/referenceMetricsAnalyzer';

/**
 * ReferenceEngineV2Section — UI for the Reference Learning Engine v2.
 * Builds the corpus from in-memory parsed files, mines rules, generates
 * profiles, compares the current design, applies a learned preset and
 * exports the engine report. Read-only with respect to the motor/export.
 */
export default function ReferenceEngineV2Section({ parsedFiles, embeddedProjectCommands, embeddedProjectRegions, embeddedProjectName, onApplyLearnedConfig }) {
  const [corpus, setCorpus] = useState(null);
  const [building, setBuilding] = useState(false);
  const [v2Comparison, setV2Comparison] = useState(null);
  const [appliedPatch, setAppliedPatch] = useState(null);
  const [retrieval, setRetrieval] = useState(null);

  // Build corpus from parsed files (kept in memory by parent).
  const handleBuildCorpus = useCallback(() => {
    setBuilding(true);
    try {
      const c = buildReferenceCorpus(parsedFiles);
      setCorpus(c);
      setV2Comparison(null);
      setAppliedPatch(null);
      setRetrieval(null);
    } finally {
      setBuilding(false);
    }
  }, [parsedFiles]);

  const rules = useMemo(() => (corpus ? mineProfessionalRules(corpus) : []), [corpus]);
  const profiles = useMemo(() => (corpus ? generateLearnedProfiles(corpus, rules) : []), [corpus, rules]);
  const summary = useMemo(() => (corpus ? summarizeCorpus(corpus) : null), [corpus]);
  const dacSummary = useMemo(() => (corpus ? mineDensityAngleCompensationRules(corpus).summary : null), [corpus]);

  // Compare current design against corpus (v2 — with problems + justifying rules)
  const handleCompareV2 = useCallback(() => {
    if (!corpus || corpus.length === 0) return;
    let ourCommands = embeddedProjectCommands;
    let ourRegions = embeddedProjectRegions;
    if (!ourCommands || ourCommands.length === 0) {
      setV2Comparison({ error: 'No hay un diseño propio para comparar (abre un proyecto en el Editor).' });
      return;
    }
    const ourMetrics = analyzeReferenceMetrics(ourCommands, computeMetadataFromCommands(ourCommands));
    // Enrich metrics with block-level evidence from the design's own commands so
    // the comparison can flag real layer-order / block-presence problems.
    const ourBlocks = classifyTechnicalBlocks(ourCommands);
    const ourRoles = ourBlocks.map(b => b.probableRole);
    const lastFill = ourRoles.lastIndexOf('fill');
    const firstContour = ourRoles.findIndex(r => r === 'outline_outer' || r === 'outline_inner');
    ourMetrics.contourAfterFill = lastFill >= 0 && firstContour >= 0 && firstContour > lastFill;
    ourMetrics.fillAfterContour = lastFill >= 0 && firstContour >= 0 && lastFill > firstContour;
    ourMetrics.satinBlocks = ourBlocks.filter(b => b.blockType === 'satin_border').length;
    ourMetrics.runningBlocks = ourBlocks.filter(b => b.blockType === 'running_outline' || b.blockType === 'double_run_detail').length;
    ourMetrics.underlayBlocks = ourBlocks.filter(b => b.blockType === 'underlay').length;
    ourMetrics.contourCandidates = ourBlocks.filter(b => b.probableRole === 'outline_outer' || b.probableRole === 'outline_inner').length;
    const designProfile = buildDesignProfileFromDesign(ourRegions, ourMetrics);
    const ret = retrieveSimilarReferences(designProfile, corpus, profiles, rules);
    setRetrieval(ret);
    const cmp = compareAgainstCorpus(ourMetrics, corpus, ret.recommendedProfile, rules);
    setV2Comparison(cmp);
  }, [corpus, embeddedProjectCommands, embeddedProjectRegions, profiles, rules]);

  // Apply learned profile → motor patch (only meaningful in Professional Mode)
  const handleApplyPreset = useCallback(() => {
    if (!retrieval || !retrieval.recommendedProfile) return;
    const patch = applyLearnedProfileToMotor(retrieval.recommendedProfile, retrieval.applicableRules);
    setAppliedPatch(patch);
    // Persist learned flags onto the project config (Editor) so Professional Mode
    // consumes them. Only the learned* keys are written — export/CE01 untouched.
    if (typeof onApplyLearnedConfig === 'function') {
      onApplyLearnedConfig({
        learnedFillDensity: patch.fillDensity,
        learnedSatinDensity: patch.satinDensity,
        learnedRunningStep: patch.runningStep,
        learnedUnderlayEnabled: patch.underlayEnabled,
        learnedContourAfterFill: patch.contourAfterFill,
        learnedMaxVisibleStitchMm: patch.maxVisibleStitchMm,
        learnedTrimLongTravels: patch.trimLongTravels,
        learnedReduceSimilarColors: patch.reduceSimilarColors,
        learnedUseSatinForOuterContours: patch.useSatinForOuterContours,
        learnedUseDoubleRunForDetails: patch.useDoubleRunForDetails,
        learnedMaxColorCount: patch.maxColorCount,
        learnedLayerOrderRules: patch.layerOrderRules,
        learnedSatinWidthMm: patch.satinWidthMm,
        learnedFillStitchLengthMm: patch.fillStitchLengthMm,
        learnedFillDensityMm: patch.fillDensityMm,
        learnedFillAngleDeg: patch.fillAngleDeg,
        learnedSatinColumnSpacingMm: patch.satinColumnSpacingMm,
        learnedPullCompensationMm: patch.pullCompensationMm,
      });
    }
  }, [retrieval, onApplyLearnedConfig]);

  const handleExportEngineReport = useCallback(() => {
    const md = generateReferenceLearningEngineReport({
      corpus: corpus || [],
      rules,
      profiles,
      comparison: v2Comparison && !v2Comparison.error ? v2Comparison : null,
      appliedProfile: retrieval?.recommendedProfile || null,
      appliedPatch,
      designName: embeddedProjectName || 'diseño actual',
    });
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'REFERENCE_LEARNING_ENGINE_REPORT.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [corpus, rules, profiles, v2Comparison, retrieval, appliedPatch, embeddedProjectName]);

  if (!parsedFiles || parsedFiles.length === 0) {
    return (
      <div className="bg-[#161a23] border border-violet-500/30 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <Brain className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-bold text-white">Reference Learning Engine v2</h3>
        </div>
        <p className="text-[11px] text-slate-500">
          Sube archivos DST/DSB profesionales arriba; el motor construirá el corpus, extraerá reglas
          estadísticas, generará perfiles y comparará tu diseño contra el corpus profesional.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Engine header */}
      <div className="bg-[#161a23] border border-violet-500/30 rounded-xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-bold text-white">Reference Learning Engine v2</h3>
            <span className="text-[10px] text-slate-500">{parsedFiles.length} archivos en memoria</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={handleBuildCorpus} disabled={building}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors disabled:opacity-50">
              <Cpu className="w-3.5 h-3.5" /> {building ? 'Construyendo...' : 'Construir corpus'}
            </button>
            <button onClick={handleCompareV2} disabled={!corpus}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/20 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-600/30 transition-colors disabled:opacity-50">
              <GitCompare className="w-3.5 h-3.5" /> Comparar mi diseño
            </button>
            <button onClick={handleApplyPreset} disabled={!retrieval?.recommendedProfile}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold hover:bg-emerald-600/30 transition-colors disabled:opacity-50">
              <Wand2 className="w-3.5 h-3.5" /> Aplicar preset
            </button>
            <button onClick={handleExportEngineReport} disabled={!corpus}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0d0f14] border border-[#2a2d3a] text-slate-300 text-xs font-bold hover:bg-[#1e2130] transition-colors disabled:opacity-50">
              <Download className="w-3.5 h-3.5" /> Informe v2
            </button>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          El motor aprende patrones, reglas y rangos profesionales del corpus — no copia puntadas ni diseños.
          Aplica el preset solo en Professional Mode.
        </p>
      </div>

      {/* Corpus summary */}
      {summary && (
        <div className="bg-[#161a23] border border-[#1e2130] rounded-xl p-4">
          <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><Layers className="w-3.5 h-3.5 text-violet-400" /> Corpus profesional</h4>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
            <Stat label="Archivos" value={summary.count} color="text-violet-400" />
            <Stat label="Puntadas (prom)" value={Math.round(summary.avg.stitchCount)} color="text-cyan-400" />
            <Stat label="Colores (prom)" value={summary.avg.colorCount.toFixed(1)} color="text-cyan-400" />
            <Stat label="Densidad (prom)" value={summary.avg.estimatedDensity.toFixed(3)} color="text-emerald-400" />
            <Stat label="Trim dens." value={summary.avg.trimDensity.toFixed(2)} color="text-amber-400" />
          </div>

          {/* Density / angle / pull-compensation mined values */}
          {dacSummary && (
            <div className="mt-3 pt-3 border-t border-[#1e2130]">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles className="w-3 h-3 text-emerald-400" />
                <span className="text-[11px] font-bold text-emerald-300">Densidad · Ángulo · Compensación (mineros)</span>
                <span className="text-[9px] text-slate-600 ml-auto">
                  {dacSummary.samples.fillBlocks} fill / {dacSummary.samples.satinBlocks} satin bloques
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                <Stat label="Densidad relleno (mm)" value={dacSummary.fillDensityMm.toFixed(3)} color="text-emerald-400" />
                <Stat label="Ángulo relleno (°)" value={dacSummary.fillAngleDeg.toFixed(1)} color="text-violet-400" />
                <Stat label="Espaciado satin (mm)" value={dacSummary.satinColumnSpacingMm.toFixed(3)} color="text-cyan-400" />
                <Stat label="Pull compensation (mm)" value={dacSummary.pullCompensationMm.toFixed(3)} color="text-amber-400" />
              </div>
              {dacSummary.byArchetype && Object.keys(dacSummary.byArchetype).length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-[9px] text-slate-600 uppercase tracking-wider">Por arquetipo</div>
                  {Object.entries(dacSummary.byArchetype).map(([k, v]) => (
                    <div key={k} className="text-[10px] text-slate-400 flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-300">{k}</span>
                      <span className="text-emerald-400">dens {v.fillDensityMm.toFixed(2)}</span>
                      <span className="text-violet-400">ang {v.fillAngleDeg.toFixed(0)}°</span>
                      <span className="text-cyan-400">sat {v.satinColumnSpacingMm.toFixed(2)}</span>
                      <span className="text-amber-400">pull {v.pullCompensationMm.toFixed(2)}</span>
                      <span className="text-slate-600">({v.files})</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[9px] text-slate-600 mt-2 italic">
                El motor aplica estos valores automáticamente al generar rellenos/satin en Professional Mode.
              </p>
            </div>
          )}
          {Object.keys(summary.patternFreq || {}).length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] text-slate-500 mb-1">Patrones profesionales (frecuencia):</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(summary.patternFreq).sort((a, b) => b[1] - a[1]).map(([p, n]) => (
                  <span key={p} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#0d0f14] border border-[#1e2130] text-slate-400">
                    {p}: {Math.round((n / summary.count) * 100)}%
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Learned rules */}
      {rules.length > 0 && (
        <div className="bg-[#161a23] border border-[#1e2130] rounded-xl p-4">
          <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><Sparkles className="w-3.5 h-3.5 text-cyan-400" /> Reglas aprendidas ({rules.length})</h4>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {rules.map(r => (
              <div key={r.ruleId} className="bg-[#0d0f14] border border-[#1e2130] rounded-lg px-2.5 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-violet-300">{r.name}</span>
                  <span className={`text-[9px] font-bold px-1 rounded ${r.confidence > 0.7 ? 'bg-emerald-900/30 text-emerald-300' : r.confidence > 0.4 ? 'bg-amber-900/30 text-amber-300' : 'bg-red-900/30 text-red-300'}`}>
                    {(r.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 font-mono">{r.ruleId} · {r.category}</div>
                <div className="text-[10px] text-cyan-300">{r.recommendedAction}</div>
                {r.parameterRange && <div className="text-[9px] text-slate-600 font-mono">{JSON.stringify(r.parameterRange)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Profiles */}
      {profiles.length > 0 && (
        <div className="bg-[#161a23] border border-[#1e2130] rounded-xl p-4">
          <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><Layers className="w-3.5 h-3.5 text-violet-400" /> Perfiles aprendidos</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {profiles.map(p => (
              <div key={p.name} className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold text-violet-300">{p.label}</span>
                  <span className="text-[9px] text-slate-500">{p.matchedFiles?.length || 0} archivos</span>
                </div>
                <div className="text-[10px] text-slate-400 space-y-0.5">
                  <div>Fill: {p.recommendedFillDensity?.toFixed(3)} · Satin: {p.recommendedSatinDensity?.toFixed(3)}</div>
                  <div>Max stitch: {p.maxVisibleStitchMm}mm · Max colores: {p.maxColorCount}</div>
                  <div>Contorno tras relleno: {p.contourAfterFill ? 'sí' : 'no'} · Underlay: {p.useUnderlayRules?.largeFills ? 'sí' : 'no'}</div>
                  <div className="text-slate-500 font-mono">{(p.layerOrderRules || []).join(' → ')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Retrieval + comparison */}
      {retrieval && (
        <div className="bg-[#161a23] border border-cyan-500/30 rounded-xl p-4">
          <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><GitCompare className="w-3.5 h-3.5 text-cyan-400" /> Referencias similares + preset</h4>
          {retrieval.recommendedProfile ? (
            <div className="text-[11px] text-emerald-300 mb-2">
              Perfil recomendado: <span className="font-bold">{retrieval.recommendedProfile.label}</span> ({retrieval.recommendedProfile.name})
            </div>
          ) : (
            <div className="text-[11px] text-amber-400 mb-2">No se encontró un perfil claro (corpus pequeño).</div>
          )}
          {retrieval.topReferences.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] text-slate-500 mb-1">Top 5 referencias similares:</div>
              <div className="space-y-0.5">
                {retrieval.topReferences.map((r, i) => (
                  <div key={i} className="text-[10px] text-slate-400 flex items-center gap-2">
                    <span className="text-cyan-400 font-mono">{(r.score * 100).toFixed(0)}%</span>
                    <span className="truncate">{r.filename}</span>
                    <span className="text-slate-600">{r.colorCount}c · {r.stitchCount}p</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* v2 comparison with problems + justifying rules */}
      {v2Comparison && !v2Comparison.error && (
        <div className="bg-[#161a23] border border-cyan-500/30 rounded-xl p-4">
          <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><GitCompare className="w-3.5 h-3.5 text-cyan-400" /> Comparación contra el corpus</h4>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-[#0d0f14] rounded-lg p-2.5 text-center border border-[#1e2130]">
              <div className="text-xl font-bold text-violet-400">{v2Comparison.similarityScore}</div>
              <div className="text-[9px] text-slate-500">Similarity /100</div>
            </div>
            <div className="bg-[#0d0f14] rounded-lg p-2.5 text-center border border-[#1e2130]">
              <div className="text-xl font-bold text-amber-400">{v2Comparison.professionalGapScore}</div>
              <div className="text-[9px] text-slate-500">Professional gap /100</div>
            </div>
          </div>
          {v2Comparison.problems?.length > 0 ? (
            <div className="mb-2">
              <div className="text-[11px] text-amber-400 mb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Tu diseño se aleja del corpus en:</div>
              <div className="space-y-1">
                {v2Comparison.problems.map((p, i) => (
                  <div key={i} className="bg-[#0d0f14] border border-amber-500/20 rounded-lg px-2 py-1.5">
                    <div className="text-[11px] text-amber-300">• {p.message}</div>
                    {p.adjustment && <div className="text-[10px] text-cyan-300">→ {p.adjustment}</div>}
                    {p.justifyingRule && <div className="text-[9px] text-slate-600 font-mono">regla: {p.justifyingRule}</div>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-emerald-400 flex items-center gap-1 mb-2"><CheckCircle2 className="w-3 h-3" /> Diseño alineado con el corpus profesional.</div>
          )}
        </div>
      )}
      {v2Comparison?.error && (
        <div className="text-[11px] text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{v2Comparison.error}</div>
      )}

      {/* Applied preset */}
      {appliedPatch && (
        <div className="bg-[#161a23] border border-emerald-500/30 rounded-xl p-4">
          <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><Wand2 className="w-3.5 h-3.5 text-emerald-400" /> Preset aprendido (Professional Mode)</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
            {Object.entries(appliedPatch).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0)).map(([k, v]) => (
              <div key={k} className="bg-[#0d0f14] border border-[#1e2130] rounded px-2 py-1">
                <div className="text-[9px] text-slate-600 font-mono">{k}</div>
                <div className="text-[11px] text-emerald-300">{Array.isArray(v) ? v.join(' → ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-slate-500 mt-2">Estos parámetros se aplican solo cuando Professional Mode está activo. No toca el encoder DST/DSB ni el validador CE01.</div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="bg-[#0d0f14] rounded-lg p-2 border border-[#1e2130]">
      <div className={`text-sm font-bold ${color}`}>{value}</div>
      <div className="text-[8px] text-slate-600 uppercase tracking-wide">{label}</div>
    </div>
  );
}

// Minimal metadata shim (same as the parent panel's helper)
function computeMetadataFromCommands(commands) {
  const stitches = commands.filter(c => c.type === 'stitch');
  const jumps = commands.filter(c => c.type === 'jump');
  const trims = commands.filter(c => c.type === 'trim');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const stitchLengths = [];
  let prevStitch = null, totalStitchLen = 0, longStitchCount = 0, shortStitchCount = 0, duplicateStitchCount = 0;
  let visibleTravelMm = 0, prevCmd = null;
  for (const c of commands) {
    if (c.x === undefined) continue;
    if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
    if (c.type === 'stitch' && prevStitch) {
      const len = Math.hypot(c.x - prevStitch.x, c.y - prevStitch.y);
      stitchLengths.push(len); totalStitchLen += len;
      if (len < 0.05) duplicateStitchCount++;
      else if (len < 1.0) shortStitchCount++;
      else if (len > 7.0) longStitchCount++;
    }
    if (c.type === 'jump' && prevCmd) {
      const jl = Math.hypot(c.x - prevCmd.x, c.y - prevCmd.y);
      if (jl > 6.0) visibleTravelMm += jl;
    }
    if (c.type === 'stitch') prevStitch = c;
    prevCmd = c;
  }
  if (!Number.isFinite(minX)) { minX = maxX = minY = maxY = 0; }
  const bbArea = Math.max(0, (maxX - minX) * (maxY - minY));
  const colorBlocks = [];
  let blockStart = 0, blockColor = 0;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type === 'colorChange') { colorBlocks.push({ color: blockColor, start: blockStart, end: i }); blockStart = i; blockColor = (c.color || blockColor) + 1; }
    else if (c.type === 'end') { colorBlocks.push({ color: blockColor, start: blockStart, end: i }); break; }
  }
  if (colorBlocks.length === 0 && stitches.length > 0) colorBlocks.push({ color: 0, start: 0, end: commands.length });
  return {
    stitchCount: stitches.length, colorCount: colorBlocks.length, jumpCount: jumps.length, trimCount: trims.length,
    colorBlocks, colorSequence: colorBlocks.map(b => b.color), stitchLengths,
    averageStitchLength: stitchLengths.length ? totalStitchLen / stitchLengths.length : 0,
    maxStitchLength: stitchLengths.length ? Math.max(...stitchLengths) : 0,
    boundingBoxMm: { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY },
    estimatedDensity: bbArea > 0 ? totalStitchLen / bbArea : 0,
    visibleTravelMm, longStitchCount, shortStitchCount, duplicateStitchCount, fileSize: 0,
  };
}