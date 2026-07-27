import { describe, expect, it } from 'vitest';
import * as publicApi from '../index.js';
import {
  createRepresentativeInternalPipelineFixture,
  REPRESENTATIVE_REGION_IDS,
} from '../fixtures/representativeInternalPipelineFixture.js';

const runFixture = () => publicApi.runEngineV2InternalPipeline(
  createRepresentativeInternalPipelineFixture(),
);

function expectSuccessfulResult(result) {
  expect(result.valid, JSON.stringify({
    terminalStage: result.terminalStage,
    errors: result.errors,
  }, null, 2)).toBe(true);
  expect(result.document).not.toBeNull();
  return result;
}

const EFFECTIVE_OUTPUT_FLAGS = new Set([
  'machineAdaptationApplied',
  'machineAdaptationAdded',
  'encodingApplied',
  'encodingAdded',
  'binaryArtifactCreated',
  'DSTEncoderInvoked',
  'DSBEncoderInvoked',
]);

const BINARY_ARTIFACT_FIELDS = new Set([
  'buffer',
  'bytes',
  'byteBuffer',
  'binaryPayload',
  'binaryArtifact',
  'encodedPayload',
  'encodedBytes',
  'dst',
  'dsb',
  'dstBytes',
  'dsbBytes',
  'binaryFile',
  'exportedFile',
]);

function containsGeneratedBinaryArtifact(value, seen = new Set()) {
  if (value === null || value === undefined || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  return Object.entries(value).some(([key, nested]) => {
    if (EFFECTIVE_OUTPUT_FLAGS.has(key) && nested === true) return true;
    if (key === 'encoderInvocationCount' && Number(nested) > 0) return true;
    if (BINARY_ARTIFACT_FIELDS.has(key) && nested !== null && nested !== undefined) return true;
    if (['format', 'fileFormat', 'outputFormat'].includes(key)
      && ['dst', 'dsb'].includes(String(nested).toLowerCase())) return true;
    return containsGeneratedBinaryArtifact(nested, seen);
  });
}

function objectByRegionId(result, regionId) {
  return result.document.objects.find(object => object.regionId === regionId);
}

function executionIndex(result, objectId) {
  return result.stages.sequencePlanning.executionSteps
    .findIndex(step => step.objectId === objectId);
}

describe('Engine V2 representative internal pipeline corpus', () => {
  it('completes all ten stages and terminates at documentValidation', () => {
    const result = expectSuccessfulResult(runFixture());

    expect(result.terminalStage).toBe('documentValidation');
    expect(result.completedStages).toEqual([
      'ingestion',
      'semanticAnalysis',
      'objectPlanning',
      'draftMaterialization',
      'threadedMaterialization',
      'technicalPlanning',
      'sequencePlanning',
      'physicalGeneration',
      'canonicalCompilation',
      'documentValidation',
    ]);
  });

  it('produces a valid EngineDocumentV2', () => {
    const result = expectSuccessfulResult(runFixture());

    expect(result.documentValidation.valid).toBe(true);
    expect(publicApi.validateEngineDocumentV2(result.document).valid).toBe(true);
    expect(result.document.objects).toHaveLength(7);
  });

  it('preserves six threads and seven blocks with one non-consecutive revisit', () => {
    const result = expectSuccessfulResult(runFixture());
    const blocks = result.document.threadBlocks;
    const blockIndexesByThread = new Map();

    blocks.forEach((block, index) => {
      const indexes = blockIndexesByThread.get(block.threadId) || [];
      indexes.push(index);
      blockIndexesByThread.set(block.threadId, indexes);
    });
    const repeated = [...blockIndexesByThread.values()].filter(indexes => indexes.length > 1);
    const assignments = result.stages.threadedMaterialization.assignments;
    const baseFillAssignment = assignments.find(
      assignment => assignment.regionId === REPRESENTATIVE_REGION_IDS.baseFill,
    );
    const repeatedFillAssignment = assignments.find(
      assignment => assignment.regionId === REPRESENTATIVE_REGION_IDS.repeatedColorDetail,
    );
    expect(baseFillAssignment).toBeDefined();
    expect(repeatedFillAssignment).toBeDefined();

    const repeatedThreadId = baseFillAssignment.threadId;
    const repeatedBlockIndexes = blockIndexesByThread.get(repeatedThreadId);
    const baseFill = objectByRegionId(result, REPRESENTATIVE_REGION_IDS.baseFill);
    const repeatedFill = objectByRegionId(
      result,
      REPRESENTATIVE_REGION_IDS.repeatedColorDetail,
    );

    expect(result.document.threads).toHaveLength(6);
    expect(blocks).toHaveLength(7);
    expect(repeated).toHaveLength(1);
    expect(repeatedFillAssignment.threadId).toBe(repeatedThreadId);
    expect(result.document.threads.some(thread => thread.id === repeatedThreadId)).toBe(true);
    expect(repeatedBlockIndexes).toHaveLength(2);
    expect(repeatedBlockIndexes[1] - repeatedBlockIndexes[0]).toBeGreaterThan(1);
    expect(blocks.slice(repeatedBlockIndexes[0] + 1, repeatedBlockIndexes[1])
      .some(block => block.threadId !== repeatedThreadId)).toBe(true);
    expect(blocks[repeatedBlockIndexes[0]].objectIds).toContain(baseFill.id);
    expect(blocks[repeatedBlockIndexes[1]].objectIds).toContain(repeatedFill.id);
    expect(blocks[repeatedBlockIndexes[1]].repeatedThreadReason)
      .toBe('dependency_gated_revisit');
  });

  it('respects multilayer dependencies and places contours after fills', () => {
    const result = expectSuccessfulResult(runFixture());
    const baseFill = objectByRegionId(result, REPRESENTATIVE_REGION_IDS.baseFill);
    const nestedFill = objectByRegionId(result, REPRESENTATIVE_REGION_IDS.nestedFill);
    const overlappingFill = objectByRegionId(
      result,
      REPRESENTATIVE_REGION_IDS.overlappingFill,
    );
    const repeatedFill = objectByRegionId(
      result,
      REPRESENTATIVE_REGION_IDS.repeatedColorDetail,
    );
    const outerContour = objectByRegionId(result, REPRESENTATIVE_REGION_IDS.outerContour);
    const innerContour = objectByRegionId(result, REPRESENTATIVE_REGION_IDS.innerContour);

    expect(nestedFill.dependencyIds).toContain(baseFill.id);
    expect(repeatedFill.dependencyIds).toContain(nestedFill.id);
    expect(outerContour.dependencyIds).toContain(baseFill.id);
    expect(innerContour.dependencyIds).toContain(overlappingFill.id);
    expect(executionIndex(result, nestedFill.id)).toBeGreaterThan(
      executionIndex(result, baseFill.id),
    );
    expect(executionIndex(result, repeatedFill.id)).toBeGreaterThan(
      executionIndex(result, nestedFill.id),
    );
    expect(executionIndex(result, outerContour.id)).toBeGreaterThan(
      executionIndex(result, baseFill.id),
    );
    expect(executionIndex(result, innerContour.id)).toBeGreaterThan(
      executionIndex(result, overlappingFill.id),
    );
  });

  it('is deterministic and does not mutate the representative input', () => {
    const input = createRepresentativeInternalPipelineFixture();
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = expectSuccessfulResult(publicApi.runEngineV2InternalPipeline(input));
    const second = expectSuccessfulResult(runFixture());

    expect(input).toEqual(snapshot);
    expect(first).toEqual(second);
  });

  it('generates stitch commands and exactly one final end command', () => {
    const result = expectSuccessfulResult(runFixture());
    const stitchCommands = result.document.commands
      .filter(command => command.type === 'stitch');
    const endCommands = result.document.commands
      .filter(command => command.type === 'end');

    expect(stitchCommands.length).toBeGreaterThan(0);
    expect(endCommands).toHaveLength(1);
    expect(result.document.commands.at(-1)).toEqual(endCommands[0]);
  });

  it('keeps the experimental physical millimetre invariant disabled', () => {
    const result = expectSuccessfulResult(runFixture());

    expect(
      result.stages.physicalGeneration.config.experimentalPhysicalMmStitchLengthInvariant,
    ).toBe(false);
  });

  it('does not create machine adaptation, encoding, DST, DSB, or binary artifacts', () => {
    const result = expectSuccessfulResult(runFixture());

    expect(result.metadata).toEqual({
      machineAdaptationApplied: false,
      encodingApplied: false,
      binaryArtifactCreated: false,
    });
    expect(result.document.metadata.machineAdaptationApplied).toBe(false);
    expect(result.document.metadata.encodingApplied).toBe(false);
    expect(result.document.metadata.binaryArtifactCreated).toBe(false);
    expect(result.stages.sequencePlanning.config.machineAdaptation).toBe(false);
    expect(result.stages.sequencePlanning.config.encoding).toBe(false);
    expect(containsGeneratedBinaryArtifact(result)).toBe(false);
  });
});
