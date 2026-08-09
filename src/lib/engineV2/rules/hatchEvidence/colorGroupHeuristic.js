import { resolveHatchOverlapIntegrationConfig } from './overlapProfiles.js';
import { executionStepId } from '../../sequencing/sequencePlanningModel.js';
import { sanitizeThreadIdForBlock } from '../../sequencing/threadBlockBuilder.js';

export const COLOR_GROUP_HEURISTIC_RULE_ID = 'COLOR-GROUP-HEURISTIC-001';
export const COLOR_GROUP_HEURISTIC_CONTRACT_VERSION = 'engine-v2-hatch-c2-color-group-contract-r1';
export const COLOR_GROUP_HEURISTIC_EVALUATION_VERSION = 'engine-v2-hatch-c2-color-group-evaluation-r1';
export const COLOR_GROUP_HEURISTIC_MARKER_VERSION = 'engine-v2-hatch-c2-color-group-marker-r1';
export const COLOR_GROUP_HEURISTIC_TRACE_VERSION = 'engine-v2-hatch-c2-color-group-trace-r1';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const CANONICAL_REVISIT_REASON = 'dependency_gated_revisit';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function fingerprint(value) {
  let text = '';
  try { text = JSON.stringify(value); } catch { text = ''; }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function issue(code, path, message, evidence = null) {
  return {
    code,
    path,
    message,
    ...(evidence ? { evidence } : {}),
  };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function canonicalIntegration(config) {
  const integration = resolveHatchOverlapIntegrationConfig(config);
  return deepFreeze({
    profile: integration.profile,
    ruleEnabled: integration.ruleFlags[COLOR_GROUP_HEURISTIC_RULE_ID] === true,
    enabledRuleIds: [...integration.enabledRuleIds],
  });
}

function canonicalObjects(objects, scheduledObjectIds, errors) {
  const sourceObjects = Array.isArray(objects) ? objects : [];
  const duplicateSourceIds = sourceObjects
    .map(object => object?.id)
    .filter((id, index, ids) => id && ids.indexOf(id) !== index);
  uniqueSorted(duplicateSourceIds).forEach(id => errors.push(issue(
    'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
    'objects',
    `Duplicate source object ID "${id}" prevents canonical color-group accreditation.`,
  )));
  const byId = new Map(sourceObjects.filter(object => object?.id).map(object => [object.id, object]));
  const scheduledIds = uniqueSorted(Array.isArray(scheduledObjectIds) ? scheduledObjectIds : []);
  scheduledIds.filter(id => !byId.has(id)).forEach(id => errors.push(issue(
    'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
    'dispositions',
    `Scheduled object "${id}" does not exist in the current materialization.`,
  )));
  return scheduledIds.filter(id => byId.has(id)).map(id => {
    const object = byId.get(id);
    return deepFreeze({
      id,
      threadId: object.threadId ?? null,
      dependencyIds: [...(Array.isArray(object.dependencyIds) ? object.dependencyIds : [])].sort(),
    });
  });
}

function canonicalThreadBlockId(ordinal, threadId) {
  return `thread-block:${String(ordinal).padStart(4, '0')}:${sanitizeThreadIdForBlock(threadId)}`;
}

function stepEvidence(step, sourceIndex) {
  return {
    sourceIndex,
    id: step?.id ?? null,
    sequenceIndex: step?.sequenceIndex ?? null,
    objectId: step?.objectId ?? null,
    threadId: step?.threadId ?? null,
    threadBlockId: step?.threadBlockId ?? null,
  };
}

function objectEvidence(object) {
  return object ? {
    id: object.id,
    threadId: object.threadId,
    dependencyIds: [...object.dependencyIds],
  } : null;
}

function deriveCanonicalExecutionProjection({
  executionSteps,
  candidateById,
  decisions,
  errors,
}) {
  const ordered = executionSteps.map((step, sourceIndex) => ({ step, sourceIndex }))
    .sort((left, right) => {
      const leftIndex = Number.isInteger(left.step?.sequenceIndex)
        ? left.step.sequenceIndex
        : Number.MAX_SAFE_INTEGER;
      const rightIndex = Number.isInteger(right.step?.sequenceIndex)
        ? right.step.sequenceIndex
        : Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex || left.sourceIndex - right.sourceIndex;
    });
  const blockDrafts = [];
  ordered.forEach((entry, canonicalIndex) => {
    const object = candidateById.get(entry.step?.objectId);
    const threadId = object?.threadId ?? null;
    const prior = blockDrafts.at(-1);
    if (!prior || prior.threadId !== threadId) {
      blockDrafts.push({
        ordinal: blockDrafts.length,
        threadId,
        entries: [],
      });
    }
    blockDrafts.at(-1).entries.push({
      ...entry,
      canonicalIndex,
      object,
    });
  });
  const threadBlocks = blockDrafts.map(draft => {
    const first = draft.entries[0];
    const last = draft.entries.at(-1);
    return deepFreeze({
      id: canonicalThreadBlockId(draft.ordinal, draft.threadId),
      ordinal: draft.ordinal,
      threadId: draft.threadId,
      startSequenceIndex: first.canonicalIndex,
      endSequenceIndex: last.canonicalIndex,
      objectIds: draft.entries.map(entry => entry.step?.objectId ?? null),
      repeatedThreadReason: canonicalRevisitReason(decisions[first.sourceIndex]),
    });
  });
  const blockByCanonicalIndex = new Map(threadBlocks.flatMap(block => (
    Array.from(
      { length: block.endSequenceIndex - block.startSequenceIndex + 1 },
      (_, offset) => [block.startSequenceIndex + offset, block],
    )
  )));
  const executionRecords = ordered.map((entry, canonicalIndex) => {
    const step = entry.step;
    const object = candidateById.get(step?.objectId);
    const block = blockByCanonicalIndex.get(canonicalIndex);
    const expectedId = object ? executionStepId(canonicalIndex, object.id) : null;
    const received = stepEvidence(step, entry.sourceIndex);
    const canonicalSegment = block ? {
      ...block,
      objectIds: [...block.objectIds],
    } : null;
    if (entry.sourceIndex !== canonicalIndex) {
      errors.push(issue(
        'COLOR_GROUP_EXECUTION_STEP_STRUCTURE_MISMATCH',
        `executionSteps[${entry.sourceIndex}]`,
        'Execution-step array position differs from its canonical sequence-index position.',
        {
          step: received,
          object: objectEvidence(object),
          expectedSourceIndex: canonicalIndex,
          receivedSourceIndex: entry.sourceIndex,
          canonicalSegment,
        },
      ));
    }
    if (step?.sequenceIndex !== canonicalIndex) {
      errors.push(issue(
        'COLOR_GROUP_EXECUTION_STEP_SEQUENCE_INDEX_MISMATCH',
        `executionSteps[${entry.sourceIndex}].sequenceIndex`,
        'Execution-step sequenceIndex differs from the canonical contiguous execution index.',
        {
          step: received,
          object: objectEvidence(object),
          expectedSequenceIndex: canonicalIndex,
          receivedSequenceIndex: step?.sequenceIndex ?? null,
          canonicalSegment,
        },
      ));
    }
    if (!object) {
      errors.push(issue(
        'COLOR_GROUP_EXECUTION_STEP_OBJECT_MISMATCH',
        `executionSteps[${entry.sourceIndex}].objectId`,
        'Execution-step objectId does not resolve to the authoritative scheduled-object set.',
        {
          step: received,
          object: null,
          expectedObjectIds: [...candidateById.keys()].sort(),
          receivedObjectId: step?.objectId ?? null,
          canonicalSegment,
        },
      ));
    } else if (step?.id !== expectedId) {
      errors.push(issue(
        'COLOR_GROUP_EXECUTION_STEP_ID_MISMATCH',
        `executionSteps[${entry.sourceIndex}].id`,
        'Execution-step ID differs from the deterministic ID derived from canonical index and authoritative object.',
        {
          step: received,
          object: objectEvidence(object),
          expectedStepId: expectedId,
          receivedStepId: step?.id ?? null,
          canonicalSegment,
        },
      ));
    }
    if (object && step?.threadId !== object.threadId) {
      errors.push(issue(
        'COLOR_GROUP_EXECUTION_STEP_THREAD_MISMATCH',
        `executionSteps[${entry.sourceIndex}].threadId`,
        'Execution-step thread differs from the authoritative object thread.',
        {
          step: received,
          object: objectEvidence(object),
          expectedThreadId: object.threadId,
          receivedThreadId: step?.threadId ?? null,
          canonicalSegment,
        },
      ));
    }
    const receivedThreadBlockId = Object.hasOwn(step || {}, 'threadBlockId')
      ? step.threadBlockId
      : undefined;
    if (receivedThreadBlockId !== block?.id) {
      errors.push(issue(
        'COLOR_GROUP_EXECUTION_STEP_THREAD_BLOCK_ID_MISMATCH',
        `executionSteps[${entry.sourceIndex}].threadBlockId`,
        'Execution-step threadBlockId differs from the canonical contiguous-thread segment.',
        {
          step: received,
          object: objectEvidence(object),
          expectedBlock: canonicalSegment,
          receivedBlock: {
            id: receivedThreadBlockId ?? null,
            present: Object.hasOwn(step || {}, 'threadBlockId'),
          },
          canonicalSegment,
        },
      ));
    }
    return deepFreeze({
      id: expectedId,
      sequenceIndex: canonicalIndex,
      objectId: object?.id ?? step?.objectId ?? null,
      threadId: object?.threadId ?? null,
      threadBlockId: block?.id ?? null,
    });
  });
  return deepFreeze({
    executionSteps: executionRecords,
    threadBlocks,
  });
}

function closureForThread({ threadId, remainingRecords, scheduledIds, candidateById, stepIndex }) {
  const pending = remainingRecords.filter(record => record.threadId === threadId);
  const pendingObjects = pending.map(record => ({
    objectId: record.id,
    unsatisfiedDependencyIds: record.dependencyIds
      .filter(dependencyId => candidateById.has(dependencyId) && !scheduledIds.has(dependencyId))
      .sort(),
  }));
  return deepFreeze({
    threadId,
    departureStepIndex: stepIndex,
    pendingObjectIds: pendingObjects.map(item => item.objectId).sort(),
    unsatisfiedDependencyIds: uniqueSorted(pendingObjects.flatMap(item => item.unsatisfiedDependencyIds)),
    dependencyGated: pendingObjects.length > 0
      && pendingObjects.every(item => item.unsatisfiedDependencyIds.length > 0),
  });
}

export function deriveCanonicalColorGroupHeuristicContract({
  objects = [],
  scheduledObjectIds = [],
  executionSteps = [],
  searchMetadata = null,
  config = {},
} = {}) {
  const integration = canonicalIntegration(config);
  const errors = [];
  const objectRecords = canonicalObjects(objects, scheduledObjectIds, errors);
  const candidateById = new Map(objectRecords.map(record => [record.id, record]));
  const expectedIds = objectRecords.map(record => record.id);
  const sourceSteps = Array.isArray(executionSteps) ? executionSteps : [];
  const order = sourceSteps.map(step => step?.objectId ?? null);
  const duplicateExecutionStepIds = sourceSteps
    .map(step => step?.id)
    .filter((id, index, ids) => id && ids.indexOf(id) !== index);
  uniqueSorted(duplicateExecutionStepIds).forEach(id => errors.push(issue(
    'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
    'executionSteps',
    `Execution-step ID "${id}" is duplicated with independently controlled content.`,
  )));
  const duplicateExecutionIds = order.filter((id, index) => id && order.indexOf(id) !== index);
  uniqueSorted(duplicateExecutionIds).forEach(id => errors.push(issue(
    'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
    'executionSteps',
    `Object "${id}" appears more than once in the execution order.`,
  )));
  if (!same(uniqueSorted(order.filter(Boolean)), expectedIds)) {
    errors.push(issue(
      'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
      'executionSteps',
      'The execution order must cover exactly the currently scheduled object IDs.',
      { expectedObjectIds: expectedIds, actualObjectIds: uniqueSorted(order.filter(Boolean)) },
    ));
  }

  const scheduledIds = new Set();
  const closedThreads = new Map();
  const decisions = [];
  let currentThreadId = null;
  sourceSteps.forEach((step, stepIndex) => {
    const selected = candidateById.get(step?.objectId);
    const remainingRecords = objectRecords.filter(record => !scheduledIds.has(record.id));
    const readyRecords = remainingRecords.filter(record => record.dependencyIds.every(
      dependencyId => scheduledIds.has(dependencyId) || !candidateById.has(dependencyId),
    ));
    const readyObjectIds = readyRecords.map(record => record.id).sort();
    const currentThreadReadyObjectIds = currentThreadId === null
      ? []
      : readyRecords.filter(record => record.threadId === currentThreadId).map(record => record.id).sort();
    const selectedWasDependencyReady = Boolean(selected) && readyObjectIds.includes(selected.id);
    const unsatisfiedDependencyIds = selected
      ? selected.dependencyIds.filter(
        dependencyId => candidateById.has(dependencyId) && !scheduledIds.has(dependencyId),
      ).sort()
      : [];
    const stepErrors = [];

    if (!selected) {
      stepErrors.push(issue(
        'COLOR_GROUP_NON_READY_OBJECT_SELECTED',
        `executionSteps[${stepIndex}].objectId`,
        'The selected object is not part of the current scheduled-object authority.',
      ));
    } else {
      if (step.threadId !== selected.threadId) {
        stepErrors.push(issue(
          'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
          `executionSteps[${stepIndex}].threadId`,
          'The execution-step thread differs from the authoritative object thread.',
          { objectId: selected.id, expectedThreadId: selected.threadId, actualThreadId: step.threadId },
        ));
      }
      if (!selectedWasDependencyReady) {
        stepErrors.push(issue(
          'COLOR_GROUP_NON_READY_OBJECT_SELECTED',
          `executionSteps[${stepIndex}]`,
          `Object "${selected.id}" was selected before all current dependencies were ready.`,
          { objectId: selected.id, unsatisfiedDependencyIds },
        ));
      }
      if (unsatisfiedDependencyIds.length) {
        stepErrors.push(issue(
          'COLOR_GROUP_DEPENDENCY_PRECEDENCE_VIOLATION',
          `executionSteps[${stepIndex}]`,
          `Object "${selected.id}" executes before a required dependency.`,
          { objectId: selected.id, unsatisfiedDependencyIds },
        ));
      }
      if (currentThreadId !== null
        && selected.threadId !== currentThreadId
        && currentThreadReadyObjectIds.length) {
        stepErrors.push(issue(
          'COLOR_GROUP_READY_THREAD_SKIPPED',
          `executionSteps[${stepIndex}]`,
          `The scheduler left thread "${currentThreadId}" while dependency-ready objects remained.`,
          { currentThreadId, readyObjectIds: currentThreadReadyObjectIds, selectedObjectId: selected.id },
        ));
      }
    }

    const selectedThreadId = selected?.threadId ?? step?.threadId ?? null;
    const threadChanged = currentThreadId !== null && selectedThreadId !== currentThreadId;
    const priorClosure = threadChanged ? closedThreads.get(selectedThreadId) : null;
    const revisited = Boolean(priorClosure);
    const revisitJustified = !revisited || (
      config?.allowDependencyRequiredThreadRevisit === true
      && priorClosure.dependencyGated === true
    );
    if (revisited && !revisitJustified) {
      stepErrors.push(issue(
        'COLOR_GROUP_THREAD_REVISIT_NOT_JUSTIFIED',
        `executionSteps[${stepIndex}]`,
        `Revisit to thread "${selectedThreadId}" is not justified by dependency-gated departure and current configuration.`,
        { threadId: selectedThreadId, priorClosure },
      ));
    }

    let departureClosure = null;
    if (threadChanged) {
      departureClosure = closureForThread({
        threadId: currentThreadId,
        remainingRecords,
        scheduledIds,
        candidateById,
        stepIndex,
      });
      closedThreads.set(currentThreadId, departureClosure);
    }

    let reasonCode = 'initial_scheduler_selection';
    if (currentThreadId !== null && !threadChanged) reasonCode = 'ready_current_thread_preserved';
    else if (threadChanged && revisited) reasonCode = revisitJustified
      ? 'dependency_gated_thread_revisit'
      : 'unjustified_thread_revisit';
    else if (threadChanged) reasonCode = 'current_thread_has_no_ready_object';

    errors.push(...stepErrors);
    decisions.push(deepFreeze({
      stepIndex,
      remainingObjectIds: remainingRecords.map(record => record.id).sort(),
      satisfiedObjectIds: [...scheduledIds].sort(),
      dependencyReadyObjectIds: readyObjectIds,
      currentThreadId,
      currentThreadReadyObjectIds,
      currentThreadReadyAvailable: currentThreadReadyObjectIds.length > 0,
      selectedObjectId: step?.objectId ?? null,
      selectedThreadId,
      selectedWasDependencyReady,
      unsatisfiedDependencyIds,
      threadChanged,
      revisited,
      revisitJustified,
      departureClosure,
      priorClosure: priorClosure ?? null,
      reasonCode,
      accredited: stepErrors.length === 0,
    }));
    if (selected?.id) scheduledIds.add(selected.id);
    currentThreadId = selectedThreadId;
  });

  const canonicalProjection = deriveCanonicalExecutionProjection({
    executionSteps: sourceSteps,
    candidateById,
    decisions,
    errors,
  });
  const body = deepFreeze({
    version: COLOR_GROUP_HEURISTIC_CONTRACT_VERSION,
    phase: 'C_Solapes',
    ruleId: COLOR_GROUP_HEURISTIC_RULE_ID,
    integration,
    sequenceAlgorithm: {
      requested: config?.algorithm ?? null,
      used: searchMetadata?.algorithmUsed ?? null,
    },
    policy: {
      dependenciesBeforeColorGrouping: true,
      preserveReadyCurrentThread: true,
      firstStepRequiresThreadContinuity: false,
      sameThreadTieBreakDelegatedToScheduler: true,
      allowDependencyRequiredThreadRevisit: config?.allowDependencyRequiredThreadRevisit === true,
    },
    objects: objectRecords,
    executionSteps: canonicalProjection.executionSteps,
    threadBlocks: canonicalProjection.threadBlocks,
    executionOrder: canonicalProjection.executionSteps.map(step => step.objectId),
    decisions,
    threadChanges: decisions.filter(decision => decision.threadChanged).map(decision => ({
      stepIndex: decision.stepIndex,
      fromThreadId: decision.currentThreadId,
      toThreadId: decision.selectedThreadId,
      reasonCode: decision.reasonCode,
    })),
    threadRevisits: decisions.filter(decision => decision.revisited).map(decision => ({
      stepIndex: decision.stepIndex,
      threadId: decision.selectedThreadId,
      justified: decision.revisitJustified,
      reasonCode: decision.reasonCode,
    })),
    orderModified: false,
    geometryModified: false,
    threadIdsModified: false,
    physicalImprovementClaimed: false,
  });
  const contract = errors.length
    ? null
    : deepFreeze({ ...body, fingerprint: fingerprint(body) });
  return {
    integration,
    contract,
    canonicalProjection,
    decisions: deepFreeze(decisions),
    errors: deepFreeze(errors),
    warnings: deepFreeze([]),
  };
}

export function createColorGroupHeuristicIntegrationMarker({ integration, contract } = {}) {
  return deepFreeze({
    version: COLOR_GROUP_HEURISTIC_MARKER_VERSION,
    phase: 'C_Solapes',
    ruleId: COLOR_GROUP_HEURISTIC_RULE_ID,
    profile: integration?.profile ?? 'legacy',
    enabledRuleIds: [...(integration?.enabledRuleIds || [])],
    active: integration?.ruleEnabled === true,
    contractFingerprint: contract?.fingerprint ?? null,
  });
}

function traceFor(result) {
  const blockedReasonCodes = uniqueSorted(result.errors.map(error => error.code));
  const applied = result.errors.length === 0;
  return deepFreeze({
    version: COLOR_GROUP_HEURISTIC_TRACE_VERSION,
    phase: 'C_Solapes',
    ruleId: COLOR_GROUP_HEURISTIC_RULE_ID,
    profile: result.integration.profile,
    enabledRuleIds: [...result.integration.enabledRuleIds],
    active: result.integration.ruleEnabled,
    evaluatorInvoked: true,
    applied,
    status: applied ? 'validated' : 'blocked',
    decisionCount: result.decisions.length,
    accreditedDecisionCount: result.decisions.filter(decision => decision.accredited).length,
    decisions: result.decisions,
    blockedReasonCodes,
    contractFingerprint: result.contract?.fingerprint ?? null,
    orderModified: false,
    geometryModified: false,
    threadIdsModified: false,
    physicalImprovementClaimed: false,
    transaction: {
      valid: applied,
      physicalOutputAllowed: applied,
      canonicalOutputAllowed: applied,
      partialOutputAllowed: false,
    },
  });
}

function evaluationFor(result) {
  const applied = result.errors.length === 0;
  return deepFreeze({
    version: COLOR_GROUP_HEURISTIC_EVALUATION_VERSION,
    phase: 'C_Solapes',
    ruleId: COLOR_GROUP_HEURISTIC_RULE_ID,
    profile: result.integration.profile,
    active: result.integration.ruleEnabled,
    evaluatorInvoked: true,
    applied,
    status: applied ? 'validated' : 'blocked',
    decisions: result.decisions,
    decisionCount: result.decisions.length,
    accreditedDecisionCount: result.decisions.filter(decision => decision.accredited).length,
    blockedReasonCodes: uniqueSorted(result.errors.map(error => error.code)),
    contractFingerprint: result.contract?.fingerprint ?? null,
  });
}

function receivedReason(value, owner) {
  const present = Boolean(owner)
    && typeof owner === 'object'
    && Object.hasOwn(owner, 'repeatedThreadReason');
  return {
    present,
    value: present ? value : null,
  };
}

function canonicalRevisitReason(decision) {
  return decision?.threadChanged === true
    && decision?.revisited === true
    && decision?.revisitJustified === true
    ? CANONICAL_REVISIT_REASON
    : null;
}

function validateCanonicalRevisitMetadata(plan, decisions) {
  const errors = [];
  const steps = Array.isArray(plan?.executionSteps) ? plan.executionSteps : [];
  const blocks = Array.isArray(plan?.threadBlocks) ? plan.threadBlocks : [];
  const canonicalBlocks = [];
  decisions.forEach(decision => {
    if (decision.stepIndex === 0 || decision.threadChanged) {
      canonicalBlocks.push({
        blockIndex: canonicalBlocks.length,
        startStepIndex: decision.stepIndex,
        threadId: decision.selectedThreadId,
        startObjectId: decision.selectedObjectId,
        decision,
      });
    }
  });

  canonicalBlocks.forEach(canonicalBlock => {
    const block = blocks[canonicalBlock.blockIndex];
    const expectedReason = canonicalRevisitReason(canonicalBlock.decision);
    const received = receivedReason(block?.repeatedThreadReason, block);
    if (!received.present || received.value !== expectedReason) {
      errors.push(issue(
        'COLOR_GROUP_THREAD_BLOCK_REVISIT_REASON_MISMATCH',
        `threadBlocks[${canonicalBlock.blockIndex}].repeatedThreadReason`,
        'Thread-block revisit reason differs from the C2 conclusion rederived from the current DAG and execution prefix.',
        {
          block: block ? {
            id: block.id ?? null,
            threadId: block.threadId ?? null,
            objectIds: Array.isArray(block.objectIds) ? [...block.objectIds] : [],
          } : null,
          step: {
            index: canonicalBlock.startStepIndex,
            objectId: canonicalBlock.startObjectId,
          },
          expectedReason,
          receivedReason: received.value,
          receivedReasonPresent: received.present,
          canonicalDecision: canonicalBlock.decision,
        },
      ));
    }
  });

  decisions.forEach(decision => {
    const step = steps[decision.stepIndex];
    const expectedReason = canonicalRevisitReason(decision);
    const source = step?.source;
    const received = receivedReason(source?.repeatedThreadReason, source);
    if (!received.present || received.value !== expectedReason) {
      const blockIndex = canonicalBlocks.findLastIndex(
        block => block.startStepIndex <= decision.stepIndex,
      );
      errors.push(issue(
        'COLOR_GROUP_EXECUTION_STEP_REVISIT_REASON_MISMATCH',
        `executionSteps[${decision.stepIndex}].source.repeatedThreadReason`,
        'Execution-step revisit reason differs from the C2 conclusion rederived from the current DAG and execution prefix.',
        {
          block: blockIndex >= 0 && blocks[blockIndex] ? {
            id: blocks[blockIndex].id ?? null,
            index: blockIndex,
            threadId: blocks[blockIndex].threadId ?? null,
          } : null,
          step: step ? {
            id: step.id ?? null,
            index: decision.stepIndex,
            objectId: step.objectId ?? null,
          } : {
            id: null,
            index: decision.stepIndex,
            objectId: decision.selectedObjectId,
          },
          expectedReason,
          receivedReason: received.value,
          receivedReasonPresent: received.present,
          canonicalDecision: decision,
        },
      ));
    }
  });
  return errors;
}

function validateCanonicalThreadBlockState(plan, canonicalProjection) {
  const errors = [];
  const receivedBlocks = Array.isArray(plan?.threadBlocks) ? plan.threadBlocks : [];
  const expectedBlocks = canonicalProjection?.threadBlocks || [];
  if (receivedBlocks.length !== expectedBlocks.length) {
    errors.push(issue(
      'COLOR_GROUP_THREAD_BLOCK_STRUCTURE_MISMATCH',
      'threadBlocks',
      'Received thread-block count differs from the canonical contiguous-thread segmentation.',
      {
        expectedBlockCount: expectedBlocks.length,
        receivedBlockCount: receivedBlocks.length,
        expectedBlocks,
        receivedBlocks,
      },
    ));
    return errors;
  }
  expectedBlocks.forEach((expectedBlock, ordinal) => {
    const receivedBlock = receivedBlocks[ordinal];
    const receivedAtCanonicalId = receivedBlocks.findIndex(
      block => block?.id === expectedBlock.id,
    );
    const canonicalSegment = {
      ...expectedBlock,
      objectIds: [...expectedBlock.objectIds],
    };
    if (receivedBlock?.id !== expectedBlock.id || receivedAtCanonicalId !== ordinal) {
      errors.push(issue(
        'COLOR_GROUP_THREAD_BLOCK_ID_MISMATCH',
        `threadBlocks[${ordinal}].id`,
        'Thread-block ID or ordinal differs from the deterministic canonical segment identity.',
        {
          expectedBlock: canonicalSegment,
          receivedBlock: receivedBlock ?? null,
          expectedOrdinal: ordinal,
          receivedOrdinalForExpectedId: receivedAtCanonicalId,
          canonicalSegment,
        },
      ));
    }
    if (receivedBlock?.threadId !== expectedBlock.threadId) {
      errors.push(issue(
        'COLOR_GROUP_THREAD_BLOCK_THREAD_MISMATCH',
        `threadBlocks[${ordinal}].threadId`,
        'Thread-block thread differs from the authoritative thread of its canonical objects.',
        {
          expectedBlock: canonicalSegment,
          receivedBlock: receivedBlock ?? null,
          expectedThreadId: expectedBlock.threadId,
          receivedThreadId: receivedBlock?.threadId ?? null,
          canonicalSegment,
        },
      ));
    }
    if (!same(receivedBlock?.objectIds, expectedBlock.objectIds)) {
      errors.push(issue(
        'COLOR_GROUP_THREAD_BLOCK_OBJECTS_MISMATCH',
        `threadBlocks[${ordinal}].objectIds`,
        'Thread-block objects differ in membership, uniqueness, or order from the canonical contiguous segment.',
        {
          expectedBlock: canonicalSegment,
          receivedBlock: receivedBlock ?? null,
          expectedObjectIds: [...expectedBlock.objectIds],
          receivedObjectIds: Array.isArray(receivedBlock?.objectIds)
            ? [...receivedBlock.objectIds]
            : null,
          canonicalSegment,
        },
      ));
    }
  });
  return errors;
}

export function evaluateColorGroupHeuristicGuard(input = {}) {
  const derived = deriveCanonicalColorGroupHeuristicContract(input);
  const blockingErrors = Array.isArray(input.blockingErrors) ? input.blockingErrors : [];
  const result = blockingErrors.length
    ? {
      ...derived,
      contract: null,
      errors: deepFreeze([...derived.errors, ...blockingErrors]),
    }
    : derived;
  return {
    ...result,
    marker: createColorGroupHeuristicIntegrationMarker(result),
    evaluation: evaluationFor(result),
    trace: traceFor(result),
  };
}

export function validateColorGroupHeuristicPlanState({
  plan,
  objects = [],
  config = plan?.config || {},
} = {}) {
  const integration = canonicalIntegration(config);
  const errors = [];
  const hasContract = Object.hasOwn(plan || {}, 'colorGroupHeuristicContract');
  const hasEvaluation = Object.hasOwn(plan || {}, 'colorGroupHeuristicEvaluation');
  const hasMarker = Object.hasOwn(plan || {}, 'colorGroupHeuristicIntegrationMarker');
  const hasTrace = Object.hasOwn(plan || {}, 'colorGroupHeuristicTrace');
  const hasMetadataState = Object.hasOwn(
    plan?.metadata || {},
    'colorGroupHeuristicEvaluatorInvoked',
  );
  const hasAnyState = hasContract || hasEvaluation || hasMarker || hasTrace || hasMetadataState;
  if (!integration.ruleEnabled) {
    if (hasAnyState) errors.push(issue(
      'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
      'colorGroupHeuristic',
      'C2 state is forbidden when COLOR-GROUP-HEURISTIC-001 is not enabled.',
    ));
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  if (!hasContract || !plan?.colorGroupHeuristicContract) errors.push(issue(
    'COLOR_GROUP_CONTRACT_MISSING',
    'colorGroupHeuristicContract',
    'Enabled COLOR-GROUP-HEURISTIC-001 requires its canonical contract.',
  ));
  if (!hasMarker || !plan?.colorGroupHeuristicIntegrationMarker) errors.push(issue(
    'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
    'colorGroupHeuristicIntegrationMarker',
    'Enabled COLOR-GROUP-HEURISTIC-001 requires its integration marker.',
  ));
  if (!hasEvaluation || !plan?.colorGroupHeuristicEvaluation) errors.push(issue(
    'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
    'colorGroupHeuristicEvaluation',
    'Enabled COLOR-GROUP-HEURISTIC-001 requires its explicit evaluation.',
  ));
  if (!hasTrace || !plan?.colorGroupHeuristicTrace) errors.push(issue(
    'COLOR_GROUP_TRACE_MISSING',
    'colorGroupHeuristicTrace',
    'Enabled COLOR-GROUP-HEURISTIC-001 requires its evaluation trace.',
  ));
  if (plan?.metadata?.colorGroupHeuristicEvaluatorInvoked !== true) errors.push(issue(
    'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
    'metadata.colorGroupHeuristicEvaluatorInvoked',
    'Enabled COLOR-GROUP-HEURISTIC-001 requires explicit evaluator invocation metadata.',
  ));

  const scheduledObjectIds = (plan?.dispositions || [])
    .filter(disposition => disposition?.status === 'scheduled')
    .map(disposition => disposition.objectId);
  const canonical = evaluateColorGroupHeuristicGuard({
    objects,
    scheduledObjectIds,
    executionSteps: plan?.executionSteps || [],
    searchMetadata: plan?.searchMetadata,
    config,
  });
  errors.push(...canonical.errors);
  errors.push(...validateCanonicalThreadBlockState(plan, canonical.canonicalProjection));
  errors.push(...validateCanonicalRevisitMetadata(plan, canonical.decisions));
  if (hasContract && (!canonical.contract || !same(plan.colorGroupHeuristicContract, canonical.contract))) {
    errors.push(issue(
      'COLOR_GROUP_CONTRACT_STALE',
      'colorGroupHeuristicContract',
      'Stored C2 contract differs from the contract rederived from current objects, dependencies, execution, and configuration.',
    ));
  }
  if (hasMarker && !same(plan.colorGroupHeuristicIntegrationMarker, canonical.marker)) {
    errors.push(issue(
      'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
      'colorGroupHeuristicIntegrationMarker',
      'Stored C2 marker disagrees with the current effective configuration and canonical contract.',
    ));
  }
  if (hasEvaluation && !same(plan.colorGroupHeuristicEvaluation, canonical.evaluation)) {
    errors.push(issue(
      'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
      'colorGroupHeuristicEvaluation',
      'Stored C2 evaluation differs from the evaluation rederived from current scheduling decisions.',
    ));
  }
  if (hasTrace && !same(plan.colorGroupHeuristicTrace, canonical.trace)) {
    errors.push(issue(
      'COLOR_GROUP_TRACE_STALE',
      'colorGroupHeuristicTrace',
      'Stored C2 trace differs from the trace rederived from current scheduling decisions.',
    ));
  }
  const deduplicated = errors.filter((error, index, all) => all.findIndex(
    candidate => candidate.code === error.code && candidate.path === error.path,
  ) === index);
  return {
    valid: deduplicated.length === 0,
    errors: deduplicated,
    warnings: [],
    canonical,
  };
}
