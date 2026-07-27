import { ARTWORK_SEMANTIC_ROLES, DEFAULT_SEMANTIC_ANALYSIS_OPTIONS } from './semanticRoleModel.js';

function issue(code, path, message) {
  return { code, path, message };
}

export function validateSemanticAnalyzerOptions(options = {}) {
  const errors = [];
  const source = options && typeof options === 'object' ? options : {};
  for (const field of ['minimumAcceptedConfidence', 'minimumHighConfidence']) {
    const value = source[field] ?? DEFAULT_SEMANTIC_ANALYSIS_OPTIONS[field];
    if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(issue('INVALID_CONFIDENCE_THRESHOLD', field, `${field} must be between 0 and 1.`));
  }
  const accepted = source.minimumAcceptedConfidence ?? DEFAULT_SEMANTIC_ANALYSIS_OPTIONS.minimumAcceptedConfidence;
  const high = source.minimumHighConfidence ?? DEFAULT_SEMANTIC_ANALYSIS_OPTIONS.minimumHighConfidence;
  if (Number.isFinite(accepted) && Number.isFinite(high) && accepted > high) errors.push(issue('INVALID_CONFIDENCE_ORDER', 'minimumAcceptedConfidence', 'Accepted confidence cannot exceed high confidence.'));
  const weights = ['sourceEvidenceWeight', 'topologyWeight', 'geometryWeight', 'colorWeight']
    .map(field => ({ field, value: source[field] ?? DEFAULT_SEMANTIC_ANALYSIS_OPTIONS[field] }));
  weights.forEach(({ field, value }) => {
    if (!Number.isFinite(value) || value < 0) errors.push(issue('INVALID_SEMANTIC_WEIGHT', field, `${field} must be a non-negative finite number.`));
  });
  if (weights.every(({ value }) => Number.isFinite(value)) && weights.reduce((sum, item) => sum + item.value, 0) <= 0) {
    errors.push(issue('ZERO_SEMANTIC_WEIGHT_TOTAL', 'weights', 'Semantic weights must have a positive total.'));
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function validateSemanticRegionAssessmentV2(assessment) {
  const errors = [];
  if (!assessment || typeof assessment !== 'object') return { valid: false, errors: [issue('INVALID_ASSESSMENT', 'assessment', 'Assessment must be an object.')], warnings: [] };
  if (typeof assessment.regionId !== 'string' || !assessment.regionId) errors.push(issue('MISSING_ASSESSMENT_REGION', 'regionId', 'Assessment regionId is required.'));
  if (!ARTWORK_SEMANTIC_ROLES.includes(assessment.semanticRole)) errors.push(issue('INVALID_SEMANTIC_ROLE', 'semanticRole', `Invalid semantic role "${assessment.semanticRole}".`));
  if (!Number.isFinite(assessment.confidence) || assessment.confidence < 0 || assessment.confidence > 1) errors.push(issue('INVALID_SEMANTIC_CONFIDENCE', 'confidence', 'Confidence must be between 0 and 1.'));
  if (!Array.isArray(assessment.semanticTags)) errors.push(issue('INVALID_SEMANTIC_TAGS', 'semanticTags', 'semanticTags must be an array.'));
  else if (new Set(assessment.semanticTags).size !== assessment.semanticTags.length) errors.push(issue('DUPLICATE_SEMANTIC_TAG', 'semanticTags', 'semanticTags must be unique.'));
  if (!Array.isArray(assessment.evidence) || assessment.evidence.some(item => !item || typeof item !== 'object' || typeof item.code !== 'string' || typeof item.message !== 'string')) {
    errors.push(issue('MALFORMED_SEMANTIC_EVIDENCE', 'evidence', 'Evidence entries require code and message strings.'));
  }
  if (!Array.isArray(assessment.alternatives)) errors.push(issue('INVALID_ALTERNATIVES', 'alternatives', 'alternatives must be an array.'));
  else assessment.alternatives.forEach((alternative, index) => {
    if (!ARTWORK_SEMANTIC_ROLES.includes(alternative?.role)) errors.push(issue('INVALID_ALTERNATIVE_ROLE', `alternatives[${index}].role`, 'Alternative role is invalid.'));
    if (!Number.isFinite(alternative?.score) || alternative.score < 0 || alternative.score > 1) errors.push(issue('INVALID_ALTERNATIVE_SCORE', `alternatives[${index}].score`, 'Alternative score must be between 0 and 1.'));
  });
  if (assessment.semanticRole === 'negative_space' && !assessment.evidence?.some(item => item.code === 'EXPLICIT_NEGATIVE_SPACE')) {
    errors.push(issue('NEGATIVE_SPACE_WITHOUT_EXPLICIT_EVIDENCE', 'semanticRole', 'negative_space requires explicit evidence.'));
  }
  if (assessment.sourceRole && assessment.sourceRole !== 'unknown' && assessment.sourceRole !== assessment.semanticRole
    && !assessment.evidence?.some(item => item.code === 'SOURCE_ROLE_CONSIDERED')) {
    errors.push(issue('SOURCE_ROLE_OVERWRITTEN_WITHOUT_RECORD', 'sourceRole', 'Source role changes must be recorded in evidence.'));
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function validateSemanticAnalysisResult(result, regions = [], graph) {
  const errors = [];
  const warnings = [];
  if (!result || typeof result !== 'object' || !Array.isArray(result.assessments)) {
    return { valid: false, errors: [issue('INVALID_SEMANTIC_RESULT', 'result', 'Semantic result requires an assessments array.')], warnings };
  }
  const regionIds = new Set((Array.isArray(regions) ? regions : []).map(region => region.id));
  const assessmentIds = result.assessments.map(item => item?.regionId);
  if (new Set(assessmentIds).size !== assessmentIds.length) errors.push(issue('DUPLICATE_ASSESSMENT_REGION', 'assessments', 'Each region may have only one assessment.'));
  result.assessments.forEach((assessment, index) => {
    const validation = validateSemanticRegionAssessmentV2(assessment);
    errors.push(...validation.errors.map(item => ({ ...item, path: `assessments[${index}].${item.path}` })));
    if (assessment?.regionId && !regionIds.has(assessment.regionId)) errors.push(issue('ASSESSMENT_UNKNOWN_REGION', `assessments[${index}].regionId`, `Unknown region "${assessment.regionId}".`));
    if (assessment?.regionId && graph && !graph.nodes?.[assessment.regionId]) errors.push(issue('GRAPH_ASSESSMENT_MISMATCH', `assessments[${index}].regionId`, 'Assessment region is missing from graph.'));
  });
  regionIds.forEach(regionId => {
    if (!assessmentIds.includes(regionId)) errors.push(issue('MISSING_REGION_ASSESSMENT', 'assessments', `Missing assessment for region "${regionId}".`));
  });
  if (result.metadata?.mutationsDetected === true) errors.push(issue('INPUT_REGION_MUTATION', 'metadata.mutationsDetected', 'Semantic analysis mutated input regions.'));
  return { valid: errors.length === 0, errors, warnings };
}
