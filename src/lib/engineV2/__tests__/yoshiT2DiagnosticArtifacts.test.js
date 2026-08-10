// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import './yoshiT2RunnerPanel.test.jsx';

import { experimentalEngineV2RasterObservation } from '../../engineV2Bridge/featureFlags.js';
import { adaptLegacyRasterPipelineResultToEngineV2Input } from '../../engineV2Bridge/legacyRasterToEngineV2Input.js';
import { runExperimentalEngineV2Bridge } from '../../engineV2Bridge/runExperimentalEngineV2Bridge.js';
import { observeLegacyRasterPipelineResult } from '../../engineV2Bridge/runExperimentalRasterEngineV2Connector.js';
import {
  YOSHI_T2_ACTIVATION,
  YOSHI_T2_ARTIFACT_NAMES,
  YOSHI_T2_EXPECTED_FILE,
  YOSHI_T2_PIPELINE_CONFIG,
  YOSHI_T2_R02_REFERENCE,
  YOSHI_T2_REQUIRED_STAGES,
  buildYoshiT2DiagnosticArtifacts,
  downloadYoshiT2Artifact,
  executeYoshiT2DiagnosticRun,
  inspectYoshiT2File,
  validateYoshiT2FileMetadata,
  validateYoshiT2FileSelection,
  validateYoshiT2Observation,
} from '../../engineV2Bridge/yoshiT2DiagnosticArtifacts.js';

const FALSE_METADATA = Object.freeze({
  machineAdaptationApplied: false,
  encodingApplied: false,
  binaryArtifactCreated: false,
});
const T1_BOUNDARY_METADATA = Object.freeze({
  ...FALSE_METADATA,
  dstArtifactCount: 0,
  dsbArtifactCount: 0,
});

function sourceRegion(overrides = {}) {
  return {
    id: 't1-yoshi-region',
    color: '#228833',
    visible: true,
    path_points: [[0, 0], [1, 0], [0, 1]],
    holes: [],
    source: {
      adapter: 't1-legacy-raster-observation',
      coordinateSpace: 'normalized',
      sourceWidthPx: 360,
      sourceHeightPx: 482,
      sourceGeometryField: 'path_points',
      sourceHoleGeometryField: null,
      reportedLegacyHoleCount: 0,
    },
    ...overrides,
  };
}

function coordinateContract() {
  return {
    coordinateSpace: 'normalized',
    sourceWidthPx: 360,
    sourceHeightPx: 482,
    designWidthMm: 83.4,
    designHeightMm: 114.3,
  };
}

function adaptationMetadata(regionCount = 1) {
  return {
    sourceBoundary: 'completed-legacy-raster-pipeline',
    sourceRegionCount: regionCount,
    adaptedRegionCount: regionCount,
    partialAdaptationApplied: false,
    techniquesImported: false,
    legacyRelationshipsImported: false,
    deterministicIdsApplied: true,
    legacyIdsImportedAsIdentity: false,
  };
}

function adaptationProvenance(regions) {
  return {
    purpose: 'diagnostic-only',
    legacyRegionProvenance: regions.map((region, index) => ({
      sourceRegionId: region.id,
      legacyRegionId: `legacy-${index + 1}`,
      sourceIndex: index,
    })),
  };
}

function enginePoints(points) {
  return points.map(([x, y]) => ({ x, y }));
}

function documentRegion(source) {
  return {
    id: source.id,
    geometry: enginePoints(source.path_points),
    holes: source.holes.map(enginePoints),
    visualColor: source.color,
    semanticRole: source.semanticRole ?? null,
    source: {
      originalSourceId: source.id,
      originalSource: source.source,
      name: source.name ?? null,
      object: source.object ?? null,
      objectGroup: source.object_group ?? null,
      regionClass: source.region_class ?? null,
      visible: source.visible !== false,
      coordinateSpace: source.source.coordinateSpace,
    },
  };
}

function expectedFileMetadata(overrides = {}) {
  return { ...YOSHI_T2_EXPECTED_FILE, ...overrides };
}

function legacyResult({ stages, regions } = {}) {
  return {
    imageUrl: 'blob:yoshi-t2-input-must-not-be-published',
    config: { ...YOSHI_T2_PIPELINE_CONFIG, token: 'legacy-token-must-not-leak' },
    analysis: { imageWidth: 360, imageHeight: 482 },
    regions: regions ?? [{ id: 'legacy-yoshi-region', color: '#228833' }],
    plan: { sequence: ['legacy-yoshi-region'] },
    optimized: { sequence: ['legacy-yoshi-region'] },
    session: { id: 'legacy-session-must-not-leak' },
    stageLog: stages ?? YOSHI_T2_REQUIRED_STAGES.map((stage, index) => ({
      stage,
      ok: true,
      durationMs: index + 1,
      ts: 1_800_000_000_000 + index,
    })),
  };
}

function successfulObservation({
  legacy = legacyResult(),
  status = 'completed',
  reasonCode = null,
  requested = true,
  resultValid = true,
  documentValid = true,
  commands = [{ id: 'command-1', type: 'stitch', x: 1, y: 2 }],
  contractualRegions = [sourceRegion()],
  canonicalCommands,
  diagnosticMetadata = { governingResult: 'legacy', ...T1_BOUNDARY_METADATA },
  resultMetadata = { ...FALSE_METADATA },
  documentMetadata = { ...FALSE_METADATA },
  metrics,
  traces,
  documentExtra = {},
  resultExtra = {},
} = {}) {
  const adapted = adaptedInput(contractualRegions);
  const document = {
    version: '2',
    regions: contractualRegions.map(documentRegion),
    objects: [{ id: 'object-1' }],
    threads: [{ id: 'thread-1', color: '#228833' }],
    threadBlocks: [{ id: 'block-1', threadId: 'thread-1' }],
    commands,
    metadata: documentMetadata,
    ...documentExtra,
  };
  const engineV2Result = {
    version: '2',
    valid: resultValid,
    terminalStage: 'documentValidation',
    completedStages: ['ingestion', 'documentValidation'],
    stages: {},
    document,
    documentValidation: { valid: documentValid, errors: [], warnings: [] },
    errors: [],
    warnings: [],
    metadata: resultMetadata,
    ...resultExtra,
  };
  return {
    legacyResult: legacy,
    diagnostic: {
      version: 't1-experimental-raster-engine-v2-observation',
      status,
      requested,
      reasonCode,
      errors: [],
      source: {
        coordinateContract: adapted.coordinateContract,
        metadata: adapted.metadata,
        nonContractualProvenance: adapted.nonContractualProvenance,
      },
      engineV2Result,
      canonicalCommands: canonicalCommands ?? document.commands,
      metrics: metrics === undefined ? {
        regionCount: 1,
        objectCount: 1,
        threadCount: 1,
        threadBlockCount: 1,
        commandCount: commands.length,
        commandTypes: { stitch: commands.length },
      } : metrics,
      traces: traces === undefined ? {
        terminalStage: 'documentValidation',
        completedStages: ['ingestion', 'documentValidation'],
        errorCodes: [],
        warningCodes: [],
      } : traces,
      metadata: diagnosticMetadata,
    },
  };
}

function adaptedInput(sourceRegions = [sourceRegion()]) {
  return {
    sourceRegions,
    bridgeConfig: { width_mm: 83.4, height_mm: 114.3 },
    coordinateContract: coordinateContract(),
    metadata: adaptationMetadata(sourceRegions.length),
    nonContractualProvenance: adaptationProvenance(sourceRegions),
  };
}

async function directSha256(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

async function expectBlockedWithNoOutput(observation, adapted, expectedCode) {
  const built = await buildYoshiT2DiagnosticArtifacts({
    observation,
    adapted,
    fileMetadata: expectedFileMetadata(),
  });
  expect(built).toEqual({ ok: false, code: expectedCode, artifacts: null });

  const BlobImpl = vi.fn();
  const createObjectURL = vi.fn();
  const revokeObjectURL = vi.fn();
  const createAnchor = vi.fn();
  expect(downloadYoshiT2Artifact(built, YOSHI_T2_ARTIFACT_NAMES[0], {
    BlobImpl,
    createObjectURL,
    revokeObjectURL,
    createAnchor,
  })).toBe(false);
  expect(BlobImpl).not.toHaveBeenCalled();
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  expect(createAnchor).not.toHaveBeenCalled();
}

describe('Yoshi T2 diagnostic harness contract', () => {
  it('keeps T1 globally OFF and activates it only with the literal explicit boolean', () => {
    expect(experimentalEngineV2RasterObservation).toBe(false);
    expect(YOSHI_T2_ACTIVATION).toBe(true);
  });

  it('fixes the complete literal hybrid configuration', () => {
    expect(YOSHI_T2_PIPELINE_CONFIG).toEqual({
      mode: 'hybrid',
      width_mm: 83.4,
      height_mm: 114.3,
      color_count: 8,
      fabric_type: 'Algodón',
      remove_bg: false,
      contourSafeMode: true,
      useVectorFusion: false,
      experimentalDetailPreservation: false,
      experimentalOutlineGenerator: false,
      tatami_density: 0.4,
      machine_speed: 800,
    });
    expect(Object.isFrozen(YOSHI_T2_PIPELINE_CONFIG)).toBe(true);
  });

  it('admits exactly one selected file and rejects absent or multiple selections', () => {
    const file = { name: YOSHI_T2_EXPECTED_FILE.name };
    expect(validateYoshiT2FileSelection([file])).toMatchObject({ valid: true, file });
    expect(validateYoshiT2FileSelection([])).toMatchObject({ valid: false, code: 'T2_YOSHI_SINGLE_FILE_REQUIRED' });
    expect(validateYoshiT2FileSelection([file, file])).toMatchObject({ valid: false, code: 'T2_YOSHI_SINGLE_FILE_REQUIRED' });
  });

  it.each([
    ['name', { name: 'YOSHI.zip' }, 'T2_YOSHI_FILE_NAME_INVALID'],
    ['type', { type: 'application/zip' }, 'T2_YOSHI_FILE_TYPE_INVALID'],
    ['size', { size: 31_495 }, 'T2_YOSHI_FILE_SIZE_INVALID'],
    ['JPEG signature', { jpegSignatureValid: false }, 'T2_YOSHI_FILE_SIGNATURE_INVALID'],
    ['width', { width: 359 }, 'T2_YOSHI_FILE_DIMENSIONS_INVALID'],
    ['height', { height: 483 }, 'T2_YOSHI_FILE_DIMENSIONS_INVALID'],
    ['sha256', { sha256: `F${YOSHI_T2_EXPECTED_FILE.sha256.slice(1)}` }, 'T2_YOSHI_FILE_SHA256_INVALID'],
  ])('rejects an invalid %s before execution', (_field, override, code) => {
    expect(validateYoshiT2FileMetadata(expectedFileMetadata(override))).toEqual({
      valid: false,
      code,
      details: [],
    });
  });

  it('accepts the exact name, JPEG type, byte size, dimensions, and SHA-256', () => {
    expect(validateYoshiT2FileMetadata(expectedFileMetadata())).toEqual({
      valid: true,
      code: null,
      details: [],
    });
  });

  it('inspects bytes and dimensions without creating an object URL and closes the bitmap', async () => {
    const hashBytes = Uint8Array.from(
      YOSHI_T2_EXPECTED_FILE.sha256.match(/.{2}/g),
      pair => Number.parseInt(pair, 16),
    );
    const close = vi.fn();
    const createImageBitmapImpl = vi.fn().mockResolvedValue({ width: 360, height: 482, close });
    const cryptoImpl = { subtle: { digest: vi.fn().mockResolvedValue(hashBytes.buffer) } };
    const jpegBytes = new Uint8Array(31_496);
    jpegBytes.set([0xFF, 0xD8, 0xFF], 0);
    jpegBytes.set([0xFF, 0xD9], jpegBytes.length - 2);
    const file = {
      ...expectedFileMetadata(),
      arrayBuffer: vi.fn().mockResolvedValue(jpegBytes.buffer),
    };

    const inspected = await inspectYoshiT2File(file, { createImageBitmapImpl, cryptoImpl });

    expect(inspected).toMatchObject({ valid: true, code: null, metadata: expectedFileMetadata() });
    expect(createImageBitmapImpl).toHaveBeenCalledExactlyOnceWith(file);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    ['renamed PNG', [0x89, 0x50, 0x4E, 0x47]],
    ['arbitrary bytes', [0x01, 0x02, 0x03, 0x04]],
    ['JPEG without EOI', [0xFF, 0xD8, 0xFF, 0x00]],
  ])('rejects %s before hashing, decoding, or execution URL creation', async (_label, prefix) => {
    const bytes = new Uint8Array(31_496);
    bytes.set(prefix, 0);
    const digest = vi.fn();
    const createImageBitmapImpl = vi.fn();
    const result = await inspectYoshiT2File({
      ...expectedFileMetadata(),
      arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
    }, {
      createImageBitmapImpl,
      cryptoImpl: { subtle: { digest } },
    });

    expect(result.code).toBe('T2_YOSHI_FILE_SIGNATURE_INVALID');
    expect(digest).not.toHaveBeenCalled();
    expect(createImageBitmapImpl).not.toHaveBeenCalled();
  });

  it('rejects a truncated JPEG with valid SOI/EOI before hashing or decoding', async () => {
    const bytes = new Uint8Array(32);
    bytes.set([0xFF, 0xD8, 0xFF], 0);
    bytes.set([0xFF, 0xD9], bytes.length - 2);
    const digest = vi.fn();
    const createImageBitmapImpl = vi.fn();
    const result = await inspectYoshiT2File({
      ...expectedFileMetadata(),
      arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
    }, {
      createImageBitmapImpl,
      cryptoImpl: { subtle: { digest } },
    });

    expect(result.code).toBe('T2_YOSHI_FILE_SIZE_INVALID');
    expect(digest).not.toHaveBeenCalled();
    expect(createImageBitmapImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['arrayBuffer', 'T2_YOSHI_ARRAY_BUFFER_FAILED'],
    ['crypto', 'T2_YOSHI_CRYPTO_FAILED'],
    ['decoder/Image', 'T2_YOSHI_IMAGE_DECODE_FAILED'],
  ])('contains a rejected %s operation without reaching a later local stage', async (phase, code) => {
    const failure = Object.assign(new Error(`${phase} failed`), { code });
    const bytes = new Uint8Array(31_496);
    bytes.set([0xFF, 0xD8, 0xFF], 0);
    bytes.set([0xFF, 0xD9], bytes.length - 2);
    const hashBytes = Uint8Array.from(
      YOSHI_T2_EXPECTED_FILE.sha256.match(/.{2}/g),
      pair => Number.parseInt(pair, 16),
    );
    const arrayBuffer = phase === 'arrayBuffer'
      ? vi.fn().mockRejectedValue(failure)
      : vi.fn().mockResolvedValue(bytes.buffer);
    const digest = phase === 'crypto'
      ? vi.fn().mockRejectedValue(failure)
      : vi.fn().mockResolvedValue(hashBytes.buffer);
    const createImageBitmapImpl = phase === 'decoder/Image'
      ? vi.fn().mockRejectedValue(failure)
      : vi.fn().mockResolvedValue({ width: 360, height: 482, close: vi.fn() });

    const result = await inspectYoshiT2File({
      ...expectedFileMetadata(),
      arrayBuffer,
    }, {
      createImageBitmapImpl,
      cryptoImpl: { subtle: { digest } },
    });

    expect(result).toMatchObject({ valid: false, code });
    if (phase === 'arrayBuffer') {
      expect(digest).not.toHaveBeenCalled();
      expect(createImageBitmapImpl).not.toHaveBeenCalled();
    } else if (phase === 'crypto') {
      expect(digest).toHaveBeenCalledOnce();
      expect(createImageBitmapImpl).not.toHaveBeenCalled();
    } else {
      expect(digest).toHaveBeenCalledOnce();
      expect(createImageBitmapImpl).toHaveBeenCalledOnce();
    }
  });

  it('requires all nine unique successful legacy stages', () => {
    const observed = successfulObservation();
    expect(validateYoshiT2Observation(observed, adaptedInput())).toEqual({
      valid: true,
      code: null,
      details: [],
    });
    expect(observed.legacyResult.stageLog.map(entry => entry.stage)).toEqual(YOSHI_T2_REQUIRED_STAGES);
  });

  it.each([
    ['missing stage', legacyResult({ stages: YOSHI_T2_REQUIRED_STAGES.slice(0, 8).map(stage => ({ stage, ok: true })) }), 'T2_LEGACY_STAGE_SET_INVALID'],
    ['duplicate stage', legacyResult({ stages: YOSHI_T2_REQUIRED_STAGES.map((stage, index) => ({ stage: index === 8 ? YOSHI_T2_REQUIRED_STAGES[0] : stage, ok: true })) }), 'T2_LEGACY_STAGE_SET_INVALID'],
    ['failed stage', legacyResult({ stages: YOSHI_T2_REQUIRED_STAGES.map(stage => ({ stage, ok: stage !== 'vector_engine' })) }), 'T2_LEGACY_STAGE_FAILED'],
    ['empty legacy regions', legacyResult({ regions: [] }), 'T2_LEGACY_REGIONS_EMPTY'],
  ])('blocks %s', (_label, legacy, code) => {
    expect(validateYoshiT2Observation(successfulObservation({ legacy }), adaptedInput()).code).toBe(code);
  });

  it.each([
    ['blocked', 'T1_RASTER_ADAPTATION_BLOCKED'],
    ['failed', 'T1_ENGINE_V2_EXECUTION_FAILED'],
  ])('preserves the exact governing T1 code when status is %s', (status, reasonCode) => {
    const observed = successfulObservation({ status, reasonCode });
    expect(validateYoshiT2Observation(observed, adaptedInput())).toMatchObject({
      valid: false,
      code: reasonCode,
    });
  });

  it.each([
    ['invalid Engine V2 result', { resultValid: false }, 'T2_ENGINE_V2_RESULT_INVALID'],
    ['invalid document', { documentValid: false }, 'T2_ENGINE_V2_DOCUMENT_INVALID'],
    ['empty commands', { commands: [] }, 'T2_CANONICAL_COMMANDS_EMPTY'],
    ['missing metrics', { metrics: null }, 'T2_METRICS_INVALID'],
    ['missing traces', { traces: null }, 'T2_TRACES_INVALID'],
  ])('blocks %s', (_label, options, code) => {
    expect(validateYoshiT2Observation(successfulObservation(options), adaptedInput()).code).toBe(code);
  });

  it('blocks an empty adapted region set after T1 completion', () => {
    expect(validateYoshiT2Observation(successfulObservation(), adaptedInput([]))).toMatchObject({
      valid: false,
      code: 'T2_ADAPTED_REGIONS_EMPTY',
    });
  });

  it('blocks a re-adaptation whose contractual source differs from the T1 observation', () => {
    const adapted = adaptedInput();
    adapted.metadata = { ...adapted.metadata, deterministicIdsApplied: false };
    expect(validateYoshiT2Observation(successfulObservation(), adapted)).toMatchObject({
      valid: false,
      code: 'T2_ADAPTATION_SOURCE_MISMATCH',
    });
  });

  it('blocks re-adapted regions that differ from the Engine V2 document', () => {
    const adapted = adaptedInput([sourceRegion({ color: '#ffffff' })]);
    expect(validateYoshiT2Observation(successfulObservation(), adapted)).toMatchObject({
      valid: false,
      code: 'T2_SOURCE_REGIONS_DOCUMENT_MISMATCH',
    });
  });

  it.each([
    ['ID', observation => { observation.diagnostic.engineV2Result.document.regions[0].id = 'different-id'; }],
    ['visual color', observation => { observation.diagnostic.engineV2Result.document.regions[0].visualColor = '#ffffff'; }],
    ['exterior point', observation => { observation.diagnostic.engineV2Result.document.regions[0].geometry[0].x = 0.25; }],
    ['hole', observation => { observation.diagnostic.engineV2Result.document.regions[0].holes = [[{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.1, y: 0.2 }]]; }],
    ['additional region', observation => { observation.diagnostic.engineV2Result.document.regions.push(documentRegion(sourceRegion({ id: 'extra-region' }))); }],
    ['missing region', observation => { observation.diagnostic.engineV2Result.document.regions.pop(); }],
    ['source ID', observation => { observation.diagnostic.engineV2Result.document.regions[0].source.originalSourceId = 'different-source-id'; }],
    ['visibility', observation => { observation.diagnostic.engineV2Result.document.regions[0].source.visible = false; }],
    ['semantic role', observation => { observation.diagnostic.engineV2Result.document.regions[0].semanticRole = 'primary_shape'; }],
    ['semantic evidence', observation => { observation.diagnostic.engineV2Result.document.regions[0].source.originalSource.evidence = ['DIFFERENT_EVIDENCE']; }],
    ['coordinate space', observation => { observation.diagnostic.engineV2Result.document.regions[0].source.coordinateSpace = 'pixel'; }],
    ['source dimensions', observation => { observation.diagnostic.engineV2Result.document.regions[0].source.originalSource.sourceWidthPx = 361; }],
  ])('returns the literal source/document mismatch for isolated %s divergence', async (_label, mutate) => {
    const observation = successfulObservation();
    mutate(observation);
    await expectBlockedWithNoOutput(
      observation,
      adaptedInput(),
      'T2_SOURCE_REGIONS_DOCUMENT_MISMATCH',
    );
  });

  it('returns the literal mismatch for an isolated document order divergence', async () => {
    const commonSource = sourceRegion().source;
    const contractualRegions = [
      sourceRegion({ id: 'region-a' }),
      sourceRegion({
        id: 'region-b',
        color: '#ee7722',
        path_points: [[0, 0], [0.5, 0], [0, 0.5]],
        source: { ...commonSource },
      }),
    ];
    const observation = successfulObservation({ contractualRegions });
    observation.diagnostic.engineV2Result.document.regions.reverse();
    await expectBlockedWithNoOutput(
      observation,
      adaptedInput(contractualRegions),
      'T2_SOURCE_REGIONS_DOCUMENT_MISMATCH',
    );
  });

  it('compares design dimensions against the independent T1 source contract', async () => {
    const adapted = adaptedInput();
    adapted.coordinateContract.designWidthMm = 84;
    await expectBlockedWithNoOutput(
      successfulObservation(),
      adapted,
      'T2_SOURCE_REGIONS_DOCUMENT_MISMATCH',
    );
  });

  it.each([
    ['diagnostic', { diagnosticMetadata: { governingResult: 'legacy', ...FALSE_METADATA, encodingApplied: true } }],
    ['result', { resultMetadata: { ...FALSE_METADATA, machineAdaptationApplied: true } }],
    ['document', { documentMetadata: { ...FALSE_METADATA, binaryArtifactCreated: true } }],
  ])('blocks incompatible %s binary metadata', (_surface, options) => {
    expect(validateYoshiT2Observation(successfulObservation(options), adaptedInput()).code)
      .toBe('T2_BINARY_METADATA_INVALID');
  });

  it.each([
    ['diagnostic metadata absent', observation => { delete observation.diagnostic.metadata; }],
    ['diagnostic metadata null', observation => { observation.diagnostic.metadata = null; }],
    ['result metadata absent', observation => { delete observation.diagnostic.engineV2Result.metadata; }],
    ['result metadata null', observation => { observation.diagnostic.engineV2Result.metadata = null; }],
    ['document metadata absent', observation => { delete observation.diagnostic.engineV2Result.document.metadata; }],
    ['document metadata null', observation => { observation.diagnostic.engineV2Result.document.metadata = null; }],
  ])('blocks %s without artifacts or download work', async (_label, mutate) => {
    const observation = successfulObservation();
    mutate(observation);
    await expectBlockedWithNoOutput(observation, adaptedInput(), 'T2_BINARY_METADATA_INVALID');
  });

  it.each([
    'machineAdaptationApplied',
    'encodingApplied',
    'binaryArtifactCreated',
    'dstArtifactCount',
    'dsbArtifactCount',
  ])('requires the own T1 metadata field %s', async field => {
    const metadata = { governingResult: 'legacy', ...T1_BOUNDARY_METADATA };
    delete metadata[field];
    await expectBlockedWithNoOutput(
      successfulObservation({ diagnosticMetadata: metadata }),
      adaptedInput(),
      'T2_BINARY_METADATA_INVALID',
    );
  });

  it.each([
    'machineAdaptationApplied',
    'encodingApplied',
    'binaryArtifactCreated',
  ])('rejects true for the T1 metadata boolean %s', async field => {
    const metadata = { governingResult: 'legacy', ...T1_BOUNDARY_METADATA, [field]: true };
    await expectBlockedWithNoOutput(
      successfulObservation({ diagnosticMetadata: metadata }),
      adaptedInput(),
      'T2_BINARY_METADATA_INVALID',
    );
  });

  it.each([
    ['dstArtifactCount', 1],
    ['dstArtifactCount', '0'],
    ['dstArtifactCount', Number.NaN],
    ['dstArtifactCount', Number.POSITIVE_INFINITY],
    ['dsbArtifactCount', 1],
    ['dsbArtifactCount', '0'],
    ['dsbArtifactCount', Number.NaN],
    ['dsbArtifactCount', Number.POSITIVE_INFINITY],
  ])('rejects the non-literal-zero counter %s=%s', async (field, value) => {
    const metadata = { governingResult: 'legacy', ...T1_BOUNDARY_METADATA, [field]: value };
    await expectBlockedWithNoOutput(
      successfulObservation({ diagnosticMetadata: metadata }),
      adaptedInput(),
      'T2_BINARY_METADATA_INVALID',
    );
  });

  it.each([
    'machineAdaptationApplied',
    'encodingApplied',
    'binaryArtifactCreated',
    'dstArtifactCount',
    'dsbArtifactCount',
  ])('does not execute a hostile accessor for T1 metadata field %s', async field => {
    const getter = vi.fn(() => T1_BOUNDARY_METADATA[field]);
    const setter = vi.fn();
    const metadata = { governingResult: 'legacy', ...T1_BOUNDARY_METADATA };
    Object.defineProperty(metadata, field, { enumerable: true, configurable: true, get: getter, set: setter });
    await expectBlockedWithNoOutput(
      successfulObservation({ diagnosticMetadata: metadata }),
      adaptedInput(),
      'T2_BINARY_METADATA_INVALID',
    );
    expect(getter).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
  });

  it('contains a revoked T1 metadata proxy without traps, artifacts, or downloads', async () => {
    const revocable = Proxy.revocable({ governingResult: 'legacy', ...T1_BOUNDARY_METADATA }, {});
    revocable.revoke();
    await expectBlockedWithNoOutput(
      successfulObservation({ diagnosticMetadata: revocable.proxy }),
      adaptedInput(),
      'T2_BINARY_METADATA_INVALID',
    );
  });

  it.each([
    ['encoder invoked', { encoderInvoked: true }],
    ['download URL', { downloadUrl: 'https://example.com/yoshi.dst' }],
    ['ArrayBuffer', { payload: new ArrayBuffer(4) }],
    ['Blob', { payload: new Blob(['forbidden']) }],
    ['typed array', { payload: new Uint8Array([1, 2, 3]) }],
  ])('blocks additional binary metadata: %s', async (_label, extra) => {
    const metadata = { governingResult: 'legacy', ...T1_BOUNDARY_METADATA, ...extra };
    await expectBlockedWithNoOutput(
      successfulObservation({ diagnosticMetadata: metadata }),
      adaptedInput(),
      'T2_BINARY_SIGNAL_FORBIDDEN',
    );
  });

  it('inspects normalized diagnostic metadata counters and blocks non-zero DST evidence', () => {
    const diagnosticMetadata = {
      governingResult: 'legacy',
      ...FALSE_METADATA,
      dst_artifact_count: 1,
      dsbArtifactCount: 0,
    };
    expect(validateYoshiT2Observation(successfulObservation({ diagnosticMetadata }), adaptedInput()).code)
      .toBe('T2_BINARY_METADATA_INVALID');
  });

  it('requires canonical commands to be the exact validated document command list', () => {
    expect(validateYoshiT2Observation(successfulObservation({
      canonicalCommands: [{ id: 'detached', type: 'stitch' }],
    }), adaptedInput()).code).toBe('T2_CANONICAL_COMMAND_IDENTITY_MISMATCH');
  });

  it.each([
    ['DST format', { resultExtra: { outputFormat: 'DST' } }],
    ['binary payload', { resultExtra: { encodedBytes: new Uint8Array([1, 2, 3]) } }],
    ['download URL', { resultExtra: { downloadUrl: 'blob:forbidden' } }],
  ])('blocks a %s signal', (_label, options) => {
    expect(validateYoshiT2Observation(successfulObservation(options), adaptedInput()).code)
      .toBe('T2_BINARY_SIGNAL_FORBIDDEN');
  });

  it('builds all eight text artifacts only after complete validation', async () => {
    const built = await buildYoshiT2DiagnosticArtifacts({
      observation: successfulObservation(),
      adapted: adaptedInput(),
      fileMetadata: expectedFileMetadata(),
    });

    expect(built.ok).toBe(true);
    expect(Object.keys(built.artifacts)).toEqual(YOSHI_T2_ARTIFACT_NAMES);
    Object.values(built.artifacts).forEach(item => {
      expect(item.text.endsWith('\n')).toBe(true);
      expect(item.text).not.toContain('\r');
      expect(() => JSON.stringify(item)).not.toThrow();
    });
    YOSHI_T2_ARTIFACT_NAMES.slice(0, 6).forEach(name => {
      expect(() => JSON.parse(built.artifacts[name].text)).not.toThrow();
    });
  });

  it('excludes object URLs, timestamps, tokens, users, and session data by construction', async () => {
    const built = await buildYoshiT2DiagnosticArtifacts({
      observation: successfulObservation(),
      adapted: adaptedInput(),
      fileMetadata: expectedFileMetadata(),
    });
    const published = Object.values(built.artifacts).map(item => item.text).join('\n');

    expect(published).not.toContain('blob:');
    expect(published).not.toContain('legacy-token-must-not-leak');
    expect(published).not.toContain('legacy-session-must-not-leak');
    expect(published).not.toContain('durationMs');
    expect(published).not.toContain('1800000000000');
  });

  it('fails artifact construction rather than publishing a sensitive Engine V2 field', async () => {
    const built = await buildYoshiT2DiagnosticArtifacts({
      observation: successfulObservation({ documentExtra: { user: 'forbidden-user' } }),
      adapted: adaptedInput(),
      fileMetadata: expectedFileMetadata(),
    });
    expect(built).toEqual({ ok: false, code: 'T2_SENSITIVE_DATA_FORBIDDEN', artifacts: null });
  });

  it.each([
    ['api_key', { api_key: 'forbidden-api-key' }],
    ['access-token', { 'access-token': 'forbidden-access-token' }],
    ['authToken', { authToken: 'forbidden-auth-token' }],
    ['clientSecret', { clientSecret: 'forbidden-client-secret' }],
    ['client-secret', { 'client-secret': 'forbidden-client-secret' }],
    ['user_email', { user_email: 'forbidden@example.com' }],
    ['base44Url', { base44Url: 'https://forbidden.base44.app' }],
  ])('normalizes and blocks the sensitive key %s', async (_label, documentExtra) => {
    const built = await buildYoshiT2DiagnosticArtifacts({
      observation: successfulObservation({ documentExtra }),
      adapted: adaptedInput(),
      fileMetadata: expectedFileMetadata(),
    });
    expect(built).toEqual({ ok: false, code: 'T2_SENSITIVE_DATA_FORBIDDEN', artifacts: null });
  });

  it.each([
    ['camelCase metadata', (observation, _adapted) => { observation.diagnostic.metadata.appBaseUrl = 'https://example.com'; }],
    ['snake_case stageLog', (observation, _adapted) => { observation.legacyResult.stageLog[0].server_url = 'https://example.com'; }],
    ['kebab-case document', (observation, _adapted) => { observation.diagnostic.engineV2Result.document['upload-url'] = 'https://example.com'; }],
    ['uppercase commands', (observation, _adapted) => { observation.diagnostic.canonicalCommands[0].DOWNLOADURL = 'https://example.com'; }],
    ['spaces in traces', (observation, _adapted) => { observation.diagnostic.traces[' object Url '] = 'blob:forbidden'; }],
    ['arrays in metrics', (observation, _adapted) => { observation.diagnostic.metrics.deep = [{ server_url: 'https://example.com' }]; }],
    ['provenance', (observation, _adapted) => { observation.diagnostic.source.nonContractualProvenance.APP_BASE_URL = 'https://example.com'; }],
    ['source regions', (_observation, adapted) => { adapted.sourceRegions[0].upload_url = 'https://example.com'; }],
  ])('blocks normalized URL keys deeply in %s', async (_label, mutate) => {
    const observation = successfulObservation();
    const adapted = adaptedInput();
    mutate(observation, adapted);
    await expectBlockedWithNoOutput(observation, adapted, 'T2_BINARY_SIGNAL_FORBIDDEN');
  });

  it.each([
    ['HTTP', '  HTTP://example.com/private', 'T2_EXTERNAL_URL_FORBIDDEN'],
    ['HTTPS', '  hTtPs://example.com/private', 'T2_EXTERNAL_URL_FORBIDDEN'],
    ['data', '  DaTa:text/plain,private', 'T2_EXTERNAL_URL_FORBIDDEN'],
    ['javascript', '  JaVaScRiPt:alert(1)', 'T2_EXTERNAL_URL_FORBIDDEN'],
    ['blob', '  BlOb:private', 'T2_OBJECT_URL_FORBIDDEN'],
    ['file', '  FiLe:///private', 'T2_OBJECT_URL_FORBIDDEN'],
  ])('blocks the case-insensitive %s scheme with leading spaces', async (_label, reference, code) => {
    const built = await buildYoshiT2DiagnosticArtifacts({
      observation: successfulObservation({ documentExtra: { reference } }),
      adapted: adaptedInput(),
      fileMetadata: expectedFileMetadata(),
    });
    expect(built).toEqual({ ok: false, code, artifacts: null });
  });

  it('preserves legitimate canonical keys and innocent reason codes', async () => {
    const built = await buildYoshiT2DiagnosticArtifacts({
      observation: successfulObservation({
        documentExtra: {
          user_defined_color: '#228833',
          normalizedToken: 'palette-label',
        },
        traces: {
          terminalStage: 'documentValidation',
          completedStages: ['ingestion', 'documentValidation'],
          errorCodes: [],
          warningCodes: ['NORMALIZED_TOKEN_REUSED', 'USER_DEFINED_COLOR_ACCEPTED'],
        },
      }),
      adapted: adaptedInput(),
      fileMetadata: expectedFileMetadata(),
    });
    expect(built.ok).toBe(true);
    expect(built.artifacts['yoshi-t2-engine-v2-document.json'].text).toContain('user_defined_color');
    expect(built.artifacts['yoshi-t2-traces.json'].text).toContain('NORMALIZED_TOKEN_REUSED');
  });

  it('blocks an external URL even when its field name is otherwise innocuous', async () => {
    const built = await buildYoshiT2DiagnosticArtifacts({
      observation: successfulObservation({ documentExtra: { reference: 'https://example.com/private' } }),
      adapted: adaptedInput(),
      fileMetadata: expectedFileMetadata(),
    });
    expect(built).toEqual({ ok: false, code: 'T2_EXTERNAL_URL_FORBIDDEN', artifacts: null });
  });

  it('blocks an email address even when its field name is otherwise innocuous', async () => {
    const built = await buildYoshiT2DiagnosticArtifacts({
      observation: successfulObservation({ documentExtra: { contact: 'forbidden@example.com' } }),
      adapted: adaptedInput(),
      fileMetadata: expectedFileMetadata(),
    });
    expect(built).toEqual({ ok: false, code: 'T2_SENSITIVE_DATA_FORBIDDEN', artifacts: null });
  });

  it('produces byte-identical deterministic artifacts across repeated builds', async () => {
    const input = {
      observation: successfulObservation(),
      adapted: adaptedInput(),
      fileMetadata: expectedFileMetadata(),
    };
    const first = await buildYoshiT2DiagnosticArtifacts(input);
    const second = await buildYoshiT2DiagnosticArtifacts(input);
    expect(second).toEqual(first);
  });

  it('anchors the professional R02 evidence and rejects stitch equivalence claims', async () => {
    const built = await buildYoshiT2DiagnosticArtifacts({
      observation: successfulObservation(),
      adapted: adaptedInput(),
      fileMetadata: expectedFileMetadata(),
    });
    const comparison = built.artifacts['yoshi-t2-vs-r02-comparison.md'].text;

    expect(YOSHI_T2_R02_REFERENCE).toEqual({
      embStitchCount: 18_145,
      dstStitchCount: 18_139,
      objectCount: 26,
      colorCount: 6,
      blockCount: 7,
      blockOrder: ['verde', 'blanco', 'naranja', 'rojo', 'naranja', 'amarillo', 'negro'],
    });
    expect(comparison).toContain('18145');
    expect(comparison).toContain('18139');
    expect(comparison).toContain('verde → blanco → naranja → rojo → naranja → amarillo → negro');
    expect(comparison).toContain('no equivalen automáticamente a puntadas DST');
    expect(comparison).toContain('no acredita equivalencia física ni mejora de bordado');
    expect(comparison).toContain(`- JPEG: 360 × 482 px;
- objetivo: 83,4 × 114,3 mm;
- escala horizontal aproximada: 0,23167 mm/px;
- escala vertical aproximada: 0,23714 mm/px;
- diferencia aproximada: 2,36%;
- la medida objetivo reproduce la referencia profesional R02;
- la diferencia no se atribuye automáticamente a un defecto del motor;
- comandos canónicos no equivalen automáticamente a puntadas DST.`);
  });

  it('marks absent R02-facing metrics as non-comparable instead of publishing undefined', async () => {
    const built = await buildYoshiT2DiagnosticArtifacts({
      observation: successfulObservation({ metrics: { commandCount: 1 } }),
      adapted: adaptedInput(),
      fileMetadata: expectedFileMetadata(),
    });
    const comparison = built.artifacts['yoshi-t2-vs-r02-comparison.md'].text;
    expect(comparison).toContain('no comparable');
    expect(comparison).not.toContain('undefined');
  });

  it('hashes exactly the seven payload artifacts in the manifest', async () => {
    const built = await buildYoshiT2DiagnosticArtifacts({
      observation: successfulObservation(),
      adapted: adaptedInput(),
      fileMetadata: expectedFileMetadata(),
    });
    const lines = built.artifacts['MANIFEST_SHA256.txt'].text.trimEnd().split('\n');

    expect(lines).toHaveLength(7);
    for (const name of YOSHI_T2_ARTIFACT_NAMES.slice(0, 7)) {
      const expectedLine = `${await directSha256(built.artifacts[name].text)}  ${name}`;
      expect(lines).toContain(expectedLine);
    }
  });

  it('re-adapts the real T1 adapter output and matches the real Engine V2 document contract', async () => {
    const actualLegacy = {
      imageUrl: 'blob:not-published',
      config: { ...YOSHI_T2_PIPELINE_CONFIG },
      analysis: { imageWidth: 360, imageHeight: 482 },
      regions: [{
        id: 'legacy-yoshi-fixture',
        name: 'body',
        color: '#228833',
        visible: true,
        semanticRole: 'primary_shape',
        path_points: [[0.1, 0.1], [0.8, 0.1], [0.8, 0.8], [0.1, 0.8]],
        holes: [],
      }],
      plan: { sequence: ['legacy-yoshi-fixture'] },
      optimized: { sequence: ['legacy-yoshi-fixture'] },
      stageLog: YOSHI_T2_REQUIRED_STAGES.map(stage => ({ stage, ok: true })),
    };
    const observation = observeLegacyRasterPipelineResult(
      actualLegacy,
      true,
      runExperimentalEngineV2Bridge,
      adaptLegacyRasterPipelineResultToEngineV2Input,
    );
    const adapted = adaptLegacyRasterPipelineResultToEngineV2Input(actualLegacy);
    expect(observation.diagnostic.status).toBe('completed');
    const observedRegion = observation.diagnostic.engineV2Result.document.regions[0];
    const adaptedRegion = adapted.sourceRegions[0];
    expect({
      id: observedRegion.id,
      visualColor: observedRegion.visualColor,
      geometry: observedRegion.geometry,
      holes: observedRegion.holes,
      semanticRole: observedRegion.semanticRole,
      source: {
        originalSourceId: observedRegion.source.originalSourceId,
        originalSource: observedRegion.source.originalSource,
        name: observedRegion.source.name,
        object: observedRegion.source.object,
        objectGroup: observedRegion.source.objectGroup,
        regionClass: observedRegion.source.regionClass,
        visible: observedRegion.source.visible,
        coordinateSpace: observedRegion.source.coordinateSpace,
      },
    }).toEqual(documentRegion(adaptedRegion));
    expect(validateYoshiT2Observation(observation, adapted)).toEqual({
      valid: true,
      code: null,
      details: [],
    });
    const built = await buildYoshiT2DiagnosticArtifacts({
      observation,
      adapted,
      fileMetadata: expectedFileMetadata(),
    });
    expect(built).toMatchObject({ ok: true, code: null });
  });

  it('runs the real-connector contract once, preserves legacy identity for adaptation, and revokes the input URL', async () => {
    const observed = successfulObservation();
    const runConnector = vi.fn(async (_url, _config, options) => {
      YOSHI_T2_REQUIRED_STAGES.forEach((stage, index) => options.onProgress(index * 10, stage));
      return observed;
    });
    const adaptLegacy = vi.fn(() => adaptedInput());
    const createObjectURL = vi.fn(() => 'blob:yoshi-input');
    const revokeObjectURL = vi.fn();
    const onProgress = vi.fn();
    const executionGate = { current: false };

    const result = await executeYoshiT2DiagnosticRun({
      file: { name: YOSHI_T2_EXPECTED_FILE.name },
      fileMetadata: expectedFileMetadata(),
      executionGate,
      runConnector,
      adaptLegacy,
      onProgress,
      createObjectURL,
      revokeObjectURL,
    });

    expect(result.ok).toBe(true);
    expect(runConnector).toHaveBeenCalledOnce();
    expect(runConnector.mock.calls[0][0]).toBe('blob:yoshi-input');
    expect(runConnector.mock.calls[0][1]).toBe(YOSHI_T2_PIPELINE_CONFIG);
    expect(runConnector.mock.calls[0][3]).toBe(true);
    expect(adaptLegacy).toHaveBeenCalledExactlyOnceWith(observed.legacyResult);
    expect(onProgress).toHaveBeenCalledTimes(9);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:yoshi-input');
    expect(executionGate.current).toBe(false);
    expect(JSON.stringify(result)).not.toContain('blob:yoshi-input');
  });

  it('rejects a concurrent second execution without a second connector call or object URL', async () => {
    let releaseConnector;
    const connectorPromise = new Promise(resolve => { releaseConnector = resolve; });
    const runConnector = vi.fn(() => connectorPromise);
    const createObjectURL = vi.fn(() => 'blob:single-run');
    const revokeObjectURL = vi.fn();
    const executionGate = { current: false };
    const input = {
      file: { name: YOSHI_T2_EXPECTED_FILE.name },
      fileMetadata: expectedFileMetadata(),
      executionGate,
      runConnector,
      adaptLegacy: vi.fn(() => adaptedInput()),
      createObjectURL,
      revokeObjectURL,
    };

    const first = executeYoshiT2DiagnosticRun(input);
    const second = await executeYoshiT2DiagnosticRun(input);
    expect(second).toEqual({
      ok: false,
      code: 'T2_EXECUTION_ALREADY_RUNNING',
      artifacts: null,
      summary: null,
    });
    expect(runConnector).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();

    releaseConnector(successfulObservation());
    expect((await first).ok).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:single-run');
  });

  it('does not retry or adapt a blocked T1 result and still revokes the object URL', async () => {
    const runConnector = vi.fn().mockResolvedValue(successfulObservation({
      status: 'blocked',
      reasonCode: 'T1_ENGINE_V2_BINARY_BOUNDARY_VIOLATION',
    }));
    const adaptLegacy = vi.fn();
    const revokeObjectURL = vi.fn();
    const result = await executeYoshiT2DiagnosticRun({
      file: {},
      fileMetadata: expectedFileMetadata(),
      executionGate: { current: false },
      runConnector,
      adaptLegacy,
      createObjectURL: () => 'blob:blocked',
      revokeObjectURL,
    });

    expect(result).toEqual({
      ok: false,
      code: 'T1_ENGINE_V2_BINARY_BOUNDARY_VIOLATION',
      artifacts: null,
      summary: null,
    });
    expect(runConnector).toHaveBeenCalledOnce();
    expect(adaptLegacy).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:blocked');
  });

  it('captures connector exceptions by exact code, does not propagate, and revokes in finally', async () => {
    const failure = Object.assign(new Error('remote stage unavailable'), { code: 'T2_LEGACY_REMOTE_STAGE_UNAVAILABLE' });
    const revokeObjectURL = vi.fn();
    const result = await executeYoshiT2DiagnosticRun({
      file: {},
      fileMetadata: expectedFileMetadata(),
      executionGate: { current: false },
      runConnector: vi.fn().mockRejectedValue(failure),
      adaptLegacy: vi.fn(),
      createObjectURL: () => 'blob:failed',
      revokeObjectURL,
    });

    expect(result.code).toBe('T2_LEGACY_REMOTE_STAGE_UNAVAILABLE');
    expect(result.artifacts).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:failed');
  });

  it('creates only a local text Blob after success and revokes its URL immediately', async () => {
    const built = await buildYoshiT2DiagnosticArtifacts({
      observation: successfulObservation(),
      adapted: adaptedInput(),
      fileMetadata: expectedFileMetadata(),
    });
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = { click, remove };
    const BlobImpl = vi.fn(function TextBlob(parts, options) {
      this.parts = parts;
      this.type = options.type;
    });
    const createObjectURL = vi.fn(() => 'blob:text-download');
    const revokeObjectURL = vi.fn();

    expect(downloadYoshiT2Artifact(built, 'yoshi-t2-metrics.json', {
      BlobImpl,
      createObjectURL,
      revokeObjectURL,
      createAnchor: () => anchor,
    })).toBe(true);
    expect(BlobImpl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:text-download');
  });

  it('performs zero download work for a failed execution', () => {
    const BlobImpl = vi.fn();
    const createObjectURL = vi.fn();
    const revokeObjectURL = vi.fn();
    const createAnchor = vi.fn();
    expect(downloadYoshiT2Artifact(
      { ok: false, code: 'T2_BLOCKED', artifacts: null },
      'yoshi-t2-metrics.json',
      { BlobImpl, createObjectURL, revokeObjectURL, createAnchor },
    )).toBe(false);
    expect(BlobImpl).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(createAnchor).not.toHaveBeenCalled();
  });
});
