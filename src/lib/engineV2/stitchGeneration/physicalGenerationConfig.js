export const PHYSICAL_GENERATION_PROFILES = Object.freeze(['fast', 'balanced', 'detailed']);
export const DEFAULT_PHYSICAL_GENERATION_CONFIG = Object.freeze({
  profile: 'balanced', coordinatePrecisionDecimals: 6, comparisonToleranceMm: 0.000001, boundaryToleranceMm: 0.001,
  includePhysicalUnderlay: true, includeTopStitches: true, preserveSelectedEntryExit: true, preserveGlobalSequence: true,
  preserveThreadBlocks: true, allowCompensationOutsideOuterBoundary: true, maximumCompensationEnvelopeMm: 0.6,
  maximumPointsPerObject: 500000, maximumTotalPoints: 2000000, maximumScanlinesPerObject: 100000,
  maximumClosedRunningOverlapRatio: 0.35, blockUnsupportedGeometry: true, blockGeneratorFailure: true,
  blockPointLimitExceeded: true, generateCanonicalCommands: false, generateJumpCommands: false, generateTrimCommands: false,
  generateColorChangeCommands: false, machineAdaptation: false, encoding: false, conservativeMode: true,
  experimentalPhysicalMmStitchLengthInvariant: true,
});
const PROFILE_OVERRIDES = Object.freeze({ fast: { coordinatePrecisionDecimals: 5 }, balanced: {}, detailed: { coordinatePrecisionDecimals: 7 } });

export function resolvePhysicalGenerationConfig(input = {}) {
  const profile = PHYSICAL_GENERATION_PROFILES.includes(input.profile) ? input.profile : DEFAULT_PHYSICAL_GENERATION_CONFIG.profile;
  const known = new Set(Object.keys(DEFAULT_PHYSICAL_GENERATION_CONFIG));
  return Object.freeze({ ...DEFAULT_PHYSICAL_GENERATION_CONFIG, ...PROFILE_OVERRIDES[profile], ...Object.fromEntries(Object.entries(input).filter(([key]) => known.has(key))), profile, extras: Object.freeze(Object.fromEntries(Object.entries(input).filter(([key]) => !known.has(key)))) });
}

export function validatePhysicalGenerationConfig(config) {
  const errors = [];
  if (!PHYSICAL_GENERATION_PROFILES.includes(config?.profile)) errors.push({ code: 'INVALID_PHYSICAL_GENERATION_PROFILE', path: 'profile', message: 'Unknown physical generation profile.' });
  ['coordinatePrecisionDecimals', 'maximumPointsPerObject', 'maximumTotalPoints', 'maximumScanlinesPerObject'].forEach(field => { if (!Number.isInteger(config?.[field]) || config[field] <= 0) errors.push({ code: 'INVALID_PHYSICAL_GENERATION_LIMIT', path: field, message: `${field} must be a positive integer.` }); });
  ['comparisonToleranceMm', 'boundaryToleranceMm', 'maximumCompensationEnvelopeMm', 'maximumClosedRunningOverlapRatio'].forEach(field => { if (!Number.isFinite(config?.[field]) || config[field] <= 0) errors.push({ code: 'INVALID_PHYSICAL_GENERATION_VALUE', path: field, message: `${field} must be positive and finite.` }); });
  if (typeof config?.experimentalPhysicalMmStitchLengthInvariant !== 'boolean') errors.push({ code: 'INVALID_EXPERIMENTAL_FEATURE_FLAG', path: 'experimentalPhysicalMmStitchLengthInvariant', message: 'Experimental physical-mm stitch-length invariant flag must be boolean.' });
  if (config?.generateCanonicalCommands || config?.generateJumpCommands || config?.generateTrimCommands || config?.generateColorChangeCommands || config?.machineAdaptation || config?.encoding) errors.push({ code: 'PHASE_9_COMMAND_OR_MACHINE_OUTPUT_FORBIDDEN', path: 'config', message: 'Phase 9 cannot create commands, machine adaptation, or encoding.' });
  return { valid: errors.length === 0, errors, warnings: [] };
}
