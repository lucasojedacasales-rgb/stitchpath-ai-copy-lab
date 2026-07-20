/**
 * learnedPresetValidator.js — Reference Learning Engine v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Aplica el preset aprendido al diseño actual, REGENERA finalCommands antes y
 * después, ejecuta el Professional Quality Gate sobre los comandos reales y
 * compara métricas. No inventa métricas: todas se miden sobre los comandos.
 *
 * Flujo:
 *   1. Carga el conocimiento persistido (loadLearningState).
 *   2. Selecciona el mejor perfil para las regiones actuales.
 *   3. Construye el preset base + aplica CARTOON_OUTLINE_PROFESSIONAL_OVERRIDE.
 *   4. ANTES: buildFinalCommands(regiones, config sin learned*, professionalMode=false) → gate.
 *   5. DESPUÉS: buildFinalCommands(regiones, config+patch, professionalMode=true) → applyProfessionalPipeline → gate.
 *   6. Compara métricas, emite veredicto y flags.
 *   7. Genera REFERENCE_LEARNING_VALIDATED_REPORT.md.
 *
 * No toca: encoders, CE01 loader, parser, corpus, detector universal, /regression.
 */

import { buildFinalCommands, DEFAULT_MACHINE } from '@/lib/exportPipeline';
import {
  applyProfessionalPipeline,
  professionalEmbroideryQualityGate,
  compareFinalLookVsExport,
} from '@/lib/professionalDigitizingMode';
import { validateCE01 } from '@/lib/ce01Validator';
import { selectBestLearnedProfileForCurrentDesign } from './referenceDesignSelector';
import { buildProfessionalPresetFromLearnedProfile } from './learnedPresetBuilder';
import { presetToConfigPatch } from './referenceLearningApplier';
import { detectCartoonOutlineOverride } from './cartoonOutlineOverride';
import { generateReferenceLearningValidatedReport } from './referenceLearningValidatedReport';
import { loadLearningState } from './referenceLearningState';
import { generateVisibleSplitterForensics } from '@/lib/exportRepair/visibleSplitterForensics';

const LEARNED_KEYS = [
  'learnedFillDensityMm', 'learnedFillAngleDeg', 'learnedSatinColumnSpacingMm',
  'learnedSatinWidthMm', 'learnedPullCompensationMm', 'learnedMaxVisibleStitchMm',
  'learnedMaxColorCount', 'learnedConvertTravelAboveMmToJump', 'learnedTrimBeforeTravelMm',
  'learnedNeighborAngleVariationDeg', 'learnedContourAfterFill', 'learnedUnderlayEnabled',
  'learnedReduceSimilarColors', 'learnedUseSatinForOuterContours', 'learnedDetailsLast',
  'learnedProfileId', 'learnedPresetSource', 'professionalMode',
];

/**
 * @param {object} ctx
 * @param {Array} ctx.regions
 * @param {object} ctx.baseConfig — config actual del proyecto (sin learned* idealmente)
 * @param {object} ctx.darkStroke
 * @param {object} ctx.machineSettings
 * @param {string} ctx.designName
 * @returns {object} validation result (con .report markdown y .configPatch)
 */
export function validateLearnedPresetEffectiveness({ regions, baseConfig = {}, darkStroke, machineSettings, designName }) {
  const ms = { ...DEFAULT_MACHINE, ...machineSettings };
  const state = loadLearningState();
  if (!state || !state.learnedProfiles || state.learnedProfiles.length === 0) {
    return { error: 'No hay conocimiento aprendido. Ejecuta APRENDER DEL CORPUS primero.' };
  }

  // 1. Seleccionar perfil
  const selection = selectBestLearnedProfileForCurrentDesign(regions || [], [], state.learnedProfiles);
  if (!selection.selectedProfile) {
    return { error: 'No hay un perfil aprendido que coincida con este diseño.' };
  }

  // 2. Preset base
  const basePreset = buildProfessionalPresetFromLearnedProfile(selection.selectedProfile, state.learnedRules || []);
  if (!basePreset) return { error: 'No se pudo construir el preset.' };

  // 3. Cartoon override
  const cartoon = detectCartoonOutlineOverride({
    regions: regions || [], commands: [], selectedProfile: selection.selectedProfile, darkStroke,
  });
  const finalPreset = { ...basePreset };
  if (cartoon.applies) {
    finalPreset.contourAfterFill = cartoon.override.contourAfterFill;
    finalPreset.useSatinForOuterContours = cartoon.override.useSatinForOuterContours;
    finalPreset.detailsLast = cartoon.override.detailsLast;
  }
  const afterPatch = presetToConfigPatch(finalPreset);

  // 4. Config ANTES = base sin learned* + professionalMode=false
  const beforeConfig = stripLearned(baseConfig);
  beforeConfig.professionalMode = false;

  // 5. Config DESPUÉS = base sin learned* + patch (professionalMode=true)
  const afterConfig = { ...stripLearned(baseConfig), ...afterPatch };

  // ── ANTES: regenerar comandos sin preset ──
  const beforeBuilt = buildFinalCommands(regions || [], beforeConfig, ms, 'DST');
  const beforeGate = professionalEmbroideryQualityGate(beforeBuilt.commands, beforeBuilt.objects, regions || [], darkStroke, beforeConfig);
  const beforeCmp = compareFinalLookVsExport(beforeBuilt.commands, beforeBuilt.commands);
  const beforeCe01 = validateCE01(beforeBuilt.commands, beforeBuilt.objects, regions || [], beforeConfig, ms);
  const before = extractMetrics(beforeBuilt.commands, beforeGate, beforeCmp, beforeCmp);

  // ── DESPUÉS: regenerar con preset + professional pipeline ──
  const afterBuilt = buildFinalCommands(regions || [], afterConfig, ms, 'DST');
  const prof = applyProfessionalPipeline({
    commands: afterBuilt.commands, objects: afterBuilt.objects, regions: regions || [],
    config: afterConfig, darkStroke,
  });
  const afterCommands = prof.commands || afterBuilt.commands;
  const afterObjects = prof.objects || afterBuilt.objects;
  const afterGate = prof.report?.gate || professionalEmbroideryQualityGate(afterCommands, afterObjects, regions || [], darkStroke, afterConfig);
  // Final Look y Export usan la MISMA lista (single source) → mismatch=false por construcción
  const afterCmp = compareFinalLookVsExport(afterCommands, afterCommands);
  const afterCe01 = validateCE01(afterCommands, afterObjects, regions || [], afterConfig, ms);
  const after = extractMetrics(afterCommands, afterGate, afterCe01, afterCmp);

  // 6. Veredicto
  const verdict = computeVerdict(before, after);
  const j003 = (state.learnedRules || []).find((r) => r.ruleId === 'J003_max_visible_stitch');
  const corpusCeiling = j003?.parameterRange?.ceiling ? parseFloat(j003.parameterRange.ceiling) : 4.03;
  const meetsJ003 = after.maxVisibleStitchMm <= corpusCeiling + 0.5;
  const diagonalsDropped = after.visibleDiagonalStitches < before.visibleDiagonalStitches;
  const notEffective = !meetsJ003 && !diagonalsDropped;

  // 7. Integridad
  const integrity = {
    finalLookExportMismatch: afterCmp.simulationExportMismatch,
    contourMissingOnOneFoot: afterGate.contourMissingOnOneFoot,
    fillAfterContour: afterGate.fillAfterContour,
    ce01Status: afterCe01.status,
  };

  // 8. Informe
  const visibleSplitter = prof.report?.visibleSplitter || null;
  const underlayGenerator = prof.report?.underlayGenerator || null;
  const underlayIntegratedValidation = prof.report?.underlayIntegratedValidation || null;
  const report = generateReferenceLearningValidatedReport({
    designName: designName || 'Diseño actual',
    selection, basePreset, finalPreset, cartoon,
    before, after, verdict, notEffective, corpusCeiling, integrity,
    learnedRules: state.learnedRules || [],
    visibleSplitter,
  });
  const splitterReport = visibleSplitter
    ? generateReferenceLearningValidatedReport({
        designName: designName || 'Diseño actual',
        selection, basePreset, finalPreset, cartoon,
        before, after, verdict, notEffective, corpusCeiling, integrity,
        learnedRules: state.learnedRules || [],
        reportTitle: 'REFERENCE_LEARNING_VALIDATED_REPORT_AFTER_VISIBLE_SPLITTER_V1_2',
        visibleSplitter,
      })
    : null;

  // ── Forense del splitter (read-only) — solo si el splitter se ejecutó ──
  let visibleSplitterForensics = null;
  if (visibleSplitter) {
    const targetMax = afterConfig.learnedMaxVisibleStitchMm ?? 4.0;
    try {
      visibleSplitterForensics = generateVisibleSplitterForensics({
        commands: afterCommands, regions: regions || [], darkStroke,
        config: afterConfig, targetMaxMm: targetMax, limit: 50,
      });
    } catch (e) {
      visibleSplitterForensics = { report: `# Forense error\n\n${e.message}`, candidatesFound: 0 };
    }
  }

  return {
    selection, basePreset, finalPreset, cartoon,
    before, after, verdict, notEffective, integrity, report,
    trimGuard: prof.report?.trimGuard || null,
    underlayGenerator,
    underlayIntegratedValidation,
    satinOuterContourConverter: prof.report?.satinOuterContourConverter || null,
    visibleSplitter,
    splitterReport,
    visibleSplitterForensics,
    configPatch: afterPatch,
    corpusCeiling,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripLearned(config) {
  const out = { ...config };
  for (const k of LEARNED_KEYS) delete out[k];
  return out;
}

function extractMetrics(commands, gate, ce01, cmp) {
  const stitches = commands.filter((c) => c.type === 'stitch').length;
  const jumps = commands.filter((c) => c.type === 'jump').length;
  const trims = commands.filter((c) => c.type === 'trim').length;
  const colors = new Set(commands.filter((c) => c.color).map((c) => c.color.toLowerCase())).size;
  const unsupportedLong = gate.blocks?.find((b) => b.name === 'unsupportedLongStitches')?.value ?? 0;
  return {
    stitchCount: stitches,
    jumpCount: jumps,
    trimCount: trims,
    colorCount: colors,
    visibleDiagonalStitches: gate.visibleDiagonalStitches ?? 0,
    maxVisibleStitchMm: maxVisibleStitchMm(commands),
    unsupportedTravelStitches: gate.unsupportedTravelStitches ?? 0,
    unsupportedLongStitches: unsupportedLong,
    shortStitchCount: gate.shortStitches ?? 0,
    duplicateStitches: gate.duplicateStitches ?? 0,
    satinContourCount: gate.satinContourCount ?? 0,
    runningContourCount: gate.runningContourCount ?? 0,
    fillBlockCount: gate.fillRegionCount ?? 0,
    underlayCount: gate.underlayCount ?? 0,
    finalLookExportMismatch: !!cmp.simulationExportMismatch,
    ce01Status: ce01.status,
    ce01Score: ce01.score,
    professionalScore: gate.professionalScore ?? 0,
  };
}

function maxVisibleStitchMm(commands) {
  let max = 0, prev = null;
  for (const c of commands) {
    if (c.type !== 'stitch') { if (c.type === 'jump') prev = { x: c.x, y: c.y }; continue; }
    if (prev) {
      const d = Math.hypot((c.x ?? 0) - prev.x, (c.y ?? 0) - prev.y);
      if (d > max && d <= 12) max = d;
    }
    prev = { x: c.x, y: c.y };
  }
  return max;
}

function computeVerdict(before, after) {
  const lowerBetter = [
    'visibleDiagonalStitches', 'maxVisibleStitchMm', 'unsupportedTravelStitches',
    'unsupportedLongStitches', 'shortStitchCount', 'duplicateStitches',
    'jumpCount', 'trimCount',
  ];
  const higherBetter = ['professionalScore'];
  let net = 0;
  const changes = [];
  for (const k of lowerBetter) {
    const b = before[k] ?? 0, a = after[k] ?? 0;
    if (a === b) continue;
    if (a < b) { net++; changes.push(`${k}: ${b} → ${a} ✅`); }
    else { net--; changes.push(`${k}: ${b} → ${a} ❌`); }
  }
  for (const k of higherBetter) {
    const b = before[k] ?? 0, a = after[k] ?? 0;
    if (a === b) continue;
    if (a > b) { net++; changes.push(`${k}: ${b} → ${a} ✅`); }
    else { net--; changes.push(`${k}: ${b} → ${a} ❌`); }
  }
  const verdict = net > 0 ? 'IMPROVED' : net === 0 ? 'NO_CHANGE' : 'WORSENED';
  return { verdict, net, changes };
}