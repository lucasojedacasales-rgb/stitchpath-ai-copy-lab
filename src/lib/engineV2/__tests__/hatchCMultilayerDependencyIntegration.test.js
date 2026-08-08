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
import {
  createEmbroideryObjectV2,
  createRegionV2,
  createThreadDefinitionV2,
} from '../model.js';
import { buildEmbroideryObjectProposalPlan } from '../planning/objectPlanningPipeline.js';
import { COLOR_GROUP_HEURISTIC_RULE_ID } from '../rules/hatchEvidence/colorGroupHeuristic.js';
import { CONTOUR_LAST_RULE_ID } from '../rules/hatchEvidence/contourLast.js';
import {
  MULTILAYER_DEPENDENCY_CLAIM_BOUNDARY,
  MULTILAYER_DEPENDENCY_CONTRACT_VERSION,
  MULTILAYER_DEPENDENCY_RULE_ID,
  MULTILAYER_DEPENDENCY_TRACE_VERSION,
  evaluateMultilayerDependencyGuard,
} from '../rules/hatchEvidence/multilayerDependency.js';
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
import { buildGlobalSequencePlan } from '../sequencing/globalSequencePlanner.js';
import {
  resolveSequencePlanningConfig,
  validateSequencePlanningConfig,
} from '../sequencing/sequencePlanningConfig.js';
import { validateGlobalSequencePlan } from '../sequencing/sequencePlanningValidation.js';
import { buildMachineIndependentPhysicalStitchPlan } from '../stitchGeneration/physicalStitchPipeline.js';
import { buildTechnicalEmbroideryPlan } from '../technical/technicalPlanningPipeline.js';
import { materializeThreadedEmbroideryObjects } from '../threads/finalObjectMaterializer.js';

const clone = value => structuredClone(value);
const codes = result => result.errors.map(error => error.code);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function cConfig({ c1 = false, c2 = false, c3 = false, ...rest } = {}) {
  return {
    hatchOverlapProfile: 'hatch-c-experimental',
    hatchOverlapRuleFlags: {
      [CONTOUR_LAST_RULE_ID]: c1,
      [COLOR_GROUP_HEURISTIC_RULE_ID]: c2,
      [MULTILAYER_DEPENDENCY_RULE_ID]: c3,
    },
    ...rest,
  };
}

function executionLayersFor(objects) {
  const byId = new Map(objects.map(object => [object.id, object]));
  const emitted = new Set();
  const layers = [];
  while (emitted.size < objects.length) {
    const ready = [...byId.keys()].filter(id =>
      !emitted.has(id)
      && (byId.get(id).dependencyIds || []).every(dependencyId =>
        !byId.has(dependencyId) || emitted.has(dependencyId))).sort();
    if (!ready.length) break;
    layers.push(ready);
    ready.forEach(id => emitted.add(id));
  }
  return layers;
}

function materializationWithObjects(materialization, objects) {
  const result = clone(materialization);
  result.objects = objects;
  result.byObjectId = Object.fromEntries(objects.map(object => [object.id, object]));
  result.byRegionId = Object.fromEntries(objects.map(object => [object.regionId, object]));
  result.byThreadId = Object.fromEntries(result.threads.map(thread => [
    thread.id,
    objects.filter(object => object.threadId === thread.id),
  ]));
  result.executionLayers = executionLayersFor(objects);
  result.summary.finalObjectCount = objects.length;
  result.summary.dependencyCount = objects.reduce(
    (sum, object) => sum + object.dependencyIds.length,
    0,
  );
  result.summary.dependencyCycleCount = result.executionLayers.flat().length === objects.length
    ? 0
    : objects.length - result.executionLayers.flat().length;
  return result;
}

function downstream(
  run,
  sequencePlan = run.sequencePlan,
  materialization = run.threadedObjectMaterialization,
  technicalPlan = run.technicalPlan,
  regions = run.ingestion.regions,
) {
  const physicalPlan = buildMachineIndependentPhysicalStitchPlan({
    regions,
    threadedObjectMaterialization: materialization,
    technicalPlan,
    sequencePlan,
  });
  const canonicalCompilation = compileCanonicalCommandStream({
    regions,
    threadedObjectMaterialization: materialization,
    technicalPlan,
    sequencePlan,
    physicalPlan,
  });
  return { physicalPlan, canonicalCompilation };
}

function buildC12({
  c1 = false,
  c2 = false,
  c3 = false,
  reverseInput = false,
  algorithm = 'auto',
  mutateDrafts = null,
  mutateObjects = null,
} = {}) {
  const sourceRegions = createHatchCReferenceRegions('C12');
  if (reverseInput) sourceRegions.reverse();
  const ingestion = ingestV1RegionsToRegionGraphV2(sourceRegions, {
    coordinateSpace: 'millimeter',
    designWidthMm: HATCH_C_REFERENCE_DESIGN_MM.width,
    designHeightMm: HATCH_C_REFERENCE_DESIGN_MM.height,
  });
  const semanticResult = createHatchCReferenceSemanticResult(ingestion.regions, 'C12');
  const config = cConfig({ c1, c2, c3, algorithm });
  const planningOverlapConfig = cConfig({ c1 });
  const technicalConfig = { tatami: { minimumAreaMm2: 5 } };
  const proposalPlan = buildEmbroideryObjectProposalPlan({
    regions: ingestion.regions,
    graph: ingestion.graph,
    semanticResult,
    config: {
      designWidthMm: HATCH_C_REFERENCE_DESIGN_MM.width,
      designHeightMm: HATCH_C_REFERENCE_DESIGN_MM.height,
      minimumTatamiAreaMm2: 5,
      ...planningOverlapConfig,
    },
    technicalConfig,
  });
  let objectDraftMaterialization = materializeEmbroideryObjectDrafts({
    regions: ingestion.regions,
    graph: ingestion.graph,
    semanticResult,
    proposalPlan,
  });
  if (mutateDrafts) {
    objectDraftMaterialization = clone(objectDraftMaterialization);
    mutateDrafts(objectDraftMaterialization.drafts);
    objectDraftMaterialization.executionLayers = executionLayersFor(
      objectDraftMaterialization.drafts,
    );
  }
  let threadedObjectMaterialization = materializeThreadedEmbroideryObjects({
    regions: ingestion.regions,
    objectDraftMaterialization,
  });
  if (mutateObjects) {
    const objects = clone(threadedObjectMaterialization.objects);
    mutateObjects(objects);
    threadedObjectMaterialization = materializationWithObjects(
      threadedObjectMaterialization,
      objects,
    );
  }
  const technicalPlan = buildTechnicalEmbroideryPlan({
    regions: ingestion.regions,
    threadedObjectMaterialization,
    config: technicalConfig,
  });
  const sequencePlan = buildGlobalSequencePlan({
    regions: ingestion.regions,
    threadedObjectMaterialization,
    technicalPlan,
    config,
  });
  const run = {
    sourceRegions,
    ingestion,
    semanticResult,
    proposalPlan,
    objectDraftMaterialization,
    threadedObjectMaterialization,
    technicalPlan,
    sequencePlan,
  };
  return { ...run, ...downstream(run) };
}

function objectByRegion(run, suffix) {
  return run.threadedObjectMaterialization.objects.find(object =>
    object.regionId.endsWith(suffix));
}

function assertAtomicBlock(run, expectedCode) {
  expect(run.sequencePlan.valid).toBe(false);
  expect(codes(run.sequencePlan)).toContain(expectedCode);
  expect(run.sequencePlan.multilayerDependencyContract).toBeNull();
  expect(run.sequencePlan.multilayerDependencyTrace).toMatchObject({
    active: true,
    evaluatorInvoked: true,
    applied: false,
    status: 'blocked',
    ...MULTILAYER_DEPENDENCY_CLAIM_BOUNDARY,
  });
  expect(run.sequencePlan.executionSteps).toEqual([]);
  expect(run.sequencePlan.selectedEntryExitPairs).toEqual([]);
  expect(run.sequencePlan.transitions).toEqual([]);
  expect(run.sequencePlan.threadBlocks).toEqual([]);
  expect(run.physicalPlan.valid).toBe(false);
  expect(run.physicalPlan.objectPaths).toEqual([]);
  expect(run.physicalPlan.summary).toMatchObject({
    physicalPointCount: 0,
    physicalStitchCount: 0,
    physicalSubpathCount: 0,
  });
  expect(run.canonicalCompilation.valid).toBe(false);
  expect(run.canonicalCompilation.commands).toEqual([]);
  expect(run.canonicalCompilation.summary.commandCount).toBe(0);
}

function operationalSnapshot(run) {
  return {
    objects: run.threadedObjectMaterialization.objects,
    specifications: run.technicalPlan.specifications,
    dispositions: run.sequencePlan.dispositions,
    selections: run.sequencePlan.selectedEntryExitPairs,
    steps: run.sequencePlan.executionSteps,
    transitions: run.sequencePlan.transitions,
    threadBlocks: run.sequencePlan.threadBlocks,
    executionLayers: run.sequencePlan.executionLayers,
    physicalPaths: run.physicalPlan.objectPaths,
    commands: run.canonicalCompilation.commands,
    physicalHash: hash(run.physicalPlan.objectPaths),
    canonicalHash: hash(run.canonicalCompilation.commands),
  };
}

function evaluatorInput(run, {
  objects = run.threadedObjectMaterialization.objects,
  regions = run.ingestion.regions,
  executionSteps = run.sequencePlan.executionSteps,
  executionLayers = run.sequencePlan.executionLayers,
} = {}) {
  return {
    regions,
    objects,
    executionSteps,
    executionLayers,
    config: cConfig({ c3: true }),
  };
}

function nestedSquare(inset, left = 0, width = 1) {
  const x1 = left + inset * width;
  const x2 = left + (1 - inset) * width;
  return [
    { x: x1, y: inset },
    { x: x2, y: inset },
    { x: x2, y: 1 - inset },
    { x: x1, y: 1 - inset },
  ];
}

function lineage(regionId, role) {
  const proposalId = `proposal:${regionId}:${role}`;
  const draftId = `draft:${proposalId}`;
  const reviewDecisionId = `review:${proposalId}`;
  return {
    proposalId,
    draftId,
    reviewDecisionId,
    threadAssignmentId: `thread-assignment:${draftId}`,
    sourceRegion: { reviewDecisionId },
  };
}

function makeSyntheticChain(levels, {
  prefix = 'synthetic',
  left = 0,
  width = 1,
  objectLeftMm = 0,
  objectWidthMm = 40,
} = {}) {
  const objects = [];
  const regions = [];
  for (let index = 0; index < levels; index += 1) {
    const role = index === 0 ? 'base_fill' : 'foreground_fill';
    const semanticRole = index === 0 ? 'primary_shape' : 'secondary_shape';
    const regionId = `${prefix}-region-${String(index + 1).padStart(2, '0')}`;
    const id = `object:proposal:${regionId}:${role}`;
    const inset = 0.03 + index * 0.07;
    const objectInset = 1 + index * 3;
    regions.push(createRegionV2({
      id: regionId,
      geometry: nestedSquare(inset, left, width),
      holes: [],
      visualColor: index % 2 ? '#eeeeee' : '#228844',
      source: { fixture: 'hatch-c3-synthetic' },
    }));
    objects.push(createEmbroideryObjectV2({
      id,
      regionId,
      role,
      stitchType: 'tatami',
      geometry: [
        { x: objectLeftMm + objectInset, y: objectInset },
        { x: objectLeftMm + objectWidthMm - objectInset, y: objectInset },
        {
          x: objectLeftMm + objectWidthMm - objectInset,
          y: objectWidthMm - objectInset,
        },
        { x: objectLeftMm + objectInset, y: objectWidthMm - objectInset },
      ],
      holes: [],
      visualColor: index % 2 ? '#eeeeee' : '#228844',
      layer: 99 - index,
      dependencyIds: index === 0 ? [] : [objects[index - 1].id],
      threadId: `thread:c3:${index % 2}`,
      entryCandidates: [],
      exitCandidates: [],
      parameters: {
        planning: { semanticRole },
        technicalIntent: { geometryType: 'region_polygon' },
        deferred: {
          threadAssignment: false,
          stitchGeneration: true,
          underlayPlanning: true,
          fillAngleSelection: true,
          densitySelection: true,
          pullCompensation: true,
          entryExitPlanning: true,
          globalSequencing: true,
          machineAdaptation: true,
        },
      },
      confidence: 0.98,
      source: lineage(regionId, role),
    }));
  }
  return { objects, regions };
}

function syntheticFixture(chains) {
  const objects = chains.flatMap(chain => chain.objects);
  const regions = chains.flatMap(chain => chain.regions);
  const threadIds = uniqueSorted(objects.map(object => object.threadId));
  const threads = threadIds.map(threadId => createThreadDefinitionV2({
    id: threadId,
    visualColorSamples: ['#228844'],
    machineColor: {
      hex: '#228844',
      name: threadId,
      manufacturer: null,
      code: null,
      catalogEntryId: threadId.replace('thread:', ''),
    },
    colorFamily: 'synthetic',
    source: { fixture: 'hatch-c3-synthetic' },
    confidence: 1,
  }));
  const threadedObjectMaterialization = {
    version: '2-threaded-object-materialization',
    objects,
    threads,
    byObjectId: Object.fromEntries(objects.map(object => [object.id, object])),
    byRegionId: Object.fromEntries(objects.map(object => [object.regionId, object])),
    byThreadId: Object.fromEntries(threads.map(thread => [
      thread.id,
      objects.filter(object => object.threadId === thread.id),
    ])),
    executionLayers: executionLayersFor(objects),
    valid: true,
    errors: [],
    warnings: [],
    summary: {
      finalObjectCount: objects.length,
      dependencyCount: objects.reduce(
        (sum, object) => sum + object.dependencyIds.length,
        0,
      ),
      dependencyCycleCount: 0,
    },
    metadata: { inputMutationsDetected: false },
  };
  const technicalPlan = buildTechnicalEmbroideryPlan({
    regions,
    threadedObjectMaterialization,
  });
  return { regions, objects, threads, threadedObjectMaterialization, technicalPlan };
}

function buildSynthetic(chains, config = cConfig({ c3: true })) {
  const fixture = syntheticFixture(chains);
  const sequencePlan = buildGlobalSequencePlan({
    regions: fixture.regions,
    threadedObjectMaterialization: fixture.threadedObjectMaterialization,
    technicalPlan: fixture.technicalPlan,
    config,
  });
  return { ...fixture, sequencePlan };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

describe('Hatch C3 configuration and partial registry integration', () => {
  it('registers exactly three independent Hatch C flags, all OFF by default', () => {
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

  it.each(Array.from({ length: 8 }, (_, mask) => ({
    c1: Boolean(mask & 1),
    c2: Boolean(mask & 2),
    c3: Boolean(mask & 4),
  })))('resolves C1=$c1 C2=$c2 C3=$c3 independently', flags => {
    const resolved = resolveHatchOverlapIntegrationConfig(cConfig(flags));
    expect(resolved.ruleFlags).toEqual({
      [CONTOUR_LAST_RULE_ID]: flags.c1,
      [COLOR_GROUP_HEURISTIC_RULE_ID]: flags.c2,
      [MULTILAYER_DEPENDENCY_RULE_ID]: flags.c3,
    });
    expect(resolved.enabledRuleIds).toEqual(HATCH_OVERLAP_RULE_IDS.filter(ruleId =>
      resolved.ruleFlags[ruleId]));
  });

  it('rejects legacy activation, non-boolean values, unknown flags and unknown fields', () => {
    expect(codes(validateHatchOverlapIntegrationConfig({
      hatchOverlapProfile: 'legacy',
      hatchOverlapRuleFlags: { [MULTILAYER_DEPENDENCY_RULE_ID]: true },
    }))).toContain('HATCH_OVERLAP_RULE_FLAG_REQUIRES_EXPERIMENTAL_PROFILE');
    expect(codes(validateHatchOverlapIntegrationConfig(cConfig({ c3: 'yes' }))))
      .toContain('INVALID_HATCH_OVERLAP_RULE_FLAG_VALUE');
    expect(codes(validateHatchOverlapIntegrationConfig({
      ...cConfig({ c3: true }),
      hatchOverlapRuleFlags: { 'MULTILAYER-FUTURE-001': true },
    }))).toContain('UNKNOWN_HATCH_OVERLAP_RULE_FLAG');
    expect(codes(validateHatchOverlapIntegrationConfig({
      ...cConfig({ c3: true }),
      hatchOverlapFuture: true,
    }))).toContain('UNKNOWN_HATCH_OVERLAP_CONFIG_FIELD');
  });

  it('preserves raw, resolved and repeatedly reused configuration idempotently', () => {
    const raw = {
      extras: {
        hatchOverlapProfile: 'legacy',
        hatchOverlapRuleFlags: { [MULTILAYER_DEPENDENCY_RULE_ID]: false },
        nestedOnly: true,
      },
      ...cConfig({ c3: true }),
      topLevelOnly: true,
    };
    const first = resolveSequencePlanningConfig(raw);
    const second = resolveSequencePlanningConfig(first);
    const third = resolveSequencePlanningConfig(second);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(first.extras).toMatchObject({
      ...cConfig({ c3: true }),
      nestedOnly: true,
      topLevelOnly: true,
    });
    expect(first.extras).not.toHaveProperty('extras');
    expect(validateSequencePlanningConfig(first).valid).toBe(true);
  });

  it('activates only C1-C3 while the other five C rules and D-F stay inactive', () => {
    const cRules = HATCH_EVIDENCE_RULES.filter(rule => rule.phase === 'C_Solapes');
    HATCH_OVERLAP_RULE_IDS.forEach(ruleId => expect(
      cRules.find(rule => rule.id === ruleId).activatedInProfiles,
    ).toEqual(['hatch-c-experimental']));
    expect(cRules.filter(rule => !HATCH_OVERLAP_RULE_IDS.includes(rule.id))
      .every(rule => rule.activatedInProfiles.length === 0)).toBe(true);
    expect(HATCH_EVIDENCE_RULES.filter(rule =>
      ['D_Técnicas', 'E_Telas', 'F_Escalado'].includes(rule.phase))
      .every(rule => rule.activatedInProfiles.length === 0)).toBe(true);
    expect(HATCH_EVIDENCE_REGISTRY.partialIntegrations[0].ruleIds)
      .toEqual(HATCH_OVERLAP_RULE_IDS);
    expect(validateHatchEvidenceRegistry().valid).toBe(true);
  });
});

describe('Hatch C3 C12 canonical precedence-only accreditation', () => {
  it('accredits the exact green-to-white-to-orange core and delegates black to C1', () => {
    const run = buildC12({ c3: true });
    const green = objectByRegion(run, 'green-fill');
    const white = objectByRegion(run, 'white-fill');
    const orange = objectByRegion(run, 'orange-detail');
    const black = objectByRegion(run, 'black-outline');
    expect(run.sequencePlan.errors).toEqual([]);
    expect(run.sequencePlan.valid).toBe(true);
    expect(run.sequencePlan.multilayerDependencyContract).toMatchObject({
      version: MULTILAYER_DEPENDENCY_CONTRACT_VERSION,
      ruleId: MULTILAYER_DEPENDENCY_RULE_ID,
      status: 'validated',
      ...MULTILAYER_DEPENDENCY_CLAIM_BOUNDARY,
      canonicalDirectEdges: [
        { fromObjectId: green.id, toObjectId: white.id },
        { fromObjectId: white.id, toObjectId: orange.id },
      ],
      receivedDirectEdges: [
        { fromObjectId: green.id, toObjectId: white.id },
        { fromObjectId: white.id, toObjectId: orange.id },
      ],
      canonicalExecutionLayers: [[green.id], [white.id], [orange.id]],
      claims: [{ participantObjectIds: [green.id, white.id, orange.id] }],
      auxiliaryParticipants: [{
        objectId: black.id,
        delegatedRuleId: CONTOUR_LAST_RULE_ID,
        dependencyAccreditedByC3: false,
        c1RuleEnabled: false,
      }],
    });
    expect(run.sequencePlan.multilayerDependencyContract.transitiveClosure)
      .toContainEqual({ fromObjectId: green.id, toObjectId: orange.id, distance: 2 });
    expect(run.sequencePlan.multilayerDependencyTrace).toMatchObject({
      version: MULTILAYER_DEPENDENCY_TRACE_VERSION,
      active: true,
      evaluatorInvoked: true,
      applied: true,
      status: 'validated',
      claimCount: 1,
      ...MULTILAYER_DEPENDENCY_CLAIM_BOUNDARY,
    });
    expect(run.sequencePlan.metadata.multilayerDependencyEvaluatorInvoked).toBe(true);
    expect(validateGlobalSequencePlan(
      run.sequencePlan,
      run.threadedObjectMaterialization,
      run.technicalPlan,
      run.ingestion.regions,
    ).valid).toBe(true);
  });

  it.each(['exact', 'beam'])('keeps %s scheduling compatible with the canonical DAG', algorithm => {
    const run = buildC12({ c3: true, algorithm });
    expect(run.sequencePlan.valid).toBe(true);
    expect(run.sequencePlan.multilayerDependencyContract.executionOrder)
      .toEqual(run.sequencePlan.executionSteps
        .map(step => step.objectId)
        .filter(id => run.sequencePlan.multilayerDependencyContract
          .claims[0].participantObjectIds.includes(id)));
  });

  it('is deterministic with reversed non-topological input IDs and repeated execution', () => {
    const first = buildC12({ c3: true, reverseInput: true });
    const second = buildC12({ c3: true, reverseInput: true });
    expect(first.sequencePlan.multilayerDependencyContract)
      .toEqual(second.sequencePlan.multilayerDependencyContract);
    expect(first.sequencePlan.multilayerDependencyTrace)
      .toEqual(second.sequencePlan.multilayerDependencyTrace);
    expect(operationalSnapshot(first)).toEqual(operationalSnapshot(second));
  });

  it.each(Array.from({ length: 8 }, (_, mask) => ({
    c1: Boolean(mask & 1),
    c2: Boolean(mask & 2),
    c3: Boolean(mask & 4),
  })))('keeps independent runtime state for C1=$c1 C2=$c2 C3=$c3', flags => {
    const run = buildC12(flags);
    expect(run.sequencePlan.valid).toBe(true);
    expect(ownState(run.proposalPlan, 'hatchOverlapTrace')).toBe(flags.c1);
    expect(ownState(run.sequencePlan, 'colorGroupHeuristicContract')).toBe(flags.c2);
    expect(ownState(run.sequencePlan, 'colorGroupHeuristicEvaluation')).toBe(flags.c2);
    expect(ownState(run.sequencePlan, 'colorGroupHeuristicIntegrationMarker'))
      .toBe(flags.c2);
    expect(ownState(run.sequencePlan, 'colorGroupHeuristicTrace')).toBe(flags.c2);
    expect(ownState(run.sequencePlan.metadata, 'colorGroupHeuristicEvaluatorInvoked'))
      .toBe(flags.c2);
    expect(ownState(run.sequencePlan, 'multilayerDependencyContract')).toBe(flags.c3);
    expect(ownState(run.sequencePlan, 'multilayerDependencyEvaluation')).toBe(flags.c3);
    expect(ownState(run.sequencePlan, 'multilayerDependencyIntegrationMarker'))
      .toBe(flags.c3);
    expect(ownState(run.sequencePlan, 'multilayerDependencyTrace')).toBe(flags.c3);
    expect(ownState(run.sequencePlan.metadata, 'multilayerDependencyEvaluatorInvoked'))
      .toBe(flags.c3);
    if (flags.c3) {
      expect(run.sequencePlan.multilayerDependencyContract.auxiliaryParticipants[0])
        .toMatchObject({
          delegatedRuleId: CONTOUR_LAST_RULE_ID,
          dependencyAccreditedByC3: false,
          c1RuleEnabled: flags.c1,
        });
    }
  });

  it.each(['auto', 'exact', 'beam'])('preserves complete ON/OFF operational and physical parity under %s', algorithm => {
    const off = buildC12({ c3: false, algorithm });
    const on = buildC12({ c3: true, algorithm });
    expect(on.physicalPlan.errors).toEqual([]);
    expect(on.canonicalCompilation.errors).toEqual([]);
    expect(operationalSnapshot(on)).toEqual(operationalSnapshot(off));
    expect(on.physicalPlan.valid).toBe(true);
    expect(on.canonicalCompilation.valid).toBe(true);
  });

  it('does not create or require an outline edge when C1 is OFF', () => {
    const run = buildC12({
      c1: false,
      c3: true,
      mutateObjects(objects) {
        objects.find(object => object.regionId.endsWith('black-outline')).dependencyIds = [];
      },
    });
    expect(run.sequencePlan.valid).toBe(true);
    expect(run.sequencePlan.multilayerDependencyTrace.status).toBe('validated');
    expect(run.sequencePlan.multilayerDependencyContract.auxiliaryParticipants[0])
      .toMatchObject({
        delegatedRuleId: CONTOUR_LAST_RULE_ID,
        dependencyAccreditedByC3: false,
        c1RuleEnabled: false,
      });
  });

  it('does not count an auxiliary contour toward the three-core minimum', () => {
    const run = buildC12({ c3: true });
    const objects = clone(run.threadedObjectMaterialization.objects)
      .filter(object => !object.regionId.endsWith('orange-detail'));
    const result = evaluateMultilayerDependencyGuard(evaluatorInput(run, {
      objects,
      executionSteps: [],
      executionLayers: [],
    }));
    expect(result.status).toBe('not_applicable');
    expect(result.contract.claims).toEqual([]);
    expect(result.contract.auxiliaryParticipants).toHaveLength(1);
  });
});

function ownState(value, field) {
  return Boolean(value) && Object.hasOwn(value, field);
}

describe('Hatch C3 blocking C12 reproduction and dependency matrix', () => {
  it('blocks the white-to-green edge removed during draft-to-object translation', () => {
    const run = buildC12({
      c3: true,
      mutateDrafts(drafts) {
        drafts.find(draft => draft.regionId.endsWith('white-fill')).dependencyIds = [];
      },
    });
    assertAtomicBlock(run, 'MULTILAYER_REQUIRED_DEPENDENCY_MISSING');
  });

  it('blocks the same edge removed directly from the current final object', () => {
    const run = buildC12({
      c3: true,
      mutateObjects(objects) {
        objects.find(object => object.regionId.endsWith('white-fill')).dependencyIds = [];
      },
    });
    assertAtomicBlock(run, 'MULTILAYER_REQUIRED_DEPENDENCY_MISSING');
  });

  it('preserves the exact prior behavior when the same removable edge reaches C3 OFF', () => {
    const run = buildC12({
      c3: false,
      mutateObjects(objects) {
        objects.find(object => object.regionId.endsWith('white-fill')).dependencyIds = [];
      },
    });
    expect(run.sequencePlan.valid).toBe(true);
    expect(run.sequencePlan).not.toHaveProperty('multilayerDependencyContract');
    expect(run.sequencePlan.metadata)
      .not.toHaveProperty('multilayerDependencyEvaluatorInvoked');
    expect(run.physicalPlan.valid).toBe(true);
    expect(run.canonicalCompilation.valid).toBe(true);
  });

  it('propagates the C3 root once, flatly, deterministically and idempotently', () => {
    const buildBlocked = () => buildC12({
      c3: true,
      mutateObjects(objects) {
        objects.find(object => object.regionId.endsWith('white-fill')).dependencyIds = [];
      },
    });
    const first = buildBlocked();
    const second = buildBlocked();
    const stages = [
      first.sequencePlan,
      first.physicalPlan,
      first.canonicalCompilation,
    ];
    stages.forEach(stage => {
      expect(codes(stage).filter(code =>
        code === 'MULTILAYER_REQUIRED_DEPENDENCY_MISSING')).toHaveLength(1);
      expect(JSON.stringify(stage.errors)).not.toMatch(
        /"evidence":\s*\{[^}]*"errors":/u,
      );
    });
    expect(first.sequencePlan.errors).toEqual(second.sequencePlan.errors);
    expect(first.physicalPlan.errors).toEqual(second.physicalPlan.errors);
    expect(first.canonicalCompilation.errors).toEqual(second.canonicalCompilation.errors);
    const validation = validateGlobalSequencePlan(
      first.sequencePlan,
      first.threadedObjectMaterialization,
      first.technicalPlan,
      first.ingestion.regions,
    );
    expect(codes(validation)).not.toContain('MULTILAYER_EVALUATION_STALE');
    expect(codes(validation)).not.toContain('MULTILAYER_TRACE_STALE');
  });

  const dependencyMutations = [
    {
      label: 'required edge missing',
      code: 'MULTILAYER_REQUIRED_DEPENDENCY_MISSING',
      mutate(objects) {
        objects.find(object => object.regionId.endsWith('white-fill')).dependencyIds = [];
      },
    },
    {
      label: 'required edge inverted',
      code: 'MULTILAYER_DEPENDENCY_DIRECTION_MISMATCH',
      mutate(objects) {
        const green = objects.find(object => object.regionId.endsWith('green-fill'));
        const white = objects.find(object => object.regionId.endsWith('white-fill'));
        white.dependencyIds = [];
        green.dependencyIds = [white.id];
      },
    },
    {
      label: 'unexpected transitive direct edge',
      code: 'MULTILAYER_UNEXPECTED_DEPENDENCY',
      mutate(objects) {
        const green = objects.find(object => object.regionId.endsWith('green-fill'));
        const orange = objects.find(object => object.regionId.endsWith('orange-detail'));
        orange.dependencyIds.push(green.id);
      },
    },
    {
      label: 'self edge',
      code: 'MULTILAYER_SELF_DEPENDENCY',
      mutate(objects) {
        const white = objects.find(object => object.regionId.endsWith('white-fill'));
        white.dependencyIds.push(white.id);
      },
    },
    {
      label: 'unknown edge',
      code: 'MULTILAYER_UNKNOWN_DEPENDENCY',
      mutate(objects) {
        const white = objects.find(object => object.regionId.endsWith('white-fill'));
        white.dependencyIds.push('object:unknown-c3');
      },
    },
    {
      label: 'duplicate edge',
      code: 'MULTILAYER_UNEXPECTED_DEPENDENCY',
      mutate(objects) {
        const white = objects.find(object => object.regionId.endsWith('white-fill'));
        white.dependencyIds.push(white.dependencyIds[0]);
      },
    },
    {
      label: 'cycle',
      code: 'MULTILAYER_DEPENDENCY_CYCLE',
      mutate(objects) {
        const green = objects.find(object => object.regionId.endsWith('green-fill'));
        const orange = objects.find(object => object.regionId.endsWith('orange-detail'));
        green.dependencyIds = [orange.id];
      },
    },
  ];

  it.each(dependencyMutations)('blocks $label atomically', ({ code, mutate }) => {
    const run = buildC12({ c3: true, mutateObjects: mutate });
    assertAtomicBlock(run, code);
  });

  it('ignores a direct dependency from a valid claim to a contains-disconnected component', () => {
    const base = buildC12({ c3: true });
    const objects = clone(base.threadedObjectMaterialization.objects);
    const regions = clone(base.ingestion.regions);
    const disconnected = makeSyntheticChain(1, {
      prefix: 'disconnected-c3',
      left: 0,
      width: 0.2,
      objectLeftMm: 200,
    });
    objects.push(disconnected.objects[0]);
    regions.push(disconnected.regions[0]);
    const orange = objects.find(object => object.regionId.endsWith('orange-detail'));
    orange.dependencyIds.push(disconnected.objects[0].id);
    const result = evaluateMultilayerDependencyGuard(evaluatorInput(base, {
      objects,
      regions,
    }));
    expect(result.status).toBe('validated');
    expect(codes(result)).not.toContain('MULTILAYER_COMPONENT_MISMATCH');
    expect(result.contract.receivedDirectEdges).not.toContainEqual({
      fromObjectId: disconnected.objects[0].id,
      toObjectId: orange.id,
    });
  });
});

describe('Hatch C3 authoritative participants, topology and applicability', () => {
  const authorityMutations = [
    {
      label: 'missing own participant ID',
      code: 'MULTILAYER_PARTICIPANT_ID_INVALID',
      mutate(objects) { delete objects[0].id; },
    },
    {
      label: 'empty participant ID',
      code: 'MULTILAYER_PARTICIPANT_ID_INVALID',
      mutate(objects) { objects[0].id = ''; },
    },
    {
      label: 'duplicate participant ID',
      code: 'MULTILAYER_DUPLICATE_PARTICIPANT_ID',
      mutate(objects) { objects.push(clone(objects[0])); },
    },
    {
      label: 'altered participant ID',
      code: 'MULTILAYER_PARTICIPANT_ID_INVALID',
      mutate(objects) { objects[0].id = 'object:altered-c3'; },
    },
    {
      label: 'altered regionId',
      code: 'MULTILAYER_AUTHORITATIVE_REGIONS_MISSING',
      mutate(objects) { objects[1].regionId = 'region:missing-c3'; },
    },
    {
      label: 'empty regionId',
      code: 'MULTILAYER_REGION_MISSING',
      mutate(objects) { objects[1].regionId = ''; },
    },
    {
      label: 'missing embroidery role',
      code: 'MULTILAYER_ROLE_CONTRADICTION',
      mutate(objects) { delete objects[1].role; },
    },
    {
      label: 'missing proposal lineage',
      code: 'MULTILAYER_AUTHORITATIVE_INPUTS_MISSING',
      mutate(objects) { delete objects[1].source.proposalId; },
    },
    {
      label: 'contradictory draft lineage',
      code: 'MULTILAYER_PARTICIPANT_ID_INVALID',
      mutate(objects) { objects[1].source.draftId = 'draft:contradictory-c3'; },
    },
    {
      label: 'missing semantic role',
      code: 'MULTILAYER_SEMANTIC_ROLE_INVALID',
      mutate(objects) { delete objects[1].parameters.planning.semanticRole; },
    },
    {
      label: 'empty semantic role',
      code: 'MULTILAYER_SEMANTIC_ROLE_INVALID',
      mutate(objects) { objects[1].parameters.planning.semanticRole = ''; },
    },
    {
      label: 'non-text semantic role',
      code: 'MULTILAYER_SEMANTIC_ROLE_INVALID',
      mutate(objects) { objects[1].parameters.planning.semanticRole = { value: 'secondary_shape' }; },
    },
    {
      label: 'semantic role outside catalog',
      code: 'MULTILAYER_SEMANTIC_ROLE_INVALID',
      mutate(objects) { objects[1].parameters.planning.semanticRole = 'future_role'; },
    },
    {
      label: 'semantic-to-embroidery role contradiction',
      code: 'MULTILAYER_ROLE_CONTRADICTION',
      mutate(objects) { objects[1].parameters.planning.semanticRole = 'dark_mark'; },
    },
    {
      label: 'invalid participant geometry',
      code: 'MULTILAYER_AUTHORITATIVE_INPUTS_MISSING',
      mutate(objects) { objects[1].geometry = [{ x: 1, y: 1 }]; },
    },
  ];

  it.each(authorityMutations)('blocks $label without coercion or defaults', ({ code, mutate }) => {
    const run = buildC12({ c3: true, mutateObjects: mutate });
    assertAtomicBlock(run, code);
  });

  it('rejects a missing current region and does not accredit equal core geometry', () => {
    const run = buildC12({ c3: true });
    const regionsMissing = clone(run.ingestion.regions);
    regionsMissing.splice(1, 1);
    const missing = evaluateMultilayerDependencyGuard(evaluatorInput(run, {
      regions: regionsMissing,
    }));
    expect(codes(missing)).toContain('MULTILAYER_AUTHORITATIVE_REGIONS_MISSING');

    const regionsEqual = clone(run.ingestion.regions);
    const green = regionsEqual.find(region => region.id.endsWith('green-fill'));
    const white = regionsEqual.find(region => region.id.endsWith('white-fill'));
    white.geometry = clone(green.geometry);
    white.holes = clone(green.holes);
    const equal = evaluateMultilayerDependencyGuard(evaluatorInput(run, {
      regions: regionsEqual,
    }));
    expect(equal.status).toBe('not_applicable');
    expect(equal.contract.claims).toEqual([]);
    expect(codes(equal)).not.toContain('MULTILAYER_COMPONENT_MISMATCH');
  });

  it.each([
    {
      label: 'touches-only topology',
      regions() {
        return [
          createRegionV2({ id: 'touch-a', geometry: nestedSquare(0, 0, 0.3), holes: [] }),
          createRegionV2({ id: 'touch-b', geometry: nestedSquare(0, 0.3, 0.3), holes: [] }),
          createRegionV2({ id: 'touch-c', geometry: nestedSquare(0, 0.6, 0.3), holes: [] }),
        ];
      },
    },
    {
      label: 'partial-overlap topology',
      regions() {
        return [
          createRegionV2({ id: 'overlap-a', geometry: nestedSquare(0, 0, 0.45), holes: [] }),
          createRegionV2({ id: 'overlap-b', geometry: nestedSquare(0, 0.3, 0.45), holes: [] }),
          createRegionV2({ id: 'overlap-c', geometry: nestedSquare(0, 0.6, 0.4), holes: [] }),
        ];
      },
    },
  ])('does not accredit $label as contains authority', ({ regions: makeRegions }) => {
    const chain = makeSyntheticChain(3);
    const regions = makeRegions();
    const objects = chain.objects.map((object, index) => {
      const role = index === 0 ? 'base_fill' : 'foreground_fill';
      const regionId = regions[index].id;
      return {
        ...object,
        id: `object:proposal:${regionId}:${role}`,
        regionId,
        dependencyIds: [],
        source: lineage(regionId, role),
      };
    });
    const result = evaluateMultilayerDependencyGuard({
      regions,
      objects,
      executionSteps: [],
      executionLayers: [],
      config: cConfig({ c3: true }),
    });
    expect(result.status).toBe('not_applicable');
    expect(result.contract.claims).toEqual([]);
  });

  it('rejects stale dependencies when a current explicit hole removes containment', () => {
    const run = buildC12({ c3: true });
    const regions = clone(run.ingestion.regions);
    const green = regions.find(region => region.id.endsWith('green-fill'));
    const black = regions.find(region => region.id.endsWith('black-outline'));
    green.holes = [clone(black.geometry)];
    const result = evaluateMultilayerDependencyGuard(evaluatorInput(run, {
      regions,
      executionSteps: [],
      executionLayers: [],
    }));
    expect(result.status).toBe('blocked');
    expect(result.contract).toBeNull();
    expect(codes(result)).toContain('MULTILAYER_COMPONENT_MISMATCH');
  });

  it.each([0, 1, 2])('returns coherent not_applicable for %i levels', levels => {
    const chain = makeSyntheticChain(levels);
    const input = levels
      ? syntheticFixture([chain])
      : {
        regions: [],
        objects: [],
        threadedObjectMaterialization: { objects: [] },
        technicalPlan: { specifications: [] },
      };
    const result = evaluateMultilayerDependencyGuard({
      regions: input.regions,
      objects: input.objects,
      executionSteps: [],
      executionLayers: [],
      config: cConfig({ c3: true }),
    });
    expect(result.status).toBe('not_applicable');
    expect(result.contract).toMatchObject({
      status: 'not_applicable',
      claims: [],
      ...MULTILAYER_DEPENDENCY_CLAIM_BOUNDARY,
    });
    expect(result.evaluation).toMatchObject({
      status: 'not_applicable',
      applied: false,
      claimCount: 0,
    });
  });

  it.each([1, 2])('continues nominal sequencing unchanged for %i valid non-applicable levels', levels => {
    const chain = makeSyntheticChain(levels, { prefix: `not-applicable-${levels}` });
    const before = clone(chain.objects);
    const run = buildSynthetic([chain]);
    expect(run.sequencePlan.valid).toBe(true);
    expect(run.sequencePlan.multilayerDependencyTrace).toMatchObject({
      status: 'not_applicable',
      applied: false,
      claimCount: 0,
    });
    expect(run.sequencePlan.multilayerDependencyContract.claims).toEqual([]);
    expect(run.objects).toEqual(before);
    expect(run.sequencePlan.executionSteps).toHaveLength(levels);
  });

  it.each([3, 4, 5, 6])('accredits a synthetic contains chain with %i levels', levels => {
    const run = buildSynthetic([makeSyntheticChain(levels, { prefix: `chain-${levels}` })]);
    expect(run.sequencePlan.valid).toBe(true);
    expect(run.sequencePlan.multilayerDependencyTrace).toMatchObject({
      status: 'validated',
      claimCount: 1,
      applied: true,
    });
    expect(run.sequencePlan.multilayerDependencyContract.claims[0].canonicalLayers)
      .toHaveLength(levels);
    expect(run.sequencePlan.multilayerDependencyContract.claims[0].transitiveClosure)
      .toContainEqual(expect.objectContaining({ distance: levels - 1 }));
  });

  it('accredits two disconnected valid chains as separate contains claims', () => {
    const run = buildSynthetic([
      makeSyntheticChain(3, { prefix: 'left', left: 0, width: 0.42 }),
      makeSyntheticChain(4, {
        prefix: 'right',
        left: 0.58,
        width: 0.42,
        objectLeftMm: 60,
      }),
    ]);
    expect(run.sequencePlan.valid).toBe(true);
    expect(run.sequencePlan.multilayerDependencyContract.claims).toHaveLength(2);
    expect(run.sequencePlan.multilayerDependencyContract.claims
      .map(claim => claim.canonicalLayers.length)).toEqual([3, 4]);
  });

  it('blocks atomically when one disconnected chain is valid and another is invalid', () => {
    const left = makeSyntheticChain(3, { prefix: 'valid-left', left: 0, width: 0.42 });
    const right = makeSyntheticChain(3, {
      prefix: 'invalid-right',
      left: 0.58,
      width: 0.42,
      objectLeftMm: 60,
    });
    right.objects[1].dependencyIds = [];
    const run = buildSynthetic([left, right]);
    expect(run.sequencePlan.valid).toBe(false);
    expect(codes(run.sequencePlan)).toContain('MULTILAYER_REQUIRED_DEPENDENCY_MISSING');
    expect(run.sequencePlan.executionSteps).toEqual([]);
  });

  it('accredits a real-authority fork but rejects an invented join/transitive edge', () => {
    const chain = makeSyntheticChain(3, { prefix: 'fork' });
    const sibling = makeSyntheticChain(1, {
      prefix: 'fork-sibling',
      left: 0.7,
      width: 0.2,
      objectLeftMm: 28,
      objectWidthMm: 9,
    });
    sibling.objects[0].role = 'foreground_fill';
    sibling.objects[0].parameters.planning.semanticRole = 'secondary_shape';
    sibling.objects[0].id = `object:proposal:${sibling.objects[0].regionId}:foreground_fill`;
    sibling.objects[0].source = lineage(sibling.objects[0].regionId, 'foreground_fill');
    sibling.objects[0].dependencyIds = [chain.objects[0].id];
    const fork = buildSynthetic([{
      objects: [...chain.objects, ...sibling.objects],
      regions: [...chain.regions, ...sibling.regions],
    }]);
    expect(fork.sequencePlan.valid).toBe(true);
    expect(fork.sequencePlan.multilayerDependencyContract.canonicalDirectEdges)
      .toContainEqual({
        fromObjectId: chain.objects[0].id,
        toObjectId: sibling.objects[0].id,
      });

    const inventedJoin = clone(chain);
    inventedJoin.objects[2].dependencyIds.push(inventedJoin.objects[0].id);
    const invalid = buildSynthetic([inventedJoin]);
    expect(invalid.sequencePlan.valid).toBe(false);
    expect(codes(invalid.sequencePlan)).toContain('MULTILAYER_UNEXPECTED_DEPENDENCY');
  });
});

describe('Hatch C3 layers, sequence, integrity and downstream rejection', () => {
  function assertTamperedPlanBlocked(mutator, expectedCode) {
    const run = buildC12({ c3: true });
    const plan = clone(run.sequencePlan);
    mutator(plan, run);
    const validation = validateGlobalSequencePlan(
      plan,
      run.threadedObjectMaterialization,
      run.technicalPlan,
      run.ingestion.regions,
    );
    expect(validation.valid).toBe(false);
    expect(codes(validation)).toContain(expectedCode);
    const outputs = downstream(run, plan);
    expect(outputs.physicalPlan.valid).toBe(false);
    expect(outputs.physicalPlan.objectPaths).toEqual([]);
    expect(outputs.physicalPlan.summary.physicalPointCount).toBe(0);
    expect(outputs.canonicalCompilation.valid).toBe(false);
    expect(outputs.canonicalCompilation.commands).toEqual([]);
  }

  const layerMutations = [
    {
      label: 'reordered layers',
      mutate(plan) { plan.executionLayers.reverse(); },
    },
    {
      label: 'empty layer',
      mutate(plan) { plan.executionLayers.splice(1, 0, []); },
    },
    {
      label: 'redundant layer',
      mutate(plan) { plan.executionLayers.push([...plan.executionLayers[0]]); },
    },
    {
      label: 'duplicated member',
      mutate(plan) { plan.executionLayers[1].push(plan.executionLayers[1][0]); },
    },
    {
      label: 'incomplete coverage',
      mutate(plan) { plan.executionLayers.splice(1, 1); },
    },
    {
      label: 'incoherent execution layer',
      mutate(plan) {
        const step = plan.executionSteps.find(item => item.regionId.endsWith('white-fill'));
        step.executionLayer = 0;
      },
    },
  ];

  it.each(layerMutations)('rejects $label', ({ mutate }) => {
    assertTamperedPlanBlocked(mutate, 'MULTILAYER_EXECUTION_LAYERS_NOT_CANONICAL');
  });

  const sequenceMutations = [
    {
      label: 'dependent before prerequisite',
      code: 'MULTILAYER_SEQUENCE_DEPENDENCY_VIOLATION',
      mutate(plan) {
        const greenIndex = plan.executionSteps.findIndex(step =>
          step.regionId.endsWith('green-fill'));
        const whiteIndex = plan.executionSteps.findIndex(step =>
          step.regionId.endsWith('white-fill'));
        [plan.executionSteps[greenIndex], plan.executionSteps[whiteIndex]] = [
          plan.executionSteps[whiteIndex],
          plan.executionSteps[greenIndex],
        ];
        plan.executionSteps.forEach((step, index) => { step.sequenceIndex = index; });
      },
    },
    {
      label: 'position/index mismatch',
      code: 'MULTILAYER_INTEGRATION_STATE_MISMATCH',
      mutate(plan) { plan.executionSteps[0].sequenceIndex = 7; },
    },
    {
      label: 'missing execution object',
      code: 'MULTILAYER_INTEGRATION_STATE_MISMATCH',
      mutate(plan) {
        const index = plan.executionSteps.findIndex(step =>
          step.regionId.endsWith('white-fill'));
        plan.executionSteps.splice(index, 1);
      },
    },
    {
      label: 'duplicated execution object',
      code: 'MULTILAYER_INTEGRATION_STATE_MISMATCH',
      mutate(plan) {
        const step = clone(plan.executionSteps.find(item =>
          item.regionId.endsWith('white-fill')));
        plan.executionSteps.push(step);
      },
    },
  ];

  it.each(sequenceMutations)('rejects $label', ({ mutate, code }) => {
    assertTamperedPlanBlocked(mutate, code);
  });

  it('does not use numeric object.layer as C3 authority', () => {
    const run = buildC12({
      c3: true,
      mutateObjects(objects) {
        objects.forEach((object, index) => { object.layer = 900 - index * 37; });
      },
    });
    expect(run.sequencePlan.valid).toBe(true);
    expect(run.sequencePlan.multilayerDependencyTrace.status).toBe('validated');
  });

  const stateMutations = [
    {
      label: 'contract removed',
      code: 'MULTILAYER_CONTRACT_MISSING',
      mutate(plan) { delete plan.multilayerDependencyContract; },
    },
    {
      label: 'contract content manipulated',
      code: 'MULTILAYER_CONTRACT_STALE',
      mutate(plan) { plan.multilayerDependencyContract.scope = 'precedence_and_cutouts'; },
    },
    {
      label: 'fingerprint manipulated in isolation',
      code: 'MULTILAYER_CONTRACT_STALE',
      mutate(plan) { plan.multilayerDependencyContract.fingerprint = '00000000'; },
    },
    {
      label: 'marker removed',
      code: 'MULTILAYER_INTEGRATION_STATE_MISMATCH',
      mutate(plan) { delete plan.multilayerDependencyIntegrationMarker; },
    },
    {
      label: 'marker manipulated',
      code: 'MULTILAYER_INTEGRATION_STATE_MISMATCH',
      mutate(plan) { plan.multilayerDependencyIntegrationMarker.active = false; },
    },
    {
      label: 'evaluation removed',
      code: 'MULTILAYER_INTEGRATION_STATE_MISMATCH',
      mutate(plan) { delete plan.multilayerDependencyEvaluation; },
    },
    {
      label: 'evaluation manipulated',
      code: 'MULTILAYER_EVALUATION_STALE',
      mutate(plan) { plan.multilayerDependencyEvaluation.applied = false; },
    },
    {
      label: 'trace removed',
      code: 'MULTILAYER_TRACE_MISSING',
      mutate(plan) { delete plan.multilayerDependencyTrace; },
    },
    {
      label: 'trace manipulated',
      code: 'MULTILAYER_TRACE_STALE',
      mutate(plan) { plan.multilayerDependencyTrace.status = 'not_applicable'; },
    },
    {
      label: 'metadata removed',
      code: 'MULTILAYER_INTEGRATION_STATE_MISMATCH',
      mutate(plan) { delete plan.metadata.multilayerDependencyEvaluatorInvoked; },
    },
    {
      label: 'all enabled state removed',
      code: 'MULTILAYER_CONTRACT_MISSING',
      mutate(plan) {
        delete plan.multilayerDependencyContract;
        delete plan.multilayerDependencyIntegrationMarker;
        delete plan.multilayerDependencyEvaluation;
        delete plan.multilayerDependencyTrace;
        delete plan.metadata.multilayerDependencyEvaluatorInvoked;
      },
    },
    {
      label: 'historical state retained while OFF',
      code: 'MULTILAYER_INTEGRATION_STATE_MISMATCH',
      mutate(plan) {
        plan.config.extras.hatchOverlapRuleFlags[MULTILAYER_DEPENDENCY_RULE_ID] = false;
      },
    },
  ];

  it.each(stateMutations)('rejects $label and all downstream output', ({ mutate, code }) => {
    assertTamperedPlanBlocked(mutate, code);
  });

  it('rejects a fully recomposed self-certification around a manipulated DAG', () => {
    const run = buildC12({ c3: true });
    const objects = clone(run.threadedObjectMaterialization.objects);
    objects.find(object => object.regionId.endsWith('white-fill')).dependencyIds = [];
    const materialization = materializationWithObjects(
      run.threadedObjectMaterialization,
      objects,
    );
    const plan = clone(run.sequencePlan);
    const recomposed = evaluateMultilayerDependencyGuard({
      regions: run.ingestion.regions,
      objects,
      executionSteps: plan.executionSteps,
      executionLayers: plan.executionLayers,
      config: plan.config,
    });
    plan.multilayerDependencyContract = recomposed.contract;
    plan.multilayerDependencyIntegrationMarker = recomposed.marker;
    plan.multilayerDependencyEvaluation = recomposed.evaluation;
    plan.multilayerDependencyTrace = recomposed.trace;
    plan.metadata.multilayerDependencyEvaluatorInvoked = true;
    plan.valid = true;
    plan.errors = [];
    const validation = validateGlobalSequencePlan(
      plan,
      materialization,
      run.technicalPlan,
      run.ingestion.regions,
    );
    expect(validation.valid).toBe(false);
    expect(codes(validation)).toContain('MULTILAYER_REQUIRED_DEPENDENCY_MISSING');
    expect(codes(validation)).toContain('MULTILAYER_INTEGRATION_STATE_MISMATCH');
    const outputs = downstream(run, plan, materialization, run.technicalPlan);
    expect(outputs.physicalPlan.objectPaths).toEqual([]);
    expect(outputs.canonicalCompilation.commands).toEqual([]);
  });

  it('rejects a participant removed after accreditation', () => {
    const run = buildC12({ c3: true });
    const objects = clone(run.threadedObjectMaterialization.objects);
    objects.splice(objects.findIndex(object => object.regionId.endsWith('white-fill')), 1);
    const materialization = materializationWithObjects(
      run.threadedObjectMaterialization,
      objects,
    );
    const validation = validateGlobalSequencePlan(
      run.sequencePlan,
      materialization,
      run.technicalPlan,
      run.ingestion.regions,
    );
    expect(validation.valid).toBe(false);
    expect(codes(validation)).toContain('MULTILAYER_CONTRACT_STALE');
    const outputs = downstream(run, run.sequencePlan, materialization, run.technicalPlan);
    expect(outputs.physicalPlan.objectPaths).toEqual([]);
    expect(outputs.canonicalCompilation.commands).toEqual([]);
  });
});

describe('Hatch C3-R1 current-region authority and claim isolation', () => {
  const invalidRegionInputs = [
    {
      label: 'absent',
      values() { return {}; },
    },
    {
      label: 'explicit undefined',
      values() { return { regions: undefined }; },
    },
    {
      label: 'null',
      values() { return { regions: null }; },
    },
    {
      label: 'non-array',
      values() { return { regions: { current: true } }; },
    },
    {
      label: 'incomplete array',
      values(run) { return { regions: clone(run.ingestion.regions.slice(0, -1)) }; },
    },
    {
      label: 'malformed RegionV2 array',
      values(run) {
        const regions = clone(run.ingestion.regions);
        regions[0].geometry = [{ x: 0, y: 0 }];
        return { regions };
      },
    },
  ];

  it.each(invalidRegionInputs)(
    'fails closed for C3 ON with $label current regions at validation and both consumers',
    ({ values }) => {
      const run = buildC12({ c3: true });
      const supplied = values(run);
      const evaluator = evaluateMultilayerDependencyGuard({
        objects: run.threadedObjectMaterialization.objects,
        executionSteps: run.sequencePlan.executionSteps,
        executionLayers: run.sequencePlan.executionLayers,
        config: run.sequencePlan.config,
        ...supplied,
      });
      expect(evaluator.status).toBe('blocked');
      expect(codes(evaluator)).toContain('MULTILAYER_AUTHORITATIVE_REGIONS_MISSING');

      const currentRegions = Object.hasOwn(supplied, 'regions')
        ? supplied.regions
        : undefined;
      const validation = validateGlobalSequencePlan(
        run.sequencePlan,
        run.threadedObjectMaterialization,
        run.technicalPlan,
        currentRegions,
      );
      expect(validation.valid).toBe(false);
      expect(codes(validation)).toContain('MULTILAYER_AUTHORITATIVE_REGIONS_MISSING');

      const physicalArguments = {
        threadedObjectMaterialization: run.threadedObjectMaterialization,
        technicalPlan: run.technicalPlan,
        sequencePlan: run.sequencePlan,
      };
      if (Object.hasOwn(supplied, 'regions')) physicalArguments.regions = supplied.regions;
      const physicalPlan = buildMachineIndependentPhysicalStitchPlan(physicalArguments);
      expect(physicalPlan.valid).toBe(false);
      expect(codes(physicalPlan)).toContain('MULTILAYER_AUTHORITATIVE_REGIONS_MISSING');
      expect(physicalPlan.dispositions).toEqual([]);
      expect(physicalPlan.objectPaths).toEqual([]);
      expect(physicalPlan.summary).toMatchObject({
        physicalSubpathCount: 0,
        physicalPointCount: 0,
        physicalStitchCount: 0,
      });

      const canonicalArguments = {
        threadedObjectMaterialization: run.threadedObjectMaterialization,
        technicalPlan: run.technicalPlan,
        sequencePlan: run.sequencePlan,
        physicalPlan: run.physicalPlan,
      };
      if (Object.hasOwn(supplied, 'regions')) canonicalArguments.regions = supplied.regions;
      const compilation = compileCanonicalCommandStream(canonicalArguments);
      expect(compilation.valid).toBe(false);
      expect(codes(compilation)).toContain('MULTILAYER_AUTHORITATIVE_REGIONS_MISSING');
      expect(compilation.commands).toEqual([]);
      expect(compilation.summary.commandCount).toBe(0);
    },
  );

  it('accepts a structurally equivalent current RegionV2 copy', () => {
    const run = buildC12({ c3: true });
    const regions = clone(run.ingestion.regions);
    const validation = validateGlobalSequencePlan(
      run.sequencePlan,
      run.threadedObjectMaterialization,
      run.technicalPlan,
      regions,
    );
    expect(validation.valid).toBe(true);
    const outputs = downstream(run, run.sequencePlan, undefined, undefined, regions);
    expect(outputs.physicalPlan.valid).toBe(true);
    expect(outputs.canonicalCompilation.valid).toBe(true);
    expect(outputs.physicalPlan.objectPaths).toEqual(run.physicalPlan.objectPaths);
    expect(outputs.canonicalCompilation.commands).toEqual(run.canonicalCompilation.commands);
  });

  it('keeps C3 OFF compatible when current regions are omitted', () => {
    const run = buildC12({ c3: false });
    const sequenceValidation = validateGlobalSequencePlan(
      run.sequencePlan,
      run.threadedObjectMaterialization,
      run.technicalPlan,
    );
    const physicalPlan = buildMachineIndependentPhysicalStitchPlan({
      threadedObjectMaterialization: run.threadedObjectMaterialization,
      technicalPlan: run.technicalPlan,
      sequencePlan: run.sequencePlan,
    });
    const compilation = compileCanonicalCommandStream({
      threadedObjectMaterialization: run.threadedObjectMaterialization,
      technicalPlan: run.technicalPlan,
      sequencePlan: run.sequencePlan,
      physicalPlan,
    });
    expect(sequenceValidation.valid).toBe(true);
    expect(physicalPlan.valid).toBe(true);
    expect(codes(compilation).some(code => code.startsWith('MULTILAYER_'))).toBe(false);
    expect(physicalPlan.objectPaths).toEqual(run.physicalPlan.objectPaths);
    expect(run.sequencePlan).not.toHaveProperty('multilayerDependencyContract');
  });

  it('blocks both consumers when current green holes invalidate a sequenced C12 claim', () => {
    const run = buildC12({ c3: true });
    const regions = clone(run.ingestion.regions);
    const green = regions.find(region => region.id.endsWith('green-fill'));
    const black = regions.find(region => region.id.endsWith('black-outline'));
    green.holes = [clone(black.geometry)];

    const validation = validateGlobalSequencePlan(
      run.sequencePlan,
      run.threadedObjectMaterialization,
      run.technicalPlan,
      regions,
    );
    expect(validation.valid).toBe(false);
    expect(codes(validation)).toContain('MULTILAYER_COMPONENT_MISMATCH');
    expect(codes(validation)).toContain('MULTILAYER_CONTRACT_STALE');
    expect(run.sequencePlan.multilayerDependencyContract).not.toBeNull();
    expect(run.sequencePlan.multilayerDependencyIntegrationMarker.active).toBe(true);
    expect(run.sequencePlan.multilayerDependencyEvaluation.applied).toBe(true);
    expect(run.sequencePlan.multilayerDependencyTrace.status).toBe('validated');

    const { physicalPlan, canonicalCompilation } = downstream(
      run,
      run.sequencePlan,
      run.threadedObjectMaterialization,
      run.technicalPlan,
      regions,
    );
    expect(physicalPlan.valid).toBe(false);
    expect(codes(physicalPlan)).toContain('MULTILAYER_COMPONENT_MISMATCH');
    expect(physicalPlan.dispositions).toEqual([]);
    expect(physicalPlan.objectPaths).toEqual([]);
    expect(physicalPlan.summary).toMatchObject({
      physicalSubpathCount: 0,
      physicalPointCount: 0,
      physicalStitchCount: 0,
    });
    expect(canonicalCompilation.valid).toBe(false);
    expect(canonicalCompilation.commands).toEqual([]);
    expect(canonicalCompilation.summary.commandCount).toBe(0);
  });

  it('keeps a disconnected two-participant dependency outside C3 applicability', () => {
    const left = makeSyntheticChain(1, {
      prefix: 'r1-disconnected-left',
      left: 0,
      width: 0.35,
    });
    const right = makeSyntheticChain(1, {
      prefix: 'r1-disconnected-right',
      left: 0.65,
      width: 0.35,
      objectLeftMm: 60,
    });
    right.objects[0].dependencyIds = [left.objects[0].id];
    const result = evaluateMultilayerDependencyGuard({
      regions: [...left.regions, ...right.regions],
      objects: [...left.objects, ...right.objects],
      executionSteps: [],
      executionLayers: [],
      config: cConfig({ c3: true }),
    });
    expect(result.applicable).toBe(false);
    expect(result.status).toBe('not_applicable');
    expect(result.contract.claims).toEqual([]);
    expect(result.marker).toMatchObject({
      active: true,
      applied: false,
      status: 'not_applicable',
    });
    expect(codes(result)).not.toContain('MULTILAYER_COMPONENT_MISMATCH');
  });

  it('ignores a cycle wholly external to a valid C3 claim', () => {
    const run = buildC12({ c3: true });
    const externalLeft = makeSyntheticChain(1, {
      prefix: 'r1-external-cycle-left',
      left: 0,
      width: 0.1,
      objectLeftMm: 180,
    });
    const externalRight = makeSyntheticChain(1, {
      prefix: 'r1-external-cycle-right',
      left: 0.15,
      width: 0.1,
      objectLeftMm: 220,
    });
    externalLeft.objects[0].dependencyIds = [externalRight.objects[0].id];
    externalRight.objects[0].dependencyIds = [externalLeft.objects[0].id];
    const result = evaluateMultilayerDependencyGuard(evaluatorInput(run, {
      regions: [
        ...run.ingestion.regions,
        ...externalLeft.regions,
        ...externalRight.regions,
      ],
      objects: [
        ...run.threadedObjectMaterialization.objects,
        ...externalLeft.objects,
        ...externalRight.objects,
      ],
    }));
    expect(result.errors).toEqual([]);
    expect(result.status).toBe('validated');
    expect(result.contract.claims).toHaveLength(1);
    expect(codes(result)).not.toContain('MULTILAYER_DEPENDENCY_CYCLE');
    expect(codes(result)).not.toContain('MULTILAYER_COMPONENT_MISMATCH');
  });
});

describe('Hatch C3-R1 recomposed self-certification and isolated integrity', () => {
  function recomposeArtifacts(plan, result) {
    plan.multilayerDependencyContract = result.contract;
    plan.multilayerDependencyIntegrationMarker = result.marker;
    plan.multilayerDependencyEvaluation = result.evaluation;
    plan.multilayerDependencyTrace = result.trace;
    plan.metadata.multilayerDependencyEvaluatorInvoked = true;
    plan.valid = true;
    plan.errors = [];
  }

  function recomposedScenario(mutator) {
    const run = buildC12({ c3: true });
    const objects = clone(run.threadedObjectMaterialization.objects);
    const regions = clone(run.ingestion.regions);
    const plan = clone(run.sequencePlan);
    mutator({ run, objects, regions, plan });
    const materialization = materializationWithObjects(
      run.threadedObjectMaterialization,
      objects,
    );
    const result = evaluateMultilayerDependencyGuard({
      regions,
      objects,
      executionSteps: plan.executionSteps,
      executionLayers: plan.executionLayers,
      config: plan.config,
    });
    recomposeArtifacts(plan, result);
    return { run, objects, regions, plan, materialization, result };
  }

  const recomposedMutations = [
    {
      label: 'required edge inverted',
      code: 'MULTILAYER_DEPENDENCY_DIRECTION_MISMATCH',
      mutate({ objects }) {
        const green = objects.find(object => object.regionId.endsWith('green-fill'));
        const white = objects.find(object => object.regionId.endsWith('white-fill'));
        white.dependencyIds = [];
        green.dependencyIds = [white.id];
      },
    },
    {
      label: 'transitive edge stored directly',
      code: 'MULTILAYER_UNEXPECTED_DEPENDENCY',
      mutate({ objects }) {
        const green = objects.find(object => object.regionId.endsWith('green-fill'));
        const orange = objects.find(object => object.regionId.endsWith('orange-detail'));
        orange.dependencyIds.push(green.id);
      },
    },
    {
      label: 'sequence inverted',
      code: 'MULTILAYER_SEQUENCE_DEPENDENCY_VIOLATION',
      mutate({ plan }) {
        const greenIndex = plan.executionSteps.findIndex(step =>
          step.regionId.endsWith('green-fill'));
        const whiteIndex = plan.executionSteps.findIndex(step =>
          step.regionId.endsWith('white-fill'));
        [plan.executionSteps[greenIndex], plan.executionSteps[whiteIndex]] = [
          plan.executionSteps[whiteIndex],
          plan.executionSteps[greenIndex],
        ];
        plan.executionSteps.forEach((step, index) => { step.sequenceIndex = index; });
      },
    },
    {
      label: 'current regions changed after sequencing',
      code: 'MULTILAYER_COMPONENT_MISMATCH',
      mutate({ regions }) {
        const green = regions.find(region => region.id.endsWith('green-fill'));
        const black = regions.find(region => region.id.endsWith('black-outline'));
        green.holes = [clone(black.geometry)];
      },
    },
  ];

  it.each(recomposedMutations)(
    'rejects fully recomposed artifacts after $label',
    ({ code, mutate }) => {
      const scenario = recomposedScenario(mutate);
      expect(scenario.result.status).toBe('blocked');
      expect(codes(scenario.result)).toContain(code);

      const validate = () => validateGlobalSequencePlan(
        scenario.plan,
        scenario.materialization,
        scenario.run.technicalPlan,
        scenario.regions,
      );
      const firstValidation = validate();
      const secondValidation = validate();
      expect(firstValidation.valid).toBe(false);
      expect(firstValidation.errors).toEqual(secondValidation.errors);
      expect(codes(firstValidation).filter(item => item === code)).toHaveLength(1);

      const first = downstream(
        scenario.run,
        scenario.plan,
        scenario.materialization,
        scenario.run.technicalPlan,
        scenario.regions,
      );
      const second = downstream(
        scenario.run,
        scenario.plan,
        scenario.materialization,
        scenario.run.technicalPlan,
        scenario.regions,
      );
      [first.physicalPlan, first.canonicalCompilation].forEach(stage => {
        expect(stage.valid).toBe(false);
        expect(codes(stage).filter(item => item === code)).toHaveLength(1);
        expect(JSON.stringify(stage.errors)).not.toMatch(
          /"evidence":\s*\{[^}]*"errors":/u,
        );
      });
      expect(first.physicalPlan.dispositions).toEqual([]);
      expect(first.physicalPlan.objectPaths).toEqual([]);
      expect(first.physicalPlan.summary).toMatchObject({
        physicalSubpathCount: 0,
        physicalPointCount: 0,
        physicalStitchCount: 0,
      });
      expect(first.canonicalCompilation.commands).toEqual([]);
      expect(first.canonicalCompilation.summary.commandCount).toBe(0);
      expect(first.physicalPlan.errors).toEqual(second.physicalPlan.errors);
      expect(first.canonicalCompilation.errors).toEqual(
        second.canonicalCompilation.errors,
      );
    },
  );

  function fnvFingerprint(value) {
    const text = JSON.stringify(value);
    let valueHash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      valueHash ^= text.charCodeAt(index);
      valueHash = Math.imul(valueHash, 16777619);
    }
    return (valueHash >>> 0).toString(16).padStart(8, '0');
  }

  function mutateContractAndRefreshFingerprint(plan, mutate) {
    mutate(plan.multilayerDependencyContract);
    const body = clone(plan.multilayerDependencyContract);
    delete body.fingerprint;
    plan.multilayerDependencyContract.fingerprint = fnvFingerprint(body);
  }

  const isolatedContractMutations = [
    {
      label: 'participant signatures',
      mutate(contract) { contract.participantSignatures.pop(); },
    },
    {
      label: 'contains components',
      mutate(contract) { contract.containsComponents[0].coreObjectIds.pop(); },
    },
    {
      label: 'transitive closure',
      mutate(contract) { contract.transitiveClosure.pop(); },
    },
    {
      label: 'sequence positions',
      mutate(contract) {
        const id = Object.keys(contract.sequencePositions)[0];
        contract.sequencePositions[id] += 10;
      },
    },
    {
      label: 'cutoutEvaluated',
      mutate(contract) { contract.cutoutEvaluated = true; },
    },
    {
      label: 'cutoutCorrectnessClaimed',
      mutate(contract) { contract.cutoutCorrectnessClaimed = true; },
    },
    {
      label: 'physicalImprovementClaimed',
      mutate(contract) { contract.physicalImprovementClaimed = true; },
    },
    {
      label: 'orderModified',
      mutate(contract) { contract.orderModified = true; },
    },
    {
      label: 'dependenciesModified',
      mutate(contract) { contract.dependenciesModified = true; },
    },
    {
      label: 'geometryModified',
      mutate(contract) { contract.geometryModified = true; },
    },
  ];

  it.each(isolatedContractMutations)(
    'rejects isolated $label mutation even with a recomputed contract fingerprint',
    ({ mutate }) => {
      const run = buildC12({ c3: true });
      const plan = clone(run.sequencePlan);
      mutateContractAndRefreshFingerprint(plan, mutate);
      const validation = validateGlobalSequencePlan(
        plan,
        run.threadedObjectMaterialization,
        run.technicalPlan,
        run.ingestion.regions,
      );
      expect(validation.valid).toBe(false);
      expect(codes(validation)).toContain('MULTILAYER_CONTRACT_STALE');
      const outputs = downstream(run, plan);
      expect(outputs.physicalPlan.objectPaths).toEqual([]);
      expect(outputs.canonicalCompilation.commands).toEqual([]);
    },
  );

  const regionIdMutations = [
    {
      label: 'own regionId deleted',
      code: 'MULTILAYER_REGION_MISSING',
      mutate(objects) { delete objects[1].regionId; },
    },
    {
      label: 'regionId non-textual',
      code: 'MULTILAYER_REGION_MISSING',
      mutate(objects) { objects[1].regionId = { value: 'region' }; },
    },
    {
      label: 'regionId duplicated',
      code: 'MULTILAYER_PARTICIPANT_ID_INVALID',
      mutate(objects) { objects[1].regionId = objects[0].regionId; },
    },
  ];

  it.each(regionIdMutations)('blocks $label explicitly and atomically', ({ mutate, code }) => {
    const run = buildC12({ c3: true, mutateObjects: mutate });
    assertAtomicBlock(run, code);
  });

  it.each([undefined, null])(
    'rejects C3 flag value %s without silently enabling or disabling the rule',
    value => {
      const fixture = buildC12({ c3: false });
      const config = cConfig({ c3: false });
      config.hatchOverlapRuleFlags[MULTILAYER_DEPENDENCY_RULE_ID] = value;
      const sequencePlan = buildGlobalSequencePlan({
        regions: fixture.ingestion.regions,
        threadedObjectMaterialization: fixture.threadedObjectMaterialization,
        technicalPlan: fixture.technicalPlan,
        config,
      });
      expect(sequencePlan.valid).toBe(false);
      expect(codes(sequencePlan)).toContain('INVALID_HATCH_OVERLAP_RULE_FLAG_VALUE');
      expect(sequencePlan).not.toHaveProperty('multilayerDependencyContract');
      const outputs = downstream(fixture, sequencePlan);
      expect(outputs.physicalPlan.valid).toBe(false);
      expect(outputs.physicalPlan.objectPaths).toEqual([]);
      expect(outputs.canonicalCompilation.valid).toBe(false);
      expect(outputs.canonicalCompilation.commands).toEqual([]);
    },
  );

  const planReferenceMutations = [
    {
      label: 'incompatible thread block',
      code: 'THREAD_BLOCK_OBJECT_THREAD_MISMATCH',
      mutate(plan) {
        plan.threadBlocks[0].objectIds = [plan.executionSteps[1].objectId];
      },
    },
    {
      label: 'unknown execution step ID',
      code: 'NONDETERMINISTIC_EXECUTION_ID',
      mutate(plan) {
        plan.executionSteps[0].id = 'execution:unknown-c3-r1';
      },
    },
    {
      label: 'unknown execution object',
      code: 'EXECUTION_UNKNOWN_OBJECT',
      mutate(plan) {
        plan.executionSteps[1].objectId = 'object:unknown-c3-r1';
        plan.executionSteps[1].id = 'execution:0001:object:unknown-c3-r1';
      },
    },
  ];

  it.each(planReferenceMutations)('rejects $label separately', ({ mutate, code }) => {
    const run = buildC12({ c3: true });
    const plan = clone(run.sequencePlan);
    mutate(plan);
    const validation = validateGlobalSequencePlan(
      plan,
      run.threadedObjectMaterialization,
      run.technicalPlan,
      run.ingestion.regions,
    );
    expect(validation.valid).toBe(false);
    expect(codes(validation)).toContain(code);
    const outputs = downstream(run, plan);
    expect(outputs.physicalPlan.objectPaths).toEqual([]);
    expect(outputs.canonicalCompilation.commands).toEqual([]);
  });
});

describe('Hatch C3-R1 synthetic and real-authority parity', () => {
  function completeSynthetic(chains, config) {
    const run = buildSynthetic(chains, config);
    const physicalPlan = buildMachineIndependentPhysicalStitchPlan({
      regions: run.regions,
      threadedObjectMaterialization: run.threadedObjectMaterialization,
      technicalPlan: run.technicalPlan,
      sequencePlan: run.sequencePlan,
    });
    const canonicalCompilation = compileCanonicalCommandStream({
      regions: run.regions,
      threadedObjectMaterialization: run.threadedObjectMaterialization,
      technicalPlan: run.technicalPlan,
      sequencePlan: run.sequencePlan,
      physicalPlan,
    });
    return { ...run, physicalPlan, canonicalCompilation };
  }

  function fullParitySnapshot(run) {
    return {
      objects: run.objects,
      dependencies: run.objects.map(object => ({
        objectId: object.id,
        dependencyIds: object.dependencyIds,
      })),
      steps: run.sequencePlan.executionSteps,
      threadBlocks: run.sequencePlan.threadBlocks,
      geometry: run.objects.map(object => ({
        objectId: object.id,
        geometry: object.geometry,
        holes: object.holes,
        role: object.role,
        stitchType: object.stitchType,
      })),
      physicalPaths: run.physicalPlan.objectPaths,
      commands: run.canonicalCompilation.commands,
      physicalHash: hash(run.physicalPlan.objectPaths),
      canonicalHash: hash(run.canonicalCompilation.commands),
    };
  }

  function makeFork() {
    const chain = makeSyntheticChain(3, { prefix: 'r1-fork' });
    const sibling = makeSyntheticChain(1, {
      prefix: 'r1-fork-sibling',
      left: 0.7,
      width: 0.2,
      objectLeftMm: 28,
      objectWidthMm: 9,
    });
    sibling.objects[0].role = 'foreground_fill';
    sibling.objects[0].parameters.planning.semanticRole = 'secondary_shape';
    sibling.objects[0].id =
      `object:proposal:${sibling.objects[0].regionId}:foreground_fill`;
    sibling.objects[0].source = lineage(
      sibling.objects[0].regionId,
      'foreground_fill',
    );
    sibling.objects[0].dependencyIds = [chain.objects[0].id];
    return {
      objects: [...chain.objects, ...sibling.objects],
      regions: [...chain.regions, ...sibling.regions],
    };
  }

  function makeNonTopologicalChain() {
    const chain = clone(makeSyntheticChain(3, { prefix: 'r1-nontopological' }));
    const regionIds = ['z-parent-region', 'm-child-region', 'a-grandchild-region'];
    const objectIds = regionIds.map((regionId, index) => {
      const role = index === 0 ? 'base_fill' : 'foreground_fill';
      return `object:proposal:${regionId}:${role}`;
    });
    chain.regions.forEach((region, index) => { region.id = regionIds[index]; });
    chain.objects.forEach((object, index) => {
      const role = index === 0 ? 'base_fill' : 'foreground_fill';
      object.id = objectIds[index];
      object.regionId = regionIds[index];
      object.dependencyIds = index === 0 ? [] : [objectIds[index - 1]];
      object.source = lineage(regionIds[index], role);
    });
    return chain;
  }

  const parityTopologies = [
    ...[3, 4, 5, 6].map(levels => ({
      label: `${levels}-level chain`,
      make: () => [makeSyntheticChain(levels, { prefix: `r1-chain-${levels}` })],
    })),
    {
      label: 'disconnected claims',
      make: () => [
        makeSyntheticChain(3, {
          prefix: 'r1-parity-left',
          left: 0,
          width: 0.42,
        }),
        makeSyntheticChain(3, {
          prefix: 'r1-parity-right',
          left: 0.58,
          width: 0.42,
          objectLeftMm: 60,
        }),
      ],
    },
    {
      label: 'real-authority fork',
      make: () => [makeFork()],
    },
    {
      label: 'non-topological IDs',
      make: () => [makeNonTopologicalChain()],
    },
    {
      label: 'reversed region and object input',
      make: () => {
        const chain = makeSyntheticChain(4, { prefix: 'r1-reversed' });
        chain.objects.reverse();
        chain.regions.reverse();
        return [chain];
      },
    },
  ];

  it.each(parityTopologies)(
    'preserves full C3 ON/OFF parity for $label',
    ({ make }) => {
      const off = completeSynthetic(make(), cConfig({ c3: false }));
      const on = completeSynthetic(make(), cConfig({ c3: true }));
      expect(on.sequencePlan.valid).toBe(true);
      expect(on.physicalPlan.valid).toBe(true);
      expect(on.canonicalCompilation.valid).toBe(true);
      expect(fullParitySnapshot(on)).toEqual(fullParitySnapshot(off));
      expect(on.sequencePlan.multilayerDependencyContract).toMatchObject({
        scope: 'precedence_only',
        cutoutEvaluated: false,
        cutoutCorrectnessClaimed: false,
        physicalImprovementClaimed: false,
      });
    },
  );

  it.each(['exact', 'beam'])(
    'preserves synthetic three-level parity with the %s scheduler',
    algorithm => {
      const make = () => [
        makeSyntheticChain(3, { prefix: `r1-${algorithm}-chain` }),
      ];
      const off = completeSynthetic(make(), cConfig({ c3: false, algorithm }));
      const on = completeSynthetic(make(), cConfig({ c3: true, algorithm }));
      expect(fullParitySnapshot(on)).toEqual(fullParitySnapshot(off));
    },
  );

  it('preserves parity with reused resolved config and two deterministic executions', () => {
    const raw = cConfig({ c3: true, algorithm: 'exact' });
    const resolved = resolveSequencePlanningConfig(raw);
    const first = completeSynthetic([
      makeSyntheticChain(3, { prefix: 'r1-reused-config' }),
    ], resolved);
    const second = completeSynthetic([
      makeSyntheticChain(3, { prefix: 'r1-reused-config' }),
    ], resolved);
    expect(first.sequencePlan.config).toEqual(resolved);
    expect(second.sequencePlan.config).toEqual(resolved);
    expect(fullParitySnapshot(first)).toEqual(fullParitySnapshot(second));
  });

  it('uses the real C12 dependency planner to form a delegated diamond and keeps parity', () => {
    const off = buildC12({ c1: true, c3: false });
    const on = buildC12({ c1: true, c3: true });
    const green = objectByRegion(on, 'green-fill');
    const white = objectByRegion(on, 'white-fill');
    const orange = objectByRegion(on, 'orange-detail');
    const black = objectByRegion(on, 'black-outline');
    expect(white.dependencyIds).toContain(green.id);
    expect(orange.dependencyIds).toContain(white.id);
    expect(black.dependencyIds).toEqual([green.id, white.id, orange.id]);
    expect(on.sequencePlan.multilayerDependencyContract.auxiliaryParticipants)
      .toContainEqual(expect.objectContaining({
        objectId: black.id,
        delegatedRuleId: CONTOUR_LAST_RULE_ID,
        dependencyAccreditedByC3: false,
      }));
    expect(operationalSnapshot(on)).toEqual(operationalSnapshot(off));
  });
});

describe('Hatch C3-R2 authoritative RegionV2 structural integrity', () => {
  function createR2Fixture(label = 'fixture') {
    return buildSynthetic([
      makeSyntheticChain(3, { prefix: `r2-${label}` }),
    ]);
  }

  function evaluatorFor(fixture, variant) {
    const input = {
      objects: fixture.objects,
      executionSteps: fixture.sequencePlan.executionSteps,
      executionLayers: fixture.sequencePlan.executionLayers,
      config: cConfig({ c3: true }),
    };
    if (variant.present) input.regions = variant.value;
    return evaluateMultilayerDependencyGuard(input);
  }

  function validationFor(fixture, variant, plan = fixture.sequencePlan) {
    return validateGlobalSequencePlan(
      plan,
      fixture.threadedObjectMaterialization,
      fixture.technicalPlan,
      variant.present ? variant.value : undefined,
    );
  }

  function freshPlanFor(fixture, variant, config = cConfig({ c3: true })) {
    const input = {
      threadedObjectMaterialization: fixture.threadedObjectMaterialization,
      technicalPlan: fixture.technicalPlan,
      config,
    };
    if (variant.present) input.regions = variant.value;
    return buildGlobalSequencePlan(input);
  }

  function downstreamFor(fixture, plan, variant) {
    const physicalInput = {
      threadedObjectMaterialization: fixture.threadedObjectMaterialization,
      technicalPlan: fixture.technicalPlan,
      sequencePlan: plan,
    };
    if (variant.present) physicalInput.regions = variant.value;
    const physicalPlan = buildMachineIndependentPhysicalStitchPlan(physicalInput);
    const canonicalInput = {
      threadedObjectMaterialization: fixture.threadedObjectMaterialization,
      technicalPlan: fixture.technicalPlan,
      sequencePlan: plan,
      physicalPlan,
    };
    if (variant.present) canonicalInput.regions = variant.value;
    const canonicalCompilation = compileCanonicalCommandStream(canonicalInput);
    return { physicalPlan, canonicalCompilation };
  }

  function assertBlockedEvaluation(result, expectedPath) {
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.status).toBe('blocked');
    expect(result.applicable).toBe(false);
    expect(result.contract).toBeNull();
    expect(result.candidate.claims).toEqual([]);
    expect(result.marker).toMatchObject({
      active: true,
      evaluatorInvoked: true,
      applied: false,
      status: 'blocked',
      claimCount: 0,
    });
    expect(result.evaluation).toMatchObject({
      active: true,
      evaluatorInvoked: true,
      applied: false,
      status: 'blocked',
      claimCount: 0,
    });
    expect(result.trace).toMatchObject({
      active: true,
      evaluatorInvoked: true,
      applied: false,
      status: 'blocked',
      claimCount: 0,
    });
    const authoritativeErrors = result.errors.filter(error =>
      error.code === 'MULTILAYER_AUTHORITATIVE_REGIONS_MISSING');
    expect(authoritativeErrors.length).toBeGreaterThan(0);
    expect(authoritativeErrors.map(error => error.path)).toContain(expectedPath);
  }

  function assertAtomicPipeline(fixture, variant) {
    const sequencePlan = freshPlanFor(fixture, variant);
    expect(sequencePlan.valid).toBe(false);
    expect(codes(sequencePlan)).toContain('MULTILAYER_AUTHORITATIVE_REGIONS_MISSING');
    expect(sequencePlan.multilayerDependencyContract).toBeNull();
    expect(sequencePlan.multilayerDependencyTrace).toMatchObject({
      active: true,
      evaluatorInvoked: true,
      applied: false,
      status: 'blocked',
      claimCount: 0,
    });
    expect(sequencePlan.executionSteps).toEqual([]);
    expect(sequencePlan.selectedEntryExitPairs).toEqual([]);
    expect(sequencePlan.transitions).toEqual([]);
    expect(sequencePlan.threadBlocks).toEqual([]);

    const { physicalPlan, canonicalCompilation } = downstreamFor(
      fixture,
      sequencePlan,
      variant,
    );
    expect(physicalPlan.valid).toBe(false);
    expect(codes(physicalPlan)).toContain('MULTILAYER_AUTHORITATIVE_REGIONS_MISSING');
    expect(physicalPlan.dispositions).toEqual([]);
    expect(physicalPlan.objectPaths).toEqual([]);
    expect(physicalPlan.summary).toMatchObject({
      physicalSubpathCount: 0,
      physicalPointCount: 0,
      physicalStitchCount: 0,
    });
    expect(canonicalCompilation.valid).toBe(false);
    expect(codes(canonicalCompilation))
      .toContain('MULTILAYER_AUTHORITATIVE_REGIONS_MISSING');
    expect(canonicalCompilation.commands).toEqual([]);
    expect(canonicalCompilation.summary.commandCount).toBe(0);
    return { sequencePlan, physicalPlan, canonicalCompilation };
  }

  function arrayWithRegionProperties(fixture) {
    const regions = structuredClone(fixture.regions);
    const validRegion = regions[1];
    const malformed = Object.assign([], structuredClone(validRegion));
    regions[1] = malformed;
    return { present: true, value: regions };
  }

  function duplicateRegionId(fixture) {
    const regions = structuredClone(fixture.regions);
    regions[1] = structuredClone(regions[0]);
    return { present: true, value: regions };
  }

  const negativeCases = [
    {
      label: 'missing regions property',
      path: 'regions',
      create() { return { present: false }; },
    },
    {
      label: 'regions undefined',
      path: 'regions',
      create() { return { present: true, value: undefined }; },
    },
    {
      label: 'regions null',
      path: 'regions',
      create() { return { present: true, value: null }; },
    },
    {
      label: 'regions number',
      path: 'regions',
      create() { return { present: true, value: 17 }; },
    },
    {
      label: 'regions string',
      path: 'regions',
      create() { return { present: true, value: 'regions' }; },
    },
    {
      label: 'regions non-array object',
      path: 'regions',
      create() { return { present: true, value: { current: true } }; },
    },
    {
      label: 'regions empty array',
      path: 'regions',
      create() { return { present: true, value: [] }; },
    },
    {
      label: 'region array with valid properties',
      path: 'regions[1]',
      create: arrayWithRegionProperties,
    },
    {
      label: 'region class instance',
      path: 'regions[1]',
      create(fixture) {
        class RegionInstance {}
        const regions = structuredClone(fixture.regions);
        regions[1] = Object.assign(
          new RegionInstance(),
          structuredClone(regions[1]),
        );
        return { present: true, value: regions };
      },
    },
    {
      label: 'region custom prototype',
      path: 'regions[1]',
      create(fixture) {
        const regions = structuredClone(fixture.regions);
        regions[1] = Object.assign(
          Object.create({ authority: 'foreign' }),
          structuredClone(regions[1]),
        );
        return { present: true, value: regions };
      },
    },
    {
      label: 'region null',
      path: 'regions[1]',
      create(fixture) {
        const regions = structuredClone(fixture.regions);
        regions[1] = null;
        return { present: true, value: regions };
      },
    },
    {
      label: 'region number',
      path: 'regions[1]',
      create(fixture) {
        const regions = structuredClone(fixture.regions);
        regions[1] = 23;
        return { present: true, value: regions };
      },
    },
    {
      label: 'region string',
      path: 'regions[1]',
      create(fixture) {
        const regions = structuredClone(fixture.regions);
        regions[1] = 'region';
        return { present: true, value: regions };
      },
    },
    {
      label: 'region boolean',
      path: 'regions[1]',
      create(fixture) {
        const regions = structuredClone(fixture.regions);
        regions[1] = true;
        return { present: true, value: regions };
      },
    },
    {
      label: 'region function',
      path: 'regions[1]',
      create(fixture) {
        const regions = structuredClone(fixture.regions);
        regions[1] = function invalidRegion() {};
        return { present: true, value: regions };
      },
    },
    {
      label: 'own region ID removed',
      path: 'regions[1].id',
      create(fixture) {
        const regions = structuredClone(fixture.regions);
        delete regions[1].id;
        return { present: true, value: regions };
      },
    },
    {
      label: 'empty region ID',
      path: 'regions[1].id',
      create(fixture) {
        const regions = structuredClone(fixture.regions);
        regions[1].id = '';
        return { present: true, value: regions };
      },
    },
    {
      label: 'non-text region ID',
      path: 'regions[1].id',
      create(fixture) {
        const regions = structuredClone(fixture.regions);
        regions[1].id = { value: regions[1].id };
        return { present: true, value: regions };
      },
    },
    {
      label: 'duplicate plain-object region ID',
      path: 'regions[1].id',
      create: duplicateRegionId,
    },
  ];

  it.each(negativeCases)(
    'rejects isolated $label before claims and not_applicable',
    ({ label, path, create }) => {
      const fixture = createR2Fixture(`matrix-${label.replaceAll(' ', '-')}`);
      const variant = create(fixture);
      const result = evaluatorFor(fixture, variant);
      assertBlockedEvaluation(result, path);
      const validation = validationFor(fixture, variant);
      expect(validation.valid).toBe(false);
      expect(codes(validation))
        .toContain('MULTILAYER_AUTHORITATIVE_REGIONS_MISSING');
    },
  );

  const mandatoryAtomicCases = [
    {
      label: 'number region',
      path: 'regions[1]',
      create(fixture) {
        const regions = structuredClone(fixture.regions);
        regions[1] = 23;
        return { present: true, value: regions };
      },
    },
    {
      label: 'string region',
      path: 'regions[1]',
      create(fixture) {
        const regions = structuredClone(fixture.regions);
        regions[1] = 'region';
        return { present: true, value: regions };
      },
    },
    {
      label: 'empty array',
      path: 'regions',
      create() { return { present: true, value: [] }; },
    },
    {
      label: 'non-plain region',
      path: 'regions[1]',
      create: arrayWithRegionProperties,
    },
    {
      label: 'duplicate region ID',
      path: 'regions[1].id',
      create: duplicateRegionId,
    },
  ];

  it.each(mandatoryAtomicCases)(
    'blocks the mandatory $label negative through fresh planning and both consumers',
    ({ label, path, create }) => {
      const fixture = createR2Fixture(`mandatory-${label.replaceAll(' ', '-')}`);
      const variant = create(fixture);
      const result = evaluatorFor(fixture, variant);
      assertBlockedEvaluation(result, path);
      assertAtomicPipeline(fixture, variant);
    },
  );

  it('blocks the literal array-with-properties reproduction during fresh C3 planning', () => {
    const fixture = createR2Fixture('literal-fresh');
    const regions = structuredClone(fixture.regions);
    const validRegion = regions[1];
    const malformed = Object.assign([], structuredClone(validRegion));
    regions[1] = malformed;

    expect(Array.isArray(regions[1])).toBe(true);
    const variant = { present: true, value: regions };
    const result = evaluatorFor(fixture, variant);
    assertBlockedEvaluation(result, 'regions[1]');
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'MULTILAYER_AUTHORITATIVE_REGIONS_MISSING',
      path: 'regions[1]',
      evidence: expect.objectContaining({
        index: 1,
        reason: 'region_not_plain_object',
        receivedType: 'array',
      }),
    }));
    const { sequencePlan } = assertAtomicPipeline(fixture, variant);
    expect(codes(sequencePlan)).not.toContain('MULTILAYER_CONTRACT_STALE');
  });

  it('blocks the literal array-with-properties reproduction downstream of a valid plan', () => {
    const fixture = createR2Fixture('literal-downstream');
    const regions = structuredClone(fixture.regions);
    const validRegion = regions[1];
    const malformed = Object.assign([], structuredClone(validRegion));
    regions[1] = malformed;

    expect(Array.isArray(regions[1])).toBe(true);
    expect(fixture.sequencePlan.valid).toBe(true);
    expect(fixture.sequencePlan.multilayerDependencyContract).not.toBeNull();
    expect(fixture.sequencePlan.multilayerDependencyEvaluation.applied).toBe(true);
    const variant = { present: true, value: regions };
    const validation = validationFor(fixture, variant);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(expect.objectContaining({
      code: 'MULTILAYER_AUTHORITATIVE_REGIONS_MISSING',
      path: 'regions[1]',
    }));
    expect(codes(validation)).toContain('MULTILAYER_CONTRACT_STALE');

    const { physicalPlan, canonicalCompilation } = downstreamFor(
      fixture,
      fixture.sequencePlan,
      variant,
    );
    expect(physicalPlan.valid).toBe(false);
    expect(physicalPlan.dispositions).toEqual([]);
    expect(physicalPlan.objectPaths).toEqual([]);
    expect(physicalPlan.summary).toMatchObject({
      physicalSubpathCount: 0,
      physicalPointCount: 0,
      physicalStitchCount: 0,
    });
    expect(canonicalCompilation.valid).toBe(false);
    expect(canonicalCompilation.commands).toEqual([]);
    expect(canonicalCompilation.summary.commandCount).toBe(0);
  });

  it('keeps malformed regional structure outside experimental C3 authority when C3 is OFF', () => {
    const fixture = createR2Fixture('off');
    const variant = arrayWithRegionProperties(fixture);
    const sequencePlan = freshPlanFor(fixture, variant, cConfig({ c3: false }));
    expect(codes(sequencePlan).some(code => code.startsWith('MULTILAYER_'))).toBe(false);
    expect(sequencePlan).not.toHaveProperty('multilayerDependencyContract');
    expect(sequencePlan).not.toHaveProperty('multilayerDependencyTrace');
    expect(sequencePlan.metadata)
      .not.toHaveProperty('multilayerDependencyEvaluatorInvoked');
  });

  it('accepts valid plain RegionV2 objects and an equivalent structural clone', () => {
    const fixture = createR2Fixture('plain-positive');
    expect(fixture.regions.every(region =>
      Object.getPrototypeOf(region) === Object.prototype)).toBe(true);
    const direct = evaluatorFor(fixture, {
      present: true,
      value: fixture.regions,
    });
    const clonedRegions = structuredClone(fixture.regions);
    const cloned = evaluatorFor(fixture, {
      present: true,
      value: clonedRegions,
    });
    expect(direct.status).toBe('validated');
    expect(cloned.status).toBe('validated');
    expect(direct.contract).toEqual(cloned.contract);
    expect(validationFor(fixture, {
      present: true,
      value: clonedRegions,
    }).valid).toBe(true);
  });

  it('accepts a null-prototype RegionV2 because it satisfies the documented plain-object predicate', () => {
    const fixture = createR2Fixture('null-prototype-positive');
    const regions = structuredClone(fixture.regions);
    regions[1] = Object.assign(
      Object.create(null),
      structuredClone(regions[1]),
    );
    expect(Object.getPrototypeOf(regions[1])).toBeNull();
    const variant = { present: true, value: regions };
    const result = evaluatorFor(fixture, variant);
    expect(result.status).toBe('validated');
    expect(result.errors).toEqual([]);
    expect(validationFor(fixture, variant).valid).toBe(true);
  });
});
