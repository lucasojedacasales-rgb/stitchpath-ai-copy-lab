import { isPointInEffectiveObjectArea, isPointOnObjectBoundary } from '../technical/objectGeometryMetrics.js';
import { validateGlobalSequencePlan } from '../sequencing/sequencePlanningValidation.js';
import { PHYSICAL_DISPOSITION_STATUSES, PHYSICAL_GENERATORS, PHYSICAL_STITCH_PHASES, PHYSICAL_STITCH_SOURCE_TYPES, PHYSICAL_STITCH_TECHNIQUES, physicalDispositionId, physicalGapId, physicalPathId, physicalPointId, physicalSubpathId } from './physicalStitchModel.js';
import { distanceBetweenPoints, pointOnPolygonBoundary, pointsEqualWithinTolerance, segmentCrossesHole } from './stitchGeometry.js';

const issue = (code, path, message) => ({ code, path, message });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const finite = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
function duplicates(values) { const seen = new Set(); return [...new Set(values.filter(value => { const duplicate = seen.has(value); seen.add(value); return duplicate; }))]; }

export function validatePhysicalStitchPointV2(point) {
  const errors = [];
  if (!point?.id || point.id !== physicalPointId(point.objectId, Number(point.subpathId?.split(':').at(-2)), point.pointIndex)) errors.push(issue('NONDETERMINISTIC_PHYSICAL_POINT_ID', 'id', 'Physical point ID is missing or nondeterministic.'));
  if (!finite(point)) errors.push(issue('NONFINITE_PHYSICAL_COORDINATE', 'x,y', 'Physical coordinates must be finite.'));
  if (!PHYSICAL_STITCH_PHASES.includes(point?.phase)) errors.push(issue('INVALID_PHYSICAL_PHASE', 'phase', 'Physical phase is invalid.'));
  if (!PHYSICAL_STITCH_TECHNIQUES.includes(point?.technique)) errors.push(issue('INVALID_PHYSICAL_TECHNIQUE', 'technique', 'Physical technique is invalid.'));
  if (!PHYSICAL_STITCH_SOURCE_TYPES.includes(point?.sourceType)) errors.push(issue('INVALID_PHYSICAL_SOURCE_TYPE', 'sourceType', 'Physical source type is invalid.'));
  if (Object.hasOwn(point || {}, 'type') || Object.hasOwn(point || {}, 'machineX')) errors.push(issue('COMMAND_OR_MACHINE_FIELD_ON_PHYSICAL_POINT', 'point', 'Physical points cannot contain command or machine fields.'));
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function validatePhysicalStitchSubpathV2(subpath, object, technicalSpecification) {
  const errors = []; const warnings = [];
  if (subpath?.id !== physicalSubpathId(subpath?.objectId, subpath?.subpathIndex, subpath?.technique)) errors.push(issue('NONDETERMINISTIC_PHYSICAL_SUBPATH_ID', 'id', 'Subpath ID is nondeterministic.'));
  if (!Array.isArray(subpath?.points) || !subpath.points.length) errors.push(issue('EMPTY_PHYSICAL_SUBPATH', 'points', 'A physical subpath requires at least one point.'));
  if (subpath?.technique !== 'anchor' && subpath?.points?.length < 2) errors.push(issue('STITCH_SUBPATH_TOO_SHORT', 'points', 'A stitch-producing subpath requires at least two points.'));
  (subpath?.points || []).forEach((point, index) => errors.push(...validatePhysicalStitchPointV2(point).errors.map(item => ({ ...item, path: `points[${index}].${item.path}` }))));
  duplicates((subpath?.points || []).map(point => point.id)).forEach(id => errors.push(issue('DUPLICATE_PHYSICAL_POINT_ID', 'points', `Duplicate physical point ID "${id}".`)));
  for (let index = 1; index < (subpath?.points?.length || 0); index += 1) {
    const previous = subpath.points[index - 1]; const point = subpath.points[index]; const length = distanceBetweenPoints(previous, point);
    if (!(length > 0)) errors.push(issue('ZERO_LENGTH_PHYSICAL_STITCH', `points[${index}]`, 'Physical stitches cannot have zero length.'));
    if (segmentCrossesHole(previous, point, object?.holes || [])) errors.push(issue('PHYSICAL_STITCH_CROSSES_HOLE', `points[${index}]`, 'A physical stitch crosses an explicit hole.'));
    const parameters = technicalSpecification?.stitchParameters || {}; let minimum = parameters.minimumStitchLengthMm; let maximum = parameters.maximumStitchLengthMm;
    if (subpath.technique === 'satin') { minimum = parameters.minimumAllowedWidthMm; maximum = parameters.maximumAllowedWidthMm; }
    const exception = point.source?.lengthExceptionCode || previous.source?.lengthExceptionCode || point.sourceType === 'compensation_adjusted_endpoint' || subpath.closed;
    if (Number.isFinite(minimum) && Number.isFinite(maximum) && (length < minimum - 1e-6 || length > maximum + 1e-6)) {
      if (exception) warnings.push(issue('EXPLICIT_STITCH_LENGTH_EXCEPTION', `points[${index}]`, 'Stitch length exception is explicitly evidenced.'));
      else errors.push(issue('INVALID_PHYSICAL_STITCH_LENGTH', `points[${index}]`, 'Physical stitch length is outside Phase 7 bounds.'));
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function validatePhysicalSubpathTransitionV2(transition) {
  const errors = [];
  if (transition?.id !== physicalGapId(transition?.objectId, transition?.fromSubpathId, transition?.toSubpathId)) errors.push(issue('NONDETERMINISTIC_PHYSICAL_GAP_ID', 'id', 'Gap ID is nondeterministic.'));
  if (!finite(transition?.fromPoint) || !finite(transition?.toPoint) || !Number.isFinite(transition?.distanceMm)) errors.push(issue('INVALID_PHYSICAL_GAP_GEOMETRY', 'transition', 'Gap geometry must be finite.'));
  if (finite(transition?.fromPoint) && finite(transition?.toPoint) && Math.abs(distanceBetweenPoints(transition.fromPoint, transition.toPoint) - transition.distanceMm) > 1e-6) errors.push(issue('PHYSICAL_GAP_DISTANCE_MISMATCH', 'distanceMm', 'Gap distance does not match its endpoints.'));
  if (Object.hasOwn(transition || {}, 'commandType') || Object.hasOwn(transition || {}, 'jump') || Object.hasOwn(transition || {}, 'trim')) errors.push(issue('COMMAND_CLASSIFICATION_ON_PHYSICAL_GAP', 'transition', 'Physical gaps cannot be classified as commands.'));
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function validateObjectPhysicalStitchPathV2(path, object, specification, selectedEntryExit, config = {}) {
  const errors = []; const warnings = [];
  if (path?.id !== physicalPathId(path?.objectId)) errors.push(issue('NONDETERMINISTIC_PHYSICAL_PATH_ID', 'id', 'Physical path ID is nondeterministic.'));
  if (!object || path?.objectId !== object.id) errors.push(issue('PHYSICAL_PATH_UNKNOWN_OBJECT', 'objectId', 'Physical path references an unknown object.'));
  if (object && path.threadId !== object.threadId) errors.push(issue('PHYSICAL_PATH_THREAD_MISMATCH', 'threadId', 'Object thread changed.'));
  if (path?.technicalSpecificationId !== specification?.id) errors.push(issue('PHYSICAL_PATH_TECHNICAL_SPECIFICATION_MISMATCH', 'technicalSpecificationId', 'Technical specification reference changed.'));
  if (!PHYSICAL_GENERATORS.includes(path?.generator) || path?.generator !== object?.stitchType) errors.push(issue('PHYSICAL_GENERATOR_MISMATCH', 'generator', 'Generator must match the object stitch type.'));
  if (path?.entryCandidateId !== selectedEntryExit?.entryCandidateId || path?.exitCandidateId !== selectedEntryExit?.exitCandidateId) errors.push(issue('SELECTED_CANDIDATE_IDENTITY_MUTATION', 'candidateIds', 'Selected candidate identity changed.'));
  if (!same(path?.selectedEntryPoint, selectedEntryExit?.entryPoint) || !same(path?.selectedExitPoint, selectedEntryExit?.exitPoint)) errors.push(issue('SELECTED_ANCHOR_POINT_MUTATION', 'selectedPoints', 'Selected anchor point changed.'));
  if (!pointsEqualWithinTolerance(path?.firstPhysicalPoint, selectedEntryExit?.entryPoint, config.comparisonToleranceMm ?? 1e-6)) errors.push(issue('ENTRY_ANCHOR_MISMATCH', 'firstPhysicalPoint', 'First physical point must match selected entry.'));
  if (!pointsEqualWithinTolerance(path?.lastPhysicalPoint, selectedEntryExit?.exitPoint, config.comparisonToleranceMm ?? 1e-6)) errors.push(issue('EXIT_ANCHOR_MISMATCH', 'lastPhysicalPoint', 'Last physical point must match selected exit.'));
  duplicates((path?.subpaths || []).map(item => item.id)).forEach(id => errors.push(issue('DUPLICATE_PHYSICAL_SUBPATH_ID', 'subpaths', `Duplicate subpath ID "${id}".`)));
  (path?.subpaths || []).forEach((subpath, index) => { if (subpath.subpathIndex !== index) errors.push(issue('NONCONTIGUOUS_PHYSICAL_SUBPATH_INDEX', `subpaths[${index}]`, 'Subpath indices must be contiguous.')); const validation = validatePhysicalStitchSubpathV2(subpath, object, specification); errors.push(...validation.errors.map(item => ({ ...item, path: `subpaths[${index}].${item.path}` }))); warnings.push(...validation.warnings); });
  if ((path?.subpaths || []).filter(item => item.phase === 'top').length === 0) errors.push(issue('PHYSICAL_TOP_PATH_MISSING', 'subpaths', 'Generated path requires top stitches.'));
  const firstTop = path?.subpaths?.findIndex(item => item.phase === 'top') ?? -1; if ((path?.subpaths || []).some((item, index) => item.phase === 'underlay' && index > firstTop && firstTop >= 0)) errors.push(issue('UNDERLAY_ORDER_MISMATCH', 'subpaths', 'Underlay must precede top stitches.'));
  (path?.subpathTransitions || []).forEach((transition, index) => {
    const validation = validatePhysicalSubpathTransitionV2(transition);
    errors.push(...validation.errors.map(item => ({ ...item, path: `subpathTransitions[${index}].${item.path}` })));
  });
  if ((path?.subpathTransitions || []).length !== Math.max(0, (path?.subpaths || []).length - 1)) errors.push(issue('PHYSICAL_GAP_COVERAGE_MISMATCH', 'subpathTransitions', 'Every adjacent subpath pair requires one diagnostic gap.'));
  const pointCount = (path?.subpaths || []).reduce((sum, item) => sum + item.points.length, 0); if (path?.physicalPointCount !== pointCount) errors.push(issue('PHYSICAL_POINT_COUNT_MISMATCH', 'physicalPointCount', 'Physical point count is incorrect.'));
  if (pointCount > (config.maximumPointsPerObject ?? Infinity)) errors.push(issue('PHYSICAL_GENERATION_LIMIT_EXCEEDED', 'physicalPointCount', 'Object point limit exceeded.'));
  return { valid: errors.length === 0, errors, warnings };
}

function forbiddenOutput(value, path, errors) {
  if (!value || typeof value !== 'object') return;
  const arrays = new Set(['commands', 'canonicalCommands', 'jumpCommands', 'trimCommands', 'colorChangeCommands', 'endCommands']); const objects = new Set(['machineProfile', 'machineLimits', 'ce01', 'encoder', 'dst', 'dsb']);
  Object.entries(value).forEach(([key, nested]) => { if (arrays.has(key) && Array.isArray(nested) && nested.length) errors.push(issue('COMMAND_OUTPUT_FORBIDDEN_IN_PHASE_9', `${path}.${key}`, `${key} is forbidden.`)); else if (objects.has(key) && nested != null && nested !== false) errors.push(issue('MACHINE_OR_ENCODING_OUTPUT_FORBIDDEN_IN_PHASE_9', `${path}.${key}`, `${key} is forbidden.`)); else forbiddenOutput(nested, `${path}.${key}`, errors); });
}

export function validateMachineIndependentPhysicalStitchPlan(physicalPlan, threadedObjectMaterialization, technicalPlan, sequencePlan) {
  const errors = []; const warnings = []; const sequenceValidation = validateGlobalSequencePlan(sequencePlan, threadedObjectMaterialization, technicalPlan); errors.push(...sequenceValidation.errors);
  const scheduledSteps = sequencePlan?.executionSteps || []; const dispositions = physicalPlan?.dispositions || []; const paths = physicalPlan?.objectPaths || [];
  const objectMap = new Map((threadedObjectMaterialization?.objects || []).map(item => [item.id, item])); const specificationMap = new Map((technicalPlan?.specifications || []).map(item => [item.objectId, item])); const selectionMap = new Map((sequencePlan?.selectedEntryExitPairs || []).map(item => [item.objectId, item]));
  duplicates(dispositions.map(item => item.id)).forEach(id => errors.push(issue('DUPLICATE_PHYSICAL_DISPOSITION', 'dispositions', `Duplicate disposition "${id}".`))); duplicates(dispositions.map(item => item.objectId)).forEach(id => errors.push(issue('DUPLICATE_OBJECT_PHYSICAL_DISPOSITION', 'dispositions', `Object "${id}" has multiple dispositions.`)));
  scheduledSteps.forEach(step => { const matches = dispositions.filter(item => item.objectId === step.objectId); if (!matches.length) errors.push(issue('SCHEDULED_OBJECT_WITHOUT_PHYSICAL_DISPOSITION', 'dispositions', `Scheduled object "${step.objectId}" has no physical disposition.`)); });
  dispositions.forEach((disposition, index) => { if (disposition.id !== physicalDispositionId(disposition.objectId) || !PHYSICAL_DISPOSITION_STATUSES.includes(disposition.status)) errors.push(issue('INVALID_PHYSICAL_DISPOSITION', `dispositions[${index}]`, 'Physical disposition is invalid.')); const hasPath = paths.some(path => path.objectId === disposition.objectId); if (disposition.status === 'generated' && !hasPath) errors.push(issue('GENERATED_DISPOSITION_WITHOUT_PATH', `dispositions[${index}]`, 'Generated disposition requires a path.')); if (disposition.status !== 'generated' && hasPath) errors.push(issue('FAILED_PHYSICAL_PATH_PARTIALLY_ACCEPTED', `dispositions[${index}]`, 'Blocked/manual disposition cannot retain a path.')); });
  duplicates(paths.map(item => item.objectId)).forEach(id => errors.push(issue('DUPLICATE_OBJECT_PHYSICAL_PATH', 'objectPaths', `Duplicate path for "${id}".`)));
  paths.forEach((path, index) => { const step = scheduledSteps.find(item => item.objectId === path.objectId); if (!step) errors.push(issue('PATH_FOR_UNSCHEDULED_OBJECT', `objectPaths[${index}]`, 'Physical path belongs to an unscheduled object.')); else { if (path.executionStepId !== step.id || path.threadBlockId !== step.threadBlockId) errors.push(issue('PHYSICAL_PATH_SEQUENCE_REFERENCE_MISMATCH', `objectPaths[${index}]`, 'Execution or thread-block reference changed.')); const validation = validateObjectPhysicalStitchPathV2(path, objectMap.get(path.objectId), specificationMap.get(path.objectId), selectionMap.get(path.objectId), physicalPlan.config); errors.push(...validation.errors.map(item => ({ ...item, path: `objectPaths[${index}].${item.path}` }))); warnings.push(...validation.warnings); } });
  if (!same(physicalPlan?.executionOrder, scheduledSteps.map(item => item.objectId))) errors.push(issue('GLOBAL_SEQUENCE_MUTATION', 'executionOrder', 'Phase 8 execution order changed.'));
  if (!same(physicalPlan?.threadBlockReferences, sequencePlan?.threadBlocks)) errors.push(issue('THREAD_BLOCK_MUTATION', 'threadBlockReferences', 'Phase 8 thread blocks changed.'));
  if (physicalPlan?.summary?.physicalDispositionCoveragePercent !== 100) errors.push(issue('PHYSICAL_DISPOSITION_COVERAGE_BELOW_100', 'summary.physicalDispositionCoveragePercent', 'Physical disposition coverage must be 100%.'));
  if (physicalPlan?.summary?.silentScheduledObjectDropCount > 0) errors.push(issue('SILENT_SCHEDULED_OBJECT_DROP', 'summary.silentScheduledObjectDropCount', 'Scheduled objects were silently dropped.'));
  if (physicalPlan?.metadata?.inputMutationsDetected) errors.push(issue('PHYSICAL_GENERATION_INPUT_MUTATION', 'metadata', 'Physical generation mutated input structures.'));
  for (const field of ['canonicalCommandsGenerated', 'jumpCommandsGenerated', 'trimCommandsGenerated', 'colorChangeCommandsGenerated', 'endCommandsGenerated', 'machineAdaptationAdded', 'encodingAdded']) if (physicalPlan?.metadata?.[field] === true) errors.push(issue('PHASE_9_FORBIDDEN_OUTPUT_FLAG', `metadata.${field}`, `${field} must remain false.`));
  forbiddenOutput(physicalPlan, 'physicalPlan', errors);
  return { valid: errors.length === 0, errors, warnings };
}
