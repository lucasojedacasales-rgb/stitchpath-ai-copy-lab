import { validateThreadBlockV2 } from '../modelValidation.js';
import { REPEATED_THREAD_REASONS, executionStepId, selectedEntryExitIdForObject, sequenceDispositionIdForObject, transitionId } from './sequencePlanningModel.js';
import { sequencePointDistance } from './candidatePairSelector.js';

const issue = (code, path, message) => ({ code, path, message });
const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function fingerprint(value) {
  let text = ''; try { text = JSON.stringify(value); } catch { text = ''; }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeThreadId(threadId) {
  return String(threadId ?? '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'thread';
}

function duplicateValues(values) {
  const seen = new Set();
  return [...new Set(values.filter(value => { const duplicate = seen.has(value); seen.add(value); return duplicate; }))];
}

function cycleCount(objects) {
  const byId = new Map(objects.map(object => [object.id, object]));
  const visiting = new Set(); const visited = new Set(); const cycles = new Set();
  const visit = id => {
    if (visiting.has(id)) { cycles.add(id); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    (byId.get(id)?.dependencyIds || []).filter(dependencyId => byId.has(dependencyId)).forEach(visit);
    visiting.delete(id); visited.add(id);
  };
  objects.forEach(object => visit(object.id));
  return cycles.size;
}

export function validateObjectSequenceDispositionV2(disposition) {
  const errors = [];
  if (!disposition?.id) errors.push(issue('MISSING_SEQUENCE_DISPOSITION_ID', 'id', 'Disposition ID is required.'));
  if (!disposition?.objectId) errors.push(issue('MISSING_SEQUENCE_DISPOSITION_OBJECT_ID', 'objectId', 'Object ID is required.'));
  if (disposition?.objectId && disposition.id !== sequenceDispositionIdForObject(disposition.objectId)) errors.push(issue('NONDETERMINISTIC_SEQUENCE_DISPOSITION_ID', 'id', 'Disposition ID is not deterministic.'));
  if (!['scheduled', 'manual_required', 'blocked'].includes(disposition?.status)) errors.push(issue('INVALID_SEQUENCE_DISPOSITION_STATUS', 'status', 'Disposition status is invalid.'));
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function validateSelectedEntryExitPairV2(selection, object, specification) {
  const errors = [];
  if (!selection?.id || selection.id !== selectedEntryExitIdForObject(selection?.objectId)) errors.push(issue('INVALID_SELECTED_ENTRY_EXIT_ID', 'id', 'Selection ID is missing or nondeterministic.'));
  if (!object || selection?.objectId !== object.id) errors.push(issue('SELECTED_PAIR_UNKNOWN_OBJECT', 'objectId', 'Selection references the wrong object.'));
  const entry = specification?.entryCandidates?.find(candidate => candidate.id === selection?.entryCandidateId);
  const exit = specification?.exitCandidates?.find(candidate => candidate.id === selection?.exitCandidateId);
  if (!entry) errors.push(issue('SELECTED_ENTRY_MISSING', 'entryCandidateId', 'Selected entry candidate does not exist.'));
  if (!exit) errors.push(issue('SELECTED_EXIT_MISSING', 'exitCandidateId', 'Selected exit candidate does not exist.'));
  if (entry && (entry.objectId !== object.id || entry.kind !== 'entry' || !entry.valid)) errors.push(issue('INVALID_SELECTED_ENTRY_CANDIDATE', 'entryCandidateId', 'Selected entry candidate is invalid.'));
  if (exit && (exit.objectId !== object.id || exit.kind !== 'exit' || !exit.valid)) errors.push(issue('INVALID_SELECTED_EXIT_CANDIDATE', 'exitCandidateId', 'Selected exit candidate is invalid.'));
  if (!finitePoint(selection?.entryPoint) || !finitePoint(selection?.exitPoint)) errors.push(issue('NONFINITE_SELECTED_POINT', 'points', 'Selected points must be finite.'));
  if (entry && !same(entry.point, selection.entryPoint)) errors.push(issue('SELECTED_ENTRY_POINT_CHANGED', 'entryPoint', 'Selected entry point changed from Phase 7.'));
  if (exit && !same(exit.point, selection.exitPoint)) errors.push(issue('SELECTED_EXIT_POINT_CHANGED', 'exitPoint', 'Selected exit point changed from Phase 7.'));
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function validateObjectExecutionStepV2(step) {
  const errors = [];
  if (!Number.isInteger(step?.sequenceIndex) || step.sequenceIndex < 0) errors.push(issue('INVALID_EXECUTION_SEQUENCE_INDEX', 'sequenceIndex', 'Sequence index must be a non-negative integer.'));
  if (step?.id !== executionStepId(step?.sequenceIndex, step?.objectId)) errors.push(issue('NONDETERMINISTIC_EXECUTION_ID', 'id', 'Execution ID is not deterministic.'));
  for (const field of ['objectId', 'regionId', 'threadId', 'threadBlockId', 'technicalSpecificationId', 'selectedEntryExitId']) if (!step?.[field]) errors.push(issue('MISSING_EXECUTION_REFERENCE', field, `${field} is required.`));
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function validateSequenceTransitionV2(transition) {
  const errors = [];
  if (transition?.id !== transitionId(transition?.fromObjectId, transition?.toObjectId)) errors.push(issue('NONDETERMINISTIC_TRANSITION_ID', 'id', 'Transition ID is not deterministic.'));
  if (!Number.isFinite(transition?.distanceMm) || transition.distanceMm < 0) errors.push(issue('INVALID_TRANSITION_DISTANCE', 'distanceMm', 'Transition distance must be finite and non-negative.'));
  if (transition?.sameThread === transition?.threadChanged) errors.push(issue('INVALID_TRANSITION_THREAD_FLAGS', 'threadChanged', 'Exactly one thread relationship flag must be true.'));
  return { valid: errors.length === 0, errors, warnings: [] };
}

function detectForbiddenOutput(value, path, errors) {
  if (!value || typeof value !== 'object') return;
  const forbiddenArrays = new Set(['stitches', 'stitchCoordinates', 'underlayCoordinates', 'commands', 'canonicalCommands', 'jumps', 'trims', 'colorChangeCommands']);
  const forbiddenObjects = new Set(['machineProfile', 'machineLimits', 'ce01', 'encoder', 'dst', 'dsb']);
  Object.entries(value).forEach(([key, nested]) => {
    if (forbiddenArrays.has(key) && Array.isArray(nested) && nested.length) errors.push(issue('PHYSICAL_OR_COMMAND_OUTPUT_FORBIDDEN', `${path}.${key}`, `${key} is forbidden in Phase 8.`));
    else if (forbiddenObjects.has(key) && nested != null && nested !== false) errors.push(issue('MACHINE_OR_ENCODER_FIELD_FORBIDDEN', `${path}.${key}`, `${key} is forbidden in Phase 8.`));
    else detectForbiddenOutput(nested, `${path}.${key}`, errors);
  });
}

export function validateGlobalSequencePlan(plan, threadedObjectMaterialization, technicalPlan) {
  const errors = []; const warnings = [];
  const objects = threadedObjectMaterialization?.objects || [];
  const threads = threadedObjectMaterialization?.threads || [];
  const specifications = technicalPlan?.specifications || [];
  const objectMap = new Map(objects.map(object => [object.id, object]));
  const specificationMap = new Map(specifications.map(specification => [specification.objectId, specification]));
  const threadIds = new Set(threads.map(thread => thread.id));
  const dispositions = plan?.dispositions || []; const steps = plan?.executionSteps || [];
  const selections = plan?.selectedEntryExitPairs || []; const blocks = plan?.threadBlocks || []; const transitions = plan?.transitions || [];

  duplicateValues(dispositions.map(item => item.id)).forEach(id => errors.push(issue('DUPLICATE_SEQUENCE_DISPOSITION_ID', 'dispositions', `Duplicate disposition ID "${id}".`)));
  duplicateValues(dispositions.map(item => item.objectId)).forEach(id => errors.push(issue('DUPLICATE_OBJECT_DISPOSITION', 'dispositions', `Object "${id}" has multiple dispositions.`)));
  duplicateValues(steps.map(item => item.objectId)).forEach(id => errors.push(issue('DUPLICATE_EXECUTION_OBJECT', 'executionSteps', `Object "${id}" is scheduled multiple times.`)));
  duplicateValues(selections.map(item => item.id)).forEach(id => errors.push(issue('DUPLICATE_SELECTED_PAIR_ID', 'selectedEntryExitPairs', `Duplicate selection ID "${id}".`)));
  objects.forEach(object => {
    const matching = dispositions.filter(item => item.objectId === object.id);
    if (!matching.length) errors.push(issue('FINAL_OBJECT_WITHOUT_SEQUENCE_DISPOSITION', 'dispositions', `Object "${object.id}" has no disposition.`));
  });
  dispositions.forEach((disposition, index) => {
    errors.push(...validateObjectSequenceDispositionV2(disposition).errors.map(item => ({ ...item, path: `dispositions[${index}].${item.path}` })));
    if (!objectMap.has(disposition.objectId)) errors.push(issue('SEQUENCE_DISPOSITION_UNKNOWN_OBJECT', `dispositions[${index}].objectId`, 'Disposition references an unknown object.'));
    const hasStep = steps.some(step => step.objectId === disposition.objectId);
    if (disposition.status === 'scheduled' && !hasStep) errors.push(issue('SCHEDULED_DISPOSITION_WITHOUT_EXECUTION', `dispositions[${index}]`, 'Scheduled disposition has no execution step.'));
    if (disposition.status !== 'scheduled' && hasStep) errors.push(issue('UNSCHEDULED_DISPOSITION_WITH_EXECUTION', `dispositions[${index}]`, 'Manual or blocked disposition has an execution step.'));
  });
  steps.forEach((step, index) => {
    errors.push(...validateObjectExecutionStepV2(step).errors.map(item => ({ ...item, path: `executionSteps[${index}].${item.path}` })));
    if (step.sequenceIndex !== index) errors.push(issue('NONCONTIGUOUS_EXECUTION_INDEX', `executionSteps[${index}].sequenceIndex`, 'Execution indices must be contiguous and authoritative.'));
    const object = objectMap.get(step.objectId); const specification = specificationMap.get(step.objectId);
    if (!object) errors.push(issue('EXECUTION_UNKNOWN_OBJECT', `executionSteps[${index}].objectId`, 'Execution references an unknown object.'));
    if (!specification || step.technicalSpecificationId !== specification.id) errors.push(issue('EXECUTION_UNKNOWN_TECHNICAL_SPECIFICATION', `executionSteps[${index}].technicalSpecificationId`, 'Execution references an unknown specification.'));
    if (object && step.threadId !== object.threadId) errors.push(issue('EXECUTION_THREAD_MISMATCH', `executionSteps[${index}].threadId`, 'Execution thread differs from the object thread.'));
    if (!threadIds.has(step.threadId)) errors.push(issue('EXECUTION_UNKNOWN_THREAD', `executionSteps[${index}].threadId`, 'Execution references an unknown thread.'));
    (object?.dependencyIds || []).forEach(dependencyId => {
      const dependencyIndex = steps.findIndex(candidate => candidate.objectId === dependencyId);
      if (dependencyIndex < 0 || dependencyIndex >= index) errors.push(issue('SEQUENCE_DEPENDENCY_VIOLATION', `executionSteps[${index}]`, `Dependency "${dependencyId}" is not earlier in the sequence.`));
    });
  });
  selections.forEach((selection, index) => errors.push(...validateSelectedEntryExitPairV2(selection, objectMap.get(selection.objectId), specificationMap.get(selection.objectId)).errors.map(item => ({ ...item, path: `selectedEntryExitPairs[${index}].${item.path}` }))));
  if (selections.length !== steps.length) errors.push(issue('SELECTED_PAIR_COVERAGE_MISMATCH', 'selectedEntryExitPairs', 'Every execution step must have one selected pair.'));

  transitions.forEach((transition, index) => {
    errors.push(...validateSequenceTransitionV2(transition).errors.map(item => ({ ...item, path: `transitions[${index}].${item.path}` })));
    const fromStep = steps[index]; const toStep = steps[index + 1];
    const fromSelection = selections.find(item => item.objectId === fromStep?.objectId); const toSelection = selections.find(item => item.objectId === toStep?.objectId);
    if (!fromStep || !toStep || transition.fromObjectId !== fromStep.objectId || transition.toObjectId !== toStep.objectId) errors.push(issue('TRANSITION_SEQUENCE_MISMATCH', `transitions[${index}]`, 'Transition does not match adjacent execution steps.'));
    const expectedDistance = fromSelection && toSelection ? sequencePointDistance(fromSelection.exitPoint, toSelection.entryPoint) : null;
    if (expectedDistance !== null && Math.abs(expectedDistance - transition.distanceMm) > 1e-9) errors.push(issue('TRANSITION_DISTANCE_MISMATCH', `transitions[${index}].distanceMm`, 'Transition distance differs from selected points.'));
    if (fromStep && toStep && transition.threadChanged !== (fromStep.threadId !== toStep.threadId)) errors.push(issue('TRANSITION_THREAD_CHANGE_MISMATCH', `transitions[${index}].threadChanged`, 'Transition thread flag is incorrect.'));
  });
  if (transitions.length !== Math.max(0, steps.length - 1)) errors.push(issue('TRANSITION_COVERAGE_MISMATCH', 'transitions', 'There must be one transition between each adjacent step.'));

  duplicateValues(blocks.map(block => block.id)).forEach(id => errors.push(issue('DUPLICATE_THREAD_BLOCK_ID', 'threadBlocks', `Duplicate thread block ID "${id}".`)));
  const blockObjectIds = blocks.flatMap(block => block.objectIds);
  duplicateValues(blockObjectIds).forEach(id => errors.push(issue('OBJECT_IN_MULTIPLE_THREAD_BLOCKS', 'threadBlocks', `Object "${id}" appears in multiple blocks.`)));
  steps.forEach(step => { if (!blockObjectIds.includes(step.objectId)) errors.push(issue('EXECUTION_OBJECT_MISSING_FROM_THREAD_BLOCKS', 'threadBlocks', `Object "${step.objectId}" is missing from blocks.`)); });
  const seenBlockThreads = new Set(); let priorThread = null;
  blocks.forEach((block, index) => {
    errors.push(...validateThreadBlockV2(block).errors.map(item => ({ ...item, path: `threadBlocks[${index}].${item.path}` })));
    const expectedBlockId = `thread-block:${String(index).padStart(4, '0')}:${sanitizeThreadId(block.threadId)}`;
    if (block.id !== expectedBlockId) errors.push(issue('NONDETERMINISTIC_THREAD_BLOCK_ID', `threadBlocks[${index}].id`, 'Thread block ID is not deterministic.'));
    if (!block.objectIds.length) errors.push(issue('EMPTY_THREAD_BLOCK', `threadBlocks[${index}]`, 'Thread block cannot be empty.'));
    if (block.threadId === priorThread) errors.push(issue('ADJACENT_SAME_THREAD_BLOCKS', `threadBlocks[${index}]`, 'Adjacent blocks cannot use the same thread.'));
    const repeated = seenBlockThreads.has(block.threadId);
    if (repeated && !REPEATED_THREAD_REASONS.includes(block.repeatedThreadReason)) errors.push(issue('REPEATED_THREAD_WITHOUT_REASON', `threadBlocks[${index}].repeatedThreadReason`, 'Repeated thread requires a valid reason.'));
    if (!repeated && block.repeatedThreadReason !== null) errors.push(issue('FIRST_THREAD_BLOCK_HAS_REPEATED_REASON', `threadBlocks[${index}].repeatedThreadReason`, 'First block of a thread cannot have a repeated reason.'));
    block.objectIds.forEach(objectId => { if (objectMap.get(objectId)?.threadId !== block.threadId) errors.push(issue('THREAD_BLOCK_OBJECT_THREAD_MISMATCH', `threadBlocks[${index}]`, `Object "${objectId}" has another thread.`)); });
    seenBlockThreads.add(block.threadId); priorThread = block.threadId;
  });
  if (!same(blockObjectIds, steps.map(step => step.objectId))) errors.push(issue('THREAD_BLOCK_ORDER_MISMATCH', 'threadBlocks', 'Thread block object order must equal global execution order.'));
  if (cycleCount(objects)) errors.push(issue('SEQUENCE_INPUT_DEPENDENCY_CYCLE', 'objects', 'Input dependencies contain a cycle.'));
  if (plan?.summary?.sequenceDispositionCoveragePercent !== 100) errors.push(issue('SEQUENCE_DISPOSITION_COVERAGE_BELOW_100', 'summary.sequenceDispositionCoveragePercent', 'Disposition coverage must be 100%.'));
  if (plan?.summary?.silentFinalObjectDropCount > 0) errors.push(issue('SILENT_FINAL_OBJECT_DROP', 'summary.silentFinalObjectDropCount', 'Final objects were silently dropped.'));
  if (plan?.metadata?.inputMutationsDetected || plan?.metadata?.objectMutationsDetected || plan?.metadata?.technicalSpecificationMutationsDetected) errors.push(issue('SEQUENCE_INPUT_MUTATION', 'metadata', 'Sequence planning mutated its inputs.'));
  const contracts = plan?.metadata?.sourceContracts;
  objects.forEach(object => { if (contracts?.objectFingerprints?.[object.id] && contracts.objectFingerprints[object.id] !== fingerprint(object)) errors.push(issue('SEQUENCE_OBJECT_MUTATION', `objects.${object.id}`, 'A source final object changed after sequence planning.')); });
  threads.forEach(thread => { if (contracts?.threadFingerprints?.[thread.id] && contracts.threadFingerprints[thread.id] !== fingerprint(thread)) errors.push(issue('SEQUENCE_THREAD_DEFINITION_MUTATION', `threads.${thread.id}`, 'A source thread definition changed after sequence planning.')); });
  specifications.forEach(specification => { if (contracts?.technicalSpecificationFingerprints?.[specification.id] && contracts.technicalSpecificationFingerprints[specification.id] !== fingerprint(specification)) errors.push(issue('SEQUENCE_TECHNICAL_SPECIFICATION_MUTATION', `specifications.${specification.id}`, 'A source technical specification changed after sequence planning.')); });
  for (const field of ['physicalStitchesGenerated', 'physicalUnderlayGenerated', 'jumpCommandsGenerated', 'trimCommandsGenerated', 'colorChangeCommandsGenerated', 'canonicalCommandsGenerated', 'machineAdaptationAdded', 'encodingAdded']) {
    if (plan?.metadata?.[field] === true) errors.push(issue('PHASE_8_OUTPUT_FLAG_FORBIDDEN', `metadata.${field}`, `${field} must remain false in Phase 8.`));
  }
  detectForbiddenOutput(plan, 'plan', errors);
  return { valid: errors.length === 0, errors, warnings, dependencyCycleCount: cycleCount(objects) };
}

export const _sequenceValidationInternals = Object.freeze({ cycleCount });
