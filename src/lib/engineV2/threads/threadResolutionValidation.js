import { validateEmbroideryObjectV2, validateThreadDefinitionV2 } from '../modelValidation.js';
import { validateDraftThreadAssignmentV2 } from './threadAssignmentModel.js';
import { parseHexColor } from './colorScience.js';

const issue = (code, path, message) => ({ code, path, message });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const expectedObjectId = draftId => typeof draftId === 'string' && draftId.startsWith('draft:') ? `object:${draftId.slice(6)}` : null;

function duplicateValues(values) {
  const seen = new Set();
  return [...new Set(values.filter(value => { const duplicate = seen.has(value); seen.add(value); return duplicate; }))];
}

function cycleIds(objects) {
  const byId = new Map(objects.map(item => [item.id, item]));
  const visiting = new Set();
  const visited = new Set();
  const cycles = new Set();
  const visit = id => {
    if (visiting.has(id)) { cycles.add(id); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    (byId.get(id)?.dependencyIds || []).filter(dependency => byId.has(dependency)).forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  objects.forEach(item => visit(item.id));
  return [...cycles];
}

export function validateThreadResolutionResult(result, drafts = []) {
  const errors = [];
  const warnings = [];
  const assignments = result?.assignments || [];
  const threads = result?.threads || [];
  const draftIds = new Set(drafts.map(item => item.id));
  const assignmentCounts = new Map();
  assignments.forEach((assignment, index) => {
    const validation = validateDraftThreadAssignmentV2(assignment);
    errors.push(...validation.errors.map(item => ({ ...item, path: `assignments[${index}].${item.path}` })));
    if (!draftIds.has(assignment.draftId)) errors.push(issue('ASSIGNMENT_UNKNOWN_DRAFT', `assignments[${index}].draftId`, `Unknown draft "${assignment.draftId}".`));
    assignmentCounts.set(assignment.draftId, (assignmentCounts.get(assignment.draftId) || 0) + 1);
  });
  drafts.forEach(draft => {
    const count = assignmentCounts.get(draft.id) || 0;
    if (!count) errors.push(issue('DRAFT_WITHOUT_THREAD_ASSIGNMENT', 'assignments', `Draft "${draft.id}" has no assignment.`));
    if (count > 1) errors.push(issue('DUPLICATE_DRAFT_THREAD_ASSIGNMENT', 'assignments', `Draft "${draft.id}" has multiple assignments.`));
  });
  duplicateValues(threads.map(item => item.id)).forEach(id => errors.push(issue('DUPLICATE_THREAD_ID', 'threads', `Duplicate thread ID "${id}".`)));
  const threadIds = new Set(threads.map(item => item.id));
  threads.forEach((thread, index) => {
    const validation = validateThreadDefinitionV2(thread);
    errors.push(...validation.errors.map(item => ({ ...item, path: `threads[${index}].${item.path}` })));
    if (!thread.machineColor || typeof thread.machineColor !== 'object' || !parseHexColor(thread.machineColor.hex).valid) errors.push(issue('MALFORMED_MACHINE_COLOR', `threads[${index}].machineColor`, 'Thread machineColor is malformed.'));
    if (!Array.isArray(thread.visualColorSamples) || thread.visualColorSamples.some(color => !parseHexColor(color).valid)) errors.push(issue('INVALID_THREAD_VISUAL_COLOR_SAMPLES', `threads[${index}].visualColorSamples`, 'Thread visualColorSamples must contain valid colors.'));
  });
  assignments.filter(item => item.status === 'assigned').forEach((assignment, index) => {
    if (!threadIds.has(assignment.threadId)) errors.push(issue('ASSIGNMENT_UNKNOWN_THREAD', `assignments[${index}].threadId`, `Unknown thread "${assignment.threadId}".`));
    const thread = threads.find(item => item.id === assignment.threadId);
    if (thread && !thread.visualColorSamples.includes(assignment.normalizedVisualColor)) errors.push(issue('MISSING_SOURCE_VISUAL_COLOR_SAMPLE', `threads.${thread.id}.visualColorSamples`, `Missing ${assignment.normalizedVisualColor}.`));
  });
  if (drafts.length && result?.summary?.draftThreadAssignmentCoveragePercent !== 100) errors.push(issue('THREAD_ASSIGNMENT_COVERAGE_BELOW_100', 'summary.draftThreadAssignmentCoveragePercent', 'Assignment coverage must be 100%.'));
  if (result?.summary?.silentDraftDropCount > 0) errors.push(issue('SILENT_DRAFT_DROP', 'summary.silentDraftDropCount', 'Drafts were silently dropped.'));
  return { valid: errors.length === 0, errors, warnings };
}

export function validateThreadedObjectMaterialization(result, drafts = [], regions = []) {
  const base = validateThreadResolutionResult(result, drafts);
  const errors = [...base.errors];
  const warnings = [...base.warnings];
  const objects = result?.objects || [];
  const assignments = result?.assignments || [];
  const draftMap = new Map(drafts.map(item => [item.id, item]));
  const assignmentMap = new Map(assignments.map(item => [item.draftId, item]));
  const threadIds = new Set((result?.threads || []).map(item => item.id));
  const regionIds = new Set(regions.map(item => item.id));
  duplicateValues(objects.map(item => item.id)).forEach(id => errors.push(issue('DUPLICATE_FINAL_OBJECT_ID', 'objects', `Duplicate final object ID "${id}".`)));
  const objectIds = new Set(objects.map(item => item.id));
  objects.forEach((object, index) => {
    const validation = validateEmbroideryObjectV2(object);
    errors.push(...validation.errors.map(item => ({ ...item, path: `objects[${index}].${item.path}` })));
    const draftId = object.source?.draftId;
    const draft = draftMap.get(draftId);
    const assignment = assignmentMap.get(draftId);
    if (!draft) errors.push(issue('FINAL_OBJECT_UNKNOWN_DRAFT', `objects[${index}].source.draftId`, 'Final object references an unknown draft.'));
    if (draft && object.id !== expectedObjectId(draft.id)) errors.push(issue('INVALID_FINAL_OBJECT_ID', `objects[${index}].id`, 'Final object ID is not deterministic.'));
    if (assignment?.status !== 'assigned') errors.push(issue('FINAL_OBJECT_FOR_BLOCKED_ASSIGNMENT', `objects[${index}]`, 'Blocked assignments cannot materialize final objects.'));
    if (!regionIds.has(object.regionId)) errors.push(issue('FINAL_OBJECT_UNKNOWN_REGION', `objects[${index}].regionId`, 'Final object references an unknown region.'));
    if (!threadIds.has(object.threadId)) errors.push(issue('FINAL_OBJECT_UNKNOWN_THREAD', `objects[${index}].threadId`, 'Final object references an unknown thread.'));
    if (draft && !same(object.geometry, draft.geometryMm)) errors.push(issue('FINAL_OBJECT_GEOMETRY_MUTATION', `objects[${index}].geometry`, 'Geometry changed from the draft.'));
    if (draft && !same(object.holes, draft.holesMm)) errors.push(issue('FINAL_OBJECT_HOLE_MUTATION', `objects[${index}].holes`, 'Holes changed from the draft.'));
    if (draft && !same(object.visualColor, draft.visualColor)) errors.push(issue('FINAL_OBJECT_VISUAL_COLOR_MUTATION', `objects[${index}].visualColor`, 'Visual color changed from the draft.'));
    if (draft && object.role !== draft.role) errors.push(issue('FINAL_OBJECT_ROLE_MUTATION', `objects[${index}].role`, 'Role changed from the draft.'));
    if (draft && object.stitchType !== draft.stitchType) errors.push(issue('FINAL_OBJECT_STITCH_TYPE_MUTATION', `objects[${index}].stitchType`, 'Stitch type changed from the draft.'));
    if (draft && object.layer !== draft.layer) errors.push(issue('FINAL_OBJECT_LAYER_MUTATION', `objects[${index}].layer`, 'Layer changed from the draft.'));
    if (object.entryCandidates?.length) errors.push(issue('FINAL_OBJECT_ENTRY_CANDIDATES_NOT_DEFERRED', `objects[${index}].entryCandidates`, 'Entry candidates must remain empty.'));
    if (object.exitCandidates?.length) errors.push(issue('FINAL_OBJECT_EXIT_CANDIDATES_NOT_DEFERRED', `objects[${index}].exitCandidates`, 'Exit candidates must remain empty.'));
    (object.dependencyIds || []).forEach(dependencyId => {
      if (!objectIds.has(dependencyId)) errors.push(issue('MISSING_TRANSLATED_DEPENDENCY', `objects[${index}].dependencyIds`, `Unknown final dependency "${dependencyId}".`));
      if (dependencyId === object.id) errors.push(issue('FINAL_OBJECT_SELF_DEPENDENCY', `objects[${index}].dependencyIds`, 'Final object cannot depend on itself.'));
    });
    ['stitches', 'stitchCoordinates', 'commands', 'canonicalCommands', 'machineProfile', 'machineOffset', 'encoder'].forEach(field => {
      if (Object.hasOwn(object, field)) errors.push(issue('FORBIDDEN_FINAL_OBJECT_FIELD', `objects[${index}].${field}`, `${field} is forbidden in Phase 6.`));
    });
  });
  cycleIds(objects).forEach(id => errors.push(issue('FINAL_OBJECT_DEPENDENCY_CYCLE', 'objects', `Dependency cycle includes "${id}".`)));
  ['threadBlocks', 'commands', 'canonicalCommands', 'machineProfile', 'encoder'].forEach(field => {
    if (Object.hasOwn(result || {}, field)) errors.push(issue('FORBIDDEN_THREADED_MATERIALIZATION_FIELD', field, `${field} is forbidden in Phase 6.`));
  });
  if (result?.metadata?.inputMutationsDetected) errors.push(issue('THREADED_MATERIALIZATION_INPUT_MUTATION', 'metadata.inputMutationsDetected', 'Inputs were mutated.'));
  return { valid: errors.length === 0, errors, warnings, dependencyCycleCount: cycleIds(objects).length };
}

export const _threadResolutionValidationInternals = Object.freeze({ cycleIds });
