import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileCanonicalCommandStream } from '../commandCompilation/canonicalCommandCompiler.js';
import {
  HATCH_C_REFERENCE_DESIGN_MM,
  createHatchCReferenceRegions,
  createHatchCReferenceSemanticResult,
} from './fixtures/hatchCReferenceFixtures.js';
import { ingestV1RegionsToRegionGraphV2 } from '../ingestion/regionIngestion.js';
import { materializeEmbroideryObjectDrafts } from '../materialization/objectDraftMaterializer.js';
import { resolveProposalReviewDecisions } from '../materialization/proposalReviewResolver.js';
import { deriveCanonicalContourDependencyContract } from '../planning/dependencyPlanner.js';
import { buildEmbroideryObjectProposalPlan } from '../planning/objectPlanningPipeline.js';
import { validateEmbroideryObjectProposalPlan } from '../planning/objectPlanningValidation.js';
import {
  COLOR_GROUP_HEURISTIC_RULE_ID,
} from '../rules/hatchEvidence/colorGroupHeuristic.js';
import { CONTOUR_LAST_RULE_ID } from '../rules/hatchEvidence/contourLast.js';
import { MULTILAYER_DEPENDENCY_RULE_ID } from '../rules/hatchEvidence/multilayerDependency.js';
import { HATCH_EVIDENCE_RULE_IDS } from '../rules/hatchEvidence/profiles.js';
import {
  HATCH_OVERLAP_CONTROLLED_OPT_IN_POLICY,
  canonicalizeHatchOverlapControlledFallbackReasonCodes,
  resolveHatchOverlapControlledOptInPolicy,
  resolveHatchOverlapIntegrationConfig,
  validateHatchOverlapIntegrationConfig,
} from '../rules/hatchEvidence/overlapProfiles.js';
import { buildGlobalSequencePlan } from '../sequencing/globalSequencePlanner.js';
import { createSemanticRegionAssessmentV2 } from '../semantics/semanticRoleModel.js';
import { buildMachineIndependentPhysicalStitchPlan } from '../stitchGeneration/physicalStitchPipeline.js';
import { buildTechnicalEmbroideryPlan } from '../technical/technicalPlanningPipeline.js';
import { materializeThreadedEmbroideryObjects } from '../threads/finalObjectMaterializer.js';

const [
  SATIN_RANGE_RULE_ID,
  LOCAL_WIDTH_RULE_ID,
  HOLE_PRESERVE_RULE_ID,
  HOLE_MIN_SIZE_RULE_ID,
] = HATCH_EVIDENCE_RULE_IDS;
const CROSS_PHASE_SOURCE_INVALID = 'HATCH_OVERLAP_CONTROLLED_OPT_IN_CROSS_PHASE_SOURCE_INVALID';
const ALL_C_RULE_IDS = Object.freeze([
  CONTOUR_LAST_RULE_ID,
  COLOR_GROUP_HEURISTIC_RULE_ID,
  MULTILAYER_DEPENDENCY_RULE_ID,
]);
const EMPTY_POLICY = Object.freeze({
  operationalRuleIds: Object.freeze([]),
  diagnosticRuleIds: Object.freeze([]),
  effectiveRuleIds: Object.freeze([]),
  fallbackToLegacy: false,
  fallbackReasonCodes: Object.freeze([]),
});
const LEGACY_INTEGRATION = Object.freeze({
  profile: 'legacy',
  ruleFlags: Object.freeze(Object.fromEntries(ALL_C_RULE_IDS.map(ruleId => [ruleId, false]))),
  enabledRuleIds: Object.freeze([]),
});
const HISTORICAL_C1_CONFIG = Object.freeze({
  hatchOverlapProfile: 'hatch-c-experimental',
  hatchOverlapRuleFlags: Object.freeze({ [CONTOUR_LAST_RULE_ID]: true }),
});
const CONTROLLED_C1_CONFIG = Object.freeze({
  ...HISTORICAL_C1_CONFIG,
  hatchOverlapActivationMode: 'controlled-opt-in',
});
const CONTROLLED_OFF_CONFIG = Object.freeze({
  hatchOverlapProfile: 'hatch-c-experimental',
  hatchOverlapActivationMode: 'controlled-opt-in',
  hatchOverlapRuleFlags: Object.freeze({}),
});
const DIGITAL_PROBES = Object.freeze({
  C7: Object.freeze({
    points: 412,
    commands: 427,
    physicalSha256: '734a4beb305bc6d3cf1eb790c4de283a8d585f976a33d2af928abec994de385a',
    commandSha256: '34515292bce20add7f4ebc9ab8f88047fdf725e5aa9d519cf41fda5bbad317d0',
  }),
  C8: Object.freeze({
    points: 285,
    commands: 291,
    physicalSha256: '6c9ce744f573b8009c5ae70c9010665005c04b9781b79756493aff89837b4237',
    commandSha256: 'a7d030f4dea4ae5cd80e98ff6b0c4391e47f4aede777a5695cbfec4038287d2e',
  }),
  C11: Object.freeze({
    points: 371,
    commands: 379,
    physicalSha256: '10e80f957920e77dc8c92e8e9706ef3c7c3ef2392c378b4c0a15ad822d259c50',
    commandSha256: '2ac7dbf99d6d65863c0698affea8a2bd25a7f685c91aecd8f18708858cfdd958',
  }),
  C12: Object.freeze({
    points: 428,
    commands: 440,
    physicalSha256: '500114469154a0191259d437f09226a7a9c4e5c2d0bbfc3275e5e3f24880d2bf',
    commandSha256: '14a9034a8b2ca0a6fe129f074fddbd7ca825610d191c137b9aa8df73e5082dae',
  }),
});

const sha256Json = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function expectDeeplyFrozen(value) {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(expectDeeplyFrozen);
}

function controlledConfig(ruleIds = [], overrides = {}) {
  return {
    hatchOverlapProfile: 'hatch-c-experimental',
    hatchOverlapActivationMode: 'controlled-opt-in',
    hatchOverlapRuleFlags: Object.fromEntries(ruleIds.map(ruleId => [ruleId, true])),
    ...overrides,
  };
}

function hatchEvidenceConfig(ruleIds = [], overrides = {}) {
  const config = {
    hatchEvidenceProfile: 'hatch-a-f-experimental',
    hatchEvidenceRuleFlags: Object.fromEntries(
      HATCH_EVIDENCE_RULE_IDS.map(ruleId => [ruleId, ruleIds.includes(ruleId)]),
    ),
    hatchEvidenceContext: {
      fabricProfile: 'Pure Cotton',
      referenceScaleCompatible: true,
    },
    ...overrides,
  };
  return config;
}

function controlledC1With(hatchEvidenceConfigSource = {}) {
  return { ...controlledConfig([CONTOUR_LAST_RULE_ID]), ...hatchEvidenceConfigSource };
}

function expectControlledC1Fallback(config, reasonCode) {
  expect(resolveHatchOverlapControlledOptInPolicy(config)).toEqual({
    ...EMPTY_POLICY,
    fallbackToLegacy: true,
    fallbackReasonCodes: [reasonCode],
  });
  expect(resolveHatchOverlapIntegrationConfig(config)).toEqual(LEGACY_INTEGRATION);
  expect(validateHatchOverlapIntegrationConfig(config).errors.map(error => error.code))
    .toContain(reasonCode);
}

function snapshotOwnDescriptors(value) {
  return Reflect.ownKeys(value).map(key => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(value, key),
  }));
}

function expectOwnDescriptorsUnchanged(value, snapshot) {
  const keys = Reflect.ownKeys(value);
  expect(keys).toEqual(snapshot.map(item => item.key));
  snapshot.forEach(({ key, descriptor: before }) => {
    const after = Object.getOwnPropertyDescriptor(value, key);
    expect(after.enumerable).toBe(before.enumerable);
    expect(after.configurable).toBe(before.configurable);
    if (Object.hasOwn(before, 'value')) {
      expect(after.value).toBe(before.value);
      expect(after.writable).toBe(before.writable);
    } else {
      expect(after.get).toBe(before.get);
      expect(after.set).toBe(before.set);
    }
  });
}

function expectControlledPrecedenceFallback(config, reasonCode) {
  expect(() => resolveHatchOverlapControlledOptInPolicy(config)).not.toThrow();
  expect(resolveHatchOverlapControlledOptInPolicy(config)).toEqual({
    ...EMPTY_POLICY,
    fallbackToLegacy: true,
    fallbackReasonCodes: [reasonCode],
  });
  expect(resolveHatchOverlapIntegrationConfig(config)).toEqual(LEGACY_INTEGRATION);
  const validation = validateHatchOverlapIntegrationConfig(config);
  expect(validation.errors[0]?.code).toBe(reasonCode);
  expect(validation.config).toEqual(LEGACY_INTEGRATION);
}

function selfRevokingRecord(record) {
  const probe = { calls: 0 };
  let revocable;
  revocable = Proxy.revocable(record, {
    getPrototypeOf(target) {
      probe.calls += 1;
      const prototype = Reflect.getPrototypeOf(target);
      revocable.revoke();
      return prototype;
    },
  });
  return {
    proxy: revocable.proxy,
    assertInspectedAndRevoked() {
      expect(probe.calls).toBeGreaterThan(0);
      expect(() => Reflect.ownKeys(revocable.proxy)).toThrow();
    },
  };
}

function planningConfig(overlapConfig) {
  return {
    designWidthMm: HATCH_C_REFERENCE_DESIGN_MM.width,
    designHeightMm: HATCH_C_REFERENCE_DESIGN_MM.height,
    minimumTatamiAreaMm2: 5,
    ...overlapConfig,
  };
}

function runReference(referenceId, overlapConfig) {
  const sourceRegions = createHatchCReferenceRegions(referenceId);
  const sourceBefore = structuredClone(sourceRegions);
  const technicalConfig = referenceId === 'C12'
    ? { tatami: { minimumAreaMm2: 5 } }
    : {};
  const ingestion = ingestV1RegionsToRegionGraphV2(sourceRegions, {
    coordinateSpace: 'millimeter',
    designWidthMm: HATCH_C_REFERENCE_DESIGN_MM.width,
    designHeightMm: HATCH_C_REFERENCE_DESIGN_MM.height,
  });
  const semanticResult = createHatchCReferenceSemanticResult(ingestion.regions, referenceId);
  const proposalPlan = buildEmbroideryObjectProposalPlan({
    regions: ingestion.regions,
    graph: ingestion.graph,
    semanticResult,
    config: planningConfig(overlapConfig),
    technicalConfig,
  });
  const objectDraftMaterialization = materializeEmbroideryObjectDrafts({
    regions: ingestion.regions,
    graph: ingestion.graph,
    semanticResult,
    proposalPlan,
  });
  const threadedObjectMaterialization = materializeThreadedEmbroideryObjects({
    regions: ingestion.regions,
    objectDraftMaterialization,
  });
  const technicalPlan = buildTechnicalEmbroideryPlan({
    regions: ingestion.regions,
    threadedObjectMaterialization,
    config: technicalConfig,
  });
  const sequencePlan = buildGlobalSequencePlan({
    regions: ingestion.regions,
    threadedObjectMaterialization,
    technicalPlan,
  });
  const physicalPlan = buildMachineIndependentPhysicalStitchPlan({
    regions: ingestion.regions,
    threadedObjectMaterialization,
    technicalPlan,
    sequencePlan,
  });
  const canonicalCompilation = compileCanonicalCommandStream({
    regions: ingestion.regions,
    threadedObjectMaterialization,
    technicalPlan,
    sequencePlan,
    physicalPlan,
  });
  return {
    sourceRegions,
    sourceBefore,
    ingestion,
    semanticResult,
    proposalPlan,
    objectDraftMaterialization,
    threadedObjectMaterialization,
    technicalPlan,
    sequencePlan,
    physicalPlan,
    canonicalCompilation,
  };
}

function expectValidRun(run) {
  [
    run.ingestion,
    run.proposalPlan,
    run.objectDraftMaterialization,
    run.threadedObjectMaterialization,
    run.technicalPlan,
    run.sequencePlan,
    run.physicalPlan,
    run.canonicalCompilation,
  ].forEach(result => expect(result.valid).toBe(true));
  expect(run.sourceRegions).toEqual(run.sourceBefore);
}

function operationalSnapshot(run) {
  return {
    proposals: run.proposalPlan.proposals.map(proposal => ({
      regionId: proposal.regionId,
      role: proposal.proposedEmbroideryRole,
      stitchType: proposal.proposedStitchType,
      geometryMm: proposal.geometryMm,
      holesMm: proposal.holesMm,
      layer: proposal.layer,
      dependencyIds: proposal.dependencyIds,
    })),
    executionLayers: run.proposalPlan.executionLayers,
    executionOrder: run.sequencePlan.executionSteps.map(step => step.objectId),
    physicalPaths: run.physicalPlan.objectPaths,
    commands: run.canonicalCompilation.commands,
  };
}

function validateMutatedPlan(run, mutate, overrides = {}) {
  const plan = structuredClone(run.proposalPlan);
  const regions = structuredClone(run.ingestion.regions);
  const graph = structuredClone(run.ingestion.graph);
  const semanticResult = structuredClone(run.semanticResult);
  mutate({ plan, regions, graph, semanticResult });
  plan.valid = true;
  return validateEmbroideryObjectProposalPlan(
    plan,
    overrides.regions || regions,
    overrides.graph || graph,
    overrides.semanticResult || semanticResult,
  );
}

function invalidDownstreamChain(run, mutate) {
  const proposalPlan = structuredClone(run.proposalPlan);
  mutate(proposalPlan);
  proposalPlan.valid = true;
  const review = resolveProposalReviewDecisions({
    plan: proposalPlan,
    regions: run.ingestion.regions,
    graph: run.ingestion.graph,
    semanticResult: run.semanticResult,
  });
  const drafts = materializeEmbroideryObjectDrafts({
    regions: run.ingestion.regions,
    graph: run.ingestion.graph,
    semanticResult: run.semanticResult,
    proposalPlan,
  });
  const objects = materializeThreadedEmbroideryObjects({
    regions: run.ingestion.regions,
    objectDraftMaterialization: drafts,
  });
  const technical = buildTechnicalEmbroideryPlan({
    regions: run.ingestion.regions,
    threadedObjectMaterialization: objects,
  });
  const sequence = buildGlobalSequencePlan({
    regions: run.ingestion.regions,
    threadedObjectMaterialization: objects,
    technicalPlan: technical,
  });
  const physical = buildMachineIndependentPhysicalStitchPlan({
    regions: run.ingestion.regions,
    threadedObjectMaterialization: objects,
    technicalPlan: technical,
    sequencePlan: sequence,
  });
  const canonical = compileCanonicalCommandStream({
    regions: run.ingestion.regions,
    threadedObjectMaterialization: objects,
    technicalPlan: technical,
    sequencePlan: sequence,
    physicalPlan: physical,
    config: { allowPartialCanonicalStream: true },
  });
  return { review, drafts, objects, technical, sequence, physical, canonical };
}

function buildAmbiguousMultiContourPlan() {
  const sources = [
    {
      id: 'r04-fill',
      color: '#f57c00',
      region_class: 'body',
      path_points: [[30, 30], [70, 30], [70, 70], [30, 70]],
    },
    {
      id: 'r04-outline-a',
      color: '#111111',
      region_class: 'outer outline',
      path_points: [[20, 20], [80, 20], [80, 80], [20, 80]],
      darkStrokeSupport: { available: true, ratio: 1 },
      source: { outlineIntent: 'outer outline' },
    },
    {
      id: 'r04-outline-b',
      color: '#222222',
      region_class: 'outer outline',
      path_points: [[15, 15], [85, 15], [85, 85], [15, 85]],
      darkStrokeSupport: { available: true, ratio: 1 },
      source: { outlineIntent: 'outer outline' },
    },
  ];
  const ingestion = ingestV1RegionsToRegionGraphV2(sources, {
    coordinateSpace: 'millimeter',
    designWidthMm: 100,
    designHeightMm: 100,
  });
  const roleById = {
    'r04-fill': 'primary_shape',
    'r04-outline-a': 'dark_mark',
    'r04-outline-b': 'dark_mark',
  };
  const assessments = ingestion.regions.map(region => createSemanticRegionAssessmentV2({
    regionId: region.id,
    semanticRole: roleById[region.id],
    confidence: 1,
    evidence: [{ code: 'R04_MULTI_CONTOUR_FIXTURE', message: 'Controlled R04 fixture.' }],
  }));
  return buildEmbroideryObjectProposalPlan({
    regions: ingestion.regions,
    graph: ingestion.graph,
    semanticResult: {
      assessments,
      byRegionId: Object.fromEntries(assessments.map(item => [item.regionId, item])),
    },
    config: planningConfig(CONTROLLED_C1_CONFIG),
    technicalConfig: {},
  });
}

describe('R04 controlled Hatch overlap policy', () => {
  it('does not intervene when the activation mode is absent or undefined', () => {
    const historicalAllOn = {
      hatchOverlapProfile: 'hatch-c-experimental',
      hatchOverlapRuleFlags: Object.fromEntries(ALL_C_RULE_IDS.map(ruleId => [ruleId, true])),
    };
    const explicitUndefined = { ...historicalAllOn, hatchOverlapActivationMode: undefined };
    expect(resolveHatchOverlapControlledOptInPolicy(historicalAllOn)).toEqual(EMPTY_POLICY);
    expect(resolveHatchOverlapControlledOptInPolicy(explicitUndefined)).toEqual(EMPTY_POLICY);
    expect(resolveHatchOverlapIntegrationConfig(explicitUndefined))
      .toEqual(resolveHatchOverlapIntegrationConfig(historicalAllOn));
    expect(validateHatchOverlapIntegrationConfig(explicitUndefined))
      .toEqual(validateHatchOverlapIntegrationConfig(historicalAllOn));
  });

  it.each([null, '', 'future', 1, true, [], {}])(
    'rejects explicit invalid activation value %# and resolves no C rule',
    activationMode => {
      const config = controlledConfig([CONTOUR_LAST_RULE_ID], {
        hatchOverlapActivationMode: activationMode,
      });
      expect(resolveHatchOverlapControlledOptInPolicy(config)).toEqual({
        ...EMPTY_POLICY,
        fallbackToLegacy: true,
        fallbackReasonCodes: ['INVALID_HATCH_OVERLAP_ACTIVATION_MODE'],
      });
      expect(resolveHatchOverlapIntegrationConfig(config)).toEqual(LEGACY_INTEGRATION);
      expect(validateHatchOverlapIntegrationConfig(config).errors.map(error => error.code))
        .toContain('INVALID_HATCH_OVERLAP_ACTIVATION_MODE');
    },
  );

  it('rejects controlled mode under legacy and fails back to legacy', () => {
    const config = controlledConfig([CONTOUR_LAST_RULE_ID], { hatchOverlapProfile: 'legacy' });
    expect(resolveHatchOverlapControlledOptInPolicy(config).fallbackReasonCodes)
      .toEqual(['HATCH_OVERLAP_CONTROLLED_OPT_IN_REQUIRES_EXPERIMENTAL_PROFILE']);
    expect(resolveHatchOverlapIntegrationConfig(config)).toEqual(LEGACY_INTEGRATION);
    expect(validateHatchOverlapIntegrationConfig(config).valid).toBe(false);
  });

  it('treats controlled all-OFF as a valid explicit legacy fallback', () => {
    expect(validateHatchOverlapIntegrationConfig(CONTROLLED_OFF_CONFIG).valid).toBe(true);
    expect(resolveHatchOverlapControlledOptInPolicy(CONTROLLED_OFF_CONFIG)).toEqual({
      ...EMPTY_POLICY,
      fallbackToLegacy: true,
      fallbackReasonCodes: ['HATCH_OVERLAP_CONTROLLED_OPT_IN_NO_EFFECTIVE_RULES'],
    });
    expect(resolveHatchOverlapIntegrationConfig(CONTROLLED_OFF_CONFIG)).toEqual(LEGACY_INTEGRATION);
  });

  it('authorizes only individual C1 with deeply frozen canonical lists', () => {
    const policy = resolveHatchOverlapControlledOptInPolicy(CONTROLLED_C1_CONFIG);
    expect(policy).toEqual({
      operationalRuleIds: [CONTOUR_LAST_RULE_ID],
      diagnosticRuleIds: [],
      effectiveRuleIds: [CONTOUR_LAST_RULE_ID],
      fallbackToLegacy: false,
      fallbackReasonCodes: [],
    });
    expect(resolveHatchOverlapIntegrationConfig(CONTROLLED_C1_CONFIG).enabledRuleIds)
      .toEqual([CONTOUR_LAST_RULE_ID]);
    expectDeeplyFrozen(policy);
    expectDeeplyFrozen(HATCH_OVERLAP_CONTROLLED_OPT_IN_POLICY);
  });

  it.each([COLOR_GROUP_HEURISTIC_RULE_ID, MULTILAYER_DEPENDENCY_RULE_ID])(
    'rejects unauthorized individual controlled rule %s',
    ruleId => {
      const policy = resolveHatchOverlapControlledOptInPolicy(controlledConfig([ruleId]));
      expect(policy.fallbackReasonCodes)
        .toEqual(['HATCH_OVERLAP_CONTROLLED_OPT_IN_RULE_NOT_AUTHORIZED']);
      expect(resolveHatchOverlapIntegrationConfig(controlledConfig([ruleId])))
        .toEqual(LEGACY_INTEGRATION);
    },
  );

  it.each([
    { ruleIds: [CONTOUR_LAST_RULE_ID, COLOR_GROUP_HEURISTIC_RULE_ID] },
    { ruleIds: [CONTOUR_LAST_RULE_ID, MULTILAYER_DEPENDENCY_RULE_ID] },
    { ruleIds: [COLOR_GROUP_HEURISTIC_RULE_ID, MULTILAYER_DEPENDENCY_RULE_ID] },
  ])('rejects multiple controlled rules $ruleIds', ({ ruleIds }) => {
    expect(resolveHatchOverlapControlledOptInPolicy(controlledConfig(ruleIds)).fallbackReasonCodes)
      .toEqual(['HATCH_OVERLAP_CONTROLLED_OPT_IN_MULTIPLE_RULES_FORBIDDEN']);
  });

  it('rejects ALL-ON before the general multiple-rule error', () => {
    expect(resolveHatchOverlapControlledOptInPolicy(controlledConfig(ALL_C_RULE_IDS)).fallbackReasonCodes)
      .toEqual(['HATCH_OVERLAP_CONTROLLED_OPT_IN_ALL_ON_FORBIDDEN']);
  });

  it.each([
    ['historical SATIN-RANGE', [SATIN_RANGE_RULE_ID], undefined],
    ['historical LOCAL-WIDTH', [LOCAL_WIDTH_RULE_ID], undefined],
    ['historical HOLE-PRESERVE', [HOLE_PRESERVE_RULE_ID], undefined],
    ['historical HOLE-MIN-SIZE', [HOLE_MIN_SIZE_RULE_ID], undefined],
    ['historical combination', [LOCAL_WIDTH_RULE_ID, HOLE_PRESERVE_RULE_ID], undefined],
    ['historical ALL-ON', HATCH_EVIDENCE_RULE_IDS, undefined],
    ['R03 controlled SATIN-RANGE', [SATIN_RANGE_RULE_ID], 'controlled-opt-in'],
    ['R03 controlled HOLE-MIN-SIZE', [HOLE_MIN_SIZE_RULE_ID], 'controlled-opt-in'],
    ['R03 diagnostic LOCAL-WIDTH', [LOCAL_WIDTH_RULE_ID], 'controlled-opt-in'],
    ['R03 diagnostic HOLE-PRESERVE', [HOLE_PRESERVE_RULE_ID], 'controlled-opt-in'],
  ])('rejects requested A/B source $label before any C evaluator', (
    _label,
    ruleIds,
    activationMode,
  ) => {
    const aBConfig = hatchEvidenceConfig(ruleIds, activationMode
      ? { hatchEvidenceActivationMode: activationMode }
      : {});
    expectControlledC1Fallback(
      controlledC1With(aBConfig),
      'HATCH_OVERLAP_CONTROLLED_OPT_IN_CROSS_PHASE_COMBINATION_FORBIDDEN',
    );
  });

  it.each([
    ['A/B absent', {}],
    ['legacy all-OFF', hatchEvidenceConfig([], {
      hatchEvidenceProfile: 'legacy',
      hatchEvidenceContext: undefined,
    })],
    ['historical experimental all-OFF', hatchEvidenceConfig([])],
    ['R03 controlled all-OFF', hatchEvidenceConfig([], {
      hatchEvidenceActivationMode: 'controlled-opt-in',
    })],
  ])('allows controlled C1 when $label is valid', (_label, aBConfig) => {
    const config = controlledC1With(aBConfig);
    expect(resolveHatchOverlapControlledOptInPolicy(config).effectiveRuleIds)
      .toEqual([CONTOUR_LAST_RULE_ID]);
    expect(resolveHatchOverlapIntegrationConfig(config).enabledRuleIds)
      .toEqual([CONTOUR_LAST_RULE_ID]);
  });

  it.each([
    ['invalid profile', hatchEvidenceConfig([], { hatchEvidenceProfile: 'future' })],
    ['invalid activation mode', hatchEvidenceConfig([], {
      hatchEvidenceActivationMode: 'future',
    })],
    ['legacy with R03 controlled mode', hatchEvidenceConfig([], {
      hatchEvidenceProfile: 'legacy',
      hatchEvidenceActivationMode: 'controlled-opt-in',
      hatchEvidenceContext: undefined,
    })],
    ['invalid flags container', hatchEvidenceConfig([], { hatchEvidenceRuleFlags: [] })],
    ['unknown flag', hatchEvidenceConfig([], {
      hatchEvidenceRuleFlags: { 'FUTURE-A-B-RULE': true },
    })],
    ['non-boolean canonical flag', hatchEvidenceConfig([], {
      hatchEvidenceRuleFlags: { [SATIN_RANGE_RULE_ID]: 'yes' },
    })],
    ['enabled rule under legacy', hatchEvidenceConfig([HOLE_MIN_SIZE_RULE_ID], {
      hatchEvidenceProfile: 'legacy',
    })],
    ['missing required context', hatchEvidenceConfig([HOLE_MIN_SIZE_RULE_ID], {
      hatchEvidenceContext: {},
    })],
    ['invalid context field', hatchEvidenceConfig([HOLE_PRESERVE_RULE_ID], {
      hatchEvidenceContext: { fabricProfile: '' },
    })],
    ['R03 operational conflict', hatchEvidenceConfig([
      SATIN_RANGE_RULE_ID,
      HOLE_MIN_SIZE_RULE_ID,
    ], { hatchEvidenceActivationMode: 'controlled-opt-in' })],
    ['R03 ALL-ON', hatchEvidenceConfig(HATCH_EVIDENCE_RULE_IDS, {
      hatchEvidenceActivationMode: 'controlled-opt-in',
    })],
  ])('fails closed on invalid A/B source $label', (_label, aBConfig) => {
    expectControlledC1Fallback(controlledC1With(aBConfig), CROSS_PHASE_SOURCE_INVALID);
  });

  it.each([
    ['hatchOverlapActivationMode getter', (config, called) => {
      Object.defineProperty(config, 'hatchOverlapActivationMode', {
        enumerable: true,
        get() { called(); throw new Error('must not execute'); },
      });
    }],
    ['hatchOverlapRuleFlags getter', (config, called) => {
      Object.defineProperty(config, 'hatchOverlapRuleFlags', {
        enumerable: true,
        get() { called(); throw new Error('must not execute'); },
      });
    }],
    ['hatchEvidenceProfile getter', (config, called) => {
      Object.defineProperty(config, 'hatchEvidenceProfile', {
        enumerable: true,
        get() { called(); throw new Error('must not execute'); },
      });
    }],
    ['hatchEvidenceRuleFlags getter', (config, called) => {
      Object.defineProperty(config, 'hatchEvidenceRuleFlags', {
        enumerable: true,
        get() { called(); throw new Error('must not execute'); },
      });
    }],
    ['A/B rule getter', (config, called) => {
      const flags = {};
      Object.defineProperty(flags, SATIN_RANGE_RULE_ID, {
        enumerable: true,
        get() { called(); throw new Error('must not execute'); },
      });
      config.hatchEvidenceProfile = 'hatch-a-f-experimental';
      config.hatchEvidenceRuleFlags = flags;
    }],
    ['A/B rule setter', (config, called) => {
      const flags = {};
      Object.defineProperty(flags, SATIN_RANGE_RULE_ID, {
        enumerable: true,
        set() { called(); },
      });
      config.hatchEvidenceProfile = 'hatch-a-f-experimental';
      config.hatchEvidenceRuleFlags = flags;
    }],
  ])('rejects %s without executing the accessor', (_label, defineAccessor) => {
    let accessorCalls = 0;
    const config = controlledC1With();
    defineAccessor(config, () => { accessorCalls += 1; });
    expectControlledC1Fallback(config, CROSS_PHASE_SOURCE_INVALID);
    expect(accessorCalls).toBe(0);
  });

  it.each([
    ['getPrototypeOf', { getPrototypeOf() { throw new Error('hostile getPrototypeOf'); } }],
    ['ownKeys', { ownKeys() { throw new Error('hostile ownKeys'); } }],
    ['getOwnPropertyDescriptor', {
      getOwnPropertyDescriptor() { throw new Error('hostile getOwnPropertyDescriptor'); },
    }],
  ])('captures hostile A/B rule flag Proxy trap %s', (_label, handler) => {
    const hostileFlags = new Proxy({ [SATIN_RANGE_RULE_ID]: false }, handler);
    const config = controlledC1With({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: hostileFlags,
    });
    expect(() => expectControlledC1Fallback(config, CROSS_PHASE_SOURCE_INVALID)).not.toThrow();
  });

  it('captures hostile root and extras proxies without reading through them', () => {
    const hostileRoot = new Proxy(controlledC1With(), {
      ownKeys() { throw new Error('hostile root ownKeys'); },
    });
    const hostileExtras = new Proxy({ hatchEvidenceProfile: 'legacy' }, {
      getOwnPropertyDescriptor() { throw new Error('hostile extras descriptor'); },
    });
    expect(() => expectControlledC1Fallback(hostileRoot, CROSS_PHASE_SOURCE_INVALID))
      .not.toThrow();
    expect(() => expectControlledC1Fallback(controlledC1With({ extras: hostileExtras }),
      CROSS_PHASE_SOURCE_INVALID)).not.toThrow();
  });

  it.each([
    ['root', () => {
      const revocable = Proxy.revocable(controlledC1With(), {});
      revocable.revoke();
      return revocable.proxy;
    }],
    ['extras', () => {
      const revocable = Proxy.revocable({ hatchEvidenceProfile: 'legacy' }, {});
      const config = controlledC1With({ extras: revocable.proxy });
      revocable.revoke();
      return config;
    }],
    ['A/B flags', () => {
      const revocable = Proxy.revocable({ [SATIN_RANGE_RULE_ID]: false }, {});
      const config = controlledC1With({
        hatchEvidenceProfile: 'hatch-a-f-experimental',
        hatchEvidenceRuleFlags: revocable.proxy,
      });
      revocable.revoke();
      return config;
    }],
  ])('fails closed on revoked %s Proxy without propagating', (_label, createConfig) => {
    expect(() => expectControlledC1Fallback(createConfig(), CROSS_PHASE_SOURCE_INVALID))
      .not.toThrow();
  });

  it.each([
    ['root', () => {
      const config = controlledC1With();
      config[Symbol('hostile-root')] = true;
      return config;
    }],
    ['extras', () => {
      const extras = { hatchEvidenceProfile: 'legacy' };
      extras[Symbol('hostile-extras')] = true;
      return controlledC1With({ extras });
    }],
    ['A/B flags', () => {
      const flags = { [SATIN_RANGE_RULE_ID]: false };
      flags[Symbol('hostile-flags')] = true;
      return controlledC1With({
        hatchEvidenceProfile: 'hatch-a-f-experimental',
        hatchEvidenceRuleFlags: flags,
      });
    }],
  ])('rejects Symbol keys in controlled %s records', (_label, createConfig) => {
    expectControlledC1Fallback(createConfig(), CROSS_PHASE_SOURCE_INVALID);
  });

  it.each([
    ['root', () => {
      const config = controlledC1With();
      Object.defineProperty(config, 'hiddenR04Root', { value: true });
      return config;
    }],
    ['extras', () => {
      const extras = { hatchEvidenceProfile: 'legacy' };
      Object.defineProperty(extras, 'hiddenR04Extras', { value: true });
      return controlledC1With({ extras });
    }],
    ['A/B flags', () => {
      const flags = {};
      Object.defineProperty(flags, SATIN_RANGE_RULE_ID, { value: false });
      return controlledC1With({
        hatchEvidenceProfile: 'hatch-a-f-experimental',
        hatchEvidenceRuleFlags: flags,
      });
    }],
  ])('rejects hidden properties in controlled %s records', (_label, createConfig) => {
    expectControlledC1Fallback(createConfig(), CROSS_PHASE_SOURCE_INVALID);
  });

  it.each([
    ['root', () => Object.assign(Object.create({ inheritedR04: true }), controlledC1With())],
    ['extras', () => controlledC1With({
      extras: Object.assign(Object.create({ inheritedR04: true }), {
        hatchEvidenceProfile: 'legacy',
      }),
    })],
    ['A/B flags', () => controlledC1With({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: Object.assign(Object.create({ inheritedR04: true }), {
        [SATIN_RANGE_RULE_ID]: false,
      }),
    })],
    ['A/B context', () => controlledC1With({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: { [SATIN_RANGE_RULE_ID]: false },
      hatchEvidenceContext: Object.assign(Object.create({ inheritedR04: true }), {
        fabricProfile: 'Pure Cotton',
        referenceScaleCompatible: true,
      }),
    })],
  ])('rejects custom prototype on controlled %s record', (_label, createConfig) => {
    expectControlledC1Fallback(createConfig(), CROSS_PHASE_SOURCE_INVALID);
  });

  it('rejects a Proxy whose descriptor snapshot contradicts ownKeys', () => {
    const inconsistentFlags = new Proxy({ [SATIN_RANGE_RULE_ID]: false }, {
      ownKeys() { return [SATIN_RANGE_RULE_ID]; },
      getOwnPropertyDescriptor() { return undefined; },
    });
    expectControlledC1Fallback(controlledC1With({
      hatchEvidenceProfile: 'hatch-a-f-experimental',
      hatchEvidenceRuleFlags: inconsistentFlags,
    }), CROSS_PHASE_SOURCE_INVALID);
  });

  it('gives structural C errors precedence over an invalid A/B source', () => {
    const config = controlledC1With({
      ...hatchEvidenceConfig([], { hatchEvidenceProfile: 'future' }),
      hatchOverlapRuleFlags: {
        [CONTOUR_LAST_RULE_ID]: true,
        'FUTURE-C-RULE': true,
      },
    });
    expect(resolveHatchOverlapControlledOptInPolicy(config)).toEqual({
      ...EMPTY_POLICY,
      fallbackToLegacy: true,
      fallbackReasonCodes: ['UNKNOWN_HATCH_OVERLAP_RULE_FLAG'],
    });
    expect(resolveHatchOverlapIntegrationConfig(config)).toEqual(LEGACY_INTEGRATION);
    expect(validateHatchOverlapIntegrationConfig(config).errors.map(error => error.code))
      .toEqual(['UNKNOWN_HATCH_OVERLAP_RULE_FLAG']);
  });

  it.each([
    ['invalid activation + revoked C flags', () => {
      const revocable = selfRevokingRecord({ [CONTOUR_LAST_RULE_ID]: true });
      const config = controlledConfig([], {
        hatchOverlapActivationMode: 'future',
        hatchOverlapRuleFlags: revocable.proxy,
      });
      return {
        config,
        reasonCode: 'INVALID_HATCH_OVERLAP_ACTIVATION_MODE',
        assertProbe: revocable.assertInspectedAndRevoked,
      };
    }],
    ['invalid activation + revoked extras', () => {
      const revocable = selfRevokingRecord({ hatchEvidenceProfile: 'legacy' });
      const config = controlledConfig([CONTOUR_LAST_RULE_ID], {
        hatchOverlapActivationMode: 'future',
        extras: revocable.proxy,
      });
      return {
        config,
        reasonCode: 'INVALID_HATCH_OVERLAP_ACTIVATION_MODE',
        assertProbe: revocable.assertInspectedAndRevoked,
      };
    }],
    ['invalid activation + revoked A/B flags', () => {
      const revocable = selfRevokingRecord({ [SATIN_RANGE_RULE_ID]: false });
      const config = controlledConfig([CONTOUR_LAST_RULE_ID], {
        hatchOverlapActivationMode: 'future',
        hatchEvidenceProfile: 'hatch-a-f-experimental',
        hatchEvidenceRuleFlags: revocable.proxy,
      });
      return {
        config,
        reasonCode: 'INVALID_HATCH_OVERLAP_ACTIVATION_MODE',
        assertProbe: revocable.assertInspectedAndRevoked,
      };
    }],
    ['legacy profile + revoked C flags', () => {
      const revocable = selfRevokingRecord({ [CONTOUR_LAST_RULE_ID]: true });
      const config = controlledConfig([], {
        hatchOverlapProfile: 'legacy',
        hatchOverlapRuleFlags: revocable.proxy,
      });
      return {
        config,
        reasonCode: 'HATCH_OVERLAP_CONTROLLED_OPT_IN_REQUIRES_EXPERIMENTAL_PROFILE',
        assertProbe: revocable.assertInspectedAndRevoked,
      };
    }],
    ['legacy profile + revoked A/B flags', () => {
      const revocable = selfRevokingRecord({ [SATIN_RANGE_RULE_ID]: false });
      const config = controlledConfig([CONTOUR_LAST_RULE_ID], {
        hatchOverlapProfile: 'legacy',
        hatchEvidenceProfile: 'hatch-a-f-experimental',
        hatchEvidenceRuleFlags: revocable.proxy,
      });
      return {
        config,
        reasonCode: 'HATCH_OVERLAP_CONTROLLED_OPT_IN_REQUIRES_EXPERIMENTAL_PROFILE',
        assertProbe: revocable.assertInspectedAndRevoked,
      };
    }],
    ['C ALL-ON + hostile A/B', () => {
      const probe = { calls: 0 };
      const hostileFlags = new Proxy({ [SATIN_RANGE_RULE_ID]: false }, {
        getPrototypeOf() { probe.calls += 1; throw new Error('hostile A/B'); },
      });
      return {
        config: controlledConfig(ALL_C_RULE_IDS, {
          hatchEvidenceProfile: 'hatch-a-f-experimental',
          hatchEvidenceRuleFlags: hostileFlags,
        }),
        reasonCode: 'HATCH_OVERLAP_CONTROLLED_OPT_IN_ALL_ON_FORBIDDEN',
        assertProbe: () => expect(probe.calls).toBeGreaterThan(0),
      };
    }],
    ['multiple C rules + hostile A/B', () => {
      const probe = { calls: 0 };
      const hostileFlags = new Proxy({ [SATIN_RANGE_RULE_ID]: false }, {
        ownKeys() { probe.calls += 1; throw new Error('hostile A/B'); },
      });
      return {
        config: controlledConfig([CONTOUR_LAST_RULE_ID, COLOR_GROUP_HEURISTIC_RULE_ID], {
          hatchEvidenceProfile: 'hatch-a-f-experimental',
          hatchEvidenceRuleFlags: hostileFlags,
        }),
        reasonCode: 'HATCH_OVERLAP_CONTROLLED_OPT_IN_MULTIPLE_RULES_FORBIDDEN',
        assertProbe: () => expect(probe.calls).toBeGreaterThan(0),
      };
    }],
    ['unauthorized C2 + hostile A/B', () => {
      const probe = { calls: 0 };
      const hostileFlags = new Proxy({ [SATIN_RANGE_RULE_ID]: false }, {
        getOwnPropertyDescriptor() { probe.calls += 1; throw new Error('hostile A/B'); },
      });
      return {
        config: controlledConfig([COLOR_GROUP_HEURISTIC_RULE_ID], {
          hatchEvidenceProfile: 'hatch-a-f-experimental',
          hatchEvidenceRuleFlags: hostileFlags,
        }),
        reasonCode: 'HATCH_OVERLAP_CONTROLLED_OPT_IN_RULE_NOT_AUTHORIZED',
        assertProbe: () => expect(probe.calls).toBeGreaterThan(0),
      };
    }],
    ['unknown C flag + hostile A/B', () => {
      const probe = { calls: 0 };
      const hostileFlags = new Proxy({ [SATIN_RANGE_RULE_ID]: false }, {
        ownKeys() { probe.calls += 1; throw new Error('hostile A/B'); },
      });
      return {
        config: controlledConfig([], {
          hatchOverlapRuleFlags: {
            [CONTOUR_LAST_RULE_ID]: true,
            'FUTURE-C-RULE': true,
          },
          hatchEvidenceProfile: 'hatch-a-f-experimental',
          hatchEvidenceRuleFlags: hostileFlags,
        }),
        reasonCode: 'UNKNOWN_HATCH_OVERLAP_RULE_FLAG',
        assertProbe: () => expect(probe.calls).toBeGreaterThan(0),
      };
    }],
    ['hostile activation accessor + structural C error', () => {
      const probe = { calls: 0 };
      const config = controlledConfig([], {
        hatchOverlapRuleFlags: {
          [CONTOUR_LAST_RULE_ID]: true,
          'FUTURE-C-RULE': true,
        },
      });
      Object.defineProperty(config, 'hatchOverlapActivationMode', {
        enumerable: true,
        get() { probe.calls += 1; throw new Error('must not execute'); },
      });
      return {
        config,
        reasonCode: 'UNKNOWN_HATCH_OVERLAP_RULE_FLAG',
        assertProbe: () => expect(probe.calls).toBe(0),
      };
    }],
    ['hostile activation accessor without structural error', () => {
      const probe = { calls: 0 };
      const config = controlledConfig([CONTOUR_LAST_RULE_ID]);
      Object.defineProperty(config, 'hatchOverlapActivationMode', {
        enumerable: true,
        get() { probe.calls += 1; throw new Error('must not execute'); },
      });
      return {
        config,
        reasonCode: CROSS_PHASE_SOURCE_INVALID,
        assertProbe: () => expect(probe.calls).toBe(0),
      };
    }],
    ['hostile profile accessor without structural error', () => {
      const probe = { calls: 0 };
      const config = controlledConfig([CONTOUR_LAST_RULE_ID]);
      Object.defineProperty(config, 'hatchOverlapProfile', {
        enumerable: true,
        get() { probe.calls += 1; throw new Error('must not execute'); },
      });
      return {
        config,
        reasonCode: CROSS_PHASE_SOURCE_INVALID,
        assertProbe: () => expect(probe.calls).toBe(0),
      };
    }],
  ])('applies simultaneous precedence for %s', (_label, createCase) => {
    const { config, reasonCode, assertProbe } = createCase();
    const before = snapshotOwnDescriptors(config);
    expectControlledPrecedenceFallback(config, reasonCode);
    assertProbe();
    expectOwnDescriptorsUnchanged(config, before);
  });

  it('keeps the direct dependency consumer OFF for an invalid A/B source', () => {
    const baseline = runReference('C8', CONTROLLED_OFF_CONFIG);
    const config = planningConfig(controlledC1With(hatchEvidenceConfig([], {
      hatchEvidenceProfile: 'future',
    })));
    const direct = deriveCanonicalContourDependencyContract({
      proposals: baseline.proposalPlan.proposals,
      regions: baseline.ingestion.regions,
      graph: baseline.ingestion.graph,
      semanticResult: baseline.semanticResult,
      config,
    });
    expect(resolveHatchOverlapControlledOptInPolicy(config).fallbackReasonCodes)
      .toEqual([CROSS_PHASE_SOURCE_INVALID]);
    expect(direct.integration).toEqual({
      profile: 'legacy',
      enabledRuleIds: [],
      contourLastEnabled: false,
    });
    expect(direct.contract).toBeNull();
    expect(direct).not.toHaveProperty('evaluations');
    expect(direct.proposals.every(proposal => (
      !Object.hasOwn(proposal.source || {}, 'hatchOverlap')
    ))).toBe(true);
  });

  it('canonicalizes structural and future codes independently from insertion order', () => {
    const first = controlledConfig([], {
      hatchOverlapRuleFlags: {
        'FUTURE-C-RULE': true,
        [CONTOUR_LAST_RULE_ID]: 'yes',
      },
    });
    const second = controlledConfig([], {
      hatchOverlapRuleFlags: {
        [CONTOUR_LAST_RULE_ID]: 'yes',
        'FUTURE-C-RULE': true,
      },
    });
    const expected = [
      'UNKNOWN_HATCH_OVERLAP_RULE_FLAG',
      'INVALID_HATCH_OVERLAP_RULE_FLAG_VALUE',
    ];
    expect(resolveHatchOverlapControlledOptInPolicy(first).fallbackReasonCodes).toEqual(expected);
    expect(resolveHatchOverlapControlledOptInPolicy(second).fallbackReasonCodes).toEqual(expected);
    expect(canonicalizeHatchOverlapControlledFallbackReasonCodes([
      'Z_FUTURE',
      'A_FUTURE',
      'Z_FUTURE',
      'INVALID_HATCH_OVERLAP_PROFILE',
    ])).toEqual(['INVALID_HATCH_OVERLAP_PROFILE', 'A_FUTURE', 'Z_FUTURE']);
  });

  it('is deterministic, deeply immutable and does not mutate reused input', () => {
    const config = controlledConfig([CONTOUR_LAST_RULE_ID]);
    const before = structuredClone(config);
    const first = resolveHatchOverlapControlledOptInPolicy(config);
    const second = resolveHatchOverlapControlledOptInPolicy(config);
    expect(second).toEqual(first);
    expect(config).toEqual(before);
    expectDeeplyFrozen(first);
    expectDeeplyFrozen(second);
  });
});

describe('R04 controlled C1 real-pipeline parity', () => {
  it.each(['C7', 'C8', 'C11', 'C12'])(
    '%s reuses historical C1 and preserves OFF nominal and physical output',
    referenceId => {
      const controlled = runReference(referenceId, CONTROLLED_C1_CONFIG);
      const historical = runReference(referenceId, HISTORICAL_C1_CONFIG);
      const off = runReference(referenceId, CONTROLLED_OFF_CONFIG);
      const probe = DIGITAL_PROBES[referenceId];
      expectValidRun(controlled);
      expectValidRun(historical);
      expectValidRun(off);
      expect(controlled.proposalPlan.hatchOverlapTrace.status)
        .toBe(referenceId === 'C7' ? 'not_applicable' : 'validated');
      expect(controlled.proposalPlan.hatchOverlapTrace.applied).toBe(referenceId !== 'C7');
      expect(operationalSnapshot(controlled)).toEqual(operationalSnapshot(historical));
      expect(operationalSnapshot(controlled)).toEqual(operationalSnapshot(off));
      expect(off.proposalPlan).not.toHaveProperty('hatchOverlapTrace');
      expect(controlled.physicalPlan.summary.physicalPointCount).toBe(probe.points);
      expect(controlled.canonicalCompilation.commands).toHaveLength(probe.commands);
      expect(sha256Json(controlled.physicalPlan.objectPaths)).toBe(probe.physicalSha256);
      expect(sha256Json(controlled.canonicalCompilation.commands)).toBe(probe.commandSha256);
    },
  );

  it('proves controlled C1 validates rather than creating the nominal dependency', () => {
    const controlled = runReference('C8', CONTROLLED_C1_CONFIG);
    const off = runReference('C8', CONTROLLED_OFF_CONFIG);
    const controlledOutline = controlled.proposalPlan.proposals
      .find(proposal => proposal.proposedEmbroideryRole === 'outer_outline');
    const offOutline = off.proposalPlan.proposals
      .find(proposal => proposal.proposedEmbroideryRole === 'outer_outline');
    expect(controlledOutline.dependencyIds.length).toBeGreaterThan(0);
    expect(offOutline.dependencyIds).toEqual(controlledOutline.dependencyIds);
    expect(controlled.proposalPlan.metadata).toMatchObject({
      contourLastDependenciesChanged: false,
      contourLastGeometryChanged: false,
      contourLastStitchTechniqueChanged: false,
    });
  });

  it('produces the same controlled result twice without mutating fixtures', () => {
    const first = runReference('C12', CONTROLLED_C1_CONFIG);
    const second = runReference('C12', CONTROLLED_C1_CONFIG);
    expect(operationalSnapshot(second)).toEqual(operationalSnapshot(first));
    expect(first.sourceRegions).toEqual(first.sourceBefore);
    expect(second.sourceRegions).toEqual(second.sourceBefore);
  });
});

describe('R04 controlled C1 fail-closed integrity', () => {
  const mutationCases = [
    {
      label: 'required dependency removed',
      code: 'CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING',
      mutate: ({ plan }) => {
        plan.proposals.find(item => item.proposedEmbroideryRole === 'outer_outline').dependencyIds = [];
      },
    },
    {
      label: 'contract fingerprint stale',
      code: 'CONTOUR_LAST_CONTRACT_STALE',
      mutate: ({ plan }) => { plan.hatchOverlapDependencyContract.fingerprint = '00000000'; },
    },
    {
      label: 'integration marker contradictory',
      code: 'CONTOUR_LAST_INTEGRATION_MARKER_STALE',
      mutate: ({ plan }) => { plan.hatchOverlapIntegrationMarker.active = false; },
    },
    {
      label: 'trace contradictory',
      code: 'CONTOUR_LAST_TRACE_STALE',
      mutate: ({ plan }) => { plan.hatchOverlapTrace.applied = false; },
    },
    {
      label: 'graph component divergent',
      code: 'CONTOUR_LAST_CONTRACT_STALE',
      mutate: ({ graph }) => {
        const outlineId = Object.keys(graph.nodes).find(id => id.includes('outline'));
        graph.nodes[outlineId].disconnectedComponentId = 'component-r04-divergent';
      },
    },
    {
      label: 'current region divergent',
      code: 'CONTOUR_LAST_CONTRACT_STALE',
      mutate: ({ regions }) => { regions[0].regionClass = 'r04-divergent-class'; },
    },
    {
      label: 'semantic authority divergent',
      code: 'CONTOUR_LAST_CONTRACT_STALE',
      mutate: ({ semanticResult }) => {
        semanticResult.assessments.forEach(item => { item.confidence = 0.5; });
        Object.values(semanticResult.byRegionId).forEach(item => { item.confidence = 0.5; });
      },
    },
    {
      label: 'dependency cycle',
      code: 'CONTOUR_LAST_DEPENDENCY_CYCLE',
      mutate: ({ plan }) => {
        const outline = plan.proposals.find(item => item.proposedEmbroideryRole === 'outer_outline');
        plan.proposals.find(item => item.id === outline.dependencyIds[0]).dependencyIds.push(outline.id);
      },
    },
    {
      label: 'self dependency',
      code: 'CONTOUR_LAST_SELF_DEPENDENCY',
      mutate: ({ plan }) => {
        const outline = plan.proposals.find(item => item.proposedEmbroideryRole === 'outer_outline');
        outline.dependencyIds.push(outline.id);
      },
    },
    {
      label: 'unknown dependency',
      code: 'CONTOUR_LAST_UNKNOWN_DEPENDENCY',
      mutate: ({ plan }) => {
        plan.proposals.find(item => item.proposedEmbroideryRole === 'outer_outline')
          .dependencyIds.push('proposal:r04-unknown');
      },
    },
  ];

  it('blocks an invalid A/B source through planning, materialization and compilation', () => {
    const run = runReference('C8', controlledC1With(hatchEvidenceConfig([], {
      hatchEvidenceProfile: 'future',
    })));
    expect(run.proposalPlan.valid).toBe(false);
    expect(run.proposalPlan.errors.map(error => error.code)).toContain(CROSS_PHASE_SOURCE_INVALID);
    expect(run.proposalPlan.metadata).not.toHaveProperty('hatchOverlapEvaluatorInvoked');
    expect(run.proposalPlan).not.toHaveProperty('hatchOverlapTrace');
    [
      run.objectDraftMaterialization,
      run.threadedObjectMaterialization,
      run.technicalPlan,
      run.sequencePlan,
      run.physicalPlan,
      run.canonicalCompilation,
    ].forEach(result => {
      expect(result.valid).toBe(false);
      expect(result.errors.map(error => error.code)).toContain(CROSS_PHASE_SOURCE_INVALID);
    });
    expect(run.objectDraftMaterialization.drafts).toHaveLength(0);
    expect(run.objectDraftMaterialization.decisions).toHaveLength(0);
    expect(run.threadedObjectMaterialization.objects).toHaveLength(0);
    expect(run.technicalPlan.specifications).toHaveLength(0);
    expect(run.sequencePlan.executionSteps).toHaveLength(0);
    expect(run.physicalPlan.objectPaths).toHaveLength(0);
    expect(run.physicalPlan.summary.physicalPointCount).toBe(0);
    expect(run.canonicalCompilation.commands).toHaveLength(0);
  });

  it.each(mutationCases)('rejects $label against current authority', ({ code, mutate }) => {
    const validation = validateMutatedPlan(runReference('C8', CONTROLLED_C1_CONFIG), mutate);
    expect(validation.valid).toBe(false);
    expect(validation.errors.map(error => error.code)).toContain(code);
  });

  it('blocks an ambiguous multi-contour component atomically', () => {
    const plan = buildAmbiguousMultiContourPlan();
    expect(plan.valid).toBe(false);
    expect(plan.errors.map(error => error.code))
      .toContain('CONTOUR_LAST_MULTIPLE_CONTOUR_ASSOCIATION_AMBIGUOUS');
    expect(plan.hatchOverlapTrace.applied).toBe(false);
    expect(plan.hatchOverlapTrace.evaluations.every(item => item.applied === false)).toBe(true);
  });

  it('preserves the root cause downstream and emits zero physical or canonical output', () => {
    const run = runReference('C8', CONTROLLED_C1_CONFIG);
    const chain = invalidDownstreamChain(run, plan => {
      plan.proposals.find(item => item.proposedEmbroideryRole === 'outer_outline').dependencyIds = [];
    });
    Object.values(chain).forEach(result => {
      expect(result.valid).toBe(false);
      expect(result.errors.map(error => error.code))
        .toContain('CONTOUR_LAST_REQUIRED_DEPENDENCY_MISSING');
    });
    expect(chain.review.decisions).toHaveLength(0);
    expect(chain.drafts.drafts).toHaveLength(0);
    expect(chain.objects.objects).toHaveLength(0);
    expect(chain.technical.specifications).toHaveLength(0);
    expect(chain.sequence.executionSteps).toHaveLength(0);
    expect(chain.physical.objectPaths).toHaveLength(0);
    expect(chain.physical.summary.physicalPointCount).toBe(0);
    expect(chain.canonical.commands).toHaveLength(0);
  });
});
