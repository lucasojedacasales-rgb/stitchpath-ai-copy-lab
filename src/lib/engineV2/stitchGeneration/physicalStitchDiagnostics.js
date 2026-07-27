import { validateMachineIndependentPhysicalStitchPlan } from './physicalStitchValidation.js';

export function createPhysicalStitchDiagnostic({ regions = [], threadedObjectMaterialization, technicalPlan, sequencePlan, physicalPlan }) {
  void regions; const validation = validateMachineIndependentPhysicalStitchPlan(physicalPlan, threadedObjectMaterialization, technicalPlan, sequencePlan); const summary = physicalPlan?.summary || {}; const metadata = physicalPlan?.metadata || {};
  const generatorDistribution = Object.fromEntries(['running', 'tatami', 'satin'].map(generator => [generator, (physicalPlan?.objectPaths || []).filter(path => path.generator === generator).length]));
  const underlayDistribution = {}; (physicalPlan?.objectPaths || []).flatMap(path => path.subpaths).filter(subpath => subpath.phase === 'underlay').forEach(subpath => { underlayDistribution[subpath.technique] = (underlayDistribution[subpath.technique] || 0) + 1; });
  return Object.freeze({
    valid: physicalPlan?.valid === true && validation.valid, sourceScheduledObjectCount: summary.sourceScheduledObjectCount ?? 0,
    physicalDispositionCount: summary.physicalDispositionCount ?? 0, physicalDispositionCoveragePercent: summary.physicalDispositionCoveragePercent ?? 0,
    silentScheduledObjectDropCount: summary.silentScheduledObjectDropCount ?? 0, generatedObjectPathCount: summary.generatedObjectPathCount ?? 0,
    manualRequiredCount: summary.manualRequiredCount ?? 0, blockedCount: summary.blockedCount ?? 0, generatorDistribution,
    physicalSubpathCount: summary.physicalSubpathCount ?? 0, physicalDiscontinuityCount: summary.physicalDiscontinuityCount ?? 0,
    physicalPointCount: summary.physicalPointCount ?? 0, physicalStitchCount: summary.physicalStitchCount ?? 0,
    underlayPointCount: summary.underlayPointCount ?? 0, underlayStitchCount: summary.underlayStitchCount ?? 0,
    topPointCount: summary.topPointCount ?? 0, topStitchCount: summary.topStitchCount ?? 0,
    stitchLengthDistribution: { minimumMm: summary.minimumGeneratedStitchLengthMm ?? 0, maximumMm: summary.maximumGeneratedStitchLengthMm ?? 0, averageMm: summary.averageGeneratedStitchLengthMm ?? 0 },
    totalGeneratedStitchLengthMm: summary.totalGeneratedStitchLengthMm ?? 0,
    TatamiMetrics: { objectPathCount: summary.tatamiObjectPathCount ?? 0, stitchCount: summary.tatamiStitchCount ?? 0 }, SatinMetrics: { objectPathCount: summary.satinObjectPathCount ?? 0, stitchCount: summary.satinStitchCount ?? 0 }, RunningMetrics: { objectPathCount: summary.runningObjectPathCount ?? 0, stitchCount: summary.runningStitchCount ?? 0 }, underlayDistribution,
    explicitHoleObjectCount: summary.explicitHoleObjectCount ?? 0, holeCrossingSegmentCount: summary.holeCrossingSegmentCount ?? 0, invalidOutsidePointCount: summary.invalidOutsidePointCount ?? 0, compensationAdjustedPointCount: summary.compensationAdjustedPointCount ?? 0,
    entryAnchorMismatchCount: (summary.generatedObjectPathCount ?? 0) - (summary.selectedEntryAnchorMatchCount ?? 0), exitAnchorMismatchCount: (summary.generatedObjectPathCount ?? 0) - (summary.selectedExitAnchorMatchCount ?? 0), selectedCandidateIdentityMutationCount: summary.selectedCandidateIdentityMutationCount ?? 0,
    pointLimitExceededCount: summary.pointLimitExceededCount ?? 0, truncatedPathCount: summary.truncatedPathCount ?? 0, partialAcceptedPathCount: summary.partialAcceptedPathCount ?? 0,
    objectMutationsDetected: metadata.objectGeometryModified === true || metadata.objectHolesModified === true || metadata.objectVisualColorsModified === true,
    technicalSpecificationMutationsDetected: metadata.technicalSpecificationsModified === true, sequencePlanMutationsDetected: metadata.globalSequenceModified === true, threadBlockMutationsDetected: metadata.threadBlocksModified === true,
    geometryMutationCount: metadata.objectGeometryModified ? 1 : 0, holeMutationCount: metadata.objectHolesModified ? 1 : 0, visualColorMutationCount: metadata.objectVisualColorsModified ? 1 : 0,
    threadIdMutationCount: metadata.threadIdsModified ? 1 : 0, roleMutationCount: metadata.rolesModified ? 1 : 0, stitchTypeMutationCount: metadata.stitchTypesModified ? 1 : 0, layerMutationCount: metadata.layersModified ? 1 : 0, dependencyMutationCount: metadata.dependenciesModified ? 1 : 0,
    physicalStitchesGenerated: metadata.physicalStitchesGenerated === true, physicalUnderlayGenerated: metadata.physicalUnderlayGenerated === true,
    canonicalCommandsGenerated: metadata.canonicalCommandsGenerated === true, jumpCommandsGenerated: metadata.jumpCommandsGenerated === true, trimCommandsGenerated: metadata.trimCommandsGenerated === true, colorChangeCommandsGenerated: metadata.colorChangeCommandsGenerated === true, endCommandsGenerated: metadata.endCommandsGenerated === true,
    machineAdaptationApplied: metadata.machineAdaptationAdded === true, encodingApplied: metadata.encodingAdded === true,
    errors: Object.freeze([...(physicalPlan?.errors || []), ...validation.errors]), warnings: Object.freeze([...(physicalPlan?.warnings || []), ...validation.warnings]),
  });
}
