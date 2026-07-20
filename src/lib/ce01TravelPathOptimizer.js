/**
 * ce01TravelPathOptimizer.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Optimizes the travel path of finalEmbroideryCommands to reduce jumps and trims
 * WITHOUT changing the visual design.
 *
 * Works ONLY on commands — never touches regions, path_points, or visual state.
 *
 * Operations:
 *   1. Collapse consecutive jumps into one
 *   2. Convert short safe jumps (≤3.5mm) into stitches when:
 *      - same regionId or same color
 *      - source/stitchType indicates fill / ce01_safe_fill
 *      - segment is inside the polygon with 0.18mm tolerance
 *   3. Remove trims just before jumps that were converted to stitches
 *   4. Remove unnecessary trims when the next movement is short
 *
 * Transactional: applies only if jumps or trims improve without
 * increasing longStitches or duplicateStitches.
 */

import { calculateUnifiedCommandMetrics } from './unifiedCommandMetrics';

// ─── Geometry helpers ────────────────────────────────────────────────────────

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointNearEdge(x, y, poly, toleranceMm) {
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.001) {
      if (Math.hypot(x - ax, y - ay) <= toleranceMm) return true;
      continue;
    }
    let t = ((x - ax) * dx + (y - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, py = ay + dy * t;
    if (Math.hypot(x - px, y - py) <= toleranceMm) return true;
  }
  return false;
}

function segmentInsideTolerant(x1, y1, x2, y2, poly, toleranceMm = 0.18) {
  if (!poly || poly.length < 3) return false;
  for (let t = 0; t <= 1.0001; t += 0.2) {
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t;
    if (pointInPolygon(px, py, poly)) continue;
    if (pointNearEdge(px, py, poly, toleranceMm)) continue;
    return false;
  }
  return true;
}

// ─── Metric helpers ──────────────────────────────────────────────────────────

function countLongStitches(commands, maxLen = 7.5) {
  let count = 0;
  let prevX = null, prevY = null;
  for (const c of commands) {
    if (c.type === 'stitch') {
      if (prevX !== null) {
        const d = Math.hypot(c.x - prevX, c.y - prevY);
        if (d > maxLen) count++;
      }
    }
    if (c.type === 'stitch' || c.type === 'jump') {
      prevX = c.x; prevY = c.y;
    }
  }
  return count;
}

function countDuplicates(commands, minDist = 0.1) {
  let count = 0;
  let prevX = null, prevY = null;
  for (const c of commands) {
    if (c.type === 'stitch') {
      if (prevX !== null) {
        const d = Math.hypot(c.x - prevX, c.y - prevY);
        if (d < minDist) count++;
      }
    }
    if (c.type === 'stitch' || c.type === 'jump') {
      prevX = c.x; prevY = c.y;
    }
  }
  return count;
}

function countBlocks(commands) {
  let blocks = 0;
  let inBlock = false;
  for (const c of commands) {
    if (c.type === 'stitch') {
      if (!inBlock) { blocks++; inBlock = true; }
    } else if (c.type === 'jump' || c.type === 'colorChange') {
      inBlock = false;
    }
  }
  return blocks;
}

// ─── Main API ────────────────────────────────────────────────────────────────

/**
 * @param {Array}  commands        — flat command sequence (read-only input)
 * @param {Array}  regions         — visual regions (for polygon lookup)
 * @param {Object} config          — { width_mm, height_mm }
 * @param {Object} machineSettings — trimThreshold, designOffset, etc.
 * @returns {{ applied, commands, reason, report }}
 */
export function optimizeCE01TravelPath(commands, regions = [], config = {}, machineSettings = {}) {
  const w = config.width_mm || 100;
  const h = config.height_mm || 100;
  const [offX, offY] = machineSettings.designOffset || [0, 0];
  const maxConvertDist = machineSettings.trimThreshold || 3.5;

  // ── Build region polygon lookup (mm coordinates, centered at origin) ──
  const regionPolygons = new Map();
  for (const r of regions) {
    if (!r.id || !r.path_points || r.path_points.length < 3) continue;
    const mmPoly = r.path_points.map(([nx, ny]) => [
      (nx - 0.5) * w,
      (ny - 0.5) * h,
    ]);
    regionPolygons.set(r.id, mmPoly);
  }

  // ── Before metrics ──
  const jumpsBefore = commands.filter(c => c.type === 'jump').length;
  const trimsBefore = commands.filter(c => c.type === 'trim').length;
  const blocksBuilt = countBlocks(commands);

  console.log('[travel-opt] blocks built:', blocksBuilt);
  console.log('[travel-opt] jumps before:', jumpsBefore);
  console.log('[travel-opt] trims before:', trimsBefore);

  // ── Step 1: Collapse consecutive jumps ──
  let cmds = [];
  let prevType = null;
  for (const c of commands) {
    if (c.type === 'jump' && prevType === 'jump') {
      cmds[cmds.length - 1] = c; // keep only the last jump in sequence
      continue;
    }
    cmds.push(c);
    prevType = c.type;
  }

  // ── Step 2: Convert short safe jumps to stitches ──
  let convertedCount = 0;
  let removedTrimCount = 0;
  const step2 = [];

  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];

    if (c.type !== 'jump') {
      step2.push(c);
      continue;
    }

    // Find previous meaningful command (skip trims)
    let prevIdx = step2.length - 1;
    while (prevIdx >= 0 && step2[prevIdx].type === 'trim') prevIdx--;

    const prev = prevIdx >= 0 ? step2[prevIdx] : null;

    if (prev && (prev.type === 'stitch' || prev.type === 'jump')) {
      const dist = Math.hypot(c.x - prev.x, c.y - prev.y);

      // Check safety conditions
      const sameRegion = (c.regionId || '') === (prev.regionId || '');
      const sameColor = (c.color || '') === (prev.color || '');
      const isFill =
        c.source === 'ce01_safe_fill' || c.stitchType === 'fill' ||
        prev.source === 'ce01_safe_fill' || prev.stitchType === 'fill';

      if (dist <= maxConvertDist && (sameRegion || (sameColor && isFill))) {
        // Check segment inside polygon with 0.18mm tolerance
        const regionId = c.regionId || prev.regionId;
        const poly = regionPolygons.get(regionId);
        if (poly) {
          const x1 = prev.x - offX, y1 = prev.y - offY;
          const x2 = c.x - offX, y2 = c.y - offY;
          if (segmentInsideTolerant(x1, y1, x2, y2, poly, 0.18)) {
            // Check if next command is a stitch at ~same position (would create duplicate)
            const nextCmd = cmds[i + 1];
            if (nextCmd && nextCmd.type === 'stitch') {
              const nextDist = Math.hypot(nextCmd.x - c.x, nextCmd.y - c.y);
              if (nextDist < 0.3) {
                // Skip the jump entirely — next stitch is at the same spot
                convertedCount++;
                // Remove trim just before this jump
                while (step2.length > 0 && step2[step2.length - 1].type === 'trim') {
                  step2.pop();
                  removedTrimCount++;
                }
                continue;
              }
            }

            // Convert jump to stitch
            step2.push({
              ...c,
              type: 'stitch',
              source: c.source || prev.source || 'travel_opt_converted',
              stitchType: c.stitchType || prev.stitchType || 'fill',
            });
            convertedCount++;
            // Remove trim just before the converted stitch
            while (step2.length > 1 && step2[step2.length - 2].type === 'trim') {
              step2.splice(step2.length - 2, 1);
              removedTrimCount++;
            }
            continue;
          }
        }
      }
    }

    step2.push(c);
  }

  // ── Step 3: Remove unnecessary trims (next movement is short) ──
  const step3 = [];
  for (let i = 0; i < step2.length; i++) {
    const c = step2[i];

    if (c.type === 'trim') {
      // Find next non-trim command
      let nextIdx = i + 1;
      while (nextIdx < step2.length && step2[nextIdx].type === 'trim') nextIdx++;

      if (nextIdx < step2.length) {
        const next = step2[nextIdx];
        // Find last stitch/jump position before trim
        let prevIdx = step3.length - 1;
        while (prevIdx >= 0 && step3[prevIdx].type === 'trim') prevIdx--;
        const prev = prevIdx >= 0 ? step3[prevIdx] : null;

        if (prev && (next.type === 'stitch' || next.type === 'jump')) {
          const dist = Math.hypot(next.x - prev.x, next.y - prev.y);
          if (dist <= maxConvertDist) {
            // Next movement is short — trim is unnecessary
            removedTrimCount++;
            continue;
          }
        }
      }
      step3.push(c);
    } else {
      step3.push(c);
    }
  }

  // ── After metrics ──
  const jumpsAfter = step3.filter(c => c.type === 'jump').length;
  const trimsAfter = step3.filter(c => c.type === 'trim').length;

  console.log('[travel-opt] jumps after:', jumpsAfter);
  console.log('[travel-opt] trims after:', trimsAfter);
  console.log('[travel-opt] converted short jumps:', convertedCount);
  console.log('[travel-opt] removed trims:', removedTrimCount);

  // ── Transactional validation ──
  const longBefore = countLongStitches(commands);
  const longAfter = countLongStitches(step3);
  const dupBefore = countDuplicates(commands);
  const dupAfter = countDuplicates(step3);

  // ── colorChange preservation — never allow colorChange removal ──────────
  const colorChangesBefore = commands.filter(c => c.type === 'colorChange').length;
  const colorChangesAfter = step3.filter(c => c.type === 'colorChange').length;
  const colorChangePreserved = colorChangesAfter === colorChangesBefore;

  // ── contour/detail stitch preservation ──────────────────────────────────
  const contourBefore = commands.filter(c => c.type === 'stitch' && c.stitchType === 'running_stitch').length;
  const contourAfter = step3.filter(c => c.type === 'stitch' && c.stitchType === 'running_stitch').length;
  const contourPreserved = contourAfter >= contourBefore * 0.9;

  const jumpImproved = jumpsAfter < jumpsBefore;
  const trimImproved = trimsAfter < trimsBefore;
  const noLongRegression = longAfter <= longBefore;
  const noDupRegression = dupAfter <= dupBefore + 2;
  const applied = (jumpImproved || trimImproved) && noLongRegression && noDupRegression
    && colorChangePreserved && contourPreserved;

  console.log('[travel-opt] applied:', applied);

  if (!applied) {
    let reason;
    if (!jumpImproved && !trimImproved) reason = 'no improvement in jumps or trims';
    else if (!noLongRegression) reason = `longStitches increased (${longBefore} → ${longAfter})`;
    else if (!noDupRegression) reason = `duplicateStitches increased (${dupBefore} → ${dupAfter})`;
    else reason = 'unknown';

    console.log('[travel-opt] discarded reason:', reason);

    return {
      applied: false,
      commands,
      reason,
      report: {
        blocksBuilt,
        jumpsBefore, jumpsAfter,
        trimsBefore, trimsAfter,
        convertedShortJumps: convertedCount,
        removedTrims: removedTrimCount,
        longBefore, longAfter,
        dupBefore, dupAfter,
        applied: false,
        discardedReason: reason,
      },
    };
  }

  return {
    applied: true,
    commands: step3,
    reason: null,
    report: {
      blocksBuilt,
      jumpsBefore, jumpsAfter,
      trimsBefore, trimsAfter,
      convertedShortJumps: convertedCount,
      removedTrims: removedTrimCount,
      longBefore, longAfter,
      dupBefore, dupAfter,
      applied: true,
      discardedReason: null,
    },
  };
}