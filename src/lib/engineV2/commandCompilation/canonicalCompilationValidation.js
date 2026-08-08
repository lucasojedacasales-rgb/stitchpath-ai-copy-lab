import { validateCanonicalCommandV2 } from '../modelValidation.js';
import { distanceBetweenPoints, pointsEqualWithinTolerance } from '../stitchGeneration/stitchGeometry.js';
import { CANONICAL_COMPILATION_STATUSES, CANONICAL_DISCONTINUITY_CLASSIFICATIONS, canonicalDispositionId, canonicalGapId, canonicalSpanId } from './canonicalCompilationModel.js';
import { canonicalCommandId } from './canonicalCommandId.js';

const issue = (code, path, message) => ({ code, path, message });
const duplicates = values => { const seen = new Set(); return [...new Set(values.filter(value => { const duplicate = seen.has(value); seen.add(value); return duplicate; }))]; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function validateCanonicalCompilationDispositionV2(disposition) {
  const errors = [];
  if (disposition?.id !== canonicalDispositionId(disposition?.objectId)) errors.push(issue('NONDETERMINISTIC_CANONICAL_DISPOSITION_ID', 'id', 'Disposition id is nondeterministic.'));
  if (!CANONICAL_COMPILATION_STATUSES.includes(disposition?.status)) errors.push(issue('INVALID_CANONICAL_DISPOSITION_STATUS', 'status', 'Disposition status is invalid.'));
  if (!disposition?.objectId || !disposition?.executionStepId) errors.push(issue('INCOMPLETE_CANONICAL_DISPOSITION', 'disposition', 'Disposition requires object and execution-step references.'));
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function validateCanonicalObjectCommandSpanV2(span, commandCount = Infinity) {
  const errors = [];
  if (span?.id !== canonicalSpanId(span?.objectId)) errors.push(issue('NONDETERMINISTIC_CANONICAL_SPAN_ID', 'id', 'Command-span id is nondeterministic.'));
  if (!Number.isInteger(span?.firstCommandIndex) || !Number.isInteger(span?.lastCommandIndex) || span.firstCommandIndex < 0 || span.lastCommandIndex < span.firstCommandIndex || span.lastCommandIndex >= commandCount) errors.push(issue('CANONICAL_SPAN_INDEX_OUT_OF_RANGE', 'firstCommandIndex,lastCommandIndex', 'Command-span indexes are invalid.'));
  if (Number.isInteger(span?.firstCommandIndex) && Number.isInteger(span?.lastCommandIndex) && span.commandCount !== span.lastCommandIndex - span.firstCommandIndex + 1) errors.push(issue('CANONICAL_SPAN_COUNT_MISMATCH', 'commandCount', 'Command-span count does not match indexes.'));
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function validateCanonicalDiscontinuityClassificationV2(classification) {
  const errors = [];
  if (classification?.id !== canonicalGapId(classification?.transitionId)) errors.push(issue('NONDETERMINISTIC_CANONICAL_GAP_ID', 'id', 'Discontinuity classification id is nondeterministic.'));
  if (!CANONICAL_DISCONTINUITY_CLASSIFICATIONS.includes(classification?.classification)) errors.push(issue('INVALID_DISCONTINUITY_CLASSIFICATION', 'classification', 'Discontinuity classification is invalid.'));
  if (!Number.isFinite(classification?.distanceMm)) errors.push(issue('INVALID_DISCONTINUITY_DISTANCE', 'distanceMm', 'Discontinuity distance must be finite.'));
  return { valid: errors.length === 0, errors, warnings: [] };
}

function forbiddenOutput(value, path, errors) {
  if (!value || typeof value !== 'object') return;
  const forbidden = new Set(['machineX', 'machineY', 'machineUnits', 'ce01', 'dst', 'dsb', 'encodedBytes', 'encoderOutput']);
  Object.entries(value).forEach(([key, nested]) => { if (forbidden.has(key) && nested != null && nested !== false) errors.push(issue('MACHINE_OR_ENCODING_OUTPUT_FORBIDDEN_IN_PHASE_10', `${path}.${key}`, `${key} is forbidden.`)); else forbiddenOutput(nested, `${path}.${key}`, errors); });
}

export function validateCanonicalCommandCompilationV2(compilation, threadedObjectMaterialization, technicalPlan, sequencePlan, physicalPlan) {
  const errors = []; const warnings = []; const commands = compilation?.commands || []; const dispositions = compilation?.dispositions || []; const spans = compilation?.objectCommandSpans || []; const classifications = compilation?.discontinuityClassifications || [];
  const objects = threadedObjectMaterialization?.objects || []; const threads = threadedObjectMaterialization?.threads || [];
  const objectMap = new Map(objects.map(item => [item.id, item])); const threadIds = new Set(threads.map(item => item.id));
  const specificationMap = new Map((technicalPlan?.specifications || []).map(item => [item.objectId, item]));
  const expectedOrder = (sequencePlan?.executionSteps || []).map(item => item.objectId); const expectedBlocks = (sequencePlan?.threadBlocks || []).map(item => item.id);
  dispositions.forEach((item, index) => errors.push(...validateCanonicalCompilationDispositionV2(item).errors.map(entry => ({ ...entry, path: `dispositions[${index}].${entry.path}` }))));
  duplicates(dispositions.map(item => item.objectId)).forEach(id => errors.push(issue('DUPLICATE_CANONICAL_DISPOSITION', 'dispositions', `Duplicate disposition for ${id}.`)));
  expectedOrder.forEach(objectId => { if (!dispositions.some(item => item.objectId === objectId)) errors.push(issue('SCHEDULED_OBJECT_WITHOUT_CANONICAL_DISPOSITION', 'dispositions', `Object ${objectId} has no disposition.`)); });
  dispositions.filter(item => item.status === 'compiled').forEach(item => { if (!spans.some(span => span.objectId === item.objectId)) errors.push(issue('COMPILED_DISPOSITION_WITHOUT_COMMAND_SPAN', 'objectCommandSpans', `Object ${item.objectId} has no command span.`)); });
  spans.forEach((span, index) => { errors.push(...validateCanonicalObjectCommandSpanV2(span, commands.length).errors.map(entry => ({ ...entry, path: `objectCommandSpans[${index}].${entry.path}` }))); if (!objectMap.has(span.objectId)) errors.push(issue('COMMAND_SPAN_UNKNOWN_OBJECT', `objectCommandSpans[${index}]`, 'Span references an unknown object.')); });
  const sortedSpans = [...spans].sort((a, b) => a.firstCommandIndex - b.firstCommandIndex); sortedSpans.slice(1).forEach((span, index) => { if (span.firstCommandIndex <= sortedSpans[index].lastCommandIndex) errors.push(issue('OVERLAPPING_COMMAND_SPANS', 'objectCommandSpans', 'Object command spans overlap.')); });
  if (!same(compilation?.executionOrder, expectedOrder)) errors.push(issue('CANONICAL_OBJECT_ORDER_MUTATION', 'executionOrder', 'Phase 8 object order changed.'));
  if (!same(compilation?.threadBlockOrder, expectedBlocks)) errors.push(issue('CANONICAL_THREAD_BLOCK_ORDER_MUTATION', 'threadBlockOrder', 'Phase 8 thread-block order changed.'));
  duplicates(commands.map(item => item.id)).forEach(id => errors.push(issue('DUPLICATE_CANONICAL_COMMAND_ID', 'commands', `Duplicate command id ${id}.`)));
  commands.forEach((command, index) => {
    errors.push(...validateCanonicalCommandV2(command).errors.map(entry => ({ ...entry, path: `commands[${index}].${entry.path}` })));
    if (command.sequenceIndex !== index) errors.push(issue('NONCONTIGUOUS_CANONICAL_COMMAND_INDEX', `commands[${index}].sequenceIndex`, 'Command indexes must be contiguous.'));
    if (command.id !== canonicalCommandId(index, command.type)) errors.push(issue('NONDETERMINISTIC_CANONICAL_COMMAND_ID', `commands[${index}].id`, 'Command id is nondeterministic.'));
    if (command.threadId && !threadIds.has(command.threadId)) errors.push(issue('UNKNOWN_THREAD_ID', `commands[${index}].threadId`, 'Command references an unknown thread.'));
    if (command.type === 'stitch' && command.objectId && command.threadId !== objectMap.get(command.objectId)?.threadId) errors.push(issue('STITCH_OBJECT_THREAD_MISMATCH', `commands[${index}].threadId`, 'Stitch thread does not match its object.'));
    if (command.type === 'stitch' && index > 0) { const previousMovement = [...commands.slice(0, index)].reverse().find(item => item.type === 'stitch' || item.type === 'jump'); if (previousMovement && pointsEqualWithinTolerance(previousMovement, command, compilation.config.comparisonToleranceMm)) errors.push(issue('ZERO_LENGTH_STITCH_COMMAND', `commands[${index}]`, 'Zero-length stitch command is forbidden.')); }
  });
  const endIndexes = commands.map((item, index) => item.type === 'end' ? index : -1).filter(index => index >= 0);
  if (endIndexes.length !== 1) errors.push(issue(endIndexes.length ? 'MULTIPLE_END_COMMANDS' : 'MISSING_END_COMMAND', 'commands', 'Canonical stream requires exactly one end command.'));
  if (endIndexes.length && endIndexes[0] !== commands.length - 1) errors.push(issue('COMMANDS_AFTER_END', 'commands', 'No command may follow end.'));
  if (compilation?.config?.emitInitialPositionJump) { const firstMovementIndex = commands.findIndex(item => item.type === 'stitch' || item.type === 'jump'); const firstMovement = commands[firstMovementIndex]; if (firstMovement?.type !== 'jump' || firstMovement.reasonCode !== 'INITIAL_POSITIONING') errors.push(issue('MISSING_INITIAL_POSITION_COMMAND', 'commands', 'First movement must be initial positioning jump.')); if (commands.slice(0, firstMovementIndex).some(item => item.type === 'trim' || item.type === 'colorChange')) errors.push(issue('COMMAND_BEFORE_INITIAL_POSITIONING', 'commands', 'No trim or color change may precede initial positioning.')); }
  commands.slice(1).forEach((command, index) => { if (command.type === 'trim' && commands[index].type === 'trim') errors.push(issue('ADJACENT_DUPLICATE_TRIM', `commands[${index + 1}]`, 'Adjacent trims are forbidden.')); if (command.type === 'colorChange' && commands[index].type === 'colorChange') errors.push(issue('ADJACENT_DUPLICATE_COLOR_CHANGE', `commands[${index + 1}]`, 'Adjacent color changes are forbidden.')); });
  const colorChanges = commands.filter(item => item.type === 'colorChange'); const expectedColorThreads = (sequencePlan?.threadBlocks || []).slice(1).map(item => item.threadId);
  if (!same(colorChanges.map(item => item.threadId), expectedColorThreads)) errors.push(issue('THREAD_BLOCK_COLOR_CHANGE_MISMATCH', 'commands', 'Color changes must exactly follow Phase 8 blocks.'));
  const pointMap = new Map((physicalPlan?.objectPaths || []).flatMap(path => path.subpaths.flatMap(subpath => subpath.points.map(point => [point.id, point]))));
  const pointSubpathMap = new Map((physicalPlan?.objectPaths || []).flatMap(path => path.subpaths.flatMap(subpath => subpath.points.map(point => [point.id, subpath.id]))));
  const expectedMovements = new Set((physicalPlan?.objectPaths || []).flatMap(path => path.subpaths.flatMap(subpath => subpath.points.slice(1).map((point, index) => `${subpath.id}:${subpath.points[index].id}:${point.id}`))));
  const mappedMovements = commands.filter(item => item.reasonCode === 'PHYSICAL_SOURCE_STITCH').map(item => item.source?.physicalMovementKey);
  expectedMovements.forEach(key => { if (!mappedMovements.includes(key)) errors.push(issue('PHYSICAL_STITCH_MOVEMENT_MISSING', 'commands', `Physical movement ${key} is missing.`)); });
  duplicates(mappedMovements).forEach(key => errors.push(issue('PHYSICAL_MOVEMENT_MAPPED_MORE_THAN_ONCE', 'commands', `Physical movement ${key} is duplicated.`)));
  commands.filter(item => ['stitch', 'jump'].includes(item.type) && item.physicalPointId).forEach((command, index) => { const point = pointMap.get(command.physicalPointId); if (!point || !pointsEqualWithinTolerance(command, point, compilation.config.comparisonToleranceMm)) errors.push(issue('PHYSICAL_POINT_COORDINATE_CHANGED', `commands[${index}]`, 'Command coordinate differs from its physical point.')); if (command.subpathId && command.subpathId !== pointSubpathMap.get(command.physicalPointId)) errors.push(issue('PHYSICAL_SUBPATH_ORDER_CHANGED', `commands[${index}].subpathId`, 'Command subpath identity differs from its physical point.')); });
  (physicalPlan?.objectPaths || []).forEach(path => { const actual = [...new Set(commands.filter(item => item.objectId === path.objectId && item.subpathId).map(item => item.subpathId))]; const expected = path.subpaths.map(item => item.id).filter(id => actual.includes(id)); if (!same(actual, expected)) errors.push(issue('PHYSICAL_SUBPATH_ORDER_CHANGED', 'commands', `Physical subpath order changed for ${path.objectId}.`)); });
  classifications.forEach((item, index) => errors.push(...validateCanonicalDiscontinuityClassificationV2(item).errors.map(entry => ({ ...entry, path: `discontinuityClassifications[${index}].${entry.path}` }))));
  duplicates(classifications.map(item => item.transitionId)).forEach(id => errors.push(issue('DUPLICATE_DISCONTINUITY_CLASSIFICATION', 'discontinuityClassifications', `Transition ${id} was classified more than once.`)));
  const transitionMap = new Map((physicalPlan?.objectPaths || []).flatMap(path => path.subpathTransitions.map(item => [item.id, item])));
  transitionMap.forEach((_, id) => { if (!classifications.some(item => item.transitionId === id)) errors.push(issue('UNCLASSIFIED_PHYSICAL_DISCONTINUITY', 'discontinuityClassifications', `Transition ${id} is unclassified.`)); });
  classifications.filter(item => item.classification === 'safe_connector_stitch').forEach(item => {
    const transition = transitionMap.get(item.transitionId); const command = commands.find(entry => entry.transitionId === item.transitionId && entry.reasonCode === 'SAFE_SUBPATH_CONNECTOR');
    if (!transition || transition.crossesHole || transition.crossesOutsideEffectiveRegion || !transition.continuousStitchAllowed) errors.push(issue('UNSAFE_CONNECTOR_STITCH_CLASSIFICATION', 'discontinuityClassifications', `Transition ${item.transitionId} is not safe.`));
    if (!command) errors.push(issue('SAFE_CONNECTOR_COMMAND_MISSING', 'commands', `Transition ${item.transitionId} lacks its connector stitch.`));
    if (command && transition && command.objectId !== transition.objectId) errors.push(issue('CONNECTOR_STITCH_ACROSS_OBJECT_BOUNDARY', 'commands', `Connector ${item.transitionId} crosses an object boundary.`));
    const parameters = specificationMap.get(item.objectId)?.stitchParameters || {}; const maximum = specificationMap.get(item.objectId)?.stitchType === 'satin' ? parameters.maximumAllowedWidthMm ?? parameters.maximumStitchLengthMm ?? parameters.spacingMm : parameters.maximumStitchLengthMm;
    if (transition && Number.isFinite(maximum) && transition.distanceMm > maximum + compilation.config.comparisonToleranceMm) errors.push(issue('CONNECTOR_ABOVE_TECHNICAL_MAXIMUM', 'discontinuityClassifications', `Connector ${item.transitionId} exceeds its technical maximum.`));
  });
  classifications.filter(item => item.classification === 'jump_with_trim').forEach(item => { const jumpIndex = commands.findIndex(command => command.transitionId === item.transitionId && command.type === 'jump'); if (jumpIndex < 1 || commands[jumpIndex - 1].type !== 'trim') errors.push(issue('TRIMMED_DISCONTINUITY_COMMAND_MISMATCH', 'commands', `Transition ${item.transitionId} requires trim then jump.`)); });
  if ((compilation?.summary?.canonicalDispositionCoveragePercent ?? 0) !== 100 || (compilation?.summary?.physicalStitchMovementCoveragePercent ?? 0) !== 100 || (compilation?.summary?.physicalPointReachabilityCoveragePercent ?? 0) !== 100 || (compilation?.summary?.discontinuityClassificationCoveragePercent ?? 0) !== 100 || (compilation?.summary?.threadBlockCompilationCoveragePercent ?? 0) !== 100) errors.push(issue('CANONICAL_COMPILATION_COVERAGE_BELOW_100', 'summary', 'All compilation coverage metrics must equal 100%.'));
  if (dispositions.some(item => item.status !== 'compiled') && commands.length && !compilation?.config?.allowPartialCanonicalStream) errors.push(issue('PARTIAL_VALID_CANONICAL_STREAM', 'commands', 'Partial command streams are forbidden.'));
  for (const field of ['objectMutationCount', 'technicalSpecificationMutationCount', 'sequencePlanMutationCount', 'physicalPlanMutationCount', 'threadBlockMutationCount', 'selectedCandidateIdentityMutationCount']) if ((compilation?.metadata?.[field] ?? 0) !== 0) errors.push(issue('CANONICAL_SOURCE_MUTATION', `metadata.${field}`, `${field} must remain zero.`));
  forbiddenOutput(compilation, 'compilation', errors);
  return { valid: errors.length === 0, errors, warnings };
}
