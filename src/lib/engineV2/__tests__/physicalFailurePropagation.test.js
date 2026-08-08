import { describe, expect, it } from 'vitest';

import { createMinimalInternalPipelineFixture } from '../fixtures/minimalInternalPipelineFixture.js';
import {
  REPRESENTATIVE_REGION_IDS as P7_REPRESENTATIVE_REGION_IDS,
  createRepresentativeInternalPipelineFixture,
} from '../fixtures/representativeInternalPipelineFixture.js';
import { runEngineV2InternalPipeline } from '../internalPipeline.js';
import { compileCanonicalCommandStream } from '../commandCompilation/canonicalCommandCompiler.js';
import { resolvePhysicalGenerationConfig } from '../stitchGeneration/physicalGenerationConfig.js';
import { generatePhysicalUnderlay } from '../stitchGeneration/physicalUnderlayGenerator.js';
import {
  analyzeSatinCrossSections,
  generateSatinPhysicalPath,
} from '../stitchGeneration/satinStitchGenerator.js';

const FAILED_REGION_ID = P7_REPRESENTATIVE_REGION_IDS.repeatedColorDetail;
const FAILED_OBJECT_ID = `object:proposal:${FAILED_REGION_ID}:internal_detail`;

function rectangleObject(widthMm) {
  return {
    id: 'object:p8-satin-width:internal_detail',
    stitchType: 'satin',
    geometry: [
      { x: 0, y: 0 },
      { x: widthMm, y: 0 },
      { x: widthMm, y: 5 },
      { x: 0, y: 5 },
    ],
  };
}

function satinTechnicalSpecification() {
  return {
    fillAnglePlan: {
      normalizedAngleDegrees: 90,
    },
    stitchParameters: {
      spacingMm: 0.4,
      minimumAllowedWidthMm: 1,
      maximumAllowedWidthMm: 7,
      widthVariationRatio: 1,
    },
    pullCompensationPlan: {
      enabled: false,
    },
  };
}

function selectedSatinEntryExit() {
  return {
    entryPoint: { x: 0, y: 0 },
    exitPoint: { x: 0, y: 5 },
  };
}

function createPhysicalFailureFixture() {
  const fixture = createRepresentativeInternalPipelineFixture();
  const failingRegion = fixture.sourceRegions.find(
    region => region.id === FAILED_REGION_ID,
  );
  failingRegion.name = 'synthetic interior detail';
  failingRegion.region_class = 'detail';
  return fixture;
}

function findError(errors, code) {
  return errors.find(error => error.code === code);
}

describe('P8-F1A physical generator failure propagation', () => {
  it('keeps a nominal satin width valid and produces a physical path', () => {
    const config = resolvePhysicalGenerationConfig();
    const result = generateSatinPhysicalPath({
      object: rectangleObject(6),
      technicalSpecification: satinTechnicalSpecification(),
      selectedEntryExit: selectedSatinEntryExit(),
      config,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.subpaths).toHaveLength(1);
    expect(result.subpaths[0].points.length).toBeGreaterThan(0);
  });

  it('accepts satin width exactly at maximum plus boundary tolerance', () => {
    const config = resolvePhysicalGenerationConfig();
    const effectiveMaximumWidthMm =
      satinTechnicalSpecification().stitchParameters.maximumAllowedWidthMm +
      config.boundaryToleranceMm;
    const analysis = analyzeSatinCrossSections({
      object: rectangleObject(effectiveMaximumWidthMm),
      technicalSpecification: satinTechnicalSpecification(),
      config,
    });

    expect(analysis.valid).toBe(true);
    expect(analysis.errors).toEqual([]);
    expect(analysis.sections.length).toBeGreaterThan(0);
    expect(Math.max(...analysis.sections.map(section => section.lengthMm))).toBeCloseTo(
      effectiveMaximumWidthMm,
      6,
    );
  });

  it('rejects width immediately above tolerance with complete causal metrics', () => {
    const config = resolvePhysicalGenerationConfig();
    const specification = satinTechnicalSpecification();
    const effectiveMaximumWidthMm =
      specification.stitchParameters.maximumAllowedWidthMm +
      config.boundaryToleranceMm;
    const widthIncrement = 10 ** -config.coordinatePrecisionDecimals;
    const analysis = analyzeSatinCrossSections({
      object: rectangleObject(effectiveMaximumWidthMm + widthIncrement),
      technicalSpecification: specification,
      config,
    });
    const error = findError(analysis.errors, 'SATIN_WIDTH_ABOVE_MAXIMUM');
    const expectedOffendingCount = analysis.sections.filter(
      section => section.lengthMm > effectiveMaximumWidthMm,
    ).length;

    expect(analysis.valid).toBe(false);
    expect(error).toMatchObject({
      code: 'SATIN_WIDTH_ABOVE_MAXIMUM',
      path: 'sections',
      stage: 'physical_stitch_generation',
      generator: 'satin',
      maximumAllowedWidthMm: 7,
      boundaryToleranceMm: config.boundaryToleranceMm,
      offendingSectionCount: expectedOffendingCount,
    });
    expect(error.actualMaximumWidthMm).toBeCloseTo(
      effectiveMaximumWidthMm + widthIncrement,
      6,
    );
    expect(error.offendingSectionCount).toBeGreaterThan(0);
  });

  it('propagates root cause and wrapper into an invalid physical plan', () => {
    const result = runEngineV2InternalPipeline(createPhysicalFailureFixture());
    const physicalPlan = result.stages.physicalGeneration;
    const rootCause = findError(physicalPlan.errors, 'SATIN_WIDTH_ABOVE_MAXIMUM');
    const wrapper = findError(physicalPlan.errors, 'PHYSICAL_GENERATOR_FAILED');
    const disposition = physicalPlan.dispositions.find(
      entry => entry.objectId === FAILED_OBJECT_ID,
    );
    const failedObject = result.stages.threadedMaterialization.objects.find(
      object => object.id === FAILED_OBJECT_ID,
    );
    const failedSpecification = result.stages.technicalPlanning.specifications.find(
      specification => specification.objectId === FAILED_OBJECT_ID,
    );
    const failedEntryExit = result.stages.sequencePlanning.selectedEntryExitPairs.find(
      selection => selection.objectId === FAILED_OBJECT_ID,
    );
    const topGeneration = generateSatinPhysicalPath({
      object: failedObject,
      technicalSpecification: failedSpecification,
      selectedEntryExit: failedEntryExit,
      config: physicalPlan.config,
    });
    const topCause = findError(topGeneration.errors, 'SATIN_WIDTH_ABOVE_MAXIMUM');
    const consolidatedCauses = physicalPlan.errors.filter(
      error => error.code !== 'PHYSICAL_GENERATOR_FAILED',
    );

    expect(physicalPlan.valid).toBe(false);
    expect(physicalPlan.errors.filter(
      error => error.code === 'SATIN_WIDTH_ABOVE_MAXIMUM',
    )).toHaveLength(1);
    expect(topCause).toBeDefined();
    expect(rootCause).toMatchObject(topCause);
    expect(rootCause).toMatchObject({
      objectId: FAILED_OBJECT_ID,
      generator: 'satin',
      stage: 'physical_stitch_generation',
      maximumAllowedWidthMm: 7,
      boundaryToleranceMm: expect.any(Number),
      offendingSectionCount: expect.any(Number),
    });
    expect(rootCause.actualMaximumWidthMm).toBeGreaterThan(
      rootCause.maximumAllowedWidthMm + rootCause.boundaryToleranceMm,
    );
    expect(wrapper).toMatchObject({
      code: 'PHYSICAL_GENERATOR_FAILED',
      objectId: FAILED_OBJECT_ID,
      generator: 'satin',
      stage: 'physical_stitch_generation',
      causeCodes: ['SATIN_WIDTH_ABOVE_MAXIMUM'],
    });
    expect(disposition).toMatchObject({
      objectId: FAILED_OBJECT_ID,
      status: 'blocked',
      reasonCode: 'PHYSICAL_GENERATOR_FAILED',
    });
    expect(disposition.evidence).toContainEqual(rootCause);
    expect(disposition.evidence).toEqual(consolidatedCauses);
    expect(wrapper.evidence).toEqual(consolidatedCauses);
  });

  it('stops at physicalGeneration without replacing the cause with path missing', () => {
    const result = runEngineV2InternalPipeline(createPhysicalFailureFixture());

    expect(result.valid).toBe(false);
    expect(result.terminalStage).toBe('physicalGeneration');
    expect(result.completedStages.at(-1)).toBe('sequencePlanning');
    expect(result.stages.physicalGeneration.valid).toBe(false);
    expect(result.stages.canonicalCompilation).toBeNull();
    expect(result.documentValidation).toBeNull();
    expect(result.document).toBeNull();
    expect(result.errors.map(error => error.code)).toEqual([
      'SATIN_WIDTH_ABOVE_MAXIMUM',
      'PHYSICAL_GENERATOR_FAILED',
    ]);
    expect(result.errors.some(error => error.code === 'PHYSICAL_PATH_MISSING')).toBe(
      false,
    );
  });

  it('retains successful paths from other objects while blocking the failed object', () => {
    const result = runEngineV2InternalPipeline(createPhysicalFailureFixture());
    const physicalPlan = result.stages.physicalGeneration;
    const failedDisposition = physicalPlan.dispositions.find(
      entry => entry.objectId === FAILED_OBJECT_ID,
    );
    const generatedDispositions = physicalPlan.dispositions.filter(
      entry => entry.status === 'generated',
    );

    expect(physicalPlan.valid).toBe(false);
    expect(physicalPlan.objectPaths.length).toBeGreaterThan(0);
    expect(physicalPlan.objectPaths.some(path => path.objectId === FAILED_OBJECT_ID)).toBe(
      false,
    );
    expect(failedDisposition.status).toBe('blocked');
    expect(generatedDispositions.length).toBeGreaterThan(0);
    expect(
      generatedDispositions.every(entry =>
        physicalPlan.objectPaths.some(path => path.objectId === entry.objectId),
      ),
    ).toBe(true);
  });

  it('preserves legacy non-blocking behavior when blockGeneratorFailure is false', () => {
    const fixture = createPhysicalFailureFixture();
    fixture.physicalConfig = {
      ...(fixture.physicalConfig || {}),
      blockGeneratorFailure: false,
    };
    const result = runEngineV2InternalPipeline(fixture);
    const physicalPlan = result.stages.physicalGeneration;
    const failedDisposition = physicalPlan.dispositions.find(
      entry => entry.objectId === FAILED_OBJECT_ID,
    );

    expect(physicalPlan.valid).toBe(true);
    expect(physicalPlan.errors).toEqual([]);
    expect(failedDisposition).toMatchObject({
      objectId: FAILED_OBJECT_ID,
      status: 'blocked',
      reasonCode: 'PHYSICAL_GENERATOR_FAILED',
    });
    expect(failedDisposition.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SATIN_WIDTH_ABOVE_MAXIMUM',
          objectId: FAILED_OBJECT_ID,
          generator: 'satin',
          stage: 'physical_stitch_generation',
        }),
      ]),
    );
    expect(result.terminalStage).toBe('canonicalCompilation');
    expect(result.errors.some(error => error.code === 'PHYSICAL_PATH_MISSING')).toBe(
      true,
    );
  });

  it('retains PHYSICAL_PATH_MISSING as a secondary canonical defense', () => {
    const positive = runEngineV2InternalPipeline(
      createMinimalInternalPipelineFixture(),
    );
    const physicalPlanWithoutPaths = structuredClone(
      positive.stages.physicalGeneration,
    );
    physicalPlanWithoutPaths.valid = true;
    physicalPlanWithoutPaths.errors = [];
    physicalPlanWithoutPaths.objectPaths = [];
    physicalPlanWithoutPaths.byObjectId = {};
    physicalPlanWithoutPaths.byExecutionStepId = {};

    const compilation = compileCanonicalCommandStream({
      regions: positive.stages.ingestion.regions,
      threadedObjectMaterialization: positive.stages.threadedMaterialization,
      technicalPlan: positive.stages.technicalPlanning,
      sequencePlan: positive.stages.sequencePlanning,
      physicalPlan: physicalPlanWithoutPaths,
    });

    expect(compilation.valid).toBe(false);
    expect(compilation.errors.some(error => error.code === 'PHYSICAL_PATH_MISSING')).toBe(
      true,
    );
  });

  it('keeps the P6 minimal and P7 representative positive pipelines valid', () => {
    const minimal = runEngineV2InternalPipeline(
      createMinimalInternalPipelineFixture(),
    );
    const representative = runEngineV2InternalPipeline(
      createRepresentativeInternalPipelineFixture(),
    );

    expect(minimal.valid).toBe(true);
    expect(minimal.terminalStage).toBe('documentValidation');
    expect(representative.valid).toBe(true);
    expect(representative.terminalStage).toBe('documentValidation');
  });

  it('propagates deterministically without mutating the failing input', () => {
    const input = createPhysicalFailureFixture();
    const inputSnapshot = structuredClone(input);
    const first = runEngineV2InternalPipeline(input);
    const second = runEngineV2InternalPipeline(createPhysicalFailureFixture());
    const firstErrors = first.stages.physicalGeneration.errors;
    const secondErrors = second.stages.physicalGeneration.errors;
    const firstDisposition = first.stages.physicalGeneration.dispositions.find(
      entry => entry.objectId === FAILED_OBJECT_ID,
    );
    const secondDisposition = second.stages.physicalGeneration.dispositions.find(
      entry => entry.objectId === FAILED_OBJECT_ID,
    );

    expect(input).toEqual(inputSnapshot);
    expect(firstErrors).toEqual(secondErrors);
    expect(firstDisposition).toEqual(secondDisposition);
    expect(firstErrors.map(error => error.code)).toEqual([
      'SATIN_WIDTH_ABOVE_MAXIMUM',
      'PHYSICAL_GENERATOR_FAILED',
    ]);
    expect(firstErrors[0]).toMatchObject({
      objectId: FAILED_OBJECT_ID,
      generator: 'satin',
      stage: 'physical_stitch_generation',
      actualMaximumWidthMm: expect.any(Number),
      maximumAllowedWidthMm: expect.any(Number),
      boundaryToleranceMm: expect.any(Number),
      offendingSectionCount: expect.any(Number),
    });

    const underlayOnlyInput = createPhysicalFailureFixture();
    underlayOnlyInput.physicalConfig = {
      ...(underlayOnlyInput.physicalConfig || {}),
      includeTopStitches: false,
    };
    const underlayOnly = runEngineV2InternalPipeline(underlayOnlyInput);
    const underlayOnlyPlan = underlayOnly.stages.physicalGeneration;
    const underlayOnlyObject = underlayOnly.stages.threadedMaterialization.objects.find(
      object => object.id === FAILED_OBJECT_ID,
    );
    const underlayOnlySpecification =
      underlayOnly.stages.technicalPlanning.specifications.find(
        specification => specification.objectId === FAILED_OBJECT_ID,
      );
    const underlayOnlySelection =
      underlayOnly.stages.sequencePlanning.selectedEntryExitPairs.find(
        selection => selection.objectId === FAILED_OBJECT_ID,
      );
    const rawUnderlay = generatePhysicalUnderlay({
      object: underlayOnlyObject,
      technicalSpecification: underlayOnlySpecification,
      selectedEntryExit: underlayOnlySelection,
      config: underlayOnlyPlan.config,
    });
    const rawUnderlayWidthCauses = rawUnderlay.errors.filter(
      error => error.code === 'SATIN_WIDTH_ABOVE_MAXIMUM',
    );
    const underlayRootCauses = underlayOnlyPlan.errors.filter(
      error => error.code === 'SATIN_WIDTH_ABOVE_MAXIMUM',
    );
    const underlayWrapper = findError(
      underlayOnlyPlan.errors,
      'PHYSICAL_GENERATOR_FAILED',
    );
    const underlayDisposition = underlayOnlyPlan.dispositions.find(
      entry => entry.objectId === FAILED_OBJECT_ID,
    );

    expect(rawUnderlayWidthCauses.length).toBeGreaterThan(1);
    expect(underlayRootCauses).toHaveLength(1);
    expect(underlayRootCauses[0]).toMatchObject(rawUnderlayWidthCauses[0]);
    expect(underlayDisposition.evidence).toEqual([underlayRootCauses[0]]);
    expect(underlayWrapper.evidence).toEqual([underlayRootCauses[0]]);
  });
});
