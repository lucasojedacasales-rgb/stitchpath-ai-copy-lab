import { convertDiagnosticLabAuditInputToBridgeInput } from './diagnosticLabAuditInput.js';
import { runExperimentalEngineV2Bridge } from './runExperimentalEngineV2Bridge.js';

const omitted = reason => ({
  executed: false,
  result: null,
  error: null,
  reason,
});

function validExecutionGate(executionGate) {
  return executionGate !== null
    && typeof executionGate === 'object'
    && typeof executionGate.current === 'boolean';
}

function normalizeExternalError(caught) {
  if (caught !== null && typeof caught === 'object') {
    return Object.fromEntries(
      ['name', 'code', 'path', 'message']
        .filter(field => caught[field] !== undefined)
        .map(field => [field, caught[field]]),
    );
  }
  return {
    message: caught === undefined ? 'Unknown external exception.' : String(caught),
  };
}

export function runControlledEngineV2Audit({
  enabled = false,
  authorized = false,
  executionGate,
  executeBridge = runExperimentalEngineV2Bridge,
  selectAuditInput,
} = {}) {
  if (enabled !== true) return omitted('feature-disabled');
  if (authorized !== true) return omitted('unauthorized');
  if (!validExecutionGate(executionGate)) return omitted('invalid-execution-gate');
  if (executionGate.current === true) return omitted('already-executed');
  if (typeof selectAuditInput !== 'function') return omitted('missing-audit-input-selector');

  executionGate.current = true;

  try {
    const auditInput = selectAuditInput();
    const bridgeInput = convertDiagnosticLabAuditInputToBridgeInput(auditInput);
    const result = executeBridge({
      ...bridgeInput,
      enabled: true,
    });
    return {
      executed: true,
      result,
      error: null,
      reason: 'completed',
    };
  } catch (caught) {
    return {
      executed: true,
      result: null,
      error: normalizeExternalError(caught),
      reason: 'external-exception',
    };
  }
}
