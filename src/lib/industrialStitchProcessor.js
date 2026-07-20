/**
 * Industrial Stitch Processor — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Enhances stitch sequences for MACHINE STABILITY over aesthetics.
 *
 * Features:
 *   1. Redundant node elimination — remove consecutive duplicate points
 *   2. Mandatory underlay — grid foundation for fill/satin objects
 *   3. Tie-in / tie-off — locking stitches at start/end of every object
 *   4. Constant density normalization — consistent stitch spacing
 *   5. Color-grouped path optimization — nearest-neighbor within each color
 *   6. Clipped scanline fill — polygon-accurate fill stitches (no bbox overflow)
 */

import { generateClippedFillStitches, validateFillPoints } from './clippedFillGenerator.js';

// ─── Physical constants (mm) — tuned for home machines (Caydo CE01) ──────────
const TIE_SIZE = 0.5;           // locking stitch length
const UNDERLAY_SPACING = 2.5;   // row spacing for grid underlay (medium-low density)
const UNDERLAY_INSET = 0.5;     // inset from object bounding box
const DENSITY_TARGET = 3.5;     // target stitch spacing (constant, medium-low)
const SIMPLIFY_EPSILON = 1.0;   // RDP tolerance — remove micro-details <1mm
const CURVE_SPACING_MIN = 2.0;  // minimum spacing between curve points (prevent accumulation)
const EDGE_RUN_INSET = 0.4;     // edge-walk underlay inset from perimeter

// ═══════════════════════════════════════════════════════════════════════════
//  NODE CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Remove consecutive duplicate / near-duplicate points below tolerance.
 * Aggressive for home machines: 1mm minimum node spacing.
 */
export function removeRedundantNodes(points, tolerance = 1.0) {
  if (!points || points.length < 2) return points || [];
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const dist = Math.hypot(points[i][0] - prev[0], points[i][1] - prev[1]);
    if (dist >= tolerance) result.push(points[i]);
  }
  return result;
}

/**
 * RDP (Ramer-Douglas-Peucker) simplification — removes micro-details < epsilon.
 * Converts complex curves to minimal straight segments for machine stability.
 * NO Bézier curves — only simple line segments that any home machine can sew.
 */
export function simplifyGeometry(points, epsilon = SIMPLIFY_EPSILON) {
  if (!points || points.length < 3) return points || [];
  // Find point with max perpendicular distance from line start→end
  const [sx, sy] = points[0];
  const [ex, ey] = points[points.length - 1];
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], [sx, sy], [ex, ey]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    // Recursively simplify both halves
    const left = simplifyGeometry(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyGeometry(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  // All points within epsilon of the line — keep only endpoints
  return [[sx, sy], [ex, ey]];
}

function perpendicularDist(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
}

/**
 * Decimate curve points — enforce constant minimum spacing between points.
 * Prevents point accumulation in curves (a major cause of machine jams).
 * Removes any point that is closer than CURVE_SPACING_MIN to the previous kept point.
 */
export function decimateCurvePoints(points, minSpacing = CURVE_SPACING_MIN) {
  if (!points || points.length < 2) return points || [];
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const dist = Math.hypot(points[i][0] - prev[0], points[i][1] - prev[1]);
    if (dist >= minSpacing) result.push(points[i]);
  }
  // Always keep last point
  const last = points[points.length - 1];
  const lastKept = result[result.length - 1];
  if (Math.hypot(last[0] - lastKept[0], last[1] - lastKept[1]) > 0.1) {
    result.push(last);
  }
  return result;
}

/**
 * Normalize density: insert intermediate points where gaps exceed 1.5× target.
 * Ensures constant stitch spacing across the entire path.
 */
export function normalizeDensity(points, targetSpacing = DENSITY_TARGET) {
  if (!points || points.length < 2) return points || [];
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [px, py] = result[result.length - 1];
    const [cx, cy] = points[i];
    const dist = Math.hypot(cx - px, cy - py);
    if (dist > targetSpacing * 1.5) {
      const steps = Math.ceil(dist / targetSpacing);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        result.push([px + (cx - px) * t, py + (cy - py) * t]);
      }
    }
    result.push(points[i]);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TIE-IN / TIE-OFF (locking stitches)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tie-in: 4 small locking stitches at the start of an object.
 * Prevents thread from unraveling at the beginning of a sew block.
 */
export function generateTieIn(startPoint) {
  const [x, y] = startPoint;
  return [
    [x, y],
    [x + TIE_SIZE, y + TIE_SIZE * 0.3],
    [x - TIE_SIZE * 0.3, y + TIE_SIZE * 0.3],
    [x + TIE_SIZE * 0.5, y],
  ];
}

/**
 * Tie-off: 4 small locking stitches at the end of an object.
 * Secures thread before trim or color change.
 */
export function generateTieOff(endPoint) {
  const [x, y] = endPoint;
  return [
    [x + TIE_SIZE, y],
    [x - TIE_SIZE * 0.3, y + TIE_SIZE * 0.3],
    [x + TIE_SIZE, y + TIE_SIZE * 0.3],
    [x, y],
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
//  UNDERLAY (mandatory foundation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Edge-run underlay — walks the object perimeter at a small inset.
 * This is the FIRST underlay layer: stabilizes the edge and prevents shifting.
 * Mandatory for all fill/satin objects on home machines.
 */
export function generateEdgeRunUnderlay(points) {
  if (!points || points.length < 3) return [];
  // Compute centroid for inset direction
  let cx = 0, cy = 0;
  for (const [x, y] of points) { cx += x; cy += y; }
  cx /= points.length; cy /= points.length;

  // Inset each point towards centroid by EDGE_RUN_INSET
  const inset = points.map(([x, y]) => {
    const dx = cx - x, dy = cy - y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return [x, y];
    return [x + (dx / len) * EDGE_RUN_INSET, y + (dy / len) * EDGE_RUN_INSET];
  });

  // Walk perimeter (closed loop)
  return [...inset, inset[0]];
}

/**
 * Grid underlay — boustrophedon fill inside the object's bbox.
 * Second underlay layer: provides structural foundation for fill stitches.
 * Medium-low density spacing for home machine stability.
 */
export function generateGridUnderlay(obj) {
  const pts = obj.points;
  if (!pts || pts.length < 3) return [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  minX += UNDERLAY_INSET;
  minY += UNDERLAY_INSET;
  maxX -= UNDERLAY_INSET;
  maxY -= UNDERLAY_INSET;
  if (maxX <= minX || maxY <= minY) return [];

  const underlayPoints = [];
  let y = minY;
  let flip = false;
  while (y <= maxY) {
    if (flip) {
      underlayPoints.push([maxX, y]);
      underlayPoints.push([minX, y]);
    } else {
      underlayPoints.push([minX, y]);
      underlayPoints.push([maxX, y]);
    }
    flip = !flip;
    y += UNDERLAY_SPACING;
  }
  return underlayPoints;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PATH OPTIMIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Optimize object order: group by color, then sort interior→exterior,
 * then nearest-neighbor within each spatial layer.
 *
 * Rules enforced:
 *   - Color grouping (minimize thread changes)
 *   - Interior objects first, exterior last (structural order)
 *   - Nearest-neighbor within each layer (minimize travel)
 */
export function optimizeObjectOrder(objects) {
  if (!objects || objects.length <= 1) return objects || [];

  // Compute centroid of all objects (design center)
  let gcx = 0, gcy = 0, count = 0;
  for (const obj of objects) {
    if (!obj.points || obj.points.length === 0) continue;
    let cx = 0, cy = 0;
    for (const [x, y] of obj.points) { cx += x; cy += y; }
    cx /= obj.points.length; cy /= obj.points.length;
    obj._centroid = [cx, cy];
    gcx += cx; gcy += cy; count++;
  }
  if (count === 0) return objects;
  gcx /= count; gcy /= count;

  // ── Priority-layered ordering ───────────────────────────────────────────
  // Sort by priority FIRST (fills=2 → micro_fills=4 → details=5 → inner=6 → outer=7)
  // This ensures embroidery order: fills before details before outlines.
  // Within each priority layer: group by color, then nearest-neighbor.
  const priorityLayers = new Map();
  for (const obj of objects) {
    const p = obj.priority || 5;
    if (!priorityLayers.has(p)) priorityLayers.set(p, []);
    priorityLayers.get(p).push(obj);
  }

  const ordered = [];
  let lastPos = [0, 0];

  const sortedPriorities = [...priorityLayers.keys()].sort((a, b) => a - b);
  for (const pri of sortedPriorities) {
    const layer = priorityLayers.get(pri);

    // Group by color (within priority layer)
    const colorGroups = new Map();
    for (const obj of layer) {
      const color = obj.color || '#000000';
      if (!colorGroups.has(color)) colorGroups.set(color, []);
      colorGroups.get(color).push(obj);
    }

    for (const [, group] of colorGroups) {
      // Sort by centroid distance from design center (interior first)
      const sorted = [...group].sort((a, b) => {
        const da = a._centroid ? Math.hypot(a._centroid[0] - gcx, a._centroid[1] - gcy) : Infinity;
        const db = b._centroid ? Math.hypot(b._centroid[0] - gcx, b._centroid[1] - gcy) : Infinity;
        return da - db;
      });

      // Nearest-neighbor within spatial layer
      const remaining = [...sorted];
      while (remaining.length > 0) {
        let bestIdx = 0, bestDist = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const pts = remaining[i].points;
          if (!pts || pts.length === 0) continue;
          const d = Math.hypot(pts[0][0] - lastPos[0], pts[0][1] - lastPos[1]);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        const next = remaining.splice(bestIdx, 1)[0];
        ordered.push(next);
        if (next.points && next.points.length > 0) {
          lastPos = next.points[next.points.length - 1];
        }
      }
    }
  }

  return ordered;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FULL OBJECT PROCESSING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process a single object into home-machine-grade stitch points.
 *
 * Pipeline (strict order):
 *   1. Remove redundant nodes (≥1mm spacing)
 *   2. RDP simplification (remove micro-details <1mm, convert to simple segments)
 *   3. Decimate curve points (prevent accumulation, enforce ≥2mm spacing)
 *   4. Normalize density (constant 3.5mm stitch spacing)
 *   5. Tie-in (locking stitches)
 *   6. Edge-run underlay (perimeter walk — mandatory for fill/satin)
 *   7. Grid underlay (boustrophedon — mandatory for fill/satin)
 *   8. Main stitches
 *   9. Tie-off (locking stitches)
 *
 * @param {Object} obj — stitch object with points, stitch_type, etc.
 * @param {Object} machine — machine settings (uses minStitchLength)
 * @returns {Array<[number, number]>} stitch points in mm
 */
export function processObjectStitches(obj, machine) {
  const ms = machine;
  const rawPoints = obj.points || [];
  if (rawPoints.length < 2) return [];

  // 1. Remove redundant nodes (aggressive 1mm tolerance for home machines)
  const cleaned = removeRedundantNodes(rawPoints, 1.0);
  if (cleaned.length < 2) return [];

  // 2. RDP simplification — convert to minimal simple segments, no micro-details
  const simplified = simplifyGeometry(cleaned, SIMPLIFY_EPSILON);
  if (simplified.length < 2) return [];

  // 3. Decimate curve points — prevent point accumulation in curves
  const decimated = decimateCurvePoints(simplified, CURVE_SPACING_MIN);
  if (decimated.length < 2) return [];

  // 4. Normalize density — constant stitch spacing
  const normalized = normalizeDensity(decimated, DENSITY_TARGET);
  if (normalized.length < 2) return [];

  const result = [];

  // 5. Tie-in (locking stitches at start)
  result.push(...generateTieIn(normalized[0]));

  // 6-7. Underlay: edge-run for fill/satin; grid underlay for satin only
  //      (fill uses clipped scanline fill as main stitches — no bbox grid)
  if (obj.stitch_type === 'fill' || obj.stitch_type === 'satin') {
    const edgeRun = generateEdgeRunUnderlay(simplified);
    if (edgeRun.length > 0) result.push(...edgeRun);
    if (obj.stitch_type === 'satin') {
      const grid = generateGridUnderlay(obj);
      if (grid.length > 0) result.push(...grid);
    }
  }

  // 8. Main stitches
  if (obj.stitch_type === 'fill') {
    // Clipped scanline fill — stitches inside polygon only
    const safeMode = obj.ce01SafeFillMode === true;
    let fillPoints = generateClippedFillStitches(obj.points, {
      densityMm: obj.density || 0.4,
      stitchLenMm: 3.0,
      angleDeg: obj.angle ?? 45,
      regionId: obj.id,
      ce01SafeFillMode: safeMode,
    });

    // Auto-fallback: if normal mode produces bad metrics, regenerate in safe mode
    if (!safeMode && fillPoints.length > 0) {
      const m = validateFillPoints(fillPoints, obj.points);
      if (m.jumps > 80 || m.outsideRegion > 20 || m.longStitches > 20 || m.stitches > 2000) {
        console.log(`[ce01-safe-fill] Auto-fallback for region ${obj.id}: jumps=${m.jumps} outside=${m.outsideRegion} long=${m.longStitches} stitches=${m.stitches}`);
        fillPoints = generateClippedFillStitches(obj.points, {
          densityMm: 0.65,
          stitchLenMm: 3.5,
          angleDeg: obj.angle ?? 45,
          regionId: obj.id,
          ce01SafeFillMode: true,
        });
      }
    }

    if (fillPoints.length > 0) {
      result.push(...fillPoints);
    } else {
      // Fallback: polygon boundary if scanline fails (tiny region)
      result.push(...normalized);
    }
  } else {
    // Satin / running: constant density path along polygon
    result.push(...normalized);
  }

  // 9. Tie-off (locking stitches at end)
  result.push(...generateTieOff(normalized[normalized.length - 1]));

  return result;
}