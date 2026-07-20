import { buildFinalCommands, DEFAULT_MACHINE } from '../exportPipeline.js';
import { resolveEffectiveEmbroideryProfile } from '../embroideryEngineProfiles.js';
import { runPipeline } from '../pipeline/runner.js';
import { filterValidVisualRegions } from '../visualRegionGuard.js';

const BENCHMARK_MODES = ['fast', 'standard', 'precision', 'hybrid', 'ultra', 'ai', 'intelligent'];

function clone(value) {
  if (value == null) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function stableStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, val) => {
    if (key === 'darkStroke' || key === 'mask') return '[omitted-heavy-runtime-data]';
    if (val && typeof val === 'object') {
      if (seen.has(val)) return '[circular]';
      seen.add(val);
      if (!Array.isArray(val)) {
        return Object.keys(val).sort().reduce((out, k) => {
          out[k] = val[k];
          return out;
        }, {});
      }
    }
    return val;
  });
}

function shortHash(value) {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function uniqueRunId(modeName) {
  return `${modeName}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeConfigSnapshot(config = {}) {
  const out = clone(config) || {};
  delete out.darkStroke;
  delete out.previewCommands;
  delete out.rellenosPreviewCommands;
  return out;
}

function commandPoint(command) {
  return command && Number.isFinite(command.x) && Number.isFinite(command.y) ? [command.x, command.y] : null;
}

function distance(a, b) {
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
}

function countUnique(values) {
  return new Set(values.filter(Boolean).map(v => String(v).toLowerCase())).size;
}

function hexToRgb(hex = '') {
  const h = String(hex || '').replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0 };
}

function isDarkColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b < 80;
}

function polygonArea(points = [], width = 100, height = 100) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  const normalized = points.every(p => Array.isArray(p) && Math.abs(p[0]) <= 1.5 && Math.abs(p[1]) <= 1.5);
  const mm = points.map(([x, y]) => normalized ? [(x - 0.5) * width, (y - 0.5) * height] : [x, y]);
  let area = 0;
  for (let i = 0; i < mm.length; i++) {
    const a = mm[i];
    const b = mm[(i + 1) % mm.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area / 2);
}

function objectIsContour(object) {
  const text = `${object?.stitch_type || ''} ${object?.layerType || ''} ${object?.name || ''} ${object?.id || ''}`.toLowerCase();
  return object?.isContour === true || text.includes('contour') || text.includes('outline') || text.includes('running');
}

function regionSignature(regions = []) {
  return (regions || []).map(r => ({
    id: r.id,
    color: r.color || r.hex,
    stitch_type: r.stitch_type,
    visible: r.visible,
    pointCount: Array.isArray(r.path_points) ? r.path_points.length : 0,
    first: Array.isArray(r.path_points) ? r.path_points[0] : null,
    last: Array.isArray(r.path_points) ? r.path_points[r.path_points.length - 1] : null,
  }));
}

function objectSignature(objects = []) {
  return (objects || []).map(o => ({
    id: o.id,
    color: o.color,
    stitch_type: o.stitch_type,
    layerType: o.layerType,
    pointCount: Array.isArray(o.points) ? o.points.length : 0,
  }));
}

function commandSignature(commands = []) {
  return (commands || []).map(c => ({
    type: c.type,
    x: Number.isFinite(c.x) ? round(c.x, 2) : null,
    y: Number.isFinite(c.y) ? round(c.y, 2) : null,
    color: c.color || null,
    regionId: c.regionId || null,
  }));
}

function analyzeCommands(commands = []) {
  let previous = [0, 0];
  let jumpsOver3mm = 0, jumpsOver6mm = 0, jumpsOver10mm = 0;
  let totalJumpTravelMm = 0, maxJumpMm = 0;
  let stitchCommandsLongerThan3mm = 0, stitchCommandsLongerThan6mm = 0, stitchCommandsLongerThan10mm = 0;

  for (const command of commands) {
    const point = commandPoint(command);
    if (!point) continue;
    const d = distance(previous, point);
    if (command.type === 'jump') {
      if (d > 3) jumpsOver3mm++;
      if (d > 6) jumpsOver6mm++;
      if (d > 10) jumpsOver10mm++;
      totalJumpTravelMm += d;
      maxJumpMm = Math.max(maxJumpMm, d);
    }
    if (command.type === 'stitch') {
      if (d > 3) stitchCommandsLongerThan3mm++;
      if (d > 6) stitchCommandsLongerThan6mm++;
      if (d > 10) stitchCommandsLongerThan10mm++;
    }
    previous = point;
  }

  return {
    jumpsOver3mm,
    jumpsOver6mm,
    jumpsOver10mm,
    totalJumpTravelMm: round(totalJumpTravelMm),
    maxJumpMm: round(maxJumpMm),
    stitchCommandsLongerThan3mm,
    stitchCommandsLongerThan6mm,
    stitchCommandsLongerThan10mm,
  };
}

function scoreMode(row) {
  if (!row.pipelineActuallyExecuted) return null;
  const colorTargetScore = Math.max(0, 10 - Math.abs((row.regionColorCount || 0) - (row.effectiveColorCount || 8)) * 0.6);
  const travelPenalty = Math.min(6, row.jumpsOver10mm * 0.15 + row.totalJumpTravelMm / 600);
  const longStitchPenalty = Math.min(5, row.stitchCommandsLongerThan6mm * 0.08 + row.stitchCommandsLongerThan10mm * 0.25);
  const contourRatio = row.finalObjectCount ? row.contourObjectCount / row.finalObjectCount : 0;
  const fillRatio = row.finalObjectCount ? row.fillObjectCount / row.finalObjectCount : 0;
  const microPenalty = Math.min(4, row.microFragmentCount * 0.35);
  return {
    vectorizationQuality: round(Math.max(0, Math.min(10, 5 + row.regionCount / 22 - microPenalty)), 1),
    silhouetteQuality: round(Math.max(0, Math.min(10, 7 + contourRatio * 3 - longStitchPenalty * 0.35)), 1),
    colorGroupingQuality: round(Math.max(0, Math.min(10, colorTargetScore)), 1),
    blackOutlineQuality: round(Math.max(0, Math.min(10, 5 + row.darkOutlineObjectCount * 0.45 - row.stitchCommandsLongerThan10mm * 0.08)), 1),
    regionCoherence: round(Math.max(0, Math.min(10, 8 - microPenalty + Math.min(1.5, row.regionCount / 80))), 1),
    microFragmentSuppression: round(Math.max(0, Math.min(10, 10 - row.microFragmentCount * 0.5)), 1),
    fillQuality: round(Math.max(0, Math.min(10, 5 + fillRatio * 5 - longStitchPenalty * 0.2)), 1),
    travelQuality: round(Math.max(0, Math.min(10, 10 - travelPenalty)), 1),
    ce01Compatibility: round(Math.max(0, Math.min(10, 10 - row.jumpsOver10mm * 0.18 - row.stitchCommandsLongerThan10mm * 0.25)), 1),
    universalAutoDigitizingPotential: round(Math.max(0, Math.min(10, 4 + contourRatio * 2 + fillRatio * 2 + colorTargetScore * 0.2 - microPenalty * 0.2)), 1),
  };
}

function overallScore(row) {
  const s = row.scores;
  if (!s) return null;
  return round((s.vectorizationQuality + s.silhouetteQuality + s.colorGroupingQuality + s.blackOutlineQuality + s.regionCoherence + s.microFragmentSuppression + s.fillQuality + s.travelQuality + s.ce01Compatibility + s.universalAutoDigitizingPotential) / 10, 2);
}

async function benchmarkMode(modeName, { inputImageUrl, inputImageHash, config, machineSettings, darkStroke }) {
  const uniqueBenchmarkRunId = uniqueRunId(modeName);
  const baseConfig = safeConfigSnapshot(config || {});
  const modeConfig = { ...baseConfig, mode: modeName, universalAutoDigitizerPro: false };
  const profile = resolveEffectiveEmbroideryProfile(modeConfig, modeConfig.preprocessSettings || null, machineSettings || {});
  const pipelineConfig = { ...modeConfig, ...profile.pipelineConfig, mode: modeName, universalAutoDigitizerPro: false };
  const effectiveProfileHash = shortHash(profile);
  const configSnapshot = safeConfigSnapshot(pipelineConfig);
  const preprocessingSnapshot = clone(profile.effectivePreprocessSettings || {});

  const rowBase = {
    modeName,
    uniqueBenchmarkRunId,
    effectiveProfileHash,
    inputImageHash,
    configSnapshot,
    preprocessingSnapshot,
    effectiveBaseEngine: profile.effectiveBaseEngine,
    effectiveVectorEngine: profile.effectiveVectorEngine,
    effectiveUseIaVision: profile.effectiveUseIaVision,
    effectiveUseFullBackground: profile.effectiveUseFullBackground,
    effectivePreprocessSettings: profile.effectivePreprocessSettings,
    effectiveColorCount: profile.effectiveColorCount,
    effectiveTatamiDensity: profile.effectiveTatamiDensity,
    pipelineActuallyExecuted: false,
    reusedCurrentCommands: false,
    reusedCurrentRegions: false,
    cacheHit: false,
  };

  if (!inputImageUrl) {
    return { ...rowBase, error: 'missing_original_image_input' };
  }

  try {
    const ctx = await runPipeline(inputImageUrl, pipelineConfig, {
      initialCtx: { darkStroke, effectiveProfile: profile, benchmarkRunId: uniqueBenchmarkRunId },
    });
    const freshRegions = filterValidVisualRegions(ctx.regions || []);
    if (freshRegions.length === 0) {
      return { ...rowBase, pipelineActuallyExecuted: true, error: 'pipeline_produced_no_valid_regions' };
    }

    const resolvedMachine = {
      ...DEFAULT_MACHINE,
      ...(machineSettings || {}),
      hoopSize: machineSettings?.hoopSize || [pipelineConfig.width_mm || 100, pipelineConfig.height_mm || 100],
    };
    const result = buildFinalCommands(clone(freshRegions), pipelineConfig, resolvedMachine, 'DST');
    const commands = result.commands || [];
    const objects = result.objects || [];
    const commandStats = analyzeCommands(commands);
    const width = pipelineConfig.width_mm || 100;
    const height = pipelineConfig.height_mm || 100;
    const regionAreas = freshRegions.map(r => polygonArea(r.path_points || [], width, height));
    const regionSignatureHash = shortHash(regionSignature(freshRegions));
    const objectSignatureHash = shortHash(objectSignature(objects));
    const commandSignatureHash = shortHash(commandSignature(commands));

    const row = {
      ...rowBase,
      pipelineActuallyExecuted: true,
      regionSignatureHash,
      objectSignatureHash,
      commandSignatureHash,
      regionCount: freshRegions.length,
      regionColorCount: countUnique(freshRegions.map(r => r.color || r.hex)),
      commandColorCount: (commands.filter(c => c.type === 'colorChange').length || 0) + 1,
      finalCommandCount: commands.length,
      finalStitchCount: commands.filter(c => c.type === 'stitch').length,
      finalJumpCount: commands.filter(c => c.type === 'jump').length,
      finalTrimCount: commands.filter(c => c.type === 'trim').length,
      finalColorChangeCount: commands.filter(c => c.type === 'colorChange').length,
      finalObjectCount: objects.length,
      fillObjectCount: objects.filter(o => o.stitch_type === 'fill').length,
      contourObjectCount: objects.filter(objectIsContour).length,
      darkOutlineObjectCount: objects.filter(o => objectIsContour(o) && isDarkColor(o.color)).length,
      tinyRegionCount: regionAreas.filter(a => a > 0 && a < 1.5).length,
      microFragmentCount: regionAreas.filter(a => a > 0 && a < 0.5).length,
      ...commandStats,
      visualStructureScoreEstimate: result.meta?.visualStructureScoreEstimate ?? null,
    };
    row.scores = scoreMode(row);
    row.overallScore = overallScore(row);
    row.machinePreviewRiskScoreEstimate = row.scores ? round(Math.max(0, Math.min(10, 10 - row.scores.ce01Compatibility)), 1) : null;
    return row;
  } catch (error) {
    return { ...rowBase, error: error?.message || 'isolated_pipeline_run_failed' };
  }
}

function bestBy(rows, selector) {
  return [...rows].filter(row => row.pipelineActuallyExecuted && row.overallScore != null).sort((a, b) => selector(b) - selector(a))[0] || null;
}

function worstByOverall(rows) {
  return [...rows].filter(row => row.pipelineActuallyExecuted && row.overallScore != null).sort((a, b) => a.overallScore - b.overallScore)[0] || null;
}

function computeValidity(rows, inputImageUrl) {
  if (!inputImageUrl) {
    return { benchmarkValid: false, modeDivergenceDetected: false, isolatedPipelineRuns: false, reason: 'cannot_run_isolated_pipeline_per_mode_from_current_context' };
  }
  const isolatedPipelineRuns = rows.length === BENCHMARK_MODES.length && rows.every(row =>
    row.pipelineActuallyExecuted &&
    !row.error &&
    row.regionCount > 0 &&
    row.finalCommandCount > 0 &&
    !!row.commandSignatureHash &&
    !row.reusedCurrentCommands &&
    !row.reusedCurrentRegions &&
    row.cacheHit === false
  );
  if (!isolatedPipelineRuns) {
    return { benchmarkValid: false, modeDivergenceDetected: false, isolatedPipelineRuns, reason: 'one_or_more_isolated_pipeline_runs_failed' };
  }
  const divergenceKeys = new Set(rows.map(row => [row.regionCount, row.finalStitchCount, row.finalJumpCount, row.commandSignatureHash].join('|')));
  const modeDivergenceDetected = divergenceKeys.size > 1;
  const commandMetricKeys = new Set(rows.map(row => [row.finalCommandCount, row.finalStitchCount, row.finalJumpCount, row.finalTrimCount, row.totalJumpTravelMm, row.commandSignatureHash].join('|')));
  if (!modeDivergenceDetected || commandMetricKeys.size === 1) {
    return { benchmarkValid: false, modeDivergenceDetected: false, isolatedPipelineRuns, reason: 'all_modes_identical_likely_reused_same_command_stream' };
  }
  return { benchmarkValid: true, modeDivergenceDetected: true, isolatedPipelineRuns, reason: 'isolated_mode_divergence_detected' };
}

export async function runEngineProfileBenchmark({ imageUrl = null, originalImageUrl = null, regions = [], config = {}, machineSettings = {}, finalCommands = [], darkStroke = null } = {}) {
  const generatedAt = new Date().toISOString();
  const inputImageUrl = originalImageUrl || config?.originalUploadUrl || imageUrl || null;
  const inputImageHash = inputImageUrl ? shortHash(inputImageUrl) : null;
  const originalRegionsSnapshot = stableStringify(regions || []);
  const originalPathPointsSnapshot = stableStringify((regions || []).map(r => r.path_points || []));
  const originalCommandsSnapshot = stableStringify(finalCommands || []);

  const rows = [];
  for (const mode of BENCHMARK_MODES) {
    rows.push(await benchmarkMode(mode, { inputImageUrl, inputImageHash, config, machineSettings, darkStroke }));
  }

  const validity = computeValidity(rows, inputImageUrl);
  const reusableCurrentCommands = rows.some(row => row.reusedCurrentCommands === true);
  const bestOverall = validity.benchmarkValid ? bestBy(rows, row => row.overallScore) : null;
  const bestVectorization = validity.benchmarkValid ? bestBy(rows, row => row.scores?.vectorizationQuality || 0) : null;
  const bestOutline = validity.benchmarkValid ? bestBy(rows, row => row.scores?.blackOutlineQuality || 0) : null;
  const bestFills = validity.benchmarkValid ? bestBy(rows, row => row.scores?.fillQuality || 0) : null;
  const bestTravel = validity.benchmarkValid ? bestBy(rows, row => row.scores?.travelQuality || 0) : null;
  const worst = validity.benchmarkValid ? worstByOverall(rows) : null;
  const recommendedBaseMode = validity.benchmarkValid ? (bestOverall?.modeName || 'undetermined') : 'undetermined';

  return {
    reportId: 'ENGINE_PROFILE_BENCHMARK_V1',
    generatedAt,
    benchmarkOnly: true,
    generationBehaviorChanged: false,
    benchmarkValid: validity.benchmarkValid,
    modeDivergenceDetected: validity.modeDivergenceDetected,
    isolatedPipelineRuns: validity.isolatedPipelineRuns,
    reusedCurrentCommandsDetected: reusableCurrentCommands,
    reason: validity.reason,
    commandsModified: originalCommandsSnapshot !== stableStringify(finalCommands || []),
    regionsModified: originalRegionsSnapshot !== stableStringify(regions || []),
    originalPathPointsMutated: originalPathPointsSnapshot !== stableStringify((regions || []).map(r => r.path_points || [])),
    exportModified: false,
    encodersTouched: false,
    ExportModalTouched: false,
    MachineSimulatorTouched: false,
    FinalLookTouched: false,
    modesBenchmarked: [...BENCHMARK_MODES],
    rows,
    summary: {
      recommendedBaseMode,
      recommendedUnifiedArchitecture: validity.benchmarkValid ? 'Resolver único de perfiles + pipeline común, conservando las piezas ganadoras por etapa.' : 'undetermined',
      safestNextImplementationStep: validity.benchmarkValid ? 'Revisar el reporte y elegir una pieza por etapa sin cambiar generación todavía.' : 'Habilitar un contexto diagnóstico con imagen original accesible y ejecución aislada por modo.',
      bestModeOverall: bestOverall?.modeName || 'undetermined',
      bestModeForVectorization: bestVectorization?.modeName || 'undetermined',
      bestModeForOutline: bestOutline?.modeName || 'undetermined',
      bestModeForFills: bestFills?.modeName || 'undetermined',
      bestModeForTravel: bestTravel?.modeName || 'undetermined',
      worstMode: worst?.modeName || 'undetermined',
      worstModeReason: worst ? `overallScore=${worst.overallScore}, travel=${worst.scores.travelQuality}, microFragments=${worst.microFragmentCount}, longStitches>10=${worst.stitchCommandsLongerThan10mm}` : validity.reason,
      recommendedPiecesToKeep: validity.benchmarkValid ? [
        `${bestVectorization?.modeName || 'undetermined'} vectorization settings`,
        `${bestOutline?.modeName || 'undetermined'} outline preservation`,
        `${bestFills?.modeName || 'undetermined'} fill density behavior`,
        `${bestTravel?.modeName || 'undetermined'} travel behavior`,
      ] : [],
      recommendedPiecesToRemove: validity.benchmarkValid ? [
        'Duplicated mode-specific assumptions that do not affect final command quality',
        'Micro-fragment heavy settings when they increase jumps without visual gain',
        'Any machine-specific interpretation inside artwork analysis layers',
      ] : [],
    },
  };
}

function formatObject(value) {
  if (value == null) return '';
  if (typeof value === 'object') return '`' + JSON.stringify(value).replaceAll('|', '\\|') + '`';
  return String(value);
}

function scoreCell(row, key) {
  return row.scores ? row.scores[key] : '';
}

export function buildEngineProfileBenchmarkMarkdown(report) {
  const lines = [];
  const rows = report.rows || [];
  lines.push('# ENGINE_PROFILE_BENCHMARK_V1');
  lines.push('');
  lines.push('## Top summary');
  lines.push(`benchmarkValid=${report.benchmarkValid}`);
  lines.push(`modeDivergenceDetected=${report.modeDivergenceDetected}`);
  lines.push(`isolatedPipelineRuns=${report.isolatedPipelineRuns}`);
  lines.push(`reusedCurrentCommandsDetected=${report.reusedCurrentCommandsDetected}`);
  lines.push(`recommendedBaseMode=${report.summary?.recommendedBaseMode || 'undetermined'}`);
  lines.push(`reason=${report.reason}`);
  lines.push('');
  lines.push(`generatedAt=${report.generatedAt}`);
  lines.push(`benchmarkOnly=${report.benchmarkOnly}`);
  lines.push(`generationBehaviorChanged=${report.generationBehaviorChanged}`);
  lines.push(`commandsModified=${report.commandsModified}`);
  lines.push(`regionsModified=${report.regionsModified}`);
  lines.push(`originalPathPointsMutated=${report.originalPathPointsMutated}`);
  lines.push(`exportModified=${report.exportModified}`);
  lines.push(`encodersTouched=${report.encodersTouched}`);
  lines.push(`ExportModalTouched=${report.ExportModalTouched}`);
  lines.push(`MachineSimulatorTouched=${report.MachineSimulatorTouched}`);
  lines.push(`FinalLookTouched=${report.FinalLookTouched}`);
  lines.push('');
  lines.push('## 1. Summary');
  for (const [key, value] of Object.entries(report.summary || {})) lines.push(`- ${key}: ${Array.isArray(value) ? value.join('; ') : value}`);
  lines.push('');
  lines.push('## 2. Side-by-side mode table');
  lines.push('| modeName | runId | profileHash | imageHash | executed | reusedCommands | reusedRegions | cacheHit | regionHash | objectHash | commandHash | base | vector | IA | fullBg | colors | density | regions | regionColors | commandColors | commands | stitches | jumps | trims | colorChanges | objects | fillObjects | contourObjects | darkOutlines | tinyRegions | microFragments | jumps>3 | jumps>6 | jumps>10 | jumpTravelMm | maxJumpMm | stitch>3 | stitch>6 | stitch>10 | visualStructure | risk | overall | error |');
  lines.push('|---|---|---|---|---:|---:|---:|---:|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const row of rows) {
    const safeError = String(row.error || '').replaceAll('|', '\\|').replaceAll('\n', ' ');
    lines.push(`| ${row.modeName} | ${row.uniqueBenchmarkRunId || ''} | ${row.effectiveProfileHash || ''} | ${row.inputImageHash || ''} | ${row.pipelineActuallyExecuted} | ${row.reusedCurrentCommands ?? ''} | ${row.reusedCurrentRegions ?? ''} | ${row.cacheHit ?? ''} | ${row.regionSignatureHash || ''} | ${row.objectSignatureHash || ''} | ${row.commandSignatureHash || ''} | ${row.effectiveBaseEngine || ''} | ${row.effectiveVectorEngine || ''} | ${row.effectiveUseIaVision ?? ''} | ${row.effectiveUseFullBackground ?? ''} | ${row.effectiveColorCount ?? ''} | ${row.effectiveTatamiDensity ?? ''} | ${row.regionCount ?? ''} | ${row.regionColorCount ?? ''} | ${row.commandColorCount ?? ''} | ${row.finalCommandCount ?? ''} | ${row.finalStitchCount ?? ''} | ${row.finalJumpCount ?? ''} | ${row.finalTrimCount ?? ''} | ${row.finalColorChangeCount ?? ''} | ${row.finalObjectCount ?? ''} | ${row.fillObjectCount ?? ''} | ${row.contourObjectCount ?? ''} | ${row.darkOutlineObjectCount ?? ''} | ${row.tinyRegionCount ?? ''} | ${row.microFragmentCount ?? ''} | ${row.jumpsOver3mm ?? ''} | ${row.jumpsOver6mm ?? ''} | ${row.jumpsOver10mm ?? ''} | ${row.totalJumpTravelMm ?? ''} | ${row.maxJumpMm ?? ''} | ${row.stitchCommandsLongerThan3mm ?? ''} | ${row.stitchCommandsLongerThan6mm ?? ''} | ${row.stitchCommandsLongerThan10mm ?? ''} | ${row.visualStructureScoreEstimate ?? ''} | ${row.machinePreviewRiskScoreEstimate ?? ''} | ${row.overallScore ?? ''} | ${safeError} |`);
  }
  lines.push('');
  lines.push('### Config snapshots');
  for (const row of rows) lines.push(`- ${row.modeName}: ${formatObject(row.configSnapshot)}`);
  lines.push('');
  lines.push('### Preprocessing snapshots');
  for (const row of rows) lines.push(`- ${row.modeName}: ${formatObject(row.preprocessingSnapshot)}`);
  lines.push('');
  lines.push('### Qualitative scores 0-10');
  lines.push('| mode | vectorization | silhouette | colorGrouping | blackOutline | coherence | microSuppress | fill | travel | ce01 | universalPotential |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of rows) lines.push(`| ${row.modeName} | ${scoreCell(row, 'vectorizationQuality')} | ${scoreCell(row, 'silhouetteQuality')} | ${scoreCell(row, 'colorGroupingQuality')} | ${scoreCell(row, 'blackOutlineQuality')} | ${scoreCell(row, 'regionCoherence')} | ${scoreCell(row, 'microFragmentSuppression')} | ${scoreCell(row, 'fillQuality')} | ${scoreCell(row, 'travelQuality')} | ${scoreCell(row, 'ce01Compatibility')} | ${scoreCell(row, 'universalAutoDigitizingPotential')} |`);
  lines.push('');
  lines.push(`## 3. Best mode overall\n${report.summary.bestModeOverall}`);
  lines.push(`## 4. Best mode for vectorization\n${report.summary.bestModeForVectorization}`);
  lines.push(`## 5. Best mode for outline\n${report.summary.bestModeForOutline}`);
  lines.push(`## 6. Best mode for fills\n${report.summary.bestModeForFills}`);
  lines.push(`## 7. Best mode for travel\n${report.summary.bestModeForTravel}`);
  lines.push(`## 8. Worst mode and why\n${report.summary.worstMode}: ${report.summary.worstModeReason}`);
  lines.push(`## 9. Recommended base mode\nrecommendedBaseMode=${report.summary.recommendedBaseMode}`);
  lines.push(`## 10. Recommended pieces to keep\n${(report.summary.recommendedPiecesToKeep || []).map(x => `- ${x}`).join('\n') || '- none'}`);
  lines.push(`## 11. Recommended pieces to remove\n${(report.summary.recommendedPiecesToRemove || []).map(x => `- ${x}`).join('\n') || '- none'}`);
  lines.push('## 12. Recommended unification plan');
  lines.push(`recommendedBaseMode=${report.summary.recommendedBaseMode}`);
  lines.push(`recommendedUnifiedArchitecture=${report.summary.recommendedUnifiedArchitecture}`);
  lines.push(`safestNextImplementationStep=${report.summary.safestNextImplementationStep}`);
  return lines.join('\n');
}