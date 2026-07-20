export const GENERIC_MACHINE = {
  id: 'generic', label: 'Generic embroidery machine', hoopSize: [100, 100], maxColorsWarning: 12,
  stitchWarning: 35000, stitchHighRisk: 50000, trimWarning: 120, jumpWarning: 350, maxStitchMm: 12.1, maxJumpMm: 12.1,
};

export const CE01_PROFILE = {
  id: 'ce01', label: 'Caydo CE01', hoopSize: [100, 100], maxColorsWarning: 6,
  stitchWarning: 35000, stitchHighRisk: 50000, trimWarning: 80, jumpWarning: 250, maxStitchMm: 12.1, maxJumpMm: 12.1,
};

export const WILCOM_REFERENCE_PROFILE = {
  id: 'wilcom_reference', label: 'Wilcom accepted reference', hoopSize: [100, 100], maxColorsWarning: 12,
  stitchWarning: 35000, stitchHighRisk: 50000, trimWarning: 150, jumpWarning: 500, maxStitchMm: 12.1, maxJumpMm: 12.1,
  referenceAcceptedStitches: 33845,
};

export const FUTURE_MACHINE_PROFILE = {
  id: 'future_machine', label: 'Future machine profile', hoopSize: [100, 100], maxColorsWarning: 12,
  stitchWarning: 35000, stitchHighRisk: 50000, trimWarning: 120, jumpWarning: 350, maxStitchMm: 12.1, maxJumpMm: 12.1,
};

export const MACHINE_PROFILES = { GENERIC_MACHINE, CE01_PROFILE, WILCOM_REFERENCE_PROFILE, FUTURE_MACHINE_PROFILE };

export function getMachineProfile(profile = 'GENERIC_MACHINE') {
  return MACHINE_PROFILES[profile] || GENERIC_MACHINE;
}