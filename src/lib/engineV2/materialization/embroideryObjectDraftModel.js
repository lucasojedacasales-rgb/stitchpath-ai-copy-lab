export const EMBROIDERY_DRAFT_ROLES = Object.freeze(['base_fill', 'foreground_fill', 'internal_detail', 'dark_detail', 'outer_outline', 'inner_outline', 'highlight']);
export const EMBROIDERY_DRAFT_STITCH_TYPES = Object.freeze(['tatami', 'satin', 'running', 'manual']);

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

export function draftIdFor(proposalId) {
  return `draft:${proposalId}`;
}

export function createEmbroideryObjectDraftV2(input = {}) {
  return deepFreeze({
    id: input.id ?? draftIdFor(input.proposalId),
    proposalId: input.proposalId ?? null,
    regionId: input.regionId ?? null,
    role: input.role ?? null,
    stitchType: input.stitchType ?? null,
    geometryMm: cloneValue(input.geometryMm ?? []),
    holesMm: cloneValue(input.holesMm ?? []),
    visualColor: cloneValue(input.visualColor ?? null),
    layer: Number.isFinite(input.layer) ? input.layer : 0,
    dependencyIds: [...new Set(Array.isArray(input.dependencyIds) ? input.dependencyIds : [])].sort(),
    planningConfidence: Number.isFinite(input.planningConfidence) ? input.planningConfidence : 0,
    materializationConfidence: Number.isFinite(input.materializationConfidence) ? input.materializationConfidence : 0,
    status: input.status ?? 'materialized_draft',
    threadAssignmentStatus: input.threadAssignmentStatus ?? 'pending',
    entryCandidates: cloneValue(input.entryCandidates ?? []),
    exitCandidates: cloneValue(input.exitCandidates ?? []),
    parameters: cloneValue(input.parameters ?? {}),
    evidence: cloneValue(Array.isArray(input.evidence) ? input.evidence : []),
    outlineEligibility: cloneValue(input.outlineEligibility ?? null),
    reviewDecisionId: input.reviewDecisionId ?? null,
    source: cloneValue(input.source ?? null),
  });
}

export function buildDraftPlanningParameters(proposal, decision) {
  const stitchType = decision.approvedStitchType;
  return {
    planning: {
      proposedRole: proposal.proposedEmbroideryRole,
      proposedStitchType: proposal.proposedStitchType,
      semanticRole: proposal.semanticRole,
      sourcePlanningConfidence: proposal.planningConfidence,
      reviewAction: decision.action,
    },
    generatorRequirements: {
      requiresTatamiGenerator: stitchType === 'tatami',
      requiresSatinGenerator: stitchType === 'satin',
      requiresRunningGenerator: stitchType === 'running',
      requiresManualGenerator: stitchType === 'manual',
    },
    deferred: {
      threadAssignment: true,
      stitchGeneration: true,
      underlayPlanning: true,
      fillAngleSelection: true,
      densitySelection: true,
      pullCompensation: true,
      entryExitPlanning: true,
      globalSequencing: true,
      machineAdaptation: true,
    },
  };
}
