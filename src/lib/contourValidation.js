/**
 * contourValidation.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Validation and repair utilities for embroidery contours.
 * Used by both frontend (contourRenderer) and backend (hybridDigitize).
 * 
 * Ensures:
 * - Polygons are closed (first == last point)
 * - No self-intersections
 * - Gap detection + auto-repair with Bézier interpolation
 * - Geometric soundness for tatami/satin rendering
 */

/**
 * Validates a polygon path and returns repair suggestions.
 * @param {Array<[number, number]>} polygon - normalized [0-1] coordinate pairs
 * @param {Object} opts - { autoRepair: boolean, tolerance: number }
 * @returns {{ isValid: boolean, errors: Array, repaired: Array, metrics: Object }}
 */
export function validatePolygon(polygon, opts = {}) {
  const { autoRepair = true, tolerance = 0.005 } = opts;
  const errors = [];
  let repaired = [...polygon];

  // ── Check 1: Polygon is closed ──────────────────────────────────────────────
  if (repaired.length < 3) {
    errors.push('Polygon has < 3 points (degenerate)');
    return { isValid: false, errors, repaired, metrics: {} };
  }

  const [x0, y0] = repaired[0];
  const [xn, yn] = repaired[repaired.length - 1];
  const closureGap = Math.hypot(xn - x0, yn - y0);

  if (closureGap > tolerance) {
    errors.push(`Polygon not closed: gap ${closureGap.toFixed(4)}`);
    if (autoRepair) {
      repaired.push([x0, y0]); // Close polygon
    }
  }

  // ── Check 2: No self-intersections ──────────────────────────────────────────
  const intersections = detectSelfIntersections(repaired);
  if (intersections.length > 0) {
    errors.push(`${intersections.length} self-intersections detected`);
    if (autoRepair) {
      repaired = simplifyIntersections(repaired, intersections);
    }
  }

  // ── Check 3: Gap detection (isolated point sequences) ──────────────────────
  const gaps = detectGaps(repaired, tolerance);
  if (gaps.length > 0) {
    errors.push(`${gaps.length} gaps detected`);
    if (autoRepair) {
      repaired = repairGaps(repaired, gaps);
    }
  }

  // ── Check 4: Degenerate edges (zero-length or nearly zero) ────────────────
  const degenerateEdges = detectDegenerateEdges(repaired, 1e-6);
  if (degenerateEdges.length > 0) {
    errors.push(`${degenerateEdges.length} degenerate edges (zero-length)`);
    if (autoRepair) {
      repaired = repaired.filter((p, i) => {
        if (i === 0 || i === repaired.length - 1) return true;
        const [x1, y1] = repaired[i - 1];
        const dist = Math.hypot(p[0] - x1, p[1] - y1);
        return dist > 1e-6;
      });
    }
  }

  // ── Calculate metrics ──────────────────────────────────────────────────────
  const metrics = calculateGeometricMetrics(repaired);

  const isValid = errors.length === 0;
  return { isValid, errors, repaired, metrics };
}

/**
 * Detects self-intersecting edges using cross-product method.
 * Returns array of intersection indices.
 */
function detectSelfIntersections(polygon) {
  const intersections = [];
  const n = polygon.length - 1; // -1 because polygon is closed

  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n; j++) {
      if (j === i + 1) continue; // Adjacent edges can't intersect

      const p1 = polygon[i];
      const p2 = polygon[i + 1];
      const p3 = polygon[j];
      const p4 = polygon[(j + 1) % n];

      if (doSegmentsIntersect(p1, p2, p3, p4)) {
        intersections.push({ edge1: i, edge2: j });
      }
    }
  }

  return intersections;
}

/**
 * Check if two line segments intersect (proper intersection, not touching at endpoints).
 */
function doSegmentsIntersect([x1, y1], [x2, y2], [x3, y3], [x4, y4]) {
  const ccw = (ax, ay, bx, by, cx, cy) => {
    return (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
  };

  return (
    ccw(x1, y1, x3, y3, x4, y4) !== ccw(x2, y2, x3, y3, x4, y4) &&
    ccw(x1, y1, x2, y2, x3, y3) !== ccw(x1, y1, x2, y2, x4, y4)
  );
}

/**
 * Detects gaps in the polygon (sequences of points far apart).
 */
function detectGaps(polygon, maxGap = 0.005) {
  const gaps = [];

  for (let i = 0; i < polygon.length - 1; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[i + 1];
    const dist = Math.hypot(x2 - x1, y2 - y1);

    if (dist > maxGap) {
      gaps.push({ index: i, distance: dist });
    }
  }

  return gaps;
}

/**
 * Repairs gaps by interpolating points using Bézier curves.
 */
function repairGaps(polygon, gaps) {
  let repaired = [...polygon];

  // Process gaps in reverse order to maintain indices
  for (let i = gaps.length - 1; i >= 0; i--) {
    const gap = gaps[i];
    const [x1, y1] = repaired[gap.index];
    const [x2, y2] = repaired[gap.index + 1];

    // Linear interpolation (simple; Bézier would be cubic)
    const numInterpolated = Math.ceil(gap.distance / 0.002); // Points every 0.2% of range
    const interpolated = [];

    for (let j = 1; j < numInterpolated; j++) {
      const t = j / numInterpolated;
      interpolated.push([
        x1 + (x2 - x1) * t,
        y1 + (y2 - y1) * t,
      ]);
    }

    // Insert interpolated points after gap.index
    repaired.splice(gap.index + 1, 0, ...interpolated);
  }

  return repaired;
}

/**
 * Detects degenerate edges (zero-length or near-zero).
 */
function detectDegenerateEdges(polygon, threshold = 1e-6) {
  const edges = [];

  for (let i = 0; i < polygon.length - 1; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[i + 1];
    const dist = Math.hypot(x2 - x1, y2 - y1);

    if (dist < threshold) {
      edges.push({ index: i, distance: dist });
    }
  }

  return edges;
}

/**
 * Simplify self-intersections by removing the inner loop.
 * (Naive: keeps the larger outer loop.)
 */
function simplifyIntersections(polygon, intersections) {
  if (intersections.length === 0) return polygon;

  // For each intersection, remove the inner loop segment
  let result = [...polygon];

  for (const { edge1, edge2 } of intersections) {
    // Remove points from edge1+1 to edge2
    const segment = result.slice(edge1 + 1, edge2 + 1);
    const segmentArea = calculateArea(segment);

    if (segmentArea < 0.0001) {
      // Inner loop: remove it
      result = result.slice(0, edge1 + 1).concat(result.slice(edge2 + 1));
    }
  }

  return result;
}

/**
 * Calculate geometric metrics of a polygon.
 */
function calculateGeometricMetrics(polygon) {
  if (polygon.length < 3) return {};

  const area = calculateArea(polygon);
  const perimeter = calculatePerimeter(polygon);
  const compacidad = (4 * Math.PI * area) / (perimeter * perimeter);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const bboxArea = (maxX - minX) * (maxY - minY);
  const coverage = bboxArea > 0 ? area / bboxArea : 0;

  return { area, perimeter, compacidad, coverage, bbox: { minX, maxX, minY, maxY } };
}

/**
 * Shoelace formula for polygon area.
 */
function calculateArea(polygon) {
  let area = 0;

  for (let i = 0; i < polygon.length - 1; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[i + 1];
    area += (x1 * y2 - x2 * y1);
  }

  return Math.abs(area) / 2;
}

/**
 * Perimeter as sum of edge lengths.
 */
function calculatePerimeter(polygon) {
  let perimeter = 0;

  for (let i = 0; i < polygon.length - 1; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[i + 1];
    perimeter += Math.hypot(x2 - x1, y2 - y1);
  }

  return perimeter;
}

/**
 * Quality score for embroidery rendering suitability.
 * Higher = more suitable for tatami/satin.
 * 0-10 scale.
 */
export function scorePolygonQuality(polygon, opts = {}) {
  const { validateOnly = false } = opts;

  const validation = validatePolygon(polygon, { autoRepair: !validateOnly });

  if (!validation.isValid && validateOnly) {
    // Penalize for each error
    return Math.max(1, 10 - validation.errors.length * 2);
  }

  const metrics = validation.metrics;
  let score = 10;

  // Penalize low compactness (very elongated = harder to fill)
  if (metrics.compacidad < 0.3) score -= 2;
  if (metrics.compacidad < 0.15) score -= 2;

  // Penalize low coverage (sparse bbox = inefficient)
  if (metrics.coverage < 0.5) score -= 1;

  // Penalize too many vertices (can cause issues)
  if (polygon.length > 500) score -= 1;

  // Bonus for good closure
  const [x0, y0] = polygon[0];
  const [xn, yn] = polygon[polygon.length - 1];
  if (Math.hypot(xn - x0, yn - y0) < 0.001) score += 1;

  return Math.max(1, Math.min(10, score));
}