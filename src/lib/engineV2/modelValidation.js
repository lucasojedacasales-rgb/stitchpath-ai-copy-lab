import {
  ALLOWED_COMMAND_TYPES,
  ALLOWED_EMBROIDERY_ROLES,
  ALLOWED_STITCH_TYPES,
} from './model.js';

function result(errors = [], warnings = []) {
  return { valid: errors.length === 0, errors, warnings };
}

function error(code, path, message) {
  return { code, path, message };
}

function hasId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFinitePoint(point) {
  return point && typeof point === 'object' && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function validatePointArray(points, path, { polygon = false, normalized = false } = {}) {
  const errors = [];
  if (!Array.isArray(points)) {
    return [error('INVALID_GEOMETRY', path, 'Geometry must be an array of points.')];
  }
  if (polygon && points.length < 3) {
    errors.push(error('INVALID_POLYGON', path, 'Polygon geometry requires at least three points.'));
  }
  if (!polygon && points.length === 0) {
    errors.push(error('INVALID_GEOMETRY', path, 'Geometry requires at least one point.'));
  }
  points.forEach((point, index) => {
    const pointPath = `${path}[${index}]`;
    if (!isFinitePoint(point)) {
      errors.push(error('NON_FINITE_COORDINATE', pointPath, 'Point coordinates must be finite numbers.'));
      return;
    }
    if (normalized && (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
      errors.push(error('NORMALIZED_COORDINATE_OUT_OF_RANGE', pointPath, 'Normalized coordinates must be between 0 and 1.'));
    }
  });
  return errors;
}

function prefixIssues(issues, prefix) {
  return issues.map(issue => ({ ...issue, path: `${prefix}.${issue.path}` }));
}

export function validateRegionV2(region) {
  const errors = [];
  if (!region || typeof region !== 'object') return result([error('INVALID_REGION', 'region', 'Region must be an object.')]);
  if (!hasId(region.id)) errors.push(error('MISSING_ID', 'id', 'Region id is required.'));
  errors.push(...validatePointArray(region.geometry, 'geometry', { polygon: true, normalized: true }));
  if (!Array.isArray(region.holes)) {
    errors.push(error('INVALID_HOLES', 'holes', 'Region holes must be an array of polygons.'));
  } else {
    region.holes.forEach((hole, index) => {
      const holeErrors = validatePointArray(hole, `holes[${index}]`, { polygon: true, normalized: true });
      errors.push(...holeErrors.map(item => ({
        ...item,
        code: item.code === 'INVALID_POLYGON' || item.code === 'INVALID_GEOMETRY'
          ? 'INVALID_HOLE_GEOMETRY'
          : item.code,
      })));
    });
  }
  return result(errors);
}

export function validateEmbroideryObjectV2(object) {
  const errors = [];
  if (!object || typeof object !== 'object') return result([error('INVALID_OBJECT', 'object', 'Embroidery object must be an object.')]);
  if (!hasId(object.id)) errors.push(error('MISSING_ID', 'id', 'Embroidery object id is required.'));
  if (!hasId(object.regionId)) errors.push(error('MISSING_REGION_REFERENCE', 'regionId', 'Embroidery object regionId is required.'));
  if (!hasId(object.threadId)) errors.push(error('MISSING_THREAD_REFERENCE', 'threadId', 'Embroidery object threadId is required.'));
  if (!ALLOWED_EMBROIDERY_ROLES.includes(object.role)) errors.push(error('INVALID_ROLE', 'role', `Unknown embroidery role: ${String(object.role)}.`));
  if (!ALLOWED_STITCH_TYPES.includes(object.stitchType)) errors.push(error('INVALID_STITCH_TYPE', 'stitchType', `Unknown stitch type: ${String(object.stitchType)}.`));
  errors.push(...validatePointArray(object.geometry, 'geometry'));
  if (!Array.isArray(object.holes)) {
    errors.push(error('INVALID_OBJECT_HOLES', 'holes', 'Embroidery object holes must be an array of polygons.'));
  } else {
    object.holes.forEach((hole, index) => errors.push(...validatePointArray(hole, `holes[${index}]`, { polygon: true })));
  }
  for (const field of ['entryCandidates', 'exitCandidates']) {
    if (!Array.isArray(object[field])) {
      errors.push(error('INVALID_CANDIDATE_POINTS', field, `${field} must be an array.`));
    } else {
      object[field].forEach((point, index) => {
        if (!isFinitePoint(point)) errors.push(error('NON_FINITE_COORDINATE', `${field}[${index}]`, 'Candidate coordinates must be finite numbers.'));
      });
    }
  }
  if (!Array.isArray(object.dependencyIds)) {
    errors.push(error('INVALID_DEPENDENCIES', 'dependencyIds', 'dependencyIds must be an array.'));
  } else if (hasId(object.id) && object.dependencyIds.includes(object.id)) {
    errors.push(error('SELF_DEPENDENCY', 'dependencyIds', 'An object cannot depend on itself.'));
  }
  return result(errors);
}

export function validateThreadDefinitionV2(thread) {
  const errors = [];
  if (!thread || typeof thread !== 'object') return result([error('INVALID_THREAD', 'thread', 'Thread definition must be an object.')]);
  if (!hasId(thread.id)) errors.push(error('MISSING_ID', 'id', 'Thread id is required.'));
  if (!Array.isArray(thread.visualColorSamples)) errors.push(error('INVALID_VISUAL_COLOR_SAMPLES', 'visualColorSamples', 'visualColorSamples must be an array.'));
  else if (thread.visualColorSamples.some(sample => typeof sample !== 'string')) errors.push(error('INVALID_VISUAL_COLOR_SAMPLES', 'visualColorSamples', 'Every visual color sample must be a string.'));
  const legacyMachineColor = typeof thread.machineColor === 'string' && thread.machineColor.length > 0;
  const structuredMachineColor = thread.machineColor && typeof thread.machineColor === 'object' && typeof thread.machineColor.hex === 'string' && typeof thread.machineColor.name === 'string' && typeof thread.machineColor.catalogEntryId === 'string';
  if (!legacyMachineColor && !structuredMachineColor) {
    errors.push(error('INVALID_MACHINE_COLOR', 'machineColor', 'machineColor requires hex, name, and catalogEntryId strings.'));
  }
  return result(errors);
}

export function validateThreadBlockV2(block) {
  const errors = [];
  if (!block || typeof block !== 'object') return result([error('INVALID_THREAD_BLOCK', 'threadBlock', 'Thread block must be an object.')]);
  if (!hasId(block.id)) errors.push(error('MISSING_ID', 'id', 'Thread block id is required.'));
  if (!hasId(block.threadId)) errors.push(error('MISSING_THREAD_REFERENCE', 'threadId', 'Thread block threadId is required.'));
  if (!Array.isArray(block.objectIds)) {
    errors.push(error('INVALID_OBJECT_REFERENCES', 'objectIds', 'Thread block objectIds must be an array.'));
  } else if (new Set(block.objectIds).size !== block.objectIds.length) {
    errors.push(error('DUPLICATE_BLOCK_OBJECT_ID', 'objectIds', 'Thread block contains duplicate object ids.'));
  }
  return result(errors);
}

export function validateCanonicalCommandV2(command) {
  const errors = [];
  if (!command || typeof command !== 'object') return result([error('INVALID_COMMAND', 'command', 'Canonical command must be an object.')]);
  if (!ALLOWED_COMMAND_TYPES.includes(command.type)) {
    errors.push(error('INVALID_COMMAND_TYPE', 'type', `Unknown command type: ${String(command.type)}.`));
    return result(errors);
  }
  if ((command.type === 'stitch' || command.type === 'jump') && (!Number.isFinite(command.x) || !Number.isFinite(command.y))) {
    errors.push(error('COMMAND_COORDINATES_REQUIRED', 'x,y', `${command.type} requires finite x and y coordinates.`));
  }
  if (command.type === 'trim' && ((command.x !== undefined && !Number.isFinite(command.x)) || (command.y !== undefined && !Number.isFinite(command.y)))) {
    errors.push(error('NON_FINITE_COORDINATE', 'x,y', 'Trim coordinates, when supplied, must be finite.'));
  }
  if (command.type === 'colorChange' && !hasId(command.threadId)) {
    errors.push(error('COLOR_CHANGE_THREAD_REQUIRED', 'threadId', 'colorChange requires a threadId.'));
  }
  if (command.id !== null && command.id !== undefined && !hasId(command.id)) errors.push(error('INVALID_COMMAND_ID', 'id', 'Command id must be a non-empty string when supplied.'));
  if (command.sequenceIndex !== null && command.sequenceIndex !== undefined && (!Number.isInteger(command.sequenceIndex) || command.sequenceIndex < 0)) errors.push(error('INVALID_COMMAND_SEQUENCE_INDEX', 'sequenceIndex', 'Command sequenceIndex must be a non-negative integer when supplied.'));
  for (const field of ['threadBlockId', 'executionStepId', 'subpathId', 'physicalPointId', 'transitionId', 'phase', 'technique', 'reasonCode']) {
    if (command[field] !== null && command[field] !== undefined && !hasId(command[field])) errors.push(error('INVALID_COMMAND_LINEAGE', field, `${field} must be a non-empty string when supplied.`));
  }
  return result(errors);
}

function duplicateIdErrors(collection, path) {
  const seen = new Set();
  const duplicates = new Set();
  collection.forEach(item => {
    if (!hasId(item?.id)) return;
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  });
  return [...duplicates].map(id => error('DUPLICATE_ID', path, `Duplicate id "${id}".`));
}

function dependencyCycleIds(objects) {
  const ids = new Set(objects.filter(object => hasId(object?.id)).map(object => object.id));
  const graph = new Map(objects.filter(object => hasId(object?.id)).map(object => [
    object.id,
    Array.isArray(object.dependencyIds) ? object.dependencyIds.filter(id => ids.has(id)) : [],
  ]));
  const state = new Map();
  const stack = [];
  const cycleIds = new Set();

  function visit(id) {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const start = stack.lastIndexOf(id);
      stack.slice(start).forEach(cycleId => cycleIds.add(cycleId));
      return;
    }
    state.set(id, 1);
    stack.push(id);
    for (const dependencyId of graph.get(id) || []) visit(dependencyId);
    stack.pop();
    state.set(id, 2);
  }

  graph.forEach((_, id) => visit(id));
  return [...cycleIds];
}

export function validateEngineDocumentV2(document) {
  const errors = [];
  const warnings = [];
  if (!document || typeof document !== 'object') return result([error('INVALID_DOCUMENT', 'document', 'Engine document must be an object.')]);
  if (document.version !== '2') errors.push(error('INVALID_VERSION', 'version', 'EngineDocumentV2 version must be "2".'));

  const collectionNames = ['regions', 'objects', 'threads', 'threadBlocks', 'commands'];
  for (const name of collectionNames) {
    if (!Array.isArray(document[name])) errors.push(error('INVALID_COLLECTION', name, `${name} must be an array.`));
  }
  if (errors.some(item => item.code === 'INVALID_COLLECTION')) return result(errors, warnings);

  document.regions.forEach((region, index) => errors.push(...prefixIssues(validateRegionV2(region).errors, `regions[${index}]`)));
  document.objects.forEach((object, index) => errors.push(...prefixIssues(validateEmbroideryObjectV2(object).errors, `objects[${index}]`)));
  document.threads.forEach((thread, index) => errors.push(...prefixIssues(validateThreadDefinitionV2(thread).errors, `threads[${index}]`)));
  document.threadBlocks.forEach((block, index) => errors.push(...prefixIssues(validateThreadBlockV2(block).errors, `threadBlocks[${index}]`)));
  document.commands.forEach((command, index) => errors.push(...prefixIssues(validateCanonicalCommandV2(command).errors, `commands[${index}]`)));

  errors.push(...duplicateIdErrors(document.regions, 'regions'));
  errors.push(...duplicateIdErrors(document.objects, 'objects'));
  errors.push(...duplicateIdErrors(document.threads, 'threads'));
  errors.push(...duplicateIdErrors(document.threadBlocks, 'threadBlocks'));

  const regionIds = new Set(document.regions.map(region => region?.id).filter(hasId));
  const objectIds = new Set(document.objects.map(object => object?.id).filter(hasId));
  const threadIds = new Set(document.threads.map(thread => thread?.id).filter(hasId));

  document.regions.forEach((region, index) => {
    if (hasId(region?.parentId) && !regionIds.has(region.parentId)) errors.push(error('UNKNOWN_REGION_REFERENCE', `regions[${index}].parentId`, `Unknown parent region "${region.parentId}".`));
    (Array.isArray(region?.childIds) ? region.childIds : []).forEach((childId, childIndex) => {
      if (!regionIds.has(childId)) errors.push(error('UNKNOWN_REGION_REFERENCE', `regions[${index}].childIds[${childIndex}]`, `Unknown child region "${childId}".`));
    });
  });

  document.objects.forEach((object, index) => {
    if (hasId(object?.regionId) && !regionIds.has(object.regionId)) errors.push(error('UNKNOWN_REGION_REFERENCE', `objects[${index}].regionId`, `Unknown region "${object.regionId}".`));
    if (hasId(object?.threadId) && !threadIds.has(object.threadId)) errors.push(error('UNKNOWN_THREAD_REFERENCE', `objects[${index}].threadId`, `Unknown thread "${object.threadId}".`));
    (Array.isArray(object?.dependencyIds) ? object.dependencyIds : []).forEach((dependencyId, dependencyIndex) => {
      if (!objectIds.has(dependencyId)) errors.push(error('MISSING_DEPENDENCY', `objects[${index}].dependencyIds[${dependencyIndex}]`, `Unknown dependency "${dependencyId}".`));
    });
  });

  for (const id of dependencyCycleIds(document.objects)) {
    errors.push(error('CIRCULAR_DEPENDENCY', 'objects', `Circular dependency includes object "${id}".`));
  }

  const blockMemberships = new Map();
  document.threadBlocks.forEach((block, blockIndex) => {
    if (hasId(block?.threadId) && !threadIds.has(block.threadId)) errors.push(error('UNKNOWN_THREAD_REFERENCE', `threadBlocks[${blockIndex}].threadId`, `Unknown thread "${block.threadId}".`));
    (Array.isArray(block?.objectIds) ? block.objectIds : []).forEach((objectId, objectIndex) => {
      if (!objectIds.has(objectId)) {
        errors.push(error('UNKNOWN_OBJECT_REFERENCE', `threadBlocks[${blockIndex}].objectIds[${objectIndex}]`, `Unknown object "${objectId}".`));
        return;
      }
      const memberships = blockMemberships.get(objectId) || [];
      memberships.push({ threadId: block.threadId, layer: block.layer, blockIndex });
      blockMemberships.set(objectId, memberships);
      const object = document.objects.find(candidate => candidate.id === objectId);
      if (object?.threadId !== block.threadId) errors.push(error('INCOMPATIBLE_THREAD_BLOCK', `threadBlocks[${blockIndex}].objectIds[${objectIndex}]`, `Object "${objectId}" uses a different thread.`));
    });
  });
  blockMemberships.forEach((memberships, objectId) => {
    const signatures = new Set(memberships.map(item => `${item.threadId}:${item.layer}`));
    if (signatures.size > 1) errors.push(error('INCOMPATIBLE_BLOCK_MEMBERSHIP', 'threadBlocks', `Object "${objectId}" appears in incompatible thread blocks.`));
  });

  document.commands.forEach((command, index) => {
    if (hasId(command?.regionId) && !regionIds.has(command.regionId)) errors.push(error('UNKNOWN_REGION_REFERENCE', `commands[${index}].regionId`, `Unknown region "${command.regionId}".`));
    if (hasId(command?.objectId) && !objectIds.has(command.objectId)) errors.push(error('UNKNOWN_OBJECT_REFERENCE', `commands[${index}].objectId`, `Unknown object "${command.objectId}".`));
    if (hasId(command?.threadId) && !threadIds.has(command.threadId)) errors.push(error('UNKNOWN_THREAD_REFERENCE', `commands[${index}].threadId`, `Unknown thread "${command.threadId}".`));
  });

  const endIndexes = document.commands.map((command, index) => command?.type === 'end' ? index : -1).filter(index => index >= 0);
  if (endIndexes.length === 0) errors.push(error('MISSING_END_COMMAND', 'commands', 'Command stream requires exactly one END command.'));
  if (endIndexes.length > 1) errors.push(error('MULTIPLE_END_COMMANDS', 'commands', 'Command stream contains more than one END command.'));
  if (endIndexes.length > 0 && endIndexes[0] !== document.commands.length - 1) errors.push(error('COMMAND_AFTER_END', `commands[${endIndexes[0]}]`, 'END must be the final command.'));

  return result(errors, warnings);
}

export const _validationInternals = Object.freeze({ dependencyCycleIds });
