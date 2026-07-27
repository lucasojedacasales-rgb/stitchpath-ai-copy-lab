import { EMBROIDERY_PROPOSAL_ROLES, EMBROIDERY_PROPOSAL_STITCH_TYPES } from '../planning/embroideryPlanningModel.js';
import { validateEmbroideryObjectProposalV2 } from '../planning/objectPlanningValidation.js';
import { createProposalReviewDecisionV2 } from './reviewDecisionModel.js';
import { resolveProposalReviewPolicyConfig, validateProposalReviewPolicyConfig } from './reviewPolicyConfig.js';

const DRAFT_ROLES = new Set(['base_fill', 'foreground_fill', 'internal_detail', 'dark_detail', 'outer_outline', 'inner_outline', 'highlight']);
const DRAFT_STITCH_TYPES = new Set(['tatami', 'satin', 'running', 'manual']);
const issue = (code, path, message) => ({ code, path, message });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function baseDecision(proposal, input) {
  return createProposalReviewDecisionV2({
    proposalId: proposal.id,
    regionId: proposal.regionId,
    proposedEmbroideryRole: proposal.proposedEmbroideryRole,
    proposedStitchType: proposal.proposedStitchType,
    approvedEmbroideryRole: input.approvedEmbroideryRole ?? proposal.proposedEmbroideryRole,
    approvedStitchType: input.approvedStitchType ?? proposal.proposedStitchType,
    confidence: input.confidence ?? proposal.planningConfidence,
    evidence: [...(proposal.evidence || []), ...(input.evidence || [])],
    source: { proposalSource: proposal.source, reviewSource: input.source ?? null },
    ...input,
  });
}

function outlineSafe(proposal, role = proposal.proposedEmbroideryRole) {
  if (!['outer_outline', 'inner_outline'].includes(role)) return true;
  return proposal.outlineEligibility?.eligible === true
    && proposal.outlineEligibility?.explicitOutlineEvidence === true
    && proposal.outlineEligibility?.regionBackedGeometry === true;
}

function validateExplicitOverride(proposal, explicit, config) {
  const errors = [];
  if (!config.allowExplicitOverrides) errors.push(issue('EXPLICIT_OVERRIDES_DISABLED', 'explicitReviewDecisions', 'Explicit overrides are disabled.'));
  if (!explicit.reviewerSource || !String(explicit.reviewerSource).trim()) errors.push(issue('OVERRIDE_REVIEWER_REQUIRED', 'reviewerSource', 'Override requires reviewerSource.'));
  if (!explicit.reason || !String(explicit.reason).trim()) errors.push(issue('OVERRIDE_REASON_REQUIRED', 'reason', 'Override requires a reason.'));
  const role = explicit.approvedEmbroideryRole ?? proposal.proposedEmbroideryRole;
  const stitchType = explicit.approvedStitchType ?? proposal.proposedStitchType;
  if (!DRAFT_ROLES.has(role)) errors.push(issue('INVALID_OVERRIDE_ROLE', 'approvedEmbroideryRole', 'Override role is not materializable.'));
  if (!DRAFT_STITCH_TYPES.has(stitchType)) errors.push(issue('INVALID_OVERRIDE_STITCH_TYPE', 'approvedStitchType', 'Override stitch type is not materializable.'));
  if (role !== proposal.proposedEmbroideryRole && !config.allowRoleOverride) errors.push(issue('ROLE_OVERRIDE_DISABLED', 'approvedEmbroideryRole', 'Role override is disabled.'));
  if (stitchType !== proposal.proposedStitchType && !config.allowStitchTypeOverride) errors.push(issue('STITCH_TYPE_OVERRIDE_DISABLED', 'approvedStitchType', 'Stitch-type override is disabled.'));
  if (proposal.semanticRole === 'negative_space' || proposal.excluded) errors.push(issue('NEGATIVE_OR_EXCLUDED_OVERRIDE_FORBIDDEN', 'proposalId', 'Excluded or negative-space proposals cannot become stitchable.'));
  if (proposal.semanticRole === 'background' && ['outer_outline', 'inner_outline'].includes(role)) errors.push(issue('BACKGROUND_OUTLINE_OVERRIDE_FORBIDDEN', 'approvedEmbroideryRole', 'Background cannot become an outline.'));
  if (proposal.semanticRole === 'internal_feature' && role === 'outer_outline') errors.push(issue('FACIAL_OUTLINE_OVERRIDE_FORBIDDEN', 'approvedEmbroideryRole', 'Internal features cannot become outer outlines.'));
  if (!outlineSafe(proposal, role)) errors.push(issue('OUTLINE_OVERRIDE_NOT_ELIGIBLE', 'approvedEmbroideryRole', 'Outline override does not pass original outline eligibility.'));
  if (Object.hasOwn(explicit, 'geometryMm') && !same(explicit.geometryMm, proposal.geometryMm)) errors.push(issue('OVERRIDE_GEOMETRY_MUTATION', 'geometryMm', 'Override cannot alter geometry.'));
  if (Object.hasOwn(explicit, 'holesMm') && !same(explicit.holesMm, proposal.holesMm)) errors.push(issue('OVERRIDE_HOLE_MUTATION', 'holesMm', 'Override cannot alter holes.'));
  ['threadId', 'machineColor', 'stitches', 'stitchCoordinates', 'commands', 'machineSettings'].forEach(field => {
    if (Object.hasOwn(explicit, field)) errors.push(issue('FORBIDDEN_OVERRIDE_FIELD', field, `${field} is forbidden in review.`));
  });
  return errors;
}

function automaticDecision(proposal, plan, config) {
  if (proposal.excluded) return baseDecision(proposal, { action: 'exclude', reasonCode: proposal.exclusionReason || 'PLANNING_EXCLUSION', reason: 'Proposal remains excluded by planning policy.', automatic: true });
  const proposalValidation = validateEmbroideryObjectProposalV2(proposal);
  if (!proposalValidation.valid) return baseDecision(proposal, { action: 'blocked', reasonCode: 'INVALID_PROPOSAL', reason: 'Proposal validation failed.', automatic: true, evidence: proposalValidation.errors });
  if (config.requireValidProposalPlan && plan?.valid !== true) return baseDecision(proposal, { action: 'blocked', reasonCode: 'INVALID_PROPOSAL_PLAN', reason: 'Proposal plan is invalid.', automatic: true });
  if (proposal.proposedEmbroideryRole === 'manual_review') return baseDecision(proposal, { action: config.manualReviewAction, reasonCode: 'MANUAL_REVIEW_REQUIRED', reason: 'Proposal requires explicit manual review.', automatic: true });
  if (proposal.needsReview || proposal.planningConfidence < config.minimumAutoAcceptConfidence) return baseDecision(proposal, { action: 'defer', reasonCode: 'AUTO_ACCEPT_THRESHOLD_NOT_MET', reason: 'Proposal is not eligible for automatic acceptance.', automatic: true });
  if (!config.autoAcceptActiveProposals) return baseDecision(proposal, { action: 'defer', reasonCode: 'AUTO_ACCEPT_DISABLED', reason: 'Automatic acceptance is disabled.', automatic: true });
  if (['outer_outline', 'inner_outline'].includes(proposal.proposedEmbroideryRole) && (!config.autoAcceptExplicitOutlines || !outlineSafe(proposal))) return baseDecision(proposal, { action: 'blocked', reasonCode: 'OUTLINE_SAFETY_NOT_MET', reason: 'Outline safety requirements were not met.', automatic: true });
  return baseDecision(proposal, { action: 'accept', reasonCode: 'VALID_ACTIVE_PROPOSAL_ACCEPTED', reason: 'Valid active proposal accepted automatically.', automatic: true });
}

function explicitDecision(proposal, explicit, config, errors) {
  if (explicit.action === 'reject') return baseDecision(proposal, { ...explicit, action: 'reject', automatic: false, reasonCode: explicit.reasonCode || 'EXPLICIT_REJECTION' });
  if (explicit.action === 'accept' && proposal.proposedStitchType === 'manual' && proposal.proposedEmbroideryRole !== 'manual_review') {
    if (!explicit.reviewerSource || !explicit.reason) {
      errors.push(issue('EXPLICIT_ACCEPT_DETAILS_REQUIRED', 'explicitReviewDecisions', 'Explicit manual acceptance requires reviewerSource and reason.'));
      return baseDecision(proposal, { action: 'blocked', reasonCode: 'INVALID_EXPLICIT_ACCEPT', reason: 'Explicit manual acceptance is incomplete.', automatic: false });
    }
    return baseDecision(proposal, { ...explicit, action: 'accept', automatic: false, reasonCode: explicit.reasonCode || 'EXPLICIT_MANUAL_ACCEPTANCE' });
  }
  if (explicit.action !== 'override') {
    errors.push(issue('INVALID_EXPLICIT_REVIEW_ACTION', 'action', 'Explicit review action must be reject, accept for manual stitch, or override.'));
    return baseDecision(proposal, { action: 'blocked', reasonCode: 'INVALID_EXPLICIT_REVIEW', reason: 'Explicit review action is invalid.', automatic: false });
  }
  const overrideErrors = validateExplicitOverride(proposal, explicit, config);
  if (overrideErrors.length) {
    errors.push(...overrideErrors);
    return baseDecision(proposal, { action: config.rejectInvalidExplicitOverrides ? 'reject' : 'blocked', reasonCode: 'INVALID_EXPLICIT_OVERRIDE', reason: 'Explicit override failed safety validation.', automatic: false, reviewerSource: explicit.reviewerSource ?? null });
  }
  return baseDecision(proposal, { ...explicit, action: 'override', automatic: false, reasonCode: explicit.reasonCode || 'VALID_EXPLICIT_OVERRIDE' });
}

export function resolveProposalReviewDecisions({ plan, explicitReviewDecisions = [], config = {} }) {
  const policyValidation = validateProposalReviewPolicyConfig(config);
  const resolvedConfig = resolveProposalReviewPolicyConfig(config);
  const proposals = [...(plan?.proposals || [])].sort((a, b) => a.id.localeCompare(b.id));
  const proposalIds = new Set(proposals.map(item => item.id));
  const errors = [...policyValidation.errors];
  const warnings = [];
  const explicitGroups = new Map();
  (Array.isArray(explicitReviewDecisions) ? explicitReviewDecisions : []).forEach((item, index) => {
    if (!proposalIds.has(item?.proposalId)) errors.push(issue('UNKNOWN_EXPLICIT_PROPOSAL_REFERENCE', `explicitReviewDecisions[${index}].proposalId`, `Unknown proposal "${item?.proposalId}".`));
    const group = explicitGroups.get(item?.proposalId) || [];
    group.push(item);
    explicitGroups.set(item?.proposalId, group);
  });
  let duplicateDecisionCount = 0;
  explicitGroups.forEach((group, proposalId) => {
    if (group.length > 1 && proposalIds.has(proposalId)) {
      duplicateDecisionCount += group.length - 1;
      errors.push(issue('DUPLICATE_EXPLICIT_REVIEW_DECISION', 'explicitReviewDecisions', `Proposal "${proposalId}" has duplicate explicit decisions.`));
    }
  });
  const decisions = proposals.map(proposal => {
    const explicit = explicitGroups.get(proposal.id) || [];
    if (explicit.length > 1) return baseDecision(proposal, { action: 'blocked', reasonCode: 'DUPLICATE_EXPLICIT_REVIEW', reason: 'Duplicate explicit decisions prevent safe resolution.', automatic: false });
    return explicit.length === 1 ? explicitDecision(proposal, explicit[0], resolvedConfig, errors) : automaticDecision(proposal, plan, resolvedConfig);
  });
  const decided = new Set(decisions.map(item => item.proposalId));
  const silentProposalDropCount = proposals.filter(item => !decided.has(item.id)).length;
  const summary = {
    sourceProposalCount: proposals.length,
    decisionCount: decisions.length,
    proposalDispositionCoveragePercent: proposals.length ? ((proposals.length - silentProposalDropCount) / proposals.length) * 100 : 100,
    silentProposalDropCount,
    duplicateDecisionCount,
    acceptedDecisionCount: decisions.filter(item => item.action === 'accept').length,
    excludedDecisionCount: decisions.filter(item => item.action === 'exclude').length,
    deferredDecisionCount: decisions.filter(item => item.action === 'defer').length,
    rejectedDecisionCount: decisions.filter(item => item.action === 'reject').length,
    overriddenDecisionCount: decisions.filter(item => item.action === 'override').length,
    blockedDecisionCount: decisions.filter(item => item.action === 'blocked').length,
  };
  return { decisions, byProposalId: Object.fromEntries(decisions.map(item => [item.proposalId, item])), valid: errors.length === 0 && summary.proposalDispositionCoveragePercent === 100 && duplicateDecisionCount === 0, errors, warnings, summary, config: resolvedConfig };
}
