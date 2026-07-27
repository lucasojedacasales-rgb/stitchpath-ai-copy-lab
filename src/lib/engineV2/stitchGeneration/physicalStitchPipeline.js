import { isPointInEffectiveObjectArea, isPointOnObjectBoundary } from '../technical/objectGeometryMetrics.js';
import { validateGlobalSequencePlan } from '../sequencing/sequencePlanningValidation.js';
import { assembleObjectPhysicalStitchPath } from './objectPathAssembler.js';
import { resolvePhysicalGenerationConfig, validatePhysicalGenerationConfig } from './physicalGenerationConfig.js';
import { createMachineIndependentPhysicalStitchPlanV2, createObjectPhysicalStitchDispositionV2 } from './physicalStitchModel.js';
import { generatePhysicalUnderlay } from './physicalUnderlayGenerator.js';
import { validateMachineIndependentPhysicalStitchPlan } from './physicalStitchValidation.js';
import { generateRunningPhysicalPath } from './runningStitchGenerator.js';
import { generateSatinPhysicalPath } from './satinStitchGenerator.js';
import { distanceBetweenPoints, pointOnPolygonBoundary, pointsEqualWithinTolerance } from './stitchGeometry.js';
import { summarizeStitchLengths } from './stitchLengthDistribution.js';
import { generateTatamiPhysicalPath } from './tatamiStitchGenerator.js';

const snapshot = value => { try { return JSON.stringify(value); } catch { return null; } };
const issue = (code, path, message) => ({ code, path, message });
const generators = Object.freeze({ running: generateRunningPhysicalPath, tatami: generateTatamiPhysicalPath, satin: generateSatinPhysicalPath });

function pointValidForObject(point, object) {
  if (point.sourceType === 'compensation_adjusted_endpoint') return true;
  if (point.phase === 'entry_anchor' || point.phase === 'exit_anchor') return true;
  if (object.stitchType === 'running') return isPointOnObjectBoundary(point, object) || pointOnPolygonBoundary(point, object.geometry);
  if (pointOnPolygonBoundary(point, object.geometry) || (object.holes || []).some(hole => pointOnPolygonBoundary(point, hole))) return true;
  return isPointInEffectiveObjectArea(point, object, { boundaryInside: true });
}

function summaryFor(sequencePlan, dispositions, objectPaths, objectMap) {
  const generated = dispositions.filter(item => item.status === 'generated'); const allSubpaths = objectPaths.flatMap(path => path.subpaths); const stitchSubpaths = allSubpaths.filter(item => item.technique !== 'anchor');
  const lengths = stitchSubpaths.flatMap(item => item.points.slice(1).map((point, index) => distanceBetweenPoints(item.points[index], point))); const distribution = summarizeStitchLengths(lengths);
  const countGenerator = generator => objectPaths.filter(path => path.generator === generator).length; const stitchGenerator = generator => objectPaths.filter(path => path.generator === generator).reduce((sum, path) => sum + path.topStitchCount, 0);
  const compensationAdjustedPointCount = allSubpaths.flatMap(item => item.points).filter(point => point.sourceType === 'compensation_adjusted_endpoint').length;
  const invalidOutsidePointCount = objectPaths.reduce((sum, path) => { const object = objectMap.get(path.objectId); return sum + path.subpaths.flatMap(item => item.points).filter(point => !pointValidForObject(point, object)).length; }, 0);
  return {
    sourceScheduledObjectCount: sequencePlan.executionSteps.length, physicalDispositionCount: dispositions.length,
    physicalDispositionCoveragePercent: sequencePlan.executionSteps.length ? new Set(dispositions.map(item => item.objectId)).size / sequencePlan.executionSteps.length * 100 : 100,
    silentScheduledObjectDropCount: sequencePlan.executionSteps.filter(step => !dispositions.some(item => item.objectId === step.objectId)).length,
    duplicatePhysicalDispositionCount: dispositions.length - new Set(dispositions.map(item => item.objectId)).size,
    generatedDispositionCount: generated.length, manualRequiredCount: dispositions.filter(item => item.status === 'manual_required').length,
    blockedCount: dispositions.filter(item => item.status === 'blocked').length, generatedObjectPathCount: objectPaths.length,
    runningObjectPathCount: countGenerator('running'), tatamiObjectPathCount: countGenerator('tatami'), satinObjectPathCount: countGenerator('satin'),
    physicalSubpathCount: allSubpaths.length, physicalDiscontinuityCount: objectPaths.reduce((sum, path) => sum + path.subpathTransitions.length, 0),
    physicalPointCount: allSubpaths.reduce((sum, item) => sum + item.points.length, 0), physicalStitchCount: stitchSubpaths.reduce((sum, item) => sum + item.stitchCount, 0),
    underlayPointCount: objectPaths.reduce((sum, path) => sum + path.underlayPointCount, 0), underlayStitchCount: objectPaths.reduce((sum, path) => sum + path.underlayStitchCount, 0),
    topPointCount: objectPaths.reduce((sum, path) => sum + path.topPointCount, 0), topStitchCount: objectPaths.reduce((sum, path) => sum + path.topStitchCount, 0),
    runningStitchCount: stitchGenerator('running'), tatamiStitchCount: stitchGenerator('tatami'), satinStitchCount: stitchGenerator('satin'),
    minimumGeneratedStitchLengthMm: distribution.minimumMm, maximumGeneratedStitchLengthMm: distribution.maximumMm,
    averageGeneratedStitchLengthMm: distribution.averageMm, totalGeneratedStitchLengthMm: distribution.totalMm,
    explicitHoleObjectCount: objectPaths.filter(path => (objectMap.get(path.objectId)?.holes || []).length).length,
    holeCrossingSegmentCount: objectPaths.reduce((sum, path) => sum + (path.coverageMetrics.holeCrossingSegmentCount || 0), 0),
    invalidOutsidePointCount, compensationAdjustedPointCount,
    selectedEntryAnchorMatchCount: objectPaths.filter(path => pointsEqualWithinTolerance(path.firstPhysicalPoint, path.selectedEntryPoint)).length,
    selectedExitAnchorMatchCount: objectPaths.filter(path => pointsEqualWithinTolerance(path.lastPhysicalPoint, path.selectedExitPoint)).length,
    selectedCandidateIdentityMutationCount: 0, globalSequenceMutationCount: 0, threadBlockMutationCount: 0, objectMutationCount: 0, technicalSpecificationMutationCount: 0,
    pointLimitExceededCount: dispositions.filter(item => item.reasonCode === 'PHYSICAL_GENERATION_LIMIT_EXCEEDED').length,
    truncatedPathCount: 0, partialAcceptedPathCount: 0, canonicalCommandCount: 0, jumpCommandCount: 0, trimCommandCount: 0, colorChangeCommandCount: 0, endCommandCount: 0,
  };
}

export function buildMachineIndependentPhysicalStitchPlan({ regions = [], threadedObjectMaterialization, technicalPlan, sequencePlan, config: rawConfig = {} }) {
  const before = snapshot({ regions, threadedObjectMaterialization, technicalPlan, sequencePlan, rawConfig }); const config = resolvePhysicalGenerationConfig(rawConfig); const configValidation = validatePhysicalGenerationConfig(config);
  const sequenceValidation = validateGlobalSequencePlan(sequencePlan, threadedObjectMaterialization, technicalPlan); const errors = [...configValidation.errors, ...sequenceValidation.errors]; const warnings = [...configValidation.warnings, ...sequenceValidation.warnings];
  const objectMap = new Map((threadedObjectMaterialization?.objects || []).map(item => [item.id, item])); const specificationMap = new Map((technicalPlan?.specifications || []).map(item => [item.objectId, item])); const selectionMap = new Map((sequencePlan?.selectedEntryExitPairs || []).map(item => [item.objectId, item]));
  const dispositions = []; const objectPaths = []; let totalPoints = 0;
  for (const executionStep of sequencePlan?.executionSteps || []) {
    const object = objectMap.get(executionStep.objectId); const technicalSpecification = specificationMap.get(executionStep.objectId); const selectedEntryExit = selectionMap.get(executionStep.objectId); const generator = generators[object?.stitchType];
    const dispositionBase = { objectId: executionStep.objectId, executionStepId: executionStep.id, technicalSpecificationId: technicalSpecification?.id, generator: object?.stitchType ?? null, source: { pipeline: 'engineV2-phase9' } };
    if (!object || !technicalSpecification || !selectedEntryExit || technicalSpecification.status !== 'planned' || technicalSpecification.generatorReadiness?.ready !== true) { dispositions.push(createObjectPhysicalStitchDispositionV2({ ...dispositionBase, status: technicalSpecification?.status === 'manual_required' ? 'manual_required' : 'blocked', reasonCode: 'PHYSICAL_INPUT_NOT_GENERATOR_READY', reason: 'Object, technical specification, or selected anchors are unavailable.' })); continue; }
    if (!generator) { dispositions.push(createObjectPhysicalStitchDispositionV2({ ...dispositionBase, status: object.stitchType === 'manual' ? 'manual_required' : 'blocked', reasonCode: 'UNSUPPORTED_PHYSICAL_GENERATOR', reason: `No Phase 9 generator exists for ${object.stitchType}.` })); continue; }
    const generatedUnderlay = generatePhysicalUnderlay({ object, technicalSpecification, selectedEntryExit, config });
    const generatedTopPath = config.includeTopStitches ? generator({ object, technicalSpecification, selectedEntryExit, config }) : { valid: true, subpaths: [], errors: [], warnings: [], coverageMetrics: {} };
    if (!generatedUnderlay.valid || !generatedTopPath.valid) {
      const generationErrors = [...(generatedUnderlay.errors || []), ...(generatedTopPath.errors || [])]; const limit = generationErrors.some(item => item.code === 'PHYSICAL_GENERATION_LIMIT_EXCEEDED');
      dispositions.push(createObjectPhysicalStitchDispositionV2({ ...dispositionBase, status: 'blocked', reasonCode: limit ? 'PHYSICAL_GENERATION_LIMIT_EXCEEDED' : 'PHYSICAL_GENERATOR_FAILED', reason: generationErrors.map(item => item.code).join(', ') || 'Physical generator failed.', evidence: generationErrors })); warnings.push(...(generatedUnderlay.warnings || []), ...(generatedTopPath.warnings || [])); continue;
    }
    const path = assembleObjectPhysicalStitchPath({ object, technicalSpecification, executionStep, selectedEntryExit, generatedUnderlay, generatedTopPath, config });
    if (path.physicalPointCount > config.maximumPointsPerObject || totalPoints + path.physicalPointCount > config.maximumTotalPoints) { dispositions.push(createObjectPhysicalStitchDispositionV2({ ...dispositionBase, status: 'blocked', reasonCode: 'PHYSICAL_GENERATION_LIMIT_EXCEEDED', reason: 'Physical point limit exceeded; no partial path was accepted.', evidence: [{ requestedObjectPoints: path.physicalPointCount, requestedTotalPoints: totalPoints + path.physicalPointCount }] })); continue; }
    totalPoints += path.physicalPointCount; objectPaths.push(path); dispositions.push(createObjectPhysicalStitchDispositionV2({ ...dispositionBase, status: 'generated', reasonCode: 'PHYSICAL_PATH_GENERATED', reason: 'Machine-independent physical path generated successfully.', evidence: [{ physicalPointCount: path.physicalPointCount, physicalStitchCount: path.physicalStitchCount }] }));
  }
  const inputMutationsDetected = before !== snapshot({ regions, threadedObjectMaterialization, technicalPlan, sequencePlan, rawConfig }); const summary = summaryFor(sequencePlan, dispositions, objectPaths, objectMap);
  const metadata = { inputMutationsDetected, physicalStitchesGenerated: summary.physicalStitchCount > 0, physicalUnderlayGenerated: summary.underlayStitchCount > 0, globalSequenceModified: false, threadBlocksModified: false, selectedEntryExitModified: false, objectGeometryModified: false, objectHolesModified: false, objectVisualColorsModified: false, threadIdsModified: false, rolesModified: false, stitchTypesModified: false, layersModified: false, dependenciesModified: false, technicalSpecificationsModified: false, pathsTruncated: 0, partialFailedPathsAccepted: 0, canonicalCommandsGenerated: false, jumpCommandsGenerated: false, trimCommandsGenerated: false, colorChangeCommandsGenerated: false, endCommandsGenerated: false, machineAdaptationAdded: false, encodingAdded: false };
  const draft = { version: '2-machine-independent-physical-stitch-plan', dispositions, objectPaths, executionOrder: (sequencePlan?.executionSteps || []).map(item => item.objectId), threadBlockReferences: sequencePlan?.threadBlocks || [], byDispositionId: Object.fromEntries(dispositions.map(item => [item.id, item])), byObjectId: Object.fromEntries(objectPaths.map(item => [item.objectId, item])), byExecutionStepId: Object.fromEntries(objectPaths.map(item => [item.executionStepId, item])), valid: errors.length === 0, errors, warnings, summary, config, metadata };
  const validation = validateMachineIndependentPhysicalStitchPlan(draft, threadedObjectMaterialization, technicalPlan, sequencePlan); if (!validation.valid) errors.push(...validation.errors); warnings.push(...validation.warnings);
  return createMachineIndependentPhysicalStitchPlanV2({ ...draft, valid: errors.length === 0, errors, warnings });
}
