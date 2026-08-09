export const ARTWORK_SEMANTIC_ROLES = Object.freeze([
  'background',
  'primary_shape',
  'secondary_shape',
  'internal_feature',
  'dark_mark',
  'highlight',
  'negative_space',
  'unknown',
]);

export const DEFAULT_SEMANTIC_ANALYSIS_OPTIONS = Object.freeze({
  minimumAcceptedConfidence: 0.72,
  minimumHighConfidence: 0.85,
  sourceEvidenceWeight: 0.38,
  topologyWeight: 0.25,
  geometryWeight: 0.20,
  colorWeight: 0.17,
  allowSourceRoleOverride: true,
});

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
  }
  return value;
}

function clamp(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function orderedUnique(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).filter(value => {
    if (typeof value !== 'string' || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function createSemanticRegionAssessmentV2(input = {}) {
  return {
    regionId: input.regionId ?? null,
    semanticRole: ARTWORK_SEMANTIC_ROLES.includes(input.semanticRole) ? input.semanticRole : 'unknown',
    semanticTags: orderedUnique(input.semanticTags),
    confidence: clamp(input.confidence),
    evidence: Array.isArray(input.evidence) ? input.evidence.map(cloneValue) : [],
    alternatives: Array.isArray(input.alternatives) ? input.alternatives.map(cloneValue) : [],
    needsReview: input.needsReview === true,
    sourceRole: input.sourceRole ?? null,
    sourceRoleTrusted: input.sourceRoleTrusted === true,
    colorFeatures: cloneValue(input.colorFeatures ?? {}),
    geometryFeatures: cloneValue(input.geometryFeatures ?? {}),
    topologyFeatures: cloneValue(input.topologyFeatures ?? {}),
  };
}

export function resolveSemanticAnalysisOptions(options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  const resolved = { ...DEFAULT_SEMANTIC_ANALYSIS_OPTIONS };
  Object.keys(DEFAULT_SEMANTIC_ANALYSIS_OPTIONS).forEach(key => {
    if (key === 'allowSourceRoleOverride') {
      if (typeof source[key] === 'boolean') resolved[key] = source[key];
    } else if (Number.isFinite(source[key])) {
      resolved[key] = source[key];
    }
  });
  const weightKeys = ['sourceEvidenceWeight', 'topologyWeight', 'geometryWeight', 'colorWeight'];
  const total = weightKeys.reduce((sum, key) => sum + Math.max(0, resolved[key]), 0);
  if (total > 0) weightKeys.forEach(key => { resolved[key] = Math.max(0, resolved[key]) / total; });
  return resolved;
}
