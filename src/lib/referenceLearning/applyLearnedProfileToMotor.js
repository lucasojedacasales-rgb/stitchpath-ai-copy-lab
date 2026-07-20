/**
 * applyLearnedProfileToMotor.js — Reference Learning Engine v2 (FASE 7)
 * ─────────────────────────────────────────────────────────────────────────────
 * Converts a learned professional profile + applicable rules into a motor
 * configuration object that Professional Mode can consume.
 *
 * The resulting config is intentionally a subset — it only carries parameters
 * that influence generation (density, contour order, underlay, travel, color
 * reduction, satin/double-run usage). It never touches the DST/DSB encoder,
 * the CE01 validator or the universal detector.
 *
 * Applied ONLY in Professional Mode.
 */



/**
 * @param {object} profile — from generateLearnedProfiles (or findBestProfile)
 * @param {Array<object>} applicableRules — from referenceRetriever
 * @returns {object} motor config patch
 */
export function applyLearnedProfileToMotor(profile, applicableRules = []) {
  if (!profile) return DEFAULT_MOTOR_PATCH;
  const base = {
    fillDensity: profile.recommendedFillDensity ?? 0.08,
    fillDensityMm: profile.recommendedFillDensityMm ?? 0.4,
    fillAngleDeg: profile.recommendedFillAngleDeg ?? 0,
    satinDensity: profile.recommendedSatinDensity ?? 0.25,
    satinColumnSpacingMm: profile.recommendedSatinColumnSpacingMm ?? 0.4,
    pullCompensationMm: profile.recommendedPullCompensationMm ?? 0.2,
    runningStep: profile.recommendedRunningLength ?? 0,
    underlayEnabled: !!(profile.useUnderlayRules && profile.useUnderlayRules.largeFills),
    contourAfterFill: !!profile.contourAfterFill,
    maxVisibleStitchMm: profile.maxVisibleStitchMm ?? 2.5,
    trimLongTravels: !!(profile.travelRules && profile.travelRules.trimLongTravels),
    reduceSimilarColors: profile.reduceSimilarColors ?? true,
    useSatinForOuterContours: !!profile.useSatinForOuterContours,
    useDoubleRunForDetails: !!profile.useDoubleRunForDetails,
    maxColorCount: profile.maxColorCount ?? 8,
    layerOrderRules: profile.layerOrderRules || [],
  };

  // Override / refine from rules
  const ruleMap = Object.fromEntries(applicableRules.map(r => [r.ruleId, r]));
  if (ruleMap.J003_max_visible_stitch?.parameterRange?.ceiling) {
    const ceiling = parseFloat(ruleMap.J003_max_visible_stitch.parameterRange.ceiling);
    if (Number.isFinite(ceiling)) base.maxVisibleStitchMm = Math.min(base.maxVisibleStitchMm, ceiling);
  }
  if (ruleMap.L001_contour_after_fill && ruleMap.L001_contour_after_fill.confidence > 0.5) {
    base.contourAfterFill = true;
  }
  if (ruleMap.L003_underlay_before_fill && ruleMap.L003_underlay_before_fill.confidence > 0.5) {
    base.underlayEnabled = true;
  }
  if (ruleMap.J001_long_jumps_not_stitches && ruleMap.J001_long_jumps_not_stitches.confidence > 0.5) {
    base.trimLongTravels = true;
  }
  if (ruleMap.C002_satin_width?.parameterRange && profile.useSatinForOuterContours) {
    const w = parseFloat(ruleMap.C002_satin_width.parameterRange.mean);
    if (Number.isFinite(w)) base.satinWidthMm = w;
  }
  if (ruleMap.F002_fill_stitch_length?.parameterRange?.mean) {
    base.fillStitchLengthMm = parseFloat(ruleMap.F002_fill_stitch_length.parameterRange.mean);
  }
  // Density / angle / pull-compensation rules override the profile defaults when
  // the corpus yielded a confident mined value.
  if (ruleMap.D001_fill_row_spacing?.parameterRange?.median) {
    const v = parseFloat(ruleMap.D001_fill_row_spacing.parameterRange.median);
    if (Number.isFinite(v)) base.fillDensityMm = v;
  }
  if (ruleMap.D002_fill_angle?.parameterRange?.median) {
    const v = parseFloat(ruleMap.D002_fill_angle.parameterRange.median);
    if (Number.isFinite(v)) base.fillAngleDeg = v;
  }
  if (ruleMap.D003_satin_column_spacing?.parameterRange?.median) {
    const v = parseFloat(ruleMap.D003_satin_column_spacing.parameterRange.median);
    if (Number.isFinite(v)) base.satinColumnSpacingMm = v;
  }
  if (ruleMap.D004_pull_compensation?.parameterRange?.mean) {
    const v = parseFloat(ruleMap.D004_pull_compensation.parameterRange.mean);
    if (Number.isFinite(v)) base.pullCompensationMm = v;
  }

  return base;
}

export const DEFAULT_MOTOR_PATCH = {
  fillDensity: 0.08,
  fillDensityMm: 0.4,
  fillAngleDeg: 0,
  satinDensity: 0.25,
  satinColumnSpacingMm: 0.4,
  pullCompensationMm: 0.2,
  runningStep: 0,
  underlayEnabled: false,
  contourAfterFill: false,
  maxVisibleStitchMm: 2.5,
  trimLongTravels: false,
  reduceSimilarColors: true,
  useSatinForOuterContours: false,
  useDoubleRunForDetails: false,
  maxColorCount: 8,
  layerOrderRules: [],
};

/**
 * Merges a learned motor patch into an existing project config, only touching
 * the generation parameters (never export/CE01 flags).
 */
export function mergeLearnedConfig(existingConfig, patch) {
  return {
    ...existingConfig,
    learnedFillDensity: patch.fillDensity,
    learnedFillDensityMm: patch.fillDensityMm,
    learnedFillAngleDeg: patch.fillAngleDeg,
    learnedSatinDensity: patch.satinDensity,
    learnedSatinColumnSpacingMm: patch.satinColumnSpacingMm,
    learnedPullCompensationMm: patch.pullCompensationMm,
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
  };
}