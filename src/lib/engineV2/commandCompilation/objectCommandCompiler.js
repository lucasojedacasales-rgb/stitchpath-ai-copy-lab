import { createCanonicalCommandV2 } from '../model.js';
import { pointsEqualWithinTolerance } from '../stitchGeneration/stitchGeometry.js';
import { classifyPhysicalDiscontinuity, compileDiscontinuityCommands } from './discontinuityClassifier.js';

export function compilePhysicalSubpathToCanonicalCommands({ object, physicalPath, subpath, currentPosition, activeThreadId, executionStep, threadBlock, config }) {
  const errors = []; const commands = [];
  const points = subpath?.points || [];
  if (!points.length) return { valid: false, commands, currentPosition, errors: [{ code: 'EMPTY_PHYSICAL_SUBPATH' }], reachablePhysicalPointIds: [], physicalMovementKeys: [] };
  if (!pointsEqualWithinTolerance(currentPosition, points[0], config.comparisonToleranceMm)) errors.push({ code: 'PHYSICAL_SUBPATH_START_NOT_REACHED', subpathId: subpath.id });
  const reachablePhysicalPointIds = [points[0].id]; const physicalMovementKeys = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]; const target = points[index];
    const movementKey = `${subpath.id}:${from.id}:${target.id}`;
    commands.push(createCanonicalCommandV2({
      type: 'stitch', x: target.x, y: target.y, threadId: activeThreadId, objectId: object.id, regionId: object.regionId,
      threadBlockId: threadBlock.id, executionStepId: executionStep.id, subpathId: subpath.id,
      physicalPointId: target.id, phase: subpath.phase, technique: subpath.technique, reasonCode: 'PHYSICAL_SOURCE_STITCH',
      source: { compiler: 'engineV2-phase10', physicalPathId: physicalPath.id, fromPhysicalPointId: from.id, toPhysicalPointId: target.id, physicalMovementKey: movementKey },
    }));
    reachablePhysicalPointIds.push(target.id); physicalMovementKeys.push(movementKey);
  }
  return { valid: errors.length === 0, commands, currentPosition: { x: points.at(-1).x, y: points.at(-1).y }, errors, reachablePhysicalPointIds, physicalMovementKeys };
}

export function compileObjectPhysicalPathToCanonicalCommands({ object, technicalSpecification, physicalPath, currentPosition, activeThreadId, executionStep, threadBlock, config, previousCommand }) {
  const commands = []; const classifications = []; const errors = []; const reachablePhysicalPointIds = []; const physicalMovementKeys = [];
  let position = currentPosition; let previous = previousCommand;
  for (let index = 0; index < physicalPath.subpaths.length; index += 1) {
    const subpath = physicalPath.subpaths[index];
    if (index > 0) {
      const prior = physicalPath.subpaths[index - 1];
      const transition = physicalPath.subpathTransitions.find(item => item.fromSubpathId === prior.id && item.toSubpathId === subpath.id);
      if (!transition) { errors.push({ code: 'PHYSICAL_DISCONTINUITY_MISSING', objectId: object.id, fromSubpathId: prior.id, toSubpathId: subpath.id }); continue; }
      const classification = classifyPhysicalDiscontinuity({ object, technicalSpecification, physicalTransition: transition, fromSubpath: prior, toSubpath: subpath, config });
      classifications.push(classification);
      const gap = compileDiscontinuityCommands({ classification, targetPoint: subpath.points[0], currentPosition: position, commandContext: { threadId: activeThreadId, objectId: object.id, regionId: object.regionId, threadBlockId: threadBlock.id, executionStepId: executionStep.id, subpathId: subpath.id, physicalPointId: subpath.points[0].id, phase: subpath.phase, technique: subpath.technique, previousCommand: previous }, config });
      commands.push(...gap.commands); position = gap.currentPosition; previous = commands.at(-1) ?? previous;
      reachablePhysicalPointIds.push(subpath.points[0].id);
    }
    const compiled = compilePhysicalSubpathToCanonicalCommands({ object, physicalPath, subpath, currentPosition: position, activeThreadId, executionStep, threadBlock, config });
    commands.push(...compiled.commands); errors.push(...compiled.errors); position = compiled.currentPosition; previous = commands.at(-1) ?? previous;
    reachablePhysicalPointIds.push(...compiled.reachablePhysicalPointIds); physicalMovementKeys.push(...compiled.physicalMovementKeys);
  }
  return { valid: errors.length === 0, commands, classifications, currentPosition: position, errors, reachablePhysicalPointIds: [...new Set(reachablePhysicalPointIds)], physicalMovementKeys };
}
