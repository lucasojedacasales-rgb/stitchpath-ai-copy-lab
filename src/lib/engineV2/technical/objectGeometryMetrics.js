import { TECHNICAL_PLANNING_NUMERIC_DEFAULTS } from './materialProfileModel.js';

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const samePoint = (left, right) => finitePoint(left) && finitePoint(right) && left.x === right.x && left.y === right.y;
const distance = (left, right) => Math.hypot(right.x - left.x, right.y - left.y);
const normalizeAngle = angle => ((angle % 180) + 180) % 180;

function cleanPoints(points) {
  const finite = (Array.isArray(points) ? points : []).filter(finitePoint);
  const unique = finite.filter((point, index) => index === 0 || !samePoint(point, finite[index - 1]));
  if (unique.length > 1 && samePoint(unique[0], unique.at(-1))) unique.pop();
  return unique;
}

function signedArea(points) {
  if (points.length < 3) return 0;
  return points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.x * next.y - next.x * point.y; }, 0) / 2;
}

function polygonCentroid(points) {
  const area = signedArea(points);
  if (Math.abs(area) < Number.EPSILON) return points.length ? { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length } : null;
  let x = 0; let y = 0;
  points.forEach((point, index) => { const next = points[(index + 1) % points.length]; const cross = point.x * next.y - next.x * point.y; x += (point.x + next.x) * cross; y += (point.y + next.y) * cross; });
  return { x: x / (6 * area), y: y / (6 * area) };
}

function pointOnSegment(point, start, end, tolerance = 1e-8) {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > tolerance) return false;
  const dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
  const squared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot >= -tolerance && dot <= squared + tolerance;
}

function pointInPolygon(point, polygon, boundaryInside = true) {
  if (!finitePoint(point) || polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous]; const b = polygon[index];
    if (pointOnSegment(point, a, b)) return boundaryInside;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function orientation(a, b, c) { return Math.sign((b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)); }
function segmentsIntersect(a, b, c, d) { const o1 = orientation(a, b, c); const o2 = orientation(a, b, d); const o3 = orientation(c, d, a); const o4 = orientation(c, d, b); return o1 !== o2 && o3 !== o4; }
function selfIntersects(points) {
  for (let first = 0; first < points.length; first += 1) for (let second = first + 1; second < points.length; second += 1) {
    const firstNext = (first + 1) % points.length; const secondNext = (second + 1) % points.length;
    if (first === second || firstNext === second || secondNext === first) continue;
    if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) return true;
  }
  return false;
}

function closedIntent(object, points) {
  const intent = object?.parameters?.technicalIntent?.geometryType ?? object?.source?.technicalGeometryIntent;
  if (intent === 'open_path') return false;
  if (intent === 'closed_path' || intent === 'region_polygon') return true;
  if (samePoint(object?.geometry?.[0], object?.geometry?.at?.(-1))) return true;
  if (['tatami', 'satin'].includes(object?.stitchType)) return true;
  if (['outer_outline', 'inner_outline'].includes(object?.role)) return true;
  return points.length >= 3 && object?.stitchType !== 'running';
}

function principalMetrics(points) {
  if (!points.length) return { principalAxisDegrees: null, secondaryAxisDegrees: null, principalSpanMm: 0, secondarySpanMm: 0, widths: [] };
  const center = { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
  const xx = points.reduce((sum, point) => sum + (point.x - center.x) ** 2, 0) / points.length;
  const yy = points.reduce((sum, point) => sum + (point.y - center.y) ** 2, 0) / points.length;
  const xy = points.reduce((sum, point) => sum + (point.x - center.x) * (point.y - center.y), 0) / points.length;
  const angle = Math.abs(xx - yy) < 1e-12 && Math.abs(xy) < 1e-12 ? 0 : 0.5 * Math.atan2(2 * xy, xx - yy);
  const ux = Math.cos(angle); const uy = Math.sin(angle); const vx = -uy; const vy = ux;
  const projections = points.map(point => ({ u: (point.x - center.x) * ux + (point.y - center.y) * uy, v: (point.x - center.x) * vx + (point.y - center.y) * vy }));
  const us = projections.map(item => item.u); const vs = projections.map(item => item.v);
  const principalSpanMm = Math.max(...us) - Math.min(...us); const secondarySpanMm = Math.max(...vs) - Math.min(...vs);
  const binCount = Math.min(5, Math.max(1, points.length - 1)); const binSize = principalSpanMm / binCount || 1; const minimum = Math.min(...us); const maximum = Math.max(...us);
  const widths = Array.from({ length: binCount }, (_, index) => {
    const low = minimum + index * binSize; const high = index === binCount - 1 ? maximum + 1e-9 : low + binSize;
    const values = projections.filter(item => item.u >= low && item.u <= high).map(item => item.v);
    return values.length >= 2 ? Math.max(...values) - Math.min(...values) : null;
  }).filter(value => Number.isFinite(value) && value > 0);
  if (!widths.length && secondarySpanMm > 0) widths.push(secondarySpanMm);
  return { principalAxisDegrees: normalizeAngle(angle * 180 / Math.PI), secondaryAxisDegrees: normalizeAngle(angle * 180 / Math.PI + 90), principalSpanMm, secondarySpanMm, widths };
}

function validInteriorPoint(points, holes, centroid, bounds) {
  const valid = point => pointInPolygon(point, points, false) && !holes.some(hole => pointInPolygon(point, hole, true));
  if (centroid && valid(centroid)) return centroid;
  for (let yIndex = 1; yIndex < 5; yIndex += 1) for (let xIndex = 1; xIndex < 5; xIndex += 1) {
    const point = { x: bounds.minX + bounds.width * xIndex / 5, y: bounds.minY + bounds.height * yIndex / 5 };
    if (valid(point)) return point;
  }
  return null;
}

export function isPointInEffectiveObjectArea(point, object, { boundaryInside = true } = {}) {
  const geometry = cleanPoints(object?.geometry); const holes = (object?.holes || []).map(cleanPoints);
  return pointInPolygon(point, geometry, boundaryInside) && !holes.some(hole => pointInPolygon(point, hole, true));
}

export function isPointOnObjectBoundary(point, object) {
  const geometry = cleanPoints(object?.geometry);
  return geometry.some((start, index) => pointOnSegment(point, start, geometry[(index + 1) % geometry.length]));
}

export function analyzeEmbroideryObjectGeometry(object, options = {}) {
  const thresholds = { ...TECHNICAL_PLANNING_NUMERIC_DEFAULTS.geometry, ...(options.geometryAnalysis || options) };
  const source = Array.isArray(object?.geometry) ? object.geometry : [];
  const points = cleanPoints(source); const holes = (Array.isArray(object?.holes) ? object.holes : []).map(cleanPoints);
  const nonFinitePointCount = source.filter(point => !finitePoint(point)).length;
  const duplicatePointCount = source.reduce((count, point, index) => count + (index > 0 && samePoint(point, source[index - 1]) ? 1 : 0), 0) + (source.length > 2 && samePoint(source[0], source.at(-1)) ? 1 : 0);
  const isClosedGeometry = closedIntent(object, points);
  const outerAreaMm2 = isClosedGeometry ? Math.abs(signedArea(points)) : 0;
  const holeAreaMm2 = holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
  const effectiveAreaMm2 = Math.max(0, outerAreaMm2 - holeAreaMm2);
  const geometryValid = nonFinitePointCount === 0 && points.length >= (isClosedGeometry ? 3 : 2) && (!isClosedGeometry || (outerAreaMm2 >= thresholds.minimumEffectiveAreaMm2 && !selfIntersects(points)));
  const holeGeometryValid = holes.every(hole => hole.length >= 3 && Math.abs(signedArea(hole)) >= thresholds.minimumEffectiveAreaMm2 && !selfIntersects(hole) && hole.every(point => pointInPolygon(point, points, true)));
  const xs = points.map(point => point.x); const ys = points.map(point => point.y);
  const bounds = points.length ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } : null;
  if (bounds) { bounds.width = bounds.maxX - bounds.minX; bounds.height = bounds.maxY - bounds.minY; }
  const perimeterMm = points.reduce((sum, point, index) => index ? sum + distance(points[index - 1], point) : sum, 0) + (isClosedGeometry && points.length > 1 ? distance(points.at(-1), points[0]) : 0);
  const centroid = isClosedGeometry ? polygonCentroid(points) : points.length ? { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length } : null;
  const axes = principalMetrics(points); const sortedWidths = [...axes.widths].sort((a, b) => a - b);
  const estimatedMinimumWidthMm = sortedWidths[0] ?? axes.secondarySpanMm; const estimatedMaximumWidthMm = sortedWidths.at(-1) ?? axes.secondarySpanMm; const estimatedMedianWidthMm = sortedWidths[Math.floor(sortedWidths.length / 2)] ?? axes.secondarySpanMm;
  const widthVariationRatio = estimatedMinimumWidthMm > 0 ? estimatedMaximumWidthMm / estimatedMinimumWidthMm : Infinity;
  const widthMm = bounds?.width ?? 0; const heightMm = bounds?.height ?? 0; const aspectRatio = Math.min(widthMm, heightMm) > 0 ? Math.max(widthMm, heightMm) / Math.min(widthMm, heightMm) : Infinity;
  const errors = [];
  if (!geometryValid) errors.push({ code: 'INVALID_OBJECT_GEOMETRY', path: 'geometry', message: 'Object geometry is non-finite, degenerate, or self-intersecting.' });
  if (!holeGeometryValid) errors.push({ code: 'INVALID_OBJECT_HOLE_GEOMETRY', path: 'holes', message: 'One or more explicit holes are invalid.' });
  return {
    objectId: object?.id ?? null, regionId: object?.regionId ?? null, geometryValid, holeGeometryValid,
    areaMm2: effectiveAreaMm2, outerAreaMm2, holeAreaMm2, effectiveAreaMm2, perimeterMm,
    bounds, widthMm, heightMm, aspectRatio, compactness: perimeterMm > 0 ? 4 * Math.PI * effectiveAreaMm2 / (perimeterMm ** 2) : 0,
    centroid, validInteriorPoint: geometryValid && isClosedGeometry && bounds ? validInteriorPoint(points, holes, centroid, bounds) : null,
    principalAxisDegrees: axes.principalAxisDegrees, secondaryAxisDegrees: axes.secondaryAxisDegrees, principalSpanMm: axes.principalSpanMm, secondarySpanMm: axes.secondarySpanMm,
    estimatedMinimumWidthMm, estimatedMaximumWidthMm, estimatedMedianWidthMm, widthVariationRatio,
    isClosedGeometry, isThin: aspectRatio >= thresholds.thinAspectRatio, isVeryThin: aspectRatio >= thresholds.veryThinAspectRatio,
    isSmall: effectiveAreaMm2 < thresholds.smallAreaMm2, isLarge: effectiveAreaMm2 >= thresholds.largeAreaMm2,
    hasHoles: holes.length > 0, holeCount: holes.length, sourcePointCount: source.length, duplicatePointCount, nonFinitePointCount, errors, warnings: [],
  };
}
