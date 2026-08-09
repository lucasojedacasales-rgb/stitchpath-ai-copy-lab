import { distanceBetweenPoints, finitePhysicalPoint } from './stitchGeometry.js';

function normalizeDirection(direction) {
  const length = Math.hypot(direction?.x ?? 0, direction?.y ?? 0);
  return length > 0 ? { x: direction.x / length, y: direction.y / length } : null;
}

function local(point, origin, direction) {
  const dx = point.x - origin.x; const dy = point.y - origin.y;
  return { u: dx * direction.x + dy * direction.y, v: -dx * direction.y + dy * direction.x };
}

function world(u, origin, direction) { return { x: origin.x + u * direction.x, y: origin.y + u * direction.y }; }

function polygonIntervals(polygon, origin, direction, tolerance) {
  const localPoints = polygon.map(point => local(point, origin, direction)); const intersections = [];
  localPoints.forEach((a, index) => {
    const b = localPoints[(index + 1) % localPoints.length];
    if ((a.v <= tolerance && b.v > tolerance) || (b.v <= tolerance && a.v > tolerance)) {
      const ratio = -a.v / (b.v - a.v); intersections.push(a.u + (b.u - a.u) * ratio);
    }
  });
  intersections.sort((a, b) => a - b);
  const unique = intersections.filter((value, index) => !index || Math.abs(value - intersections[index - 1]) > tolerance);
  const intervals = [];
  for (let index = 0; index + 1 < unique.length; index += 2) if (unique[index + 1] - unique[index] > tolerance) intervals.push({ startU: unique[index], endU: unique[index + 1] });
  return intervals;
}

function uniqueBreakpoints(intervalGroups, tolerance) {
  return intervalGroups
    .flatMap(group => group.intervals.flatMap(interval => [interval.startU, interval.endU]))
    .sort((a, b) => a - b)
    .filter((value, index, values) => !index || Math.abs(value - values[index - 1]) > tolerance);
}

function containsU(intervals, u, tolerance) {
  return intervals.some(interval => u > interval.startU + tolerance && u < interval.endU - tolerance);
}

function boundaryAt(intervalGroups, u, materialOnPositiveSide, tolerance) {
  const candidates = [];
  intervalGroups.forEach(group => group.intervals.forEach(interval => {
    if (Math.abs(interval.startU - u) <= tolerance) candidates.push({ ...group, side: 'start' });
    if (Math.abs(interval.endU - u) <= tolerance) candidates.push({ ...group, side: 'end' });
  }));
  const holes = candidates.filter(candidate => candidate.type === 'hole').sort((a, b) => a.holeIndex - b.holeIndex || a.side.localeCompare(b.side));
  if (holes.length) return { boundaryType: 'hole', holeIndex: holes[0].holeIndex };
  const outer = candidates.find(candidate => candidate.type === 'outer');
  if (outer) return { boundaryType: 'outer', holeIndex: null };
  return { boundaryType: materialOnPositiveSide ? 'outer' : 'outer', holeIndex: null };
}

function compoundMaterialIntervals(outerIntervals, holeIntervalsByIndex, tolerance) {
  const groups = [
    { type: 'outer', holeIndex: null, intervals: outerIntervals },
    ...holeIntervalsByIndex.map((intervals, holeIndex) => ({ type: 'hole', holeIndex, intervals })),
  ];
  const breakpoints = uniqueBreakpoints(groups, tolerance);
  const material = [];
  for (let index = 0; index + 1 < breakpoints.length; index += 1) {
    const startU = breakpoints[index]; const endU = breakpoints[index + 1];
    if (endU - startU <= tolerance) continue;
    const midpointU = (startU + endU) / 2;
    const insideOuter = containsU(outerIntervals, midpointU, tolerance);
    const insideHoleUnion = holeIntervalsByIndex.some(intervals => containsU(intervals, midpointU, tolerance));
    if (!insideOuter || insideHoleUnion) continue;
    const startBoundary = boundaryAt(groups, startU, true, tolerance);
    const endBoundary = boundaryAt(groups, endU, false, tolerance);
    material.push({
      startU,
      endU,
      startBoundaryType: startBoundary.boundaryType,
      endBoundaryType: endBoundary.boundaryType,
      startHoleIndex: startBoundary.holeIndex,
      endHoleIndex: endBoundary.holeIndex,
    });
  }
  return material;
}

export function clipScanlineToRegion({ outerPolygon = [], holes = [], lineOrigin, lineDirection, tolerance = 1e-6 }) {
  const errors = []; const direction = normalizeDirection(lineDirection);
  if (!direction || !finitePhysicalPoint(lineOrigin) || outerPolygon.length < 3 || outerPolygon.some(point => !finitePhysicalPoint(point)) || holes.some(hole => hole.length < 3 || hole.some(point => !finitePhysicalPoint(point)))) return { valid: false, intervals: [], errors: [{ code: 'INVALID_SCANLINE_CLIP_GEOMETRY' }], warnings: [] };
  const outerIntervals = polygonIntervals(outerPolygon, lineOrigin, direction, tolerance);
  const holeIntervalsByIndex = holes.map(hole => polygonIntervals(hole, lineOrigin, direction, tolerance));
  const segments = compoundMaterialIntervals(outerIntervals, holeIntervalsByIndex, tolerance);
  const intervals = segments.filter(segment => segment.endU - segment.startU > tolerance).sort((a, b) => a.startU - b.startU).map(segment => {
    const start = world(segment.startU, lineOrigin, direction); const end = world(segment.endU, lineOrigin, direction);
    return Object.freeze({ start, end, startBoundaryType: segment.startBoundaryType, endBoundaryType: segment.endBoundaryType, startHoleIndex: segment.startHoleIndex, endHoleIndex: segment.endHoleIndex, lengthMm: distanceBetweenPoints(start, end) });
  });
  return { valid: errors.length === 0, intervals, errors, warnings: [] };
}

export function generateParallelScanlineOrigins({ bounds, angleDegrees, spacingMm, maximumScanlines }) {
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }; const radians = angleDegrees * Math.PI / 180;
  const direction = { x: Math.cos(radians), y: Math.sin(radians) }; const normal = { x: -direction.y, y: direction.x };
  const corners = [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }];
  const offsets = corners.map(point => (point.x - center.x) * normal.x + (point.y - center.y) * normal.y); const minimum = Math.min(...offsets); const maximum = Math.max(...offsets);
  const first = Math.ceil(minimum / spacingMm) * spacingMm; const count = Math.max(0, Math.floor((maximum - first) / spacingMm) + 1);
  if (count > maximumScanlines) return { valid: false, origins: [], direction, errors: [{ code: 'PHYSICAL_GENERATION_LIMIT_EXCEEDED', limit: maximumScanlines, requested: count }] };
  return { valid: true, origins: Array.from({ length: count }, (_, index) => ({ x: center.x + normal.x * (first + index * spacingMm), y: center.y + normal.y * (first + index * spacingMm) })), direction, errors: [] };
}
