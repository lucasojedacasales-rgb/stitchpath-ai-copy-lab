import { useState, useCallback, useRef } from 'react';
import { Upload, Trash2, GitCompare, Download, Sparkles, Layers, AlertTriangle, FileText, X } from 'lucide-react';
import { parseReferenceFileFromFile } from '@/lib/referenceLearning/referenceFileParser';
import { analyzeReferenceMetrics } from '@/lib/referenceLearning/referenceMetricsAnalyzer';
import { classifyStitchBlocks } from '@/lib/referenceLearning/stitchPatternClassifier';
import { extractProfessionalRules } from '@/lib/referenceLearning/professionalRuleExtractor';
import {
  listReferences, addReference, removeReference, clearLibrary,
  updateReferenceTags, refreshRules, AVAILABLE_TAGS,
} from '@/lib/referenceLearning/referenceLibrary';
import { compareAgainstReferences } from '@/lib/referenceLearning/wilcomStyleComparator';
import { generateReferenceLearningReport } from '@/lib/referenceLearning/referenceReportGenerator';
import { base44 } from '@/api/base44Client';
import ReferenceEngineV2Section from './ReferenceEngineV2Section';
import CorpusLearningSection from './CorpusLearningSection';
import { isReferenceLearningManualOnly } from '@/lib/emergencyStabilization';

/**
 * ReferenceLearningPanel — diagnostic UI for the Reference Embroidery
 * Learning System. Lets the user:
 *   - upload good DST/DSB reference files
 *   - view per-file metrics
 *   - view learned professional rules
 *   - compare the currently-open StitchPath AI design against the references
 *   - export the REFERENCE_LEARNING_REPORT.md
 *
 * Read-only diagnostic. Never modifies the motor, export, CE01, the universal
 * contour detector, or the regression suite.
 */
export default function ReferenceLearningPanel({ embeddedProjectCommands, embeddedProjectRegions, embeddedProjectName, onApplyLearnedConfig }) {
  const [references, setReferences] = useState([]);
  const [manualLoaded, setManualLoaded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);
  const [selectedRefId, setSelectedRefId] = useState(null);
  const [rules, setRules] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);
  // In-memory parsed files (with full commandSequence) for the v2 engine.
  const [parsedFiles, setParsedFiles] = useState([]);
  const fileInputRef = useRef(null);

  const refresh = useCallback(() => {
    const lib = listReferences({ manual: true });
    setReferences(lib);
    setRules(refreshRules(lib, extractProfessionalRules));
    setManualLoaded(true);
  }, []);

  const handleManualLoadReferences = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const newlyParsed = [];
      for (const file of files) {
        const parsed = await parseReferenceFileFromFile(file);
        if (parsed.commands.length === 0) {
          setAnalyzeError(`No se pudieron leer puntadas de ${file.name}`);
          continue;
        }
        newlyParsed.push(parsed);
        const classifiedBlocks = classifyStitchBlocks(parsed.commands);
        const metrics = analyzeReferenceMetrics(parsed.commands, parsed.metadata);
        addReference({
          filename: parsed.filename,
          format: parsed.format,
          size: parsed.metadata.fileSize,
          metrics,
          classifiedBlocks,
          extractedRules: [],
          professionalScore: metrics.professionalScore,
          tags: [],
        });
      }
      if (newlyParsed.length) setParsedFiles(prev => [...prev, ...newlyParsed]);
      refresh();
    } catch (e) {
      setAnalyzeError(e.message || 'Error al analizar archivos');
    } finally {
      setAnalyzing(false);
    }
  }, [refresh]);

  const handleRemove = useCallback((id) => {
    removeReference(id);
    refresh();
    if (selectedRefId === id) setSelectedRefId(null);
  }, [refresh, selectedRefId]);

  const handleClear = useCallback(() => {
    if (!confirm('¿Borrar toda la biblioteca de referencias?')) return;
    clearLibrary();
    refresh();
    setComparison(null);
    setParsedFiles([]);
  }, [refresh]);

  const handleTagToggle = useCallback((id, tag) => {
    const ref = listReferences({ manual: true }).find(r => r.id === id);
    if (!ref) return;
    const tags = ref.tags || [];
    const next = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag];
    updateReferenceTags(id, next);
    refresh();
  }, [refresh]);

  // ─── Compare against current project (from Editor) ───────────────────────
  const handleCompare = useCallback(async () => {
    setComparing(true);
    setAnalyzeError(null);
    try {
      let ourCommands = embeddedProjectCommands;
      let ourRegions = embeddedProjectRegions;
      if (!ourCommands) {
        // Fallback: try to load the most recent project
        const projects = await base44.entities.Project.list('-updated_date', 1);
        const p = projects?.[0];
        if (p) {
          ourRegions = p.regions || [];
          const { buildFinalCommands, DEFAULT_MACHINE } = await import('@/lib/exportPipeline');
          const built = buildFinalCommands(ourRegions, p.config || {}, DEFAULT_MACHINE, 'DST');
          ourCommands = built.commands;
        }
      }
      if (!ourCommands || ourCommands.length === 0) {
        setAnalyzeError('No hay un diseño propio para comparar. Abre un proyecto en el Editor o usa el panel embebido.');
        return;
      }
      const ourMetrics = analyzeReferenceMetrics(ourCommands, computeMetadataFromCommands(ourCommands));
      const cmp = compareAgainstReferences(ourCommands, ourMetrics, listReferences({ manual: true }));
      setComparison(cmp);
    } catch (e) {
      setAnalyzeError(e.message || 'Error al comparar');
    } finally {
      setComparing(false);
    }
  }, [embeddedProjectCommands, embeddedProjectRegions]);

  const handleExportReport = useCallback(() => {
    const md = generateReferenceLearningReport({
      references: listReferences({ manual: true }),
      rules,
      comparison,
      projectName: embeddedProjectName || null,
    });
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'REFERENCE_LEARNING_REPORT.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [rules, comparison, embeddedProjectName]);

  const selectedRef = references.find(r => r.id === selectedRefId);
  const avgScore = references.length
    ? Math.round(references.reduce((s, r) => s + (r.professionalScore || r.metrics?.professionalScore || 0), 0) / references.length)
    : 0;

  return (
    <div className="space-y-4">
      {/* Header / actions */}
      <div className="bg-[#161a23] border border-[#1e2130] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-bold text-white">Biblioteca de Referencias</h2>
            <span className="text-[10px] text-slate-500">{references.length} archivos</span>
            {references.length > 0 && (
              <span className="text-[10px] text-emerald-400">Score pro promedio: {avgScore}/100</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleManualLoadReferences}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 border border-amber-500/30 text-amber-300 text-xs font-bold hover:bg-amber-600/30 transition-colors"
            >
              Analizar referencias
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={analyzing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              {analyzing ? 'Analizando...' : 'Subir DST/DSB/STP'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".dst,.dsb,.stp"
              multiple
              className="hidden"
              onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
            />
            <button
              onClick={handleCompare}
              disabled={comparing || references.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/20 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-600/30 transition-colors disabled:opacity-50"
            >
              <GitCompare className="w-3.5 h-3.5" />
              {comparing ? 'Comparando...' : 'Comparar mi diseño'}
            </button>
            <button
              onClick={handleExportReport}
              disabled={references.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0d0f14] border border-[#2a2d3a] text-slate-300 text-xs font-bold hover:bg-[#1e2130] transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              Informe
            </button>
            {references.length > 0 && (
              <button
                onClick={handleClear}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-red-900/20 border border-red-500/30 text-red-300 text-xs hover:bg-red-900/30 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="text-[11px] text-amber-300 bg-amber-900/15 border border-amber-500/30 rounded-lg px-3 py-2 mb-2">
          Reference Learning está en modo manual para evitar lentitud y errores.
          {isReferenceLearningManualOnly() && <span className="text-slate-400"> Los archivos de referencia no se cargan ni entrenan al arrancar.</span>}
          {!manualLoaded && <span className="text-slate-400"> Pulsa “Analizar referencias” para cargar la biblioteca manualmente.</span>}
        </div>
        {analyzeError && (
          <div className="text-[11px] text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2 mb-2">
            {analyzeError}
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          Sube bordados profesionales en formato <span className="text-cyan-400 font-mono">DST</span> o <span className="text-cyan-400 font-mono">DSB</span> que ya funcionen bien en máquina.
          El sistema extrae métricas y reglas técnicas — nunca copia puntadas ni diseños.
        </p>
      </div>

      {/* ── Aprendizaje de corpus — acción principal 🧠 APRENDER DEL CORPUS ── */}
      <CorpusLearningSection
        parsedFiles={parsedFiles}
        embeddedProjectCommands={embeddedProjectCommands}
        embeddedProjectRegions={embeddedProjectRegions}
        embeddedProjectName={embeddedProjectName}
        onApplyLearnedConfig={onApplyLearnedConfig}
      />

      {/* Reference Learning Engine v2 (comparación avanzada) */}
      <ReferenceEngineV2Section
        parsedFiles={parsedFiles}
        embeddedProjectCommands={embeddedProjectCommands}
        embeddedProjectRegions={embeddedProjectRegions}
        embeddedProjectName={embeddedProjectName}
        onApplyLearnedConfig={onApplyLearnedConfig}
      />

      {/* Reference list */}
      {references.length === 0 ? (
        <div className="bg-[#0d0f14] border border-dashed border-[#2a2d3a] rounded-xl p-8 text-center">
          <FileText className="w-8 h-8 text-slate-700 mx-auto mb-2" />
          <p className="text-sm text-slate-400 mb-1">Sin referencias todavía</p>
          <p className="text-xs text-slate-600">Sube archivos buenos para empezar a aprender reglas profesionales.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {references.map(r => (
            <div
              key={r.id}
              className={`bg-[#161a23] border rounded-xl p-3 cursor-pointer transition-colors ${selectedRefId === r.id ? 'border-violet-500/50 bg-violet-900/10' : 'border-[#1e2130] hover:border-[#2a2d3a]'}`}
              onClick={() => setSelectedRefId(r.id)}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${r.format === 'DST' ? 'bg-cyan-900/30 text-cyan-300' : 'bg-amber-900/30 text-amber-300'}`}>
                    {r.format}
                  </span>
                  <span className="text-xs font-semibold text-slate-200 truncate">{r.filename}</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemove(r.id); }}
                  className="p-1 rounded hover:bg-red-900/30 text-slate-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1 text-center mb-2">
                <MetricCell label="Puntadas" value={r.metrics.stitchCount} color="text-violet-400" />
                <MetricCell label="Colores" value={r.metrics.colorCount} color="text-cyan-400" />
                <MetricCell label="Saltos" value={r.metrics.jumpCount} color="text-amber-400" />
                <MetricCell label="Trims" value={r.metrics.trimCount} color="text-red-400" />
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-500">Score pro: <span className="text-emerald-400 font-bold">{r.professionalScore || r.metrics.professionalScore}/100</span></span>
                <span className="text-slate-500">Density: <span className="text-slate-300">{r.metrics.estimatedDensity.toFixed(3)}</span></span>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {AVAILABLE_TAGS.map(tag => (
                  <button
                    key={tag}
                    onClick={(e) => { e.stopPropagation(); handleTagToggle(r.id, tag); }}
                    className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${(r.tags || []).includes(tag) ? 'bg-violet-900/30 border-violet-500/40 text-violet-300' : 'border-[#2a2d3a] text-slate-600 hover:text-slate-400'}`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected reference detail */}
      {selectedRef && (
        <div className="bg-[#161a23] border border-violet-500/30 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-violet-400" />
              {selectedRef.filename}
            </h3>
            <button onClick={() => setSelectedRefId(null)} className="p-1 rounded hover:bg-[#1e2130] text-slate-500 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center mb-3">
            <MetricCell label="Puntadas largas visibles" value={selectedRef.metrics.longVisibleStitchCount} color="text-red-400" />
            <MetricCell label="Puntadas cortas" value={selectedRef.metrics.shortStitchCount} color="text-amber-400" />
            <MetricCell label="Duplicadas" value={selectedRef.metrics.duplicateStitchCount} color="text-orange-400" />
            <MetricCell label="Bloques contorno" value={selectedRef.metrics.contourLikeBlocks} color="text-cyan-400" />
            <MetricCell label="Bloques relleno" value={selectedRef.metrics.fillLikeBlocks} color="text-violet-400" />
            <MetricCell label="Bloques satin" value={selectedRef.metrics.satinLikeBlocks} color="text-pink-400" />
            <MetricCell label="Bloques underlay" value={selectedRef.metrics.possibleUnderlayBlocks} color="text-emerald-400" />
            <MetricCell label="Travel visible" value={selectedRef.metrics.visibleTravelScore.toFixed(3)} color="text-red-400" />
          </div>
          <div className="text-[11px] text-slate-500 mb-2">Orden de capas (primeros 15 bloques):</div>
          <div className="flex flex-wrap gap-1">
            {(selectedRef.metrics.layerOrderProfile || []).slice(0, 15).map((t, i) => (
              <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#0d0f14] border border-[#2a2d3a] text-slate-400">
                {i}:{t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Learned rules */}
      {rules.length > 0 && (
        <div className="bg-[#161a23] border border-[#1e2130] rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            Reglas profesionales aprendidas
          </h3>
          <div className="space-y-2">
            {rules.map(rule => (
              <div key={rule.ruleId} className="bg-[#0d0f14] border border-[#1e2130] rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-violet-300">{rule.name}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${rule.confidence > 0.7 ? 'bg-emerald-900/30 text-emerald-300' : rule.confidence > 0.4 ? 'bg-amber-900/30 text-amber-300' : 'bg-red-900/30 text-red-300'}`}>
                    {(rule.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 mb-1 font-mono">{rule.ruleId}</div>
                <div className="text-[11px] text-slate-400 mb-1">{rule.pattern}</div>
                <div className="text-[11px] text-cyan-300">{rule.recommendedAction}</div>
                {rule.examples?.length > 0 && (
                  <div className="text-[10px] text-slate-600 mt-1">Ejemplos: {rule.examples.join(', ')}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Comparison */}
      {comparison && (
        <div className="bg-[#161a23] border border-cyan-500/30 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-cyan-400" />
            Comparación contra referencias
          </h3>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-[#0d0f14] rounded-lg p-3 text-center border border-[#1e2130]">
              <div className="text-2xl font-bold text-violet-400">{comparison.similarityScore}</div>
              <div className="text-[10px] text-slate-500">Similarity score /100</div>
            </div>
            <div className="bg-[#0d0f14] rounded-lg p-3 text-center border border-[#1e2130]">
              <div className="text-2xl font-bold text-amber-400">{comparison.professionalGapScore}</div>
              <div className="text-[10px] text-slate-500">Professional gap /100</div>
            </div>
          </div>
          {comparison.differences.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] text-slate-500 mb-1">Diferencias top:</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {comparison.differences.slice(0, 10).map((d, i) => (
                  <div key={i} className="text-[10px] flex items-center gap-2 bg-[#0d0f14] rounded px-2 py-1 border border-[#1e2130]">
                    <span className="text-slate-400 font-mono">{d.metric}</span>
                    <span className="text-slate-500">ref {fmt(d.reference)}</span>
                    <span className="text-slate-500">→</span>
                    <span className="text-violet-300">{fmt(d.ours)}</span>
                    <span className={`ml-auto px-1 rounded text-[9px] ${d.severity === 'high' ? 'bg-red-900/30 text-red-300' : d.severity === 'medium' ? 'bg-amber-900/30 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>{d.severity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {comparison.missingProfessionalFeatures.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] text-amber-400 mb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Características profesionales faltantes:</div>
              <ul className="space-y-1">
                {comparison.missingProfessionalFeatures.map((m, i) => (
                  <li key={i} className="text-[11px] text-amber-300">• {m.recommendation}</li>
                ))}
              </ul>
            </div>
          )}
          {comparison.overusedFeatures.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] text-red-400 mb-1">Características sobreutilizadas:</div>
              <ul className="space-y-1">
                {comparison.overusedFeatures.map((o, i) => (
                  <li key={i} className="text-[11px] text-red-300">• {o.recommendation}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="border-t border-[#1e2130] pt-2">
            <div className="text-[11px] text-emerald-400 mb-1">Recomendaciones:</div>
            <ul className="space-y-1">
              {comparison.recommendations.map((rec, i) => (
                <li key={i} className="text-[11px] text-slate-300">• {rec}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCell({ label, value, color }) {
  return (
    <div className="bg-[#0d0f14] rounded px-2 py-1.5 border border-[#1e2130]">
      <div className={`text-sm font-bold ${color}`}>{typeof value === 'number' ? value : value}</div>
      <div className="text-[9px] text-slate-600">{label}</div>
    </div>
  );
}

function fmt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  return String(v ?? '—');
}

// Minimal metadata shim from a command list (used when comparing our design)
function computeMetadataFromCommands(commands) {
  const stitches = commands.filter(c => c.type === 'stitch');
  const jumps = commands.filter(c => c.type === 'jump');
  const trims = commands.filter(c => c.type === 'trim');
  const colorChanges = commands.filter(c => c.type === 'colorChange');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const stitchLengths = [];
  let prevStitch = null, totalStitchLen = 0, longStitchCount = 0, shortStitchCount = 0, duplicateStitchCount = 0;
  let visibleTravelMm = 0;
  let prevCmd = null;
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
  // color blocks
  const colorBlocks = [];
  let blockStart = 0, blockColor = 0;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.type === 'colorChange') {
      colorBlocks.push({ color: blockColor, start: blockStart, end: i });
      blockStart = i; blockColor = (c.color || blockColor) + 1;
    } else if (c.type === 'end') {
      colorBlocks.push({ color: blockColor, start: blockStart, end: i });
      break;
    }
  }
  if (colorBlocks.length === 0 && stitches.length > 0) colorBlocks.push({ color: 0, start: 0, end: commands.length });
  return {
    stitchCount: stitches.length,
    colorCount: colorBlocks.length,
    jumpCount: jumps.length,
    trimCount: trims.length,
    colorBlocks,
    colorSequence: colorBlocks.map(b => b.color),
    stitchLengths,
    averageStitchLength: stitchLengths.length ? totalStitchLen / stitchLengths.length : 0,
    maxStitchLength: stitchLengths.length ? Math.max(...stitchLengths) : 0,
    boundingBoxMm: { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY },
    estimatedDensity: bbArea > 0 ? totalStitchLen / bbArea : 0,
    visibleTravelMm,
    longStitchCount, shortStitchCount, duplicateStitchCount,
    fileSize: 0,
  };
}