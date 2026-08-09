import { describe, expect, it } from 'vitest';
import * as publicApi from '../index.js';
import { createMinimalInternalPipelineFixture } from '../fixtures/minimalInternalPipelineFixture.js';

const runFixture = () => publicApi.runEngineV2InternalPipeline(
  createMinimalInternalPipelineFixture(),
);

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
  'encodedBytes',
  'encodedPayload',
  'encoderResult',
  'dstArtifact',
  'dsbArtifact',
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

describe('Engine V2 minimal internal pipeline', () => {
  it('exposes only the approved narrow public API', () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      'ENGINE_V2_VERSION',
      'runEngineV2InternalPipeline',
      'validateEngineDocumentV2',
    ]);
    expect(publicApi.ENGINE_V2_VERSION).toBe('2');
  });

  it('completes the full chain and creates a valid EngineDocumentV2', () => {
    const result = runFixture();

    expect(result.valid).toBe(true);
    expect(result.terminalStage).toBe('documentValidation');
    expect(result.completedStages).toHaveLength(10);
    expect(result.documentValidation.valid).toBe(true);
    expect(publicApi.validateEngineDocumentV2(result.document).valid).toBe(true);
    expect(result.document.objects.length).toBeGreaterThan(0);
    expect(result.document.threads.length).toBeGreaterThan(0);
    expect(result.document.threadBlocks.length).toBeGreaterThan(0);
    expect(result.stages.physicalGeneration.summary.physicalStitchCount).toBeGreaterThan(0);
    expect(result.document.commands.some(command => command.type === 'stitch')).toBe(true);
    expect(result.document.commands.filter(command => command.type === 'end')).toHaveLength(1);
    expect(result.document.commands.at(-1).type).toBe('end');
  });

  it('is deterministic and does not mutate its input', () => {
    const input = createMinimalInternalPipelineFixture();
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = publicApi.runEngineV2InternalPipeline(input);
    const second = publicApi.runEngineV2InternalPipeline(input);

    expect(first).toEqual(second);
    expect(input).toEqual(snapshot);
  });

  it('fails fast during ingestion and leaves every later stage null', () => {
    const result = publicApi.runEngineV2InternalPipeline({
      sourceRegions: [{ id: 'invalid-region', path_points: [] }],
      planningConfig: { designWidthMm: 20, designHeightMm: 20 },
    });

    expect(result.valid).toBe(false);
    expect(result.terminalStage).toBe('ingestion');
    expect(result.completedStages).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.stages.ingestion.valid).toBe(false);
    Object.entries(result.stages)
      .filter(([name]) => name !== 'ingestion')
      .forEach(([, stage]) => expect(stage).toBeNull());
    expect(result.document).toBeNull();
    expect(result.documentValidation).toBeNull();
  });

  it('resolves threads before technical planning and preserves their references', () => {
    const result = runFixture();
    const threadedIndex = result.completedStages.indexOf('threadedMaterialization');
    const technicalIndex = result.completedStages.indexOf('technicalPlanning');
    const threadIds = new Set(result.stages.threadedMaterialization.threads.map(thread => thread.id));

    expect(threadedIndex).toBeGreaterThanOrEqual(0);
    expect(technicalIndex).toBeGreaterThan(threadedIndex);
    result.stages.threadedMaterialization.objects.forEach(object => {
      expect(threadIds.has(object.threadId)).toBe(true);
      expect(result.stages.technicalPlanning.byObjectId[object.id].threadId).toBe(object.threadId);
    });
  });

  it('does not create binary output, machine formats, encoders, or machine adaptation', () => {
    const result = runFixture();
    const optInResult = publicApi.runEngineV2InternalPipeline({
      ...createMinimalInternalPipelineFixture(),
      physicalConfig: {
        experimentalPhysicalMmStitchLengthInvariant: true,
      },
    });
    const deferredMachineAdaptation = {
      parameters: { deferred: { machineAdaptation: true } },
    };

    expect(
      result.stages.physicalGeneration.config.experimentalPhysicalMmStitchLengthInvariant,
    ).toBe(false);
    expect(optInResult.valid).toBe(true);
    expect(
      optInResult.stages.physicalGeneration.config.experimentalPhysicalMmStitchLengthInvariant,
    ).toBe(true);
    expect(result.metadata).toEqual({
      machineAdaptationApplied: false,
      encodingApplied: false,
      binaryArtifactCreated: false,
    });
    expect(result.document.metadata.machineAdaptationApplied).toBe(false);
    expect(result.document.metadata.encodingApplied).toBe(false);
    expect(result.document.metadata.binaryArtifactCreated).toBe(false);
    expect(containsGeneratedBinaryArtifact(deferredMachineAdaptation)).toBe(false);
    expect(containsGeneratedBinaryArtifact({ machineAdaptationApplied: true })).toBe(true);
    expect(containsGeneratedBinaryArtifact({ encodingApplied: true })).toBe(true);
    expect(containsGeneratedBinaryArtifact({ binaryArtifactCreated: true })).toBe(true);
    expect(containsGeneratedBinaryArtifact({ bytes: new Uint8Array([1]) })).toBe(true);
    expect(containsGeneratedBinaryArtifact({ encoderResult: { format: 'dst' } })).toBe(true);
    expect(containsGeneratedBinaryArtifact({ outputFormat: 'DSB' })).toBe(true);
    expect(containsGeneratedBinaryArtifact(result)).toBe(false);
    expect(optInResult.metadata).toEqual({
      machineAdaptationApplied: false,
      encodingApplied: false,
      binaryArtifactCreated: false,
    });
    expect(optInResult.document.metadata.machineAdaptationApplied).toBe(false);
    expect(optInResult.document.metadata.encodingApplied).toBe(false);
    expect(optInResult.document.metadata.binaryArtifactCreated).toBe(false);
    expect(containsGeneratedBinaryArtifact(optInResult)).toBe(false);
  });
});
