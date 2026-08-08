export const PROPOSAL_REVIEW_ACTIONS = Object.freeze(['accept', 'exclude', 'defer', 'reject', 'override', 'blocked']);

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function reviewDecisionIdFor(proposalId) {
  return `review:${proposalId}`;
}

export function createProposalReviewDecisionV2(input = {}) {
  return deepFreeze({
    id: input.id ?? reviewDecisionIdFor(input.proposalId),
    proposalId: input.proposalId ?? null,
    regionId: input.regionId ?? null,
    action: input.action ?? 'blocked',
    proposedEmbroideryRole: input.proposedEmbroideryRole ?? null,
    proposedStitchType: input.proposedStitchType ?? null,
    approvedEmbroideryRole: input.approvedEmbroideryRole ?? input.proposedEmbroideryRole ?? null,
    approvedStitchType: input.approvedStitchType ?? input.proposedStitchType ?? null,
    reasonCode: input.reasonCode ?? null,
    reason: input.reason ?? null,
    automatic: input.automatic === true,
    reviewerSource: input.reviewerSource ?? null,
    confidence: Number.isFinite(input.confidence) ? input.confidence : 0,
    evidence: cloneValue(Array.isArray(input.evidence) ? input.evidence : []),
    source: cloneValue(input.source ?? null),
  });
}
