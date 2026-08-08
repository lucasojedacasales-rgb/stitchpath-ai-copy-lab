import { EMBROIDERY_DRAFT_ROLES, EMBROIDERY_DRAFT_STITCH_TYPES, draftIdFor } from './embroideryObjectDraftModel.js';
import { PROPOSAL_REVIEW_ACTIONS, reviewDecisionIdFor } from './reviewDecisionModel.js';

const issue = (code, path, message) => ({ code, path, message });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const validPolygon = points => Array.isArray(points) && points.length >= 3 && points.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y));

export function validateProposalReviewDecisionV2(decision) {
  const errors = [];
  if (!decision || typeof decision !== 'object') return { valid: false, errors: [issue('INVALID_REVIEW_DECISION', 'decision', 'Review decision must be an object.')], warnings: [] };
  if (!decision.id) errors.push(issue('MISSING_REVIEW_DECISION_ID', 'id', 'Review decision ID is required.'));
  if (!decision.proposalId) errors.push(issue('MISSING_REVIEW_PROPOSAL_REFERENCE', 'proposalId', 'Review decision proposalId is required.'));
  if (decision.id && decision.proposalId && decision.id !== reviewDecisionIdFor(decision.proposalId)) errors.push(issue('NON_DETERMINISTIC_REVIEW_ID', 'id', 'Review decision ID is not deterministic.'));
  if (!PROPOSAL_REVIEW_ACTIONS.includes(decision.action)) errors.push(issue('INVALID_REVIEW_ACTION', 'action', 'Review action is invalid.'));
  if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) errors.push(issue('INVALID_REVIEW_CONFIDENCE', 'confidence', 'Review confidence must be between 0 and 1.'));
  if (decision.action === 'override' && !decision.reviewerSource) errors.push(issue('OVERRIDE_REVIEWER_REQUIRED', 'reviewerSource', 'Override requires reviewerSource.'));
  if (decision.action === 'override' && !decision.reason) errors.push(issue('OVERRIDE_REASON_REQUIRED', 'reason', 'Override requires a reason.'));
  ['threadId', 'machineColor', 'commands', 'stitches', 'stitchCoordinates'].forEach(field => { if (Object.hasOwn(decision, field)) errors.push(issue('FORBIDDEN_REVIEW_FIELD', field, `${field} is forbidden.`)); });
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function validateEmbroideryObjectDraftV2(draft) {
  const errors = [];
  if (!draft || typeof draft !== 'object') return { valid: false, errors: [issue('INVALID_OBJECT_DRAFT', 'draft', 'Draft must be an object.')], warnings: [] };
  if (!draft.id) errors.push(issue('MISSING_DRAFT_ID', 'id', 'Draft ID is required.'));
  if (!draft.proposalId) errors.push(issue('MISSING_DRAFT_PROPOSAL_REFERENCE', 'proposalId', 'Draft proposalId is required.'));
  if (!draft.regionId) errors.push(issue('MISSING_DRAFT_REGION_REFERENCE', 'regionId', 'Draft regionId is required.'));
  if (draft.id && draft.proposalId && draft.id !== draftIdFor(draft.proposalId)) errors.push(issue('NON_DETERMINISTIC_DRAFT_ID', 'id', 'Draft ID is not deterministic.'));
  if (!EMBROIDERY_DRAFT_ROLES.includes(draft.role)) errors.push(issue('INVALID_DRAFT_ROLE', 'role', 'Draft role is invalid.'));
  if (!EMBROIDERY_DRAFT_STITCH_TYPES.includes(draft.stitchType)) errors.push(issue('INVALID_DRAFT_STITCH_TYPE', 'stitchType', 'Draft stitch type is invalid.'));
  if (!validPolygon(draft.geometryMm)) errors.push(issue('INVALID_DRAFT_GEOMETRY', 'geometryMm', 'Draft geometry is invalid.'));
  if (!Array.isArray(draft.holesMm) || draft.holesMm.some(hole => !validPolygon(hole))) errors.push(issue('INVALID_DRAFT_HOLES', 'holesMm', 'Draft holes are invalid.'));
  if (draft.status !== 'materialized_draft') errors.push(issue('INVALID_DRAFT_STATUS', 'status', 'Draft status must be materialized_draft.'));
  if (draft.threadAssignmentStatus !== 'pending') errors.push(issue('INVALID_THREAD_ASSIGNMENT_STATUS', 'threadAssignmentStatus', 'Thread assignment must remain pending.'));
  if (!Array.isArray(draft.entryCandidates) || draft.entryCandidates.length) errors.push(issue('ENTRY_CANDIDATES_NOT_DEFERRED', 'entryCandidates', 'Entry candidates must remain empty.'));
  if (!Array.isArray(draft.exitCandidates) || draft.exitCandidates.length) errors.push(issue('EXIT_CANDIDATES_NOT_DEFERRED', 'exitCandidates', 'Exit candidates must remain empty.'));
  if (!Array.isArray(draft.dependencyIds)) errors.push(issue('INVALID_DRAFT_DEPENDENCIES', 'dependencyIds', 'Draft dependencyIds must be an array.'));
  else if (draft.dependencyIds.includes(draft.id)) errors.push(issue('SELF_DRAFT_DEPENDENCY', 'dependencyIds', 'Draft cannot depend on itself.'));
  ['threadId', 'machineColor', 'commands', 'canonicalCommands', 'stitches', 'stitchCoordinates', 'threadDefinition', 'threadBlock', 'machineProfile', 'machineOffset'].forEach(field => { if (Object.hasOwn(draft, field)) errors.push(issue('FORBIDDEN_DRAFT_FIELD', field, `${field} is forbidden.`)); });
  const parameterKeys = Object.keys(draft.parameters || {}).sort();
  if (!same(parameterKeys, ['deferred', 'generatorRequirements', 'planning'])) errors.push(issue('INVALID_DRAFT_PARAMETERS', 'parameters', 'Draft parameters may contain only planning, generatorRequirements, and deferred.'));
  const deferred = draft.parameters?.deferred || {};
  ['threadAssignment', 'stitchGeneration', 'underlayPlanning', 'fillAngleSelection', 'densitySelection', 'pullCompensation', 'entryExitPlanning', 'globalSequencing', 'machineAdaptation'].forEach(field => {
    if (deferred[field] !== true) errors.push(issue('MISSING_DEFERRED_DRAFT_CONTRACT', `parameters.deferred.${field}`, `${field} must remain deferred.`));
  });
  return { valid: errors.length === 0, errors, warnings: [] };
}

function dependencyCycleCount(drafts) {
  const byId = new Map(drafts.map(item => [item.id, item]));
  const visiting = new Set(); const visited = new Set(); let cycles = 0;
  const visit = id => { if (visiting.has(id)) { cycles += 1; return; } if (visited.has(id)) return; visiting.add(id); (byId.get(id)?.dependencyIds || []).forEach(visit); visiting.delete(id); visited.add(id); };
  drafts.forEach(item => visit(item.id));
  return cycles;
}

export function validateObjectDraftMaterialization(result, proposalPlan, regions = []) {
  const errors = [];
  const warnings = [];
  const proposals = proposalPlan?.proposals || [];
  const decisions = result?.decisions || [];
  const drafts = result?.drafts || [];
  const proposalMap = new Map(proposals.map(item => [item.id, item]));
  const decisionCounts = new Map();
  decisions.forEach((decision, index) => {
    const validation = validateProposalReviewDecisionV2(decision);
    errors.push(...validation.errors.map(item => ({ ...item, path: `decisions[${index}].${item.path}` })));
    if (!proposalMap.has(decision.proposalId)) errors.push(issue('REVIEW_UNKNOWN_PROPOSAL', `decisions[${index}].proposalId`, 'Decision references unknown proposal.'));
    decisionCounts.set(decision.proposalId, (decisionCounts.get(decision.proposalId) || 0) + 1);
  });
  proposals.forEach(proposal => {
    const count = decisionCounts.get(proposal.id) || 0;
    if (!count) errors.push(issue('PROPOSAL_WITHOUT_DISPOSITION', 'decisions', `Proposal "${proposal.id}" has no decision.`));
    if (count > 1) errors.push(issue('DUPLICATE_PROPOSAL_DISPOSITION', 'decisions', `Proposal "${proposal.id}" has multiple decisions.`));
  });
  const draftIds = new Set(); const draftRegions = new Set(); const regionIds = new Set(regions.map(item => item.id));
  drafts.forEach((draft, index) => {
    const validation = validateEmbroideryObjectDraftV2(draft);
    errors.push(...validation.errors.map(item => ({ ...item, path: `drafts[${index}].${item.path}` })));
    if (draftIds.has(draft.id)) errors.push(issue('DUPLICATE_DRAFT_ID', `drafts[${index}].id`, 'Duplicate draft ID.')); draftIds.add(draft.id);
    if (draftRegions.has(draft.regionId)) errors.push(issue('DUPLICATE_REGION_MATERIALIZATION', `drafts[${index}].regionId`, 'Region materialized more than once.')); draftRegions.add(draft.regionId);
    const proposal = proposalMap.get(draft.proposalId);
    const decision = decisions.find(item => item.proposalId === draft.proposalId);
    if (!proposal) errors.push(issue('DRAFT_UNKNOWN_PROPOSAL', `drafts[${index}].proposalId`, 'Draft references unknown proposal.'));
    if (!regionIds.has(draft.regionId)) errors.push(issue('DRAFT_UNKNOWN_REGION', `drafts[${index}].regionId`, 'Draft references unknown region.'));
    if (!['accept', 'override'].includes(decision?.action)) errors.push(issue('DRAFT_WITHOUT_ACCEPTED_DECISION', `drafts[${index}].reviewDecisionId`, 'Draft lacks accepted review decision.'));
    if (proposal?.excluded || proposal?.proposedEmbroideryRole === 'manual_review') errors.push(issue('INELIGIBLE_PROPOSAL_MATERIALIZED', `drafts[${index}].proposalId`, 'Excluded or manual-review proposal was materialized.'));
    if (proposal && !same(draft.geometryMm, proposal.geometryMm)) errors.push(issue('DRAFT_GEOMETRY_MUTATION', `drafts[${index}].geometryMm`, 'Draft geometry differs from proposal.'));
    if (proposal && !same(draft.holesMm, proposal.holesMm)) errors.push(issue('DRAFT_HOLE_MUTATION', `drafts[${index}].holesMm`, 'Draft holes differ from proposal.'));
    if (proposal && !same(draft.visualColor, proposal.visualColor)) errors.push(issue('DRAFT_VISUAL_COLOR_MUTATION', `drafts[${index}].visualColor`, 'Draft visual color differs from proposal.'));
    if (['outer_outline', 'inner_outline'].includes(draft.role) && (!proposal?.outlineEligibility?.eligible || !proposal?.outlineEligibility?.regionBackedGeometry)) errors.push(issue('UNSAFE_OUTLINE_DRAFT', `drafts[${index}].outlineEligibility`, 'Outline draft is not safely region-backed.'));
  });
  drafts.forEach((draft, index) => draft.dependencyIds.forEach(dependencyId => { if (!draftIds.has(dependencyId)) errors.push(issue('MISSING_DRAFT_DEPENDENCY', `drafts[${index}].dependencyIds`, `Missing draft dependency "${dependencyId}".`)); }));
  const cycles = dependencyCycleCount(drafts);
  if (cycles) errors.push(issue('DRAFT_DEPENDENCY_CYCLE', 'drafts', `Draft graph contains ${cycles} cycle(s).`));
  if (result?.summary?.proposalDispositionCoveragePercent !== 100 && proposals.length) errors.push(issue('DISPOSITION_COVERAGE_BELOW_100', 'summary.proposalDispositionCoveragePercent', 'Disposition coverage must be 100%.'));
  if (result?.summary?.silentProposalDropCount > 0) errors.push(issue('SILENT_PROPOSAL_DROP', 'summary.silentProposalDropCount', 'Proposals were silently dropped.'));
  if (result?.metadata?.inputMutationsDetected === true) errors.push(issue('MATERIALIZATION_INPUT_MUTATION', 'metadata.inputMutationsDetected', 'Materialization mutated input data.'));
  ['threads', 'threadDefinitions', 'threadBlocks', 'commands', 'canonicalCommands', 'machineProfile'].forEach(field => { if (Object.hasOwn(result || {}, field)) errors.push(issue('FORBIDDEN_MATERIALIZATION_FIELD', field, `${field} is forbidden in Phase 5.`)); });
  return { valid: errors.length === 0, errors, warnings, dependencyCycleCount: cycles };
}
