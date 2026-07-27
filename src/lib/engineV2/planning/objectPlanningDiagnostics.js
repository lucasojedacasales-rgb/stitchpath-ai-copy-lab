import { validateEmbroideryObjectProposalPlan } from './objectPlanningValidation.js';

function count(proposals, role) {
  return proposals.filter(item => item.proposedEmbroideryRole === role).length;
}

export function createObjectPlanningDiagnostic({ regions = [], graph, semanticResult, plan }) {
  const proposals = plan?.proposals || [];
  const validation = validateEmbroideryObjectProposalPlan(plan, regions, graph, semanticResult);
  const darkEvaluated = proposals.filter(item => item.semanticRole === 'dark_mark' || item.outlineEligibility?.darkColorEvidence);
  const sameColorCounts = new Map();
  proposals.filter(item => !item.excluded).forEach(item => {
    const component = graph?.nodes?.[item.regionId]?.disconnectedComponentId || 'none';
    const key = String(item.visualColor).toLowerCase();
    const components = sameColorCounts.get(key) || new Set();
    components.add(component);
    sameColorCounts.set(key, components);
  });
  const disconnectedSameColorProposalCount = [...sameColorCounts.values()].reduce((sum, components) => sum + Math.max(0, components.size - 1), 0);
  return {
    valid: Boolean(plan?.valid && validation.valid),
    sourceRegionCount: regions.length,
    semanticAssessmentCount: semanticResult?.assessments?.length || 0,
    decisionRecordCount: proposals.length,
    decisionCoveragePercent: plan?.summary?.decisionCoveragePercent ?? 0,
    silentRegionDropCount: plan?.summary?.silentRegionDropCount ?? regions.length,
    activeProposalCount: plan?.summary?.activeProposalCount ?? 0,
    excludedProposalCount: plan?.summary?.excludedProposalCount ?? 0,
    manualReviewCount: count(proposals, 'manual_review'),
    baseFillCount: count(proposals, 'base_fill'),
    foregroundFillCount: count(proposals, 'foreground_fill'),
    internalDetailCount: count(proposals, 'internal_detail'),
    darkDetailCount: count(proposals, 'dark_detail'),
    highlightCount: count(proposals, 'highlight'),
    explicitOuterOutlineCount: count(proposals, 'outer_outline'),
    explicitInnerOutlineCount: count(proposals, 'inner_outline'),
    syntheticOutlineProposalCount: 0,
    darkRegionsEvaluatedForOutline: darkEvaluated.length,
    darkRegionsRejectedAsOutline: darkEvaluated.filter(item => !item.outlineEligibility?.eligible).length,
    darkRegionsAcceptedAsExplicitOutline: darkEvaluated.filter(item => item.outlineEligibility?.eligible).length,
    negativeSpaceExcludedCount: plan?.summary?.negativeSpaceExcludedCount ?? 0,
    backgroundExcludedCount: plan?.summary?.backgroundExcludedCount ?? 0,
    disconnectedSameColorProposalCount,
    dependencyCount: plan?.summary?.dependencyCount ?? 0,
    dependencyCycleCount: validation.dependencyCycleCount,
    inputMutationsDetected: plan?.metadata?.inputMutationsDetected === true,
    threadIdsAssigned: proposals.some(item => Object.hasOwn(item, 'threadId')),
    stitchCoordinatesGenerated: proposals.some(item => Object.hasOwn(item, 'stitches') || Object.hasOwn(item, 'stitchCoordinates')),
    canonicalCommandsGenerated: proposals.some(item => Object.hasOwn(item, 'commands') || Object.hasOwn(item, 'canonicalCommands')),
    machineAdaptationApplied: false,
    errors: [...(plan?.errors || []), ...validation.errors],
    warnings: [...(plan?.warnings || []), ...validation.warnings],
  };
}
