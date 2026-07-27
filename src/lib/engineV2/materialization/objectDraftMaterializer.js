import { validateEmbroideryObjectProposalV2 } from '../planning/objectPlanningValidation.js';
import { buildDraftPlanningParameters, createEmbroideryObjectDraftV2 } from './embroideryObjectDraftModel.js';
import { translateProposalDependenciesToDrafts } from './draftDependencyTranslator.js';
import { validateObjectDraftMaterialization } from './objectDraftValidation.js';
import { resolveProposalReviewDecisions } from './proposalReviewResolver.js';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function snapshot(value) { try { return JSON.stringify(value); } catch { return null; } }
function count(items, field, value) { return items.filter(item => item[field] === value).length; }

export function materializeEmbroideryObjectDrafts({ regions = [], graph, semanticResult, proposalPlan, explicitReviewDecisions = [], config = {} }) {
  const before = snapshot({ regions, graph, semanticResult, proposalPlan, explicitReviewDecisions });
  const review = resolveProposalReviewDecisions({ plan: proposalPlan, explicitReviewDecisions, config });
  const proposals = [...(proposalPlan?.proposals || [])].sort((a, b) => a.id.localeCompare(b.id));
  const regionIds = new Set(regions.map(item => item.id));
  const decisionMap = new Map(review.decisions.map(item => [item.proposalId, item]));
  const candidates = proposals.filter(proposal => {
    const decision = decisionMap.get(proposal.id);
    return ['accept', 'override'].includes(decision?.action)
      && regionIds.has(proposal.regionId)
      && !proposal.excluded
      && proposal.proposedEmbroideryRole !== 'manual_review'
      && validateEmbroideryObjectProposalV2(proposal).valid;
  }).map(proposal => ({ proposal, decision: decisionMap.get(proposal.id) }));
  const translated = translateProposalDependenciesToDrafts({ proposals, decisions: review.decisions, draftCandidates: candidates, config: review.config });
  const translatedDecisionMap = new Map(translated.decisions.map(item => [item.proposalId, item]));
  const drafts = translated.draftCandidates.map(candidate => {
    const decision = translatedDecisionMap.get(candidate.proposal.id);
    return createEmbroideryObjectDraftV2({
      proposalId: candidate.proposal.id,
      regionId: candidate.proposal.regionId,
      role: decision.approvedEmbroideryRole,
      stitchType: decision.approvedStitchType,
      geometryMm: candidate.proposal.geometryMm,
      holesMm: candidate.proposal.holesMm,
      visualColor: candidate.proposal.visualColor,
      layer: candidate.proposal.layer,
      dependencyIds: candidate.dependencyIds,
      planningConfidence: candidate.proposal.planningConfidence,
      materializationConfidence: Math.min(candidate.proposal.planningConfidence, decision.confidence),
      status: 'materialized_draft',
      threadAssignmentStatus: 'pending',
      entryCandidates: [],
      exitCandidates: [],
      parameters: buildDraftPlanningParameters(candidate.proposal, decision),
      evidence: [...candidate.proposal.evidence, ...decision.evidence, { code: 'UNTHREADED_DRAFT_MATERIALIZED', message: 'Accepted proposal materialized without thread assignment.' }],
      outlineEligibility: candidate.proposal.outlineEligibility,
      reviewDecisionId: decision.id,
      source: { proposalSource: candidate.proposal.source, reviewDecisionId: decision.id },
    });
  });
  const decisions = translated.decisions;
  const decided = new Set(decisions.map(item => item.proposalId));
  const silentProposalDropCount = proposals.filter(item => !decided.has(item.id)).length;
  const summary = {
    sourceProposalCount: proposals.length,
    decisionCount: decisions.length,
    proposalDispositionCoveragePercent: proposals.length ? ((proposals.length - silentProposalDropCount) / proposals.length) * 100 : 100,
    silentProposalDropCount,
    acceptedDecisionCount: count(decisions, 'action', 'accept'),
    excludedDecisionCount: count(decisions, 'action', 'exclude'),
    deferredDecisionCount: count(decisions, 'action', 'defer'),
    rejectedDecisionCount: count(decisions, 'action', 'reject'),
    overriddenDecisionCount: count(decisions, 'action', 'override'),
    blockedDecisionCount: count(decisions, 'action', 'blocked'),
    materializedDraftCount: drafts.length,
    baseFillDraftCount: count(drafts, 'role', 'base_fill'),
    foregroundFillDraftCount: count(drafts, 'role', 'foreground_fill'),
    internalDetailDraftCount: count(drafts, 'role', 'internal_detail'),
    darkDetailDraftCount: count(drafts, 'role', 'dark_detail'),
    highlightDraftCount: count(drafts, 'role', 'highlight'),
    outerOutlineDraftCount: count(drafts, 'role', 'outer_outline'),
    innerOutlineDraftCount: count(drafts, 'role', 'inner_outline'),
    manualStitchDraftCount: count(drafts, 'stitchType', 'manual'),
    pendingThreadAssignmentCount: count(drafts, 'threadAssignmentStatus', 'pending'),
    dependencyCount: translated.dependencyCount,
    dependencyCycleCount: translated.dependencyCycleCount,
    syntheticOutlineDraftCount: drafts.filter(item => ['outer_outline', 'inner_outline'].includes(item.role) && item.outlineEligibility?.regionBackedGeometry !== true).length,
    geometryMutationCount: drafts.filter(item => !same(item.geometryMm, proposals.find(proposal => proposal.id === item.proposalId)?.geometryMm)).length,
    visualColorMutationCount: drafts.filter(item => !same(item.visualColor, proposals.find(proposal => proposal.id === item.proposalId)?.visualColor)).length,
    threadIdCount: drafts.filter(item => Object.hasOwn(item, 'threadId')).length,
    stitchCoordinateCount: drafts.filter(item => Object.hasOwn(item, 'stitches') || Object.hasOwn(item, 'stitchCoordinates')).length,
    canonicalCommandCount: 0,
  };
  const materialization = {
    version: '2-object-draft-materialization', decisions, drafts,
    byDecisionId: Object.fromEntries(decisions.map(item => [item.id, item])),
    byProposalId: Object.fromEntries(decisions.map(item => [item.proposalId, item])),
    byDraftId: Object.fromEntries(drafts.map(item => [item.id, item])),
    byRegionId: Object.fromEntries(drafts.map(item => [item.regionId, item])),
    executionLayers: translated.executionLayers,
    valid: true,
    errors: [...review.errors, ...translated.errors],
    warnings: [...review.warnings, ...translated.warnings],
    summary,
    config: review.config,
    metadata: { inputMutationsDetected: before !== snapshot({ regions, graph, semanticResult, proposalPlan, explicitReviewDecisions }) },
  };
  const validation = validateObjectDraftMaterialization(materialization, proposalPlan, regions);
  return { ...materialization, valid: materialization.errors.length === 0 && validation.valid, errors: [...materialization.errors, ...validation.errors], warnings: [...materialization.warnings, ...validation.warnings] };
}
