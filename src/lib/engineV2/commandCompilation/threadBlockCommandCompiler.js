import { createCanonicalCommandV2 } from '../model.js';
import { pointsEqualWithinTolerance } from '../stitchGeneration/stitchGeometry.js';
import { createCanonicalCompilationDispositionV2, createCanonicalObjectCommandSpanV2 } from './canonicalCompilationModel.js';
import { canonicalCommandId } from './canonicalCommandId.js';
import { compileObjectPhysicalPathToCanonicalCommands } from './objectCommandCompiler.js';

const commandCount = (commands, type) => commands.filter(command => command.type === type).length;

function finalized(commands) {
  return commands.map((command, sequenceIndex) => createCanonicalCommandV2({ ...command, id: canonicalCommandId(sequenceIndex, command.type), sequenceIndex }));
}

export function compileThreadBlocksToCanonicalCommands({ objects, threads, technicalPlan, sequencePlan, physicalPlan, config }) {
  const objectMap = new Map(objects.map(item => [item.id, item]));
  const threadIds = new Set(threads.map(item => item.id));
  const specificationMap = new Map(technicalPlan.specifications.map(item => [item.objectId, item]));
  const stepMap = new Map(sequencePlan.executionSteps.map(item => [item.objectId, item]));
  const pathMap = new Map(physicalPlan.objectPaths.map(item => [item.objectId, item]));
  const commands = []; const dispositions = []; const spans = []; const classifications = []; const errors = [];
  const reachablePhysicalPointIds = new Set(); const physicalMovementKeys = [];
  const compiledThreadBlockIds = [];
  const initialThreadId = sequencePlan.threadBlocks[0]?.threadId ?? null;
  let currentPosition = null; let activeThreadId = initialThreadId; let previousObject = null; let objectOrdinal = 0;

  const appendTrim = context => {
    if (config.deduplicateAdjacentTrims && commands.at(-1)?.type === 'trim') return false;
    commands.push(createCanonicalCommandV2({ type: 'trim', x: currentPosition?.x, y: currentPosition?.y, threadId: activeThreadId, objectId: context.objectId, regionId: context.regionId, threadBlockId: context.threadBlockId, executionStepId: context.executionStepId, reasonCode: context.reasonCode, source: { compiler: 'engineV2-phase10', universalCutIntent: true, previousObjectId: previousObject?.id ?? null } }));
    return true;
  };

  for (let blockIndex = 0; blockIndex < sequencePlan.threadBlocks.length; blockIndex += 1) {
    const block = sequencePlan.threadBlocks[blockIndex];
    if (!threadIds.has(block.threadId)) { errors.push({ code: 'UNKNOWN_THREAD_ID', path: `threadBlocks[${blockIndex}].threadId` }); continue; }
    compiledThreadBlockIds.push(block.id);
    for (const objectId of block.objectIds) {
      const object = objectMap.get(objectId); const step = stepMap.get(objectId); const path = pathMap.get(objectId); const specification = specificationMap.get(objectId);
      const spanStart = commands.length;
      if (!object || !step || !path || !specification) { errors.push({ code: 'CANONICAL_OBJECT_INPUT_MISSING', objectId }); continue; }
      const entry = path.firstPhysicalPoint;
      if (objectOrdinal === 0) {
        if (config.emitInitialPositionJump) {
          commands.push(createCanonicalCommandV2({ type: 'jump', x: entry.x, y: entry.y, threadId: initialThreadId, objectId: object.id, regionId: object.regionId, threadBlockId: block.id, executionStepId: step.id, subpathId: entry.subpathId, physicalPointId: entry.id, phase: entry.phase, technique: entry.technique, reasonCode: 'INITIAL_POSITIONING', source: { compiler: 'engineV2-phase10', startingPositionUnknown: true } }));
        }
        currentPosition = { x: entry.x, y: entry.y }; reachablePhysicalPointIds.add(entry.id);
      } else {
        const blockChanged = activeThreadId !== block.threadId || previousObject?.threadBlockId !== block.id;
        if (config.trimBetweenObjects || (blockChanged && config.trimBeforeColorChange)) appendTrim({ objectId: object.id, regionId: object.regionId, threadBlockId: block.id, executionStepId: step.id, reasonCode: blockChanged ? 'THREAD_BLOCK_BOUNDARY' : 'OBJECT_BOUNDARY' });
        if (blockChanged) commands.push(createCanonicalCommandV2({ type: 'colorChange', threadId: block.threadId, objectId: object.id, regionId: object.regionId, threadBlockId: block.id, executionStepId: step.id, reasonCode: 'THREAD_BLOCK_CHANGE', source: { compiler: 'engineV2-phase10', previousThreadId: activeThreadId } }));
        activeThreadId = block.threadId;
        if (!pointsEqualWithinTolerance(currentPosition, entry, config.comparisonToleranceMm)) commands.push(createCanonicalCommandV2({ type: 'jump', x: entry.x, y: entry.y, threadId: activeThreadId, objectId: object.id, regionId: object.regionId, threadBlockId: block.id, executionStepId: step.id, subpathId: entry.subpathId, physicalPointId: entry.id, phase: entry.phase, technique: entry.technique, reasonCode: 'OBJECT_ENTRY_POSITIONING', source: { compiler: 'engineV2-phase10', nonSewingMovement: true, previousObjectId: previousObject?.id ?? null } }));
        currentPosition = { x: entry.x, y: entry.y }; reachablePhysicalPointIds.add(entry.id);
      }
      const compiled = compileObjectPhysicalPathToCanonicalCommands({ object, technicalSpecification: specification, physicalPath: path, currentPosition, activeThreadId, executionStep: step, threadBlock: block, config, previousCommand: commands.at(-1) });
      commands.push(...compiled.commands); classifications.push(...compiled.classifications); errors.push(...compiled.errors);
      compiled.reachablePhysicalPointIds.forEach(id => reachablePhysicalPointIds.add(id)); physicalMovementKeys.push(...compiled.physicalMovementKeys);
      currentPosition = compiled.currentPosition;
      const objectCommands = commands.slice(spanStart);
      spans.push(createCanonicalObjectCommandSpanV2({ objectId: object.id, executionStepId: step.id, threadBlockId: block.id, firstCommandIndex: spanStart, lastCommandIndex: commands.length - 1, commandCount: objectCommands.length, stitchCommandCount: commandCount(objectCommands, 'stitch'), connectorStitchCommandCount: objectCommands.filter(command => command.type === 'stitch' && command.reasonCode === 'SAFE_SUBPATH_CONNECTOR').length, jumpCommandCount: commandCount(objectCommands, 'jump'), trimCommandCount: commandCount(objectCommands, 'trim'), colorChangeCommandCount: commandCount(objectCommands, 'colorChange'), source: { compiler: 'engineV2-phase10' } }));
      dispositions.push(createCanonicalCompilationDispositionV2({ objectId: object.id, executionStepId: step.id, physicalPathId: path.id, status: compiled.valid ? 'compiled' : 'blocked', reasonCode: compiled.valid ? 'CANONICAL_OBJECT_COMPILED' : 'CANONICAL_OBJECT_COMPILATION_FAILED', reason: compiled.valid ? 'Physical path compiled without reordering or regeneration.' : 'Object command compilation failed.', evidence: compiled.errors, source: { compiler: 'engineV2-phase10' } }));
      previousObject = { ...object, threadBlockId: block.id }; objectOrdinal += 1;
    }
  }
  if (config.trimBeforeEnd && currentPosition) appendTrim({ objectId: previousObject?.id, regionId: previousObject?.regionId, threadBlockId: sequencePlan.threadBlocks.at(-1)?.id, executionStepId: stepMap.get(previousObject?.id)?.id, reasonCode: 'STREAM_END_TRIM' });
  commands.push(createCanonicalCommandV2({ type: 'end', x: currentPosition?.x, y: currentPosition?.y, threadId: activeThreadId, objectId: previousObject?.id ?? null, regionId: previousObject?.regionId ?? null, threadBlockId: sequencePlan.threadBlocks.at(-1)?.id ?? null, executionStepId: stepMap.get(previousObject?.id)?.id ?? null, reasonCode: 'STREAM_COMPLETE', source: { compiler: 'engineV2-phase10' } }));
  return { valid: errors.length === 0, initialThreadId, commands: finalized(commands), dispositions, objectCommandSpans: spans, discontinuityClassifications: classifications, errors, warnings: [], metadata: { reachablePhysicalPointIds: [...reachablePhysicalPointIds], physicalMovementKeys, compiledThreadBlockIds, initialPositionAssumed: !config.emitInitialPositionJump } };
}
