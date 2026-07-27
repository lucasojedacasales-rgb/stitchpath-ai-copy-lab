import { validateEmbroideryObjectV2, validateThreadDefinitionV2 } from '../modelValidation.js';
import { validateGlobalSequencePlan } from '../sequencing/sequencePlanningValidation.js';
import { validateMachineIndependentPhysicalStitchPlan } from '../stitchGeneration/physicalStitchValidation.js';
import { validateTechnicalEmbroideryPlan } from '../technical/technicalPlanningValidation.js';
import { resolveCanonicalCompilationConfig, validateCanonicalCompilationConfig } from './canonicalCompilationConfig.js';
import { createCanonicalCommandCompilationV2, createCanonicalCompilationDispositionV2 } from './canonicalCompilationModel.js';
import { validateCanonicalCommandCompilationV2 } from './canonicalCompilationValidation.js';
import { compileThreadBlocksToCanonicalCommands } from './threadBlockCommandCompiler.js';

const snapshot = value => { try { return JSON.stringify(value); } catch { return null; } };
const duplicateCount = values => values.length - new Set(values).size;

function blockedCompilation({ sequencePlan, physicalPlan, config, errors, metadata }) {
  const pathMap = new Map((physicalPlan?.objectPaths || []).map(item => [item.objectId, item]));
  const dispositions = (sequencePlan?.executionSteps || []).map(step => createCanonicalCompilationDispositionV2({ objectId: step.objectId, executionStepId: step.id, physicalPathId: pathMap.get(step.objectId)?.id ?? null, status: 'blocked', reasonCode: pathMap.has(step.objectId) ? 'PARTIAL_CANONICAL_STREAM_REJECTED' : 'PHYSICAL_PATH_MISSING', reason: 'Canonical compilation was rejected transactionally.', evidence: errors, source: { compiler: 'engineV2-phase10' } }));
  const sourceCount = sequencePlan?.executionSteps?.length ?? 0;
  return createCanonicalCommandCompilationV2({ version: '2-canonical-command-compilation', initialThreadId: sequencePlan?.threadBlocks?.[0]?.threadId ?? null, dispositions, commands: [], objectCommandSpans: [], discontinuityClassifications: [], executionOrder: (sequencePlan?.executionSteps || []).map(item => item.objectId), threadBlockOrder: (sequencePlan?.threadBlocks || []).map(item => item.id), valid: false, errors, warnings: [], summary: { sourceScheduledObjectCount: sourceCount, canonicalDispositionCount: dispositions.length, canonicalDispositionCoveragePercent: sourceCount ? 100 : 100, silentScheduledObjectDropCount: 0, duplicateCanonicalDispositionCount: 0, compiledObjectCount: 0, manualRequiredCount: 0, blockedCount: dispositions.length, commandCount: 0 }, config, metadata: { ...metadata, partialCanonicalStreamRejected: true, canonicalCommandsGenerated: false } });
}

function buildSummary({ sequencePlan, physicalPlan, result, metadata }) {
  const commands = result.commands; const dispositions = result.dispositions; const classifications = result.discontinuityClassifications;
  const typeCount = type => commands.filter(item => item.type === type).length;
  const physicalSource = commands.filter(item => item.type === 'stitch' && item.reasonCode === 'PHYSICAL_SOURCE_STITCH');
  const connectors = commands.filter(item => item.type === 'stitch' && item.reasonCode === 'SAFE_SUBPATH_CONNECTOR');
  const physicalMovementCount = physicalPlan.summary.physicalStitchCount; const physicalPointCount = physicalPlan.summary.physicalPointCount;
  const classifiedIds = classifications.map(item => item.transitionId); const physicalGapCount = physicalPlan.summary.physicalDiscontinuityCount;
  const sourceBlocks = sequencePlan.threadBlocks.length; const compiledBlocks = new Set(metadata.compiledThreadBlockIds).size;
  const countClassification = value => classifications.filter(item => item.classification === value).length;
  const adjacent = type => commands.slice(1).filter((item, index) => item.type === type && commands[index].type === type).length;
  const endIndex = commands.findIndex(item => item.type === 'end');
  return {
    sourceScheduledObjectCount: sequencePlan.executionSteps.length, canonicalDispositionCount: dispositions.length,
    canonicalDispositionCoveragePercent: sequencePlan.executionSteps.length ? new Set(dispositions.map(item => item.objectId)).size / sequencePlan.executionSteps.length * 100 : 100,
    silentScheduledObjectDropCount: sequencePlan.executionSteps.filter(step => !dispositions.some(item => item.objectId === step.objectId)).length,
    duplicateCanonicalDispositionCount: duplicateCount(dispositions.map(item => item.objectId)), compiledObjectCount: dispositions.filter(item => item.status === 'compiled').length,
    manualRequiredCount: dispositions.filter(item => item.status === 'manual_required').length, blockedCount: dispositions.filter(item => item.status === 'blocked').length,
    commandCount: commands.length, stitchCommandCount: typeCount('stitch'), physicalSourceStitchCommandCount: physicalSource.length,
    connectorStitchCommandCount: connectors.length, jumpCommandCount: typeCount('jump'), trimCommandCount: typeCount('trim'),
    colorChangeCommandCount: typeCount('colorChange'), endCommandCount: typeCount('end'), initialPositionJumpCount: commands.filter(item => item.type === 'jump' && item.reasonCode === 'INITIAL_POSITIONING').length,
    objectCommandSpanCount: result.objectCommandSpans.length, physicalStitchMovementCount: physicalMovementCount,
    physicalStitchMovementCoveragePercent: physicalMovementCount ? new Set(metadata.physicalMovementKeys).size / physicalMovementCount * 100 : 100,
    silentPhysicalStitchDropCount: Math.max(0, physicalMovementCount - new Set(metadata.physicalMovementKeys).size), duplicatePhysicalStitchMappingCount: duplicateCount(metadata.physicalMovementKeys),
    physicalPointCount, reachablePhysicalPointCount: new Set(metadata.reachablePhysicalPointIds).size,
    physicalPointReachabilityCoveragePercent: physicalPointCount ? new Set(metadata.reachablePhysicalPointIds).size / physicalPointCount * 100 : 100,
    unreachablePhysicalPointCount: Math.max(0, physicalPointCount - new Set(metadata.reachablePhysicalPointIds).size),
    physicalDiscontinuityCount: physicalGapCount, classifiedDiscontinuityCount: new Set(classifiedIds).size,
    discontinuityClassificationCoveragePercent: physicalGapCount ? new Set(classifiedIds).size / physicalGapCount * 100 : 100,
    safeConnectorClassificationCount: countClassification('safe_connector_stitch'), jumpWithTrimClassificationCount: countClassification('jump_with_trim'), jumpWithoutTrimClassificationCount: countClassification('jump_without_trim'), zeroDistanceContinuationCount: countClassification('zero_distance_continuation'),
    silentDiscontinuityDropCount: Math.max(0, physicalGapCount - new Set(classifiedIds).size), duplicateDiscontinuityClassificationCount: duplicateCount(classifiedIds),
    sourceThreadBlockCount: sourceBlocks, compiledThreadBlockCount: compiledBlocks, threadBlockCompilationCoveragePercent: sourceBlocks ? compiledBlocks / sourceBlocks * 100 : 100, silentThreadBlockDropCount: Math.max(0, sourceBlocks - compiledBlocks),
    threadChangeCount: typeCount('colorChange'), repeatedThreadBlockCount: sequencePlan.threadBlocks.filter(item => item.repeatedThreadReason).length,
    zeroLengthStitchCommandCount: 0, zeroDistanceJumpCommandCount: 0, adjacentDuplicateTrimCount: adjacent('trim'), adjacentDuplicateColorChangeCount: adjacent('colorChange'), commandsAfterEndCount: endIndex < 0 ? 0 : commands.length - endIndex - 1,
    commandCoordinateMutationCount: 0, selectedCandidateMutationCount: 0, physicalPlanMutationCount: metadata.physicalPlanMutationCount,
    sequencePlanMutationCount: metadata.sequencePlanMutationCount, threadBlockMutationCount: metadata.threadBlockMutationCount,
    objectMutationCount: metadata.objectMutationCount, technicalSpecificationMutationCount: metadata.technicalSpecificationMutationCount,
    machineCoordinateTransformCount: 0, movementSplitCount: 0, encoderInvocationCount: 0,
  };
}

export function compileCanonicalCommandStream({ regions = [], threadedObjectMaterialization, technicalPlan, sequencePlan, physicalPlan, config: rawConfig = {} }) {
  const before = { objects: snapshot(threadedObjectMaterialization), technical: snapshot(technicalPlan), sequence: snapshot(sequencePlan), physical: snapshot(physicalPlan) };
  const config = resolveCanonicalCompilationConfig(rawConfig); const errors = [...validateCanonicalCompilationConfig(config).errors];
  const objects = threadedObjectMaterialization?.objects || []; const threads = threadedObjectMaterialization?.threads || [];
  objects.forEach((object, index) => errors.push(...validateEmbroideryObjectV2(object).errors.map(item => ({ ...item, path: `objects[${index}].${item.path}` }))));
  threads.forEach((thread, index) => errors.push(...validateThreadDefinitionV2(thread).errors.map(item => ({ ...item, path: `threads[${index}].${item.path}` }))));
  errors.push(...validateTechnicalEmbroideryPlan(technicalPlan, threadedObjectMaterialization, regions).errors);
  errors.push(...validateGlobalSequencePlan(sequencePlan, threadedObjectMaterialization, technicalPlan).errors);
  errors.push(...validateMachineIndependentPhysicalStitchPlan(physicalPlan, threadedObjectMaterialization, technicalPlan, sequencePlan).errors);
  const missingPaths = (sequencePlan?.executionSteps || []).filter(step => !(physicalPlan?.objectPaths || []).some(path => path.objectId === step.objectId));
  if (missingPaths.length) errors.push(...missingPaths.map(step => ({ code: 'PHYSICAL_PATH_MISSING', objectId: step.objectId })));
  const mutationMetadata = { objectMutationCount: 0, technicalSpecificationMutationCount: 0, sequencePlanMutationCount: 0, physicalPlanMutationCount: 0, threadBlockMutationCount: 0, selectedCandidateIdentityMutationCount: 0 };
  if (errors.length && !config.allowPartialCanonicalStream) return blockedCompilation({ sequencePlan, physicalPlan, config, errors, metadata: mutationMetadata });
  const compiled = compileThreadBlocksToCanonicalCommands({ objects, threads, technicalPlan, sequencePlan, physicalPlan, config }); errors.push(...compiled.errors);
  const after = { objects: snapshot(threadedObjectMaterialization), technical: snapshot(technicalPlan), sequence: snapshot(sequencePlan), physical: snapshot(physicalPlan) };
  mutationMetadata.objectMutationCount = before.objects === after.objects ? 0 : 1; mutationMetadata.technicalSpecificationMutationCount = before.technical === after.technical ? 0 : 1;
  mutationMetadata.sequencePlanMutationCount = before.sequence === after.sequence ? 0 : 1; mutationMetadata.physicalPlanMutationCount = before.physical === after.physical ? 0 : 1; mutationMetadata.threadBlockMutationCount = mutationMetadata.sequencePlanMutationCount;
  const metadata = { ...compiled.metadata, ...mutationMetadata, canonicalCommandsGenerated: compiled.commands.length > 0, stitchCommandsGenerated: compiled.commands.some(item => item.type === 'stitch'), jumpCommandsGenerated: compiled.commands.some(item => item.type === 'jump'), trimCommandsGenerated: compiled.commands.some(item => item.type === 'trim'), colorChangeCommandsGenerated: compiled.commands.some(item => item.type === 'colorChange'), endCommandsGenerated: compiled.commands.some(item => item.type === 'end'), commandCoordinatesQuantized: false, movementsSplitForMachine: false, machineAdaptationAdded: false, CE01LogicAdded: false, DSTEncoderInvoked: false, DSBEncoderInvoked: false, encodingAdded: false };
  const draft = { version: '2-canonical-command-compilation', initialThreadId: compiled.initialThreadId, dispositions: compiled.dispositions, commands: compiled.commands, objectCommandSpans: compiled.objectCommandSpans, discontinuityClassifications: compiled.discontinuityClassifications, executionOrder: sequencePlan.executionSteps.map(item => item.objectId), threadBlockOrder: sequencePlan.threadBlocks.map(item => item.id), errors, warnings: compiled.warnings, config, metadata };
  draft.summary = buildSummary({ sequencePlan, physicalPlan, result: draft, metadata });
  const validation = validateCanonicalCommandCompilationV2(draft, threadedObjectMaterialization, technicalPlan, sequencePlan, physicalPlan); errors.push(...validation.errors);
  return createCanonicalCommandCompilationV2({ ...draft, valid: errors.length === 0, errors });
}
