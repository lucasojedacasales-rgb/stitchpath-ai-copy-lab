const CATEGORIES = Object.freeze(['generic_woven', 'lightweight_woven', 'knit_stretch', 'heavy_woven', 'high_loft', 'custom']);
const STABILITIES = Object.freeze(['low', 'medium', 'high']);
const STRETCHES = Object.freeze(['none', 'low', 'medium', 'high']);
const THICKNESSES = Object.freeze(['light', 'medium', 'heavy']);
const SURFACES = Object.freeze(['flat', 'textured', 'high_loft']);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export const TECHNICAL_PLANNING_NUMERIC_DEFAULTS = deepFreeze({
  confidence: 0.75,
  tatami: { spacingMm: 0.45, targetStitchLengthMm: 3.2, minimumStitchLengthMm: 1, maximumStitchLengthMm: 4.5, edgeInsetMm: 0.4, staggerRatio: 0.5, minimumAreaMm2: 8, defaultAngleDegrees: 45 },
  satin: { spacingMm: 0.4, minimumWidthMm: 1, maximumWidthMm: 7, minimumSegmentLengthMm: 1, pullCompensationMm: 0.2, maximumWidthVariationRatio: 2.5, warningWidthVariationRatio: 1.6 },
  running: { targetStitchLengthMm: 2.2, minimumStitchLengthMm: 0.7, maximumStitchLengthMm: 3.2, defaultPasses: 1 },
  pullCompensation: { tatamiMm: 0.15, satinMm: 0.2, runningMm: 0, maximumMm: 0.6 },
  entryExit: { maximumCandidatesPerObject: 8, minimumCandidateSeparationMm: 0.5 },
  geometry: { thinAspectRatio: 4, veryThinAspectRatio: 8, smallAreaMm2: 8, largeAreaMm2: 300, minimumEffectiveAreaMm2: 0.01 },
  underlay: { edgeInsetMm: 0.8, latticeSpacingMm: 2.4, latticeCoverageRatio: 0.3, centerRunTargetStitchLengthMm: 2.5, zigzagSpacingMm: 1.8, wideSatinThresholdMm: 4 },
  profiles: { fastCandidateLimit: 4, balancedCandidateLimit: 8, detailedCandidateLimit: 12, parentAngleDifferenceDegrees: 90 },
});

export function createMaterialProfileV2(input = {}) {
  return deepFreeze({
    id: input.id ?? null,
    name: input.name ?? input.id ?? null,
    category: input.category ?? null,
    stability: input.stability ?? null,
    stretch: input.stretch ?? null,
    thickness: input.thickness ?? null,
    surface: input.surface ?? null,
    defaultTatamiSpacingMm: input.defaultTatamiSpacingMm,
    defaultSatinSpacingMm: input.defaultSatinSpacingMm,
    defaultRunningLengthMm: input.defaultRunningLengthMm,
    pullCompensationScale: input.pullCompensationScale,
    underlayScale: input.underlayScale,
    source: clone(input.source ?? null),
    metadata: clone(input.metadata ?? {}),
  });
}

const profile = input => createMaterialProfileV2({ ...input, source: { resolver: 'engineV2', certified: false }, metadata: { internalPlanningAssumption: true } });

export const BUILT_IN_MATERIAL_PROFILES = deepFreeze({
  generic_medium_woven: profile({ id: 'generic_medium_woven', name: 'Generic Medium Woven', category: 'generic_woven', stability: 'medium', stretch: 'low', thickness: 'medium', surface: 'flat', defaultTatamiSpacingMm: 0.45, defaultSatinSpacingMm: 0.4, defaultRunningLengthMm: 2.2, pullCompensationScale: 1, underlayScale: 1 }),
  lightweight_woven: profile({ id: 'lightweight_woven', name: 'Lightweight Woven', category: 'lightweight_woven', stability: 'low', stretch: 'low', thickness: 'light', surface: 'flat', defaultTatamiSpacingMm: 0.5, defaultSatinSpacingMm: 0.45, defaultRunningLengthMm: 2.4, pullCompensationScale: 0.8, underlayScale: 0.75 }),
  knit_stretch: profile({ id: 'knit_stretch', name: 'Knit Stretch', category: 'knit_stretch', stability: 'low', stretch: 'high', thickness: 'medium', surface: 'textured', defaultTatamiSpacingMm: 0.4, defaultSatinSpacingMm: 0.35, defaultRunningLengthMm: 2, pullCompensationScale: 1.35, underlayScale: 1.4 }),
  heavy_woven: profile({ id: 'heavy_woven', name: 'Heavy Woven', category: 'heavy_woven', stability: 'high', stretch: 'none', thickness: 'heavy', surface: 'textured', defaultTatamiSpacingMm: 0.42, defaultSatinSpacingMm: 0.38, defaultRunningLengthMm: 2.4, pullCompensationScale: 1.1, underlayScale: 1.15 }),
  high_loft: profile({ id: 'high_loft', name: 'High Loft', category: 'high_loft', stability: 'low', stretch: 'medium', thickness: 'heavy', surface: 'high_loft', defaultTatamiSpacingMm: 0.38, defaultSatinSpacingMm: 0.34, defaultRunningLengthMm: 2, pullCompensationScale: 1.4, underlayScale: 1.6 }),
});

export function validateMaterialProfileV2(profileValue) {
  const errors = [];
  const add = (code, path, message) => errors.push({ code, path, message });
  if (!profileValue || typeof profileValue !== 'object') return { valid: false, errors: [{ code: 'INVALID_MATERIAL_PROFILE', path: 'materialProfile', message: 'Material profile must be an object.' }], warnings: [] };
  if (typeof profileValue.id !== 'string' || !profileValue.id) add('MISSING_MATERIAL_PROFILE_ID', 'id', 'Material profile ID is required.');
  if (!CATEGORIES.includes(profileValue.category)) add('INVALID_MATERIAL_CATEGORY', 'category', 'Material category is invalid.');
  if (!STABILITIES.includes(profileValue.stability)) add('INVALID_MATERIAL_STABILITY', 'stability', 'Material stability is invalid.');
  if (!STRETCHES.includes(profileValue.stretch)) add('INVALID_MATERIAL_STRETCH', 'stretch', 'Material stretch is invalid.');
  if (!THICKNESSES.includes(profileValue.thickness)) add('INVALID_MATERIAL_THICKNESS', 'thickness', 'Material thickness is invalid.');
  if (!SURFACES.includes(profileValue.surface)) add('INVALID_MATERIAL_SURFACE', 'surface', 'Material surface is invalid.');
  ['defaultTatamiSpacingMm', 'defaultSatinSpacingMm', 'defaultRunningLengthMm', 'pullCompensationScale', 'underlayScale'].forEach(field => {
    if (!Number.isFinite(profileValue[field]) || profileValue[field] <= 0) add('INVALID_MATERIAL_NUMERIC_VALUE', field, `${field} must be a positive finite number.`);
  });
  if (!profileValue.metadata || typeof profileValue.metadata !== 'object' || Array.isArray(profileValue.metadata)) add('INVALID_MATERIAL_METADATA', 'metadata', 'Material metadata must be an object.');
  ['machineProfile', 'hoopLimits', 'encoder', 'ce01'].forEach(field => { if (Object.hasOwn(profileValue, field)) add('FORBIDDEN_MATERIAL_FIELD', field, `${field} is forbidden.`); });
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function resolveMaterialProfileV2(value = 'generic_medium_woven') {
  if (typeof value === 'string') return BUILT_IN_MATERIAL_PROFILES[value] ?? null;
  if (value && typeof value === 'object') {
    const custom = createMaterialProfileV2({ ...value, category: value.category ?? 'custom' });
    return validateMaterialProfileV2(custom).valid ? custom : null;
  }
  return null;
}

export const MATERIAL_PROFILE_CATEGORIES = CATEGORIES;
export const MATERIAL_STABILITIES = STABILITIES;
export const MATERIAL_STRETCHES = STRETCHES;
export const MATERIAL_THICKNESSES = THICKNESSES;
export const MATERIAL_SURFACES = SURFACES;
