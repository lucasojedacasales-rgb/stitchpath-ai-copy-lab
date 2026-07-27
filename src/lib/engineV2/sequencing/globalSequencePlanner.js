import { validateEmbroideryObjectV2, validateThreadDefinitionV2 } from '../modelValidation.js';
import { validateObjectTechnicalSpecificationV2 } from '../technical/technicalPlanningValidation.js';
import { enumerateValidEntryExitPairs, sequencePointDistance } from './candidatePairSelector.js';
import { scheduleDependencyAwareObjects } from './dependencyAwareScheduler.js';
import { createSequenceCost } from './sequenceCostModel.js';
import {
  createGlobalSequencePlanV2,
  createObjectExecutionStepV2,
  createObjectSequenceDispositionV2,
  createSelectedEntryExitPairV2,
  createSequenceTransitionV2,
  executionStepId,
  selectedEntryExitIdForObject,
} from './sequencePlanningModel.js';
import { resolveSequencePlanningConfig, validateSequencePlanningConfig } from './sequencePlanningConfig.js';
import { validateGlobalSequencePlan } from './sequencePlanningValidation.js';
import { buildThreadBlocksFromExecution } from './threadBlockBuilder.js';

const issue = (code, path, message) => ({ code, path, message });
const snapshot = value => { try { return JSON.stringify(value); } catch { return null; } };

function fingerprint(value) {
  const text = snapshot(value) ?? '';
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function dependencyCycleCount(objects) {
  const byId = new Map(objects.map(object => [object.id, object]));
  const visiting = new Set(); const visited = new Set(); const cycles = new Set();
  const visit = id => {
    if (visiting.has(id)) { cycles.add(id); return; }
    if (visited.has(id)) return;
    visiting.add(id); (byId.get(id)?.dependencyIds || []).filter(dependencyId => byId.has(dependencyId)).forEach(visit);
    visiting.delete(id); visited.add(id);
  };
  objects.forEach(object => visit(object.id));
  return cycles.size;
}

function initialDispositions(objects, technicalPlan, config) {
  const specifications = technicalPlan?.specifications || [];
  const grouped = new Map();
  specifications.forEach(specification => grouped.set(specification.objectId, [...(grouped.get(specification.objectId) || []), specification]));
  return [...objects].sort((left, right) => left.id.localeCompare(right.id)).map(object => {
    const matches = grouped.get(object.id) || [];
    const specification = matches.length === 1 ? matches[0] : null;
    if (!specification || !validateObjectTechnicalSpecificationV2(specification, { object, config: technicalPlan?.config }).valid) {
      return createObjectSequenceDispositionV2({ objectId: object.id, technicalSpecificationId: specification?.id ?? null, status: 'blocked', reasonCode: 'MISSING_OR_INVALID_TECHNICAL_SPECIFICATION', reason: 'A unique valid Phase 7 technical specification is required.', evidence: [] });
    }
    if (specification.status === 'manual_required') return createObjectSequenceDispositionV2({ objectId: object.id, technicalSpecificationId: specification.id, status: 'manual_required', reasonCode: 'TECHNICAL_SPECIFICATION_REQUIRES_MANUAL_WORK', reason: 'Phase 7 marked this object as manual-required.', evidence: specification.blockingReasons });
    if (specification.status !== 'planned' || specification.generatorReadiness?.ready !== true) return createObjectSequenceDispositionV2({ objectId: object.id, technicalSpecificationId: specification.id, status: 'blocked', reasonCode: 'TECHNICAL_SPECIFICATION_BLOCKED', reason: 'Phase 7 did not provide a ready automatic generator.', evidence: specification.blockingReasons });
    const pairs = enumerateValidEntryExitPairs({ object, specification, config });
    if (!pairs.length) return createObjectSequenceDispositionV2({ objectId: object.id, technicalSpecificationId: specification.id, status: 'blocked', reasonCode: 'NO_VALID_ENTRY_EXIT_PAIR', reason: 'No valid pair can be selected from Phase 7 candidates.', evidence: [] });
    return createObjectSequenceDispositionV2({ objectId: object.id, technicalSpecificationId: specification.id, status: 'scheduled', reasonCode: 'READY_FOR_GLOBAL_SEQUENCE', reason: 'Technical specification and entry/exit candidates are ready.', evidence: [] });
  });
}

function applyDependencyBlocking(dispositions, objects, config) {
  if (!config.blockOnUnscheduledDependency) return dispositions;
  const objectMap = new Map(objects.map(object => [object.id, object]));
  let result = [...dispositions]; let changed = true;
  while (changed) {
    changed = false;
    const dispositionMap = new Map(result.map(item => [item.objectId, item]));
    result = result.map(disposition => {
      if (disposition.status !== 'scheduled') return disposition;
      const unavailable = (objectMap.get(disposition.objectId)?.dependencyIds || []).filter(dependencyId => dispositionMap.get(dependencyId)?.status !== 'scheduled');
      if (!unavailable.length) return disposition;
      changed = true;
      return createObjectSequenceDispositionV2({
        objectId: disposition.objectId,
        technicalSpecificationId: disposition.technicalSpecificationId,
        status: 'blocked',
        reasonCode: 'REQUIRED_SEQUENCED_DEPENDENCY_NOT_AVAILABLE',
        reason: `Required sequenced dependencies are unavailable: ${unavailable.join(', ')}.`,
        evidence: [{ code: 'REQUIRED_SEQUENCED_DEPENDENCY_NOT_AVAILABLE', dependencyIds: unavailable }],
      });
    });
  }
  return result;
}

function structuralLayers(objects) {
  const byId = new Map(objects.map(object => [object.id, object]));
  const memo = new Map();
  const visiting = new Set();
  const depth = id => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const dependencies = (byId.get(id)?.dependencyIds || []).filter(dependencyId => byId.has(dependencyId));
    const value = dependencies.length ? 1 + Math.max(...dependencies.map(depth)) : 0;
    visiting.delete(id); memo.set(id, value); return value;
  };
  const layers = [];
  [...byId.keys()].sort().forEach(id => {
    const index = depth(id);
    if (!layers[index]) layers[index] = [];
    layers[index].push(id);
  });
  return { layers: layers.map(layer => layer.sort()), byObjectId: Object.fromEntries([...byId.keys()].map(id => [id, depth(id)])) };
}

function buildBaseline(objects, specificationMap, config) {
  const byId = new Map(objects.map(object => [object.id, object]));
  const emitted = new Set(); const order = [];
  while (emitted.size < objects.length) {
    const ready = objects.filter(object => !emitted.has(object.id) && (object.dependencyIds || []).every(dependencyId => emitted.has(dependencyId) || !byId.has(dependencyId))).sort((left, right) => left.id.localeCompare(right.id));
    if (!ready.length) break;
    const object = ready[0]; emitted.add(object.id);
    const pair = enumerateValidEntryExitPairs({ object, specification: specificationMap.get(object.id), config })[0];
    order.push({ object, pair });
  }
  let travel = 0; let changes = 0; let revisits = 0; let previous = null; const closed = new Set();
  order.forEach((item, index) => {
    if (index === 0 && config.startAnchorMm) travel += sequencePointDistance(config.startAnchorMm, item.pair.entryCandidate.point);
    if (previous) {
      travel += sequencePointDistance(previous.pair.exitCandidate.point, item.pair.entryCandidate.point);
      if (previous.object.threadId !== item.object.threadId) {
        changes += 1; closed.add(previous.object.threadId);
        if (closed.has(item.object.threadId)) revisits += 1;
      }
    }
    previous = item;
  });
  return { order, threadChangeCount: changes, threadRevisitCount: revisits, estimatedTravelMm: travel };
}

function summaryFor({ objects, dispositions, selections, steps, blocks, transitions, searchMetadata, baseline, inputMutationsDetected }) {
  const scheduled = dispositions.filter(item => item.status === 'scheduled');
  const uniqueThreads = new Set(steps.map(item => item.threadId));
  const revisits = blocks.filter(block => block.repeatedThreadReason !== null);
  const optimizedTravel = transitions.reduce((sum, transition) => sum + transition.distanceMm, 0) + (selections[0]?.incomingTravelMm ?? 0);
  return {
    sourceFinalObjectCount: objects.length,
    dispositionCount: dispositions.length,
    sequenceDispositionCoveragePercent: objects.length ? new Set(dispositions.map(item => item.objectId)).size / objects.length * 100 : 100,
    silentFinalObjectDropCount: objects.filter(object => !dispositions.some(item => item.objectId === object.id)).length,
    duplicateDispositionCount: dispositions.length - new Set(dispositions.map(item => item.objectId)).size,
    scheduledObjectCount: scheduled.length,
    manualRequiredCount: dispositions.filter(item => item.status === 'manual_required').length,
    blockedCount: dispositions.filter(item => item.status === 'blocked').length,
    executionStepCount: steps.length,
    selectedEntryExitPairCount: selections.length,
    objectsWithoutSelectedEntry: scheduled.filter(item => !selections.some(selection => selection.objectId === item.objectId && selection.entryCandidateId)).length,
    objectsWithoutSelectedExit: scheduled.filter(item => !selections.some(selection => selection.objectId === item.objectId && selection.exitCandidateId)).length,
    uniqueThreadCount: uniqueThreads.size,
    threadBlockCount: blocks.length,
    threadChangeCount: Math.max(0, blocks.length - 1),
    threadRevisitCount: revisits.length,
    repeatedThreadReasonCount: revisits.length,
    structuralDependencyCount: objects.reduce((sum, object) => sum + (object.dependencyIds || []).length, 0),
    dependencyViolationCount: steps.reduce((sum, step, index) => sum + step.structuralDependencyIds.filter(id => steps.findIndex(candidate => candidate.objectId === id) >= index).length, 0),
    dependencyCycleCount: dependencyCycleCount(objects),
    transitionCount: transitions.length,
    estimatedTravelMm: optimizedTravel,
    baselineEstimatedTravelMm: baseline.estimatedTravelMm,
    estimatedTravelReductionPercent: baseline.estimatedTravelMm > 0 ? (baseline.estimatedTravelMm - optimizedTravel) / baseline.estimatedTravelMm * 100 : 0,
    baselineThreadChangeCount: baseline.threadChangeCount,
    optimizedThreadChangeCount: Math.max(0, blocks.length - 1),
    baselineThreadRevisitCount: baseline.threadRevisitCount,
    optimizedThreadRevisitCount: revisits.length,
    exactSearchUsed: searchMetadata?.algorithmUsed === 'exact',
    beamSearchUsed: searchMetadata?.algorithmUsed === 'beam',
    optimalityGuaranteed: searchMetadata?.optimalityGuaranteed === true,
    expandedStateCount: searchMetadata?.expandedStateCount ?? 0,
    prunedStateCount: searchMetadata?.prunedStateCount ?? 0,
    objectMutationCount: inputMutationsDetected ? 1 : 0,
    geometryMutationCount: 0, holeMutationCount: 0, visualColorMutationCount: 0, threadIdMutationCount: 0,
    roleMutationCount: 0, stitchTypeMutationCount: 0, layerMutationCount: 0, dependencyMutationCount: 0,
    technicalSpecificationMutationCount: 0,
    physicalStitchCoordinateCount: 0, physicalUnderlayCoordinateCount: 0, canonicalCommandCount: 0,
  };
}

export function buildGlobalSequencePlan({ regions = [], threadedObjectMaterialization, technicalPlan, config: rawConfig = {} }) {
  const before = snapshot({ regions, threadedObjectMaterialization, technicalPlan, rawConfig });
  const objects = threadedObjectMaterialization?.objects || []; const threads = threadedObjectMaterialization?.threads || [];
  const config = resolveSequencePlanningConfig(rawConfig); const configValidation = validateSequencePlanningConfig(config);
  const errors = [...configValidation.errors]; const warnings = [];
  objects.forEach((object, index) => errors.push(...validateEmbroideryObjectV2(object).errors.map(item => ({ ...item, path: `objects[${index}].${item.path}` }))));
  threads.forEach((thread, index) => errors.push(...validateThreadDefinitionV2(thread).errors.map(item => ({ ...item, path: `threads[${index}].${item.path}` }))));
  let dispositions = applyDependencyBlocking(initialDispositions(objects, technicalPlan, config), objects, config);
  const scheduledIds = new Set(dispositions.filter(item => item.status === 'scheduled').map(item => item.objectId));
  const scheduledObjects = objects.filter(object => scheduledIds.has(object.id));
  const specificationMap = new Map((technicalPlan?.specifications || []).map(specification => [specification.objectId, specification]));
  const scheduledSpecifications = scheduledObjects.map(object => specificationMap.get(object.id));
  const scheduler = scheduleDependencyAwareObjects({ objects: scheduledObjects, technicalSpecifications: scheduledSpecifications, config });
  errors.push(...scheduler.errors); warnings.push(...scheduler.warnings);
  const layers = structuralLayers(scheduledObjects);

  const selections = scheduler.execution.map(item => createSelectedEntryExitPairV2({
    objectId: item.objectId,
    entryCandidateId: item.entryCandidateId,
    exitCandidateId: item.exitCandidateId,
    entryPoint: item.pair.entryCandidate.point,
    exitPoint: item.pair.exitCandidate.point,
    entrySourceType: item.pair.entryCandidate.sourceType,
    exitSourceType: item.pair.exitCandidate.sourceType,
    incomingTravelMm: item.incomingTravelMm,
    source: { planner: 'engineV2-global-sequence', phase7CandidatePointsPreserved: true },
  }));
  const preliminarySteps = scheduler.execution.map((item, sequenceIndex) => {
    const object = scheduledObjects.find(candidate => candidate.id === item.objectId);
    return createObjectExecutionStepV2({
      sequenceIndex, objectId: object.id, regionId: object.regionId, threadId: object.threadId,
      threadBlockId: 'pending-thread-block', technicalSpecificationId: item.specificationId,
      selectedEntryExitId: selectedEntryExitIdForObject(object.id), structuralDependencyIds: object.dependencyIds,
      executionLayer: layers.byObjectId[object.id], role: object.role, stitchType: object.stitchType,
      source: { planner: 'engineV2-global-sequence', repeatedThreadReason: item.repeatedThreadReason },
    });
  });
  const blockResult = buildThreadBlocksFromExecution({ executionSteps: preliminarySteps, objects: scheduledObjects, searchMetadata: scheduler.searchMetadata });
  errors.push(...blockResult.errors); warnings.push(...blockResult.warnings);
  const blockByObjectId = new Map(blockResult.threadBlocks.flatMap(block => block.objectIds.map(objectId => [objectId, block.id])));
  const steps = preliminarySteps.map(step => createObjectExecutionStepV2({ ...step, id: executionStepId(step.sequenceIndex, step.objectId), threadBlockId: blockByObjectId.get(step.objectId) }));
  const selectionMap = new Map(selections.map(selection => [selection.objectId, selection]));
  const objectMap = new Map(objects.map(object => [object.id, object]));
  const transitions = steps.slice(1).map((step, index) => {
    const from = steps[index]; const fromSelection = selectionMap.get(from.objectId); const toSelection = selectionMap.get(step.objectId);
    return createSequenceTransitionV2({
      fromObjectId: from.objectId, toObjectId: step.objectId,
      fromExitCandidateId: fromSelection.exitCandidateId, toEntryCandidateId: toSelection.entryCandidateId,
      distanceMm: sequencePointDistance(fromSelection.exitPoint, toSelection.entryPoint),
      threadChanged: from.threadId !== step.threadId, sameThread: from.threadId === step.threadId,
      dependencyRelated: (objectMap.get(step.objectId)?.dependencyIds || []).includes(from.objectId),
      source: { planner: 'engineV2-global-sequence', estimatedOnly: true },
    });
  });
  const baseline = buildBaseline(scheduledObjects, specificationMap, config);
  const inputMutationsDetected = before !== snapshot({ regions, threadedObjectMaterialization, technicalPlan, rawConfig });
  const summary = summaryFor({ objects, dispositions, selections, steps, blocks: blockResult.threadBlocks, transitions, searchMetadata: scheduler.searchMetadata, baseline, inputMutationsDetected });
  const byObjectId = Object.fromEntries(objects.map(object => [object.id, {
    dispositionId: dispositions.find(item => item.objectId === object.id)?.id ?? null,
    selectedEntryExitId: selections.find(item => item.objectId === object.id)?.id ?? null,
    executionId: steps.find(item => item.objectId === object.id)?.id ?? null,
    threadBlockId: blockByObjectId.get(object.id) ?? null,
  }]));
  const metadata = {
    inputMutationsDetected, objectMutationsDetected: false, technicalSpecificationMutationsDetected: false,
    globalSequenceCreated: true, threadBlocksCreated: true, finalEntryExitPairsSelected: true,
    baseline: { objectIds: baseline.order.map(item => item.object.id), threadChangeCount: baseline.threadChangeCount, threadRevisitCount: baseline.threadRevisitCount, estimatedTravelMm: baseline.estimatedTravelMm },
    objectGeometryModified: false, objectHolesModified: false, objectVisualColorsModified: false, threadIdsModified: false,
    rolesModified: false, stitchTypesModified: false, layersModified: false, dependenciesModified: false, technicalSpecificationsModified: false,
    physicalStitchesGenerated: false, physicalUnderlayGenerated: false, jumpCommandsGenerated: false, trimCommandsGenerated: false,
    colorChangeCommandsGenerated: false, canonicalCommandsGenerated: false, machineAdaptationAdded: false, encodingAdded: false,
    endAnchorDiagnosticDistanceMm: config.endAnchorMm && selections.length ? sequencePointDistance(selections.at(-1).exitPoint, config.endAnchorMm) : null,
    sourceContracts: {
      objectFingerprints: Object.fromEntries(objects.map(object => [object.id, fingerprint(object)])),
      threadFingerprints: Object.fromEntries(threads.map(thread => [thread.id, fingerprint(thread)])),
      technicalSpecificationFingerprints: Object.fromEntries((technicalPlan?.specifications || []).map(specification => [specification.id, fingerprint(specification)])),
    },
  };
  const draft = {
    version: '2-global-sequence-plan', dispositions, selectedEntryExitPairs: selections, executionSteps: steps,
    transitions, threadBlocks: blockResult.threadBlocks, executionLayers: layers.layers, byObjectId,
    byDispositionId: Object.fromEntries(dispositions.map(item => [item.id, item])),
    bySelectedEntryExitId: Object.fromEntries(selections.map(item => [item.id, item])),
    byExecutionId: Object.fromEntries(steps.map(item => [item.id, item])),
    byThreadBlockId: Object.fromEntries(blockResult.threadBlocks.map(item => [item.id, item])),
    searchMetadata: scheduler.searchMetadata, valid: errors.length === 0 && scheduler.complete,
    errors, warnings, summary, config, metadata,
  };
  const validation = validateGlobalSequencePlan(draft, threadedObjectMaterialization, technicalPlan);
  return createGlobalSequencePlanV2({ ...draft, valid: draft.valid && validation.valid, errors: [...errors, ...validation.errors], warnings: [...warnings, ...validation.warnings] });
}

export const _globalSequencePlannerInternals = Object.freeze({ buildBaseline, structuralLayers, createSequenceCost });
