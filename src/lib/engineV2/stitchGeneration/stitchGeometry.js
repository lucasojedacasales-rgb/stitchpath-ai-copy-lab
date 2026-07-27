import { isPointInEffectiveObjectArea } from '../technical/objectGeometryMetrics.js';
import { distributeStitchIntervals } from './stitchLengthDistribution.js';

export const finitePhysicalPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
export const distanceBetweenPoints = (a, b) => finitePhysicalPoint(a) && finitePhysicalPoint(b) ? Math.hypot(b.x - a.x, b.y - a.y) : NaN;
export const pointsEqualWithinTolerance = (a, b, tolerance = 1e-6) => finitePhysicalPoint(a) && finitePhysicalPoint(b) && distanceBetweenPoints(a, b) <= tolerance;

export function removeConsecutiveDuplicatePoints(points = [], tolerance = 1e-6) {
  return points.filter(finitePhysicalPoint).reduce((result, point) => {
    if (!result.length || !pointsEqualWithinTolerance(result.at(-1), point, tolerance)) result.push({ x: point.x, y: point.y, ...(point.sourceType ? { sourceType: point.sourceType } : {}) });
    return result;
  }, []);
}

export function polylineLength(points = []) {
  return points.reduce((sum, point, index) => index ? sum + distanceBetweenPoints(points[index - 1], point) : sum, 0);
}

function interpolate(a, b, ratio) { return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }; }

function resampleSegments(points, options, closed) {
  const tolerance = options.tolerance ?? 1e-6; const source = removeConsecutiveDuplicatePoints(points, tolerance); const warnings = []; const errors = [];
  if (source.length < 2) return { valid: false, points: [], warnings, errors: [{ code: 'INSUFFICIENT_POLYLINE_POINTS' }] };
  const segments = closed ? source.map((point, index) => [point, source[(index + 1) % source.length]]) : source.slice(0, -1).map((point, index) => [point, source[index + 1]]);
  const result = [{ ...segments[0][0], sourceType: segments[0][0].sourceType ?? 'source_geometry' }];
  segments.forEach(([a, b]) => {
    const length = distanceBetweenPoints(a, b);
    if (length <= tolerance) return;
    const distribution = distributeStitchIntervals(length, options); warnings.push(...distribution.warnings); errors.push(...distribution.errors);
    if (!distribution.valid) return;
    for (let interval = 1; interval <= distribution.intervalCount; interval += 1) {
      const endpoint = interval === distribution.intervalCount ? b : interpolate(a, b, interval / distribution.intervalCount);
      result.push({ ...endpoint, sourceType: interval === distribution.intervalCount ? (b.sourceType ?? 'source_geometry') : 'resampled_source_geometry', ...(distribution.exceptionCode ? { lengthExceptionCode: distribution.exceptionCode } : {}) });
    }
  });
  return { valid: errors.length === 0, points: result, warnings, errors };
}

export function resampleOpenPolyline(points, options) { return resampleSegments(points, options, false); }
export function resampleClosedPolyline(points, options) { return resampleSegments(points, options, true); }

export function projectPointToSegment(point, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y; const denominator = dx * dx + dy * dy;
  const ratio = denominator ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator)) : 0;
  const projectedPoint = interpolate(a, b, ratio);
  return { point: projectedPoint, ratio, distanceMm: distanceBetweenPoints(point, projectedPoint) };
}

export function insertPointIntoPolyline(points = [], point, options = {}) {
  const tolerance = options.tolerance ?? 1e-6; const closed = options.closed === true; const source = removeConsecutiveDuplicatePoints(points, tolerance);
  const existing = source.findIndex(candidate => pointsEqualWithinTolerance(candidate, point, tolerance));
  if (existing >= 0) { const copy = source.map(item => ({ ...item })); copy[existing] = { x: point.x, y: point.y, sourceType: point.sourceType ?? copy[existing].sourceType }; return { valid: true, points: copy, index: existing, inserted: false, distanceMm: 0 }; }
  let best = null; const segmentCount = closed ? source.length : source.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const projection = projectPointToSegment(point, source[index], source[(index + 1) % source.length]);
    if (!best || projection.distanceMm < best.distanceMm) best = { ...projection, segmentIndex: index };
  }
  if (!best || best.distanceMm > (options.maximumDistanceMm ?? tolerance)) return { valid: false, points: source, index: -1, inserted: false, distanceMm: best?.distanceMm ?? Infinity, errors: [{ code: 'POINT_NOT_ON_POLYLINE' }] };
  const result = [...source.slice(0, best.segmentIndex + 1), { x: point.x, y: point.y, sourceType: point.sourceType }, ...source.slice(best.segmentIndex + 1)];
  return { valid: true, points: result, index: best.segmentIndex + 1, inserted: true, distanceMm: best.distanceMm };
}

export function rotatePoint(point, origin, degrees) {
  const radians = degrees * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians); const x = point.x - origin.x; const y = point.y - origin.y;
  return { x: origin.x + x * cosine - y * sine, y: origin.y + x * sine + y * cosine };
}
export function inverseRotatePoint(point, origin, degrees) { return rotatePoint(point, origin, -degrees); }

export function pointOnPolygonBoundary(point, polygon = [], tolerance = 1e-6) {
  return polygon.some((start, index) => projectPointToSegment(point, start, polygon[(index + 1) % polygon.length]).distanceMm <= tolerance);
}

function orientation(a, b, c, tolerance) {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(value) <= tolerance ? 0 : Math.sign(value);
}

function segmentsIntersect(a, b, c, d, tolerance = 1e-6) {
  const o1 = orientation(a, b, c, tolerance); const o2 = orientation(a, b, d, tolerance); const o3 = orientation(c, d, a, tolerance); const o4 = orientation(c, d, b, tolerance);
  return o1 !== o2 && o3 !== o4;
}

function pointInPolygon(point, polygon, boundaryInside = true) {
  if (pointOnPolygonBoundary(point, polygon)) return boundaryInside;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous]; const b = polygon[index];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function segmentCrossesHole(a, b, holes = [], options = {}) {
  const samples = options.samples ?? 64;
  return holes.some(hole => {
    for (let index = 1; index < samples; index += 1) if (pointInPolygon(interpolate(a, b, index / samples), hole, false)) return true;
    return false;
  });
}

export function segmentInsideEffectiveRegion(a, b, object, options = {}) {
  if (segmentCrossesHole(a, b, object?.holes || [], options)) return false;
  const samples = options.samples ?? 24;
  for (let index = 0; index <= samples; index += 1) if (!isPointInEffectiveObjectArea(interpolate(a, b, index / samples), object, { boundaryInside: true })) return false;
  return true;
}

export function calculatePathBounds(points = []) {
  const valid = points.filter(finitePhysicalPoint); if (!valid.length) return null;
  const xs = valid.map(point => point.x); const ys = valid.map(point => point.y); const minX = Math.min(...xs); const minY = Math.min(...ys); const maxX = Math.max(...xs); const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function calculateSubpathMetrics(points = []) {
  const lengths = points.slice(1).map((point, index) => distanceBetweenPoints(points[index], point));
  return { stitchCount: lengths.length, lengthMm: lengths.reduce((sum, value) => sum + value, 0), minimumStitchLengthMm: lengths.length ? Math.min(...lengths) : 0, maximumStitchLengthMm: lengths.length ? Math.max(...lengths) : 0, lengths };
}

export const _stitchGeometryInternals = Object.freeze({ interpolate, pointInPolygon, segmentsIntersect });
