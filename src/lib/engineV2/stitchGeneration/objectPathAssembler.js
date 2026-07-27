import { createObjectPhysicalStitchPathV2, createPhysicalStitchPointV2, createPhysicalStitchSubpathV2, createPhysicalSubpathTransitionV2, physicalSubpathId } from './physicalStitchModel.js';
import { calculatePathBounds, calculateSubpathMetrics, distanceBetweenPoints, pointsEqualWithinTolerance, segmentCrossesHole, segmentInsideEffectiveRegion } from './stitchGeometry.js';

function normalizeSubpath(raw, object, executionStep, subpathIndex, technicalSpecification) {
  const id = physicalSubpathId(object.id, subpathIndex, raw.technique); const metrics = calculateSubpathMetrics(raw.points);
  const points = raw.points.map((point, pointIndex) => createPhysicalStitchPointV2({ objectId: object.id, subpathId: id, subpathIndex, pointIndex, x: point.x, y: point.y, phase: raw.phase, technique: raw.technique, sourceType: point.sourceType ?? (raw.phase === 'underlay' ? 'underlay_plan' : 'source_geometry'), source: { ...(point.lengthExceptionCode ? { lengthExceptionCode: point.lengthExceptionCode } : {}), generator: 'engineV2-phase9' } }));
  return createPhysicalStitchSubpathV2({ id, objectId: object.id, sequenceIndex: executionStep.sequenceIndex, subpathIndex, phase: raw.phase, technique: raw.technique, points, closed: raw.closed, continuous: raw.continuous, sourceTechnicalComponent: raw.sourceTechnicalComponent, ...metrics, source: { technicalSpecificationId: technicalSpecification.id } });
}
export function assembleObjectPhysicalStitchPath({ object, technicalSpecification, executionStep, selectedEntryExit, generatedUnderlay, generatedTopPath, config }) {
  const raw = [
    { phase: 'entry_anchor', technique: 'anchor', points: [{ ...selectedEntryExit.entryPoint, sourceType: 'selected_entry' }], closed: false, continuous: true },
    ...(generatedUnderlay?.subpaths || []), ...(generatedTopPath?.subpaths || []),
    { phase: 'exit_anchor', technique: 'anchor', points: [{ ...selectedEntryExit.exitPoint, sourceType: 'selected_exit' }], closed: false, continuous: true },
  ];
  const subpaths = raw.map((item, index) => normalizeSubpath(item, object, executionStep, index, technicalSpecification));
  const transitions = subpaths.slice(1).map((to, index) => {
    const from = subpaths[index]; const fromPoint = from.points.at(-1); const toPoint = to.points[0]; const crossesHole = segmentCrossesHole(fromPoint, toPoint, object.holes, { tolerance: config.boundaryToleranceMm });
    const samePoint = pointsEqualWithinTolerance(fromPoint, toPoint, config.comparisonToleranceMm); const inside = samePoint || segmentInsideEffectiveRegion(fromPoint, toPoint, object, { tolerance: config.boundaryToleranceMm });
    return createPhysicalSubpathTransitionV2({ objectId: object.id, fromSubpathId: from.id, toSubpathId: to.id, fromPoint: { x: fromPoint.x, y: fromPoint.y }, toPoint: { x: toPoint.x, y: toPoint.y }, distanceMm: distanceBetweenPoints(fromPoint, toPoint), continuousStitchAllowed: inside && !crossesHole, crossesOutsideEffectiveRegion: !inside, crossesHole, reason: inside && !crossesHole ? 'geometrically_safe_but_not_automatically_connected' : crossesHole ? 'explicit_discontinuity_crosses_hole' : 'explicit_discontinuity_crosses_outside_effective_region', source: { diagnosticOnly: true, commandClassification: false } });
  });
  const underlaySubpaths = subpaths.filter(item => item.phase === 'underlay'); const topSubpaths = subpaths.filter(item => item.phase === 'top'); const allPoints = subpaths.flatMap(item => item.points);
  const totals = group => ({ points: group.reduce((sum, item) => sum + item.points.length, 0), stitches: group.reduce((sum, item) => sum + item.stitchCount, 0), length: group.reduce((sum, item) => sum + item.lengthMm, 0) });
  const underlay = totals(underlaySubpaths); const top = totals(topSubpaths); const lengths = [...underlaySubpaths, ...topSubpaths].flatMap(item => item.points.slice(1).map((point, index) => distanceBetweenPoints(item.points[index], point)));
  return createObjectPhysicalStitchPathV2({
    objectId: object.id, regionId: object.regionId, threadId: object.threadId, executionStepId: executionStep.id, threadBlockId: executionStep.threadBlockId,
    technicalSpecificationId: technicalSpecification.id, selectedEntryExitId: selectedEntryExit.id, status: 'generated', generator: object.stitchType,
    entryCandidateId: selectedEntryExit.entryCandidateId, exitCandidateId: selectedEntryExit.exitCandidateId, selectedEntryPoint: selectedEntryExit.entryPoint, selectedExitPoint: selectedEntryExit.exitPoint,
    subpaths, subpathTransitions: transitions, underlaySubpathIds: underlaySubpaths.map(item => item.id), topSubpathIds: topSubpaths.map(item => item.id),
    firstPhysicalPoint: allPoints[0], lastPhysicalPoint: allPoints.at(-1), physicalPointCount: allPoints.length, physicalStitchCount: underlay.stitches + top.stitches,
    underlayPointCount: underlay.points, underlayStitchCount: underlay.stitches, topPointCount: top.points, topStitchCount: top.stitches,
    totalLengthMm: underlay.length + top.length, underlayLengthMm: underlay.length, topLengthMm: top.length, bounds: calculatePathBounds(allPoints),
    coverageMetrics: { ...(generatedUnderlay?.coverageMetrics || {}), ...(generatedTopPath?.coverageMetrics || {}) },
    qualityMetrics: { discontinuityCount: transitions.length, stitchLengthsMm: lengths, minimumGeneratedStitchLengthMm: lengths.length ? Math.min(...lengths) : 0, maximumGeneratedStitchLengthMm: lengths.length ? Math.max(...lengths) : 0 },
    warnings: [...(generatedUnderlay?.warnings || []), ...(generatedTopPath?.warnings || [])], errors: [], source: { assembler: 'engineV2-phase9', automaticConnectorsAdded: false },
  });
}
