import { describe, expect, it, vi } from 'vitest';

import {
  convertDiagnosticLabAuditInputToBridgeInput,
  createDiagnosticLabAuditInputFromFixture,
} from '../../engineV2Bridge/diagnosticLabAuditInput.js';
import { runControlledEngineV2Audit } from '../../engineV2Bridge/runControlledEngineV2Audit.js';
import { runExperimentalEngineV2Bridge } from '../../engineV2Bridge/runExperimentalEngineV2Bridge.js';
import { createMinimalInternalPipelineFixture } from '../fixtures/minimalInternalPipelineFixture.js';

const EXPLICIT_FIXTURE_PROVENANCE = Object.freeze({
  kind: 'explicit-fixture',
  id: 'minimal-internal-pipeline',
});

function selectMinimalFixtureAuditInput() {
  return createDiagnosticLabAuditInputFromFixture(
    createMinimalInternalPipelineFixture(),
    EXPLICIT_FIXTURE_PROVENANCE,
  );
}

describe('P9-F4 controlled Engine V2 diagnostic audit', () => {
  it('omits execution without touching the fixture, bridge, or gate when disabled', () => {
    const executionGate = { current: false };
    const selectAuditInput = vi.fn();
    const executeBridge = vi.fn();

    const outcome = runControlledEngineV2Audit({
      enabled: false,
      authorized: true,
      executionGate,
      selectAuditInput,
      executeBridge,
    });

    expect(outcome).toEqual({
      executed: false,
      result: null,
      error: null,
      reason: 'feature-disabled',
    });
    expect(selectAuditInput).not.toHaveBeenCalled();
    expect(executeBridge).not.toHaveBeenCalled();
    expect(executionGate.current).toBe(false);
  });

  it('omits execution without touching the fixture, bridge, or gate for a non-admin user', () => {
    const executionGate = { current: false };
    const selectAuditInput = vi.fn();
    const executeBridge = vi.fn();

    const outcome = runControlledEngineV2Audit({
      enabled: true,
      authorized: false,
      executionGate,
      selectAuditInput,
      executeBridge,
    });

    expect(outcome).toEqual({
      executed: false,
      result: null,
      error: null,
      reason: 'unauthorized',
    });
    expect(selectAuditInput).not.toHaveBeenCalled();
    expect(executeBridge).not.toHaveBeenCalled();
    expect(executionGate.current).toBe(false);
  });

  it('runs the real bridge once with the controlled minimal fixture and protected metadata', () => {
    const executionGate = { current: false };
    const fixture = createMinimalInternalPipelineFixture();
    const selectAuditInput = vi.fn(() => createDiagnosticLabAuditInputFromFixture(
      fixture,
      EXPLICIT_FIXTURE_PROVENANCE,
    ));
    const executeBridge = vi.fn(runExperimentalEngineV2Bridge);

    const outcome = runControlledEngineV2Audit({
      enabled: true,
      authorized: true,
      executionGate,
      selectAuditInput,
      executeBridge,
    });

    expect(selectAuditInput).toHaveBeenCalledTimes(1);
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
    const selectAuditInput = vi.fn(selectMinimalFixtureAuditInput);
    const executeBridge = vi.fn(() => ({ valid: true }));
    const input = {
      enabled: true,
      authorized: true,
      executionGate,
      selectAuditInput,
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
    expect(selectAuditInput).toHaveBeenCalledTimes(1);
    expect(executeBridge).toHaveBeenCalledTimes(1);
  });

  it('normalizes a contractual exception, keeps the gate marked, and never retries', () => {
    const executionGate = { current: false };
    const selectAuditInput = vi.fn(selectMinimalFixtureAuditInput);
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
      selectAuditInput,
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
    expect(selectAuditInput).toHaveBeenCalledTimes(1);
    expect(executeBridge).toHaveBeenCalledTimes(1);
    expect(first.error).not.toHaveProperty('stack');
  });
});

describe('P9-F5-A controlled explicit diagnostic audit input', () => {
  it('P9-F5-A 6: keeps disabled, unauthorized, invalid-gate, and already-executed guards side-effect free', () => {
    const cases = [
      {
        options: { enabled: false, authorized: true, executionGate: { current: false } },
        reason: 'feature-disabled',
      },
      {
        options: { enabled: true, authorized: false, executionGate: { current: false } },
        reason: 'unauthorized',
      },
      {
        options: { enabled: true, authorized: true, executionGate: { current: 'no' } },
        reason: 'invalid-execution-gate',
      },
      {
        options: { enabled: true, authorized: true, executionGate: { current: true } },
        reason: 'already-executed',
      },
    ];

    cases.forEach(({ options, reason }) => {
      const selectAuditInput = vi.fn();
      const executeBridge = vi.fn();
      const initialGateValue = options.executionGate.current;
      const outcome = runControlledEngineV2Audit({
        ...options,
        selectAuditInput,
        executeBridge,
      });

      expect(outcome).toEqual({
        executed: false,
        result: null,
        error: null,
        reason,
      });
      expect(selectAuditInput).not.toHaveBeenCalled();
      expect(executeBridge).not.toHaveBeenCalled();
      expect(options.executionGate.current).toBe(initialGateValue);
    });
  });

  it('P9-F5-A 7: omits a missing explicit selector without constructing input or marking the gate', () => {
    const executionGate = { current: false };
    const executeBridge = vi.fn();

    const outcome = runControlledEngineV2Audit({
      enabled: true,
      authorized: true,
      executionGate,
      executeBridge,
    });

    expect(outcome).toEqual({
      executed: false,
      result: null,
      error: null,
      reason: 'missing-audit-input-selector',
    });
    expect(executeBridge).not.toHaveBeenCalled();
    expect(executionGate.current).toBe(false);
  });

  it('P9-F5-A 8: calls the explicit selector and real bridge exactly once with exact converted arguments', () => {
    const executionGate = { current: false };
    const auditInput = selectMinimalFixtureAuditInput();
    const expectedBridgeInput = convertDiagnosticLabAuditInputToBridgeInput(auditInput);
    const selectAuditInput = vi.fn(() => auditInput);
    const executeBridge = vi.fn(runExperimentalEngineV2Bridge);

    const outcome = runControlledEngineV2Audit({
      enabled: true,
      authorized: true,
      executionGate,
      selectAuditInput,
      executeBridge,
    });

    expect(selectAuditInput).toHaveBeenCalledTimes(1);
    expect(executeBridge).toHaveBeenCalledTimes(1);
    expect(executeBridge).toHaveBeenCalledWith({
      ...expectedBridgeInput,
      enabled: true,
    });
    expect(outcome.executed).toBe(true);
    expect(outcome.reason).toBe('completed');
    expect(outcome.error).toBeNull();
    expect(outcome.result.valid).toBe(true);
    expect(executionGate.current).toBe(true);
  });

  it('P9-F5-A 9: prevents retries after invalid DTOs or exceptions and preserves contractual invalid results', () => {
    const invalidGate = { current: false };
    const invalidInput = {
      ...selectMinimalFixtureAuditInput(),
      provenance: undefined,
    };
    const invalidSelector = vi.fn(() => invalidInput);
    const invalidBridge = vi.fn();
    const invalidOptions = {
      enabled: true,
      authorized: true,
      executionGate: invalidGate,
      selectAuditInput: invalidSelector,
      executeBridge: invalidBridge,
    };

    const invalidFirst = runControlledEngineV2Audit(invalidOptions);
    const invalidSecond = runControlledEngineV2Audit(invalidOptions);

    expect(invalidFirst).toEqual({
      executed: true,
      result: null,
      error: {
        name: 'DiagnosticLabAuditInputError',
        code: 'DIAGNOSTIC_LAB_AUDIT_INPUT_PROVENANCE_INVALID',
        path: 'provenance',
        message: 'provenance must be an object.',
      },
      reason: 'external-exception',
    });
    expect(invalidSecond.reason).toBe('already-executed');
    expect(invalidGate.current).toBe(true);
    expect(invalidSelector).toHaveBeenCalledTimes(1);
    expect(invalidBridge).not.toHaveBeenCalled();
    expect(invalidFirst.error).not.toHaveProperty('stack');

    const exceptionGate = { current: false };
    const selectorError = new Error('fixture selector failed');
    selectorError.name = 'FixtureSelectorError';
    selectorError.code = 'FIXTURE_SELECTOR_FAILED';
    selectorError.path = 'selectAuditInput';
    selectorError.privateDetails = 'excluded';
    const throwingSelector = vi.fn(() => {
      throw selectorError;
    });
    const exceptionBridge = vi.fn();
    const exceptionOptions = {
      enabled: true,
      authorized: true,
      executionGate: exceptionGate,
      selectAuditInput: throwingSelector,
      executeBridge: exceptionBridge,
    };

    const exceptionFirst = runControlledEngineV2Audit(exceptionOptions);
    const exceptionSecond = runControlledEngineV2Audit(exceptionOptions);

    expect(exceptionFirst).toEqual({
      executed: true,
      result: null,
      error: {
        name: 'FixtureSelectorError',
        code: 'FIXTURE_SELECTOR_FAILED',
        path: 'selectAuditInput',
        message: 'fixture selector failed',
      },
      reason: 'external-exception',
    });
    expect(exceptionSecond.reason).toBe('already-executed');
    expect(exceptionGate.current).toBe(true);
    expect(throwingSelector).toHaveBeenCalledTimes(1);
    expect(exceptionBridge).not.toHaveBeenCalled();
    expect(exceptionFirst.error).not.toHaveProperty('stack');
    expect(exceptionFirst.error).not.toHaveProperty('privateDetails');

    const contractualGate = { current: false };
    const contractualResult = {
      valid: false,
      reasonCode: 'CONTROLLED_CONTRACTUAL_INVALID',
    };
    const contractualSelector = vi.fn(selectMinimalFixtureAuditInput);
    const contractualBridge = vi.fn(() => contractualResult);
    const contractualOutcome = runControlledEngineV2Audit({
      enabled: true,
      authorized: true,
      executionGate: contractualGate,
      selectAuditInput: contractualSelector,
      executeBridge: contractualBridge,
    });

    expect(contractualOutcome).toEqual({
      executed: true,
      result: contractualResult,
      error: null,
      reason: 'completed',
    });
    expect(contractualSelector).toHaveBeenCalledTimes(1);
    expect(contractualBridge).toHaveBeenCalledTimes(1);
    expect(contractualGate.current).toBe(true);
  });
});
