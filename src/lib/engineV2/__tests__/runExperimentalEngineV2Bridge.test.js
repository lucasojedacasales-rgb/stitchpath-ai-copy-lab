import { describe, expect, it } from 'vitest';

import { createMinimalInternalPipelineFixture } from '../fixtures/minimalInternalPipelineFixture.js';
import { experimentalEngineV2Base44Bridge } from '../../engineV2Bridge/featureFlags.js';
import { runExperimentalEngineV2Bridge } from '../../engineV2Bridge/runExperimentalEngineV2Bridge.js';

const DISABLED_RESULT = {
  version: 'p9-f2-experimental-engine-v2-bridge',
  valid: false,
  status: 'disabled',
  enabled: false,
  reasonCode: 'EXPERIMENTAL_ENGINE_V2_BASE44_BRIDGE_DISABLED',
};

const EFFECTIVE_BINARY_FLAGS = new Set([
  'machineAdaptationApplied',
  'machineAdaptationAdded',
  'encodingApplied',
  'encodingAdded',
  'binaryArtifactCreated',
  'DSTEncoderInvoked',
  'DSBEncoderInvoked',
]);

const BINARY_VALUE_FIELDS = new Set([
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

function bridgeInput() {
  const fixture = createMinimalInternalPipelineFixture();
  return {
    regions: fixture.sourceRegions,
    config: {
      width_mm: fixture.planningConfig.designWidthMm,
      height_mm: fixture.planningConfig.designHeightMm,
    },
  };
}

function containsBinaryOrDownloadArtifact(value, seen = new Set()) {
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) return false;
  seen.add(value);
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;

  return Object.entries(value).some(([key, nested]) => {
    if (EFFECTIVE_BINARY_FLAGS.has(key) && nested === true) return true;
    if (key === 'encoderInvocationCount' && Number(nested) > 0) return true;
    if (BINARY_VALUE_FIELDS.has(key) && nested !== null && nested !== undefined) {
      return true;
    }
    if (/^download(?:Url|Uri|Href|Payload|File)?$/i.test(key)
      && nested !== null && nested !== undefined) {
      return true;
    }
    if (['format', 'fileFormat', 'outputFormat'].includes(key)
      && ['dst', 'dsb'].includes(String(nested).toLowerCase())) {
      return true;
    }
    return containsBinaryOrDownloadArtifact(nested, seen);
  });
}

describe('P9-F2 experimental Engine V2 bridge', () => {
  it('keeps the experimental bridge flag disabled by default', () => {
    expect(experimentalEngineV2Base44Bridge).toBe(false);
  });

  it('does not adapt or execute when enabled is absent', () => {
    const result = runExperimentalEngineV2Bridge();

    expect(result).toEqual(DISABLED_RESULT);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('does not adapt or execute when enabled is false', () => {
    const result = runExperimentalEngineV2Bridge({
      regions: [],
      config: null,
      enabled: false,
    });

    expect(result).toEqual(DISABLED_RESULT);
  });

  it('completes the minimal fixture when enabled is true', () => {
    const result = runExperimentalEngineV2Bridge({
      ...bridgeInput(),
      enabled: true,
    });

    expect(result.completedStages).toHaveLength(10);
    expect(result.documentValidation.valid).toBe(true);
    expect(result.document).not.toBeNull();
  });

  it('preserves the Engine V2 valid and terminalStage result fields', () => {
    const result = runExperimentalEngineV2Bridge({
      ...bridgeInput(),
      enabled: true,
    });

    expect(result.valid).toBe(true);
    expect(result.terminalStage).toBe('documentValidation');
  });

  it('preserves metadata proving machine, encoding, and binary work remain absent', () => {
    const result = runExperimentalEngineV2Bridge({
      ...bridgeInput(),
      enabled: true,
    });

    expect(result.metadata).toMatchObject({
      machineAdaptationApplied: false,
      encodingApplied: false,
      binaryArtifactCreated: false,
    });
  });

  it('does not mutate regions or configuration', () => {
    const input = bridgeInput();
    const snapshot = structuredClone(input);

    runExperimentalEngineV2Bridge({ ...input, enabled: true });

    expect(input).toEqual(snapshot);
  });

  it('preserves deterministic adapter errors before pipeline execution', () => {
    let captured;
    try {
      runExperimentalEngineV2Bridge({
        regions: [],
        config: { width_mm: 20, height_mm: 20 },
        enabled: true,
      });
    } catch (error) {
      captured = error;
    }

    expect(captured).toMatchObject({
      name: 'Base44ProjectToEngineV2InputError',
      code: 'BASE44_ENGINE_V2_REGIONS_INVALID',
      path: 'regions',
      message: 'regions must be a non-empty array.',
    });
  });

  it('produces deterministic results across repeated enabled executions', () => {
    const input = bridgeInput();
    const first = runExperimentalEngineV2Bridge({ ...input, enabled: true });
    const second = runExperimentalEngineV2Bridge({ ...input, enabled: true });

    expect(first).toEqual(second);
  });

  it('does not expose binary artifacts or download properties', () => {
    const result = runExperimentalEngineV2Bridge({
      ...bridgeInput(),
      enabled: true,
    });

    expect(containsBinaryOrDownloadArtifact(result)).toBe(false);
  });
});
