import { enumerateValidEntryExitPairs, sequencePointDistance } from './candidatePairSelector.js';
import { compareSequenceCosts, createSequenceCost, formatSequenceStableSignature } from './sequenceCostModel.js';
import { createSequenceSearchMetadataV2 } from './sequencePlanningModel.js';
import { resolveSequenceAlgorithm } from './sequencePlanningConfig.js';

const issue = (code, path, message) => ({ code, path, message });

function eligibleObjects(state, objects, byId) {
  const eligible = objects.filter(object => !state.scheduledIds.has(object.id)
    && (object.dependencyIds || []).every(dependencyId => state.scheduledIds.has(dependencyId) || !byId.has(dependencyId)));
  const sameThread = state.currentThreadId ? eligible.filter(object => object.threadId === state.currentThreadId) : [];
  return (sameThread.length ? sameThread : eligible).sort((left, right) => left.id.localeCompare(right.id));
}

function stateCost(state, totalCount) {
  return createSequenceCost({
    dependencyViolationCount: 0,
    unscheduledSchedulableObjectCount: totalCount - state.execution.length,
    threadChangeCount: state.threadChangeCount,
    threadRevisitCount: state.threadRevisitCount,
    estimatedTravelMm: state.estimatedTravelMm,
    stableSignature: formatSequenceStableSignature({ executionSteps: state.execution }),
  });
}

function stateKey(state) {
  return [
    [...state.scheduledIds].sort().join(','),
    state.currentObjectId ?? '',
    state.currentExitCandidateId ?? '',
    state.currentThreadId ?? '',
    [...state.closedThreadIds].sort().join(','),
  ].join('::');
}

function expandState(state, objects, byId, specificationByObjectId, pairsByObjectId, config) {
  const eligible = eligibleObjects(state, objects, byId);
  return eligible.flatMap(object => pairsByObjectId.get(object.id).map(pair => {
    const threadChanged = state.currentThreadId !== null && state.currentThreadId !== object.threadId;
    const revisited = threadChanged && state.closedThreadIds.has(object.threadId);
    if (revisited && !config.allowDependencyRequiredThreadRevisit) return null;
    const incomingTravelMm = state.currentExitPoint
      ? sequencePointDistance(state.currentExitPoint, pair.entryCandidate.point)
      : config.startAnchorMm ? sequencePointDistance(config.startAnchorMm, pair.entryCandidate.point) : 0;
    const closedThreadIds = new Set(state.closedThreadIds);
    let departureDependencyGated = false;
    if (threadChanged) {
      closedThreadIds.add(state.currentThreadId);
      departureDependencyGated = objects.some(candidate => !state.scheduledIds.has(candidate.id)
        && candidate.id !== object.id && candidate.threadId === state.currentThreadId);
    }
    const scheduledIds = new Set(state.scheduledIds);
    scheduledIds.add(object.id);
    const repeatedThreadReason = revisited ? 'dependency_gated_revisit' : null;
    const execution = [...state.execution, {
      objectId: object.id,
      specificationId: specificationByObjectId.get(object.id).id,
      entryCandidateId: pair.entryCandidate.id,
      exitCandidateId: pair.exitCandidate.id,
      pair,
      incomingTravelMm,
      repeatedThreadReason,
      departureDependencyGated,
    }];
    return {
      scheduledIds,
      currentObjectId: object.id,
      currentExitCandidateId: pair.exitCandidate.id,
      currentExitPoint: pair.exitCandidate.point,
      currentThreadId: object.threadId,
      closedThreadIds,
      execution,
      threadChangeCount: state.threadChangeCount + (threadChanged ? 1 : 0),
      threadRevisitCount: state.threadRevisitCount + (revisited ? 1 : 0),
      estimatedTravelMm: state.estimatedTravelMm + incomingTravelMm,
    };
  }).filter(Boolean));
}

function deduplicateStates(states, totalCount) {
  const best = new Map();
  let pruned = 0;
  states.forEach(state => {
    const key = stateKey(state);
    const prior = best.get(key);
    if (!prior || compareSequenceCosts(stateCost(state, totalCount), stateCost(prior, totalCount)) < 0) {
      if (prior) pruned += 1;
      best.set(key, state);
    } else pruned += 1;
  });
  return { states: [...best.values()], pruned };
}

function initialState() {
  return {
    scheduledIds: new Set(), currentObjectId: null, currentExitCandidateId: null, currentExitPoint: null,
    currentThreadId: null, closedThreadIds: new Set(), execution: [], threadChangeCount: 0,
    threadRevisitCount: 0, estimatedTravelMm: 0,
  };
}

export function scheduleDependencyAwareObjects({ objects = [], technicalSpecifications = [], config }) {
  const sortedObjects = [...objects].sort((left, right) => left.id.localeCompare(right.id));
  const byId = new Map(sortedObjects.map(object => [object.id, object]));
  const specificationByObjectId = new Map(technicalSpecifications.map(specification => [specification.objectId, specification]));
  const pairsByObjectId = new Map(sortedObjects.map(object => [object.id, enumerateValidEntryExitPairs({ object, specification: specificationByObjectId.get(object.id), config })]));
  const errors = [];
  sortedObjects.forEach(object => {
    if (!pairsByObjectId.get(object.id).length) errors.push(issue('NO_VALID_ENTRY_EXIT_PAIR', `objects.${object.id}`, `Object "${object.id}" has no valid entry/exit pair.`));
  });
  const algorithmUsed = resolveSequenceAlgorithm(config, sortedObjects.length);
  if (errors.length) return {
    complete: false, execution: [], errors, warnings: [],
    searchMetadata: createSequenceSearchMetadataV2({ algorithmRequested: config.algorithm, algorithmUsed, exactSearchObjectLimit: config.exactSearchObjectLimit, beamWidth: config.beamWidth, maximumExpandedStates: config.maximumExpandedStates }),
  };

  let frontier = [initialState()];
  let expandedStateCount = 0;
  let prunedStateCount = 0;
  let maximumExpandedStatesReached = false;
  for (let depth = 0; depth < sortedObjects.length; depth += 1) {
    const expanded = [];
    for (const state of frontier) {
      const next = expandState(state, sortedObjects, byId, specificationByObjectId, pairsByObjectId, config);
      expandedStateCount += next.length;
      if (expandedStateCount > config.maximumExpandedStates) {
        maximumExpandedStatesReached = true;
        break;
      }
      expanded.push(...next);
    }
    if (maximumExpandedStatesReached) break;
    const deduplicated = deduplicateStates(expanded, sortedObjects.length);
    prunedStateCount += deduplicated.pruned;
    const ordered = deduplicated.states.sort((left, right) => compareSequenceCosts(stateCost(left, sortedObjects.length), stateCost(right, sortedObjects.length)));
    if (algorithmUsed === 'beam' && ordered.length > config.beamWidth) {
      prunedStateCount += ordered.length - config.beamWidth;
      frontier = ordered.slice(0, config.beamWidth);
    } else frontier = ordered;
    if (!frontier.length) break;
  }

  const completeStates = maximumExpandedStatesReached ? [] : frontier.filter(state => state.execution.length === sortedObjects.length);
  const best = completeStates.sort((left, right) => compareSequenceCosts(stateCost(left, sortedObjects.length), stateCost(right, sortedObjects.length)))[0] ?? null;
  if (maximumExpandedStatesReached) errors.push(issue('MAXIMUM_EXPANDED_STATES_REACHED', 'search', 'The configured deterministic state limit was reached; no partial sequence was returned.'));
  else if (!best) errors.push(issue('NO_COMPLETE_DEPENDENCY_VALID_SEQUENCE', 'search', 'No complete dependency-valid sequence exists.'));
  const warnings = [];
  if (algorithmUsed === 'beam') warnings.push(issue('SEQUENCE_OPTIMALITY_NOT_GUARANTEED', 'search', 'Beam search is deterministic but does not guarantee the global optimum.'));
  const cost = best ? stateCost(best, sortedObjects.length) : null;
  return {
    complete: Boolean(best),
    execution: best?.execution ?? [],
    errors,
    warnings,
    searchMetadata: createSequenceSearchMetadataV2({
      algorithmRequested: config.algorithm,
      algorithmUsed,
      exactSearchObjectLimit: config.exactSearchObjectLimit,
      beamWidth: config.beamWidth,
      maximumExpandedStates: config.maximumExpandedStates,
      optimalityGuaranteed: algorithmUsed === 'exact' && Boolean(best),
      expandedStateCount,
      prunedStateCount,
      maximumExpandedStatesReached,
      fallbackUsed: false,
      costTuple: cost,
      stableSignature: cost?.stableSignature ?? '',
    }),
  };
}
