export const DEFAULT_GEOMETRY_TOLERANCES = Object.freeze({
  pointToleranceNormalized: 1e-9,
  boundaryTouchToleranceNormalized: 1e-6,
  minimumAreaNormalized: 1e-8,
});

function issue(code, path, message) {
  return { code, path, message };
}

function asPoint(value) {
  if (Array.isArray(value)) return { x: value[0], y: value[1] };
  if (value && typeof value === 'object') return { x: value.x, y: value.y };
  return { x: undefined, y: undefined };
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pointsNear(a, b, tolerance) {
  return distanceSquared(a, b) <= tolerance * tolerance;
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point, a, b, tolerance = 1e-9) {
  if (Math.abs(orientation(a, b, point)) > tolerance) return false;
  return point.x >= Math.min(a.x, b.x) - tolerance
    && point.x <= Math.max(a.x, b.x) + tolerance
    && point.y >= Math.min(a.y, b.y) - tolerance
    && point.y <= Math.max(a.y, b.y) + tolerance;
}

function segmentsIntersect(a, b, c, d, tolerance = 1e-9) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (((o1 > tolerance && o2 < -tolerance) || (o1 < -tolerance && o2 > tolerance))
    && ((o3 > tolerance && o4 < -tolerance) || (o3 < -tolerance && o4 > tolerance))) return true;
  return (Math.abs(o1) <= tolerance && pointOnSegment(c, a, b, tolerance))
    || (Math.abs(o2) <= tolerance && pointOnSegment(d, a, b, tolerance))
    || (Math.abs(o3) <= tolerance && pointOnSegment(a, c, d, tolerance))
    || (Math.abs(o4) <= tolerance && pointOnSegment(b, c, d, tolerance));
}

function segmentsProperlyIntersect(a, b, c, d, tolerance = 1e-9) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return ((o1 > tolerance && o2 < -tolerance) || (o1 < -tolerance && o2 > tolerance))
    && ((o3 > tolerance && o4 < -tolerance) || (o3 < -tolerance && o4 > tolerance));
}

function hasSelfIntersection(points, tolerance) {
  for (let i = 0; i < points.length; i += 1) {
    const nextI = (i + 1) % points.length;
    for (let j = i + 1; j < points.length; j += 1) {
      const nextJ = (j + 1) % points.length;
      if (i === j || nextI === j || nextJ === i) continue;
      if (segmentsIntersect(points[i], points[nextI], points[j], points[nextJ], tolerance)) return true;
    }
  }
  return false;
}

function convertPoint(point, metadata, path) {
  const errors = [];
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return { point, errors: [issue('NON_FINITE_COORDINATE', path, 'Coordinates must be finite numbers.')] };
  }
  let converted;
  if (metadata.coordinateSpace === 'normalized') {
    converted = { ...point };
  } else if (metadata.coordinateSpace === 'pixel') {
    if (!Number.isFinite(metadata.sourceWidth) || metadata.sourceWidth <= 0
      || !Number.isFinite(metadata.sourceHeight) || metadata.sourceHeight <= 0) {
      return { point, errors: [issue('MISSING_SOURCE_DIMENSIONS', path, 'Pixel coordinates require positive sourceWidth and sourceHeight.')] };
    }
    converted = { x: point.x / metadata.sourceWidth, y: point.y / metadata.sourceHeight };
  } else if (metadata.coordinateSpace === 'millimeter') {
    if (!Number.isFinite(metadata.designWidthMm) || metadata.designWidthMm <= 0
      || !Number.isFinite(metadata.designHeightMm) || metadata.designHeightMm <= 0) {
      return { point, errors: [issue('MISSING_DESIGN_DIMENSIONS', path, 'Millimeter coordinates require positive designWidthMm and designHeightMm.')] };
    }
    converted = { x: point.x / metadata.designWidthMm, y: point.y / metadata.designHeightMm };
  } else {
    return { point, errors: [issue('COORDINATE_SPACE_REQUIRED', path, 'coordinateSpace must be normalized, pixel, or millimeter.')] };
  }
  if (converted.x < 0 || converted.x > 1 || converted.y < 0 || converted.y > 1) {
    if (metadata.clampOutOfRange === true) {
      converted = { x: Math.min(1, Math.max(0, converted.x)), y: Math.min(1, Math.max(0, converted.y)) };
    } else {
      errors.push(issue('COORDINATE_OUT_OF_RANGE', path, 'Converted coordinates must remain within normalized 0-1 space.'));
    }
  }
  return { point: converted, errors };
}

export function polygonSignedArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

export function polygonArea(points) {
  return Math.abs(polygonSignedArea(points));
}

export function polygonBounds(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function polygonCentroid(points) {
  const signedArea = polygonSignedArea(points);
  if (!Number.isFinite(signedArea) || Math.abs(signedArea) < Number.EPSILON) {
    if (!Array.isArray(points) || points.length === 0) return null;
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  return { x: x / (6 * signedArea), y: y / (6 * signedArea) };
}

export function isPointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  for (let i = 0; i < polygon.length; i += 1) {
    if (pointOnSegment(point, polygon[i], polygon[(i + 1) % polygon.length])) return true;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = ((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointStrictlyInsidePolygon(point, polygon, tolerance = 1e-9) {
  for (let i = 0; i < polygon.length; i += 1) {
    if (pointOnSegment(point, polygon[i], polygon[(i + 1) % polygon.length], tolerance)) return false;
  }
  return isPointInPolygon(point, polygon);
}

export function polygonsOverlap(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      if (segmentsProperlyIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return a.some(point => pointStrictlyInsidePolygon(point, b))
    || b.some(point => pointStrictlyInsidePolygon(point, a));
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.sqrt(distanceSquared(point, a));
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function segmentDistance(a, b, c, d, tolerance) {
  if (segmentsIntersect(a, b, c, d, tolerance)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b),
  );
}

export function polygonsTouch(a, b, tolerance = DEFAULT_GEOMETRY_TOLERANCES.boundaryTouchToleranceNormalized) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      if (segmentDistance(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length], tolerance) <= tolerance) return true;
    }
  }
  return false;
}

export function polygonContainsPolygon(parent, child) {
  if (!Array.isArray(parent) || !Array.isArray(child) || parent.length < 3 || child.length < 3) return false;
  if (!child.every(point => isPointInPolygon(point, parent))) return false;
  for (let i = 0; i < parent.length; i += 1) {
    for (let j = 0; j < child.length; j += 1) {
      if (segmentsProperlyIntersect(parent[i], parent[(i + 1) % parent.length], child[j], child[(j + 1) % child.length])) return false;
    }
  }
  return true;
}

export function canonicalizePolygon(points, options = {}) {
  const tolerances = { ...DEFAULT_GEOMETRY_TOLERANCES, ...options };
  const errors = [];
  const warnings = [];
  if (!Array.isArray(points)) {
    return { valid: false, polygon: [], errors: [issue('INVALID_POLYGON', 'geometry', 'Polygon must be an array.')], warnings, metadata: {} };
  }
  const converted = points.map((value, index) => convertPoint(asPoint(value), options, `geometry[${index}]`));
  converted.forEach(item => errors.push(...item.errors));
  let polygon = converted.map(item => item.point);
  const fatalConversionCodes = new Set([
    'NON_FINITE_COORDINATE', 'MISSING_SOURCE_DIMENSIONS', 'MISSING_DESIGN_DIMENSIONS',
    'COORDINATE_SPACE_REQUIRED', 'COORDINATE_OUT_OF_RANGE',
  ]);
  if (errors.some(item => fatalConversionCodes.has(item.code))) {
    return { valid: false, polygon: polygon.map(point => ({ ...point })), errors, warnings, metadata: {} };
  }
  const deduplicated = [];
  polygon.forEach(point => {
    if (!deduplicated.length || !pointsNear(point, deduplicated[deduplicated.length - 1], tolerances.pointToleranceNormalized)) deduplicated.push(point);
  });
  const consecutiveDuplicatesRemoved = polygon.length - deduplicated.length;
  let closingPointRemoved = false;
  if (deduplicated.length > 1 && pointsNear(deduplicated[0], deduplicated[deduplicated.length - 1], tolerances.pointToleranceNormalized)) {
    deduplicated.pop();
    closingPointRemoved = true;
  }
  polygon = deduplicated;
  const unique = [];
  polygon.forEach(point => {
    if (!unique.some(candidate => pointsNear(point, candidate, tolerances.pointToleranceNormalized))) unique.push(point);
  });
  if (unique.length < 3) errors.push(issue('TOO_FEW_UNIQUE_POINTS', 'geometry', 'Polygon requires at least three unique finite points.'));
  if (unique.length >= 3 && hasSelfIntersection(polygon, tolerances.pointToleranceNormalized)) errors.push(issue('SELF_INTERSECTION', 'geometry', 'Polygon contains a self-intersection.'));
  const area = polygonArea(polygon);
  if (!Number.isFinite(area) || area < tolerances.minimumAreaNormalized) errors.push(issue('DEGENERATE_POLYGON', 'geometry', 'Polygon area is below the configured minimum.'));
  const desiredOrientation = options.orientation || 'ccw';
  const signedArea = polygonSignedArea(polygon);
  if ((desiredOrientation === 'ccw' && signedArea < 0) || (desiredOrientation === 'cw' && signedArea > 0)) polygon = [...polygon].reverse();
  return {
    valid: errors.length === 0,
    polygon: polygon.map(point => ({ ...point })),
    errors,
    warnings,
    metadata: {
      coordinateSpace: options.coordinateSpace ?? null,
      orientation: desiredOrientation,
      closingPointRemoved,
      consecutiveDuplicatesRemoved,
      area: polygonArea(polygon),
    },
  };
}

export function canonicalizeHoles(holes, options = {}) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(holes)) return { valid: false, holes: [], errors: [issue('INVALID_HOLES', 'holes', 'Holes must be an array.')], warnings };
  const canonical = holes.map((hole, index) => {
    const result = canonicalizePolygon(hole, { ...options, orientation: 'cw' });
    errors.push(...result.errors.map(item => ({ ...item, path: `holes[${index}].${item.path}` })));
    warnings.push(...result.warnings.map(item => ({ ...item, path: `holes[${index}].${item.path}` })));
    return result.polygon;
  });
  return { valid: errors.length === 0, holes: canonical, errors, warnings };
}

export const _geometryInternals = Object.freeze({
  pointOnSegment,
  pointsNear,
  segmentsIntersect,
  segmentsProperlyIntersect,
});
