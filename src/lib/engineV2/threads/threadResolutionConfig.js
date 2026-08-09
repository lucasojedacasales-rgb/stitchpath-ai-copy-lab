const POLICIES = Object.freeze(['artwork_exact', 'catalog_exact', 'catalog_nearest']);
const FORMULAS = Object.freeze(['cie76', 'ciede2000']);

export const DEFAULT_THREAD_RESOLUTION_CONFIG = Object.freeze({
  policy: 'artwork_exact',
  catalog: Object.freeze([]),
  colorDifferenceFormula: 'ciede2000',
  maximumAcceptedDeltaE: 6,
  shareIdenticalArtworkColors: true,
  preserveVisualColorSamples: true,
  blockInvalidArtworkColors: true,
  blockOutOfToleranceMatches: true,
  blockOnUnassignedDependency: true,
  deterministicTieBreak: 'deltaE_then_catalog_id',
  conservativeMode: true,
});

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  return value;
}

export function resolveThreadResolutionConfig(input = {}) {
  const known = new Set(Object.keys(DEFAULT_THREAD_RESOLUTION_CONFIG));
  const extras = Object.fromEntries(Object.entries(input || {}).filter(([key]) => !known.has(key)).map(([key, value]) => [key, clone(value)]));
  return { ...DEFAULT_THREAD_RESOLUTION_CONFIG, ...clone(input || {}), catalog: clone(input?.catalog ?? []), extras };
}

export function validateThreadResolutionConfig(input = {}) {
  const config = resolveThreadResolutionConfig(input);
  const errors = [];
  if (!POLICIES.includes(config.policy)) errors.push({ code: 'INVALID_THREAD_RESOLUTION_POLICY', path: 'policy', message: `Unsupported thread resolution policy: ${String(config.policy)}.` });
  if (!FORMULAS.includes(config.colorDifferenceFormula)) errors.push({ code: 'INVALID_COLOR_DIFFERENCE_FORMULA', path: 'colorDifferenceFormula', message: 'Color difference formula must be cie76 or ciede2000.' });
  if (!Number.isFinite(config.maximumAcceptedDeltaE) || config.maximumAcceptedDeltaE < 0) errors.push({ code: 'INVALID_MAXIMUM_DELTA_E', path: 'maximumAcceptedDeltaE', message: 'maximumAcceptedDeltaE must be a non-negative finite number.' });
  if (['catalog_exact', 'catalog_nearest'].includes(config.policy) && (!Array.isArray(config.catalog) || config.catalog.length === 0)) errors.push({ code: 'THREAD_CATALOG_REQUIRED', path: 'catalog', message: `${config.policy} requires a non-empty explicit catalog.` });
  if (config.deterministicTieBreak !== 'deltaE_then_catalog_id') errors.push({ code: 'INVALID_TIE_BREAK', path: 'deterministicTieBreak', message: 'Only deltaE_then_catalog_id is supported.' });
  return { valid: errors.length === 0, errors, warnings: [], config };
}

export const THREAD_RESOLUTION_POLICIES = POLICIES;
export const COLOR_DIFFERENCE_FORMULAS = FORMULAS;
