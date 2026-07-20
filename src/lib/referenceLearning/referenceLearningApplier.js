/**
 * referenceLearningApplier.js — Reference Learning Engine v2 (FASE 5-7)
 * ─────────────────────────────────────────────────────────────────────────────
 * Orquesta la aplicación del aprendizaje al Professional Mode:
 *   1. selecciona el mejor perfil para el diseño actual
 *   2. construye el preset aprendido
 *   3. mapea el preset a config keys (learned*) + activa professionalMode
 *   4. compara el diseño antes/después
 *   5. genera el informe REFERENCE_LEARNING_APPLIED_REPORT.md
 *
 * NO toca encoders, CE01, detector universal ni la regresión.
 */

import { selectBestLearnedProfileForCurrentDesign } from './referenceDesignSelector';
import { buildProfessionalPresetFromLearnedProfile } from './learnedPresetBuilder';
import { compareCurrentDesignToLearnedCorpus } from './referenceDesignComparator';
import { generateReferenceLearningAppliedReport } from './referenceAppliedReportGenerator';
import { loadLearningState } from './referenceLearningState';
import { SAFE_APP_BOOT_MODE_V1, logBootError } from '@/lib/safeBoot';
import { referenceLearningAutoRun, referenceLearningEnabled } from '@/lib/emergencyStabilization';

/**
 * @param {object} ctx
 * @param {Array} ctx.currentCommands
 * @param {Array} ctx.currentRegions
 * @param {Array<object>} ctx.learnedProfiles
 * @param {Array<object>} ctx.learnedRules
 * @param {object} ctx.corpusSummary
 * @param {string} ctx.designName
 * @returns {object} application result
 */
export function applyLearnedProfileToProfessionalMode(ctx) {
  const { currentCommands, currentRegions, learnedProfiles, learnedRules, corpusSummary, designName } = ctx;

  // FASE 2 — seleccionar perfil
  const selection = selectBestLearnedProfileForCurrentDesign(currentRegions, currentCommands, learnedProfiles);
  if (!selection.selectedProfile) {
    return { error: 'No hay perfiles aprendidos para este diseño', selection, preset: null, comparison: null, report: null };
  }

  // FASE 4 — construir preset aprendido
  const preset = buildProfessionalPresetFromLearnedProfile(selection.selectedProfile, learnedRules);
  if (!preset) {
    return { error: 'No se pudo construir el preset', selection, preset: null, comparison: null, report: null };
  }

  // FASE 3 — comparar diseño actual contra corpus (antes de aplicar)
  const beforeComparison = compareCurrentDesignToLearnedCorpus(
    currentCommands, currentRegions, selection.selectedProfile, learnedRules, corpusSummary
  );

  // Mapear preset → config patch (learned* keys que consume applyProfessionalPipeline)
  const configPatch = presetToConfigPatch(preset);

  // FASE 5/7 — generar informe de aplicación
  const report = generateReferenceLearningAppliedReport({
    designName: designName || 'Diseño actual',
    selection,
    preset,
    configPatch,
    beforeComparison,
    corpusSummary,
    learnedRules,
  });

  return {
    selection,
    selectedProfile: selection.selectedProfile,
    preset,
    configPatch,
    beforeComparison,
    report,
  };
}

/**
 * Mapea el preset aprendido a las config keys que applyProfessionalPipeline lee.
 * Estas keys viajan en project.config y son aplicadas SOLO cuando professionalMode=true.
 */
/**
 * Auto-aplica el mejor perfil aprendido a un diseño recién generado.
 * Lee el conocimiento persistido en localStorage (sin requerir botón manual),
 * selecciona el perfil óptimo para las regiones actuales, construye el preset
 * y devuelve el configPatch + un diff de parámetros para mostrar en pantalla.
 *
 * @param {Array} regions — regiones generadas por el pipeline
 * @returns {object|null} { configPatch, selection, preset, diff } o null si no hay aprendizaje
 */
export function autoApplyLearnedProfileForDesign(regions, options = {}) {
  if (!referenceLearningEnabled || !referenceLearningAutoRun) {
    console.log('[REFERENCE_QUARANTINE] auto learned profile disabled');
    return null;
  }
  if (SAFE_APP_BOOT_MODE_V1 && !options.allowAutoApply) {
    console.log('[BOOT] reference learning skipped until manual run');
    return null;
  }
  try {
    const state = loadLearningState();
    if (!state || !state.learnedProfiles || state.learnedProfiles.length === 0) return null;
    const selection = selectBestLearnedProfileForCurrentDesign(regions || [], [], state.learnedProfiles);
    if (!selection.selectedProfile) return null;
    const preset = buildProfessionalPresetFromLearnedProfile(selection.selectedProfile, state.learnedRules || []);
    if (!preset) return null;
    const configPatch = presetToConfigPatch(preset);
    const diff = buildConfigDiff(configPatch);
    return { configPatch, selection, preset, diff };
  } catch (error) {
    logBootError(error);
    return null;
  }
}

/**
 * Construye un diff de parámetros (antes → después) para mostrar en pantalla.
 * Compara los valores por defecto del motor con los valores aprendidos.
 */
export function buildConfigDiff(configPatch) {
  const rows = [
    { label: 'Densidad de relleno (mm)', key: 'learnedFillDensityMm', before: 0.40, unit: 'mm', precision: 3 },
    { label: 'Ángulo de relleno (°)', key: 'learnedFillAngleDeg', before: 45, unit: '°', precision: 0 },
    { label: 'Variación ángulo vecino (°)', key: 'learnedNeighborAngleVariationDeg', before: 0, unit: '°', precision: 0 },
    { label: 'Espaciado satin (mm)', key: 'learnedSatinColumnSpacingMm', before: 0.40, unit: 'mm', precision: 3 },
    { label: 'Ancho satin (mm)', key: 'learnedSatinWidthMm', before: 1.20, unit: 'mm', precision: 2 },
    { label: 'Pull compensation (mm)', key: 'learnedPullCompensationMm', before: 0.30, unit: 'mm', precision: 2 },
    { label: 'Puntada visible máx. (mm)', key: 'learnedMaxVisibleStitchMm', before: 4.0, unit: 'mm', precision: 1 },
    { label: 'Colores máx.', key: 'learnedMaxColorCount', before: 8, unit: '', precision: 0 },
    { label: 'Travel→jump > (mm)', key: 'learnedConvertTravelAboveMmToJump', before: 6.0, unit: 'mm', precision: 1 },
    { label: 'Trim antes travel > (mm)', key: 'learnedTrimBeforeTravelMm', before: 0, unit: 'mm', precision: 1 },
    { label: 'Underlay', key: 'learnedUnderlayEnabled', before: false, unit: '', precision: 0, isBool: true },
    { label: 'Contorno tras relleno', key: 'learnedContourAfterFill', before: false, unit: '', precision: 0, isBool: true },
    { label: 'Reducir colores similares', key: 'learnedReduceSimilarColors', before: false, unit: '', precision: 0, isBool: true },
    { label: 'Satin contornos exteriores', key: 'learnedUseSatinForOuterContours', before: false, unit: '', precision: 0, isBool: true },
    { label: 'Detalles al final', key: 'learnedDetailsLast', before: false, unit: '', precision: 0, isBool: true },
    { label: 'Rango aceptado observado', key: 'learnedMachineAcceptedStitchRangeObserved', before: 12000, unit: ' stitches', precision: 0 },
    { label: 'Formato aceptado observado', key: 'learnedMachineAcceptedFormat', before: 'none', unit: '', precision: 0 },
    { label: 'No usar como límite estricto', key: 'learnedMachineAcceptedDoNotUseAsStrictLimit', before: false, unit: '', precision: 0, isBool: true },
  ];
  return rows.map(r => {
    const after = configPatch[r.key];
    return {
      ...r,
      after,
      changed: r.isBool ? (Boolean(after) !== Boolean(r.before)) : (after != null && Number(after) !== Number(r.before)),
    };
  }).filter(r => r.after != null);
}

export function presetToConfigPatch(preset) {
  if (!preset) return {};
  return {
    professionalMode: true,
    learnedFillDensityMm: preset.fillRowSpacingMm,
    learnedFillAngleDeg: preset.fillAngleDeg,
    learnedSatinColumnSpacingMm: preset.satinColumnSpacingMm,
    learnedSatinWidthMm: preset.satinWidthMm,
    learnedPullCompensationMm: preset.pullCompensationMm,
    learnedMaxVisibleStitchMm: preset.maxVisibleStitchMm,
    learnedMaxColorCount: preset.maxColorCount,
    // nuevas keys para travel + ángulo vecino
    learnedConvertTravelAboveMmToJump: preset.convertTravelAboveMmToJump,
    learnedTrimBeforeTravelMm: preset.trimBeforeTravelMm,
    learnedNeighborAngleVariationDeg: preset.neighborAngleVariationDeg,
    learnedContourAfterFill: preset.contourAfterFill,
    learnedUnderlayEnabled: preset.underlayEnabled,
    learnedReduceSimilarColors: preset.reduceSimilarColors,
    learnedUseSatinForOuterContours: preset.useSatinForOuterContours,
    learnedDetailsLast: preset.detailsLast,
    learnedMachineAcceptedStitchRangeMin: preset.learnedMachineAcceptedStitchRangeMin,
    learnedMachineAcceptedStitchRangeObserved: preset.learnedMachineAcceptedStitchRangeObserved,
    learnedMachineAcceptedFormat: preset.learnedMachineAcceptedFormat,
    learnedMachineAcceptedHoopSize: preset.learnedMachineAcceptedHoopSize,
    learnedMachineAcceptedDensityRange: preset.learnedMachineAcceptedDensityRange,
    learnedMachineAcceptedTrimRange: preset.learnedMachineAcceptedTrimRange,
    learnedMachineAcceptedColorCount: preset.learnedMachineAcceptedColorCount,
    learnedMachineAcceptedMaxStitchMm: preset.learnedMachineAcceptedMaxStitchMm,
    learnedMachineAcceptedMaxJumpMm: preset.learnedMachineAcceptedMaxJumpMm,
    learnedMachineAcceptedDoNotUseAsStrictLimit: preset.learnedMachineAcceptedDoNotUseAsStrictLimit ?? true,
    learnedProfileId: preset.sourceProfileId,
    learnedPresetSource: 'reference_learning_engine_v2',
  };
}