import { validateHatchOverlapIntegrationConfig } from '../rules/hatchEvidence/overlapProfiles.js';

export const SEQUENCE_PLANNING_ALGORITHMS = Object.freeze(['auto', 'exact', 'beam']);

export const DEFAULT_SEQUENCE_PLANNING_CONFIG = Object.freeze({
  strategy: 'dependency_thread_travel',
  algorithm: 'auto',
  exactSearchObjectLimit: 9,
  beamWidth: 128,
  maximumExpandedStates: 200000,
  maximumEntryCandidatesPerObject: 8,
  maximumExitCandidatesPerObject: 8,
  minimizeThreadChanges: true,
  minimizeThreadRevisits: true,
  minimizeEstimatedTravel: true,
  allowDependencyRequiredThreadRevisit: true,
  allowTravelOnlyThreadRevisit: false,
  blockOnUnscheduledDependency: true,
  selectFinalEntryExitPairs: true,
  createThreadBlocks: true,
  startAnchorMm: null,
  endAnchorMm: null,
  blackLast: false,
  rolePriority: Object.freeze([]),
  forceOutlinesLast: false,
  generatePhysicalStitches: false,
  generatePhysicalUnderlay: false,
  generateCanonicalCommands: false,
  machineAdaptation: false,
  encoding: false,
  conservativeMode: true,
});

const finitePoint = point => point === null || (
  point && typeof point === 'object' && Number.isFinite(point.x) && Number.isFinite(point.y)
);
const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function resolveSequencePlanningConfig(input = {}) {
  const source = plainObject(input) ? input : {};
  const known = new Set(Object.keys(DEFAULT_SEQUENCE_PLANNING_CONFIG));
  const nestedExtras = plainObject(source.extras) ? source.extras : {};
  const topLevelExtras = Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== 'extras' && !known.has(key)),
  );
  const extras = { ...nestedExtras, ...topLevelExtras };
  return Object.freeze({
    ...DEFAULT_SEQUENCE_PLANNING_CONFIG,
    ...Object.fromEntries(Object.entries(source).filter(([key]) => known.has(key))),
    rolePriority: Object.freeze(Array.isArray(source.rolePriority) ? [...source.rolePriority] : []),
    extras: Object.freeze(extras),
  });
}
export function validateSequencePlanningConfig(input = {}) {
  const config = resolveSequencePlanningConfig(input);
  const errors = [...validateHatchOverlapIntegrationConfig(input).errors];
  if (Object.hasOwn(input || {}, 'extras') && !plainObject(input.extras)) {
    errors.push({
      code: 'INVALID_SEQUENCE_PLANNING_EXTRAS',
      path: 'extras',
      message: 'extras must be an object when provided.',
    });
  }
  if (!SEQUENCE_PLANNING_ALGORITHMS.includes(config?.algorithm)) errors.push({ code: 'INVALID_SEQUENCE_ALGORITHM', path: 'algorithm', message: 'Algorithm must be auto, exact, or beam.' });
  ['exactSearchObjectLimit', 'beamWidth', 'maximumExpandedStates', 'maximumEntryCandidatesPerObject', 'maximumExitCandidatesPerObject'].forEach(field => {
    if (!Number.isInteger(config?.[field]) || config[field] <= 0) errors.push({ code: 'INVALID_SEQUENCE_LIMIT', path: field, message: `${field} must be a positive integer.` });
  });
  if (!finitePoint(config?.startAnchorMm)) errors.push({ code: 'INVALID_START_ANCHOR', path: 'startAnchorMm', message: 'Start anchor must be null or a finite point.' });
  if (!finitePoint(config?.endAnchorMm)) errors.push({ code: 'INVALID_END_ANCHOR', path: 'endAnchorMm', message: 'End anchor must be null or a finite point.' });
  if (config?.generatePhysicalStitches || config?.generatePhysicalUnderlay || config?.generateCanonicalCommands || config?.machineAdaptation || config?.encoding) {
    errors.push({ code: 'PHASE_8_PHYSICAL_OUTPUT_FORBIDDEN', path: 'config', message: 'Phase 8 cannot generate physical or encoded output.' });
  }
  return { valid: errors.length === 0, errors, warnings: [], config };
}

export function resolveSequenceAlgorithm(config, objectCount) {
  if (config.algorithm !== 'auto') return config.algorithm;
  return objectCount <= config.exactSearchObjectLimit ? 'exact' : 'beam';
}
