/**
 * CE01 Command Sanitizer — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Final command cleanup for the Caydo CE01 home embroidery machine.
 * Runs AFTER command generation and BEFORE file encoding.
 *
 * Does NOT modify regions, fills, contours, canvas, or visual state.
 * Only operates on the flat command sequence.
 *
 * 4 phases:
 *   1. Remove consecutive duplicate stitches (< 0.05mm)
 *   2. Merge micro-stitches (< 0.8mm) — preserves corners + tie-in/off
 *   3. Split long stitches (> 8mm) into max 7.5mm segments
 *   4. Optimize jumps (collapse consecutive) + ensure trims before > 3.5mm
 *
 * Public API:
 *   sanitizeCommandsForCE01(commands, machineSettings, options)
 *     → { commands: sanitizedCommands, report: { ... } }
 */

// ─── Thresholds ──────────────────────────────────────────────────────────────

const SPLIT_THRESHOLD   = 8.0;   // mm — stitches above this get split
const SPLIT_SEGMENT_MAX = 7.5;   // mm — max segment length after split
const MERGE_THRESHOLD   = 0.8;   // mm — stitches below this get merged
const DUP_THRESHOLD     = 0.05;  // mm — consecutive stitches closer than this = duplicate
const CORNER_ANGLE_DEG  = 120;   // angle between in/out vectors < this = corner (protect)
const TIE_PROTECT_COUNT = 3;     // protect first/last N stitches near boundaries

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * @param {Array}  commands        — flat command sequence from exportPipeline
 * @param {Object} machineSettings — { maxJumpLength, trimThreshold, ... }
 * @param {Object} options         — reserved for future options
 * @returns {{ commands: Array, report: Object }}
 */
export function sanitizeCommandsForCE01(commands, machineSettings = {}, options = {}) {
  const maxJump       = machineSettings.maxJumpLength || 12.1;
  const trimThreshold = machineSettings.trimThreshold || 3.5;

  let cmds = (commands || []).map(c => ({ ...c }));
  const report = {
    removedDuplicates: 0,
    mergedMicroStitches: 0,
    splitLongStitches: 0,
    jumpsReduced: 0,
    trimsInserted: 0,
    before: cmds.length,
    after: 0,
    warnings: [],
  };

  console.log(`[ce01-sanitize] input commands: ${cmds.length}`);
  const jumpsBefore = cmds.filter(c => c.type === 'jump').length;

  // Phase 1: Remove consecutive duplicate stitches
  cmds = _removeDuplicates(cmds, report);
  console.log(`[ce01-sanitize] duplicates removed: ${report.removedDuplicates}`);

  // Phase 2: Merge micro-stitches (< 0.8mm) — preserve corners + tie-in/off
  cmds = _mergeMicroStitches(cmds, report);
  console.log(`[ce01-sanitize] micro stitches merged: ${report.mergedMicroStitches}`);

  // Phase 3: Split long stitches (> 8mm) into max 7.5mm segments
  cmds = _splitLongStitches(cmds, report);
  console.log(`[ce01-sanitize] long stitches split: ${report.splitLongStitches}`);

  // Phase 4: Collapse consecutive jumps + ensure trims before > 3.5mm jumps
  cmds = _optimizeJumps(cmds, report, trimThreshold, maxJump);
  console.log(`[ce01-sanitize] trims inserted: ${report.trimsInserted}`);

  const jumpsAfter = cmds.filter(c => c.type === 'jump').length;
  console.log(`[ce01-sanitize] jumps before/after: ${jumpsBefore}/${jumpsAfter}`);

  report.after = cmds.length;
  return { commands: cmds, report };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 1: Remove consecutive duplicate stitches
// ═══════════════════════════════════════════════════════════════════════════

function _removeDuplicates(cmds, report) {
  const out = [];
  let prevX = null, prevY = null;

  for (const c of cmds) {
    if (c.type === 'stitch') {
      if (prevX !== null) {
        const dist = Math.hypot(c.x - prevX, c.y - prevY);
        if (dist < DUP_THRESHOLD) {
          report.removedDuplicates++;
          continue; // skip duplicate
        }
      }
      prevX = c.x;
      prevY = c.y;
    } else {
      // Non-stitch command breaks consecutive chain — reset prev tracking
      prevX = null;
      prevY = null;
    }
    out.push(c);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 2: Merge micro-stitches (< 0.8mm)
// ═══════════════════════════════════════════════════════════════════════════

function _mergeMicroStitches(cmds, report) {
  const out = [];

  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    if (c.type !== 'stitch') {
      out.push(c);
      continue;
    }

    // Find previous stitch in output
    let prev = null;
    for (let j = out.length - 1; j >= 0; j--) {
      if (out[j].type === 'stitch') { prev = out[j]; break; }
    }
    // Find next stitch in original input
    let next = null;
    for (let j = i + 1; j < cmds.length; j++) {
      if (cmds[j].type === 'stitch') { next = cmds[j]; break; }
    }

    if (!prev || !next) {
      // Can't evaluate — keep stitch
      out.push(c);
      continue;
    }

    const dist = Math.hypot(c.x - prev.x, c.y - prev.y);
    if (dist >= MERGE_THRESHOLD) {
      out.push(c);
      continue;
    }

    // Protect tie-in/off: stitches near non-stitch boundaries
    if (_isNearBoundary(cmds, i, TIE_PROTECT_COUNT)) {
      out.push(c);
      continue;
    }

    // Protect corners: sharp direction change means this point matters
    if (_isSharpCorner(prev, c, next)) {
      out.push(c);
      continue;
    }

    // Merge: skip this stitch (path goes directly prev → next)
    report.mergedMicroStitches++;
  }

  return out;
}

/**
 * Returns true if the stitch at index i is within `count` positions of a
 * non-stitch command (colorChange, jump, trim, end) in either direction.
 * These boundary-adjacent stitches are likely tie-in/off — protected from merge.
 */
function _isNearBoundary(cmds, i, count) {
  // Check backward
  let back = 0;
  for (let j = i - 1; j >= 0; j--) {
    if (cmds[j].type !== 'stitch') return true;
    back++;
    if (back >= count) break;
  }
  if (back < count) return true; // near start of sequence
  // Check forward
  let fwd = 0;
  for (let j = i + 1; j < cmds.length; j++) {
    if (cmds[j].type !== 'stitch') return true;
    fwd++;
    if (fwd >= count) break;
  }
  if (fwd < count) return true; // near end of sequence
  return false;
}

/**
 * Returns true if the angle between (prev→current) and (current→next) vectors
 * is sharp enough to be considered a corner worth preserving.
 * angle < CORNER_ANGLE_DEG → deviation > (180 - CORNER_ANGLE_DEG) → corner
 */
function _isSharpCorner(prev, current, next) {
  const v1x = current.x - prev.x, v1y = current.y - prev.y;
  const v2x = next.x - current.x, v2y = next.y - current.y;
  const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
  if (l1 < 1e-9 || l2 < 1e-9) return false;
  const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
  return angle < CORNER_ANGLE_DEG;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 3: Split long stitches (> 8mm)
// ═══════════════════════════════════════════════════════════════════════════

function _splitLongStitches(cmds, report) {
  const out = [];
  let prevX = 0, prevY = 0;

  for (const c of cmds) {
    if (c.type === 'stitch') {
      const dist = Math.hypot(c.x - prevX, c.y - prevY);
      if (dist > SPLIT_THRESHOLD) {
        // Split into segments of max SPLIT_SEGMENT_MAX mm
        const steps = Math.ceil(dist / SPLIT_SEGMENT_MAX);
        for (let s = 1; s <= steps; s++) {
          const sx = prevX + (c.x - prevX) * s / steps;
          const sy = prevY + (c.y - prevY) * s / steps;
          out.push({ ...c, x: sx, y: sy });
        }
        report.splitLongStitches++;
      } else {
        out.push(c);
      }
      prevX = c.x;
      prevY = c.y;
    } else if (c.type === 'jump') {
      out.push(c);
      prevX = c.x;
      prevY = c.y;
    } else {
      // colorChange, trim, end — don't move needle, don't update prev
      out.push(c);
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 4: Optimize jumps + ensure trims
// ═══════════════════════════════════════════════════════════════════════════

function _optimizeJumps(cmds, report, trimThreshold, maxJump) {
  const out = [];
  let prevX = 0, prevY = 0;

  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];

    if (c.type === 'jump') {
      // Find the end of the consecutive jump sequence
      let endIdx = i;
      let endX = c.x, endY = c.y;
      while (endIdx + 1 < cmds.length && cmds[endIdx + 1].type === 'jump') {
        endIdx++;
        endX = cmds[endIdx].x;
        endY = cmds[endIdx].y;
      }

      const totalDist = Math.hypot(endX - prevX, endY - prevY);
      const originalJumpCount = endIdx - i + 1;

      // Ensure trim before long jump (> trimThreshold) if preceded by stitch
      // and no trim/colorChange already present
      const prevOut = out[out.length - 1];
      if (totalDist > trimThreshold && prevOut && prevOut.type === 'stitch') {
        out.push({ type: 'trim', x: prevX, y: prevY, color: c.color, regionId: c.regionId });
        report.trimsInserted++;
      }

      // Re-emit minimal jump set (collapse sub-jumps, re-split if > maxJump)
      if (totalDist > maxJump) {
        const steps = Math.ceil(totalDist / maxJump);
        for (let s = 1; s <= steps; s++) {
          const jx = prevX + (endX - prevX) * s / steps;
          const jy = prevY + (endY - prevY) * s / steps;
          out.push({ type: 'jump', x: jx, y: jy, color: c.color, regionId: c.regionId });
        }
        report.jumpsReduced += Math.max(0, originalJumpCount - steps);
      } else {
        // Single jump to final position — collapses all sub-jumps
        out.push({ type: 'jump', x: endX, y: endY, color: c.color, regionId: c.regionId });
        report.jumpsReduced += Math.max(0, originalJumpCount - 1);
      }

      prevX = endX;
      prevY = endY;
      i = endIdx; // skip consumed sub-jumps
    } else {
      out.push(c);
      if (c.type === 'stitch') {
        prevX = c.x;
        prevY = c.y;
      }
      // trim, colorChange, end — don't update prevX/prevY (needle stays)
    }
  }
  return out;
}