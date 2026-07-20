/**
 * ce01FinalCommandRepair.js — Local repair of commands outside region boundaries
 * ─────────────────────────────────────────────────────────────────────────────
 * Acts on finalEmbroideryCommands ONLY. Never modifies regions, vectors, or
 * visual state. Runs AFTER autoFix and BEFORE ce01CommandSanitizer.
 *
 * Repair strategy per outside-region stitch:
 *   1. Close to border (<0.35mm): project towards polygon interior
 *   2. Segment crosses outside: convert connection to jump
 *   3. Clearly outside + redundant: remove
 *   4. Removal breaks continuity: replace with jump + tie-in
 *
 * Transactional: computes metrics before/after, applies ONLY if all conditions met.
 */

import { validateCE01 } from './ce01Validator.js';

const INSET_DIST = 0.35; // mm — projection inset from border
const LONG_STITCH = 8.0; // mm
const SHORT_STITCH = 0.8; // mm

// ─── Geometry helpers ────────────────────────────────────────────────────────

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToPolygonEdge(x, y, polygon) {
  let minDist = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const d = distToSegment(x, y, xi, yi, xj, yj);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function projectInside(x, y, polygon, inset = INSET_DIST) {
  // Compute centroid
  let cx = 0, cy = 0;
  for (const [px, py] of polygon) { cx += px; cy += py; }
  cx /= polygon.length;
  cy /= polygon.length;

  const dx = cx - x;
  const dy = cy - y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.01) return [cx, cy];

  // Move towards centroid by edgeDist + inset
  const edgeDist = distToPolygonEdge(x, y, polygon);
  const moveDist = edgeDist + inset;

  for (let factor = 1; factor <= 6; factor += 0.5) {
    const nx = x + (dx / dist) * (moveDist * factor);
    const ny = y + (dy / dist) * (moveDist * factor);
    if (pointInPolygon(nx, ny, polygon)) return [nx, ny];
  }

  // Last resort: centroid
  return [cx, cy];
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function calculateCommandMetrics(commands, polygonMap) {
  let stitches = 0, jumps = 0, trims = 0;
  let longStitches = 0, shortStitches = 0, duplicateStitches = 0;
  let outsideRegion = 0;
  let prevX = 0, prevY = 0;
  const seen = new Set();

  for (const c of commands) {
    if (!c || !c.type) continue;
    if (c.type === 'stitch') {
      stitches++;
      const dist = Math.hypot(c.x - prevX, c.y - prevY);
      if (dist > LONG_STITCH) longStitches++;
      if (dist > 0 && dist < SHORT_STITCH) shortStitches++;

      const key = `${c.x.toFixed(2)},${c.y.toFixed(2)}`;
      if (seen.has(key)) duplicateStitches++;
      else seen.add(key);

      // Check outside region
      const poly = c.regionId ? polygonMap.get(c.regionId) : null;
      if (poly && !pointInPolygon(c.x, c.y, poly)) outsideRegion++;
    }
    if (c.type === 'jump') jumps++;
    if (c.type === 'trim') trims++;
    if (c.x !== undefined && Number.isFinite(c.x)) { prevX = c.x; prevY = c.y; }
  }

  return { stitches, jumps, trims, longStitches, shortStitches, duplicateStitches, outsideRegion };
}

// ─── Main repair function ─────────────────────────────────────────────────────

/**
 * @param {Array}  commands  — final flat command sequence
 * @param {Array}  regions   — visual regions (for polygon boundaries)
 * @param {Object} options   — { config, machineSettings, objects }
 * @returns {{ commands, applied, report }}
 */
export function repairCE01FinalCommands(commands, regions, options = {}) {
  const config = options.config || {};
  const ms = options.machineSettings || {};
  const w = config.width_mm || 100;
  const h = config.height_mm || 100;

  // Build polygon map: regionId → mm polygon
  const polygonMap = new Map();
  for (const r of regions) {
    if (!r.path_points || r.path_points.length < 3) continue;
    const mmPoints = r.path_points.map(([nx, ny]) => [
      (nx - 0.5) * w,
      (ny - 0.5) * h,
    ]);
    polygonMap.set(r.id, mmPoints);
  }

  // ── Before metrics ────────────────────────────────────────────────────
  const metricsBefore = calculateCommandMetrics(commands, polygonMap);
  console.log(`[ce01-final-repair] outside before: ${metricsBefore.outsideRegion}`);

  // CE01 score before (if objects available)
  let ce01Before = null;
  if (options.objects) {
    try {
      ce01Before = validateCE01(commands, options.objects, regions, config, ms);
    } catch (e) {
      console.warn('[ce01-final-repair] CE01 before validation failed:', e.message);
    }
  }

  // ── Repair ────────────────────────────────────────────────────────────
  let projectedPoints = 0;
  let removedPoints = 0;
  let convertedToJumps = 0;
  let candidate = commands.map(c => ({ ...c }));

  for (let i = 0; i < candidate.length; i++) {
    const c = candidate[i];
    if (!c || c.type !== 'stitch') continue;
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;

    const poly = c.regionId ? polygonMap.get(c.regionId) : null;
    if (!poly) continue;

    // Already inside — don't touch
    if (pointInPolygon(c.x, c.y, poly)) continue;

    // ── Outside! Determine repair strategy ──────────────────────────────
    const edgeDist = distToPolygonEdge(c.x, c.y, poly);

    if (edgeDist <= INSET_DIST) {
      // Case 1: Close to border — project inside
      const [nx, ny] = projectInside(c.x, c.y, poly, INSET_DIST);
      candidate[i] = { ...c, x: nx, y: ny };
      projectedPoints++;
    } else {
      // Case 2/3: Clearly outside
      const prev = i > 0 ? candidate[i - 1] : null;
      const next = i < candidate.length - 1 ? candidate[i + 1] : null;

      const prevIsStitch = prev && prev.type === 'stitch' && Number.isFinite(prev.x);
      const nextIsStitch = next && next.type === 'stitch' && Number.isFinite(next.x);
      const prevInside = prevIsStitch && pointInPolygon(prev.x, prev.y, poly);
      const nextInside = nextIsStitch && pointInPolygon(next.x, next.y, poly);

      if (prevInside && nextInside) {
        // Segment crosses outside — convert to jump (don't stitch through)
        candidate[i] = { ...c, type: 'jump' };
        convertedToJumps++;
      } else if (!prevIsStitch && !nextIsStitch) {
        // Redundant — both neighbors are non-stitch — remove
        candidate[i] = null;
        removedPoints++;
      } else if (prevIsStitch && !nextIsStitch) {
        // Last stitch before a jump/trim — try projecting, else remove
        const [nx, ny] = projectInside(c.x, c.y, poly, INSET_DIST);
        candidate[i] = { ...c, x: nx, y: ny };
        projectedPoints++;
      } else if (!prevIsStitch && nextIsStitch) {
        // First stitch after a jump — try projecting
        const [nx, ny] = projectInside(c.x, c.y, poly, INSET_DIST);
        candidate[i] = { ...c, x: nx, y: ny };
        projectedPoints++;
      } else {
        // Both neighbors are stitches but at least one is outside too — remove
        candidate[i] = null;
        removedPoints++;
      }
    }
  }

  // Remove nulls
  candidate = candidate.filter(c => c !== null);

  console.log(`[ce01-final-repair] projected points: ${projectedPoints}`);
  console.log(`[ce01-final-repair] removed points: ${removedPoints}`);
  console.log(`[ce01-final-repair] converted to jumps: ${convertedToJumps}`);

  // ── After metrics ─────────────────────────────────────────────────────
  const metricsAfter = calculateCommandMetrics(candidate, polygonMap);
  console.log(`[ce01-final-repair] outside after: ${metricsAfter.outsideRegion}`);

  // CE01 score after
  let ce01After = null;
  if (options.objects) {
    try {
      ce01After = validateCE01(candidate, options.objects, regions, config, ms);
    } catch (e) {
      console.warn('[ce01-final-repair] CE01 after validation failed:', e.message);
    }
  }

  // ── Decision: apply only if ALL conditions met ────────────────────────
  const conditions = {
    outsideDown: metricsAfter.outsideRegion < metricsBefore.outsideRegion,
    longNotUp: metricsAfter.longStitches <= metricsBefore.longStitches,
    dupNotUp: metricsAfter.duplicateStitches <= metricsBefore.duplicateStitches,
    jumpsOk: metricsAfter.jumps <= metricsBefore.jumps + 10,
    trimsOk: metricsAfter.trims <= metricsBefore.trims + 10,
    ce01Ok: !ce01Before || !ce01After || ce01After.score >= ce01Before.score,
  };

  const allPass = Object.values(conditions).every(v => v === true);

  if (!allPass) {
    const failed = Object.entries(conditions).filter(([, v]) => !v).map(([k]) => k);
    const reason = `Conditions failed: ${failed.join(', ')}`;
    console.log(`[ce01-final-repair] discarded reason: ${reason}`);
    return {
      commands: commands, // Return original
      applied: false,
      report: {
        outsideBefore: metricsBefore.outsideRegion,
        outsideAfter: metricsAfter.outsideRegion,
        projectedPoints,
        removedPoints,
        convertedToJumps,
        discarded: true,
        reason,
        metricsBefore,
        metricsAfter,
      },
    };
  }

  console.log(`[ce01-final-repair] applied: true`);
  return {
    commands: candidate,
    applied: true,
    report: {
      outsideBefore: metricsBefore.outsideRegion,
      outsideAfter: metricsAfter.outsideRegion,
      projectedPoints,
      removedPoints,
      convertedToJumps,
      discarded: false,
      reason: null,
      metricsBefore,
      metricsAfter,
    },
  };
}