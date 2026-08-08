export const DEFAULT_CANONICAL_COMPILATION_CONFIG = Object.freeze({
  coordinatePrecisionDecimals: 6,
  comparisonToleranceMm: 0.000001,
  emitInitialPositionJump: true,
  allowSafeSubpathConnectorStitches: true,
  requireConnectorInsideEffectiveRegion: true,
  requireConnectorWithoutHoleCrossing: true,
  connectorMaximumLengthSource: 'technical_specification',
  trimUnsafeSubpathDiscontinuities: true,
  trimBetweenObjects: true,
  trimBeforeColorChange: true,
  trimBeforeEnd: false,
  deduplicateAdjacentTrims: true,
  omitZeroDistanceJumps: true,
  forbidStitchAcrossObjectBoundary: true,
  blockMissingPhysicalPath: true,
  blockIncompletePhysicalPath: true,
  allowPartialCanonicalStream: false,
  preserveGlobalSequence: true,
  preserveThreadBlocks: true,
  preserveSelectedEntryExit: true,
  machineAdaptation: false,
  coordinateQuantization: false,
  movementSplitting: false,
  encoding: false,
  conservativeMode: true,
});

export function resolveCanonicalCompilationConfig(input = {}) {
  const known = new Set(Object.keys(DEFAULT_CANONICAL_COMPILATION_CONFIG));
  const supplied = Object.fromEntries(Object.entries(input).filter(([key]) => known.has(key)));
  const extras = Object.freeze(Object.fromEntries(Object.entries(input).filter(([key]) => !known.has(key))));
  return Object.freeze({ ...DEFAULT_CANONICAL_COMPILATION_CONFIG, ...supplied, extras });
}

export function validateCanonicalCompilationConfig(config) {
  const errors = [];
  if (!Number.isInteger(config?.coordinatePrecisionDecimals) || config.coordinatePrecisionDecimals < 0) errors.push({ code: 'INVALID_CANONICAL_COORDINATE_PRECISION', path: 'coordinatePrecisionDecimals', message: 'Coordinate precision must be a non-negative integer.' });
  if (!Number.isFinite(config?.comparisonToleranceMm) || config.comparisonToleranceMm <= 0) errors.push({ code: 'INVALID_CANONICAL_COMPARISON_TOLERANCE', path: 'comparisonToleranceMm', message: 'Comparison tolerance must be positive and finite.' });
  if (config?.connectorMaximumLengthSource !== 'technical_specification') errors.push({ code: 'INVALID_CONNECTOR_MAXIMUM_SOURCE', path: 'connectorMaximumLengthSource', message: 'Connector maximum length must come from the technical specification.' });
  if (config?.machineAdaptation || config?.coordinateQuantization || config?.movementSplitting || config?.encoding) errors.push({ code: 'PHASE_10_MACHINE_OR_ENCODING_BEHAVIOR_FORBIDDEN', path: 'config', message: 'Phase 10 cannot adapt, quantize, split, or encode commands.' });
  return { valid: errors.length === 0, errors, warnings: [] };
}
