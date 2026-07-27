import { validateGlobalSequencePlan } from './sequencePlanningValidation.js';

export function createGlobalSequenceDiagnostic({ regions = [], threadedObjectMaterialization, technicalPlan, sequencePlan }) {
  void regions;
  const validation = validateGlobalSequencePlan(sequencePlan, threadedObjectMaterialization, technicalPlan);
  const summary = sequencePlan?.summary || {};
  const metadata = sequencePlan?.metadata || {};
  const validPairCount = (sequencePlan?.selectedEntryExitPairs || []).filter(pair => pair.entryCandidateId && pair.exitCandidateId).length;
  return Object.freeze({
    valid: sequencePlan?.valid === true && validation.valid,
    sourceFinalObjectCount: summary.sourceFinalObjectCount ?? 0,
    dispositionCount: summary.dispositionCount ?? 0,
    sequenceDispositionCoveragePercent: summary.sequenceDispositionCoveragePercent ?? 0,
    silentFinalObjectDropCount: summary.silentFinalObjectDropCount ?? 0,
    scheduledObjectCount: summary.scheduledObjectCount ?? 0,
    manualRequiredCount: summary.manualRequiredCount ?? 0,
    blockedCount: summary.blockedCount ?? 0,
    selectedEntryExitPairCount: summary.selectedEntryExitPairCount ?? 0,
    validSelectedPairCount: validPairCount,
    invalidSelectedPairCount: (summary.selectedEntryExitPairCount ?? 0) - validPairCount,
    uniqueThreadCount: summary.uniqueThreadCount ?? 0,
    threadBlockCount: summary.threadBlockCount ?? 0,
    threadChangeCount: summary.threadChangeCount ?? 0,
    threadRevisitCount: summary.threadRevisitCount ?? 0,
    repeatedThreadReasons: (sequencePlan?.threadBlocks || []).filter(block => block.repeatedThreadReason).map(block => ({ threadId: block.threadId, reason: block.repeatedThreadReason })),
    dependencyCount: summary.structuralDependencyCount ?? 0,
    dependencyViolationCount: summary.dependencyViolationCount ?? 0,
    dependencyCycleCount: summary.dependencyCycleCount ?? 0,
    transitionCount: summary.transitionCount ?? 0,
    estimatedTravelMm: summary.estimatedTravelMm ?? 0,
    baselineEstimatedTravelMm: summary.baselineEstimatedTravelMm ?? 0,
    estimatedTravelReductionPercent: summary.estimatedTravelReductionPercent ?? 0,
    algorithmUsed: sequencePlan?.searchMetadata?.algorithmUsed ?? null,
    optimalityGuaranteed: sequencePlan?.searchMetadata?.optimalityGuaranteed === true,
    expandedStates: sequencePlan?.searchMetadata?.expandedStateCount ?? 0,
    prunedStates: sequencePlan?.searchMetadata?.prunedStateCount ?? 0,
    maximumExpandedStatesReached: sequencePlan?.searchMetadata?.maximumExpandedStatesReached === true,
    objectMutationsDetected: metadata.objectMutationsDetected === true,
    technicalSpecificationMutationsDetected: metadata.technicalSpecificationMutationsDetected === true,
    geometryMutationCount: summary.geometryMutationCount ?? 0,
    holeMutationCount: summary.holeMutationCount ?? 0,
    visualColorMutationCount: summary.visualColorMutationCount ?? 0,
    threadIdMutationCount: summary.threadIdMutationCount ?? 0,
    roleMutationCount: summary.roleMutationCount ?? 0,
    stitchTypeMutationCount: summary.stitchTypeMutationCount ?? 0,
    layerMutationCount: summary.layerMutationCount ?? 0,
    dependencyMutationCount: summary.dependencyMutationCount ?? 0,
    physicalStitchesGenerated: metadata.physicalStitchesGenerated === true,
    physicalUnderlayGenerated: metadata.physicalUnderlayGenerated === true,
    jumpCommandsGenerated: metadata.jumpCommandsGenerated === true,
    trimCommandsGenerated: metadata.trimCommandsGenerated === true,
    colorChangeCommandsGenerated: metadata.colorChangeCommandsGenerated === true,
    canonicalCommandsGenerated: metadata.canonicalCommandsGenerated === true,
    machineAdaptationApplied: metadata.machineAdaptationAdded === true,
    encodingApplied: metadata.encodingAdded === true,
    errors: Object.freeze([...(sequencePlan?.errors || []), ...validation.errors]),
    warnings: Object.freeze([...(sequencePlan?.warnings || []), ...validation.warnings]),
  });
}
