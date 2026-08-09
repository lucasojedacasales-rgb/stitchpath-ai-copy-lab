const VERSION = 'engine-v2-deterministic-geometry-metrics-r1';

const DEFAULT_OPTIONS = Object.freeze({
  pointToleranceMm: 1e-6,
  boundaryToleranceMm: 1e-3,
  minimumAreaMm2: 0.01,
  stationCount: 129,
  minimumSustainedRunFraction: 0.2,
  curvatureSampleCount: 129,
  curvatureSmoothingWindow: 5,
  cornerTurnThresholdRadians: Math.PI / 6,
});

const issue = (code, path, message) => ({ code, path, message });
const finitePoint = point => Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y);
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const normalizeZero = value => Object.is(value, -0) ? 0 : value;

function compareCanonicalStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function publicNumbersAreFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(publicNumbersAreFinite);
  if (value && typeof value === 'object') return Object.values(value).every(publicNumbersAreFinite);
  return true;
}

function result(valid, value, errors = [], warnings = [], nonFinitePath = 'value') {
  const derivedErrors = valid && !publicNumbersAreFinite(value)
    ? [issue(
      'GEOMETRY_METRIC_POLYGON_DEGENERATE',
      nonFinitePath,
      'Derived metric values must be finite.',
    )]
    : errors;
  const derivedValid = valid && derivedErrors.length === 0;
  return deepFreeze(clone({
    version: VERSION,
    valid: derivedValid,
    coordinateSpace: 'millimeter',
    value: derivedValid ? value : null,
    errors: derivedErrors,
    warnings,
  }));
}

function coordinateErrors(input) {
  return input?.coordinateSpace === 'millimeter'
    ? []
    : [issue(
      'GEOMETRY_METRIC_COORDINATE_SPACE_INVALID',
      'coordinateSpace',
      'coordinateSpace must be millimeter.',
    )];
}

function resolveOptions(options = {}, requirements = {}) {
  const resolved = { ...DEFAULT_OPTIONS, ...(options || {}) };
  const errors = [];
  const positive = [
    ['pointToleranceMm', false],
    ['boundaryToleranceMm', false],
    ['minimumAreaMm2', false],
  ];
  positive.forEach(([field]) => {
    if (!Number.isFinite(resolved[field]) || resolved[field] <= 0) {
      errors.push(issue('GEOMETRY_METRIC_OPTION_INVALID', `options.${field}`, `${field} must be finite and greater than zero.`));
    }
  });
  if (!Number.isInteger(resolved.stationCount) || resolved.stationCount < 3 || resolved.stationCount > 4097 || resolved.stationCount % 2 === 0) {
    errors.push(issue('GEOMETRY_METRIC_OPTION_INVALID', 'options.stationCount', 'stationCount must be an odd integer between 3 and 4097.'));
  }
  if (!Number.isFinite(resolved.minimumSustainedRunFraction)
    || resolved.minimumSustainedRunFraction <= 0
    || resolved.minimumSustainedRunFraction > 1) {
    errors.push(issue('GEOMETRY_METRIC_OPTION_INVALID', 'options.minimumSustainedRunFraction', 'minimumSustainedRunFraction must be in (0, 1].'));
  }
  if (!Number.isInteger(resolved.curvatureSampleCount)
    || resolved.curvatureSampleCount < 3
    || resolved.curvatureSampleCount > 4097) {
    errors.push(issue('GEOMETRY_METRIC_OPTION_INVALID', 'options.curvatureSampleCount', 'curvatureSampleCount must be an integer between 3 and 4097.'));
  }
  if (!Number.isInteger(resolved.curvatureSmoothingWindow)
    || resolved.curvatureSmoothingWindow < 1
    || resolved.curvatureSmoothingWindow > resolved.curvatureSampleCount
    || resolved.curvatureSmoothingWindow % 2 === 0) {
    errors.push(issue('GEOMETRY_METRIC_OPTION_INVALID', 'options.curvatureSmoothingWindow', 'curvatureSmoothingWindow must be a positive odd integer no larger than curvatureSampleCount.'));
  }
  if (!Number.isFinite(resolved.cornerTurnThresholdRadians)
    || resolved.cornerTurnThresholdRadians <= 0
    || resolved.cornerTurnThresholdRadians > Math.PI) {
    errors.push(issue('GEOMETRY_METRIC_OPTION_INVALID', 'options.cornerTurnThresholdRadians', 'cornerTurnThresholdRadians must be in (0, PI].'));
  }
  if (requirements.bridge) {
    [
      ['maximumBridgeWidthMm', 0],
      ['minimumBridgeLengthMm', 0],
      ['minimumShoulderRatio', 1],
    ].forEach(([field, lowerBound]) => {
      if (!Number.isFinite(resolved[field]) || resolved[field] <= lowerBound) {
        errors.push(issue(
          'GEOMETRY_METRIC_OPTION_INVALID',
          `options.${field}`,
          `${field} must be finite and greater than ${lowerBound}.`,
        ));
      }
    });
  }
  return { options: resolved, errors };
}

function pointsNear(a, b, tolerance) {
  return distance(a, b) <= tolerance;
}

function cleanPoints(points, path, tolerance, { closed }) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(points)) {
    return {
      points: [],
      errors: [issue('GEOMETRY_METRIC_POINT_INVALID', path, 'Expected an array of points.')],
      warnings,
    };
  }
  const cleaned = [];
  points.forEach((point, index) => {
    if (!finitePoint(point)) {
      errors.push(issue('GEOMETRY_METRIC_POINT_INVALID', `${path}[${index}]`, 'Point coordinates must be finite numbers.'));
      return;
    }
    const next = { x: normalizeZero(point.x), y: normalizeZero(point.y) };
    if (cleaned.length && pointsNear(cleaned.at(-1), next, tolerance)) {
      warnings.push(issue('GEOMETRY_METRIC_DUPLICATE_POINT_REMOVED', `${path}[${index}]`, 'A consecutive duplicate point was removed.'));
    } else {
      cleaned.push(next);
    }
  });
  if (closed && cleaned.length > 1 && pointsNear(cleaned[0], cleaned.at(-1), tolerance)) {
    cleaned.pop();
    warnings.push(issue('GEOMETRY_METRIC_DUPLICATE_CLOSING_POINT_REMOVED', path, 'A duplicate closing point was removed.'));
  }
  return { points: cleaned, errors, warnings };
}

function signedArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point, a, b, tolerance) {
  if (Math.abs(orientation(a, b, point)) > tolerance * Math.max(1, distance(a, b))) return false;
  return point.x >= Math.min(a.x, b.x) - tolerance
    && point.x <= Math.max(a.x, b.x) + tolerance
    && point.y >= Math.min(a.y, b.y) - tolerance
    && point.y <= Math.max(a.y, b.y) + tolerance;
}

function segmentsIntersect(a, b, c, d, tolerance) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  const scale = Math.max(1, distance(a, b), distance(c, d));
  const epsilon = tolerance * scale;
  if (((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon))
    && ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon))) return true;
  return (Math.abs(o1) <= epsilon && pointOnSegment(c, a, b, tolerance))
    || (Math.abs(o2) <= epsilon && pointOnSegment(d, a, b, tolerance))
    || (Math.abs(o3) <= epsilon && pointOnSegment(a, c, d, tolerance))
    || (Math.abs(o4) <= epsilon && pointOnSegment(b, c, d, tolerance));
}

function selfIntersects(points, tolerance) {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (first === 0 && secondNext === 0) continue;
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext], tolerance)) return true;
    }
  }
  return false;
}

function pointInPolygon(point, polygon, boundaryInside = true, tolerance = 1e-6) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous];
    const b = polygon[index];
    if (pointOnSegment(point, a, b, tolerance)) return boundaryInside;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function boundariesIntersect(a, b, tolerance) {
  for (let first = 0; first < a.length; first += 1) {
    for (let second = 0; second < b.length; second += 1) {
      if (segmentsIntersect(
        a[first],
        a[(first + 1) % a.length],
        b[second],
        b[(second + 1) % b.length],
        tolerance,
      )) return true;
    }
  }
  return false;
}

function validateRing(points, path, options) {
  const cleaned = cleanPoints(points, path, options.pointToleranceMm, { closed: true });
  const errors = [...cleaned.errors];
  if (!errors.length && cleaned.points.length < 3) {
    errors.push(issue('GEOMETRY_METRIC_POLYGON_DEGENERATE', path, 'A polygon requires at least three distinct points.'));
  }
  if (!errors.length) {
    const areaMm2 = Math.abs(signedArea(cleaned.points));
    if (!Number.isFinite(areaMm2) || areaMm2 < options.minimumAreaMm2) {
      errors.push(issue('GEOMETRY_METRIC_POLYGON_DEGENERATE', path, 'Polygon area must be finite and at least minimumAreaMm2.'));
    }
  }
  if (!cleaned.errors.length && cleaned.points.length >= 3
    && selfIntersects(cleaned.points, options.pointToleranceMm)) {
    errors.push(issue('GEOMETRY_METRIC_POLYGON_SELF_INTERSECTING', path, 'Polygon must not self-intersect.'));
  }
  return { points: cleaned.points, errors, warnings: cleaned.warnings };
}

function validateAreaInput(input, options) {
  const errors = coordinateErrors(input);
  const warnings = [];
  const outer = validateRing(input?.geometry, 'geometry', options);
  errors.push(...outer.errors);
  warnings.push(...outer.warnings);
  const sourceHoles = input?.holes ?? [];
  if (!Array.isArray(sourceHoles)) {
    errors.push(issue('GEOMETRY_METRIC_HOLE_INVALID', 'holes', 'holes must be an array.'));
  }
  const holes = Array.isArray(sourceHoles)
    ? sourceHoles.map((hole, index) => {
      const validated = validateRing(hole, `holes[${index}]`, options);
      errors.push(...validated.errors.map(error => ({
        ...error,
        code: error.code === 'GEOMETRY_METRIC_POINT_INVALID'
          ? error.code
          : 'GEOMETRY_METRIC_HOLE_INVALID',
      })));
      warnings.push(...validated.warnings);
      return validated.points;
    })
    : [];
  if (!outer.errors.length) {
    holes.forEach((hole, index) => {
      if (!hole.length || !hole.every(point => pointInPolygon(point, outer.points, false, options.boundaryToleranceMm))
        || boundariesIntersect(outer.points, hole, options.boundaryToleranceMm)) {
        errors.push(issue('GEOMETRY_METRIC_HOLE_INVALID', `holes[${index}]`, 'Each hole must be strictly inside the outer polygon.'));
      }
      holes.slice(index + 1).forEach((other, offset) => {
        if (boundariesIntersect(hole, other, options.boundaryToleranceMm)
          || pointInPolygon(hole[0], other, true, options.boundaryToleranceMm)
          || pointInPolygon(other[0], hole, true, options.boundaryToleranceMm)) {
          errors.push(issue('GEOMETRY_METRIC_HOLE_INVALID', `holes[${index + offset + 1}]`, 'Holes must not overlap or contain one another.'));
        }
      });
    });
  }
  if (!errors.length) {
    const effectiveAreaMm2 = Math.abs(signedArea(outer.points))
      - holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
    if (!Number.isFinite(effectiveAreaMm2) || effectiveAreaMm2 < options.minimumAreaMm2) {
      errors.push(issue(
        'GEOMETRY_METRIC_POLYGON_DEGENERATE',
        'geometry',
        'Effective material area must be finite and at least minimumAreaMm2.',
      ));
    }
  }
  return { geometry: outer.points, holes, errors, warnings };
}

function ringRawMoments(points) {
  let twiceArea = 0;
  let centroidXNumerator = 0;
  let centroidYNumerator = 0;
  let rawXX = 0;
  let rawYY = 0;
  let rawXY = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    centroidXNumerator += (current.x + next.x) * cross;
    centroidYNumerator += (current.y + next.y) * cross;
    rawXX += (current.x ** 2 + current.x * next.x + next.x ** 2) * cross;
    rawYY += (current.y ** 2 + current.y * next.y + next.y ** 2) * cross;
    rawXY += (
      2 * current.x * current.y
      + current.x * next.y
      + next.x * current.y
      + 2 * next.x * next.y
    ) * cross;
  }
  return {
    area: twiceArea / 2,
    firstX: centroidXNumerator / 6,
    firstY: centroidYNumerator / 6,
    secondXX: rawXX / 12,
    secondYY: rawYY / 12,
    secondXY: rawXY / 24,
  };
}

function materialMoments(geometry, holes) {
  const contributions = [
    { moments: ringRawMoments(geometry), sign: 1 },
    ...holes.map(hole => ({ moments: ringRawMoments(hole), sign: -1 })),
  ];
  const totals = {
    area: 0,
    firstX: 0,
    firstY: 0,
    secondXX: 0,
    secondYY: 0,
    secondXY: 0,
  };
  contributions.forEach(({ moments, sign }) => {
    const orientationSign = Math.sign(moments.area) || 1;
    const factor = sign * orientationSign;
    Object.keys(totals).forEach(field => { totals[field] += moments[field] * factor; });
  });
  if (!Object.values(totals).every(Number.isFinite) || totals.area <= 0) return null;
  const centroid = { x: totals.firstX / totals.area, y: totals.firstY / totals.area };
  const covarianceXX = totals.secondXX / totals.area - centroid.x ** 2;
  const covarianceYY = totals.secondYY / totals.area - centroid.y ** 2;
  const covarianceXY = totals.secondXY / totals.area - centroid.x * centroid.y;
  if (![centroid.x, centroid.y, covarianceXX, covarianceYY, covarianceXY].every(Number.isFinite)) return null;
  return { ...totals, centroid, covarianceXX, covarianceYY, covarianceXY };
}

function canonicalDirection(direction) {
  const length = Math.hypot(direction.x, direction.y) || 1;
  let x = direction.x / length;
  let y = direction.y / length;
  if (x < 0 || (Math.abs(x) <= Number.EPSILON && y < 0)) {
    x *= -1;
    y *= -1;
  }
  return { x: normalizeZero(x), y: normalizeZero(y) };
}

function maximumFeretDirection(points, tolerance) {
  let best = null;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const squared = (points[second].x - points[first].x) ** 2 + (points[second].y - points[first].y) ** 2;
      const direction = canonicalDirection({
        x: points[second].x - points[first].x,
        y: points[second].y - points[first].y,
      });
      const key = `${direction.x.toFixed(12)}:${direction.y.toFixed(12)}`;
      if (!best || squared > best.squared + tolerance
        || (Math.abs(squared - best.squared) <= tolerance && key < best.key)) {
        best = { squared, direction, key };
      }
    }
  }
  return best?.direction ?? { x: 1, y: 0 };
}

function projectionRange(points, axis, origin) {
  const values = points.map(point => (point.x - origin.x) * axis.x + (point.y - origin.y) * axis.y);
  return { minimum: Math.min(...values), maximum: Math.max(...values) };
}

function intrinsicAxis(geometry, holes, options) {
  const moments = materialMoments(geometry, holes);
  if (!moments) return null;
  const delta = moments.covarianceXX - moments.covarianceYY;
  const discriminant = Math.hypot(delta, 2 * moments.covarianceXY);
  const trace = Math.abs(moments.covarianceXX) + Math.abs(moments.covarianceYY);
  const ambiguous = discriminant <= options.pointToleranceMm * Math.max(1, trace);
  const angle = 0.5 * Math.atan2(2 * moments.covarianceXY, delta);
  const direction = ambiguous
    ? maximumFeretDirection(geometry, options.pointToleranceMm)
    : canonicalDirection({ x: Math.cos(angle), y: Math.sin(angle) });
  const range = projectionRange(geometry, direction, moments.centroid);
  if (![direction.x, direction.y, range.minimum, range.maximum].every(Number.isFinite)) return null;
  return {
    direction,
    perpendicular: { x: normalizeZero(-direction.y), y: normalizeZero(direction.x) },
    centroid: moments.centroid,
    spanMm: range.maximum - range.minimum,
    minimumProjectionMm: range.minimum,
    maximumProjectionMm: range.maximum,
    ambiguous,
    effectiveAreaMm2: moments.area,
    method: ambiguous ? 'maximum_feret_fallback' : 'material_area_moments',
  };
}

function polygonLineIntervals(polygon, origin, axis, perpendicular, station) {
  const intersections = [];
  const local = point => ({
    u: (point.x - origin.x) * axis.x + (point.y - origin.y) * axis.y,
    v: (point.x - origin.x) * perpendicular.x + (point.y - origin.y) * perpendicular.y,
  });
  for (let index = 0; index < polygon.length; index += 1) {
    const a = local(polygon[index]);
    const b = local(polygon[(index + 1) % polygon.length]);
    if ((a.u > station) !== (b.u > station)) {
      const ratio = (station - a.u) / (b.u - a.u);
      intersections.push(a.v + (b.v - a.v) * ratio);
    }
  }
  intersections.sort((left, right) => left - right);
  const intervals = [];
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    intervals.push([intersections[index], intersections[index + 1]]);
  }
  return intervals;
}

function subtractIntervals(intervals, exclusions, tolerance) {
  let material = intervals.map(interval => [...interval]);
  exclusions.forEach(([excludeStart, excludeEnd]) => {
    material = material.flatMap(([start, end]) => {
      if (excludeEnd <= start + tolerance || excludeStart >= end - tolerance) return [[start, end]];
      const pieces = [];
      if (excludeStart > start + tolerance) pieces.push([start, Math.min(end, excludeStart)]);
      if (excludeEnd < end - tolerance) pieces.push([Math.max(start, excludeEnd), end]);
      return pieces;
    });
  });
  return material.filter(([start, end]) => end - start > tolerance);
}

function sectionAt(geometry, holes, axisInfo, station, tolerance) {
  const outer = polygonLineIntervals(
    geometry,
    axisInfo.centroid,
    axisInfo.direction,
    axisInfo.perpendicular,
    station,
  );
  const excluded = holes.flatMap(hole => polygonLineIntervals(
    hole,
    axisInfo.centroid,
    axisInfo.direction,
    axisInfo.perpendicular,
    station,
  ));
  const intervals = subtractIntervals(outer, excluded, tolerance);
  const widest = intervals.reduce((best, interval) =>
    !best || interval[1] - interval[0] > best[1] - best[0] ? interval : best, null);
  return {
    intervals,
    widthMm: widest ? widest[1] - widest[0] : 0,
    centerV: widest ? (widest[0] + widest[1]) / 2 : null,
  };
}

function sampleWidths(geometry, holes, axisInfo, options) {
  const stepMm = axisInfo.spanMm / options.stationCount;
  return Array.from({ length: options.stationCount }, (_, index) => {
    const station = axisInfo.minimumProjectionMm + (index + 0.5) * stepMm;
    return {
      index,
      station,
      ...sectionAt(geometry, holes, axisInfo, station, options.pointToleranceMm),
    };
  });
}

function axisValue(axisInfo) {
  return {
    direction: axisInfo.direction,
    perpendicular: axisInfo.perpendicular,
    origin: axisInfo.centroid,
    ambiguous: axisInfo.ambiguous,
    method: axisInfo.method,
  };
}

function areaMetricContext(input, options, requirements = {}) {
  const resolved = resolveOptions(options, requirements);
  const geometry = validateAreaInput(input, resolved.options);
  const errors = [...resolved.errors, ...geometry.errors];
  return {
    options: resolved.options,
    geometry,
    errors,
    warnings: geometry.warnings,
  };
}

export function measureMeanWidthMm(input = {}, options = {}) {
  const context = areaMetricContext(input, options);
  if (context.errors.length) return result(false, null, context.errors, context.warnings);
  const axis = intrinsicAxis(context.geometry.geometry, context.geometry.holes, context.options);
  const warnings = [...context.warnings];
  if (axis?.ambiguous) {
    warnings.push(issue('GEOMETRY_METRIC_AXIS_AMBIGUOUS', 'geometry', 'The material-area principal axis is ambiguous; maximum Feret direction was used.'));
  }
  if (!axis || !Number.isFinite(axis.spanMm) || axis.spanMm <= context.options.pointToleranceMm) {
    return result(false, null, [
      issue('GEOMETRY_METRIC_POLYGON_DEGENERATE', 'geometry', 'Longitudinal span must be positive.'),
    ], warnings);
  }
  return result(true, {
    meanWidthMm: axis.effectiveAreaMm2 / axis.spanMm,
    effectiveAreaMm2: axis.effectiveAreaMm2,
    longitudinalSpanMm: axis.spanMm,
    axis: axisValue(axis),
    method: 'effective_area_over_intrinsic_span',
  }, [], warnings, 'geometry');
}

export function measureSustainedWidthMm(input = {}, options = {}) {
  const context = areaMetricContext(input, options);
  if (context.errors.length) return result(false, null, context.errors, context.warnings);
  const axis = intrinsicAxis(context.geometry.geometry, context.geometry.holes, context.options);
  const warnings = [...context.warnings];
  if (axis?.ambiguous) {
    warnings.push(issue('GEOMETRY_METRIC_AXIS_AMBIGUOUS', 'geometry', 'The material-area principal axis is ambiguous; maximum Feret direction was used.'));
  }
  if (!axis || !Number.isFinite(axis.spanMm) || axis.spanMm <= context.options.pointToleranceMm) {
    return result(false, null, [
      issue('GEOMETRY_METRIC_POLYGON_DEGENERATE', 'geometry', 'Longitudinal span must be finite and positive.'),
    ], warnings);
  }
  const samples = sampleWidths(context.geometry.geometry, context.geometry.holes, axis, context.options);
  const requiredSamples = Math.max(1, Math.ceil(context.options.minimumSustainedRunFraction * samples.length));
  let best = null;
  for (let start = 0; start + requiredSamples <= samples.length; start += 1) {
    const window = samples.slice(start, start + requiredSamples);
    const threshold = Math.min(...window.map(sample => sample.widthMm));
    if (!best || threshold > best.threshold + context.options.pointToleranceMm) {
      best = { start, end: start + requiredSamples - 1, threshold };
    }
  }
  while (best.start > 0 && samples[best.start - 1].widthMm + context.options.pointToleranceMm >= best.threshold) best.start -= 1;
  while (best.end + 1 < samples.length
    && samples[best.end + 1].widthMm + context.options.pointToleranceMm >= best.threshold) best.end += 1;
  const stepMm = axis.spanMm / samples.length;
  return result(true, {
    sustainedWidthMm: best.threshold,
    maximumWidthMm: Math.max(...samples.map(sample => sample.widthMm)),
    run: {
      startRatio: best.start / samples.length,
      endRatio: (best.end + 1) / samples.length,
      lengthMm: (best.end - best.start + 1) * stepMm,
      sampleCount: best.end - best.start + 1,
      coverageFraction: (best.end - best.start + 1) / samples.length,
    },
    axis: axisValue(axis),
    stationCount: samples.length,
    minimumSustainedRunFraction: context.options.minimumSustainedRunFraction,
    method: 'fixed_station_contiguous_run',
  }, [], warnings, 'geometry');
}

function pathLength(points, closed) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1], points[index]);
  if (closed && points.length > 1) length += distance(points.at(-1), points[0]);
  return length;
}

function resamplePath(points, closed, count) {
  const source = closed ? [...points, points[0]] : points;
  const cumulative = [0];
  for (let index = 1; index < source.length; index += 1) {
    cumulative.push(cumulative.at(-1) + distance(source[index - 1], source[index]));
  }
  const total = cumulative.at(-1);
  const divisor = closed ? count : count - 1;
  const samples = [];
  let segment = 1;
  for (let index = 0; index < count; index += 1) {
    const target = total * (index / divisor);
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
    const startLength = cumulative[segment - 1];
    const endLength = cumulative[segment];
    const ratio = endLength > startLength ? (target - startLength) / (endLength - startLength) : 0;
    const start = source[segment - 1];
    const end = source[segment];
    samples.push({
      point: {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      },
      arcLengthMm: target,
    });
  }
  return { samples, totalLengthMm: total };
}

function normalizedTurnVector(vector) {
  if (![vector.x, vector.y].every(Number.isFinite)) return null;
  const magnitude = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(magnitude)) return null;
  if (magnitude === 0) return { x: 0, y: 0, magnitude };
  const x = vector.x / magnitude;
  const y = vector.y / magnitude;
  return [x, y].every(Number.isFinite) ? { x, y, magnitude } : null;
}

function nonFiniteTurn() {
  return { turnRadians: Number.NaN, localLengthMm: Number.NaN, curvature: Number.NaN };
}

function turnAt(previous, current, next) {
  const incoming = normalizedTurnVector({
    x: current.x - previous.x,
    y: current.y - previous.y,
  });
  const outgoing = normalizedTurnVector({
    x: next.x - current.x,
    y: next.y - current.y,
  });
  if (!incoming || !outgoing) return nonFiniteTurn();

  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  if (![cross, dot].every(Number.isFinite)) return nonFiniteTurn();

  const turnRadians = Math.atan2(cross, dot);
  const lengthSum = incoming.magnitude + outgoing.magnitude;
  const localLengthMm = Number.isFinite(lengthSum)
    ? lengthSum / 2
    : incoming.magnitude / 2 + outgoing.magnitude / 2;
  if (![turnRadians, localLengthMm].every(Number.isFinite)) return nonFiniteTurn();

  const curvature = localLengthMm > 0 ? turnRadians / localLengthMm : 0;
  return Number.isFinite(curvature)
    ? { turnRadians, localLengthMm, curvature }
    : nonFiniteTurn();
}

function smoothCurvatures(values, window, closed) {
  const radius = Math.floor(window / 2);
  return values.map((value, index) => {
    if (value === null) return null;
    const neighbors = [];
    for (let offset = -radius; offset <= radius; offset += 1) {
      const candidate = closed
        ? values[(index + offset + values.length) % values.length]
        : values[index + offset];
      if (Number.isFinite(candidate)) neighbors.push(candidate);
    }
    return neighbors.reduce((sum, candidate) => sum + candidate, 0) / neighbors.length;
  });
}

function validatePath(input, options) {
  const errors = coordinateErrors(input);
  const cleaned = cleanPoints(input?.points, 'points', options.pointToleranceMm, { closed: input?.closed === true });
  errors.push(...cleaned.errors);
  if (typeof input?.closed !== 'boolean') {
    errors.push(issue('GEOMETRY_METRIC_OPTION_INVALID', 'closed', 'closed must be boolean.'));
  }
  const minimum = input?.closed === true ? 3 : 2;
  if (!cleaned.errors.length && cleaned.points.length < minimum) {
    errors.push(issue('GEOMETRY_METRIC_POLYGON_DEGENERATE', 'points', `The path requires at least ${minimum} distinct points.`));
  }
  if (!cleaned.errors.length && input?.closed === true && cleaned.points.length >= 3) {
    const closedAreaMm2 = Math.abs(signedArea(cleaned.points));
    if (!Number.isFinite(closedAreaMm2) || closedAreaMm2 < options.minimumAreaMm2) {
      errors.push(issue('GEOMETRY_METRIC_POLYGON_DEGENERATE', 'points', 'Closed path area must be finite and at least minimumAreaMm2.'));
    }
  }
  if (input?.closed === true && cleaned.points.length >= 3
    && selfIntersects(cleaned.points, options.pointToleranceMm)) {
    errors.push(issue('GEOMETRY_METRIC_POLYGON_SELF_INTERSECTING', 'points', 'A closed path must not self-intersect.'));
  }
  if (!errors.length) {
    const totalLengthMm = pathLength(cleaned.points, input.closed);
    if (!Number.isFinite(totalLengthMm) || totalLengthMm <= options.pointToleranceMm) {
      errors.push(issue('GEOMETRY_METRIC_POLYGON_DEGENERATE', 'points', 'Path length must be finite and greater than pointToleranceMm.'));
    }
  }
  return { points: cleaned.points, closed: input?.closed === true, errors, warnings: cleaned.warnings };
}

export function analyzeDiscreteCurvature(input = {}, options = {}) {
  const resolved = resolveOptions(options);
  const path = validatePath(input, resolved.options);
  const errors = [...resolved.errors, ...path.errors];
  if (errors.length) return result(false, null, errors, path.warnings);
  const resampled = resamplePath(path.points, path.closed, resolved.options.curvatureSampleCount);
  const raw = resampled.samples.map((sample, index) => {
    if (!path.closed && (index === 0 || index === resampled.samples.length - 1)) return null;
    const previous = resampled.samples[(index - 1 + resampled.samples.length) % resampled.samples.length].point;
    const next = resampled.samples[(index + 1) % resampled.samples.length].point;
    return turnAt(previous, sample.point, next);
  });
  const smoothed = smoothCurvatures(raw.map(item => item?.curvature ?? null), resolved.options.curvatureSmoothingWindow, path.closed);
  const samples = resampled.samples.map((sample, index) => ({
    index,
    arcLengthMm: sample.arcLengthMm,
    point: sample.point,
    turnRadians: raw[index]?.turnRadians ?? null,
    rawSignedCurvatureRadPerMm: raw[index]?.curvature ?? null,
    signedCurvatureRadPerMm: smoothed[index],
    absoluteCurvatureRadPerMm: smoothed[index] === null ? null : Math.abs(smoothed[index]),
    isCorner: raw[index] ? Math.abs(raw[index].turnRadians) >= resolved.options.cornerTurnThresholdRadians : false,
  }));
  const finiteAbsolute = samples.map(sample => sample.absoluteCurvatureRadPerMm).filter(Number.isFinite);
  return result(true, {
    closed: path.closed,
    totalLengthMm: resampled.totalLengthMm,
    samples,
    meanAbsoluteCurvatureRadPerMm: finiteAbsolute.reduce((sum, value) => sum + value, 0) / finiteAbsolute.length,
    maximumAbsoluteCurvatureRadPerMm: Math.max(...finiteAbsolute),
    sampleCount: samples.length,
    smoothingWindow: resolved.options.curvatureSmoothingWindow,
    method: 'uniform_arc_length_discrete_turning',
  }, [], path.warnings, 'points');
}

function endpointCurvature(points, atStart) {
  if (points.length < 3) return null;
  const triple = atStart ? points.slice(0, 3) : [...points.slice(-3)].reverse();
  return Math.abs(turnAt(triple[0], triple[1], triple[2]).curvature);
}

export function analyzePathEnds(input = {}, options = {}) {
  const resolved = resolveOptions(options);
  const path = validatePath(input, resolved.options);
  const errors = [...resolved.errors, ...path.errors];
  if (errors.length) return result(false, null, errors, path.warnings);
  if (path.closed) {
    return result(true, {
      applicable: false,
      closed: true,
      ends: [],
      reason: 'closed_path_has_no_topological_ends',
    }, [], path.warnings, 'points');
  }
  const candidates = [
    {
      point: path.points[0],
      neighbor: path.points[1],
      nearEndCurvatureRadPerMm: endpointCurvature(path.points, true),
    },
    {
      point: path.points.at(-1),
      neighbor: path.points.at(-2),
      nearEndCurvatureRadPerMm: endpointCurvature(path.points, false),
    },
  ].map(candidate => {
    const adjacentSegmentLengthMm = distance(candidate.point, candidate.neighbor);
    return {
      point: candidate.point,
      inwardTangent: {
        x: normalizeZero((candidate.neighbor.x - candidate.point.x) / adjacentSegmentLengthMm),
        y: normalizeZero((candidate.neighbor.y - candidate.point.y) / adjacentSegmentLengthMm),
      },
      adjacentSegmentLengthMm,
      nearEndCurvatureRadPerMm: candidate.nearEndCurvatureRadPerMm,
    };
  }).sort((left, right) => left.point.x - right.point.x || left.point.y - right.point.y)
    .map((end, index) => ({ id: `end-${String(index + 1).padStart(4, '0')}`, ...end }));
  return result(true, {
    applicable: true,
    closed: false,
    ends: candidates,
    reason: null,
  }, [], path.warnings, 'points');
}

function rotatedAxis(axis, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const direction = canonicalDirection({
    x: axis.direction.x * cosine - axis.direction.y * sine,
    y: axis.direction.x * sine + axis.direction.y * cosine,
  });
  return {
    ...axis,
    direction,
    perpendicular: { x: normalizeZero(-direction.y), y: normalizeZero(direction.x) },
    ...projectionRangeForAxis(axis, direction),
  };
}

function projectionRangeForAxis(axis, direction) {
  const range = projectionRange(axis.geometry, direction, axis.centroid);
  return {
    minimumProjectionMm: range.minimum,
    maximumProjectionMm: range.maximum,
    spanMm: range.maximum - range.minimum,
  };
}

export function detectNarrowBridgeCandidates(input = {}, options = {}) {
  const context = areaMetricContext(input, options, { bridge: true });
  if (context.errors.length) return result(false, null, context.errors, context.warnings);
  const intrinsic = intrinsicAxis(context.geometry.geometry, context.geometry.holes, context.options);
  if (!intrinsic || !Number.isFinite(intrinsic.spanMm)
    || intrinsic.spanMm <= context.options.pointToleranceMm) {
    return result(false, null, [
      issue('GEOMETRY_METRIC_POLYGON_DEGENERATE', 'geometry', 'Diagnostic axis must be finite and positive.'),
    ], context.warnings);
  }
  const baseAxis = { ...intrinsic, geometry: context.geometry.geometry };
  const directions = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4]
    .map(angle => rotatedAxis(baseAxis, angle));
  const candidates = [];
  directions.forEach((axis, directionIndex) => {
    const samples = sampleWidths(context.geometry.geometry, context.geometry.holes, axis, context.options);
    const stepMm = axis.spanMm / samples.length;
    let index = 1;
    while (index < samples.length - 1) {
      if (samples[index].widthMm <= 0 || samples[index].widthMm > context.options.maximumBridgeWidthMm) {
        index += 1;
        continue;
      }
      const start = index;
      while (index + 1 < samples.length - 1
        && samples[index + 1].widthMm > 0
        && samples[index + 1].widthMm <= context.options.maximumBridgeWidthMm) index += 1;
      const end = index;
      const lengthMm = (end - start + 1) * stepMm;
      const widthMm = Math.max(...samples.slice(start, end + 1).map(sample => sample.widthMm));
      const leftWidth = samples[start - 1].widthMm;
      const rightWidth = samples[end + 1].widthMm;
      const shoulderRatio = widthMm > 0 ? Math.min(leftWidth, rightWidth) / widthMm : 0;
      if (lengthMm + context.options.pointToleranceMm >= context.options.minimumBridgeLengthMm
        && shoulderRatio + context.options.pointToleranceMm >= context.options.minimumShoulderRatio) {
        const middle = samples[Math.floor((start + end) / 2)];
        candidates.push({
          classification: 'narrow_bridge_candidate',
          confirmed: false,
          widthMm,
          lengthMm,
          center: {
            x: axis.centroid.x + middle.station * axis.direction.x + middle.centerV * axis.perpendicular.x,
            y: axis.centroid.y + middle.station * axis.direction.y + middle.centerV * axis.perpendicular.y,
          },
          direction: axis.direction,
          shoulderRatio,
          run: {
            startRatio: start / samples.length,
            endRatio: (end + 1) / samples.length,
            sampleCount: end - start + 1,
          },
          diagnosticDirectionIndex: directionIndex,
        });
      }
      index += 1;
    }
  });
  const ordered = candidates.sort((left, right) =>
    left.center.x - right.center.x
    || left.center.y - right.center.y
    || left.widthMm - right.widthMm
    || left.diagnosticDirectionIndex - right.diagnosticDirectionIndex)
    .filter((candidate, index, all) => !all.slice(0, index).some(previous =>
      distance(previous.center, candidate.center) <= context.options.boundaryToleranceMm
      && Math.abs(previous.widthMm - candidate.widthMm) <= context.options.boundaryToleranceMm))
    .map((candidate, index) => ({
      id: `bridge-candidate-${String(index + 1).padStart(4, '0')}`,
      ...candidate,
    }));
  return result(true, {
    candidates: ordered,
    thresholds: {
      maximumBridgeWidthMm: context.options.maximumBridgeWidthMm,
      minimumBridgeLengthMm: context.options.minimumBridgeLengthMm,
      minimumShoulderRatio: context.options.minimumShoulderRatio,
    },
    method: 'multi_direction_fixed_station_neck_candidates',
    booleanGeometryClaimed: false,
  }, [], context.warnings, 'geometry');
}

function pointInEffectiveRegion(point, region, tolerance) {
  return pointInPolygon(point, region.geometry, true, tolerance)
    && !region.holes.some(hole => pointInPolygon(point, hole, false, tolerance));
}

function regionBoundaries(region) {
  return [region.geometry, ...region.holes];
}

function regionsConnected(a, b, tolerance) {
  if (regionBoundaries(a).some(boundaryA =>
    regionBoundaries(b).some(boundaryB => boundariesIntersect(boundaryA, boundaryB, tolerance)))) return true;
  return a.geometry.some(point => pointInEffectiveRegion(point, b, tolerance))
    || b.geometry.some(point => pointInEffectiveRegion(point, a, tolerance));
}

function containingHole(region, container, tolerance) {
  return container.holes.findIndex(hole =>
    region.geometry.every(point => pointInPolygon(point, hole, false, tolerance))
    && !boundariesIntersect(region.geometry, hole, tolerance));
}

function disjointSet(ids) {
  const parent = new Map(ids.map(id => [id, id]));
  function find(id) {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let cursor = id;
    while (parent.get(cursor) !== cursor) {
      const next = parent.get(cursor);
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }
  function union(a, b) {
    const first = find(a);
    const second = find(b);
    if (first === second) return;
    const [kept, changed] = [first, second].sort(compareCanonicalStrings);
    parent.set(changed, kept);
  }
  return { find, union };
}

export function analyzeDisconnectedGeometryComponents(input = {}, options = {}) {
  const resolved = resolveOptions(options);
  const errors = [...resolved.errors, ...coordinateErrors(input)];
  const warnings = [];
  if (!Array.isArray(input?.regions)) {
    errors.push(issue('GEOMETRY_METRIC_POINT_INVALID', 'regions', 'regions must be an array.'));
    return result(false, null, errors, warnings);
  }
  const ids = new Set();
  const regions = input.regions.map((region, index) => {
    const path = `regions[${index}]`;
    if (typeof region?.id !== 'string' || !region.id.trim()) {
      errors.push(issue('GEOMETRY_METRIC_REGION_ID_INVALID', `${path}.id`, 'Region id must be a non-empty string.'));
    } else if (ids.has(region.id)) {
      errors.push(issue('GEOMETRY_METRIC_REGION_ID_DUPLICATE', `${path}.id`, `Duplicate region id: ${region.id}.`));
    } else {
      ids.add(region.id);
    }
    const validated = validateAreaInput({
      geometry: region?.geometry,
      holes: region?.holes ?? [],
      coordinateSpace: input?.coordinateSpace,
    }, resolved.options);
    errors.push(...validated.errors.map(error => ({
      ...error,
      path: `${path}.${error.path}`,
    })));
    warnings.push(...validated.warnings.map(warning => ({
      ...warning,
      path: `${path}.${warning.path}`,
    })));
    return { id: region?.id, geometry: validated.geometry, holes: validated.holes };
  }).sort((left, right) => compareCanonicalStrings(String(left.id), String(right.id)));
  if (errors.length) return result(false, null, errors, warnings);
  const sets = disjointSet(regions.map(region => region.id));
  const explicitHoleExclusions = [];
  for (let first = 0; first < regions.length; first += 1) {
    for (let second = first + 1; second < regions.length; second += 1) {
      const a = regions[first];
      const b = regions[second];
      const aInB = containingHole(a, b, resolved.options.boundaryToleranceMm);
      const bInA = containingHole(b, a, resolved.options.boundaryToleranceMm);
      if (aInB >= 0 || bInA >= 0) {
        explicitHoleExclusions.push({
          regionAId: a.id,
          regionBId: b.id,
          containerRegionId: aInB >= 0 ? b.id : a.id,
          holeIndex: aInB >= 0 ? aInB : bInA,
        });
      } else if (regionsConnected(a, b, resolved.options.boundaryToleranceMm)) {
        sets.union(a.id, b.id);
      }
    }
  }
  const groups = new Map();
  regions.forEach(region => {
    const root = sets.find(region.id);
    groups.set(root, [...(groups.get(root) || []), region.id]);
  });
  const components = [...groups.values()]
    .map(memberRegionIds => memberRegionIds.sort(compareCanonicalStrings))
    .sort((left, right) => compareCanonicalStrings(left[0], right[0]))
    .map((memberRegionIds, index) => ({
      id: `component-${String(index + 1).padStart(4, '0')}`,
      memberRegionIds,
    }));
  const regionToComponent = Object.fromEntries(components.flatMap(component =>
    component.memberRegionIds.map(regionId => [regionId, component.id])));
  return result(true, {
    components,
    regionToComponent,
    explicitHoleExclusions,
    method: 'hole_aware_pairwise_union_find',
    unionGeometryProduced: false,
  }, [], warnings, 'regions');
}
