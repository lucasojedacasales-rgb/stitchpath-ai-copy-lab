import { EMBROIDERY_PROPOSAL_ROLES, EMBROIDERY_PROPOSAL_STITCH_TYPES, proposalIdFor } from './embroideryPlanningModel.js';

const issue = (code, path, message) => ({ code, path, message });

function validPolygon(points) {
  return Array.isArray(points) && points.length >= 3 && points.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function forbiddenProductionFields(proposal) {
  const forbidden = ['threadId', 'machineColor', 'stitches', 'stitchCoordinates', 'commands', 'canonicalCommands'];
  return forbidden.filter(field => Object.hasOwn(proposal || {}, field));
}

export function validateEmbroideryObjectProposalV2(proposal) {
  const errors = [];
  if (!proposal || typeof proposal !== 'object') return { valid: false, errors: [issue('INVALID_PROPOSAL', 'proposal', 'Proposal must be an object.')], warnings: [] };
  if (typeof proposal.id !== 'string' || !proposal.id) errors.push(issue('MISSING_PROPOSAL_ID', 'id', 'Proposal ID is required.'));
  if (typeof proposal.regionId !== 'string' || !proposal.regionId) errors.push(issue('MISSING_PROPOSAL_REGION', 'regionId', 'Proposal regionId is required.'));
  if (!EMBROIDERY_PROPOSAL_ROLES.includes(proposal.proposedEmbroideryRole)) errors.push(issue('INVALID_PROPOSED_EMBROIDERY_ROLE', 'proposedEmbroideryRole', 'Proposed embroidery role is invalid.'));
  if (!EMBROIDERY_PROPOSAL_STITCH_TYPES.includes(proposal.proposedStitchType)) errors.push(issue('INVALID_PROPOSED_STITCH_TYPE', 'proposedStitchType', 'Proposed stitch type is invalid.'));
  if (!validPolygon(proposal.geometryMm)) errors.push(issue('INVALID_MILLIMETER_GEOMETRY', 'geometryMm', 'Millimetre geometry requires at least three finite points.'));
  if (!Array.isArray(proposal.holesMm) || proposal.holesMm.some(hole => !validPolygon(hole))) errors.push(issue('INVALID_MILLIMETER_HOLES', 'holesMm', 'Millimetre holes must contain valid polygons.'));
  if (proposal.excluded && proposal.proposedStitchType !== 'none') errors.push(issue('EXCLUDED_PROPOSAL_STITCHABLE', 'proposedStitchType', 'Excluded proposals must use stitch type none.'));
  if (!proposal.excluded && proposal.proposedStitchType === 'none') errors.push(issue('ACTIVE_PROPOSAL_WITHOUT_STITCH_TYPE', 'proposedStitchType', 'Active proposals cannot use stitch type none.'));
  if (proposal.excluded && proposal.proposedEmbroideryRole !== 'excluded') errors.push(issue('EXCLUSION_ROLE_MISMATCH', 'proposedEmbroideryRole', 'Excluded proposals must use the excluded role.'));
  if (!proposal.excluded && proposal.proposedEmbroideryRole === 'excluded') errors.push(issue('ACTIVE_EXCLUDED_ROLE', 'excluded', 'The excluded role requires excluded=true.'));
  if (proposal.semanticRole === 'negative_space' && !proposal.excluded) errors.push(issue('NEGATIVE_SPACE_STITCHABLE', 'semanticRole', 'Negative space cannot be stitchable.'));
  if (!Number.isFinite(proposal.planningConfidence) || proposal.planningConfidence < 0 || proposal.planningConfidence > 1) errors.push(issue('INVALID_PLANNING_CONFIDENCE', 'planningConfidence', 'Planning confidence must be between 0 and 1.'));
  if (!Array.isArray(proposal.evidence) || proposal.evidence.length === 0) errors.push(issue('MISSING_PLANNING_EVIDENCE', 'evidence', 'Proposal requires planning evidence.'));
  if (!Array.isArray(proposal.dependencyIds)) errors.push(issue('INVALID_DEPENDENCY_IDS', 'dependencyIds', 'dependencyIds must be an array.'));
  if (proposal.id && proposal.regionId && EMBROIDERY_PROPOSAL_ROLES.includes(proposal.proposedEmbroideryRole)
    && proposal.id !== proposalIdFor(proposal.regionId, proposal.proposedEmbroideryRole)) errors.push(issue('NON_DETERMINISTIC_PROPOSAL_ID', 'id', 'Proposal ID does not match the deterministic format.'));
  forbiddenProductionFields(proposal).forEach(field => errors.push(issue('FORBIDDEN_PRODUCTION_FIELD', field, `${field} is forbidden in a planning proposal.`)));
  if (['outer_outline', 'inner_outline'].includes(proposal.proposedEmbroideryRole)) {
    if (!proposal.outlineEligibility?.eligible) errors.push(issue('UNSUPPORTED_OUTLINE_PROPOSAL', 'outlineEligibility', 'Outline proposal lacks successful eligibility evidence.'));
    if (!proposal.outlineEligibility?.explicitOutlineEvidence) errors.push(issue('OUTLINE_WITHOUT_EXPLICIT_SOURCE', 'outlineEligibility.explicitOutlineEvidence', 'Outline requires explicit source evidence.'));
    if (!proposal.outlineEligibility?.regionBackedGeometry) errors.push(issue('SYNTHETIC_OUTLINE_GEOMETRY', 'outlineEligibility.regionBackedGeometry', 'Synthetic outline geometry is forbidden.'));
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

function cycleCount(proposals) {
  const byId = new Map(proposals.map(item => [item.id, item]));
  const visiting = new Set();
  const visited = new Set();
  let cycles = 0;
  const visit = id => {
    if (visiting.has(id)) { cycles += 1; return; }
    if (visited.has(id)) return;
    visiting.add(id);
    (byId.get(id)?.dependencyIds || []).forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  proposals.forEach(item => visit(item.id));
  return cycles;
}

export function validateEmbroideryObjectProposalPlan(plan, regions = [], graph, semanticResult) {
  const errors = [];
  const warnings = [];
  const proposals = Array.isArray(plan?.proposals) ? plan.proposals : [];
  const regionIds = new Set((Array.isArray(regions) ? regions : []).map(item => item.id));
  const proposalIds = proposals.map(item => item?.id);
  if (new Set(proposalIds).size !== proposalIds.length) errors.push(issue('DUPLICATE_PROPOSAL_ID', 'proposals', 'Proposal IDs must be unique.'));
  const decisionsByRegion = new Map();
  proposals.forEach((proposal, index) => {
    const validation = validateEmbroideryObjectProposalV2(proposal);
    errors.push(...validation.errors.map(item => ({ ...item, path: `proposals[${index}].${item.path}` })));
    if (!regionIds.has(proposal?.regionId)) errors.push(issue('PROPOSAL_UNKNOWN_REGION', `proposals[${index}].regionId`, `Unknown region "${proposal?.regionId}".`));
    decisionsByRegion.set(proposal?.regionId, (decisionsByRegion.get(proposal?.regionId) || 0) + 1);
  });
  regionIds.forEach(regionId => {
    const count = decisionsByRegion.get(regionId) || 0;
    if (count === 0) errors.push(issue('ACCEPTED_REGION_WITHOUT_DECISION', 'proposals', `Region "${regionId}" has no decision record.`));
    if (count > 1) errors.push(issue('MULTIPLE_REGION_DECISIONS', 'proposals', `Region "${regionId}" has ${count} decision records.`));
  });
  const idSet = new Set(proposalIds);
  proposals.forEach((proposal, index) => (proposal?.dependencyIds || []).forEach(dependencyId => {
    if (!idSet.has(dependencyId)) errors.push(issue('UNKNOWN_PROPOSAL_DEPENDENCY', `proposals[${index}].dependencyIds`, `Unknown dependency "${dependencyId}".`));
    if (dependencyId === proposal.id) errors.push(issue('SELF_PROPOSAL_DEPENDENCY', `proposals[${index}].dependencyIds`, 'Proposal cannot depend on itself.'));
  }));
  const cycles = cycleCount(proposals);
  if (cycles > 0) errors.push(issue('PROPOSAL_DEPENDENCY_CYCLE', 'proposals', `Proposal graph contains ${cycles} cycle(s).`));
  if (plan?.metadata?.inputMutationsDetected === true) errors.push(issue('PLANNING_INPUT_MUTATION', 'metadata.inputMutationsDetected', 'Planning mutated source inputs.'));
  if (plan?.summary?.decisionCoveragePercent !== 100 && regionIds.size > 0) errors.push(issue('DECISION_COVERAGE_BELOW_100', 'summary.decisionCoveragePercent', 'Every accepted region must receive one decision.'));
  if (graph && [...regionIds].some(id => !graph.nodes?.[id])) errors.push(issue('PLANNING_GRAPH_REGION_MISMATCH', 'graph', 'Planning graph is missing source regions.'));
  if (semanticResult?.assessments && semanticResult.assessments.some(item => !regionIds.has(item.regionId))) warnings.push(issue('SEMANTIC_RESULT_EXTRA_REGION', 'semanticResult', 'Semantic result contains a region outside this plan.'));
  return { valid: errors.length === 0, errors, warnings, dependencyCycleCount: cycles };
}
