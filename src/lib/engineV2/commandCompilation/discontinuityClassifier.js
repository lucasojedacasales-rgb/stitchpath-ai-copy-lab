import { createCanonicalCommandV2 } from '../model.js';
import { distanceBetweenPoints, finitePhysicalPoint, pointsEqualWithinTolerance } from '../stitchGeneration/stitchGeometry.js';
import { createCanonicalDiscontinuityClassificationV2 } from './canonicalCompilationModel.js';

function connectorMaximum(technicalSpecification) {
  const parameters = technicalSpecification?.stitchParameters || {};
  if (technicalSpecification?.stitchType === 'satin') return parameters.maximumAllowedWidthMm ?? parameters.maximumStitchLengthMm ?? parameters.spacingMm;
  return parameters.maximumStitchLengthMm;
}

export function classifyPhysicalDiscontinuity({ object, technicalSpecification, physicalTransition, fromSubpath, toSubpath, config }) {
  const fromPoint = physicalTransition?.fromPoint; const toPoint = physicalTransition?.toPoint;
  const tolerance = config.comparisonToleranceMm; const finite = finitePhysicalPoint(fromPoint) && finitePhysicalPoint(toPoint);
  const distanceMm = finite ? distanceBetweenPoints(fromPoint, toPoint) : NaN;
  let classification; let reasonCode; let safeConnectorAllowed = false;
  if (finite && pointsEqualWithinTolerance(fromPoint, toPoint, tolerance)) {
    classification = 'zero_distance_continuation'; reasonCode = 'ZERO_DISTANCE_CONTINUATION';
  } else {
    const maximum = connectorMaximum(technicalSpecification);
    const sourceForbids = physicalTransition?.source?.continuityForbidden === true || physicalTransition?.source?.safetyWarning === true;
    safeConnectorAllowed = config.allowSafeSubpathConnectorStitches === true
      && physicalTransition?.objectId === object?.id
      && fromSubpath?.objectId === object?.id && toSubpath?.objectId === object?.id
      && physicalTransition?.continuousStitchAllowed === true
      && (!config.requireConnectorWithoutHoleCrossing || physicalTransition?.crossesHole !== true)
      && (!config.requireConnectorInsideEffectiveRegion || physicalTransition?.crossesOutsideEffectiveRegion !== true)
      && finite && distanceMm > tolerance && Number.isFinite(maximum) && distanceMm <= maximum + tolerance
      && pointsEqualWithinTolerance(toPoint, toSubpath?.points?.[0], tolerance) && !sourceForbids;
    if (safeConnectorAllowed) { classification = 'safe_connector_stitch'; reasonCode = 'SAFE_SUBPATH_CONNECTOR'; }
    else if (config.trimUnsafeSubpathDiscontinuities) { classification = 'jump_with_trim'; reasonCode = 'UNSAFE_SUBPATH_GAP_TRIM_REQUIRED'; }
    else { classification = 'jump_without_trim'; reasonCode = 'UNSAFE_SUBPATH_GAP_NO_TRIM'; }
  }
  return createCanonicalDiscontinuityClassificationV2({
    objectId: object?.id, transitionId: physicalTransition?.id, fromSubpathId: fromSubpath?.id,
    toSubpathId: toSubpath?.id, classification, reasonCode, distanceMm,
    safeConnectorAllowed, trimRequired: classification === 'jump_with_trim',
    source: { compiler: 'engineV2-phase10', technicalMaximumStitchLengthMm: connectorMaximum(technicalSpecification) ?? null },
  });
}

export function compileDiscontinuityCommands({ classification, targetPoint, currentPosition, commandContext, config }) {
  const commands = []; const context = commandContext || {}; const samePosition = pointsEqualWithinTolerance(currentPosition, targetPoint, config.comparisonToleranceMm);
  const base = { threadId: context.threadId, objectId: context.objectId, regionId: context.regionId, threadBlockId: context.threadBlockId, executionStepId: context.executionStepId, subpathId: context.subpathId, physicalPointId: context.physicalPointId, transitionId: classification.transitionId, phase: context.phase, technique: context.technique };
  if (classification.classification === 'safe_connector_stitch' && !samePosition) commands.push(createCanonicalCommandV2({ ...base, type: 'stitch', x: targetPoint.x, y: targetPoint.y, reasonCode: 'SAFE_SUBPATH_CONNECTOR', source: { compiler: 'engineV2-phase10', connectorStitch: true } }));
  if (classification.classification === 'jump_with_trim') {
    if (context.previousCommand?.type !== 'trim' || !config.deduplicateAdjacentTrims) commands.push(createCanonicalCommandV2({ ...base, type: 'trim', x: currentPosition?.x, y: currentPosition?.y, reasonCode: 'UNSAFE_SUBPATH_GAP', source: { compiler: 'engineV2-phase10', universalCutIntent: true } }));
    if (!samePosition || !config.omitZeroDistanceJumps) commands.push(createCanonicalCommandV2({ ...base, type: 'jump', x: targetPoint.x, y: targetPoint.y, reasonCode: 'UNSAFE_SUBPATH_GAP', source: { compiler: 'engineV2-phase10', nonSewingMovement: true } }));
  }
  if (classification.classification === 'jump_without_trim' && (!samePosition || !config.omitZeroDistanceJumps)) commands.push(createCanonicalCommandV2({ ...base, type: 'jump', x: targetPoint.x, y: targetPoint.y, reasonCode: 'UNSAFE_SUBPATH_GAP', source: { compiler: 'engineV2-phase10', nonSewingMovement: true } }));
  return { valid: commands.every(command => command.type === 'trim' || finitePhysicalPoint(command)), commands, currentPosition: commands.some(command => command.type === 'jump' || command.type === 'stitch') ? { x: targetPoint.x, y: targetPoint.y } : currentPosition };
}
