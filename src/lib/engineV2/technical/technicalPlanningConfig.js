import { BUILT_IN_MATERIAL_PROFILES, TECHNICAL_PLANNING_NUMERIC_DEFAULTS, resolveMaterialProfileV2, validateMaterialProfileV2 } from './materialProfileModel.js';

const PROFILES = Object.freeze(['fast', 'balanced', 'detailed']);
const clone = value => Array.isArray(value) ? value.map(clone) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)])) : value;

export const DEFAULT_TECHNICAL_PLANNING_CONFIG = Object.freeze({
  profile: 'balanced',
  materialProfile: 'generic_medium_woven',
  minimumAutomaticConfidence: TECHNICAL_PLANNING_NUMERIC_DEFAULTS.confidence,
  blockInvalidGeometry: true,
  blockIncompatibleStitchType: true,
  allowManualSpecifications: false,
  tatami: Object.freeze({ ...TECHNICAL_PLANNING_NUMERIC_DEFAULTS.tatami }),
  satin: Object.freeze({ ...TECHNICAL_PLANNING_NUMERIC_DEFAULTS.satin }),
  running: Object.freeze({ ...TECHNICAL_PLANNING_NUMERIC_DEFAULTS.running }),
  pullCompensation: Object.freeze({ enabled: true, ...TECHNICAL_PLANNING_NUMERIC_DEFAULTS.pullCompensation, axisAware: true }),
  entryExit: Object.freeze({ maximumCandidatesPerObject: TECHNICAL_PLANNING_NUMERIC_DEFAULTS.entryExit.maximumCandidatesPerObject, includeBoundaryVertices: true, includeCardinalBoundaryPoints: true, includeValidInteriorCandidate: true, rejectCandidatesInsideHoles: true, minimumCandidateSeparationMm: TECHNICAL_PLANNING_NUMERIC_DEFAULTS.entryExit.minimumCandidateSeparationMm }),
  geometryAnalysis: Object.freeze({ ...TECHNICAL_PLANNING_NUMERIC_DEFAULTS.geometry }),
  underlay: Object.freeze({ ...TECHNICAL_PLANNING_NUMERIC_DEFAULTS.underlay }),
  generatePhysicalStitches: false,
  generatePhysicalUnderlay: false,
  selectFinalEntryExitPair: false,
  globalSequencing: false,
  travelOptimization: false,
  machineAdaptation: false,
  conservativeMode: true,
});

function merge(base, input) {
  const output = clone(base);
  Object.entries(input || {}).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])) output[key] = merge(output[key], value);
    else output[key] = clone(value);
  });
  return output;
}

export function resolveTechnicalPlanningConfig(input = {}) {
  const known = new Set(Object.keys(DEFAULT_TECHNICAL_PLANNING_CONFIG));
  const extras = Object.fromEntries(Object.entries(input || {}).filter(([key]) => !known.has(key)).map(([key, value]) => [key, clone(value)]));
  const requestedProfile = input?.profile ?? DEFAULT_TECHNICAL_PLANNING_CONFIG.profile;
  const profile = PROFILES.includes(requestedProfile) ? requestedProfile : 'balanced';
  const recognizedInput = Object.fromEntries(Object.entries(input || {}).filter(([key]) => known.has(key)));
  const resolved = merge(DEFAULT_TECHNICAL_PLANNING_CONFIG, { ...recognizedInput, profile });
  if (!input?.entryExit || !Object.hasOwn(input.entryExit, 'maximumCandidatesPerObject')) {
    resolved.entryExit.maximumCandidatesPerObject = profile === 'fast' ? TECHNICAL_PLANNING_NUMERIC_DEFAULTS.profiles.fastCandidateLimit : profile === 'detailed' ? TECHNICAL_PLANNING_NUMERIC_DEFAULTS.profiles.detailedCandidateLimit : TECHNICAL_PLANNING_NUMERIC_DEFAULTS.profiles.balancedCandidateLimit;
  }
  return { ...resolved, requestedProfile, profileFallbackApplied: requestedProfile !== profile, extras };
}

function numericErrors(config, errors) {
  const paths = [
    ['minimumAutomaticConfidence', config.minimumAutomaticConfidence],
    ...['spacingMm', 'targetStitchLengthMm', 'minimumStitchLengthMm', 'maximumStitchLengthMm', 'edgeInsetMm', 'staggerRatio', 'minimumAreaMm2'].map(key => [`tatami.${key}`, config.tatami?.[key]]),
    ...['spacingMm', 'minimumWidthMm', 'maximumWidthMm', 'minimumSegmentLengthMm', 'pullCompensationMm'].map(key => [`satin.${key}`, config.satin?.[key]]),
    ...['targetStitchLengthMm', 'minimumStitchLengthMm', 'maximumStitchLengthMm', 'defaultPasses'].map(key => [`running.${key}`, config.running?.[key]]),
    ...['tatamiMm', 'satinMm', 'runningMm', 'maximumMm'].map(key => [`pullCompensation.${key}`, config.pullCompensation?.[key]]),
    ['entryExit.maximumCandidatesPerObject', config.entryExit?.maximumCandidatesPerObject],
    ['entryExit.minimumCandidateSeparationMm', config.entryExit?.minimumCandidateSeparationMm],
  ];
  paths.forEach(([path, value]) => { if (!Number.isFinite(value) || value < 0) errors.push({ code: 'INVALID_TECHNICAL_NUMERIC_VALUE', path, message: `${path} must be a non-negative finite number.` }); });
}

export function validateTechnicalPlanningConfig(input = {}) {
  const raw = input || {};
  const config = resolveTechnicalPlanningConfig(raw);
  const errors = [];
  const known = new Set(Object.keys(DEFAULT_TECHNICAL_PLANNING_CONFIG));
  if (raw.profile !== undefined && !PROFILES.includes(raw.profile)) errors.push({ code: 'INVALID_TECHNICAL_PROFILE', path: 'profile', message: 'Technical profile must be fast, balanced, or detailed.' });
  Object.keys(raw).filter(key => !known.has(key) && !['requestedProfile', 'profileFallbackApplied', 'extras'].includes(key)).forEach(key => errors.push({ code: 'UNSUPPORTED_TECHNICAL_CONFIG_FIELD', path: key, message: `Unsupported root field "${key}" was moved to extras.` }));
  const material = resolveMaterialProfileV2(raw.materialProfile ?? config.materialProfile);
  if (!material) errors.push({ code: typeof raw.materialProfile === 'string' ? 'UNKNOWN_MATERIAL_PROFILE' : 'INVALID_CUSTOM_MATERIAL_PROFILE', path: 'materialProfile', message: 'Material profile is unknown or invalid.' });
  else errors.push(...validateMaterialProfileV2(material).errors.map(item => ({ ...item, path: `materialProfile.${item.path}` })));
  numericErrors(config, errors);
  if (config.minimumAutomaticConfidence < 0 || config.minimumAutomaticConfidence > 1) errors.push({ code: 'INVALID_TECHNICAL_CONFIDENCE', path: 'minimumAutomaticConfidence', message: 'Confidence must be between 0 and 1.' });
  [['tatami', config.tatami], ['running', config.running]].forEach(([name, values]) => { if (values?.minimumStitchLengthMm > values?.maximumStitchLengthMm) errors.push({ code: 'INVALID_STITCH_LENGTH_RANGE', path: name, message: `${name} minimum stitch length exceeds maximum.` }); });
  if (config.satin?.minimumWidthMm > config.satin?.maximumWidthMm) errors.push({ code: 'INVALID_SATIN_WIDTH_RANGE', path: 'satin', message: 'Satin minimum width exceeds maximum.' });
  ['generatePhysicalStitches', 'generatePhysicalUnderlay', 'selectFinalEntryExitPair', 'globalSequencing', 'travelOptimization', 'machineAdaptation'].forEach(field => { if (config[field] === true) errors.push({ code: 'FORBIDDEN_TECHNICAL_STAGE_ENABLEMENT', path: field, message: `${field} cannot be enabled in Phase 7.` }); });
  return { valid: errors.length === 0, errors, warnings: config.profileFallbackApplied ? [{ code: 'TECHNICAL_PROFILE_FALLBACK', path: 'profile', message: `Unknown profile "${config.requestedProfile}" fell back to balanced.` }] : [], config, materialProfile: material };
}

export const TECHNICAL_PLANNING_PROFILES = PROFILES;
export { BUILT_IN_MATERIAL_PROFILES };
