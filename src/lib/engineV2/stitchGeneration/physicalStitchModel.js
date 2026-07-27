export const PHYSICAL_STITCH_PHASES = Object.freeze(['entry_anchor', 'underlay', 'top', 'exit_anchor']);
export const PHYSICAL_STITCH_TECHNIQUES = Object.freeze(['anchor', 'running', 'tatami', 'satin', 'center_run', 'edge_run', 'zigzag', 'tatami_lattice']);
export const PHYSICAL_STITCH_SOURCE_TYPES = Object.freeze(['selected_entry', 'selected_exit', 'source_geometry', 'resampled_source_geometry', 'scanline_intersection', 'satin_cross_section', 'underlay_plan', 'compensation_adjusted_endpoint']);
export const PHYSICAL_DISPOSITION_STATUSES = Object.freeze(['generated', 'manual_required', 'blocked']);
export const PHYSICAL_GENERATORS = Object.freeze(['running', 'tatami', 'satin', 'manual']);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  return value;
}

export function deepFreezePhysicalValue(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreezePhysicalValue);
  return Object.freeze(value);
}

const pad = value => String(value).padStart(4, '0');
export const physicalPointId = (objectId, subpathIndex, pointIndex) => `physical-point:${objectId}:${pad(subpathIndex)}:${pad(pointIndex)}`;
export const physicalSubpathId = (objectId, subpathIndex, technique) => `physical-subpath:${objectId}:${pad(subpathIndex)}:${technique}`;
export const physicalGapId = (objectId, fromSubpathId, toSubpathId) => `physical-gap:${objectId}:${fromSubpathId}:${toSubpathId}`;
export const physicalDispositionId = objectId => `physical-disposition:${objectId}`;
export const physicalPathId = objectId => `physical-path:${objectId}`;

export function createPhysicalStitchPointV2(input = {}) {
  return deepFreezePhysicalValue({
    id: input.id ?? physicalPointId(input.objectId, input.subpathIndex ?? 0, input.pointIndex ?? 0),
    objectId: input.objectId ?? null,
    subpathId: input.subpathId ?? physicalSubpathId(input.objectId, input.subpathIndex ?? 0, input.technique ?? 'anchor'),
    pointIndex: Number.isInteger(input.pointIndex) ? input.pointIndex : null,
    x: input.x, y: input.y, phase: input.phase ?? null, technique: input.technique ?? null,
    sourceType: input.sourceType ?? null, source: clone(input.source ?? null),
  });
}

export function createPhysicalStitchSubpathV2(input = {}) {
  const points = (input.points || []).map(createPhysicalStitchPointV2);
  return deepFreezePhysicalValue({
    id: input.id ?? physicalSubpathId(input.objectId, input.subpathIndex ?? 0, input.technique), objectId: input.objectId ?? null,
    sequenceIndex: Number.isInteger(input.sequenceIndex) ? input.sequenceIndex : null, subpathIndex: Number.isInteger(input.subpathIndex) ? input.subpathIndex : null,
    phase: input.phase ?? null, technique: input.technique ?? null, points, closed: input.closed === true, continuous: input.continuous !== false,
    sourceTechnicalComponent: clone(input.sourceTechnicalComponent ?? null), stitchCount: Number.isInteger(input.stitchCount) ? input.stitchCount : Math.max(0, points.length - 1),
    lengthMm: Number.isFinite(input.lengthMm) ? input.lengthMm : 0, minimumStitchLengthMm: Number.isFinite(input.minimumStitchLengthMm) ? input.minimumStitchLengthMm : 0,
    maximumStitchLengthMm: Number.isFinite(input.maximumStitchLengthMm) ? input.maximumStitchLengthMm : 0, source: clone(input.source ?? null),
  });
}

export function createPhysicalSubpathTransitionV2(input = {}) {
  return deepFreezePhysicalValue({
    id: input.id ?? physicalGapId(input.objectId, input.fromSubpathId, input.toSubpathId), objectId: input.objectId ?? null,
    fromSubpathId: input.fromSubpathId ?? null, toSubpathId: input.toSubpathId ?? null, fromPoint: clone(input.fromPoint ?? null), toPoint: clone(input.toPoint ?? null),
    distanceMm: input.distanceMm, continuousStitchAllowed: input.continuousStitchAllowed === true,
    crossesOutsideEffectiveRegion: input.crossesOutsideEffectiveRegion === true, crossesHole: input.crossesHole === true,
    reason: input.reason ?? null, source: clone(input.source ?? null),
  });
}

export function createObjectPhysicalStitchDispositionV2(input = {}) {
  return deepFreezePhysicalValue({
    id: input.id ?? physicalDispositionId(input.objectId), objectId: input.objectId ?? null, executionStepId: input.executionStepId ?? null,
    technicalSpecificationId: input.technicalSpecificationId ?? null, status: input.status ?? 'blocked', reasonCode: input.reasonCode ?? null,
    reason: input.reason ?? null, generator: input.generator ?? null, evidence: clone(input.evidence ?? []), source: clone(input.source ?? null),
  });
}

export function createObjectPhysicalStitchPathV2(input = {}) {
  const subpaths = (input.subpaths || []).map(createPhysicalStitchSubpathV2);
  const transitions = (input.subpathTransitions || []).map(createPhysicalSubpathTransitionV2);
  return deepFreezePhysicalValue({
    id: input.id ?? physicalPathId(input.objectId), objectId: input.objectId ?? null, regionId: input.regionId ?? null,
    threadId: input.threadId ?? null, executionStepId: input.executionStepId ?? null, threadBlockId: input.threadBlockId ?? null,
    technicalSpecificationId: input.technicalSpecificationId ?? null, selectedEntryExitId: input.selectedEntryExitId ?? null,
    status: input.status ?? 'generated', generator: input.generator ?? null, entryCandidateId: input.entryCandidateId ?? null,
    exitCandidateId: input.exitCandidateId ?? null, selectedEntryPoint: clone(input.selectedEntryPoint ?? null), selectedExitPoint: clone(input.selectedExitPoint ?? null),
    subpaths, subpathTransitions: transitions, underlaySubpathIds: clone(input.underlaySubpathIds ?? []), topSubpathIds: clone(input.topSubpathIds ?? []),
    firstPhysicalPoint: clone(input.firstPhysicalPoint ?? null), lastPhysicalPoint: clone(input.lastPhysicalPoint ?? null),
    physicalPointCount: input.physicalPointCount ?? 0, physicalStitchCount: input.physicalStitchCount ?? 0,
    underlayPointCount: input.underlayPointCount ?? 0, underlayStitchCount: input.underlayStitchCount ?? 0,
    topPointCount: input.topPointCount ?? 0, topStitchCount: input.topStitchCount ?? 0,
    totalLengthMm: input.totalLengthMm ?? 0, underlayLengthMm: input.underlayLengthMm ?? 0, topLengthMm: input.topLengthMm ?? 0,
    bounds: clone(input.bounds ?? null), coverageMetrics: clone(input.coverageMetrics ?? {}), qualityMetrics: clone(input.qualityMetrics ?? {}),
    warnings: clone(input.warnings ?? []), errors: clone(input.errors ?? []), source: clone(input.source ?? null),
  });
}

export function createMachineIndependentPhysicalStitchPlanV2(input = {}) {
  const dispositions = (input.dispositions || []).map(createObjectPhysicalStitchDispositionV2);
  const objectPaths = (input.objectPaths || []).map(createObjectPhysicalStitchPathV2);
  return deepFreezePhysicalValue({
    version: input.version ?? '2-machine-independent-physical-stitch-plan', dispositions, objectPaths,
    executionOrder: clone(input.executionOrder ?? []), threadBlockReferences: clone(input.threadBlockReferences ?? []),
    byDispositionId: clone(input.byDispositionId ?? Object.fromEntries(dispositions.map(item => [item.id, item]))),
    byObjectId: clone(input.byObjectId ?? Object.fromEntries(objectPaths.map(item => [item.objectId, item]))),
    byExecutionStepId: clone(input.byExecutionStepId ?? Object.fromEntries(objectPaths.map(item => [item.executionStepId, item]))),
    valid: input.valid === true, errors: clone(input.errors ?? []), warnings: clone(input.warnings ?? []),
    summary: clone(input.summary ?? {}), config: clone(input.config ?? {}), metadata: clone(input.metadata ?? {}),
  });
}
