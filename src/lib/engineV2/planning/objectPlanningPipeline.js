import { analyzeArtworkColor } from '../semantics/colorFeatureAnalysis.js';
import { analyzeRegionGeometryFeatures } from '../semantics/geometryFeatureAnalysis.js';
import { createSemanticRegionAssessmentV2 } from '../semantics/semanticRoleModel.js';
import { buildEmbroideryProposalDependencies } from './dependencyPlanner.js';
import { planEmbroideryRoleForRegion } from './embroideryRolePlanner.js';
import { resolveObjectPlanningConfig, validateObjectPlanningConfig } from './planningConfig.js';
import { validateEmbroideryObjectProposalPlan } from './objectPlanningValidation.js';

function snapshot(value) {
  try { return JSON.stringify(value); } catch { return null; }
}

function count(proposals, role) {
  return proposals.filter(item => item.proposedEmbroideryRole === role).length;
}

function summaryFor(regions, proposals, dependencyResult) {
  const sourceRegionCount = regions.length;
  const decisionRecordCount = proposals.length;
  const decidedIds = new Set(proposals.map(item => item.regionId));
  const silentRegionDropCount = regions.filter(region => !decidedIds.has(region.id)).length;
  return {
    sourceRegionCount,
    decisionRecordCount,
    activeProposalCount: proposals.filter(item => !item.excluded && item.proposedEmbroideryRole !== 'manual_review').length,
    excludedProposalCount: proposals.filter(item => item.excluded).length,
    manualReviewCount: count(proposals, 'manual_review'),
    baseFillCount: count(proposals, 'base_fill'),
    foregroundFillCount: count(proposals, 'foreground_fill'),
    internalDetailCount: count(proposals, 'internal_detail'),
    darkDetailCount: count(proposals, 'dark_detail'),
    highlightCount: count(proposals, 'highlight'),
    explicitOuterOutlineCount: count(proposals, 'outer_outline'),
    explicitInnerOutlineCount: count(proposals, 'inner_outline'),
    syntheticOutlineProposalCount: 0,
    negativeSpaceExcludedCount: proposals.filter(item => item.exclusionReason === 'explicit_negative_space').length,
    backgroundExcludedCount: proposals.filter(item => item.exclusionReason === 'background_excluded_by_policy').length,
    decisionCoveragePercent: sourceRegionCount === 0 ? 100 : ((sourceRegionCount - silentRegionDropCount) / sourceRegionCount) * 100,
    silentRegionDropCount,
    dependencyCount: dependencyResult.dependencyCount,
    dependencyCycleCount: dependencyResult.dependencyCycleCount,
  };
}

export function buildEmbroideryObjectProposalPlan({
  regions,
  graph,
  semanticResult,
  config = {},
  technicalConfig,
}) {
  const sourceRegions = Array.isArray(regions) ? regions : [];
  const before = snapshot({ regions: sourceRegions, graph, semanticResult });
  const configValidation = validateObjectPlanningConfig(config, { technicalConfig });
  const resolvedConfig = resolveObjectPlanningConfig(config);
  const proposals = [...sourceRegions].sort((a, b) => String(a.id).localeCompare(String(b.id))).map(region => {
    const assessment = semanticResult?.byRegionId?.[region.id]
      || createSemanticRegionAssessmentV2({ regionId: region.id, semanticRole: 'unknown', confidence: 0, needsReview: true, evidence: [{ code: 'MISSING_SEMANTIC_ASSESSMENT', message: 'No semantic assessment was provided.' }] });
    return planEmbroideryRoleForRegion({
      region, graph, semanticAssessment: assessment,
      colorFeatures: assessment.colorFeatures || analyzeArtworkColor(region.visualColor),
      geometryFeatures: assessment.geometryFeatures || analyzeRegionGeometryFeatures(region, graph),
      config: resolvedConfig,
      technicalConfig,
    });
  });
  const dependencyResult = buildEmbroideryProposalDependencies(proposals, sourceRegions, graph, semanticResult, resolvedConfig);
  const planned = dependencyResult.proposals;
  const summary = summaryFor(sourceRegions, planned, dependencyResult);
  const plan = {
    version: '2-object-planning-proposals',
    proposals: planned,
    byProposalId: Object.fromEntries(planned.map(item => [item.id, item])),
    byRegionId: Object.fromEntries(planned.map(item => [item.regionId, item])),
    executionLayers: dependencyResult.executionLayers,
    valid: true,
    errors: [...configValidation.errors],
    warnings: [...dependencyResult.warnings],
    summary,
    config: resolvedConfig,
    metadata: { inputMutationsDetected: before !== snapshot({ regions: sourceRegions, graph, semanticResult }) },
  };
  const validation = validateEmbroideryObjectProposalPlan(plan, sourceRegions, graph, semanticResult);
  return { ...plan, valid: plan.errors.length === 0 && validation.valid, errors: [...plan.errors, ...validation.errors], warnings: [...plan.warnings, ...validation.warnings] };
}
