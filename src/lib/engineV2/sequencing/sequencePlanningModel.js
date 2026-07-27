export const SEQUENCE_DISPOSITION_STATUSES = Object.freeze(['scheduled', 'manual_required', 'blocked']);
export const REPEATED_THREAD_REASONS = Object.freeze([
  'dependency_gated_revisit',
  'explicit_sequence_override',
  'bounded_search_revisit',
]);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
}
export function deepFreezeSequenceValue(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreezeSequenceValue);
  return Object.freeze(value);
}

export function sequenceDispositionIdForObject(objectId) {
  return `sequence-disposition:${objectId}`;
}

export function selectedEntryExitIdForObject(objectId) {
  return `selected-entry-exit:${objectId}`;
}

export function executionStepId(sequenceIndex, objectId) {
  return `execution:${String(sequenceIndex).padStart(4, '0')}:${objectId}`;
}

export function transitionId(fromObjectId, toObjectId) {
  return `transition:${fromObjectId}:${toObjectId}`;
}

export function createObjectSequenceDispositionV2(input = {}) {
  return deepFreezeSequenceValue({
    id: input.id ?? sequenceDispositionIdForObject(input.objectId),
    objectId: input.objectId ?? null,
    technicalSpecificationId: input.technicalSpecificationId ?? null,
    status: input.status ?? 'blocked',
    reasonCode: input.reasonCode ?? null,
    reason: input.reason ?? null,
    automatic: input.automatic !== false,
    evidence: clone(Array.isArray(input.evidence) ? input.evidence : []),
    source: clone(input.source ?? null),
  });
}

export function createSelectedEntryExitPairV2(input = {}) {
  return deepFreezeSequenceValue({
    id: input.id ?? selectedEntryExitIdForObject(input.objectId),
    objectId: input.objectId ?? null,
    entryCandidateId: input.entryCandidateId ?? null,
    exitCandidateId: input.exitCandidateId ?? null,
    entryPoint: clone(input.entryPoint ?? null),
    exitPoint: clone(input.exitPoint ?? null),
    entrySourceType: input.entrySourceType ?? null,
    exitSourceType: input.exitSourceType ?? null,
    incomingTravelMm: Number.isFinite(input.incomingTravelMm) ? input.incomingTravelMm : 0,
    reason: input.reason ?? 'selected_by_global_sequence_planner',
    source: clone(input.source ?? null),
  });
}

export function createObjectExecutionStepV2(input = {}) {
  return deepFreezeSequenceValue({
    id: input.id ?? executionStepId(input.sequenceIndex, input.objectId),
    sequenceIndex: Number.isInteger(input.sequenceIndex) ? input.sequenceIndex : null,
    objectId: input.objectId ?? null,
    regionId: input.regionId ?? null,
    threadId: input.threadId ?? null,
    threadBlockId: input.threadBlockId ?? null,
    technicalSpecificationId: input.technicalSpecificationId ?? null,
    selectedEntryExitId: input.selectedEntryExitId ?? null,
    structuralDependencyIds: clone(Array.isArray(input.structuralDependencyIds) ? input.structuralDependencyIds : []),
    executionLayer: Number.isInteger(input.executionLayer) ? input.executionLayer : 0,
    role: input.role ?? null,
    stitchType: input.stitchType ?? null,
    source: clone(input.source ?? null),
  });
}

export function createSequenceTransitionV2(input = {}) {
  return deepFreezeSequenceValue({
    id: input.id ?? transitionId(input.fromObjectId, input.toObjectId),
    fromObjectId: input.fromObjectId ?? null,
    toObjectId: input.toObjectId ?? null,
    fromExitCandidateId: input.fromExitCandidateId ?? null,
    toEntryCandidateId: input.toEntryCandidateId ?? null,
    distanceMm: Number.isFinite(input.distanceMm) ? input.distanceMm : null,
    threadChanged: input.threadChanged === true,
    sameThread: input.sameThread === true,
    dependencyRelated: input.dependencyRelated === true,
    source: clone(input.source ?? null),
  });
}

export function createSequenceSearchMetadataV2(input = {}) {
  return deepFreezeSequenceValue({
    algorithmRequested: input.algorithmRequested ?? 'auto',
    algorithmUsed: input.algorithmUsed ?? null,
    exactSearchObjectLimit: input.exactSearchObjectLimit ?? null,
    beamWidth: input.beamWidth ?? null,
    maximumExpandedStates: input.maximumExpandedStates ?? null,
    optimalityGuaranteed: input.optimalityGuaranteed === true,
    expandedStateCount: input.expandedStateCount ?? 0,
    prunedStateCount: input.prunedStateCount ?? 0,
    maximumExpandedStatesReached: input.maximumExpandedStatesReached === true,
    fallbackUsed: input.fallbackUsed === true,
    costTuple: clone(input.costTuple ?? null),
    stableSignature: input.stableSignature ?? '',
  });
}

export function createGlobalSequencePlanV2(input = {}) {
  const dispositions = clone(input.dispositions ?? []);
  const selectedEntryExitPairs = clone(input.selectedEntryExitPairs ?? []);
  const executionSteps = clone(input.executionSteps ?? []);
  const transitions = clone(input.transitions ?? []);
  const threadBlocks = clone(input.threadBlocks ?? []);
  return deepFreezeSequenceValue({
    version: input.version ?? '2-global-sequence-plan',
    dispositions,
    selectedEntryExitPairs,
    executionSteps,
    transitions,
    threadBlocks,
    executionLayers: clone(input.executionLayers ?? []),
    byObjectId: clone(input.byObjectId ?? {}),
    byDispositionId: clone(input.byDispositionId ?? Object.fromEntries(dispositions.map(item => [item.id, item]))),
    bySelectedEntryExitId: clone(input.bySelectedEntryExitId ?? Object.fromEntries(selectedEntryExitPairs.map(item => [item.id, item]))),
    byExecutionId: clone(input.byExecutionId ?? Object.fromEntries(executionSteps.map(item => [item.id, item]))),
    byThreadBlockId: clone(input.byThreadBlockId ?? Object.fromEntries(threadBlocks.map(item => [item.id, item]))),
    searchMetadata: clone(input.searchMetadata ?? null),
    valid: input.valid === true,
    errors: clone(input.errors ?? []),
    warnings: clone(input.warnings ?? []),
    summary: clone(input.summary ?? {}),
    config: clone(input.config ?? {}),
    metadata: clone(input.metadata ?? {}),
  });
}
