/**
 * acceptedMachineSamples.js — REFERENCE_LEARNING_ACCEPTED_WILCOM_SAMPLE_UPDATE_V1
 * Positive machine-accepted evidence used only by the learning layer.
 * It is not a strict limit, not an export blocker, and not a motor change.
 */

export const ACCEPTED_WILCOM_SAMPLE_V1 = {
  referenceType: 'accepted_machine_sample',
  source: 'Wilcom',
  machineAccepted: true,
  estimatedStitches: 33845,
  qualityLabel: 'GOOD_REFERENCE',
  format: 'DSB',
  machineProfile: 'CE01_observed_accepted',
  doNotUseAsStrictLimit: true,
  observedAcceptance: {
    stitchRangeMin: 0,
    stitchRangeObserved: 33845,
    stitchRangeStrictMax: null,
    old12000LimitIgnored: true,
    stitchCountPenaltyOnlyReason: false,
    warningOnlyCalibration: true,
  },
  learnedMetrics: {
    densityRange: { min: 0.2, max: 0.8, unit: 'mm_row_spacing', source: 'observed_reference_pending_exact_parse' },
    trimRange: { min: 0, max: 220, source: 'warning_calibration_not_blocking' },
    colorCount: { observed: null, source: 'parse_reference_file_for_exact_value' },
    hoopSize: { widthMm: 100, heightMm: 100, source: 'CE01_observed_accepted' },
    maxStitchMm: { observed: 12.1, source: 'format_safe_observed_warning_calibration' },
    maxJumpMm: { observed: 12.1, source: 'format_safe_observed_warning_calibration' },
    contourBehavior: 'accepted_reference_contours_should_calibrate_quality_not_block_export',
    fillContourRatio: { fill: null, contour: null, source: 'parse_reference_file_for_exact_value' },
    longJumpsAccepted: true,
    manyStitchesAccepted: true,
    colorOrder: [],
  },
};

export const ACCEPTED_MACHINE_SAMPLE_CONFIG_PATCH = {
  learnedMachineAcceptedStitchRangeMin: ACCEPTED_WILCOM_SAMPLE_V1.observedAcceptance.stitchRangeMin,
  learnedMachineAcceptedStitchRangeObserved: ACCEPTED_WILCOM_SAMPLE_V1.observedAcceptance.stitchRangeObserved,
  learnedMachineAcceptedFormat: ACCEPTED_WILCOM_SAMPLE_V1.format,
  learnedMachineAcceptedHoopSize: ACCEPTED_WILCOM_SAMPLE_V1.learnedMetrics.hoopSize,
  learnedMachineAcceptedDensityRange: ACCEPTED_WILCOM_SAMPLE_V1.learnedMetrics.densityRange,
  learnedMachineAcceptedTrimRange: ACCEPTED_WILCOM_SAMPLE_V1.learnedMetrics.trimRange,
  learnedMachineAcceptedColorCount: ACCEPTED_WILCOM_SAMPLE_V1.learnedMetrics.colorCount,
  learnedMachineAcceptedMaxStitchMm: ACCEPTED_WILCOM_SAMPLE_V1.learnedMetrics.maxStitchMm,
  learnedMachineAcceptedMaxJumpMm: ACCEPTED_WILCOM_SAMPLE_V1.learnedMetrics.maxJumpMm,
  learnedMachineAcceptedSource: ACCEPTED_WILCOM_SAMPLE_V1.source,
  learnedMachineAcceptedProfile: ACCEPTED_WILCOM_SAMPLE_V1.machineProfile,
  learnedMachineAcceptedDoNotUseAsStrictLimit: true,
};

export function getAcceptedMachineSamples() {
  return [ACCEPTED_WILCOM_SAMPLE_V1];
}

export function applyAcceptedMachineCalibrationToProfile(profile) {
  if (!profile) return profile;
  return {
    ...profile,
    acceptedMachineSample: ACCEPTED_WILCOM_SAMPLE_V1,
    ...ACCEPTED_MACHINE_SAMPLE_CONFIG_PATCH,
    stitchCountBlocking: false,
    old12000LimitBlocking: false,
  };
}