import { describe, expect, it, vi } from 'vitest';

import { runControlledEngineV2Audit } from '../../engineV2Bridge/runControlledEngineV2Audit.js';
import { runExperimentalEngineV2Bridge } from '../../engineV2Bridge/runExperimentalEngineV2Bridge.js';
import { createMinimalInternalPipelineFixture } from '../fixtures/minimalInternalPipelineFixture.js';

describe('P9-F4 controlled Engine V2 diagnostic audit', () => {
  it('omits execution without touching the fixture, bridge, or gate when disabled', () => {
    const executionGate = { current: false };
    const createFixture = vi.fn();
    const executeBridge = vi.fn();

    const outcome = runControlledEngineV2Audit({
      enabled: false,
      authorized: true,
      executionGate,
      createFixture,
      executeBridge,
    });

    expect(outcome).toEqual({
      executed: false,
      result: null,
      error: null,
      reason: 'feature-disabled',
    });
    expect(createFixture).not.toHaveBeenCalled();
    expect(executeBridge).not.toHaveBeenCalled();
    expect(executionGate.current).toBe(false);
  });

  it('omits execution without touching the fixture, bridge, or gate for a non-admin user', () => {
    const executionGate = { current: false };
    const createFixture = vi.fn();
    const executeBridge = vi.fn();

    const outcome = runControlledEngineV2Audit({
      enabled: true,
      authorized: false,
      executionGate,
      createFixture,
      executeBridge,
    });

    expect(outcome).toEqual({
      executed: false,
      result: null,
      error: null,
      reason: 'unauthorized',
    });
    expect(createFixture).not.toHaveBeenCalled();
    expect(executeBridge).not.toHaveBeenCalled();
    expect(executionGate.current).toBe(false);
  });

  it('runs the real bridge once with the controlled minimal fixture and protected metadata', () => {
    const executionGate = { current: false };
    const fixture = createMinimalInternalPipelineFixture();
    const createFixture = vi.fn(() => fixture);
    const executeBridge = vi.fn(runExperimentalEngineV2Bridge);

    const outcome = runControlledEngineV2Audit({
      enabled: true,
      authorized: true,
      executionGate,
      createFixture,
      executeBridge,
    });

    expect(createFixture).toHaveBeenCalledTimes(1);
    expect(executeBridge).toHaveBeenCalledTimes(1);
    expect(executeBridge).toHaveBeenCalledWith({
      regions: fixture.sourceRegions,
      config: {
        width_mm: fixture.planningConfig.designWidthMm,
        height_mm: fixture.planningConfig.designHeightMm,
      },
      enabled: true,
    });
    expect(outcome.executed).toBe(true);
    expect(outcome.reason).toBe('completed');
    expect(outcome.error).toBeNull();
    expect(outcome.result.valid).toBe(true);
    expect(outcome.result.terminalStage).toBe('documentValidation');
    expect(outcome.result.completedStages).toHaveLength(10);
    expect(outcome.result.metadata).toEqual({
      machineAdaptationApplied: false,
      encodingApplied: false,
      binaryArtifactCreated: false,
    });
    expect(executionGate.current).toBe(true);
  });

  it('prevents a duplicate bridge execution when two calls share the same gate', () => {
    const executionGate = { current: false };
    const createFixture = vi.fn(createMinimalInternalPipelineFixture);
    const executeBridge = vi.fn(() => ({ valid: true }));
    const input = {
      enabled: true,
      authorized: true,
      executionGate,
      createFixture,
      executeBridge,
    };

    const first = runControlledEngineV2Audit(input);
    const second = runControlledEngineV2Audit(input);

    expect(first.executed).toBe(true);
    expect(second).toEqual({
      executed: false,
      result: null,
      error: null,
      reason: 'already-executed',
    });
    expect(createFixture).toHaveBeenCalledTimes(1);
    expect(executeBridge).toHaveBeenCalledTimes(1);
  });

  it('normalizes a contractual exception, keeps the gate marked, and never retries', () => {
    const executionGate = { current: false };
    const createFixture = vi.fn(createMinimalInternalPipelineFixture);
    const contractualError = new TypeError('regions must be a non-empty array.');
    contractualError.name = 'Base44ProjectToEngineV2InputError';
    contractualError.code = 'BASE44_ENGINE_V2_REGIONS_INVALID';
    contractualError.path = 'regions';
    const executeBridge = vi.fn(() => {
      throw contractualError;
    });
    const input = {
      enabled: true,
      authorized: true,
      executionGate,
      createFixture,
      executeBridge,
    };

    const first = runControlledEngineV2Audit(input);
    const second = runControlledEngineV2Audit(input);

    expect(first).toEqual({
      executed: true,
      result: null,
      error: {
        name: 'Base44ProjectToEngineV2InputError',
        code: 'BASE44_ENGINE_V2_REGIONS_INVALID',
        path: 'regions',
        message: 'regions must be a non-empty array.',
      },
      reason: 'external-exception',
    });
    expect(second.reason).toBe('already-executed');
    expect(executionGate.current).toBe(true);
    expect(createFixture).toHaveBeenCalledTimes(1);
    expect(executeBridge).toHaveBeenCalledTimes(1);
    expect(first.error).not.toHaveProperty('stack');
  });
});
