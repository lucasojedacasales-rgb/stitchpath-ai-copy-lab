import { analyzeSourceSemanticEvidence } from '../semantics/sourceSemanticEvidence.js';

const FACIAL_CONCEPT_TOKENS = new Set(['eye', 'eyes', 'pupil', 'mouth', 'nose', 'nostril', 'cheek', 'ojo', 'ojos', 'pupila', 'pupilas', 'boca', 'nariz', 'fosa', 'fosas', 'mejilla', 'mejillas']);

function normalizedTokens(sourceEvidence) {
  return new Set((sourceEvidence?.controlledMatches || []).flatMap(item => item.normalizedToken.split(' ')));
}

export function evaluateOutlineEligibility({
  region, graph, semanticAssessment, sourceEvidence: suppliedSourceEvidence,
  colorFeatures = {}, geometryFeatures = {}, config,
}) {
  const sourceEvidence = suppliedSourceEvidence || analyzeSourceSemanticEvidence(region);
  const outlineEvidence = sourceEvidence.outlineIntentEvidence || sourceEvidence.controlledMatches?.filter(item => item.concept === 'outline_intent') || [];
  const outlineTokens = outlineEvidence.map(item => item.normalizedToken);
  const innerIntent = outlineTokens.some(token => token === 'inner outline' || token === 'inner border' || token === 'contorno interior');
  const explicitOutlineEvidence = outlineEvidence.length > 0;
  const darkColorEvidence = colorFeatures.isDark === true || colorFeatures.isVeryDark === true;
  const darkStrokeSupportAvailable = region?.darkStrokeSupport?.available === true;
  const darkStrokeSupportRatio = Number.isFinite(region?.darkStrokeSupport?.ratio) ? region.darkStrokeSupport.ratio : 0;
  const node = graph?.nodes?.[region?.id];
  const hasNestedRelationship = Boolean(node?.parentId);
  const hasShapeRelationship = hasNestedRelationship || (node?.containedRegionIds?.length || 0) > 0 || (node?.touchingRegionIds?.length || 0) > 0;
  const boundaryRelationshipSupported = innerIntent ? hasNestedRelationship : hasShapeRelationship;
  const sourceGenerated = region?.source?.generatedFromFillBoundary === true
    || region?.source?.synthetic === true
    || region?.source?.originalSource?.generatedFromFillBoundary === true
    || region?.source?.originalSource?.synthetic === true;
  const regionBackedGeometry = Array.isArray(region?.geometry) && region.geometry.length >= 3 && !sourceGenerated;
  const facialEvidence = semanticAssessment?.semanticRole === 'internal_feature'
    || [...normalizedTokens(sourceEvidence)].some(token => FACIAL_CONCEPT_TOKENS.has(token));
  const semanticConflict = (sourceEvidence?.conflicts?.length || 0) > 0;
  const confidence = Math.min(
    Number.isFinite(semanticAssessment?.confidence) ? semanticAssessment.confidence : 0,
    darkStrokeSupportAvailable ? darkStrokeSupportRatio : 0,
  );
  const rejectedReasons = [];
  if (config?.allowExplicitOutlineRegions !== true) rejectedReasons.push('explicit_outline_regions_disabled');
  if (!explicitOutlineEvidence) rejectedReasons.push('missing_explicit_outline_intent');
  if (!regionBackedGeometry) rejectedReasons.push('missing_region_backed_geometry');
  if (!darkColorEvidence) rejectedReasons.push('outline_not_dark');
  if (config?.requireDarkStrokeSupportForOutline === true && !darkStrokeSupportAvailable) rejectedReasons.push('dark_stroke_support_unavailable');
  if (darkStrokeSupportAvailable && darkStrokeSupportRatio < config.minimumOutlineDarkStrokeSupport) rejectedReasons.push('dark_stroke_support_below_threshold');
  if (!boundaryRelationshipSupported) rejectedReasons.push('unsupported_boundary_relationship');
  if (facialEvidence) rejectedReasons.push('facial_detail_cannot_be_outline');
  if (semanticAssessment?.semanticRole === 'negative_space') rejectedReasons.push('negative_space_cannot_be_outline');
  if ((semanticAssessment?.confidence ?? 0) < config.minimumPlanningConfidence) rejectedReasons.push('planning_confidence_below_threshold');
  if (semanticConflict) rejectedReasons.push('conflicting_semantic_evidence');
  if (innerIntent && !hasNestedRelationship) rejectedReasons.push('inner_outline_not_nested');
  const eligible = rejectedReasons.length === 0;
  return {
    eligible,
    proposedRole: eligible ? (innerIntent ? 'inner_outline' : 'outer_outline') : null,
    confidence,
    explicitOutlineEvidence,
    darkColorEvidence,
    darkStrokeSupportAvailable,
    darkStrokeSupportRatio,
    boundaryRelationshipSupported,
    regionBackedGeometry,
    rejectedReasons,
    evidence: outlineEvidence.map(item => ({ ...item })),
  };
}
