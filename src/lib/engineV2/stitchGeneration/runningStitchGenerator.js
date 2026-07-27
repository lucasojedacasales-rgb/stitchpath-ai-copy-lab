import { insertPointIntoPolyline, pointsEqualWithinTolerance, resampleClosedPolyline, resampleOpenPolyline } from './stitchGeometry.js';

function rotateTo(points, index) { return [...points.slice(index), ...points.slice(0, index)]; }
function cyclicArc(points, startIndex, endIndex, direction) {
  const result = [points[startIndex]]; let index = startIndex;
  while (index !== endIndex && result.length <= points.length + 1) { index = (index + direction + points.length) % points.length; result.push(points[index]); }
  return result;
}
export function generateRunningPhysicalPath({ object, technicalSpecification, selectedEntryExit, config }) {
  const parameters = technicalSpecification?.stitchParameters || {}; const tolerance = config.boundaryToleranceMm;
  const options = { targetStitchLengthMm: parameters.targetStitchLengthMm, minimumStitchLengthMm: parameters.minimumStitchLengthMm, maximumStitchLengthMm: parameters.maximumStitchLengthMm, tolerance };
  const errors = []; const warnings = []; const closed = parameters.closedPathExpected === true;
  if (!Array.isArray(object?.geometry) || object.geometry.length < 2) return { valid: false, subpaths: [], errors: [{ code: 'RUNNING_SOURCE_GEOMETRY_INVALID' }], warnings, coverageMetrics: {} };
  let insertion = insertPointIntoPolyline(object.geometry, { ...selectedEntryExit.entryPoint, sourceType: 'selected_entry' }, { closed, tolerance, maximumDistanceMm: tolerance });
  if (!insertion.valid) return { valid: false, subpaths: [], errors: [{ code: 'RUNNING_SELECTED_ENTRY_NOT_ON_SOURCE' }], warnings, coverageMetrics: {} };
  insertion = insertPointIntoPolyline(insertion.points, { ...selectedEntryExit.exitPoint, sourceType: 'selected_exit' }, { closed, tolerance, maximumDistanceMm: tolerance });
  if (!insertion.valid) return { valid: false, subpaths: [], errors: [{ code: 'RUNNING_SELECTED_EXIT_NOT_ON_SOURCE' }], warnings, coverageMetrics: {} };
  const points = insertion.points; const entryIndex = points.findIndex(point => pointsEqualWithinTolerance(point, selectedEntryExit.entryPoint, tolerance)); const exitIndex = points.findIndex(point => pointsEqualWithinTolerance(point, selectedEntryExit.exitPoint, tolerance));
  let sourcePaths;
  if (!closed) {
    if (![0, points.length - 1].includes(entryIndex) || ![0, points.length - 1].includes(exitIndex) || entryIndex === exitIndex) return { valid: false, subpaths: [], errors: [{ code: 'RUNNING_OPEN_ANCHORS_MUST_BE_SOURCE_ENDPOINTS' }], warnings, coverageMetrics: {} };
    sourcePaths = [entryIndex < exitIndex ? points : [...points].reverse()];
  } else if (entryIndex === exitIndex) {
    sourcePaths = [[...rotateTo(points, entryIndex), points[entryIndex]]];
  } else {
    sourcePaths = [cyclicArc(points, entryIndex, exitIndex, 1), cyclicArc(points, entryIndex, exitIndex, -1)];
  }
  const passes = Math.max(1, Math.floor(parameters.passes || 1)); const subpaths = [];
  for (let pass = 0; pass < passes; pass += 1) sourcePaths.forEach((sourcePath, pathIndex) => {
    const oriented = pass % 2 ? [...sourcePath].reverse() : sourcePath;
    const sampled = closed && sourcePaths.length === 1 ? resampleOpenPolyline(oriented, options) : resampleOpenPolyline(oriented, options);
    warnings.push(...sampled.warnings); errors.push(...sampled.errors);
    if (sampled.valid) subpaths.push({ phase: 'top', technique: 'running', points: sampled.points, closed: closed && sourcePaths.length === 1, continuous: true, sourceTechnicalComponent: { passes, passIndex: pass, complementaryArcIndex: sourcePaths.length > 1 ? pathIndex : null } });
  });
  const pointCount = subpaths.reduce((sum, subpath) => sum + subpath.points.length, 0);
  if (pointCount > config.maximumPointsPerObject) return { valid: false, subpaths: [], errors: [{ code: 'PHYSICAL_GENERATION_LIMIT_EXCEEDED', requested: pointCount, limit: config.maximumPointsPerObject }], warnings, coverageMetrics: {}, pointLimitExceeded: true };
  return { valid: errors.length === 0, subpaths, errors, warnings, coverageMetrics: { sourceVertexCount: object.geometry.length, generatedPassCount: passes, complementaryArcCount: sourcePaths.length > 1 ? sourcePaths.length : 0, inventedCenterline: false } };
}
