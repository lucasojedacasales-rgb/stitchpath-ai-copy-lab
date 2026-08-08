export const TECHNICAL_SPECIFICATION_STATUSES = Object.freeze(['planned', 'manual_required', 'blocked']);
export const FILL_ANGLE_STRATEGIES = Object.freeze(['not_applicable', 'principal_axis', 'perpendicular_to_principal_axis', 'alternate_from_parent', 'explicit_override', 'configured_default', 'manual_required']);
export const UNDERLAY_COMPONENT_TYPES = Object.freeze(['center_run', 'edge_run', 'zigzag', 'tatami_lattice']);
export const PULL_COMPENSATION_STRATEGIES = Object.freeze(['none', 'uniform', 'axis_aware', 'manual_required']);
export const ENTRY_EXIT_KINDS = Object.freeze(['entry', 'exit']);
export const ENTRY_EXIT_SOURCE_TYPES = Object.freeze(['boundary_vertex', 'cardinal_boundary', 'interior_point', 'dependency_facing_boundary', 'outline_start_candidate', 'manual']);
export const GENERATOR_TYPES = Object.freeze(['tatami', 'satin', 'running', 'manual']);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function technicalSpecificationIdForObject(objectId) {
  return `technical:${objectId}`;
}

export function createObjectTechnicalSpecificationV2(input = {}) {
  return deepFreeze({
    id: input.id ?? technicalSpecificationIdForObject(input.objectId),
    objectId: input.objectId ?? null,
    regionId: input.regionId ?? null,
    threadId: input.threadId ?? null,
    role: input.role ?? null,
    stitchType: input.stitchType ?? null,
    status: input.status ?? 'blocked',
    materialProfileId: input.materialProfileId ?? null,
    planningProfile: input.planningProfile ?? null,
    geometryMetrics: clone(input.geometryMetrics ?? null),
    stitchParameters: clone(input.stitchParameters ?? null),
    underlayPlan: clone(input.underlayPlan ?? null),
    fillAnglePlan: clone(input.fillAnglePlan ?? null),
    pullCompensationPlan: clone(input.pullCompensationPlan ?? null),
    entryCandidates: clone(Array.isArray(input.entryCandidates) ? input.entryCandidates : []),
    exitCandidates: clone(Array.isArray(input.exitCandidates) ? input.exitCandidates : []),
    generatorReadiness: clone(input.generatorReadiness ?? null),
    planningConfidence: Number.isFinite(input.planningConfidence) ? Math.max(0, Math.min(1, input.planningConfidence)) : 0,
    needsReview: input.needsReview === true,
    blockingReasons: clone(Array.isArray(input.blockingReasons) ? input.blockingReasons : []),
    warnings: clone(Array.isArray(input.warnings) ? input.warnings : []),
    evidence: clone(Array.isArray(input.evidence) ? input.evidence : []),
    source: clone(input.source ?? null),
  });
}

export function createUnderlayPlanV2(input = {}) {
  return deepFreeze({ applicable: input.applicable === true, enabled: input.enabled === true, sequence: clone(Array.isArray(input.sequence) ? input.sequence : []), source: clone(input.source ?? null), confidence: Number.isFinite(input.confidence) ? input.confidence : 0, warnings: clone(Array.isArray(input.warnings) ? input.warnings : []) });
}

export function createPullCompensationPlanV2(input = {}) {
  return deepFreeze({ applicable: input.applicable === true, enabled: input.enabled === true, strategy: input.strategy ?? 'none', amountMm: Number.isFinite(input.amountMm) ? input.amountMm : 0, axisDegrees: Number.isFinite(input.axisDegrees) ? input.axisDegrees : null, maximumAllowedMm: input.maximumAllowedMm, materialScale: input.materialScale, confidence: Number.isFinite(input.confidence) ? input.confidence : 0, evidence: clone(Array.isArray(input.evidence) ? input.evidence : []), warnings: clone(Array.isArray(input.warnings) ? input.warnings : []) });
}

export function createEntryExitCandidateV2(input = {}) {
  return deepFreeze({ id: input.id ?? null, objectId: input.objectId ?? null, kind: input.kind ?? null, point: clone(input.point ?? null), sourceType: input.sourceType ?? null, boundaryIndex: Number.isInteger(input.boundaryIndex) ? input.boundaryIndex : null, scoreHints: clone(input.scoreHints ?? {}), valid: input.valid === true, rejectionReasons: clone(Array.isArray(input.rejectionReasons) ? input.rejectionReasons : []), source: clone(input.source ?? null) });
}

export function createGeneratorReadinessV2(input = {}) {
  return deepFreeze({ generator: input.generator ?? null, ready: input.ready === true, confidence: Number.isFinite(input.confidence) ? input.confidence : 0, missingRequirements: clone(Array.isArray(input.missingRequirements) ? input.missingRequirements : []), warnings: clone(Array.isArray(input.warnings) ? input.warnings : []), source: clone(input.source ?? null) });
}
