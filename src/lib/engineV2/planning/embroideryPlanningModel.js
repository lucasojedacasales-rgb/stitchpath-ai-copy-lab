export const EMBROIDERY_PROPOSAL_ROLES = Object.freeze([
  'base_fill', 'foreground_fill', 'internal_detail', 'dark_detail',
  'outer_outline', 'inner_outline', 'highlight', 'manual_review', 'excluded',
]);

export const EMBROIDERY_PROPOSAL_STITCH_TYPES = Object.freeze(['tatami', 'satin', 'running', 'manual', 'none']);

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

export function proposalIdFor(regionId, proposedEmbroideryRole) {
  return `proposal:${regionId}:${proposedEmbroideryRole}`;
}

export function createEmbroideryObjectProposalV2(input = {}) {
  const role = input.proposedEmbroideryRole ?? 'manual_review';
  const proposal = {
    id: input.id ?? proposalIdFor(input.regionId, role),
    regionId: input.regionId ?? null,
    semanticRole: input.semanticRole ?? 'unknown',
    proposedEmbroideryRole: role,
    proposedStitchType: input.proposedStitchType ?? 'manual',
    geometryMm: cloneValue(input.geometryMm ?? []),
    holesMm: cloneValue(input.holesMm ?? []),
    visualColor: cloneValue(input.visualColor ?? null),
    layer: Number.isFinite(input.layer) ? input.layer : 0,
    dependencyIds: [...new Set(Array.isArray(input.dependencyIds) ? input.dependencyIds : [])].sort(),
    excluded: input.excluded === true,
    exclusionReason: input.exclusionReason ?? null,
    planningConfidence: Number.isFinite(input.planningConfidence) ? input.planningConfidence : 0,
    needsReview: input.needsReview === true,
    evidence: cloneValue(Array.isArray(input.evidence) ? input.evidence : []),
    alternatives: cloneValue(Array.isArray(input.alternatives) ? input.alternatives : []),
    outlineEligibility: cloneValue(input.outlineEligibility ?? null),
    source: cloneValue(input.source ?? null),
  };
  return deepFreeze(proposal);
}

export function cloneProposalWithDependencies(proposal, dependencyIds) {
  return createEmbroideryObjectProposalV2({ ...proposal, dependencyIds });
}
