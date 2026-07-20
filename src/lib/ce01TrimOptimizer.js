/**
 * ce01TrimOptimizer.js — StitchPath AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Reduces unnecessary trims in finalEmbroideryCommands without changing
 * the visual design, coordinates, colors, or stitch positions.
 *
 * Rules:
 *   REMOVE trim when next movement is:
 *     - same color
 *     - ≤ 6mm
 *     - no colorChange between
 *     - no long jump (>8mm)
 *
 *   KEEP trim when:
 *     - color change follows
 *     - jump > 8mm
 *     - islands > 12mm apart
 *
 *   REMOVE sequences:
 *     - trim + short jump (≤6mm, same color)
 *     - trim + jump + stitch (if jump ≤6mm)
 *     - trim + trim
 *     - trim before end
 *     - trim before duplicate colorChange
 *
 * Transactional: applies only if trims −30%, jumps +10% max,
 * longStitches unchanged, outsideHoop unchanged, stitches not destructive,
 * colors unchanged.
 */

import { calculateUnifiedCommandMetrics } from './unifiedCommandMetrics';

const SHORT_JUMP_THRESHOLD = 6.0;   // mm — remove trim before jumps ≤ this
const LONG_JUMP_KEEP = 8.0;         // mm — keep trim before jumps > this
const ISLAND_SEPARATION = 12.0;     // mm — keep trim between far-apart islands

/**
 * @param {Array}  commands        — flat command sequence (read-only input)
 * @param {Array}  regions         — visual regions (unused, for API consistency)
 * @param {Object} config          — width_mm, height_mm (unused but required by API)
 * @param {Object} machineSettings — designOffset, etc.
 * @returns {{ applied, commands, reason, metricsBefore, metricsAfter, report }}
 */
export function optimizeCE01Trims(commands, regions = [], config = {}, machineSettings = {}) {
  const metricsBefore = calculateUnifiedCommandMetrics(commands, regions, machineSettings);

  console.log('[trim-opt] trims before:', metricsBefore.trimCount);
  console.log('[trim-opt] jumps before:', metricsBefore.jumpCount);

  let removedBeforeShortJump = 0;
  let removedDuplicateTrim = 0;
  let keptColorChange = 0;
  let keptLongJump = 0;

  // ── Pass 1: Remove duplicate trims (trim + trim) ──
  let pass1 = [];
  let prevType = null;
  for (const c of commands) {
    if (c.type === 'trim' && prevType === 'trim') {
      removedDuplicateTrim++;
      continue;
    }
    pass1.push(c);
    prevType = c.type;
  }

  // ── Pass 2: Remove unnecessary trims ──
  const pass2 = [];
  for (let i = 0; i < pass1.length; i++) {
    const c = pass1[i];

    if (c.type !== 'trim') {
      pass2.push(c);
      continue;
    }

    // Find next non-trim command
    let nextIdx = i + 1;
    while (nextIdx < pass1.length && pass1[nextIdx].type === 'trim') nextIdx++;

    if (nextIdx >= pass1.length) {
      // Trim at very end with nothing after — remove
      removedBeforeShortJump++;
      continue;
    }

    const next = pass1[nextIdx];

    // Trim before end — unnecessary
    if (next.type === 'end') {
      removedBeforeShortJump++;
      continue;
    }

    // Trim before colorChange — machine auto-trims on color change
    if (next.type === 'colorChange') {
      removedBeforeShortJump++;
      continue;
    }

    // Find last stitch/jump position before trim
    let prevIdx = pass2.length - 1;
    while (prevIdx >= 0 && pass2[prevIdx].type === 'trim') prevIdx--;
    const prev = prevIdx >= 0 ? pass2[prevIdx] : null;

    if (!prev || !next.x || next.type === 'colorChange' || next.type === 'end') {
      pass2.push(c);
      continue;
    }

    // Distance from last position to next movement
    const dist = Math.hypot(next.x - prev.x, next.y - prev.y);
    const sameColor = (c.color || prev.color || '') === (next.color || '');

    // Keep trim: islands very far apart
    if (dist > ISLAND_SEPARATION) {
      keptLongJump++;
      pass2.push(c);
      continue;
    }

    // Keep trim: long jump
    if (dist > LONG_JUMP_KEEP) {
      keptLongJump++;
      pass2.push(c);
      continue;
    }

    // Keep trim: different color (shouldn't happen if no colorChange, but safety)
    if (!sameColor) {
      keptColorChange++;
      pass2.push(c);
      continue;
    }

    // Remove trim: same color, ≤6mm, no colorChange, no long jump
    if (dist <= SHORT_JUMP_THRESHOLD) {
      removedBeforeShortJump++;
      continue;
    }

    // Between 6-8mm: conservative, keep trim
    pass2.push(c);
  }

  const metricsAfter = calculateUnifiedCommandMetrics(pass2, regions, machineSettings);

  console.log('[trim-opt] trims after:', metricsAfter.trimCount);
  console.log('[trim-opt] jumps after:', metricsAfter.jumpCount);
  console.log('[trim-opt] removed trim before short jump:', removedBeforeShortJump);
  console.log('[trim-opt] removed duplicate trim:', removedDuplicateTrim);
  console.log('[trim-opt] kept trim because color change:', keptColorChange);
  console.log('[trim-opt] kept trim because long jump:', keptLongJump);

  // ── Transactional validation ──
  const trimsBefore = metricsBefore.trimCount;
  const trimsAfter = metricsAfter.trimCount;
  const jumpsBefore = metricsBefore.jumpCount;
  const jumpsAfter = metricsAfter.jumpCount;

  const trimReduction = trimsBefore > 0 ? (trimsBefore - trimsAfter) / trimsBefore : 0;
  const jumpIncrease = jumpsBefore > 0 ? (jumpsAfter - jumpsBefore) / jumpsBefore : 0;

  const applied =
    trimReduction >= 0.30 &&
    jumpIncrease <= 0.10 &&
    metricsAfter.longStitches <= metricsBefore.longStitches &&
    metricsAfter.outsideHoop <= metricsBefore.outsideHoop &&
    metricsAfter.stitchCount >= metricsBefore.stitchCount * 0.95 &&
    metricsAfter.colorCount === metricsBefore.colorCount;

  console.log('[trim-opt] applied:', applied);

  if (!applied) {
    let reason;
    if (trimReduction < 0.30) reason = `trim reduction ${(trimReduction * 100).toFixed(1)}% < 30%`;
    else if (jumpIncrease > 0.10) reason = `jumps increased ${(jumpIncrease * 100).toFixed(1)}% > 10%`;
    else if (metricsAfter.longStitches > metricsBefore.longStitches) reason = 'longStitches increased';
    else if (metricsAfter.outsideHoop > metricsBefore.outsideHoop) reason = 'outsideHoop increased';
    else if (metricsAfter.stitchCount < metricsBefore.stitchCount * 0.95) reason = 'stitchCount dropped destructively';
    else if (metricsAfter.colorCount !== metricsBefore.colorCount) reason = 'color count changed';
    else reason = 'unknown';

    console.log('[trim-opt] discarded reason:', reason);

    return {
      applied: false,
      commands,
      reason,
      metricsBefore,
      metricsAfter,
      report: {
        trimsBefore, trimsAfter,
        jumpsBefore, jumpsAfter,
        stitchesBefore: metricsBefore.stitchCount,
        stitchesAfter: metricsAfter.stitchCount,
        colorsBefore: metricsBefore.colorCount,
        colorsAfter: metricsAfter.colorCount,
        outsideRegionBefore: metricsBefore.outsideHoop,
        outsideRegionAfter: metricsAfter.outsideHoop,
        longStitchesBefore: metricsBefore.longStitches,
        longStitchesAfter: metricsAfter.longStitches,
        removedBeforeShortJump,
        removedDuplicateTrim,
        keptColorChange,
        keptLongJump,
        applied: false,
        discardedReason: reason,
      },
    };
  }

  return {
    applied: true,
    commands: pass2,
    reason: null,
    metricsBefore,
    metricsAfter,
    report: {
      trimsBefore, trimsAfter,
      jumpsBefore, jumpsAfter,
      stitchesBefore: metricsBefore.stitchCount,
      stitchesAfter: metricsAfter.stitchCount,
      colorsBefore: metricsBefore.colorCount,
      colorsAfter: metricsAfter.colorCount,
      outsideRegionBefore: metricsBefore.outsideHoop,
      outsideRegionAfter: metricsAfter.outsideHoop,
      longStitchesBefore: metricsBefore.longStitches,
      longStitchesAfter: metricsAfter.longStitches,
      removedBeforeShortJump,
      removedDuplicateTrim,
      keptColorChange,
      keptLongJump,
      applied: true,
      discardedReason: null,
    },
  };
}