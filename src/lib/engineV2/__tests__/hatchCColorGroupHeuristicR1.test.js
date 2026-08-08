import { describe, expect, it } from 'vitest';
import { compileCanonicalCommandStream } from '../commandCompilation/canonicalCommandCompiler.js';
import {
  COLOR_GROUP_HEURISTIC_RULE_ID,
  evaluateColorGroupHeuristicGuard,
  validateColorGroupHeuristicPlanState,
} from '../rules/hatchEvidence/colorGroupHeuristic.js';
import { CONTOUR_LAST_RULE_ID } from '../rules/hatchEvidence/contourLast.js';
import { buildGlobalSequencePlan } from '../sequencing/globalSequencePlanner.js';
import { validateGlobalSequencePlan } from '../sequencing/sequencePlanningValidation.js';
import { buildMachineIndependentPhysicalStitchPlan } from '../stitchGeneration/physicalStitchPipeline.js';
import {
  createColorGroupComplexFixture,
  createColorGroupForcedRevisitFixture,
  createColorGroupReadyThreadFixture,
} from './fixtures/hatchCColorGroupFixtures.js';

const clone = value => JSON.parse(JSON.stringify(value));
const codes = result => result.errors.map(error => error.code);

function c2Config({ algorithm = 'beam', enabled = true } = {}) {
  return {
    algorithm,
    hatchOverlapProfile: 'hatch-c-experimental',
    hatchOverlapRuleFlags: {
      [CONTOUR_LAST_RULE_ID]: false,
      [COLOR_GROUP_HEURISTIC_RULE_ID]: enabled,
    },
  };
}

function build(fixture, config = c2Config()) {
  return buildGlobalSequencePlan({
    regions: fixture.regions,
    threadedObjectMaterialization: fixture.threadedObjectMaterialization,
    technicalPlan: fixture.technicalPlan,
    config,
  });
}

function validate(plan, fixture) {
  return validateGlobalSequencePlan(
    plan,
    fixture.threadedObjectMaterialization,
    fixture.technicalPlan,
  );
}

function validateC2(plan, fixture) {
  return validateColorGroupHeuristicPlanState({
    plan,
    objects: fixture.threadedObjectMaterialization.objects,
    config: plan.config,
  });
}

function downstream(fixture, sequencePlan) {
  const physicalPlan = buildMachineIndependentPhysicalStitchPlan({
    regions: fixture.regions,
    threadedObjectMaterialization: fixture.threadedObjectMaterialization,
    technicalPlan: fixture.technicalPlan,
    sequencePlan,
  });
  const canonicalCompilation = compileCanonicalCommandStream({
    regions: fixture.regions,
    threadedObjectMaterialization: fixture.threadedObjectMaterialization,
    technicalPlan: fixture.technicalPlan,
    sequencePlan,
    physicalPlan,
  });
  return { physicalPlan, canonicalCompilation };
}

function expectFlatErrors(errors) {
  errors.forEach(error => {
    expect(error).not.toHaveProperty('errors');
    expect(error.evidence).not.toEqual(expect.objectContaining({ errors: expect.anything() }));
  });
}

function expectRejected(plan, fixture, expectedCodes) {
  const expectedRoots = expectedCodes.map(expected => (
    typeof expected === 'string' ? { code: expected } : expected
  ));
  const first = validate(plan, fixture);
  const second = validate(plan, fixture);
  const c2 = validateC2(plan, fixture);
  expect(first.valid).toBe(false);
  expect(second.errors).toEqual(first.errors);
  expect(c2.valid).toBe(false);
  expectedRoots.forEach(({ code, path }) => {
    expect(first.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code, ...(path ? { path } : {}) }),
    ]));
    expect(c2.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code, ...(path ? { path } : {}) }),
    ]));
  });
  expectFlatErrors(first.errors);

  const { physicalPlan, canonicalCompilation } = downstream(fixture, plan);
  expect(physicalPlan.valid).toBe(false);
  expect(physicalPlan.dispositions).toHaveLength(0);
  expect(physicalPlan.objectPaths).toHaveLength(0);
  expect(physicalPlan.summary.physicalPointCount).toBe(0);
  expect(physicalPlan.summary.physicalStitchCount).toBe(0);
  expect(canonicalCompilation.valid).toBe(false);
  expect(canonicalCompilation.commands).toHaveLength(0);
  expect(canonicalCompilation.summary.commandCount).toBe(0);
  expectedRoots.forEach(({ code, path }) => {
    const isRoot = error => error.code === code && (!path || error.path === path);
    expect(physicalPlan.errors.filter(isRoot)).toHaveLength(1);
    expect(canonicalCompilation.errors.filter(isRoot)).toHaveLength(1);
  });
  expectFlatErrors(physicalPlan.errors);
  expectFlatErrors(canonicalCompilation.errors);
}

function revisitIndexes(plan) {
  return {
    block: plan.threadBlocks.findIndex(block => block.repeatedThreadReason !== null),
    step: plan.executionSteps.findIndex(
      step => step.source.repeatedThreadReason !== null,
    ),
    firstBlock: plan.threadBlocks.findIndex(block => block.repeatedThreadReason === null),
    firstStep: plan.executionSteps.findIndex(
      step => step.source.repeatedThreadReason === null,
    ),
  };
}

function fingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeThreadId(threadId) {
  return String(threadId ?? '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'thread';
}

function forgedThreadBlocks(executionSteps, { trustReceivedThreadBlockIds = false } = {}) {
  const blocks = [];
  [...executionSteps]
    .sort((left, right) => left.sequenceIndex - right.sequenceIndex)
    .forEach(step => {
      const current = blocks.at(-1);
      if (current?.threadId === step.threadId) {
        current.objectIds.push(step.objectId);
        current.endSequenceIndex = step.sequenceIndex;
      } else {
        const ordinal = blocks.length;
        blocks.push({
          id: trustReceivedThreadBlockIds
            ? step.threadBlockId
            : `thread-block:${String(ordinal).padStart(4, '0')}:${sanitizeThreadId(step.threadId)}`,
          ordinal,
          threadId: step.threadId,
          startSequenceIndex: step.sequenceIndex,
          endSequenceIndex: step.sequenceIndex,
          objectIds: [step.objectId],
          repeatedThreadReason: step.source.repeatedThreadReason,
        });
      }
    });
  return blocks;
}

function forgeInternallyCoherentC2State(
  plan,
  fixture,
  { trustReceivedThreadBlockIds = false } = {},
) {
  const forged = evaluateColorGroupHeuristicGuard({
    objects: fixture.threadedObjectMaterialization.objects,
    scheduledObjectIds: plan.dispositions
      .filter(disposition => disposition.status === 'scheduled')
      .map(disposition => disposition.objectId),
    executionSteps: plan.executionSteps,
    searchMetadata: plan.searchMetadata,
    config: plan.config,
  });
  const decisions = clone(forged.decisions);
  const body = clone(plan.colorGroupHeuristicContract);
  delete body.fingerprint;
  body.executionSteps = plan.executionSteps.map(step => ({
    id: step.id,
    sequenceIndex: step.sequenceIndex,
    objectId: step.objectId,
    threadId: step.threadId,
    threadBlockId: step.threadBlockId,
  }));
  body.threadBlocks = forgedThreadBlocks(plan.executionSteps, {
    trustReceivedThreadBlockIds,
  });
  body.executionOrder = plan.executionSteps.map(step => step.objectId);
  body.decisions = decisions;
  body.threadChanges = decisions.filter(decision => decision.threadChanged).map(decision => ({
    stepIndex: decision.stepIndex,
    fromThreadId: decision.currentThreadId,
    toThreadId: decision.selectedThreadId,
    reasonCode: decision.reasonCode,
  }));
  body.threadRevisits = decisions.filter(decision => decision.revisited).map(decision => ({
    stepIndex: decision.stepIndex,
    threadId: decision.selectedThreadId,
    justified: decision.revisitJustified,
    reasonCode: decision.reasonCode,
  }));
  plan.colorGroupHeuristicContract = {
    ...body,
    fingerprint: fingerprint(body),
  };
  const contractFingerprint = plan.colorGroupHeuristicContract.fingerprint;
  plan.colorGroupHeuristicIntegrationMarker = {
    ...plan.colorGroupHeuristicIntegrationMarker,
    active: true,
    contractFingerprint,
  };
  plan.colorGroupHeuristicEvaluation = {
    ...plan.colorGroupHeuristicEvaluation,
    active: true,
    evaluatorInvoked: true,
    applied: true,
    status: 'validated',
    decisions,
    decisionCount: decisions.length,
    accreditedDecisionCount: decisions.length,
    blockedReasonCodes: [],
    contractFingerprint,
  };
  plan.colorGroupHeuristicTrace = {
    ...plan.colorGroupHeuristicTrace,
    active: true,
    evaluatorInvoked: true,
    applied: true,
    status: 'validated',
    decisions,
    decisionCount: decisions.length,
    accreditedDecisionCount: decisions.length,
    blockedReasonCodes: [],
    contractFingerprint,
    transaction: {
      valid: true,
      physicalOutputAllowed: true,
      canonicalOutputAllowed: true,
      partialOutputAllowed: false,
    },
  };
  plan.metadata.colorGroupHeuristicEvaluatorInvoked = true;
  expect(plan.colorGroupHeuristicContract.fingerprint).toBe(fingerprint(body));
  expect(plan.colorGroupHeuristicIntegrationMarker.contractFingerprint)
    .toBe(contractFingerprint);
  expect(plan.colorGroupHeuristicEvaluation.contractFingerprint).toBe(contractFingerprint);
  expect(plan.colorGroupHeuristicTrace.contractFingerprint).toBe(contractFingerprint);
}

const REASON_CASES = [
  {
    label: 'falsified revisited thread block with explicit override',
    mutate(plan, indexes) {
      plan.threadBlocks[indexes.block].repeatedThreadReason = 'explicit_sequence_override';
    },
    expectedCodes: ['COLOR_GROUP_THREAD_BLOCK_REVISIT_REASON_MISMATCH'],
  },
  {
    label: 'falsified revisit execution step with bounded-search reason',
    mutate(plan, indexes) {
      plan.executionSteps[indexes.step].source.repeatedThreadReason = 'bounded_search_revisit';
    },
    expectedCodes: ['COLOR_GROUP_EXECUTION_STEP_REVISIT_REASON_MISMATCH'],
  },
  {
    label: 'both revisited representations falsified',
    mutate(plan, indexes) {
      plan.threadBlocks[indexes.block].repeatedThreadReason = 'explicit_sequence_override';
      plan.executionSteps[indexes.step].source.repeatedThreadReason = 'bounded_search_revisit';
    },
    expectedCodes: [
      'COLOR_GROUP_THREAD_BLOCK_REVISIT_REASON_MISMATCH',
      'COLOR_GROUP_EXECUTION_STEP_REVISIT_REASON_MISMATCH',
    ],
  },
  {
    label: 'missing revisited thread-block reason property',
    mutate(plan, indexes) {
      delete plan.threadBlocks[indexes.block].repeatedThreadReason;
    },
    expectedCodes: ['COLOR_GROUP_THREAD_BLOCK_REVISIT_REASON_MISMATCH'],
  },
  {
    label: 'missing revisit execution-step reason property',
    mutate(plan, indexes) {
      delete plan.executionSteps[indexes.step].source.repeatedThreadReason;
    },
    expectedCodes: ['COLOR_GROUP_EXECUTION_STEP_REVISIT_REASON_MISMATCH'],
  },
  {
    label: 'reason injected into a non-revisited thread block',
    mutate(plan, indexes) {
      plan.threadBlocks[indexes.firstBlock].repeatedThreadReason = 'dependency_gated_revisit';
    },
    expectedCodes: ['COLOR_GROUP_THREAD_BLOCK_REVISIT_REASON_MISMATCH'],
  },
  {
    label: 'reason injected into a non-revisited execution step',
    mutate(plan, indexes) {
      plan.executionSteps[indexes.firstStep].source.repeatedThreadReason =
        'dependency_gated_revisit';
    },
    expectedCodes: ['COLOR_GROUP_EXECUTION_STEP_REVISIT_REASON_MISMATCH'],
  },
  {
    label: 'correct block paired with an explicit-override execution step',
    mutate(plan, indexes) {
      plan.executionSteps[indexes.step].source.repeatedThreadReason =
        'explicit_sequence_override';
    },
    expectedCodes: ['COLOR_GROUP_EXECUTION_STEP_REVISIT_REASON_MISMATCH'],
  },
  {
    label: 'correct step paired with a bounded-search thread block',
    mutate(plan, indexes) {
      plan.threadBlocks[indexes.block].repeatedThreadReason = 'bounded_search_revisit';
    },
    expectedCodes: ['COLOR_GROUP_THREAD_BLOCK_REVISIT_REASON_MISMATCH'],
  },
];

describe('Hatch C2-R1 canonical revisit-reason validation', () => {
  it.each(REASON_CASES)('rejects $label', ({ mutate, expectedCodes }) => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = clone(build(fixture));
    const indexes = revisitIndexes(plan);
    expect(indexes.block).toBeGreaterThan(0);
    expect(indexes.step).toBeGreaterThan(0);
    mutate(plan, indexes);
    expectRejected(plan, fixture, expectedCodes);
  });

  it.each(['exact', 'beam'])(
    'accepts the canonical dependency-gated revisit with %s search',
    algorithm => {
      const fixture = createColorGroupForcedRevisitFixture();
      const plan = build(fixture, c2Config({ algorithm }));
      const indexes = revisitIndexes(plan);
      expect(plan.threadBlocks[indexes.block].repeatedThreadReason)
        .toBe('dependency_gated_revisit');
      expect(plan.executionSteps[indexes.step].source.repeatedThreadReason)
        .toBe('dependency_gated_revisit');
      expect(validate(plan, fixture).valid).toBe(true);
      expect(validateC2(plan, fixture).valid).toBe(true);
    },
  );

  it('accepts a C2 plan with no revisit and own null reasons everywhere', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const plan = build(fixture);
    expect(plan.threadBlocks.every(
      block => Object.hasOwn(block, 'repeatedThreadReason')
        && block.repeatedThreadReason === null,
    )).toBe(true);
    expect(plan.executionSteps.every(
      step => Object.hasOwn(step.source, 'repeatedThreadReason')
        && step.source.repeatedThreadReason === null,
    )).toBe(true);
    expect(validate(plan, fixture).valid).toBe(true);
    expect(validateC2(plan, fixture).valid).toBe(true);
  });

  it('keeps general legacy repeated-thread reasons valid while C2 is OFF', () => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = clone(build(fixture, {
      algorithm: 'beam',
      hatchOverlapProfile: 'legacy',
      hatchOverlapRuleFlags: {
        [CONTOUR_LAST_RULE_ID]: false,
        [COLOR_GROUP_HEURISTIC_RULE_ID]: false,
      },
    }));
    const indexes = revisitIndexes(plan);
    plan.threadBlocks[indexes.block].repeatedThreadReason = 'explicit_sequence_override';
    plan.executionSteps[indexes.step].source.repeatedThreadReason =
      'bounded_search_revisit';
    expect(validate(plan, fixture).valid).toBe(true);
    expect(validateC2(plan, fixture).valid).toBe(true);
  });
});

describe('Hatch C2-R1 adversarial execution structure', () => {
  it('rejects a duplicated execution step', () => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = clone(build(fixture));
    plan.executionSteps.push(clone(plan.executionSteps.at(-1)));
    expectRejected(plan, fixture, [{
      code: 'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
      path: 'executionSteps',
    }]);
  });

  it('rejects a removed execution step', () => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = clone(build(fixture));
    plan.executionSteps.pop();
    expectRejected(plan, fixture, [{
      code: 'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
      path: 'executionSteps',
    }]);
  });

  it('rejects an injected unknown object step', () => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = clone(build(fixture));
    const injected = clone(plan.executionSteps.at(-1));
    injected.id = 'execution:c2-r1:unknown';
    injected.objectId = 'object:c2-r1:unknown';
    injected.sequenceIndex = plan.executionSteps.length;
    plan.executionSteps.push(injected);
    expectRejected(plan, fixture, ['COLOR_GROUP_NON_READY_OBJECT_SELECTED']);
  });

  it('rejects a duplicate step ID with distinct controlled content', () => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = clone(build(fixture));
    plan.executionSteps[1].id = plan.executionSteps[0].id;
    expectRejected(plan, fixture, [{
      code: 'COLOR_GROUP_INTEGRATION_STATE_MISMATCH',
      path: 'executionSteps',
    }]);
  });
});

describe('Hatch C2-R1 integrity and activation state', () => {
  it('rejects a contract fingerprint changed in isolation', () => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = clone(build(fixture));
    plan.colorGroupHeuristicContract.fingerprint = '00000000';
    expectRejected(plan, fixture, ['COLOR_GROUP_CONTRACT_STALE']);
  });

  it('rejects jointly removed C2 accreditation while the rule remains ON', () => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = clone(build(fixture));
    delete plan.colorGroupHeuristicContract;
    delete plan.colorGroupHeuristicIntegrationMarker;
    delete plan.colorGroupHeuristicEvaluation;
    delete plan.colorGroupHeuristicTrace;
    delete plan.metadata.colorGroupHeuristicEvaluatorInvoked;
    expectRejected(plan, fixture, [
      'COLOR_GROUP_CONTRACT_MISSING',
      'COLOR_GROUP_TRACE_MISSING',
    ]);
  });

  it.each([
    ['contract', 'colorGroupHeuristicContract', 'COLOR_GROUP_CONTRACT_MISSING'],
    ['marker', 'colorGroupHeuristicIntegrationMarker', 'COLOR_GROUP_INTEGRATION_STATE_MISMATCH'],
    ['evaluation', 'colorGroupHeuristicEvaluation', 'COLOR_GROUP_INTEGRATION_STATE_MISMATCH'],
    ['trace', 'colorGroupHeuristicTrace', 'COLOR_GROUP_TRACE_MISSING'],
  ])('rejects an individually removed %s', (_label, field, expectedCode) => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = clone(build(fixture));
    delete plan[field];
    expectRejected(plan, fixture, [expectedCode]);
  });

  it('rejects retained C2 state after silent rule deactivation', () => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = clone(build(fixture));
    plan.config.extras.hatchOverlapRuleFlags[COLOR_GROUP_HEURISTIC_RULE_ID] = false;
    expectRejected(plan, fixture, ['COLOR_GROUP_INTEGRATION_STATE_MISMATCH']);
  });
});

describe('Hatch C2-R1 independent self-certification resistance', () => {
  it('rejects forged coherent evidence for a dependency-precedence violation', () => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = clone(build(fixture));
    [plan.executionSteps[0], plan.executionSteps[1]] = [
      plan.executionSteps[1],
      plan.executionSteps[0],
    ];
    forgeInternallyCoherentC2State(plan, fixture);
    expectRejected(plan, fixture, [
      'COLOR_GROUP_DEPENDENCY_PRECEDENCE_VIOLATION',
      'COLOR_GROUP_NON_READY_OBJECT_SELECTED',
    ]);
  });

  it('rejects forged coherent evidence for skipping the ready current thread', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const plan = clone(build(fixture));
    [plan.executionSteps[1], plan.executionSteps[2]] = [
      plan.executionSteps[2],
      plan.executionSteps[1],
    ];
    forgeInternallyCoherentC2State(plan, fixture);
    expectRejected(plan, fixture, ['COLOR_GROUP_READY_THREAD_SKIPPED']);
  });
});

const THREAD_BLOCK_ID_CODE = 'COLOR_GROUP_EXECUTION_STEP_THREAD_BLOCK_ID_MISMATCH';
const THREAD_BLOCK_OBJECTS_CODE = 'COLOR_GROUP_THREAD_BLOCK_OBJECTS_MISMATCH';

const THREAD_BLOCK_IDENTITY_CASES = [
  {
    label: 'forged execution-step threadBlockId',
    mutate(plan) {
      plan.executionSteps[0].threadBlockId = 'thread-block:forged';
      return [{ code: THREAD_BLOCK_ID_CODE, path: 'executionSteps[0].threadBlockId' }];
    },
  },
  {
    label: 'null execution-step threadBlockId',
    mutate(plan) {
      plan.executionSteps[0].threadBlockId = null;
      return [{ code: THREAD_BLOCK_ID_CODE, path: 'executionSteps[0].threadBlockId' }];
    },
  },
  {
    label: 'missing execution-step threadBlockId',
    mutate(plan) {
      delete plan.executionSteps[0].threadBlockId;
      return [{ code: THREAD_BLOCK_ID_CODE, path: 'executionSteps[0].threadBlockId' }];
    },
  },
  {
    label: 'execution step pointing to another real block',
    mutate(plan) {
      plan.executionSteps[0].threadBlockId = plan.threadBlocks[1].id;
      return [{ code: THREAD_BLOCK_ID_CODE, path: 'executionSteps[0].threadBlockId' }];
    },
  },
  {
    label: 'thread-block IDs exchanged between execution steps',
    mutate(plan) {
      [plan.executionSteps[0].threadBlockId, plan.executionSteps[1].threadBlockId] = [
        plan.executionSteps[1].threadBlockId,
        plan.executionSteps[0].threadBlockId,
      ];
      return [{ code: THREAD_BLOCK_ID_CODE, path: 'executionSteps[0].threadBlockId' }];
    },
  },
  {
    label: 'forged stored thread-block ID',
    mutate(plan) {
      plan.threadBlocks[0].id = 'thread-block:forged';
      return [{
        code: 'COLOR_GROUP_THREAD_BLOCK_ID_MISMATCH',
        path: 'threadBlocks[0].id',
      }];
    },
  },
  {
    label: 'altered stored thread-block thread',
    mutate(plan) {
      plan.threadBlocks[0].threadId = 'thread:c2:forged';
      return [{
        code: 'COLOR_GROUP_THREAD_BLOCK_THREAD_MISMATCH',
        path: 'threadBlocks[0].threadId',
      }];
    },
  },
  {
    label: 'incorrect object added to a thread block',
    mutate(plan) {
      plan.threadBlocks[0].objectIds.push(plan.threadBlocks[1].objectIds[0]);
      return [{ code: THREAD_BLOCK_OBJECTS_CODE, path: 'threadBlocks[0].objectIds' }];
    },
  },
  {
    label: 'correct object removed from a thread block',
    mutate(plan) {
      plan.threadBlocks[0].objectIds.pop();
      return [{ code: THREAD_BLOCK_OBJECTS_CODE, path: 'threadBlocks[0].objectIds' }];
    },
  },
  {
    label: 'object duplicated inside a thread block',
    mutate(plan) {
      plan.threadBlocks[0].objectIds.push(plan.threadBlocks[0].objectIds[0]);
      return [{ code: THREAD_BLOCK_OBJECTS_CODE, path: 'threadBlocks[0].objectIds' }];
    },
  },
  {
    label: 'thread-block object order reversed',
    fixture: createColorGroupReadyThreadFixture,
    mutate(plan) {
      const blockIndex = plan.threadBlocks.findIndex(block => block.objectIds.length > 1);
      plan.threadBlocks[blockIndex].objectIds.reverse();
      return [{
        code: THREAD_BLOCK_OBJECTS_CODE,
        path: `threadBlocks[${blockIndex}].objectIds`,
      }];
    },
  },
  {
    label: 'object moved from one block to another',
    mutate(plan) {
      const moved = plan.threadBlocks[0].objectIds.pop();
      plan.threadBlocks[1].objectIds.unshift(moved);
      return [{ code: THREAD_BLOCK_OBJECTS_CODE, path: 'threadBlocks[0].objectIds' }];
    },
  },
  {
    label: 'invented additional thread block',
    mutate(plan) {
      plan.threadBlocks.push({
        ...clone(plan.threadBlocks.at(-1)),
        id: 'thread-block:invented',
      });
      return [{
        code: 'COLOR_GROUP_THREAD_BLOCK_STRUCTURE_MISMATCH',
        path: 'threadBlocks',
      }];
    },
  },
  {
    label: 'removed canonical thread block',
    mutate(plan) {
      plan.threadBlocks.pop();
      return [{
        code: 'COLOR_GROUP_THREAD_BLOCK_STRUCTURE_MISMATCH',
        path: 'threadBlocks',
      }];
    },
  },
  {
    label: 'unknown execution-step ID with valid objectId',
    mutate(plan) {
      plan.executionSteps[0].id = 'execution:c2-r2:unknown';
      return [{
        code: 'COLOR_GROUP_EXECUTION_STEP_ID_MISMATCH',
        path: 'executionSteps[0].id',
      }];
    },
  },
  {
    label: 'unknown objectId with otherwise isolated structure',
    mutate(plan) {
      plan.executionSteps[0].objectId = 'object:c2-r2:unknown';
      return [{
        code: 'COLOR_GROUP_EXECUTION_STEP_OBJECT_MISMATCH',
        path: 'executionSteps[0].objectId',
      }];
    },
  },
  {
    label: 'known object assigned the ID of another execution step',
    mutate(plan) {
      plan.executionSteps[0].id = plan.executionSteps[1].id;
      return [{
        code: 'COLOR_GROUP_EXECUTION_STEP_ID_MISMATCH',
        path: 'executionSteps[0].id',
      }];
    },
  },
  {
    label: 'dependency-gated revisit reason explicitly set to null',
    mutate(plan) {
      const blockIndex = plan.threadBlocks.findIndex(
        block => block.repeatedThreadReason !== null,
      );
      plan.threadBlocks[blockIndex].repeatedThreadReason = null;
      return [{
        code: 'COLOR_GROUP_THREAD_BLOCK_REVISIT_REASON_MISMATCH',
        path: `threadBlocks[${blockIndex}].repeatedThreadReason`,
      }];
    },
  },
];

describe('Hatch C2-R2 canonical thread-block identity and membership', () => {
  it.each(THREAD_BLOCK_IDENTITY_CASES)('rejects $label', ({ fixture, mutate }) => {
    const source = fixture ? fixture() : createColorGroupForcedRevisitFixture();
    const plan = clone(build(source));
    const expectedRoots = mutate(plan);
    expectRejected(plan, source, expectedRoots);
  });

  it('rejects forged threadBlockId after all controllable C2 evidence is recomposed', () => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = clone(build(fixture));
    plan.executionSteps[0].threadBlockId = 'thread-block:forged';
    forgeInternallyCoherentC2State(plan, fixture, {
      trustReceivedThreadBlockIds: true,
    });
    expect(plan.colorGroupHeuristicContract.executionSteps[0].threadBlockId)
      .toBe('thread-block:forged');
    expect(plan.colorGroupHeuristicContract.threadBlocks[0].id)
      .toBe('thread-block:forged');
    expectRejected(plan, fixture, [{
      code: THREAD_BLOCK_ID_CODE,
      path: 'executionSteps[0].threadBlockId',
    }]);
  });
});

describe('Hatch C2-R2 canonical thread-block positives and limits', () => {
  it.each([
    ['single-object blocks and dependency-gated revisit with beam', createColorGroupForcedRevisitFixture, 'beam'],
    ['multi-object contiguous block and non-revisit change with beam', createColorGroupReadyThreadFixture, 'beam'],
    ['three threads with exact search', createColorGroupComplexFixture, 'exact'],
    ['three threads with beam search', createColorGroupComplexFixture, 'beam'],
  ])('accepts %s', (_label, fixtureFactory, algorithm) => {
    const fixture = fixtureFactory();
    const plan = build(fixture, c2Config({ algorithm }));
    expect(validate(plan, fixture).valid).toBe(true);
    expect(validateC2(plan, fixture).valid).toBe(true);
    expect(plan.colorGroupHeuristicContract.executionSteps).toEqual(
      plan.executionSteps.map(step => ({
        id: step.id,
        sequenceIndex: step.sequenceIndex,
        objectId: step.objectId,
        threadId: step.threadId,
        threadBlockId: step.threadBlockId,
      })),
    );
    expect(plan.colorGroupHeuristicContract.threadBlocks.map(block => block.objectIds))
      .toEqual(plan.threadBlocks.map(block => block.objectIds));
  });

  it('accepts a repeatedly reused resolved C2 configuration', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const first = build(fixture);
    const reused = build(fixture, first.config);
    expect(validate(reused, fixture).valid).toBe(true);
    expect(validateC2(reused, fixture).valid).toBe(true);
    expect(reused.colorGroupHeuristicContract).toEqual(first.colorGroupHeuristicContract);
  });

  it.each([
    ['experimental C2 OFF', c2Config({ enabled: false })],
    ['legacy', {
      hatchOverlapProfile: 'legacy',
      hatchOverlapRuleFlags: {
        [CONTOUR_LAST_RULE_ID]: false,
        [COLOR_GROUP_HEURISTIC_RULE_ID]: false,
      },
    }],
  ])('does not impose C2 thread-block identity under %s', (_label, config) => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = clone(build(fixture, config));
    plan.executionSteps[0].threadBlockId = 'thread-block:legacy-general-contract';
    expect(validate(plan, fixture).valid).toBe(true);
    expect(validateC2(plan, fixture).valid).toBe(true);
  });
});
