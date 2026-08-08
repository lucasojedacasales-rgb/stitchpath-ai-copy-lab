export function distributeStitchIntervals(lengthMm, options = {}) {
  const target = options.targetStitchLengthMm; const minimum = options.minimumStitchLengthMm; const maximum = options.maximumStitchLengthMm;
  const errors = []; const warnings = [];
  if (![lengthMm, target, minimum, maximum].every(Number.isFinite) || lengthMm <= 0 || target <= 0 || minimum <= 0 || maximum < minimum) return { valid: false, intervalCount: 0, intervalLengthMm: 0, lengths: [], errors: [{ code: 'INVALID_STITCH_LENGTH_DISTRIBUTION_INPUT' }], warnings };
  const minimumIntervals = Math.max(1, Math.ceil(lengthMm / maximum)); const maximumIntervals = Math.floor(lengthMm / minimum);
  if (maximumIntervals < minimumIntervals) {
    warnings.push({ code: 'STITCH_LENGTH_BOUNDS_MATHEMATICALLY_IMPOSSIBLE', lengthMm, minimumStitchLengthMm: minimum, maximumStitchLengthMm: maximum });
    return { valid: true, intervalCount: 1, intervalLengthMm: lengthMm, lengths: [lengthMm], errors, warnings, exceptionCode: lengthMm < minimum ? 'PRESERVED_SHORT_SOURCE_SEGMENT' : 'PRESERVED_LONG_SOURCE_SEGMENT' };
  }
  const preferred = Math.max(minimumIntervals, Math.min(maximumIntervals, Math.round(lengthMm / target) || 1)); const intervalLengthMm = lengthMm / preferred;
  return { valid: true, intervalCount: preferred, intervalLengthMm, lengths: Array(preferred).fill(intervalLengthMm), errors, warnings, exceptionCode: null };
}

export function summarizeStitchLengths(lengths = []) {
  const valid = lengths.filter(value => Number.isFinite(value) && value > 0);
  return Object.freeze({ count: valid.length, minimumMm: valid.length ? Math.min(...valid) : 0, maximumMm: valid.length ? Math.max(...valid) : 0, averageMm: valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0, totalMm: valid.reduce((sum, value) => sum + value, 0) });
}
