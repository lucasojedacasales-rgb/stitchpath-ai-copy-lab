/**
 * learnedPresetBuilder.js — Reference Learning Engine v2 (FASE 4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Construye un preset profesional real a partir del perfil seleccionado y las
 * reglas aprendidas, usando los valores minados del corpus (densidad, ángulo,
 * compensación) y corrigiendo outliers (maxVisibleStitchMm nunca > 3.5mm inicial).
 *
 * El preset es consumido por Professional Mode (applyProfessionalPipeline).
 */

/**
 * @param {object} selectedProfile — from selectBestLearnedProfileForCurrentDesign
 * @param {Array<object>} learnedRules — from mineProfessionalRules
 * @returns {object} learned preset
 */
export function buildProfessionalPresetFromLearnedProfile(selectedProfile, learnedRules) {
  if (!selectedProfile) return null;
  const rules = Array.isArray(learnedRules) ? learnedRules : [];
  const ruleMap = Object.fromEntries(rules.map(r => [r.ruleId, r]));

  // ── Valores por defecto profesionales seguros ──
  const preset = {
    sourceProfileId: selectedProfile.name,
    sourceCorpusFiles: selectedProfile.matchedFiles || [],
    fillRowSpacingMm: 0.4,
    satinColumnSpacingMm: 0.3,
    satinWidthMm: 1.2,
    pullCompensationMm: 0.3,
    fillAngleDeg: 45,
    neighborAngleVariationDeg: 41,
    maxVisibleStitchMm: 3.5,
    trimBeforeTravelMm: 3.5,
    convertTravelAboveMmToJump: 6.0,
    underlayEnabled: !!(selectedProfile.useUnderlayRules && selectedProfile.useUnderlayRules.largeFills),
    contourAfterFill: !!selectedProfile.contourAfterFill,
    detailsLast: true,
    reduceSimilarColors: selectedProfile.reduceSimilarColors ?? true,
    maxColorCount: selectedProfile.maxColorCount ?? 8,
    useSatinForOuterContours: !!selectedProfile.useSatinForOuterContours,
    useRunningForDetails: !selectedProfile.useDoubleRunForDetails,
    learnedMachineAcceptedStitchRangeMin: selectedProfile.learnedMachineAcceptedStitchRangeMin,
    learnedMachineAcceptedStitchRangeObserved: selectedProfile.learnedMachineAcceptedStitchRangeObserved,
    learnedMachineAcceptedFormat: selectedProfile.learnedMachineAcceptedFormat,
    learnedMachineAcceptedHoopSize: selectedProfile.learnedMachineAcceptedHoopSize,
    learnedMachineAcceptedDensityRange: selectedProfile.learnedMachineAcceptedDensityRange,
    learnedMachineAcceptedTrimRange: selectedProfile.learnedMachineAcceptedTrimRange,
    learnedMachineAcceptedColorCount: selectedProfile.learnedMachineAcceptedColorCount,
    learnedMachineAcceptedMaxStitchMm: selectedProfile.learnedMachineAcceptedMaxStitchMm,
    learnedMachineAcceptedMaxJumpMm: selectedProfile.learnedMachineAcceptedMaxJumpMm,
    learnedMachineAcceptedDoNotUseAsStrictLimit: selectedProfile.learnedMachineAcceptedDoNotUseAsStrictLimit ?? true,
  };

  // ── Sobreescribir con valores minados del corpus (alta confianza) ──
  if (ruleMap.D001_fill_row_spacing?.parameterRange?.median) {
    preset.fillRowSpacingMm = clamp(parseFloat(ruleMap.D001_fill_row_spacing.parameterRange.median), 0.2, 0.8);
  }
  if (ruleMap.D002_fill_angle?.parameterRange?.median) {
    preset.fillAngleDeg = parseFloat(ruleMap.D002_fill_angle.parameterRange.median);
  }
  if (ruleMap.D003_satin_column_spacing?.parameterRange?.median) {
    preset.satinColumnSpacingMm = clamp(parseFloat(ruleMap.D003_satin_column_spacing.parameterRange.median), 0.15, 0.6);
  }
  if (ruleMap.D004_pull_compensation?.parameterRange?.mean) {
    preset.pullCompensationMm = clamp(parseFloat(ruleMap.D004_pull_compensation.parameterRange.mean), 0.1, 0.6);
  }
  if (ruleMap.F003_angle_variance_neighbors?.parameterRange?.mean) {
    preset.neighborAngleVariationDeg = parseFloat(ruleMap.F003_angle_variance_neighbors.parameterRange.mean);
  }
  if (ruleMap.C002_satin_width?.parameterRange?.mean) {
    preset.satinWidthMm = clamp(parseFloat(ruleMap.C002_satin_width.parameterRange.mean), 0.8, 3.0);
  }

  // ── J003 — max visible stitch: NUNCA usar el valor raw del corpus si es irreal ──
  // El minero ya clampea a [2.5, 6.0], pero el preset profesional usa 3.5mm como techo
  // inicial seguro. Solo sube si el corpus dice claramente más y es coherente.
  if (ruleMap.J003_max_visible_stitch?.parameterRange?.ceiling) {
    const ceiling = parseFloat(ruleMap.J003_max_visible_stitch.parameterRange.ceiling);
    if (Number.isFinite(ceiling) && ceiling >= 2.5 && ceiling <= 4.5) {
      preset.maxVisibleStitchMm = ceiling;
    }
  }

  // ── Reglas de capa con alta confianza ──
  if (ruleMap.L001_contour_after_fill?.confidence > 0.5) preset.contourAfterFill = true;
  if (ruleMap.L002_details_at_end?.confidence > 0.5) preset.detailsLast = true;
  if (ruleMap.L003_underlay_before_fill?.confidence > 0.5) preset.underlayEnabled = true;
  if (ruleMap.J001_long_jumps_not_stitches?.confidence > 0.5) {
    preset.convertTravelAboveMmToJump = 6.0;
  }
  if (ruleMap.J002_trim_before_long_travel?.confidence > 0.5) {
    preset.trimBeforeTravelMm = 3.5;
  }

  return preset;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }