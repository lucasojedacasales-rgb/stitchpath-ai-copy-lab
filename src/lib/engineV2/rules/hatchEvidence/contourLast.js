import {
  CONTOUR_DEPENDENCY_ASSOCIATION_LIMIT,
  CONTOUR_DEPENDENCY_ASSOCIATION_METHOD,
  CONTOUR_DEPENDENCY_RULE_ID,
  CONTOUR_INTEGRATION_MARKER_VERSION,
  validateProposalDependencyIntegrity,
} from '../../planning/dependencyPlanner.js';
import { createEmbroideryObjectProposalV2 } from '../../planning/embroideryPlanningModel.js';

export const CONTOUR_LAST_RULE_ID = CONTOUR_DEPENDENCY_RULE_ID;
export const CONTOUR_LAST_ASSOCIATION_METHOD = CONTOUR_DEPENDENCY_ASSOCIATION_METHOD;
export const CONTOUR_LAST_ASSOCIATION_LIMIT = CONTOUR_DEPENDENCY_ASSOCIATION_LIMIT;

function traceProposal(proposal, evaluation) {
  return createEmbroideryObjectProposalV2({
    ...proposal,
    source: {
      ...(proposal.source || {}),
      hatchOverlap: evaluation,
    },
  });
}

function missingContractError() {
  return {
    code: 'CONTOUR_LAST_CONTRACT_MISSING',
    path: 'hatchOverlapDependencyContract',
    message: 'CONTOUR-LAST requires the canonical dependency contract derived by dependency planning.',
  };
}

export function evaluateContourLastProposalGuard({
  proposals = [],
  regions,
  graph,
  semanticResult,
  semanticNormalization,
  config,
  executionLayers,
  contourDependencyContract,
  integration,
}) {
  const contractPresent = Boolean(contourDependencyContract);
  const integrity = validateProposalDependencyIntegrity({
    proposals,
    regions,
    graph,
    semanticResult,
    semanticNormalization,
    config,
    integration,
    executionLayers,
    contourDependencyContract,
    requireContourContract: true,
  });
  const errors = contractPresent
    ? integrity.errors
    : [missingContractError(), ...integrity.errors];
  const claimCount = contourDependencyContract?.claims?.length || 0;
  const applied = contractPresent && claimCount > 0 && errors.length === 0;
  const evaluations = integrity.claimResults.map(result => Object.freeze({
    ruleId: CONTOUR_LAST_RULE_ID,
    profile: integration.profile,
    proposalId: result.contourProposalId,
    regionId: result.contourRegionId,
    componentId: result.componentId,
    componentRegionIds: Object.freeze([...result.componentRegionIds]),
    associationMethod: result.associationMethod,
    associationDisambiguated: result.associationDisambiguated,
    exactGeometricAssociation: false,
    associationEvidence: result.associationEvidence,
    associationLimit: CONTOUR_LAST_ASSOCIATION_LIMIT,
    requiredDependencyIds: Object.freeze([...result.requiredDependencyIds]),
    actualDependencyIds: Object.freeze([...result.actualDependencyIds]),
    missingDependencyIds: Object.freeze([...result.missingDependencyIds]),
    unknownDependencyIds: Object.freeze([...result.unknownDependencyIds]),
    dependencyLayerViolations: Object.freeze([...result.dependencyLayerViolations]),
    topologicalLayer: result.topologicalLayer,
    associationAmbiguous: result.associationAmbiguous,
    cycleDetected: integrity.cycleProposalIds.length > 0,
    individuallySatisfied: result.individuallySatisfied,
    geometryChanged: false,
    stitchTechniqueChanged: false,
    dependenciesChanged: false,
    applicable: true,
    applied: applied && result.individuallySatisfied,
    allConditionsSatisfied: applied && result.individuallySatisfied,
    outcome: applied && result.individuallySatisfied ? 'validated_existing_order' : 'blocked',
  }));
  const trace = Object.freeze({
    version: 'engine-v2-hatch-c1-r3-contour-last',
    phase: 'C_Solapes',
    profile: integration.profile,
    ruleId: CONTOUR_LAST_RULE_ID,
    evaluatorInvoked: true,
    enabledRuleIds: Object.freeze([...integration.enabledRuleIds]),
    integrationMarkerVersion: CONTOUR_INTEGRATION_MARKER_VERSION,
    contractFingerprint: contourDependencyContract?.fingerprint ?? null,
    associationMethod: CONTOUR_LAST_ASSOCIATION_METHOD,
    exactGeometricAssociation: false,
    associationLimit: CONTOUR_LAST_ASSOCIATION_LIMIT,
    eligibleOutlineCount: claimCount,
    evaluationCount: evaluations.length,
    evaluations: Object.freeze(evaluations),
    applied,
    status: errors.length ? 'blocked' : applied ? 'validated' : 'not_applicable',
    geometryChanged: false,
    stitchTechniqueChanged: false,
    dependenciesChanged: false,
    physicalImprovementClaimed: false,
    blockedReasonCodes: Object.freeze([...new Set(errors.map(error => error.code))].sort()),
    transaction: Object.freeze({
      valid: errors.length === 0,
      physicalOutputAllowed: errors.length === 0,
      canonicalOutputAllowed: errors.length === 0,
      partialOutputAllowed: false,
    }),
  });
  const evaluationByProposalId = new Map(evaluations.map(evaluation => [evaluation.proposalId, evaluation]));
  return {
    proposals: proposals.map(proposal => evaluationByProposalId.has(proposal.id)
      ? traceProposal(proposal, evaluationByProposalId.get(proposal.id))
      : proposal),
    trace,
    errors,
    warnings: [],
  };
}
