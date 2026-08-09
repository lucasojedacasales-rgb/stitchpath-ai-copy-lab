import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileCanonicalCommandStream } from '../commandCompilation/canonicalCommandCompiler.js';
import { ingestV1RegionsToRegionGraphV2 } from '../ingestion/regionIngestion.js';
import { materializeEmbroideryObjectDrafts } from '../materialization/objectDraftMaterializer.js';
import { buildEmbroideryObjectProposalPlan } from '../planning/objectPlanningPipeline.js';
import { buildGlobalSequencePlan } from '../sequencing/globalSequencePlanner.js';
import { createSemanticRegionAssessmentV2 } from '../semantics/semanticRoleModel.js';
import { buildMachineIndependentPhysicalStitchPlan } from '../stitchGeneration/physicalStitchPipeline.js';
import { buildTechnicalEmbroideryPlan } from '../technical/technicalPlanningPipeline.js';
import { materializeThreadedEmbroideryObjects } from '../threads/finalObjectMaterializer.js';

const SATIN_RANGE = 'SATIN-RANGE-OBSERVED-001';
const LOCAL_WIDTH = 'LOCAL-WIDTH-PROFILE-001';
const HOLE_PRESERVE = 'HOLE-PRESERVE-001';
const HOLE_MIN_SIZE = 'HOLE-MIN-SIZE-001';
const DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM = 7;
const EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM = 9.18;

function polygon(id, role, x, y, widthMm, heightMm, holes = []) {
  return {
    source: {
      id,
      color: role === 'internal_feature' ? '#221144' : '#55aa66',
      region_class: role === 'internal_feature' ? 'detail' : 'body',
      path_points: [
        [x, y],
        [x + widthMm / 100, y],
        [x + widthMm / 100, y + heightMm / 100],
        [x, y + heightMm / 100],
      ],
      holes,
    },
    role,
  };
}

function squareHole(centerX, centerY, sideMm) {
  const half = sideMm / 200;
  return [
    [centerX - half, centerY - half],
    [centerX - half, centerY + half],
    [centerX + half, centerY + half],
    [centerX + half, centerY - half],
  ];
}

function corpusSources() {
  return [
    polygon('corpus-satin', 'internal_feature', 0.05, 0.05, 8, 16),
    polygon('corpus-local', 'internal_feature', 0.2, 0.05, 6, 15),
    polygon('corpus-hole-safe', 'primary_shape', 0.4, 0.05, 25, 25, [squareHole(0.525, 0.175, 1.2)]),
    polygon('corpus-hole-small', 'primary_shape', 0.7, 0.05, 25, 25, [squareHole(0.825, 0.175, 0.8)]),
  ];
}

function planningConfig(ruleIds, activationMode) {
  if (ruleIds === null) return {};
  return {
    hatchEvidenceProfile: 'hatch-a-f-experimental',
    ...(activationMode === undefined ? {} : { hatchEvidenceActivationMode: activationMode }),
    hatchEvidenceRuleFlags: Object.fromEntries(ruleIds.map(ruleId => [ruleId, true])),
    hatchEvidenceContext: {
      fabricProfile: 'Pure Cotton',
      referenceScaleCompatible: true,
    },
  };
}

function semanticResultFor(regions, rolesById) {
  const assessments = regions.map(region => createSemanticRegionAssessmentV2({
    regionId: region.id,
    semanticRole: rolesById[region.id],
    confidence: 0.95,
    evidence: [{ code: 'HATCH_AB_CORPUS_ROLE', message: 'Controlled A/B corpus role.' }],
  }));
  return {
    assessments,
    byRegionId: Object.fromEntries(assessments.map(assessment => [assessment.regionId, assessment])),
    valid: true,
    errors: [],
    warnings: [],
  };
}

function countCommands(compilation, type) {
  return compilation.commands.filter(command => command.type === type).length;
}

function operationalSnapshot(run) {
  return {
    proposalTechniques: Object.fromEntries(run.proposalPlan.proposals.map(proposal => [proposal.regionId, proposal.proposedStitchType])),
    proposalGeometry: run.proposalPlan.proposals.map(proposal => ({
      regionId: proposal.regionId,
      geometryMm: proposal.geometryMm,
      holesMm: proposal.holesMm,
    })),
    proposalCount: run.proposalPlan.proposals.length,
    activeProposalCount: run.proposalPlan.summary.activeProposalCount,
    manualReviewCount: run.proposalPlan.summary.manualReviewCount,
    technicalSatinMaximumWidthMm: run.technicalPlan.config.satin.maximumWidthMm,
    objectCount: run.threadedObjectMaterialization.objects.length,
    physicalStitchCount: run.physicalPlan.summary.physicalStitchCount,
    commandCount: run.canonicalCompilation.commands.length,
    stitchCommands: countCommands(run.canonicalCompilation, 'stitch'),
    jumpCommands: countCommands(run.canonicalCompilation, 'jump'),
    trimCommands: countCommands(run.canonicalCompilation, 'trim'),
    physicalSourceStitchCommands: run.canonicalCompilation.commands
      .filter(command => command.reasonCode === 'PHYSICAL_SOURCE_STITCH').length,
    connectorStitchCommands: run.canonicalCompilation.commands
      .filter(command => command.reasonCode === 'SAFE_SUBPATH_CONNECTOR').length,
  };
}

function intrinsicProposalSnapshot(run) {
  return Object.fromEntries(run.proposalPlan.proposals.map(proposal => [proposal.regionId, {
    proposedEmbroideryRole: proposal.proposedEmbroideryRole,
    proposedStitchType: proposal.proposedStitchType,
    needsReview: proposal.needsReview,
    excluded: proposal.excluded,
    geometryMm: proposal.geometryMm,
    holesMm: proposal.holesMm,
  }]));
}

function intrinsicPhysicalRegionSnapshot(run) {
  return Object.fromEntries(run.proposalPlan.proposals.map(proposal => {
    const object = run.threadedObjectMaterialization.objects
      .find(item => item.regionId === proposal.regionId) ?? null;
    const path = run.physicalPlan.objectPaths
      .find(item => item.regionId === proposal.regionId) ?? null;
    const commands = run.canonicalCompilation.commands
      .filter(command => command.regionId === proposal.regionId);
    return [proposal.regionId, {
      proposedEmbroideryRole: proposal.proposedEmbroideryRole,
      proposedStitchType: proposal.proposedStitchType,
      needsReview: proposal.needsReview,
      geometryMm: proposal.geometryMm,
      holesMm: proposal.holesMm,
      objectCount: object ? 1 : 0,
      finalStitchType: object?.stitchType ?? null,
      physicalPathCount: path ? 1 : 0,
      physicalStitchCount: path?.physicalStitchCount ?? 0,
      underlayStitchCount: path?.underlayStitchCount ?? 0,
      topStitchCount: path?.topStitchCount ?? 0,
      physicalSourceStitchCommands: commands
        .filter(command => command.reasonCode === 'PHYSICAL_SOURCE_STITCH').length,
    }];
  }));
}

function runCorpus(
  ruleIds = null,
  technicalSatinMaximumWidthMm = DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM,
  activationMode,
) {
  const definitions = corpusSources();
  const sourceRegions = definitions.map(item => item.source);
  const sourceBefore = structuredClone(sourceRegions);
  const rolesById = Object.fromEntries(definitions.map(item => [item.source.id, item.role]));
  const ingestion = ingestV1RegionsToRegionGraphV2(sourceRegions, { coordinateSpace: 'normalized' });
  const semanticResult = semanticResultFor(ingestion.regions, rolesById);
  const technicalConfig = technicalSatinMaximumWidthMm === DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM
    ? {}
    : { satin: { maximumWidthMm: technicalSatinMaximumWidthMm } };
  const proposalPlan = buildEmbroideryObjectProposalPlan({
    regions: ingestion.regions,
    graph: ingestion.graph,
    semanticResult,
    config: planningConfig(ruleIds, activationMode),
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
    proposalPlan,
    objectDraftMaterialization,
    threadedObjectMaterialization,
    technicalPlan,
    sequencePlan,
    physicalPlan,
    canonicalCompilation,
  };
}

function expectValidPreExportRun(run) {
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
  expect(run.canonicalCompilation).not.toHaveProperty('artifact');
  expect(run.canonicalCompilation.metadata.machineAdaptationAdded).toBe(false);
  expect(run.canonicalCompilation.metadata.encodingAdded).toBe(false);
}

describe('Hatch A/B planning corpus before export', () => {
  it('keeps all-flags-OFF operationally identical to legacy', () => {
    const legacy = runCorpus();
    const allOff = runCorpus([]);
    expectValidPreExportRun(legacy);
    expectValidPreExportRun(allOff);
    expect(operationalSnapshot(allOff)).toEqual(operationalSnapshot(legacy));
  });

  it('retains tatami with the effective default 7 mm maximum', () => {
    const legacy = runCorpus();
    const satin = runCorpus([SATIN_RANGE], DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM);
    expectValidPreExportRun(satin);
    const legacySnapshot = operationalSnapshot(legacy);
    const satinSnapshot = operationalSnapshot(satin);
    expect(legacySnapshot.proposalTechniques['corpus-satin']).toBe('tatami');
    expect(satinSnapshot.proposalTechniques['corpus-satin']).toBe('tatami');
    expect(satinSnapshot).toEqual(legacySnapshot);
    expect(satin.proposalPlan.byRegionId['corpus-satin'].source.hatchEvidence.evaluations[0]).toMatchObject({
      effectiveTechnicalSatinMaximumWidthMm: 7,
      fallbackReason: 'width_above_technical_maximum',
    });
  });

  it('changes only the accredited satin candidate when 9.18 mm reaches both planning stages', () => {
    const legacy = runCorpus(null, EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM);
    const satin = runCorpus([SATIN_RANGE], EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM);
    expectValidPreExportRun(legacy);
    expectValidPreExportRun(satin);
    const legacySnapshot = operationalSnapshot(legacy);
    const satinSnapshot = operationalSnapshot(satin);
    expect(legacySnapshot.technicalSatinMaximumWidthMm).toBe(9.18);
    expect(legacySnapshot.proposalTechniques['corpus-satin']).toBe('tatami');
    expect(satinSnapshot.proposalTechniques['corpus-satin']).toBe('satin');
    expect(satinSnapshot.proposalGeometry).toEqual(legacySnapshot.proposalGeometry);
    expect(satinSnapshot.objectCount).toBe(legacySnapshot.objectCount);
    expect(satinSnapshot.physicalStitchCount).not.toBe(legacySnapshot.physicalStitchCount);
    expect(satin.proposalPlan.byRegionId['corpus-satin'].source.hatchEvidence.evaluations[0])
      .toMatchObject({ effectiveTechnicalSatinMaximumWidthMm: 9.18, fallbackReason: null });
  });

  it('keeps LOCAL-WIDTH diagnostic-only until its missing metrics exist', () => {
    const legacy = runCorpus();
    const local = runCorpus([LOCAL_WIDTH]);
    expectValidPreExportRun(local);
    expect(operationalSnapshot(local)).toEqual(operationalSnapshot(legacy));
    expect(local.proposalPlan.byRegionId['corpus-local'].source.hatchEvidence.evaluations.map(item => item.ruleId)).toEqual([LOCAL_WIDTH]);
  });

  it('keeps HOLE-PRESERVE geometry and all operational metrics unchanged', () => {
    const legacy = runCorpus();
    const preserve = runCorpus([HOLE_PRESERVE]);
    expectValidPreExportRun(preserve);
    expect(operationalSnapshot(preserve)).toEqual(operationalSnapshot(legacy));
    expect(preserve.proposalPlan.byRegionId['corpus-hole-safe'].source.hatchEvidence.evaluations.map(item => item.ruleId)).toEqual([HOLE_PRESERVE]);
  });

  it('routes only the demonstrated small hole to manual review', () => {
    const legacy = runCorpus();
    const minimum = runCorpus([HOLE_MIN_SIZE]);
    expectValidPreExportRun(minimum);
    const legacySnapshot = operationalSnapshot(legacy);
    const minimumSnapshot = operationalSnapshot(minimum);
    expect(minimumSnapshot.proposalTechniques['corpus-hole-small']).toBe('manual');
    expect(minimumSnapshot.proposalTechniques['corpus-hole-safe']).toBe('tatami');
    expect(minimumSnapshot.proposalGeometry).toEqual(legacySnapshot.proposalGeometry);
    expect(minimumSnapshot.objectCount).toBe(legacySnapshot.objectCount - 1);
    expect(minimumSnapshot.physicalStitchCount).toBeLessThan(legacySnapshot.physicalStitchCount);
  });

  it('keeps every flag combination deterministic', () => {
    const combinations = [
      [[], DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM, { objectCount: 4, physicalStitchCount: 1337, stitchCommands: 1516, jumpCommands: 25, trimCommands: 24 }],
      [[SATIN_RANGE], DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM, { objectCount: 4, physicalStitchCount: 1337, stitchCommands: 1516, jumpCommands: 25, trimCommands: 24 }],
      [[SATIN_RANGE], EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM, { objectCount: 4, physicalStitchCount: 1310, stitchCommands: 1450, jumpCommands: 24, trimCommands: 23 }],
      [[LOCAL_WIDTH], DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM, { objectCount: 4, physicalStitchCount: 1337, stitchCommands: 1516, jumpCommands: 25, trimCommands: 24 }],
      [[HOLE_PRESERVE], DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM, { objectCount: 4, physicalStitchCount: 1337, stitchCommands: 1516, jumpCommands: 25, trimCommands: 24 }],
      [[HOLE_MIN_SIZE], DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM, { objectCount: 3, physicalStitchCount: 765, stitchCommands: 876, jumpCommands: 17, trimCommands: 16 }],
      [[SATIN_RANGE, LOCAL_WIDTH, HOLE_PRESERVE, HOLE_MIN_SIZE], EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM, {
        objectCount: 3,
        physicalStitchCount: 738,
        stitchCommands: 810,
        jumpCommands: 16,
        trimCommands: 15,
      }],
    ];
    combinations.forEach(([ruleIds, technicalMaximum, expectedMetrics]) => {
      const first = operationalSnapshot(runCorpus(ruleIds, technicalMaximum));
      const second = operationalSnapshot(runCorpus(ruleIds, technicalMaximum));
      const firstHash = crypto.createHash('sha256').update(JSON.stringify(first)).digest('hex');
      const secondHash = crypto.createHash('sha256').update(JSON.stringify(second)).digest('hex');
      expect(firstHash).toBe(secondHash);
      expect(first).toMatchObject(expectedMetrics);
    });
  }, 15000);
});

describe('R03 controlled Hatch A/B planning corpus', () => {
  const CONTROLLED_OPT_IN = 'controlled-opt-in';

  it('falls back operationally to legacy with every controlled flag OFF', () => {
    const legacy = runCorpus();
    const controlledOff = runCorpus([], DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM, CONTROLLED_OPT_IN);
    expectValidPreExportRun(legacy);
    expectValidPreExportRun(controlledOff);
    expect(operationalSnapshot(controlledOff)).toEqual(operationalSnapshot(legacy));
    controlledOff.proposalPlan.proposals.forEach(proposal => {
      expect(proposal.source).not.toHaveProperty('hatchEvidence');
    });
  });

  it('preserves the existing individual operational results under explicit controlled opt-in', () => {
    const legacy = runCorpus();
    const legacy918 = runCorpus(null, EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM);
    const experimentalSatin = runCorpus([SATIN_RANGE], EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM);
    const controlledSatin = runCorpus(
      [SATIN_RANGE],
      EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM,
      CONTROLLED_OPT_IN,
    );
    const controlledNegative = runCorpus(
      [SATIN_RANGE],
      DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM,
      CONTROLLED_OPT_IN,
    );
    const experimentalMinimum = runCorpus([HOLE_MIN_SIZE]);
    const controlledMinimum = runCorpus(
      [HOLE_MIN_SIZE],
      DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM,
      CONTROLLED_OPT_IN,
    );
    [legacy, legacy918, experimentalSatin, controlledSatin, controlledNegative, experimentalMinimum, controlledMinimum]
      .forEach(expectValidPreExportRun);

    expect(operationalSnapshot(controlledSatin)).toEqual(operationalSnapshot(experimentalSatin));
    expect(operationalSnapshot(controlledNegative)).toEqual(operationalSnapshot(legacy));
    expect(operationalSnapshot(controlledMinimum)).toEqual(operationalSnapshot(experimentalMinimum));
    expect(controlledSatin.proposalPlan.byRegionId['corpus-satin'].source.hatchEvidence).toMatchObject({
      activationMode: CONTROLLED_OPT_IN,
      operationalRuleIds: [SATIN_RANGE],
      diagnosticRuleIds: [],
      effectiveRuleIds: [SATIN_RANGE],
    });
    expect(controlledMinimum.proposalPlan.byRegionId['corpus-hole-small']).toMatchObject({
      proposedStitchType: 'manual',
      needsReview: true,
    });
    expect(operationalSnapshot(legacy918).proposalTechniques['corpus-satin']).toBe('tatami');
  });

  it('keeps both controlled diagnostic rules operationally identical to legacy', () => {
    const legacy = runCorpus();
    const local = runCorpus([LOCAL_WIDTH], DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM, CONTROLLED_OPT_IN);
    const preserve = runCorpus([HOLE_PRESERVE], DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM, CONTROLLED_OPT_IN);
    [legacy, local, preserve].forEach(expectValidPreExportRun);
    expect(operationalSnapshot(local)).toEqual(operationalSnapshot(legacy));
    expect(operationalSnapshot(preserve)).toEqual(operationalSnapshot(legacy));
    expect(local.proposalPlan.byRegionId['corpus-local'].source.hatchEvidence).toMatchObject({
      operationalRuleIds: [],
      diagnosticRuleIds: [LOCAL_WIDTH],
    });
    expect(preserve.proposalPlan.byRegionId['corpus-hole-safe'].source.hatchEvidence).toMatchObject({
      operationalRuleIds: [],
      diagnosticRuleIds: [HOLE_PRESERVE],
    });
  });

  it('preserves survivor intrinsic identity while allowing the accredited global resequencing', () => {
    const legacy = runCorpus();
    const minimum = runCorpus([HOLE_MIN_SIZE], DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM, CONTROLLED_OPT_IN);
    expectValidPreExportRun(legacy);
    expectValidPreExportRun(minimum);
    const legacyIntrinsic = intrinsicProposalSnapshot(legacy);
    const minimumIntrinsic = intrinsicProposalSnapshot(minimum);
    const legacyPhysicalIntrinsic = intrinsicPhysicalRegionSnapshot(legacy);
    const minimumPhysicalIntrinsic = intrinsicPhysicalRegionSnapshot(minimum);
    ['corpus-satin', 'corpus-local', 'corpus-hole-safe'].forEach(regionId => {
      expect(minimumIntrinsic[regionId]).toEqual(legacyIntrinsic[regionId]);
      expect(minimumPhysicalIntrinsic[regionId]).toEqual(legacyPhysicalIntrinsic[regionId]);
    });
    expect(minimumIntrinsic['corpus-hole-small']).toMatchObject({
      proposedEmbroideryRole: 'manual_review',
      proposedStitchType: 'manual',
      needsReview: true,
    });
    expect(operationalSnapshot(legacy)).toMatchObject({
      objectCount: 4,
      physicalStitchCount: 1337,
      stitchCommands: 1516,
      jumpCommands: 25,
      trimCommands: 24,
    });
    expect(operationalSnapshot(minimum)).toMatchObject({
      objectCount: 3,
      physicalStitchCount: 765,
      stitchCommands: 876,
      jumpCommands: 17,
      trimCommands: 16,
    });
  });

  it('combines controlled HOLE-MIN with a diagnostic rule without changing its localized effect', () => {
    const legacy = runCorpus();
    const minimum = runCorpus([HOLE_MIN_SIZE], DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM, CONTROLLED_OPT_IN);
    const mixed = runCorpus(
      [HOLE_PRESERVE, HOLE_MIN_SIZE],
      DEFAULT_TECHNICAL_SATIN_MAXIMUM_MM,
      CONTROLLED_OPT_IN,
    );
    [legacy, minimum, mixed].forEach(expectValidPreExportRun);
    expect(operationalSnapshot(mixed)).toEqual(operationalSnapshot(minimum));
    expect(intrinsicPhysicalRegionSnapshot(mixed)).toEqual(intrinsicPhysicalRegionSnapshot(minimum));

    const legacyIntrinsic = intrinsicPhysicalRegionSnapshot(legacy);
    const mixedIntrinsic = intrinsicPhysicalRegionSnapshot(mixed);
    const changedRegionIds = Object.keys(mixedIntrinsic)
      .filter(regionId => JSON.stringify(mixedIntrinsic[regionId]) !== JSON.stringify(legacyIntrinsic[regionId]));
    expect(changedRegionIds).toEqual(['corpus-hole-small']);
    expect(mixed.proposalPlan.byRegionId['corpus-hole-small']).toMatchObject({
      proposedEmbroideryRole: 'manual_review',
      proposedStitchType: 'manual',
      needsReview: true,
    });
    expect(mixed.proposalPlan.byRegionId['corpus-hole-safe']).toMatchObject({
      proposedStitchType: 'tatami',
      needsReview: false,
    });
    expect(mixed.proposalPlan.byRegionId['corpus-hole-small'].source.hatchEvidence).toMatchObject({
      operationalRuleIds: [HOLE_MIN_SIZE],
      diagnosticRuleIds: [HOLE_PRESERVE],
      effectiveRuleIds: [HOLE_PRESERVE, HOLE_MIN_SIZE],
    });
  });

  it('rejects controlled operational conflict and ALL-ON before downstream effects', () => {
    const legacy = runCorpus(null, EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM);
    const conflict = runCorpus(
      [SATIN_RANGE, HOLE_MIN_SIZE],
      EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM,
      CONTROLLED_OPT_IN,
    );
    const allOn = runCorpus(
      [SATIN_RANGE, LOCAL_WIDTH, HOLE_PRESERVE, HOLE_MIN_SIZE],
      EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM,
      CONTROLLED_OPT_IN,
    );
    expect(conflict.proposalPlan.valid).toBe(false);
    expect(conflict.proposalPlan.errors[0].code).toBe('HATCH_CONTROLLED_OPT_IN_OPERATIONAL_CONFLICT');
    expect(allOn.proposalPlan.valid).toBe(false);
    expect(allOn.proposalPlan.errors[0].code).toBe('HATCH_CONTROLLED_OPT_IN_ALL_ON_FORBIDDEN');
    expect(intrinsicProposalSnapshot(conflict)).toEqual(intrinsicProposalSnapshot(legacy));
    expect(intrinsicProposalSnapshot(allOn)).toEqual(intrinsicProposalSnapshot(legacy));
    [...conflict.proposalPlan.proposals, ...allOn.proposalPlan.proposals].forEach(proposal => {
      expect(proposal.source).not.toHaveProperty('hatchEvidence');
    });
  });

  it('is deterministic and input-immutable with one operational rule plus both diagnostics', () => {
    const ruleIds = [SATIN_RANGE, LOCAL_WIDTH, HOLE_PRESERVE];
    const first = runCorpus(ruleIds, EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM, CONTROLLED_OPT_IN);
    const second = runCorpus(ruleIds, EXPERIMENTAL_TECHNICAL_SATIN_MAXIMUM_MM, CONTROLLED_OPT_IN);
    expectValidPreExportRun(first);
    expectValidPreExportRun(second);
    const firstSnapshot = operationalSnapshot(first);
    const secondSnapshot = operationalSnapshot(second);
    expect(secondSnapshot).toEqual(firstSnapshot);
    expect(crypto.createHash('sha256').update(JSON.stringify(secondSnapshot)).digest('hex'))
      .toBe(crypto.createHash('sha256').update(JSON.stringify(firstSnapshot)).digest('hex'));
  }, 15000);
});
