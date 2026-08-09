import { analyzeArtworkColor } from '../semantics/colorFeatureAnalysis.js';
import { analyzeRegionGeometryFeatures } from '../semantics/geometryFeatureAnalysis.js';
import { analyzeSourceSemanticEvidence } from '../semantics/sourceSemanticEvidence.js';
import { evaluateHatchHoleProtection } from '../rules/hatchEvidence/holes.js';
import { resolveHatchEvidenceIntegrationConfig } from '../rules/hatchEvidence/profiles.js';
import { evaluateHatchWidthTechniqueCandidate } from '../rules/hatchEvidence/widths.js';
import { createEmbroideryObjectProposalV2 } from './embroideryPlanningModel.js';
import { regionGeometryToMillimeters } from './normalizedToMillimeterGeometry.js';
import { evaluateOutlineEligibility } from './outlineEligibility.js';
import { LEGACY_SATIN_MINIMUM_ASPECT_RATIO } from './planningConfig.js';

const ROLE_LAYERS = Object.freeze({ excluded: -1, base_fill: 0, foreground_fill: 1, internal_detail: 2, dark_detail: 3, highlight: 3, inner_outline: 4, outer_outline: 5, manual_review: 6 });

function physicalFeatures(geometryFeatures, config) {
  const widthMm = (geometryFeatures?.width || 0) * config.designWidthMm;
  const heightMm = (geometryFeatures?.height || 0) * config.designHeightMm;
  return {
    areaMm2: (geometryFeatures?.effectiveArea || 0) * config.designWidthMm * config.designHeightMm,
    minimumWidthMm: Math.min(widthMm, heightMm),
    maximumWidthMm: Math.max(widthMm, heightMm),
    aspectRatio: geometryFeatures?.aspectRatio || 0,
    closed: (geometryFeatures?.effectiveArea || 0) > 0,
  };
}

function detailDecision(features, config) {
  if (features.minimumWidthMm <= config.maximumRunningDetailWidthMm || features.areaMm2 <= config.smallDetailAreaMm2) return 'running';
  if (features.minimumWidthMm >= config.minimumSatinWidthMm
    && features.minimumWidthMm <= config.maximumSatinWidthMm
    && features.aspectRatio >= LEGACY_SATIN_MINIMUM_ASPECT_RATIO) return 'satin';
  if (features.closed && features.areaMm2 >= config.minimumTatamiAreaMm2) return 'tatami';
  return 'manual';
}

function hatchTrace(integration, evaluations) {
  if (integration.profile === 'legacy' || !evaluations.length) return null;
  return {
    profile: integration.profile,
    enabledRuleIds: integration.enabledRuleIds,
    context: integration.context,
    evaluations,
  };
}

function enrichWithHatchEvidence(base, trace, evidence = []) {
  if (!trace) return base;
  return {
    ...base,
    evidence: [...base.evidence, ...evidence],
    source: { ...base.source, hatchEvidence: trace },
  };
}

function manual(region, assessment, geometry, outlineEligibility, reason) {
  return createEmbroideryObjectProposalV2({
    regionId: region.id, semanticRole: assessment?.semanticRole || 'unknown', proposedEmbroideryRole: 'manual_review',
    proposedStitchType: 'manual', geometryMm: geometry.geometryMm, holesMm: geometry.holesMm,
    visualColor: region.visualColor, layer: ROLE_LAYERS.manual_review, planningConfidence: assessment?.confidence || 0,
    needsReview: true, evidence: [{ code: 'MANUAL_REVIEW_REQUIRED', message: reason }, ...(assessment?.evidence || [])],
    alternatives: assessment?.alternatives || [], outlineEligibility, source: { regionSource: region.source, geometryErrors: geometry.errors },
  });
}

function manualWithHatch(region, assessment, geometry, outlineEligibility, reason, trace, hatchEvidence) {
  if (!trace) return manual(region, assessment, geometry, outlineEligibility, reason);
  return createEmbroideryObjectProposalV2({
    regionId: region.id, semanticRole: assessment?.semanticRole || 'unknown', proposedEmbroideryRole: 'manual_review',
    proposedStitchType: 'manual', geometryMm: geometry.geometryMm, holesMm: geometry.holesMm,
    visualColor: region.visualColor, layer: ROLE_LAYERS.manual_review, planningConfidence: assessment?.confidence || 0,
    needsReview: true, evidence: [{ code: 'MANUAL_REVIEW_REQUIRED', message: reason }, ...(assessment?.evidence || []), ...hatchEvidence],
    alternatives: assessment?.alternatives || [], outlineEligibility,
    source: { regionSource: region.source, geometryErrors: geometry.errors, hatchEvidence: trace },
  });
}

function planLegacyEmbroideryRoleForRegion({ region, graph, semanticAssessment, colorFeatures, geometryFeatures, config }) {
  const assessment = semanticAssessment || { semanticRole: 'unknown', confidence: 0, evidence: [], alternatives: [], needsReview: true };
  const suppliedColor = colorFeatures || assessment.colorFeatures;
  const suppliedGeometry = geometryFeatures || assessment.geometryFeatures;
  const color = typeof suppliedColor?.valid === 'boolean' ? suppliedColor : analyzeArtworkColor(region?.visualColor);
  const geometryAnalysis = Number.isFinite(suppliedGeometry?.effectiveArea) ? suppliedGeometry : analyzeRegionGeometryFeatures(region, graph);
  const sourceEvidence = analyzeSourceSemanticEvidence(region);
  const converted = regionGeometryToMillimeters(region, config);
  const features = physicalFeatures(geometryAnalysis, config);
  const outlineEligibility = evaluateOutlineEligibility({ region, graph, semanticAssessment: assessment, sourceEvidence, colorFeatures: color, geometryFeatures: geometryAnalysis, config });
  if (!converted.valid) return manual(region, assessment, converted, outlineEligibility, 'Geometry could not be converted safely to millimetres.');

  const base = {
    regionId: region.id, semanticRole: assessment.semanticRole, geometryMm: converted.geometryMm, holesMm: converted.holesMm,
    visualColor: region.visualColor, planningConfidence: assessment.confidence, needsReview: false,
    evidence: [...(assessment.evidence || []), { code: 'REGION_DECISION_RECORDED', message: 'Region received one deterministic planning decision.' }],
    alternatives: assessment.alternatives || [], outlineEligibility, source: { regionSource: region.source, sourceEvidence: sourceEvidence.controlledMatches, geometryFeatures: features },
  };

  if (assessment.semanticRole === 'negative_space') return createEmbroideryObjectProposalV2({ ...base, proposedEmbroideryRole: 'excluded', proposedStitchType: 'none', excluded: true, exclusionReason: 'explicit_negative_space', layer: ROLE_LAYERS.excluded });
  if (assessment.semanticRole === 'background' && !config.includeBackground) return createEmbroideryObjectProposalV2({ ...base, proposedEmbroideryRole: 'excluded', proposedStitchType: 'none', excluded: true, exclusionReason: 'background_excluded_by_policy', layer: ROLE_LAYERS.excluded });
  if (outlineEligibility.eligible) return createEmbroideryObjectProposalV2({ ...base, proposedEmbroideryRole: outlineEligibility.proposedRole, proposedStitchType: 'running', layer: ROLE_LAYERS[outlineEligibility.proposedRole] });
  if (assessment.semanticRole === 'unknown' || assessment.confidence < config.minimumPlanningConfidence) return manual(region, assessment, converted, outlineEligibility, 'Semantic role or confidence is insufficient for automatic planning.');
  if (assessment.semanticRole === 'background' || assessment.semanticRole === 'primary_shape') {
    if (features.areaMm2 < config.minimumTatamiAreaMm2) return manual(region, assessment, converted, outlineEligibility, 'Primary fill area is below the tatami safety threshold.');
    return createEmbroideryObjectProposalV2({ ...base, proposedEmbroideryRole: 'base_fill', proposedStitchType: 'tatami', layer: ROLE_LAYERS.base_fill });
  }
  if (assessment.semanticRole === 'secondary_shape') {
    if (features.areaMm2 < config.minimumTatamiAreaMm2 || features.minimumWidthMm <= config.maximumRunningDetailWidthMm) return manual(region, assessment, converted, outlineEligibility, 'Secondary shape is too small or thin for automatic tatami.');
    return createEmbroideryObjectProposalV2({ ...base, proposedEmbroideryRole: 'foreground_fill', proposedStitchType: 'tatami', layer: ROLE_LAYERS.foreground_fill });
  }
  const role = assessment.semanticRole === 'internal_feature' ? 'internal_detail'
    : assessment.semanticRole === 'dark_mark' ? 'dark_detail'
      : assessment.semanticRole === 'highlight' ? 'highlight' : 'manual_review';
  const stitchType = detailDecision(features, config);
  if (stitchType === 'manual' || assessment.confidence < config.minimumAutomaticStitchTypeConfidence) return manual(region, assessment, converted, outlineEligibility, 'Detail geometry or confidence is ambiguous.');
  return createEmbroideryObjectProposalV2({ ...base, proposedEmbroideryRole: role, proposedStitchType: stitchType, layer: ROLE_LAYERS[role] });
}

function planExperimentalEmbroideryRoleForRegion({
  region,
  graph,
  semanticAssessment,
  colorFeatures,
  geometryFeatures,
  config,
  technicalConfig,
  hatchIntegration,
}) {
  const assessment = semanticAssessment || { semanticRole: 'unknown', confidence: 0, evidence: [], alternatives: [], needsReview: true };
  const suppliedColor = colorFeatures || assessment.colorFeatures;
  const suppliedGeometry = geometryFeatures || assessment.geometryFeatures;
  const color = typeof suppliedColor?.valid === 'boolean' ? suppliedColor : analyzeArtworkColor(region?.visualColor);
  const geometryAnalysis = Number.isFinite(suppliedGeometry?.effectiveArea) ? suppliedGeometry : analyzeRegionGeometryFeatures(region, graph);
  const sourceEvidence = analyzeSourceSemanticEvidence(region);
  const converted = regionGeometryToMillimeters(region, config);
  const features = physicalFeatures(geometryAnalysis, config);
  const outlineEligibility = evaluateOutlineEligibility({ region, graph, semanticAssessment: assessment, sourceEvidence, colorFeatures: color, geometryFeatures: geometryAnalysis, config });
  if (!converted.valid) return manual(region, assessment, converted, outlineEligibility, 'Geometry could not be converted safely to millimetres.');

  const base = {
    regionId: region.id, semanticRole: assessment.semanticRole, geometryMm: converted.geometryMm, holesMm: converted.holesMm,
    visualColor: region.visualColor, planningConfidence: assessment.confidence, needsReview: false,
    evidence: [...(assessment.evidence || []), { code: 'REGION_DECISION_RECORDED', message: 'Region received one deterministic planning decision.' }],
    alternatives: assessment.alternatives || [], outlineEligibility, source: { regionSource: region.source, sourceEvidence: sourceEvidence.controlledMatches, geometryFeatures: features },
  };

  if (assessment.semanticRole === 'negative_space') return createEmbroideryObjectProposalV2({ ...base, proposedEmbroideryRole: 'excluded', proposedStitchType: 'none', excluded: true, exclusionReason: 'explicit_negative_space', layer: ROLE_LAYERS.excluded });
  if (assessment.semanticRole === 'background' && !config.includeBackground) return createEmbroideryObjectProposalV2({ ...base, proposedEmbroideryRole: 'excluded', proposedStitchType: 'none', excluded: true, exclusionReason: 'background_excluded_by_policy', layer: ROLE_LAYERS.excluded });
  if (outlineEligibility.eligible) return createEmbroideryObjectProposalV2({ ...base, proposedEmbroideryRole: outlineEligibility.proposedRole, proposedStitchType: 'running', layer: ROLE_LAYERS[outlineEligibility.proposedRole] });
  if (assessment.semanticRole === 'unknown' || assessment.confidence < config.minimumPlanningConfidence) return manual(region, assessment, converted, outlineEligibility, 'Semantic role or confidence is insufficient for automatic planning.');

  const holeRuleIds = hatchIntegration.enabledRuleIds.filter(ruleId => ruleId === 'HOLE-PRESERVE-001' || ruleId === 'HOLE-MIN-SIZE-001');
  const holeEvaluation = evaluateHatchHoleProtection({
    geometryMm: converted.geometryMm,
    holesMm: converted.holesMm,
    context: hatchIntegration.context,
    enabledRuleIds: holeRuleIds,
  });
  const holeTrace = hatchTrace(hatchIntegration, holeEvaluation.evaluations);
  const holeEvidence = holeTrace ? holeEvaluation.evidence : [];
  if (holeEvaluation.requiresManualReview) {
    const reason = holeEvaluation.automaticGenerationRejected
      ? 'Hatch B evidence rejects automatic generation for a hole at or below the observed 0.8 mm loss boundary.'
      : 'Hatch B evidence requires review for a hole below the smallest observed preserved size of 1.2 mm.';
    return manualWithHatch(region, assessment, converted, outlineEligibility, reason, holeTrace, holeEvidence);
  }
  const holeAwareBase = enrichWithHatchEvidence(base, holeTrace, holeEvidence);
  if (assessment.semanticRole === 'background' || assessment.semanticRole === 'primary_shape') {
    if (features.areaMm2 < config.minimumTatamiAreaMm2) return manualWithHatch(region, assessment, converted, outlineEligibility, 'Primary fill area is below the tatami safety threshold.', holeTrace, holeEvidence);
    return createEmbroideryObjectProposalV2({ ...holeAwareBase, proposedEmbroideryRole: 'base_fill', proposedStitchType: 'tatami', layer: ROLE_LAYERS.base_fill });
  }
  if (assessment.semanticRole === 'secondary_shape') {
    if (features.areaMm2 < config.minimumTatamiAreaMm2 || features.minimumWidthMm <= config.maximumRunningDetailWidthMm) return manualWithHatch(region, assessment, converted, outlineEligibility, 'Secondary shape is too small or thin for automatic tatami.', holeTrace, holeEvidence);
    return createEmbroideryObjectProposalV2({ ...holeAwareBase, proposedEmbroideryRole: 'foreground_fill', proposedStitchType: 'tatami', layer: ROLE_LAYERS.foreground_fill });
  }
  const role = assessment.semanticRole === 'internal_feature' ? 'internal_detail'
    : assessment.semanticRole === 'dark_mark' ? 'dark_detail'
      : assessment.semanticRole === 'highlight' ? 'highlight' : 'manual_review';
  const legacyStitchType = detailDecision(features, config);
  const widthRuleIds = hatchIntegration.enabledRuleIds.filter(ruleId => ruleId === 'SATIN-RANGE-OBSERVED-001' || ruleId === 'LOCAL-WIDTH-PROFILE-001');
  const widthEvaluation = evaluateHatchWidthTechniqueCandidate({
    legacyTechnique: legacyStitchType,
    geometryMm: converted.geometryMm,
    holesMm: converted.holesMm,
    context: hatchIntegration.context,
    technicalConfig,
    enabledRuleIds: widthRuleIds,
    minimumSatinWidthMm: config.minimumSatinWidthMm,
    minimumSatinAspectRatio: LEGACY_SATIN_MINIMUM_ASPECT_RATIO,
  });
  const widthTrace = hatchTrace(hatchIntegration, [...holeEvaluation.evaluations, ...widthEvaluation.evaluations]);
  const widthEvidence = widthTrace ? [...holeEvidence, ...widthEvaluation.evidence] : [];
  const stitchType = widthEvaluation.technique;
  if (stitchType === 'manual' || assessment.confidence < config.minimumAutomaticStitchTypeConfidence) return manualWithHatch(region, assessment, converted, outlineEligibility, 'Detail geometry or confidence is ambiguous.', widthTrace, widthEvidence);
  const experimentalBase = enrichWithHatchEvidence(base, widthTrace, widthEvidence);
  return createEmbroideryObjectProposalV2({ ...experimentalBase, proposedEmbroideryRole: role, proposedStitchType: stitchType, layer: ROLE_LAYERS[role] });
}

function requestedHatchProfile(config) {
  const extras = config?.extras && typeof config.extras === 'object' ? config.extras : {};
  return config?.hatchEvidenceProfile ?? extras.hatchEvidenceProfile;
}

export function planEmbroideryRoleForRegion(input) {
  if (requestedHatchProfile(input?.config) !== 'hatch-a-f-experimental') {
    return planLegacyEmbroideryRoleForRegion(input);
  }
  const hatchIntegration = resolveHatchEvidenceIntegrationConfig(input.config);
  if (!hatchIntegration.enabledRuleIds.length) return planLegacyEmbroideryRoleForRegion(input);
  return planExperimentalEmbroideryRoleForRegion({ ...input, hatchIntegration });
}
