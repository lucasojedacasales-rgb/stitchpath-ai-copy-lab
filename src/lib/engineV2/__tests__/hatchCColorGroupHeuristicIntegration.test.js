import { describe, expect, it } from 'vitest';
import { compileCanonicalCommandStream } from '../commandCompilation/canonicalCommandCompiler.js';
import { createGlobalSequenceDiagnostic } from '../sequencing/sequencePlanningDiagnostics.js';
import { buildGlobalSequencePlan } from '../sequencing/globalSequencePlanner.js';
import {
  resolveSequencePlanningConfig,
  validateSequencePlanningConfig,
} from '../sequencing/sequencePlanningConfig.js';
import { validateGlobalSequencePlan } from '../sequencing/sequencePlanningValidation.js';
import { buildMachineIndependentPhysicalStitchPlan } from '../stitchGeneration/physicalStitchPipeline.js';
import {
  COLOR_GROUP_HEURISTIC_RULE_ID,
  COLOR_GROUP_HEURISTIC_TRACE_VERSION,
  deriveCanonicalColorGroupHeuristicContract,
} from '../rules/hatchEvidence/colorGroupHeuristic.js';
import { CONTOUR_LAST_RULE_ID } from '../rules/hatchEvidence/contourLast.js';
import { MULTILAYER_DEPENDENCY_RULE_ID } from '../rules/hatchEvidence/multilayerDependency.js';
import {
  DEFAULT_HATCH_OVERLAP_RULE_FLAGS,
  HATCH_OVERLAP_RULE_IDS,
  resolveHatchOverlapIntegrationConfig,
  validateHatchOverlapIntegrationConfig,
} from '../rules/hatchEvidence/overlapProfiles.js';
import {
  HATCH_EVIDENCE_REGISTRY,
  HATCH_EVIDENCE_RULES,
  validateHatchEvidenceRegistry,
} from '../rules/hatchEvidence/registry.js';
import {
  createColorGroupComplexFixture,
  createColorGroupForcedRevisitFixture,
  createColorGroupReadyThreadFixture,
} from './fixtures/hatchCColorGroupFixtures.js';

const clone = value => JSON.parse(JSON.stringify(value));
const codes = result => result.errors.map(error => error.code);

function cConfig({ c1 = false, c2 = false, ...overrides } = {}) {
  return {
    hatchOverlapProfile: 'hatch-c-experimental',
    hatchOverlapRuleFlags: {
      [CONTOUR_LAST_RULE_ID]: c1,
      [COLOR_GROUP_HEURISTIC_RULE_ID]: c2,
    },
    ...overrides,
  };
}

function build(fixture, config = {}) {
  return buildGlobalSequencePlan({
    regions: fixture.regions,
    threadedObjectMaterialization: fixture.threadedObjectMaterialization,
    technicalPlan: fixture.technicalPlan,
    config,
  });
}

function validate(plan, fixture, materialization = fixture.threadedObjectMaterialization) {
  return validateGlobalSequencePlan(plan, materialization, fixture.technicalPlan);
}

function executeDownstream(fixture, sequencePlan) {
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

describe('Hatch C2 independent configuration and registry', () => {
  it('registers exactly the independent C1, C2 and C3 flags, all OFF by default', () => {
    expect(HATCH_OVERLAP_RULE_IDS).toEqual([
      CONTOUR_LAST_RULE_ID,
      COLOR_GROUP_HEURISTIC_RULE_ID,
      MULTILAYER_DEPENDENCY_RULE_ID,
    ]);
    expect(DEFAULT_HATCH_OVERLAP_RULE_FLAGS).toEqual({
      [CONTOUR_LAST_RULE_ID]: false,
      [COLOR_GROUP_HEURISTIC_RULE_ID]: false,
      [MULTILAYER_DEPENDENCY_RULE_ID]: false,
    });
  });

  it.each([
    [false, false, []],
    [true, false, [CONTOUR_LAST_RULE_ID]],
    [false, true, [COLOR_GROUP_HEURISTIC_RULE_ID]],
    [true, true, [CONTOUR_LAST_RULE_ID, COLOR_GROUP_HEURISTIC_RULE_ID]],
  ])('resolves C1=%s C2=%s independently', (c1, c2, enabledRuleIds) => {
    expect(resolveHatchOverlapIntegrationConfig(cConfig({ c1, c2 })).enabledRuleIds)
      .toEqual(enabledRuleIds);
  });

  it('rejects C2 activation under legacy', () => {
    expect(codes(validateHatchOverlapIntegrationConfig({
      hatchOverlapProfile: 'legacy',
      hatchOverlapRuleFlags: { [COLOR_GROUP_HEURISTIC_RULE_ID]: true },
    }))).toContain('HATCH_OVERLAP_RULE_FLAG_REQUIRES_EXPERIMENTAL_PROFILE');
  });

  it('rejects non-boolean C2 flags and unknown Hatch overlap fields', () => {
    expect(codes(validateHatchOverlapIntegrationConfig(cConfig({ c2: 'yes' }))))
      .toContain('INVALID_HATCH_OVERLAP_RULE_FLAG_VALUE');
    expect(codes(validateHatchOverlapIntegrationConfig({
      ...cConfig({ c2: true }),
      hatchOverlapFuture: true,
    }))).toContain('UNKNOWN_HATCH_OVERLAP_CONFIG_FIELD');
  });

  it('resolves raw and repeatedly reused sequence configuration idempotently', () => {
    const raw = {
      extras: {
        hatchOverlapProfile: 'legacy',
        hatchOverlapRuleFlags: { [COLOR_GROUP_HEURISTIC_RULE_ID]: false },
        nestedOnly: 1,
      },
      hatchOverlapProfile: 'hatch-c-experimental',
      hatchOverlapRuleFlags: { [COLOR_GROUP_HEURISTIC_RULE_ID]: true },
      topLevelOnly: 2,
    };
    const first = resolveSequencePlanningConfig(raw);
    const second = resolveSequencePlanningConfig(first);
    const third = resolveSequencePlanningConfig(second);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first.extras).toMatchObject({
      hatchOverlapProfile: 'hatch-c-experimental',
      hatchOverlapRuleFlags: { [COLOR_GROUP_HEURISTIC_RULE_ID]: true },
      nestedOnly: 1,
      topLevelOnly: 2,
    });
    expect(first.extras).not.toHaveProperty('extras');
    expect(validateSequencePlanningConfig(first).valid).toBe(true);
  });

  it('keeps explicit contradictory configuration invalid after resolution', () => {
    const contradictory = {
      extras: cConfig({ c2: false }),
      hatchOverlapProfile: 'legacy',
      hatchOverlapRuleFlags: { [COLOR_GROUP_HEURISTIC_RULE_ID]: true },
    };
    expect(resolveSequencePlanningConfig(contradictory).extras.hatchOverlapProfile).toBe('legacy');
    expect(codes(validateSequencePlanningConfig(contradictory)))
      .toContain('HATCH_OVERLAP_RULE_FLAG_REQUIRES_EXPERIMENTAL_PROFILE');
  });

  it('activates only C1, C2 and C3 in C while the other five C rules and D-F remain inactive', () => {
    const cRules = HATCH_EVIDENCE_RULES.filter(rule => rule.phase === 'C_Solapes');
    HATCH_OVERLAP_RULE_IDS.forEach(ruleId => expect(
      cRules.find(rule => rule.id === ruleId).activatedInProfiles,
    ).toEqual(['hatch-c-experimental']));
    expect(cRules.filter(rule => !HATCH_OVERLAP_RULE_IDS.includes(rule.id))
      .every(rule => rule.activatedInProfiles.length === 0)).toBe(true);
    expect(HATCH_EVIDENCE_RULES.filter(
      rule => ['D_Técnicas', 'E_Telas', 'F_Escalado'].includes(rule.phase),
    ).every(rule => rule.activatedInProfiles.length === 0)).toBe(true);
    expect(HATCH_EVIDENCE_REGISTRY.partialIntegrations[0].ruleIds)
      .toEqual(HATCH_OVERLAP_RULE_IDS);
    expect(validateHatchEvidenceRegistry().valid).toBe(true);
  });
});

describe('Hatch C2 canonical color-group accreditation', () => {
  it('leaves no C2 marker, contract, evaluation, trace, or metadata when OFF', () => {
    const plan = build(createColorGroupReadyThreadFixture(), cConfig());
    expect(plan.valid).toBe(true);
    expect(plan).not.toHaveProperty('colorGroupHeuristicContract');
    expect(plan).not.toHaveProperty('colorGroupHeuristicEvaluation');
    expect(plan).not.toHaveProperty('colorGroupHeuristicIntegrationMarker');
    expect(plan).not.toHaveProperty('colorGroupHeuristicTrace');
    expect(plan.metadata).not.toHaveProperty('colorGroupHeuristicEvaluatorInvoked');
  });

  it('adds only valid experimental accreditation when C2 is ON', () => {
    const plan = build(createColorGroupReadyThreadFixture(), cConfig({ c2: true }));
    expect(plan.valid).toBe(true);
    expect(plan.colorGroupHeuristicIntegrationMarker).toMatchObject({
      ruleId: COLOR_GROUP_HEURISTIC_RULE_ID,
      profile: 'hatch-c-experimental',
      active: true,
      contractFingerprint: plan.colorGroupHeuristicContract.fingerprint,
    });
    expect(plan.colorGroupHeuristicTrace).toMatchObject({
      version: COLOR_GROUP_HEURISTIC_TRACE_VERSION,
      active: true,
      evaluatorInvoked: true,
      applied: true,
      status: 'validated',
      contractFingerprint: plan.colorGroupHeuristicContract.fingerprint,
    });
    expect(plan.colorGroupHeuristicEvaluation).toMatchObject({
      active: true,
      evaluatorInvoked: true,
      applied: true,
      status: 'validated',
      contractFingerprint: plan.colorGroupHeuristicContract.fingerprint,
    });
    expect(plan.metadata.colorGroupHeuristicEvaluatorInvoked).toBe(true);
    expect(validate(plan, createColorGroupReadyThreadFixture()).valid).toBe(true);
  });

  it('stores deterministic objects, dependencies, execution, ready sets, changes, and fingerprint', () => {
    const fixture = createColorGroupComplexFixture();
    const plan = build(fixture, cConfig({ c2: true }));
    const contract = plan.colorGroupHeuristicContract;
    expect(contract.objects).toHaveLength(fixture.objects.length);
    expect(contract.executionOrder).toEqual(plan.executionSteps.map(step => step.objectId));
    expect(contract.decisions).toHaveLength(plan.executionSteps.length);
    expect(contract.threadChanges).toEqual(
      contract.decisions.filter(decision => decision.threadChanged).map(decision => ({
        stepIndex: decision.stepIndex,
        fromThreadId: decision.currentThreadId,
        toThreadId: decision.selectedThreadId,
        reasonCode: decision.reasonCode,
      })),
    );
    expect(contract.fingerprint).toMatch(/^[a-f0-9]{8}$/);
  });

  it('selects only dependency-ready objects and never skips a ready current-thread object', () => {
    const plan = build(createColorGroupComplexFixture(), cConfig({ c2: true }));
    plan.colorGroupHeuristicContract.decisions.forEach(decision => {
      expect(decision.selectedWasDependencyReady).toBe(true);
      if (decision.currentThreadReadyAvailable) {
        expect(decision.selectedThreadId).toBe(decision.currentThreadId);
        expect(decision.currentThreadReadyObjectIds).toContain(decision.selectedObjectId);
      }
    });
  });

  it('has no thread-continuity obligation on the first step', () => {
    const plan = build(createColorGroupReadyThreadFixture(), cConfig({ c2: true }));
    expect(plan.colorGroupHeuristicContract.decisions[0]).toMatchObject({
      currentThreadId: null,
      currentThreadReadyObjectIds: [],
      currentThreadReadyAvailable: false,
      reasonCode: 'initial_scheduler_selection',
      accredited: true,
    });
  });

  it('keeps the current thread when the current and another thread are both ready', () => {
    const plan = build(createColorGroupReadyThreadFixture(), cConfig({ c2: true }));
    const [first, second] = plan.colorGroupHeuristicContract.decisions;
    expect(second.currentThreadId).toBe(first.selectedThreadId);
    expect(second.currentThreadReadyAvailable).toBe(true);
    expect(second.selectedThreadId).toBe(first.selectedThreadId);
    expect(second.reasonCode).toBe('ready_current_thread_preserved');
  });

  it('changes thread only when the DAG blocks the current thread and accredits the later revisit', () => {
    const plan = build(createColorGroupForcedRevisitFixture(), cConfig({ c2: true }));
    expect(plan.executionSteps.map(step => step.objectId)).toEqual([
      'object:revisit-green-base-c2',
      'object:revisit-red-middle-c2',
      'object:revisit-green-top-c2',
    ]);
    const [, departure, revisit] = plan.colorGroupHeuristicContract.decisions;
    expect(departure).toMatchObject({
      currentThreadReadyAvailable: false,
      threadChanged: true,
      reasonCode: 'current_thread_has_no_ready_object',
    });
    expect(departure.departureClosure).toMatchObject({
      dependencyGated: true,
      pendingObjectIds: ['object:revisit-green-top-c2'],
      unsatisfiedDependencyIds: ['object:revisit-red-middle-c2'],
    });
    expect(revisit).toMatchObject({
      revisited: true,
      revisitJustified: true,
      reasonCode: 'dependency_gated_thread_revisit',
    });
  });

  it('handles three threads, a dependency chain, and disconnected components', () => {
    const plan = build(createColorGroupComplexFixture(), cConfig({ c2: true }));
    expect(plan.valid).toBe(true);
    expect(new Set(plan.executionSteps.map(step => step.threadId)).size).toBe(3);
    expect(plan.summary.dependencyViolationCount).toBe(0);
    expect(plan.colorGroupHeuristicContract.objects.some(
      object => object.id === 'object:x1-red-disconnected' && object.dependencyIds.length === 0,
    )).toBe(true);
    expect(plan.colorGroupHeuristicContract.objects.find(
      object => object.id === 'object:m7-green-top',
    ).dependencyIds).toEqual(['object:a2-red-middle']);
  });

  it.each(['exact', 'beam'])('accredits the existing %s scheduler without changing its order', algorithm => {
    const fixture = createColorGroupComplexFixture();
    const off = build(fixture, { ...cConfig(), algorithm, beamWidth: 64 });
    const on = build(fixture, { ...cConfig({ c2: true }), algorithm, beamWidth: 64 });
    expect(on.valid).toBe(true);
    expect(on.searchMetadata.algorithmUsed).toBe(algorithm);
    expect(on.executionSteps).toEqual(off.executionSteps);
    expect(on.threadBlocks).toEqual(off.threadBlocks);
    expect(on.selectedEntryExitPairs).toEqual(off.selectedEntryExitPairs);
  });

  it('is invariant to reversed input and non-topological/random lexical IDs', () => {
    const normal = build(createColorGroupComplexFixture(), cConfig({ c2: true }));
    const reversed = build(
      createColorGroupComplexFixture({ reverseInput: true }),
      cConfig({ c2: true }),
    );
    expect(reversed.executionSteps).toEqual(normal.executionSteps);
    expect(reversed.colorGroupHeuristicContract).toEqual(normal.colorGroupHeuristicContract);
  });

  it('reuses a resolved C2 configuration without nesting extras or changing evidence', () => {
    const fixture = createColorGroupComplexFixture();
    const resolved = resolveSequencePlanningConfig(cConfig({ c2: true }));
    const rawPlan = build(fixture, cConfig({ c2: true }));
    const reusedPlan = build(fixture, resolved);
    expect(reusedPlan.config).toEqual(resolved);
    expect(reusedPlan.config.extras).not.toHaveProperty('extras');
    expect(reusedPlan.executionSteps).toEqual(rawPlan.executionSteps);
    expect(reusedPlan.colorGroupHeuristicContract).toEqual(rawPlan.colorGroupHeuristicContract);
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('preserves independent runtime state for C1=%s C2=%s', (c1, c2) => {
    const plan = build(createColorGroupReadyThreadFixture(), cConfig({ c1, c2 }));
    expect(plan.valid).toBe(true);
    expect(resolveHatchOverlapIntegrationConfig(plan.config).ruleFlags).toEqual({
      [CONTOUR_LAST_RULE_ID]: c1,
      [COLOR_GROUP_HEURISTIC_RULE_ID]: c2,
      [MULTILAYER_DEPENDENCY_RULE_ID]: false,
    });
    expect(Object.hasOwn(plan, 'colorGroupHeuristicTrace')).toBe(c2);
  });

  it('exposes the accredited C2 trace through sequence diagnostics', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const sequencePlan = build(fixture, cConfig({ c2: true }));
    const diagnostic = createGlobalSequenceDiagnostic({
      regions: fixture.regions,
      threadedObjectMaterialization: fixture.threadedObjectMaterialization,
      technicalPlan: fixture.technicalPlan,
      sequencePlan,
    });
    expect(diagnostic).toMatchObject({
      valid: true,
      colorGroupHeuristicActive: true,
      colorGroupHeuristicEvaluatorInvoked: true,
      colorGroupHeuristicApplied: true,
      colorGroupHeuristicStatus: 'validated',
      colorGroupHeuristicContractFingerprint: sequencePlan.colorGroupHeuristicContract.fingerprint,
    });
  });
});

describe('Hatch C2 fail-closed validation', () => {
  it('rejects a dependency executed after its dependent and a non-ready selection', () => {
    const fixture = createColorGroupForcedRevisitFixture();
    const altered = clone(build(fixture, cConfig({ c2: true })));
    [altered.executionSteps[0], altered.executionSteps[1]] = [
      altered.executionSteps[1],
      altered.executionSteps[0],
    ];
    const result = validate(altered, fixture);
    expect(codes(result)).toContain('COLOR_GROUP_NON_READY_OBJECT_SELECTED');
    expect(codes(result)).toContain('COLOR_GROUP_DEPENDENCY_PRECEDENCE_VIOLATION');
    expect(codes(result)).toContain('COLOR_GROUP_CONTRACT_STALE');
  });

  it('rejects leaving a thread that still has a ready object and the resulting unjustified revisit', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const altered = clone(build(fixture, cConfig({ c2: true })));
    [altered.executionSteps[1], altered.executionSteps[2]] = [
      altered.executionSteps[2],
      altered.executionSteps[1],
    ];
    const result = validate(altered, fixture);
    expect(codes(result)).toContain('COLOR_GROUP_READY_THREAD_SKIPPED');
    expect(codes(result)).toContain('COLOR_GROUP_THREAD_REVISIT_NOT_JUSTIFIED');
    expect(codes(result)).toContain('COLOR_GROUP_TRACE_STALE');
  });

  it('rejects changed source dependencies after construction', () => {
    const fixture = createColorGroupForcedRevisitFixture();
    const plan = build(fixture, cConfig({ c2: true }));
    const alteredMaterialization = clone(fixture.threadedObjectMaterialization);
    alteredMaterialization.objects.find(
      object => object.id === 'object:revisit-red-middle-c2',
    ).dependencyIds = ['object:revisit-green-top-c2'];
    const result = validate(plan, fixture, alteredMaterialization);
    expect(codes(result)).toContain('COLOR_GROUP_CONTRACT_STALE');
    expect(codes(result)).toContain('SEQUENCE_OBJECT_MUTATION');
  });

  it('rejects changed source or execution thread IDs after construction', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const plan = build(fixture, cConfig({ c2: true }));
    const alteredMaterialization = clone(fixture.threadedObjectMaterialization);
    alteredMaterialization.objects[0].threadId = 'thread:c2:tampered';
    expect(codes(validate(plan, fixture, alteredMaterialization)))
      .toContain('COLOR_GROUP_CONTRACT_STALE');
    const alteredPlan = clone(plan);
    alteredPlan.executionSteps[0].threadId = 'thread:c2:tampered';
    expect(codes(validate(alteredPlan, fixture)))
      .toContain('COLOR_GROUP_INTEGRATION_STATE_MISMATCH');
  });

  it('rejects changed object IDs after construction', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const plan = build(fixture, cConfig({ c2: true }));
    const alteredMaterialization = clone(fixture.threadedObjectMaterialization);
    alteredMaterialization.objects[0].id = 'object:c2:tampered-id';
    const result = validate(plan, fixture, alteredMaterialization);
    expect(codes(result)).toContain('COLOR_GROUP_INTEGRATION_STATE_MISMATCH');
    expect(codes(result)).toContain('COLOR_GROUP_CONTRACT_STALE');
  });

  it('rejects a missing or manipulated canonical contract', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const plan = build(fixture, cConfig({ c2: true }));
    const missing = clone(plan);
    delete missing.colorGroupHeuristicContract;
    expect(codes(validate(missing, fixture))).toContain('COLOR_GROUP_CONTRACT_MISSING');
    const manipulated = clone(plan);
    manipulated.colorGroupHeuristicContract.executionOrder.reverse();
    expect(codes(validate(manipulated, fixture))).toContain('COLOR_GROUP_CONTRACT_STALE');
  });

  it('rejects a missing or manipulated integration marker', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const plan = build(fixture, cConfig({ c2: true }));
    const missing = clone(plan);
    delete missing.colorGroupHeuristicIntegrationMarker;
    expect(codes(validate(missing, fixture)))
      .toContain('COLOR_GROUP_INTEGRATION_STATE_MISMATCH');
    const manipulated = clone(plan);
    manipulated.colorGroupHeuristicIntegrationMarker.active = false;
    expect(codes(validate(manipulated, fixture)))
      .toContain('COLOR_GROUP_INTEGRATION_STATE_MISMATCH');
  });

  it('rejects a missing or manipulated evaluation', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const plan = build(fixture, cConfig({ c2: true }));
    const missing = clone(plan);
    delete missing.colorGroupHeuristicEvaluation;
    expect(codes(validate(missing, fixture)))
      .toContain('COLOR_GROUP_INTEGRATION_STATE_MISMATCH');
    const manipulated = clone(plan);
    manipulated.colorGroupHeuristicEvaluation.applied = false;
    expect(codes(validate(manipulated, fixture)))
      .toContain('COLOR_GROUP_INTEGRATION_STATE_MISMATCH');
  });

  it('rejects a missing or manipulated trace', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const plan = build(fixture, cConfig({ c2: true }));
    const missing = clone(plan);
    delete missing.colorGroupHeuristicTrace;
    expect(codes(validate(missing, fixture))).toContain('COLOR_GROUP_TRACE_MISSING');
    const manipulated = clone(plan);
    manipulated.colorGroupHeuristicTrace.status = 'disabled';
    expect(codes(validate(manipulated, fixture))).toContain('COLOR_GROUP_TRACE_STALE');
  });

  it('rejects silent deactivation and contradictory configuration', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const altered = clone(build(fixture, cConfig({ c2: true })));
    altered.config.extras.hatchOverlapRuleFlags[COLOR_GROUP_HEURISTIC_RULE_ID] = false;
    expect(codes(validate(altered, fixture)))
      .toContain('COLOR_GROUP_INTEGRATION_STATE_MISMATCH');

    const contradictory = build(fixture, {
      hatchOverlapProfile: 'legacy',
      hatchOverlapRuleFlags: { [COLOR_GROUP_HEURISTIC_RULE_ID]: true },
    });
    expect(contradictory.valid).toBe(false);
    expect(codes(contradictory))
      .toContain('HATCH_OVERLAP_RULE_FLAG_REQUIRES_EXPERIMENTAL_PROFILE');
    expect([
      contradictory.dispositions,
      contradictory.executionSteps,
      contradictory.selectedEntryExitPairs,
      contradictory.transitions,
      contradictory.threadBlocks,
    ].every(items => items.length === 0)).toBe(true);
  });

  it('fails closed when dependency-required revisits are disabled', () => {
    const plan = build(createColorGroupForcedRevisitFixture(), {
      ...cConfig({ c2: true }),
      allowDependencyRequiredThreadRevisit: false,
    });
    expect(plan.valid).toBe(false);
    expect(plan.colorGroupHeuristicTrace).toMatchObject({
      active: true,
      evaluatorInvoked: true,
      applied: false,
      status: 'blocked',
    });
    expect([
      plan.dispositions,
      plan.executionSteps,
      plan.selectedEntryExitPairs,
      plan.transitions,
      plan.threadBlocks,
    ].every(items => items.length === 0)).toBe(true);
  });

  it('rederives authority from current objects and execution rather than the stored contract', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const plan = build(fixture, cConfig({ c2: true }));
    const independentlyDerived = deriveCanonicalColorGroupHeuristicContract({
      objects: fixture.objects,
      scheduledObjectIds: plan.dispositions
        .filter(disposition => disposition.status === 'scheduled')
        .map(disposition => disposition.objectId),
      executionSteps: plan.executionSteps,
      searchMetadata: plan.searchMetadata,
      config: plan.config,
    });
    expect(independentlyDerived.contract).toEqual(plan.colorGroupHeuristicContract);
    const manipulated = clone(plan);
    manipulated.executionSteps.reverse();
    const rederivedAfterChange = deriveCanonicalColorGroupHeuristicContract({
      objects: fixture.objects,
      scheduledObjectIds: manipulated.dispositions
        .filter(disposition => disposition.status === 'scheduled')
        .map(disposition => disposition.objectId),
      executionSteps: manipulated.executionSteps,
      searchMetadata: manipulated.searchMetadata,
      config: manipulated.config,
    });
    expect(rederivedAfterChange.contract).not.toEqual(plan.colorGroupHeuristicContract);
    expect(codes(validate(manipulated, fixture))).toContain('COLOR_GROUP_CONTRACT_STALE');
  });

  it('blocks physical paths, points, and canonical commands after a C2 violation', () => {
    const fixture = createColorGroupReadyThreadFixture();
    const altered = clone(build(fixture, cConfig({ c2: true })));
    [altered.executionSteps[1], altered.executionSteps[2]] = [
      altered.executionSteps[2],
      altered.executionSteps[1],
    ];
    const { physicalPlan, canonicalCompilation } = executeDownstream(fixture, altered);
    expect(physicalPlan.valid).toBe(false);
    expect(physicalPlan.objectPaths).toHaveLength(0);
    expect(physicalPlan.summary.physicalPointCount).toBe(0);
    expect(codes(physicalPlan)).toContain('COLOR_GROUP_READY_THREAD_SKIPPED');
    expect(canonicalCompilation.valid).toBe(false);
    expect(canonicalCompilation.commands).toHaveLength(0);
    expect(codes(canonicalCompilation)).toContain('COLOR_GROUP_READY_THREAD_SKIPPED');
  });
});

describe('Hatch C2 ON/OFF nominal parity and limits', () => {
  it('preserves objects, geometry, technique, order, steps, stitches, and commands', () => {
    const fixture = createColorGroupForcedRevisitFixture();
    const sourceBefore = clone(fixture.threadedObjectMaterialization.objects);
    const off = build(fixture, cConfig());
    const on = build(fixture, cConfig({ c2: true }));
    const offDownstream = executeDownstream(fixture, off);
    const onDownstream = executeDownstream(fixture, on);
    expect(on.executionSteps).toEqual(off.executionSteps);
    expect(on.selectedEntryExitPairs).toEqual(off.selectedEntryExitPairs);
    expect(on.transitions).toEqual(off.transitions);
    expect(on.threadBlocks).toEqual(off.threadBlocks);
    expect(fixture.threadedObjectMaterialization.objects).toEqual(sourceBefore);
    expect(onDownstream.physicalPlan.objectPaths).toEqual(offDownstream.physicalPlan.objectPaths);
    expect(onDownstream.physicalPlan.summary.physicalStitchCount)
      .toBe(offDownstream.physicalPlan.summary.physicalStitchCount);
    expect(onDownstream.canonicalCompilation.commands)
      .toEqual(offDownstream.canonicalCompilation.commands);
  });

  it('records no geometry, color, thread, technique, physical, or canonical mutation claim', () => {
    const plan = build(createColorGroupComplexFixture(), cConfig({ c2: true }));
    expect(plan.colorGroupHeuristicContract).toMatchObject({
      orderModified: false,
      geometryModified: false,
      threadIdsModified: false,
      physicalImprovementClaimed: false,
    });
    expect(plan.colorGroupHeuristicTrace).toMatchObject({
      orderModified: false,
      geometryModified: false,
      threadIdsModified: false,
      physicalImprovementClaimed: false,
    });
    expect(plan.summary).toMatchObject({
      geometryMutationCount: 0,
      holeMutationCount: 0,
      visualColorMutationCount: 0,
      threadIdMutationCount: 0,
      roleMutationCount: 0,
      stitchTypeMutationCount: 0,
      physicalStitchCoordinateCount: 0,
      physicalUnderlayCoordinateCount: 0,
      canonicalCommandCount: 0,
    });
  });
});
