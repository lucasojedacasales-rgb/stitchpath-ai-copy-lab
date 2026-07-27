import { createEmbroideryObjectV2, createThreadDefinitionV2 } from '../model.js';
import { createDraftThreadAssignmentV2 } from './threadAssignmentModel.js';
import { resolveDraftThreadAssignments } from './threadPaletteResolver.js';
import { validateThreadedObjectMaterialization } from './threadResolutionValidation.js';

const issue = (code, path, message) => ({ code, path, message });

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  return value;
}

function snapshot(value) {
  try { return JSON.stringify(value); } catch { return null; }
}

export function finalObjectIdForDraft(draftId) {
  return typeof draftId === 'string' && draftId.startsWith('draft:') ? `object:${draftId.slice(6)}` : null;
}

function buildExecutionLayers(objects) {
  const byId = new Map(objects.map(item => [item.id, item]));
  const emitted = new Set();
  const executionLayers = [];
  while (emitted.size < objects.length) {
    const ready = [...byId.keys()].filter(id => !emitted.has(id) && byId.get(id).dependencyIds.every(dependencyId => emitted.has(dependencyId))).sort();
    if (!ready.length) return { executionLayers, dependencyCycleCount: objects.length - emitted.size };
    executionLayers.push(ready);
    ready.forEach(id => emitted.add(id));
  }
  return { executionLayers, dependencyCycleCount: 0 };
}

export function translateDraftDependenciesToFinalObjects({ drafts = [], assignments = [], config = {} }) {
  const draftMap = new Map(drafts.map(item => [item.id, item]));
  let assignmentMap = new Map(assignments.map(item => [item.draftId, item]));
  const warnings = [];
  let changed = true;
  while (changed && config.blockOnUnassignedDependency !== false) {
    changed = false;
    [...drafts].sort((a, b) => a.id.localeCompare(b.id)).forEach(draft => {
      const assignment = assignmentMap.get(draft.id);
      if (assignment?.status !== 'assigned') return;
      const unavailable = (draft.dependencyIds || []).filter(id => !draftMap.has(id) || assignmentMap.get(id)?.status !== 'assigned');
      if (!unavailable.length) return;
      assignmentMap.set(draft.id, createDraftThreadAssignmentV2({
        ...assignment,
        status: 'blocked',
        threadId: null,
        reasonCode: 'REQUIRED_THREADED_DEPENDENCY_NOT_MATERIALIZED',
        reason: `Required threaded dependencies were not materialized: ${unavailable.join(', ')}.`,
        evidence: [...assignment.evidence, { code: 'REQUIRED_THREADED_DEPENDENCY_NOT_MATERIALIZED', dependencyIds: unavailable }],
      }));
      warnings.push(issue('REQUIRED_THREADED_DEPENDENCY_NOT_MATERIALIZED', `drafts.${draft.id}.dependencyIds`, `Blocked because threaded dependencies were unavailable: ${unavailable.join(', ')}.`));
      changed = true;
    });
  }
  const translatedAssignments = assignments.map(item => assignmentMap.get(item.draftId) || item);
  const materializable = new Set(translatedAssignments.filter(item => item.status === 'assigned').map(item => item.draftId));
  const dependencyIdsByDraftId = Object.fromEntries([...drafts].sort((a, b) => a.id.localeCompare(b.id)).filter(item => materializable.has(item.id)).map(draft => [
    draft.id,
    (draft.dependencyIds || []).filter(id => materializable.has(id)).map(finalObjectIdForDraft).sort(),
  ]));
  return { assignments: translatedAssignments, dependencyIdsByDraftId, blockedDraftIds: translatedAssignments.filter(item => item.status === 'blocked').map(item => item.draftId).sort(), warnings };
}

function activeThreads(threads, assignments) {
  const byId = new Map(threads.map(item => [item.id, item]));
  const groups = new Map();
  assignments.filter(item => item.status === 'assigned').forEach(item => {
    const values = groups.get(item.threadId) || [];
    values.push(item);
    groups.set(item.threadId, values);
  });
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([threadId, items]) => {
    const source = byId.get(threadId);
    return createThreadDefinitionV2({
      ...source,
      visualColorSamples: [...new Set(items.map(item => item.normalizedVisualColor))].sort(),
      confidence: Math.min(...items.map(item => item.confidence)),
    });
  });
}

function finalParameters(draft, assignment) {
  const parameters = clone(draft.parameters || {});
  parameters.threadResolution = {
    assignmentId: assignment.id,
    threadId: assignment.threadId,
    policy: assignment.policy,
    paletteEntryId: assignment.paletteEntryId,
    selectedMachineColor: clone(assignment.machineColor),
    normalizedVisualColor: assignment.normalizedVisualColor,
    deltaE: assignment.deltaE,
    exactMatch: assignment.exactMatch,
    physicalSpoolAvailabilityVerified: assignment.policy !== 'artwork_exact',
  };
  parameters.deferred = {
    ...(parameters.deferred || {}),
    threadAssignment: false,
    stitchGeneration: true,
    underlayPlanning: true,
    fillAngleSelection: true,
    densitySelection: true,
    pullCompensation: true,
    entryExitPlanning: true,
    globalSequencing: true,
    machineAdaptation: true,
  };
  return parameters;
}

function summaryFor(drafts, assignments, threads, objects, layers, resolutionSummary) {
  const count = (items, field, value) => items.filter(item => item[field] === value).length;
  return {
    ...resolutionSummary,
    sourceDraftCount: drafts.length,
    assignmentCount: assignments.length,
    assignedCount: count(assignments, 'status', 'assigned'),
    blockedCount: count(assignments, 'status', 'blocked'),
    finalObjectCount: objects.length,
    threadDefinitionCount: threads.length,
    pendingThreadAssignmentCount: 0,
    missingThreadIdCount: objects.filter(item => !item.threadId).length,
    dependencyCount: objects.reduce((sum, item) => sum + item.dependencyIds.length, 0),
    dependencyCycleCount: layers.dependencyCycleCount,
    baseFillObjectCount: count(objects, 'role', 'base_fill'),
    foregroundFillObjectCount: count(objects, 'role', 'foreground_fill'),
    internalDetailObjectCount: count(objects, 'role', 'internal_detail'),
    darkDetailObjectCount: count(objects, 'role', 'dark_detail'),
    highlightObjectCount: count(objects, 'role', 'highlight'),
    outerOutlineObjectCount: count(objects, 'role', 'outer_outline'),
    innerOutlineObjectCount: count(objects, 'role', 'inner_outline'),
  };
}

export function materializeThreadedEmbroideryObjects({ regions = [], objectDraftMaterialization, threadResolutionConfig = {} }) {
  const before = snapshot({ regions, objectDraftMaterialization, threadResolutionConfig });
  const drafts = [...(objectDraftMaterialization?.drafts || [])];
  const resolution = resolveDraftThreadAssignments({ drafts, config: threadResolutionConfig });
  const translation = translateDraftDependenciesToFinalObjects({ drafts, assignments: resolution.assignments, config: resolution.config });
  const assignmentMap = new Map(translation.assignments.map(item => [item.draftId, item]));
  const objectIdOwners = new Map();
  const errors = [...resolution.errors];
  drafts.forEach(draft => {
    const objectId = finalObjectIdForDraft(draft.id);
    if (!objectId) errors.push(issue('INVALID_FINAL_OBJECT_ID', `drafts.${draft.id}.id`, 'Draft ID cannot be translated to a final object ID.'));
    const owner = objectIdOwners.get(objectId);
    if (objectId && owner && owner !== draft.id) errors.push(issue('FINAL_OBJECT_ID_COLLISION', 'drafts', `Drafts "${owner}" and "${draft.id}" produce the same object ID.`));
    else if (objectId) objectIdOwners.set(objectId, draft.id);
  });
  const objects = [...drafts].sort((a, b) => a.id.localeCompare(b.id)).filter(draft => assignmentMap.get(draft.id)?.status === 'assigned' && finalObjectIdForDraft(draft.id)).map(draft => {
    const assignment = assignmentMap.get(draft.id);
    return createEmbroideryObjectV2({
      id: finalObjectIdForDraft(draft.id),
      regionId: draft.regionId,
      role: draft.role,
      stitchType: draft.stitchType,
      geometry: draft.geometryMm,
      holes: draft.holesMm,
      visualColor: draft.visualColor,
      layer: draft.layer,
      dependencyIds: translation.dependencyIdsByDraftId[draft.id] || [],
      threadId: assignment.threadId,
      entryCandidates: [],
      exitCandidates: [],
      parameters: finalParameters(draft, assignment),
      confidence: Math.min(draft.materializationConfidence, assignment.confidence),
      source: {
        draftId: draft.id,
        proposalId: draft.proposalId,
        reviewDecisionId: draft.reviewDecisionId,
        threadAssignmentId: assignment.id,
        sourceRegion: clone(draft.source),
        threadResolutionPolicy: assignment.policy,
      },
    });
  });
  const threads = activeThreads(resolution.threads, translation.assignments);
  const layers = buildExecutionLayers(objects);
  if (layers.dependencyCycleCount) errors.push(issue('FINAL_OBJECT_DEPENDENCY_CYCLE', 'objects', 'Final object dependencies contain a cycle.'));
  const summary = summaryFor(drafts, translation.assignments, threads, objects, layers, resolution.summary);
  const result = {
    version: '2-threaded-object-materialization',
    assignments: translation.assignments,
    threads,
    objects,
    byAssignmentId: Object.fromEntries(translation.assignments.map(item => [item.id, item])),
    byDraftId: Object.fromEntries(translation.assignments.map(item => [item.draftId, item])),
    byThreadId: Object.fromEntries(threads.map(thread => [thread.id, objects.filter(object => object.threadId === thread.id)])),
    byObjectId: Object.fromEntries(objects.map(item => [item.id, item])),
    byRegionId: Object.fromEntries(objects.map(item => [item.regionId, item])),
    executionLayers: layers.executionLayers,
    valid: errors.length === 0,
    errors,
    warnings: [...resolution.warnings, ...translation.warnings],
    summary,
    config: resolution.config,
    metadata: {
      inputMutationsDetected: before !== snapshot({ regions, objectDraftMaterialization, threadResolutionConfig }),
      threadAssignmentsResolved: true,
      threadDefinitionsCreated: true,
      finalEmbroideryObjectsMaterialized: true,
      threadBlocksCreated: 0,
      stitchCoordinatesGenerated: false,
      canonicalCommandsGenerated: false,
      globalSequencingApplied: false,
      travelOptimizationApplied: false,
      machineAdaptationApplied: false,
      encodingApplied: false,
    },
  };
  const validation = validateThreadedObjectMaterialization(result, drafts, regions);
  return { ...result, valid: result.valid && validation.valid, errors: [...result.errors, ...validation.errors], warnings: [...result.warnings, ...validation.warnings] };
}
